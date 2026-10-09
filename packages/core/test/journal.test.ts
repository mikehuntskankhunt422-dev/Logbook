import { describe, expect, it } from 'vitest';
import { ConflictError, Journal, LockedError } from '../src/journal.ts';
import { MemoryStore, isSealed } from '../src/storage.ts';
import { WrongPasscodeError } from '../src/crypto.ts';
import { emptyDoc } from '../src/richtext.ts';
import { bookOptionsSchema } from '../src/print/options.ts';
import { FAST_KDF, pngBytes } from './helpers.ts';

async function fresh() {
  const store = new MemoryStore();
  return { store, journal: await Journal.open(store) };
}

describe('Journal entries', () => {
  it('creates, saves and lists newest date first', async () => {
    const { journal } = await fresh();
    await journal.saveEntry(journal.newEntry({ date: '2026-01-01', title: 'Old' }));
    const saved = await journal.saveEntry(journal.newEntry({ date: '2026-10-07', title: 'New', tags: ['#Beach Day', 'beach-day'] }));
    expect(saved.rev).toBe(1);
    expect(saved.tags).toEqual(['beach-day']);
    expect((await journal.listEntries()).map((e) => e.title)).toEqual(['New', 'Old']);
  });

  it('detects conflicting edits when an expected revision is given', async () => {
    const { journal } = await fresh();
    const a = await journal.saveEntry(journal.newEntry({ title: 'v1' }));
    await journal.saveEntry({ ...a, title: 'from another tab' });
    await expect(journal.saveEntry({ ...a, title: 'stale' }, { expectedRev: a.rev })).rejects.toBeInstanceOf(ConflictError);
  });

  it('soft-deletes to trash, restores, and purges after 30 days', async () => {
    const { journal } = await fresh();
    const e = await journal.saveEntry(journal.newEntry({ title: 'gone soon' }));
    await journal.trashEntry(e.id);
    expect(await journal.listEntries()).toHaveLength(0);
    expect(await journal.listTrash()).toHaveLength(1);
    await journal.restoreEntry(e.id);
    expect(await journal.listEntries()).toHaveLength(1);

    await journal.trashEntry(e.id);
    expect(await journal.purgeExpiredTrash(new Date())).toBe(0);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await journal.purgeExpiredTrash(later)).toBe(1);
    expect(await journal.listTrash()).toHaveLength(0);
  });

  it('reports invalid records instead of crashing', async () => {
    const { store, journal } = await fresh();
    await store.put('entries', { id: 'broken', nonsense: true } as never);
    await journal.saveEntry(journal.newEntry({ title: 'fine' }));
    expect(await journal.listEntries()).toHaveLength(1);
    expect(journal.issues).toEqual([expect.objectContaining({ id: 'broken' })]);
  });
});

describe('Journal media', () => {
  it('stores media and garbage-collects unreferenced files but keeps posters of used videos', async () => {
    const { journal } = await fresh();
    const used = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'a.png' });
    const unused = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'b.png' });
    const video = await journal.addMedia(new Blob([new Uint8Array(10)], { type: 'video/mp4' }), { name: 'v.mp4' });
    const poster = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'v.poster.png', derivedFrom: video.id });
    await journal.updateMediaMeta({ ...video, posterId: poster.id });
    const e = journal.newEntry({
      blocks: [
        { id: 'b1', type: 'photo', mediaId: used.id, caption: '' },
        { id: 'b2', type: 'video', mediaId: video.id, caption: '' },
      ],
    });
    await journal.saveEntry(e);
    expect(await journal.collectGarbage()).toBe(1);
    const left = (await journal.listMediaMeta()).map((m) => m.id).sort();
    expect(left).toEqual([used.id, video.id, poster.id].sort());
    expect(left).not.toContain(unused.id);
    const blob = await journal.getMediaBlob(used.id);
    expect(blob?.type).toBe('image/png');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(pngBytes());
  });

  it('keeps unreferenced media younger than the grace period (D84)', async () => {
    const journal = await Journal.open(new MemoryStore(), { mediaGraceDays: 7 });
    const photo = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'synced-before-its-entry.png' });
    expect(await journal.collectGarbage()).toBe(0);
    expect(await journal.collectGarbage(new Date(Date.now() + 6 * 86_400_000))).toBe(0);
    expect(await journal.collectGarbage(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    expect(await journal.getMediaMeta(photo.id)).toBeUndefined();
  });
});

describe('Journal encryption', () => {
  it('encrypts everything in the store, locks, and unlocks', async () => {
    const { store, journal } = await fresh();
    const m = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'secret-photo.png' });
    await journal.saveEntry(journal.newEntry({ title: 'Dear diary', blocks: [{ id: 'b', type: 'text', doc: emptyDoc('my secret') }] }));

    await journal.enableEncryption('open sesame', FAST_KDF);
    const raw = await store.all('entries');
    expect(raw.every(isSealed)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('Dear diary');
    expect(JSON.stringify(await store.all('media'))).not.toContain('secret-photo');
    const rawBlob = new Uint8Array(await (await store.getBlob(m.id))!.arrayBuffer());
    expect(rawBlob).not.toEqual(pngBytes());

    journal.lock();
    expect(journal.isLocked).toBe(true);
    await expect(journal.listEntries()).rejects.toBeInstanceOf(LockedError);
    await expect(journal.unlock('wrong passcode')).rejects.toBeInstanceOf(WrongPasscodeError);

    // A fresh Journal over the same store (like reopening the app) needs the passcode too.
    const reopened = await Journal.open(store);
    expect(reopened.isLocked).toBe(true);
    await reopened.unlock('open sesame');
    expect((await reopened.listEntries())[0]?.title).toBe('Dear diary');
    expect(new Uint8Array(await (await reopened.getMediaBlob(m.id))!.arrayBuffer())).toEqual(pngBytes());
  });

  it('changes passcode and can turn encryption off again', async () => {
    const { store, journal } = await fresh();
    await journal.saveEntry(journal.newEntry({ title: 'hello' }));
    await journal.enableEncryption('first-pass', FAST_KDF);
    await journal.changePasscode('first-pass', 'second-pass');
    const j2 = await Journal.open(store);
    await expect(j2.unlock('first-pass')).rejects.toBeInstanceOf(WrongPasscodeError);
    await j2.unlock('second-pass');
    await j2.disableEncryption('second-pass');
    expect(j2.isEncrypted).toBe(false);
    expect((await store.all('entries')).some(isSealed)).toBe(false);
    expect(await store.getKey('vault')).toBeUndefined();
  });
});

