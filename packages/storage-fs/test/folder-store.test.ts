import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { exportBackup, Journal, MemoryStore, type Entry } from '@logbook/core';
import { assertRelativePath, FolderStore } from '../src/index.ts';
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
    expect(await files(root)).toEqual([`entries/${e.id}.json.enc`, 'logbook.json', `media/${id2}/${media.id}.bin.enc`, `media/${id2}/${media.id}.meta.json.enc`].sort());
    const sealed = await readFile(join(root, 'entries', `${e.id}.json.enc`), 'utf8');
    expect(sealed).not.toContain('Secret');

    // Reopen, unlock, read the picture back.
    const j2 = await Journal.open(await open(root));
    expect(j2.isLocked).toBe(true);
    await j2.unlock('correct horse');
    expect((await j2.getEntry(e.id))?.title).toBe('Secret');
    expect(new Uint8Array(await (await j2.getMediaBlob(media.id))!.arrayBuffer())).toEqual(pngBytes());

    await j2.disableEncryption('correct horse');
    expect(await files(root)).toEqual([`entries/2026/2026-10-07--secret--${e.id}.json`, 'logbook.json', `media/${id2}/${media.id}.meta.json`, `media/${id2}/${media.id}.png`].sort());
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

describe('assertRelativePath', () => {
  it.each(['../x', '/etc/passwd', 'a/../b', 'a//b', 'C:/x', 'a\\b', './a', ''])('refuses %j', (p) => {
    expect(() => assertRelativePath(p)).toThrow();
  });
  it('accepts journal paths', () => {
    expect(() => assertRelativePath('entries/2026/2026-10-07--a--b.json')).not.toThrow();
  });
});
