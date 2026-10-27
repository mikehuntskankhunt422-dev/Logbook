import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ConflictError, exportBackup, Journal, MemoryStore, openVault, VaultChangedError, type Entry } from '@logbook/core';
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
    expect(lb).toMatchObject({ format: 'logbook', version: 3, settings: { theme: 'dark' } });
    // People can open their entries: indented JSON.
    expect(await readFile(join(root, 'entries/2026', `2026-10-07--a-good-day--${e.id}.json`), 'utf8')).toContain('\n  "title": "A good day"');
  });

  it('marks an older journal as the current version when it opens, so older apps ask to be updated (D91, D93)', async () => {
    const root = await folder();
    await writeFile(join(root, 'logbook.json'), JSON.stringify({ format: 'logbook', version: 1, settings: { theme: 'dark' } }));
    const j = await Journal.open(await open(root));
    expect(j.getSettings().theme).toBe('dark');
    expect(JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8'))).toEqual({ format: 'logbook', version: 3, settings: { theme: 'dark' } });
    await writeFile(join(root, 'logbook.json'), JSON.stringify({ format: 'logbook', version: 4 }));
    await expect(open(root)).rejects.toThrow(/newer version of Logbook/);
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

  it('keeps the journal across reopening, and deletes book files left by earlier versions (D96)', async () => {
    const root = await folder();
    await mkdir(join(root, '.logbook'), { recursive: true });
    await writeFile(join(root, '.logbook', 'book-orders.json'), JSON.stringify([{ id: 'ord_1', token: 'secret-token-0123456789', createdAt: '2026-10-10T00:00:00.000Z' }]));
    await writeFile(join(root, '.logbook', 'book-draft.json'), JSON.stringify({ title: 'Trip' }));
    const j1 = await Journal.open(await open(root));
    const saved = await j1.saveEntry(j1.newEntry({ title: 'Still here' }));
    await j1.dropBookData();
    expect(await files(root)).not.toContain('.logbook/book-orders.json');
    expect(await files(root)).not.toContain('.logbook/book-draft.json');

    const j2 = await Journal.open(await open(root));
    expect((await j2.getEntry(saved.id))?.title).toBe('Still here');
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
    const after = await files(root);
    expect(after.filter((f) => !f.startsWith('.logbook/previous-vaults/'))).toEqual(
      [`entries/2026/2026-10-07--secret--${e.id}.json`, 'logbook.json', `media/${id2}/${media.id}.meta.json`, `media/${id2}/${media.id}.png`].sort(),
    );
    expect(after.filter((f) => f.startsWith('.logbook/previous-vaults/'))).toHaveLength(1);
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
      { path: `${base} (conflicted copy 2026-10-10).json`, id: e.id, kind: 'entry', kept: false },
      { path: `${base}-LAPTOP.json`, id: e.id, kind: 'entry', kept: false },
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
    expect((await files(root)).some((f) => f.startsWith('.logbook/previous-vaults/'))).toBe(true);
  });

  it('changes nothing when a file can’t be read yet (still syncing), so nothing is left sealed without its key', async () => {
    const { root, j, e } = await encrypted();
    const before = await files(root);
    // Another entry, sealed with this key, still arriving: half a file.
    await writeFile(join(root, 'entries', 'zzzzzzzzzzzz.json.enc'), '{"id":"zzzzzzzzzzzz","sealed":1,"iv":');
    await expect(j.disableEncryption('correct horse')).rejects.toThrow(/can't be read yet/);
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

describe('FolderStore keeps every key a file may need, and no more (final review)', () => {
  const kept = async (root: string) => (await files(root)).filter((f) => f.startsWith('.logbook/previous-vaults/'));

  it('changing the passcode keeps no copy the old passcode could open', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.saveEntry(j.newEntry({ title: 'Private' }));
    await j.enableEncryption('old passcode', FAST_KDF);
    await j.changePasscode('old passcode', 'new passcode');
    expect(await kept(root)).toEqual([]);
    for (const f of await files(root)) {
      if (!f.startsWith('.logbook/') && f !== 'logbook.json') continue;
      const json = JSON.parse(await readFile(join(root, f), 'utf8'));
      const vault = json.vault ?? (json.wrappedKey ? json : undefined);
      if (vault) await expect(openVault(vault, 'old passcode')).rejects.toThrow();
    }
  });

  it('keeps every replaced key through off, on with a new key, change and off again', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.enableEncryption('first passcode', FAST_KDF);
    await j.disableEncryption('first passcode');
    await j.enableEncryption('second passcode', FAST_KDF);
    await j.changePasscode('second passcode', 'third passcode');
    await j.disableEncryption('third passcode');
    expect(await kept(root)).toHaveLength(2);
  });

  it('turns the passcode off past a photo sealed with another key, leaving it sealed', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.enableEncryption('correct horse', FAST_KDF);
    const elsewhere = await folder();
    const stranger = await Journal.open(await open(elsewhere));
    await stranger.enableEncryption('another passcode', FAST_KDF);
    const m = await stranger.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'theirs.png' });
    const id2 = m.id.slice(0, 2);
    await mkdir(join(root, 'media', id2), { recursive: true });
    for (const f of [`${m.id}.meta.json.enc`, `${m.id}.bin.enc`]) await writeFile(join(root, 'media', id2, f), await readFile(join(elsewhere, 'media', id2, f)));

    const reopened = await Journal.open(await open(root));
    await reopened.unlock('correct horse');
    expect(await reopened.listMediaMeta()).toEqual([]);
    await reopened.disableEncryption('correct horse');
    expect(await files(root)).toEqual(expect.arrayContaining([`media/${id2}/${m.id}.meta.json.enc`, `media/${id2}/${m.id}.bin.enc`]));
    // A plain backup simply can't include it, and doesn't fail because of it.
    await expect(exportBackup(reopened)).resolves.toBeInstanceOf(Blob);
  });

  it('changes nothing while a photo’s data is still on its way', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const m = await j.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'big-video.png' });
    await j.enableEncryption('correct horse', FAST_KDF);
    await rm(join(root, 'media', m.id.slice(0, 2), `${m.id}.bin.enc`));
    const before = await files(root);
    await expect(j.disableEncryption('correct horse')).rejects.toThrow(/big-video\.png/);
    expect(await files(root)).toEqual(before);
    expect(j.isEncrypted).toBe(true);
  });

  it('refuses a backup that would silently leave out a file it can’t read right now', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.saveEntry(j.newEntry({ title: 'Kept' }));
    await writeFile(join(root, 'entries/2026/2026-10-08--half--zzzzzzzzzzzz.json'), '{"id":');
    const again = await Journal.open(await open(root));
    await again.listEntries();
    await expect(exportBackup(again)).rejects.toThrow(/can't be read right now/);
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

  it('keeps the other computer’s copy even when the next save lands on its file name', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Base' }));
    // Both computers saved the next revision: the desktop as 'Base', the laptop renamed it 'Trip'.
    const desktop: Entry = { ...e, rev: e.rev + 1, tags: ['desktop'] };
    const laptop: Entry = { ...e, title: 'Trip', rev: e.rev + 1, tags: ['laptop-paragraph'] };
    await writeFile(join(root, `entries/2026/2026-10-07--base--${e.id}.json`), JSON.stringify(desktop));
    await writeFile(join(root, `entries/2026/2026-10-07--trip--${e.id}.json`), JSON.stringify(laptop));

    const store = await open(root);
    const j2 = await Journal.open(store);
    const shown = (await j2.getEntry(e.id))!;
    expect(shown.title).toBe('Base');
    // The person retypes the laptop's title: the save goes to the laptop copy's file name.
    await j2.saveEntry({ ...shown, title: 'Trip' });
    const conflictFiles = (await files(root)).filter((f) => f.includes('(conflict '));
    expect(conflictFiles).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, conflictFiles[0]!), 'utf8')).tags).toEqual(['laptop-paragraph']);
    expect(store.conflicts().map((c) => c.path)).toEqual(conflictFiles);
  });

  it('keeps a sealed copy and a plain one of the same entry instead of letting either delete the other', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Plain' }));
    await j.enableEncryption('correct horse', FAST_KDF);
    const sealedFile = `entries/${e.id}.json.enc`;
    const sealed = await readFile(join(root, sealedFile));
    await j.disableEncryption('correct horse');
    // The laptop, still with the passcode on, saved this entry meanwhile: its sealed copy arrives late.
    await writeFile(join(root, sealedFile), sealed);
    const store = await open(root);
    const j2 = await Journal.open(store);
    await j2.saveEntry({ ...(await j2.getEntry(e.id))!, tags: ['after'] });
    expect((await files(root)).some((f) => f.startsWith(`entries/${e.id} (conflict `) && f.endsWith('.json.enc'))).toBe(true);
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

describe('copies to sort out (D102)', () => {
  /** A journal with one entry, and a sync tool's copy of it with another title and text. */
  async function withCopy() {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Desk' }));
    const path = `entries/2026/2026-10-07--desk--${e.id} (conflicted copy 2026-10-10).json`;
    await writeFile(join(root, path), JSON.stringify({ ...e, title: 'Laptop', tags: ['laptop'] }));
    const j2 = await Journal.open(await open(root));
    return { root, j: j2, e, path };
  }

  it('shows a copy beside the entry it belongs to', async () => {
    const { j, e, path } = await withCopy();
    const [c] = await j.entryCopies();
    expect(c).toMatchObject({ path, copy: { id: e.id, title: 'Laptop' }, current: { id: e.id, title: 'Desk' } });
  });

  it('keeps the journal’s version: the copy goes to Recently deleted, as an entry of its own', async () => {
    const { root, j, e, path } = await withCopy();
    await j.settleCopy(path, 'ours');
    expect((await j.listEntries()).map((x) => x.title)).toEqual(['Desk']);
    const trash = await j.listTrash();
    expect(trash.map((x) => [x.title, x.id === e.id])).toEqual([['Laptop', false]]);
    expect(await files(root)).not.toContain(path);
    expect(await j.entryCopies()).toEqual([]);
  });

  it('uses the copy: the journal’s version goes to Recently deleted', async () => {
    const { root, j, e, path } = await withCopy();
    await j.settleCopy(path, 'theirs');
    const [live] = await j.listEntries();
    expect([live!.id, live!.title, live!.tags]).toEqual([e.id, 'Laptop', ['laptop']]);
    expect((await j.listTrash()).map((x) => x.title)).toEqual(['Desk']);
    expect((await files(root)).filter((f) => f.includes(e.id))).toEqual([`entries/2026/2026-10-07--laptop--${e.id}.json`]);
  });

  it('keeps both, the copy as an entry of its own', async () => {
    const { j, path } = await withCopy();
    await j.settleCopy(path, 'both');
    expect((await j.listEntries()).map((x) => x.title).sort()).toEqual(['Desk', 'Laptop']);
    expect(await j.listTrash()).toEqual([]);
  });

  it('sorts out a copy kept beside its entry under its own name (two computers saved the same version)', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Base' }));
    await writeFile(join(root, `entries/2026/2026-10-07--laptop-edit--${e.id}.json`), JSON.stringify({ ...e, title: 'Laptop edit' }));
    const j2 = await Journal.open(await open(root));
    await j2.listEntries();
    const [c] = await j2.entryCopies();
    expect(c!.copy!.title).not.toBe(c!.current!.title);
    // Saving the copy's version lands on its file name, which moves it aside first: still found.
    await j2.settleCopy(c!.path, 'theirs');
    expect(await j2.entryCopies()).toEqual([]);
    expect((await j2.listEntries()).map((x) => x.title)).toEqual([c!.copy!.title]);
    expect((await files(root)).filter((f) => f.includes('(conflict '))).toEqual([]);
  });

  it('keeps the version someone was writing when another computer saved the same entry first', async () => {
    const root = await folder();
    const desktop = await Journal.open(await open(root));
    const e = await desktop.saveEntry(desktop.newEntry({ date: '2026-10-07', title: 'Trip' }));
    const laptop = await Journal.open(await open(root));
    await laptop.saveEntry({ ...(await laptop.getEntry(e.id))!, title: 'Trip to Rome' });
    const typed = { ...e, tags: ['typed-on-desktop'] };
    await expect(desktop.saveEntry(typed, { expectedRev: e.rev })).rejects.toThrow(ConflictError);
    const kept = await desktop.keepVersion(typed);
    expect(kept).toEqual({ copy: expect.stringContaining('(your version ') });
    const [c] = await desktop.entryCopies();
    expect([c!.copy!.tags, c!.current!.title, c!.kept]).toEqual([['typed-on-desktop'], 'Trip to Rome', true]);
    // Another computer sees it too.
    expect((await (await Journal.open(await open(root))).entryCopies()).map((x) => x.copy!.tags)).toEqual([['typed-on-desktop']]);
  });

  it('keeps a version sealed with the passcode, and opens it to compare', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.enableEncryption('correct horse', FAST_KDF);
    const e = await j.saveEntry(j.newEntry({ title: 'Secret' }));
    const { copy } = (await j.keepVersion({ ...e, title: 'Secret, rewritten' })) as { copy: string };
    expect(copy).toMatch(new RegExp(`^entries/${e.id} \\(your version [0-9a-z]+\\)\\.json\\.enc$`));
    expect(await readFile(join(root, copy), 'utf8')).not.toContain('rewritten');
    expect((await j.entryCopies()).map((c) => c.copy?.title)).toEqual(['Secret, rewritten']);
  });

  it('keeps a version as an entry of its own where the store keeps no copies (the browser)', async () => {
    const j = await Journal.open(new MemoryStore());
    const e = await j.saveEntry(j.newEntry({ title: 'Plan' }));
    const kept = await j.keepVersion({ ...e, tags: ['mine'] });
    expect('entry' in kept && [kept.entry.title, kept.entry.tags, kept.entry.id !== e.id]).toEqual(['Plan (your other version)', ['mine'], true]);
  });

  it('can’t sort out a copy it can’t read, but can delete it', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Desk' }));
    const path = `entries/2026/2026-10-07--desk--${e.id}-LAPTOP.json`;
    await writeFile(join(root, path), '{"id":');
    const j2 = await Journal.open(await open(root));
    expect(await j2.entryCopies()).toMatchObject([{ path, copy: null, current: { id: e.id } }]);
    // Listed once, as a copy, not also as a file that can't be read.
    expect([j2.store.conflicts!().length, j2.store.unreadableFiles!()]).toEqual([1, []]);
    await expect(j2.settleCopy(path, 'both')).rejects.toThrow(/can't read/);
    await j2.deleteCopy(path);
    expect(await files(root)).not.toContain(path);
    expect([j2.store.conflicts!(), j2.store.unreadableFiles!()]).toEqual([[], []]);
  });

  it('won’t replace or delete an entry whose own file it can’t read yet, but can keep both', async () => {
    const { root, e, path } = await withCopy();
    const own = (await files(root)).find((f) => f.includes(e.id) && !f.includes('conflicted'))!;
    await writeFile(join(root, own), '{"id":"' + e.id); // still syncing
    const j2 = await Journal.open(await open(root));
    expect(await j2.entryCopies()).toMatchObject([{ path, current: undefined, currentUnreadable: true }]);
    await expect(j2.settleCopy(path, 'ours')).rejects.toThrow(/can't read this entry's own version/);
    await expect(j2.settleCopy(path, 'theirs')).rejects.toThrow(/can't read this entry's own version/);
    expect(await files(root)).toContain(own);
    await j2.settleCopy(path, 'both');
    expect((await files(root)).filter((f) => f.includes(e.id))).toEqual([own]);
    expect((await j2.listEntries()).map((x) => x.title)).toEqual(['Laptop']);
  });

  it('puts back a copy of an entry that has gone, in the journal and not about to expire; or bins it under a new id', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Gone' }));
    const old = { ...e, deletedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z' };
    await j.purgeEntry(e.id);
    const back = `trash/2026/2026-10-07--gone--${e.id} (conflicted copy).json`;
    const bin = `trash/2026/2026-10-07--gone--${e.id} (conflicted copy 2).json`;
    await mkdir(join(root, 'trash/2026'), { recursive: true });
    await writeFile(join(root, back), JSON.stringify(old));
    await writeFile(join(root, bin), JSON.stringify(old));
    const j2 = await Journal.open(await open(root));
    expect((await j2.entryCopies()).map((c) => [c.current, c.currentUnreadable])).toEqual([[undefined, false], [undefined, false]]);
    await j2.settleCopy(bin, 'ours');
    expect((await j2.listTrash()).map((x) => x.id === e.id)).toEqual([false]);
    await j2.settleCopy(back, 'theirs');
    const [live] = await j2.listEntries();
    expect([live!.id, live!.deletedAt, live!.expiresAt]).toEqual([e.id, null, null]);
  });

  it('moves a kept copy aside, not deletes it, when the folder is read again between a read and a save', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Base' }));
    await writeFile(join(root, `entries/2026/2026-10-07--laptop-edit--${e.id}.json`), JSON.stringify({ ...e, title: 'Laptop edit' }));
    const j2 = await Journal.open(await open(root));
    const shown = (await j2.getEntry(e.id))!;
    await j2.store.refresh!();
    await j2.saveEntry({ ...shown, tags: ['later'] });
    expect((await files(root)).filter((f) => f.includes('(conflict '))).toHaveLength(1);
    // And a refresh asked for during a save waits for it.
    const again = (await j2.getEntry(e.id))!;
    await Promise.all([j2.saveEntry({ ...again, tags: ['last'] }, { expectedRev: again.rev }), j2.refresh()]);
    expect((await files(root)).filter((f) => f.includes('(conflict '))).toHaveLength(1);
  });

  it('won’t save over a version another computer saved with the same revision', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ title: 'Mine' }));
    const theirs = { ...e, title: 'Theirs', updatedAt: '2030-01-01T00:00:00.000Z' };
    await expect(j.saveEntry({ ...theirs, rev: e.rev - 1 }, { expectedRev: e.rev - 1 })).rejects.toThrow(ConflictError);
    const stored = (await j.getEntry(e.id))!;
    await expect(j.saveEntry({ ...stored, title: 'Edited' }, { expectedRev: stored.rev, expectedUpdatedAt: '2030-01-01T00:00:00.000Z' })).rejects.toThrow(ConflictError);
    await expect(j.saveEntry({ ...stored, title: 'Edited' }, { expectedRev: stored.rev, expectedUpdatedAt: stored.updatedAt })).resolves.toMatchObject({ title: 'Edited' });
  });

  it('doesn’t read an older settings file over a change made meanwhile', async () => {
    const root = await folder();
    const store = await open(root);
    const j = await Journal.open(store);
    // The theme is changed here just after the refresh has read the (older) file.
    const read = store.getKey.bind(store);
    let changed = false;
    store.getKey = (async (key: 'settings') => {
      const value = await read(key);
      if (key === 'settings' && !changed) {
        changed = true;
        await j.updateSettings({ theme: 'dark' });
      }
      return value;
    }) as typeof store.getKey;
    await j.refresh();
    expect(j.getSettings().theme).toBe('dark');
  });

  it('stops calling a kept copy a copy once another computer has saved over it, and never bins it for one', async () => {
    const root = await folder();
    const desk = await Journal.open(await open(root));
    const e = await desk.saveEntry(desk.newEntry({ date: '2026-10-07', title: 'Base' }));
    // Both computers save revision 2 under their own titles: the laptop's is kept as a copy here.
    await writeFile(join(root, `entries/2026/2026-10-07--laptop--${e.id}.json`), JSON.stringify({ ...e, title: 'Laptop', rev: 2 }));
    await desk.saveEntry({ ...e, title: 'Desk' }, { expectedRev: e.rev });
    await desk.refresh();
    // As the app does after every refresh.
    await desk.listEntries();
    expect((await desk.entryCopies()).map((c) => c.copy?.title)).toEqual(['Laptop']);
    // The laptop saves again into its file: it's the newest version now, not a copy.
    await writeFile(join(root, `entries/2026/2026-10-07--laptop--${e.id}.json`), JSON.stringify({ ...e, title: 'Laptop', tags: ['later'], rev: 3 }));
    await desk.refresh();
    await desk.listEntries();
    expect(await desk.entryCopies()).toEqual([]);
    const shown = (await desk.getEntry(e.id))!;
    expect([shown.rev, shown.tags]).toEqual([3, ['later']]);
    // Saving over it makes no copy of it.
    await desk.saveEntry({ ...shown, title: 'Desk again' }, { expectedRev: 3, expectedUpdatedAt: shown.updatedAt });
    expect((await files(root)).filter((f) => f.includes(e.id))).toEqual([`entries/2026/2026-10-07--desk-again--${e.id}.json`]);
  });

  it('turns the passcode off or on whole, with the folder read again meanwhile', async () => {
    const root = await folder();
    const store = await open(root);
    const j = await Journal.open(store);
    for (const title of ['One', 'Two', 'Three', 'Four']) await j.saveEntry(j.newEntry({ title }));
    await Promise.all([j.enableEncryption('correct horse', FAST_KDF), j.refresh(), j.refresh()]);
    expect([j.isEncrypted, j.isLocked]).toEqual([true, false]);
    expect((await files(root)).filter((f) => f.startsWith('entries/') && !f.endsWith('.json.enc'))).toEqual([]);
    // The folder changes just as the entries start being written back without the passcode.
    const put = store.put.bind(store);
    let raced: Promise<void> | undefined;
    store.put = (async (name: 'entries', record: Entry) => {
      if (!raced) {
        raced = j.refresh();
        await new Promise((r) => setTimeout(r, 50));
      }
      return put(name, record);
    }) as typeof store.put;
    await j.disableEncryption('correct horse');
    await raced;
    expect([j.isEncrypted, j.isLocked]).toEqual([false, false]);
    expect(JSON.parse(await readFile(join(root, 'logbook.json'), 'utf8')).vault).toBeUndefined();
    expect((await j.listEntries()).map((x) => x.title).sort()).toEqual(['Four', 'One', 'Three', 'Two']);
  });

  it('doesn’t take a journal folder that has gone for an empty one, and reads it again once it’s back', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.saveEntry(j.newEntry({ title: 'Still here' }));
    await j.updateSettings({ theme: 'dark' });
    const seen: string[] = [];
    j.subscribe((ev) => seen.push(ev));
    await rename(root, `${root}-away`);
    // Nothing is announced, so the page keeps showing the journal; the settings stay as they were.
    await expect(j.refresh()).rejects.toThrow(/can't be found/);
    expect([seen, j.getSettings().theme, j.isLocked]).toEqual([[], 'dark', false]);
    // Not even after reading an entry whose file has gone meanwhile.
    await expect(j.listEntries()).rejects.toThrow(/can't be found/);
    await expect(j.refresh()).rejects.toThrow(/can't be found/);
    expect(seen).toEqual([]);
    await rename(`${root}-away`, root);
    await j.refresh();
    expect((await j.listEntries()).map((x) => x.title)).toEqual(['Still here']);
  });

  it('doesn’t take a passcode journal whose folder has gone for one without a passcode', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    await j.enableEncryption('correct horse', FAST_KDF);
    await rename(root, `${root}-away`);
    await j.refresh().catch(() => {});
    expect([j.isEncrypted, j.isLocked]).toEqual([true, false]);
    await rename(`${root}-away`, root);
    await j.refresh();
    expect([j.isEncrypted, j.isLocked]).toEqual([true, false]);
  });

  it('keeps another computer’s version it can’t read yet, rather than deleting it with a save', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Desk' }));
    const laptop = `entries/2026/2026-10-07--laptop--${e.id}.json`;
    await writeFile(join(root, laptop), '{"id":"' + e.id); // still arriving
    const j2 = await Journal.open(await open(root));
    await j2.listEntries();
    expect(j2.store.conflicts!().map((c) => c.path)).toEqual([laptop]);
    // A backup would miss it, so it waits, as it does for other files that can't be read yet.
    expect(j2.store.unreadableFiles!({ kept: true })).toEqual([laptop]);
    await expect(exportBackup(j2)).rejects.toThrow(/can't be read right now/);
    const shown = (await j2.getEntry(e.id))!;
    await j2.saveEntry({ ...shown, title: 'Desk again' }, { expectedRev: shown.rev, expectedUpdatedAt: shown.updatedAt });
    const after = (await files(root)).filter((f) => f.includes(e.id));
    expect(after).toContain(`entries/2026/2026-10-07--desk-again--${e.id}.json`);
    const kept = after.find((f) => f.includes('(conflict '));
    expect(kept && (await readFile(join(root, kept), 'utf8'))).toBe('{"id":"' + e.id);
  });

  it('doesn’t offer to delete an entry whose only file it can’t read, and keeps that file when the entry is saved over', async () => {
    const root = await folder();
    const j = await Journal.open(await open(root));
    const e = await j.saveEntry(j.newEntry({ date: '2026-10-07', title: 'Only' }));
    const own = `entries/2026/2026-10-07--only--${e.id}.json`;
    await writeFile(join(root, own), '{"id":"' + e.id);
    const j2 = await Journal.open(await open(root));
    expect(await j2.listEntries()).toEqual([]);
    expect([j2.store.conflicts!(), j2.store.unreadableFiles!()]).toEqual([[], [own]]);
    await j2.store.removeCopy!(own);
    expect(await files(root)).toContain(own);
    // Restoring it from a backup: the unreadable file is moved aside, not written over.
    await j2.importEntry({ ...e, title: 'Only' });
    const after = (await files(root)).filter((f) => f.includes(e.id));
    expect(after.sort()).toEqual([own, expect.stringContaining('(conflict ')].sort());
    expect((await j2.getEntry(e.id))!.title).toBe('Only');
  });

  it('asks for the passcode when another computer turned it on, but not after turning it on here', async () => {
    const root = await folder();
    const desktop = await Journal.open(await open(root));
    const laptop = await Journal.open(await open(root));
    await laptop.enableEncryption('correct horse', FAST_KDF);
    await laptop.refresh();
    expect(laptop.isLocked).toBe(false);
    expect(desktop.isLocked).toBe(false);
    await desktop.refresh();
    expect(desktop.isLocked).toBe(true);
    await desktop.unlock('correct horse');
    expect(desktop.isLocked).toBe(false);
  });

  it('reads the folder again when another computer changed it, settings too', async () => {
    const root = await folder();
    const desktop = await Journal.open(await open(root));
    const laptop = await Journal.open(await open(root));
    const seen: string[] = [];
    desktop.subscribe((ev) => seen.push(ev));
    await laptop.saveEntry(laptop.newEntry({ title: 'From the laptop' }));
    await laptop.updateSettings({ theme: 'dark' });
    expect(await desktop.listEntries()).toEqual([]);
    await desktop.refresh();
    expect((await desktop.listEntries()).map((x) => x.title)).toEqual(['From the laptop']);
    expect(desktop.getSettings().theme).toBe('dark');
    expect(seen).toEqual(['settings', 'entries', 'media', 'external']);
  });
});