describe('backup reminder', () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

  it('stays quiet while writing, even after many autosaves', async () => {
    const { journal } = await fresh();
    expect(journal.needsBackupReminder()).toBe(false);
    for (let i = 0; i < 40; i++) await journal.saveEntry(journal.newEntry());
    expect(journal.needsBackupReminder(inDays(1))).toBe(false);
  });

  it('reminds two days after the first unbacked change when never backed up', async () => {
    const { journal } = await fresh();
    await journal.saveEntry(journal.newEntry());
    expect(journal.needsBackupReminder(inDays(2.1))).toBe(true);
  });

  it('after a backup, reminds only once the interval passed and something changed; snoozing works', async () => {
    const { journal } = await fresh();
    await journal.saveEntry(journal.newEntry());
    await journal.markBackedUp();
    expect(journal.needsBackupReminder(inDays(30))).toBe(false); // nothing changed since
    await journal.saveEntry(journal.newEntry());
    expect(journal.needsBackupReminder(inDays(3))).toBe(false);
    expect(journal.needsBackupReminder(inDays(15))).toBe(true); // default 14 days
    await journal.updateSettings({ backupSnoozedUntil: inDays(17).toISOString() });
    expect(journal.needsBackupReminder(inDays(15))).toBe(false);
    expect(journal.needsBackupReminder(inDays(18))).toBe(true);
  });
});

describe('print orders', () => {
  const ref = (n: number) => ({ id: `ord_${'a'.repeat(15)}${n}`, token: `token-${'x'.repeat(20)}-${n}`, createdAt: `2026-10-08T00:00:${String(n % 60).padStart(2, '0')}.000Z` });

  it('keeps the newest orders first, sealed while a passcode is on', async () => {
    const { store, journal } = await fresh();
    expect(await journal.listBookOrders()).toEqual([]);
    await journal.saveBookOrder(ref(1));
    await journal.saveBookOrder(ref(2));
    await journal.saveBookOrder(ref(1)); // saving again moves it to the front, once
    expect((await journal.listBookOrders()).map((o) => o.id)).toEqual([ref(1).id, ref(2).id]);
    expect(await journal.getBookOrder(ref(2).id)).toEqual(ref(2));

    await journal.enableEncryption('correct horse', FAST_KDF);
    const sealed = await store.getKey('bookOrders');
    expect(isSealed(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('token-');
    journal.lock();
    await expect(journal.listBookOrders()).rejects.toBeInstanceOf(LockedError);
    await journal.unlock('correct horse');
    expect(await journal.getBookOrder(ref(1).id)).toEqual(ref(1));
    await journal.disableEncryption('correct horse');
    expect(isSealed(await store.getKey('bookOrders'))).toBe(false);
    expect(await journal.listBookOrders()).toHaveLength(2);
  });

  it('keeps at most 20, is cleared with the content, and rejects malformed references', async () => {
    const { store, journal } = await fresh();
    for (let n = 1; n <= 25; n++) await journal.saveBookOrder(ref(n));
    const list = await journal.listBookOrders();
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe(ref(25).id);
    await expect(journal.saveBookOrder({ id: 'nope', token: 'short', createdAt: '' })).rejects.toThrow();
    await journal.clearContent();
    expect(await journal.listBookOrders()).toEqual([]);
    await store.setKey('bookOrders', [{ id: 42 }]);
    expect(await journal.listBookOrders()).toEqual([]);
  });
});

describe('book draft', () => {
  it('round-trips, is sealed while a passcode is on, and survives switching encryption on and off', async () => {
    const { store, journal } = await fresh();
    expect(await journal.getBookDraft()).toBeUndefined();
    await journal.saveBookDraft(bookOptionsSchema.parse({ title: 'Secret trip', backText: 'Only for us' }));
    expect(JSON.stringify(await store.getKey('bookDraft'))).toContain('Secret trip');

    await journal.enableEncryption('correct horse', FAST_KDF);
    const sealed = await store.getKey('bookDraft');
    expect(isSealed(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('Secret');
    journal.lock();
    await expect(journal.getBookDraft()).rejects.toBeInstanceOf(LockedError);
    await journal.unlock('correct horse');
    expect((await journal.getBookDraft())?.title).toBe('Secret trip');

    await journal.disableEncryption('correct horse');
    expect(isSealed(await store.getKey('bookDraft'))).toBe(false);
    expect((await journal.getBookDraft())?.backText).toBe('Only for us');
  });

  it('is cleared with the journal content and ignores drafts it cannot read', async () => {
    const { store, journal } = await fresh();
    await journal.saveBookDraft(bookOptionsSchema.parse({ title: 'x' }));
    await journal.clearContent();
    expect(await journal.getBookDraft()).toBeUndefined();
    await store.setKey('bookDraft', { title: 42 });
    expect(await journal.getBookDraft()).toBeUndefined();
  });
});
