import { mkdtemp, readFile, readdir, rm, utimes, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Journal, type Entry } from '@logbook/core';
import { FolderError, FsStore, mapLocalKeys, type LocalKeys } from '../src/index.ts';
import { NodeJournalFs } from '../src/node.ts';
import { recordStoreContract } from '../../core/test/contract.ts';
import { FAST_KDF, pngBytes } from '../../core/test/helpers.ts';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'logbook-fs-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function openFolder(dir?: string, local: LocalKeys = mapLocalKeys()) {
  const root = dir ?? (await tempDir());
  const store = await FsStore.open(new NodeJournalFs(root), local);
  return { root, store, local, journal: await Journal.open(store) };
}

/** Every file in the folder, relative, sorted. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, prefix: string) => {
    for (const item of await readdir(d, { withFileTypes: true })) {
      if (item.isDirectory()) await walk(join(d, item.name), `${prefix}${item.name}/`);
      else out.push(`${prefix}${item.name}`);
    }
  };
  await walk(root, '');
  return out.sort();
}

const readJson = async (root: string, path: string) => JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, unknown>;

recordStoreContract('FsStore', async () => (await openFolder()).store);

describe('FsStore folder layout (PLAN §1.2)', () => {
  it('starts a journal in an empty folder with only logbook.json', async () => {
    const { root } = await openFolder();
    expect(await tree(root)).toEqual(['logbook.json']);
    expect(await readJson(root, 'logbook.json')).toMatchObject({ format: 'logbook', version: 1 });
  });

  it('writes entries as readable dated files and renames them when the title, date or trash state changes', async () => {
    const { root, journal } = await openFolder();
    const e = await journal.saveEntry(journal.newEntry({ date: '2026-10-07', title: 'A good day!' }));
    expect(await tree(root)).toEqual([`entries/2026/2026-10-07--a-good-day--${e.id}.json`, 'logbook.json']);
    expect(await readFile(join(root, `entries/2026/2026-10-07--a-good-day--${e.id}.json`), 'utf8')).toContain('\n  "title": "A good day!"');

    const renamed = await journal.saveEntry({ ...e, title: 'Beach', date: '2025-12-31' });
    expect(await tree(root)).toEqual([`entries/2025/2025-12-31--beach--${e.id}.json`, 'logbook.json']);

    await journal.trashEntry(renamed.id);
    expect(await tree(root)).toEqual(['logbook.json', `trash/2025/2025-12-31--beach--${e.id}.json`]);
    await journal.purgeEntry(renamed.id);
    expect(await tree(root)).toEqual(['logbook.json']);
  });

  it('stores media as details plus the original file named by id and type', async () => {
    const { root, journal, store } = await openFolder();
    const m = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'Holiday.PNG' });
    const shard = m.id.slice(0, 2);
    expect(await tree(root)).toEqual(['logbook.json', `media/${shard}/${m.id}.meta.json`, `media/${shard}/${m.id}.png`]);
    expect(new Uint8Array(await readFile(join(root, `media/${shard}/${m.id}.png`)))).toEqual(pngBytes());
    const blob = await journal.getMediaBlob(m.id);
    expect(blob?.type).toBe('image/png');

    // A file added without a type is renamed once its details say what it is.
    const heic = await journal.addMedia(new Blob([new Uint8Array([1, 2, 3])]), { name: 'IMG_0001.heic', mime: 'image/heic' });
    expect(await tree(root)).toContain(`media/${heic.id.slice(0, 2)}/${heic.id}.heic`);
    expect((await tree(root)).some((p) => p.endsWith(`${heic.id}.bin`))).toBe(false);
    expect((await store.getBlob(heic.id))?.type).toBe('image/heic');
  });

  it('keeps device settings, the book draft and order tokens out of the folder (D80)', async () => {
    const map = new Map<string, string>();
    const { root, journal } = await openFolder(undefined, mapLocalKeys(map));
    await journal.updateSettings({ theme: 'dark' });
    await journal.saveEntry(journal.newEntry({ title: 'x' }));
    await journal.saveBookOrder({ id: 'ord_abc', token: 'secret-token-1234567890', createdAt: '2026-10-09T00:00:00Z' });
    expect(Object.keys(await readJson(root, 'logbook.json')).sort()).toEqual(['createdAt', 'format', 'version']);
    expect(JSON.parse(map.get('settings')!)).toMatchObject({ theme: 'dark', changesSinceBackup: 1 });
    expect(map.get('bookOrders')).toContain('ord_abc');
    expect((await tree(root)).join()).not.toContain('ord_abc');
  });

  it('reopens the same folder with everything in place', async () => {
    const local = mapLocalKeys();
    const { root, journal } = await openFolder(undefined, local);
    const m = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'p.png' });
    const e = await journal.saveEntry(journal.newEntry({ title: 'Still here', blocks: [{ id: 'b', type: 'photo', mediaId: m.id, caption: 'sea' }] }));
    await journal.updateSettings({ theme: 'light' });

    const again = await openFolder(root, local);
    expect((await again.journal.getEntry(e.id))?.title).toBe('Still here');
    expect(new Uint8Array(await (await again.journal.getMediaBlob(m.id))!.arrayBuffer())).toEqual(pngBytes());
    expect(again.journal.getSettings().theme).toBe('light');
  });

  it('encrypts files in place with a passcode and back again without one', async () => {
    const local = mapLocalKeys();
    const { root, journal } = await openFolder(undefined, local);
    const m = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'secret.png' });
    const e = await journal.saveEntry(journal.newEntry({ title: 'Dear diary' }));
    await journal.enableEncryption('open sesame', FAST_KDF);

    const shard = m.id.slice(0, 2);
    expect(await tree(root)).toEqual([`entries/${e.id}.json.enc`, 'logbook.json', `media/${shard}/${m.id}.bin.enc`, `media/${shard}/${m.id}.meta.json.enc`]);
    for (const p of await tree(root)) expect(await readFile(join(root, p), 'utf8')).not.toMatch(/Dear diary|secret\.png/);
    expect(await readJson(root, 'logbook.json')).toHaveProperty('vault');

    const again = await openFolder(root, local);
    expect(again.journal.isLocked).toBe(true);
    await again.journal.unlock('open sesame');
    expect((await again.journal.getEntry(e.id))?.title).toBe('Dear diary');

    await again.journal.disableEncryption('open sesame');
    expect(await tree(root)).toEqual([`entries/2026/${e.date}--dear-diary--${e.id}.json`.replace('2026/', `${e.date.slice(0, 4)}/`), 'logbook.json', `media/${shard}/${m.id}.meta.json`, `media/${shard}/${m.id}.png`]);
    expect(await readJson(root, 'logbook.json')).not.toHaveProperty('vault');
  });

  it('never touches files it does not recognise, even when clearing the journal', async () => {
    const { root, journal } = await openFolder();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'README.txt'), 'mine');
    await writeFile(join(root, 'notes', 'todo.md'), 'also mine');
    await writeFile(join(root, 'entries-backup.json'), '{}');
    await journal.saveEntry(journal.newEntry({ title: 'x' }));
    await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'p.png' });
    await journal.clearContent();
    expect(await tree(root)).toEqual(['README.txt', 'entries-backup.json', 'logbook.json', 'notes/todo.md']);
  });

  it('leaves no temporary files behind and removes stale ones when opening', async () => {
    const { root, journal } = await openFolder();
    for (let i = 0; i < 5; i++) await journal.saveEntry(journal.newEntry({ title: `e${i}` }));
    expect((await tree(root)).filter((p) => p.includes('~lb-'))).toEqual([]);

    await mkdir(join(root, 'entries', '2026'), { recursive: true });
    await writeFile(join(root, 'entries', '2026', '~lb-old0000000.tmp'), 'half');
    await writeFile(join(root, 'entries', '2026', '~lb-new0000000.tmp'), 'in progress elsewhere');
    const old = new Date(Date.now() - 60 * 60_000);
    await utimes(join(root, 'entries', '2026', '~lb-old0000000.tmp'), old, old);
    await openFolder(root);
    const temps = (await tree(root)).filter((p) => p.includes('~lb-'));
    expect(temps).toEqual(['entries/2026/~lb-new0000000.tmp']);
  });

  it('refuses folders from a newer Logbook and damaged logbook.json files', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'logbook.json'), JSON.stringify({ format: 'logbook', version: 99 }));
    await expect(FsStore.open(new NodeJournalFs(root), mapLocalKeys())).rejects.toThrow(/newer version/);
    await writeFile(join(root, 'logbook.json'), '{ broken');
    await expect(FsStore.open(new NodeJournalFs(root), mapLocalKeys())).rejects.toBeInstanceOf(FolderError);
  });

  it('uses the settings of a backup unpacked into the folder until the device saves its own', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'logbook.json'), JSON.stringify({ format: 'logbook', version: 1, settings: { theme: 'dark', backupReminderDays: 30 } }));
    const { journal } = await openFolder(root);
    expect(journal.getSettings()).toMatchObject({ theme: 'dark', backupReminderDays: 30 });
  });

  it('ignores files with ids that are not safe file names, and refuses to write them', async () => {
    const { root, store, journal } = await openFolder();
    await mkdir(join(root, 'entries', '2026'), { recursive: true });
    const evil = { ...journal.newEntry({ title: 'evil' }), id: '../../escape' };
    await writeFile(join(root, 'entries', '2026', 'evil.json'), JSON.stringify(evil));
    await store.refresh();
    expect(await journal.listEntries()).toEqual([]);
    expect(store.problems).toEqual(['entries/2026/evil.json: no usable id']);
    await expect(store.put('entries', evil as Entry)).rejects.toBeInstanceOf(FolderError);
  });
});

describe('FsStore changes from outside (D83)', () => {
  it('finds entries added, changed and removed by a sync service, and ignores its own writes', async () => {
    const { root, store, journal } = await openFolder();
    const mine = await journal.saveEntry(journal.newEntry({ date: '2026-10-01', title: 'Mine' }));
    expect(await store.refresh()).toEqual({ entries: false, media: false, vault: false, conflicts: false });

    // Another computer adds an entry.
    const theirs = { ...journal.newEntry({ date: '2026-10-02', title: 'Theirs' }), rev: 1 };
    await mkdir(join(root, 'entries', '2026'), { recursive: true });
    await writeFile(join(root, `entries/2026/2026-10-02--theirs--${theirs.id}.json`), JSON.stringify(theirs));
    expect((await store.refresh()).entries).toBe(true);
    expect((await journal.listEntries()).map((e) => e.title)).toEqual(['Theirs', 'Mine']);

    // …edits mine…
    const path = join(root, `entries/2026/2026-10-01--mine--${mine.id}.json`);
    await writeFile(path, JSON.stringify({ ...mine, title: 'Mine', blocks: [], rev: 2 }));
    expect((await store.refresh()).entries).toBe(true);
    expect((await journal.getEntry(mine.id))?.rev).toBe(2);

    // …and deletes theirs.
    await rm(join(root, `entries/2026/2026-10-02--theirs--${theirs.id}.json`));
    expect((await store.refresh()).entries).toBe(true);
    expect((await journal.listEntries()).map((e) => e.title)).toEqual(['Mine']);
  });

  it('finds media arriving and a passcode set elsewhere', async () => {
    const { root, store, journal } = await openFolder();
    const other = await openFolder();
    const m = await other.journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'p.png' });
    const shard = m.id.slice(0, 2);
    await mkdir(join(root, 'media', shard), { recursive: true });
    await writeFile(join(root, `media/${shard}/${m.id}.png`), pngBytes());
    await writeFile(join(root, `media/${shard}/${m.id}.meta.json`), await readFile(join(other.root, `media/${shard}/${m.id}.meta.json`)));
    expect(await store.refresh()).toMatchObject({ media: true, vault: false });
    expect((await journal.getMediaBlob(m.id))?.size).toBe(pngBytes().length);

    await other.journal.enableEncryption('elsewhere', FAST_KDF);
    await writeFile(join(root, 'logbook.json'), await readFile(join(other.root, 'logbook.json')));
    expect((await store.refresh()).vault).toBe(true);
  });

  it('skips a half-written file and picks it up once complete', async () => {
    const { root, store, journal } = await openFolder();
    const e = { ...journal.newEntry({ date: '2026-10-03', title: 'Arriving' }), rev: 1 };
    const path = join(root, `entries/2026/2026-10-03--arriving--${e.id}.json`);
    await mkdir(join(root, 'entries', '2026'), { recursive: true });
    await writeFile(path, JSON.stringify(e).slice(0, 40));
    await store.refresh();
    expect(await journal.listEntries()).toEqual([]);
    expect(store.problems).toHaveLength(1);
    await writeFile(path, JSON.stringify(e));
    const later = new Date(Date.now() + 2000);
    await utimes(path, later, later);
    expect((await store.refresh()).entries).toBe(true);
    expect(store.problems).toEqual([]);
    expect((await journal.listEntries()).map((x) => x.title)).toEqual(['Arriving']);
  });
});

describe('FsStore sync conflicts (D82)', () => {
  async function withConflict() {
    const ctx = await openFolder();
    const e = await ctx.journal.saveEntry(ctx.journal.newEntry({ date: '2026-10-05', title: 'Picnic' }));
    const canonical = `entries/2026/2026-10-05--picnic--${e.id}.json`;
    // What Dropbox might call the other computer's version; the name doesn't matter, the id does.
    const copy = `entries/2026/2026-10-05--picnic--${e.id} (Sam's conflicted copy 2026-10-06).json`;
    await writeFile(join(ctx.root, copy), JSON.stringify({ ...e, title: 'Picnic', blocks: [], rev: e.rev + 1, updatedAt: '2026-10-06T10:00:00.000Z' }));
    await ctx.store.refresh();
    return { ...ctx, e, canonical, copy };
  }

  it('groups files with the same id, whatever their names, and uses the correctly named one', async () => {
    const { store, journal, e, canonical, copy } = await withConflict();
    const conflicts = store.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.id).toBe(e.id);
    expect(conflicts[0]!.versions.map((v) => v.path)).toEqual([canonical, copy]);
    expect((await journal.getEntry(e.id))?.rev).toBe(e.rev);
    expect(await journal.listEntries()).toHaveLength(1);
  });

  it('keeps the chosen version under the right name and removes the others', async () => {
    const { root, store, journal, e, copy } = await withConflict();
    await store.keepVersion(e.id, copy);
    expect(store.conflicts()).toEqual([]);
    expect(await tree(root)).toEqual([`entries/2026/2026-10-05--picnic--${e.id}.json`, 'logbook.json']);
    expect((await journal.getEntry(e.id))?.rev).toBe(e.rev + 1);
  });

  it('can discard one version, and saving the entry meanwhile leaves the other version alone', async () => {
    const { root, store, journal, e, copy } = await withConflict();
    await journal.saveEntry({ ...e, title: 'Picnic at the lake' });
    expect(store.conflicts()[0]!.versions.map((v) => v.path)).toEqual([`entries/2026/2026-10-05--picnic-at-the-lake--${e.id}.json`, copy]);
    await store.discardVersion(copy);
    expect(store.conflicts()).toEqual([]);
    expect(await tree(root)).toEqual([`entries/2026/2026-10-05--picnic-at-the-lake--${e.id}.json`, 'logbook.json']);
  });

  it('treats an entry renamed on two computers as a conflict and shows the newer one', async () => {
    const { root, store, journal } = await openFolder();
    const e = await journal.saveEntry(journal.newEntry({ date: '2026-10-05', title: 'Old' }));
    const a = `entries/2026/2026-10-05--from-laptop--${e.id}.json`;
    const b = `entries/2026/2026-10-05--from-desktop--${e.id}.json`;
    await writeFile(join(root, a), JSON.stringify({ ...e, title: 'From laptop' }));
    await writeFile(join(root, b), JSON.stringify({ ...e, title: 'From desktop' }));
    await rm(join(root, `entries/2026/2026-10-05--old--${e.id}.json`));
    const newer = new Date(Date.now() + 5000);
    await utimes(join(root, b), newer, newer);
    await store.refresh();
    expect(store.conflicts()[0]!.versions.map((v) => v.path)).toEqual([b, a]);
    expect((await journal.getEntry(e.id))?.title).toBe('From desktop');
  });

  it('moves a version aside rather than overwrite it when a save lands on its name', async () => {
    const { root, store, journal } = await openFolder();
    const e = await journal.saveEntry(journal.newEntry({ date: '2026-10-05', title: 'One' }));
    const other = `entries/2026/2026-10-05--two--${e.id}.json`;
    await writeFile(join(root, other), JSON.stringify({ ...e, title: 'Two', rev: 9 }));
    const older = new Date(Date.now() - 60_000);
    await utimes(join(root, other), older, older);
    await store.refresh();
    await journal.saveEntry({ ...(await journal.getEntry(e.id))!, title: 'Two' });
    const versions = store.conflicts()[0]!.versions;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.path).toBe(other);
    expect(versions[1]!.path).toMatch(new RegExp(`--two--${e.id}\\.kept-[0-9a-z]{6}\\.json$`));
    expect((versions[1]!.record as Entry).rev).toBe(9);
    expect((await stat(join(root, versions[1]!.path))).isFile()).toBe(true);
  });

  it('decrypts both versions for the conflict view when a passcode is on', async () => {
    const { root, store, journal } = await openFolder();
    await journal.enableEncryption('pass phrase', FAST_KDF);
    const e = await journal.saveEntry(journal.newEntry({ title: 'Sealed' }));
    const sealedFile = `entries/${e.id}.json.enc`;
    await journal.saveEntry({ ...e, title: 'Sealed v2' });
    // A sync copy of the first version, still sealed.
    await writeFile(join(root, `entries/${e.id}-LAPTOP.json.enc`), await readFile(join(root, sealedFile)));
    await journal.saveEntry({ ...(await journal.getEntry(e.id))!, title: 'Sealed v3' });
    await store.refresh();
    const versions = store.conflicts()[0]!.versions;
    const titles = await Promise.all(versions.map(async (v) => (await journal.readEntryRecord(v.record)).title));
    expect(titles).toEqual(['Sealed v3', 'Sealed v2']);
  });
});
