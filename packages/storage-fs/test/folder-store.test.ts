import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ConflictError, exportBackup, Journal, MemoryStore, VaultChangedError, type Entry } from '@logbook/core';
import { assertRelativePath, DamagedFileError, FolderStore } from '../src/index.ts';
import { NodeFsBackend } from '../src/node.ts';
import { recordStoreContract } from '../../core/test/contract.ts';
import { FAST_KDF, pngBytes } from '../../core/test/helpers.ts';

const dirs: string[] = [];
async function folder(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'logbook-fs-'));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const open = async (root: string) => FolderStore.open(new NodeFsBackend(root));
const files = async (root: string) =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join('/'))
    .sort();

recordStoreContract('FolderStore', async () => open(await folder()));

describe('FolderStore files', () => {
  it('lays out entries, media and settings like a backup zip', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const media = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'beach.png' });
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'A good day' }));
    await j.updateSettings({ theme: 'dark' });

    const id2 = media.id.slice(0, 2);
    expect(await files(root)).toEqual([`entries/2026/2026-10-07--a-good-day--${e.id}.json`, 'logbook.json', `media/${id2}/${media.id}.meta.json`, `media/${id2}/${media.id}.png`].sort());
    const lb = JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8'));
    expect(lb).toMatchObject({ format: 'logbook', version: 1, settings: { theme: 'dark' } });
    // People can open their entries: indented JSON.
    expect(await readFile(join(root, 'entries/2026', `2026-10-07--a-good-day--${e.id}.json`), 'utf8')).toContain('\n  "title": "A good day"');
  });

  it('renames an entry file when its title changes and moves it to trash and back', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    let e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'First' }));
    e = await j.saveEntry({ ...e, title: 'Second' });
    expect(await files(root)).toContain(`entries/2026/2026-10-07--second--${e.id}.json`);
    expect((await files(root)).filter((p) => p.includes(e.id))).toHaveLength(1);

    await j.trashEntry(e.id);
    expect((await files(root)).filter((p) => p.includes(e.id))).toEqual([`trash/2026/2026-10-07--second--${e.id}.json`]);
    await j.restoreEntry(e.id);
    expect((await files(root)).filter((p) => p.includes(e.id))).toEqual([`entries/2026/2026-10-07--second--${e.id}.json`]);
  });

  it('keeps the journal across reopening, including book state outside the backup layout', async () => {
    const root = await folder();
    const j1 = await Journal.open(await open(root));
    const saved = await j1.saveEntry(j1.newEntry({ title: 'Still here' }));
    await j1.saveBookOrder({ id: 'ord_1', token: 'secret-token-0123456789', createdAt: '2026-10-10T00:00:00.000Z' });

    const j2 = await Journal.open(await open(root));
    expect((await j2.getEntry(saved.id))?.title).toBe('Still here');
    expect((await j2.listBookOrders()).map((o) => o.id)).toEqual(['ord_1']);
    expect(await files(root)).toContain('.logbook/book-orders.json');
  });

  it('seals every file with a passcode and restores the readable layout without one', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const media = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'p.png' });
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Secret' }));

    await j.enableEncryption('correct horse', FAST_KDF);
    const id2 = media.id.slice(0, 2);
    expect(await files(root)).toEqual(
      ['.logbook/vault.json', `entries/${e.id}.json.enc`, 'logbook.json', `media/${id2}/${media.id}.bin.enc`, `media/${id2}/${media.id}.meta.json.enc`].sort(),
    );
    const sealed = await readFile(join(root, 'entries', `${e.id}.json.enc`), 'utf8');
    expect(sealed).not.toContain('Secret');

    // Reopen, unlock, read the picture back.
    const j2 = await Journal.open(await open(root));
    expect(j2.isLocked).toBe(true);
    await j2.unlock('correct horse');
    expect((await j2.getEntry(e.id))?.title).toBe('Secret');
    expect(new Uint8Array(await (await j2.getMediaBlob(media.id))!.arrayBuffer())).toEqual(pngBytes());

    await j2.disableEncryption('correct horse');
    // The old key is kept aside (D85), in case a file sealed with it turns up from another computer.
    expect(await files(root)).toEqual(
      ['.logbook/previous-vault.json', `entries/2026/2026-10-07--secret--${e.id}.json`, 'logbook.json', `media/${id2}/${media.id}.meta.json`, `media/${id2}/${media.id}.png`].sort(),
    );
  });

  it('opens a backup zip unzipped into a folder as a working journal', async () => {
    const source = await Journal.open(new MemoryStore());
    const m = await source.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'x.png' });
    const e = await source.saveEntry(source.newEntry({ title: 'From the web', blocks: [] }));
    const zip = unzipSync(new Uint8Array(await (await exportBackup(source)).arrayBuffer()));

    const root = await folder();
    for (const [path, data] of Object.entries(zip)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), data);
    }
    const j = await Journal.open(await open(root));
    expect((await j.getEntry(e.id))?.title).toBe('From the web');
    expect((await j.getMediaBlob(m.id))?.type).toBe('image/png');
  });

  it('reads the newest copy when another computer renamed an entry, and tidies up on the next save', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Old title' }));
    // Simulate a sync bringing in the renamed file before the old one's deletion.
    const newer: Entry = { ...e, title: 'New title', rev: e.rev + 1 };
    await writeFile(join(root, 'entries/2026', `2026-10-07--new-title--${e.id}.json`), JSON.stringify(newer));

    const store = await open(root);
    const j2 = await Journal.open(store);
    expect((await j2.getEntry(e.id))?.title).toBe('New title');
    expect(await j2.listEntries()).toHaveLength(1);
    await j2.saveEntry({ ...(await j2.getEntry(e.id))!, title: 'Third' });
    expect((await files(root)).filter((p) => p.includes(e.id))).toEqual([`entries/2026/2026-10-07--third--${e.id}.json`]);
  });

  it('leaves sync conflict copies alone and lists them', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Shared' }));
    const base = `entries/2026/2026-10-07--shared--${e.id}`;
    await writeFile(join(root, `${base} (conflicted copy 2026-10-10).json`), '{}');
    await writeFile(join(root, `${base}-LAPTOP.json`), '{}');
    await writeFile(join(root, 'entries/2026/.DS_Store'), '');

    const store = await open(root);
    expect(store.conflicts()).toEqual([
      { path: `${base} (conflicted copy 2026-10-10).json`, id: e.id, kind: 'entry' },
      { path: `${base}-LAPTOP.json`, id: e.id, kind: 'entry' },
    ]);
    const j2 = await Journal.open(store);
    expect((await j2.listEntries()).map((x) => x.title)).toEqual(['Shared']);
  });

  it('skips a file it can’t parse (a sync in progress) and says which', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Fine' }));
    await writeFile(join(root, 'entries/2026/2026-10-08--half--zzzzzzzzzzzz.json'), '{"id":');
    const store = await open(root);
    const j2 = await Journal.open(store);
    expect((await j2.listEntries()).map((x) => x.id)).toEqual([e.id]);
    expect(store.unreadableFiles()).toEqual(['entries/2026/2026-10-08--half--zzzzzzzzzzzz.json']);
  });

  it('refuses a folder holding something else’s logbook.json', async () => {
    const root = await folder();
    await writeFile(join(root, 'logbook.json'), JSON.stringify({ format: 'something-else' }));
    await expect(open(root)).rejects.toThrow(/isn't a Logbook journal/);
  });
});

describe('FolderStore keeps the passcode key safe (D85)', () => {
  async function encrypted() {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Secret' }));
    await j.enableEncryption('correct horse', FAST_KDF);
    return { root, j, e };
  }

  it('refuses to open a folder whose logbook.json is damaged, and never rewrites it', async () => {
    const { root, j } = await encrypted();
    const good = await readFile(join(root, 'logbook.json'), 'utf8');
    // Damaged while the journal is open (a hand edit with a typo, a truncated file after a crash).
    await writeFile(join(root, 'logbook.json'), good.slice(0, 40));
    await expect(j.updateSettings({ theme: 'dark' })).rejects.toThrow(DamagedFileError);
    expect(await readFile(join(root, 'logbook.json'), 'utf8')).toBe(good.slice(0, 40));
    await expect(open(root)).rejects.toThrow(/logbook\.json in your journal folder can't be read/);
    await writeFile(join(root, 'logbook.json'), '');
    await expect(open(root)).rejects.toThrow(DamagedFileError);
  });

  it('opens with the mirrored key when logbook.json is missing, and puts the key back on the next save', async () => {
    const { root, e } = await encrypted();
    await rm(join(root, 'logbook.json'));
    const j = await Journal.open(await open(root));
    expect(j.isLocked).toBe(true);
    await j.unlock('correct horse');
    expect((await j.getEntry(e.id))?.title).toBe('Secret');
    await j.updateSettings({ theme: 'dark' });
    expect(JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8'))).toMatchObject({ settings: { theme: 'dark' }, vault: { v: 1 } });
  });

  it('refuses to open an encrypted folder with no key file at all, rather than show it as empty', async () => {
    const { root } = await encrypted();
    await rm(join(root, 'logbook.json'));
    await rm(join(root, '.logbook/vault.json'));
    await expect(open(root)).rejects.toThrow(/key file \(logbook\.json\) is missing/);
  });

  it('turns the passcode off including an entry another computer wrote meanwhile', async () => {
    const { root, j } = await encrypted();
    // A second computer, same folder: adds a sealed entry after this one opened.
    const other = await Journal.open(await open(root));
    await other.unlock('correct horse');
    const theirs = await other.saveEntry(other.newEntry({ date: '2026-10-08', title: 'From the laptop' }));
    await j.disableEncryption('correct horse');
    const reopened = await Journal.open(await open(root));
    expect(reopened.isEncrypted).toBe(false);
    expect((await reopened.getEntry(theirs.id))?.title).toBe('From the laptop');
  });

  it('turns the passcode off past a file sealed with a different key, which it couldn’t open anyway, and keeps the old key', async () => {
    const { root, j, e } = await encrypted();
    const elsewhere = await folder();
    const stranger = await Journal.open(await open(elsewhere));
    const s = await stranger.saveEntry(stranger.newEntry({ title: 'Other key' }));
    await stranger.enableEncryption('another passcode', FAST_KDF);
    await mkdir(join(root, 'entries'), { recursive: true });
    await writeFile(join(root, 'entries', `${s.id}.json.enc`), await readFile(join(elsewhere, 'entries', `${s.id}.json.enc`)));

    await j.disableEncryption('correct horse');
    const reopened = await Journal.open(await open(root));
    expect(reopened.isEncrypted).toBe(false);
    expect((await reopened.getEntry(e.id))?.title).toBe('Secret');
    expect(await files(root)).toContain(`entries/${s.id}.json.enc`);
    expect(await files(root)).toContain('.logbook/previous-vault.json');
  });

  it('changes nothing when a file can’t be read yet (still syncing), so nothing is left sealed without its key', async () => {
    const { root, j, e } = await encrypted();
    const before = await files(root);
    // Another entry, sealed with this key, still arriving: half a file.
    await writeFile(join(root, 'entries', 'zzzzzzzzzzzz.json.enc'), '{"id":"zzzzzzzzzzzz","sealed":1,"iv":');
    await expect(j.disableEncryption('correct horse')).rejects.toThrow(/can't be read right now/);
    expect(await files(root)).toEqual([...before, 'entries/zzzzzzzzzzzz.json.enc'].sort());
    expect(j.isEncrypted).toBe(true);
    expect(JSON.parse(await readFile(join(root, `entries/${e.id}.json.enc`), 'utf8')).sealed).toBe(1);
  });

  it('won’t let a window that missed another computer turning the passcode on overwrite its key or write in plain text', async () => {
    const root = await folder();
    const desktop = await Journal.open(await open(root));
    const laptop = await Journal.open(await open(root));
    const e = await laptop.saveEntry(laptop.newEntry({ date: '2026-10-07', title: 'Laptop' }));
    await laptop.enableEncryption('laptop passcode', FAST_KDF);
    const laptopKey = JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8')).vault;

    await expect(desktop.enableEncryption('desktop passcode', FAST_KDF)).rejects.toThrow(VaultChangedError);
    await expect(desktop.saveEntry(desktop.newEntry({ title: 'Would be plain text' }))).rejects.toThrow(VaultChangedError);
    expect(JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8')).vault).toEqual(laptopKey);
    const again = await Journal.open(await open(root));
    await again.unlock('laptop passcode');
    expect((await again.getEntry(e.id))?.title).toBe('Laptop');
  });

  it('doesn’t bring back a passcode that was turned off when a stale key copy is still around', async () => {
    const { root, j } = await encrypted();
    const copy = await readFile(join(root, '.logbook/vault.json'));
    await j.disableEncryption('correct horse');
    // A sync tool restores the key copy after the passcode went off (or the app died half way).
    await writeFile(join(root, '.logbook/vault.json'), copy);
    const reopened = await Journal.open(await open(root));
    expect(reopened.isEncrypted).toBe(false);
  });

  it('refuses a save while logbook.json is damaged without writing half of it, then saves once it’s back', async () => {
    const { root } = await encrypted();
    const j = await Journal.open(await open(root));
    await j.unlock('correct horse');
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-09', title: 'First' }));
    const good = await readFile(join(root, 'logbook.json'));
    const sealed = await readFile(join(root, `entries/${e.id}.json.enc`), 'utf8');
    await writeFile(join(root, 'logbook.json'), '{"format":');
    await expect(j.saveEntry({ ...e, title: 'Second' }, { expectedRev: e.rev })).rejects.toThrow(DamagedFileError);
    expect(await readFile(join(root, `entries/${e.id}.json.enc`), 'utf8')).toBe(sealed);
    // Restored (sync finished): the same save goes through, with no false conflict.
    await writeFile(join(root, 'logbook.json'), good);
    expect((await j.saveEntry({ ...e, title: 'Second' }, { expectedRev: e.rev })).rev).toBe(e.rev + 1);
  });

  it('follows a passcode turned off on another computer: unlock adopts it, and an unlocked window stops sealing', async () => {
    const { root } = await encrypted();
    const locked = await Journal.open(await open(root));
    const unlocked = await Journal.open(await open(root));
    await unlocked.unlock('correct horse');
    const laptop = await Journal.open(await open(root));
    await laptop.unlock('correct horse');
    await laptop.disableEncryption('correct horse');

    await expect(unlocked.saveEntry(unlocked.newEntry({ title: 'Would be sealed with a dropped key' }))).rejects.toThrow(VaultChangedError);
    await locked.unlock('anything');
    expect(locked.isEncrypted).toBe(false);
    const saved = await locked.saveEntry(locked.newEntry({ date: '2026-10-09', title: 'Plain now' }));
    expect(await files(root)).toContain(`entries/2026/2026-10-09--plain-now--${saved.id}.json`);
  });
});

describe('FolderStore with another computer on the same folder', () => {
  it('never deletes photos while tidying up: entries using them may not have synced yet', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const m = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'beach.png' });
    // The entry that uses the photo hasn't arrived on this computer yet.
    expect(await j.collectGarbage()).toBe(0);
    expect(await j.getMediaMeta(m.id)).toBeDefined();
  });

  it('sees an entry another computer renamed, so a stale save is a conflict instead of a silent overwrite', async () => {
    const root = await folder();
    const desktop = await Journal.open(await open(root));
    const e = await desktop.saveEntry(desktop.newEntry({ date: '2026-10-07', title: 'Trip' }));
    const laptop = await Journal.open(await open(root));
    await laptop.saveEntry({ ...(await laptop.getEntry(e.id))!, title: 'Trip to Rome', tags: ['italy'] });

    await expect(desktop.saveEntry({ ...e, title: 'Trip' }, { expectedRev: e.rev })).rejects.toThrow(ConflictError);
    expect((await desktop.getEntry(e.id))?.title).toBe('Trip to Rome');
  });

  it('keeps both copies when two computers saved the same version differently, and lists the other as a conflict', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Base' }));
    const theirs: Entry = { ...e, title: 'Laptop edit', rev: e.rev };
    const theirPath = `entries/2026/2026-10-07--laptop-edit--${e.id}.json`;
    await writeFile(join(root, theirPath), JSON.stringify(theirs));

    const store = await open(root);
    const j2 = await Journal.open(store);
    const shown = (await j2.getEntry(e.id))!;
    await j2.saveEntry({ ...shown, tags: ['kept'] });
    const other = shown.title === 'Base' ? 'Laptop edit' : 'Base';
    const kept = (await files(root)).filter((f) => f.includes('(conflict '));
    expect(kept).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, kept[0]!), 'utf8')).title).toBe(other);
    expect(store.conflicts().map((c) => c.path)).toEqual(kept);

    // After a restart and two more saves, the kept copy is still there and still listed.
    const store3 = await open(root);
    const j3 = await Journal.open(store3);
    const now = (await j3.getEntry(e.id))!;
    await j3.saveEntry({ ...now, tags: ['again'] });
    await j3.saveEntry({ ...(await j3.getEntry(e.id))!, tags: ['and again'] });
    expect(await files(root)).toContain(kept[0]);
    expect(store3.conflicts().map((c) => ({ path: c.path, id: c.id }))).toEqual([{ path: kept[0], id: e.id }]);
  });

  it('deletes an entry’s photos with it when it’s deleted for good, and keeps photos other entries use', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const own = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'own.png' });
    const shared = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'shared.png' });
    const block = (id: string) => ({ id: `b${id}`, type: 'photo', mediaId: id, caption: '' }) as unknown as Entry['blocks'][number];
    const a = await j.saveEntry(j.newEntry({ title: 'Going', blocks: [block(own.id), block(shared.id)] }));
    await j.saveEntry(j.newEntry({ title: 'Staying', blocks: [block(shared.id)] }));
    await j.trashEntry(a.id);
    await j.purgeEntry(a.id);
    expect(await j.getMediaMeta(own.id)).toBeUndefined();
    expect((await files(root)).some((f) => f.includes(own.id))).toBe(false);
    expect(await j.getMediaMeta(shared.id)).toBeDefined();
  });
});

describe('assertRelativePath', () => {
  it.each(['../x', '/etc/passwd', 'a/../b', 'a//b', 'C:/x', 'a\\b', './a', ''])('refuses %j', (p) => {
    expect(() => assertRelativePath(p)).toThrow();
  });
  it('accepts journal paths', () => {
    expect(() => assertRelativePath('entries/2026/2026-10-07--a--b.json')).not.toThrow();
  });
});
