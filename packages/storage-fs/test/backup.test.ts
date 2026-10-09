import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { Journal, MemoryStore, emptyDoc, exportBackup, importBackup } from '@logbook/core';
import { FsStore, mapLocalKeys } from '../src/index.ts';
import { NodeJournalFs } from '../src/node.ts';
import { FAST_KDF, pngBytes } from '../../core/test/helpers.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function folderJournal() {
  const root = await mkdtemp(join(tmpdir(), 'logbook-restore-'));
  dirs.push(root);
  const store = await FsStore.open(new NodeJournalFs(root), mapLocalKeys());
  return { root, store, journal: await Journal.open(store) };
}

async function tree(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (d.isDirectory()) out.push(...(await tree(root, `${prefix}${d.name}/`)));
    else out.push(`${prefix}${d.name}`);
  }
  return out.sort();
}

/** A website journal: entries with text and a photo, a deleted entry, a video with its poster frame. */
async function webJournal() {
  const journal = await Journal.open(new MemoryStore());
  const photo = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'harbour.png', width: 1, height: 1 });
  const video = await journal.addMedia(new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' }), { name: 'waves.mp4', durationMs: 3000 });
  const poster = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'waves.poster.png', derivedFrom: video.id });
  await journal.updateMediaMeta({ ...video, posterId: poster.id });
  await journal.saveEntry(
    journal.newEntry({
      date: '2026-09-30',
      title: 'Harbour',
      blocks: [
        { id: 't', type: 'text', doc: emptyDoc('Boats everywhere.') },
        { id: 'p', type: 'photo', mediaId: photo.id, caption: 'From the pier' },
        { id: 'v', type: 'video', mediaId: video.id, caption: '' },
      ],
    }),
  );
  await journal.saveEntry(journal.newEntry({ date: '2026-10-01', title: 'Quiet day', blocks: [{ id: 't', type: 'text', doc: emptyDoc('Read all afternoon.') }] }));
  const gone = await journal.saveEntry(journal.newEntry({ date: '2026-08-15', title: 'Draft' }));
  await journal.trashEntry(gone.id);
  return journal;
}

describe('backups and the desktop folder (M5 slice D)', () => {
  it('restores a website backup into a folder holding exactly the files in the zip', async () => {
    const zip = await exportBackup(await webJournal());
    const inZip = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const { root, journal } = await folderJournal();
    const report = await importBackup(journal, zip, { mode: 'merge' });
    expect(report).toMatchObject({ entriesAdded: 3, mediaAdded: 3, verified: true, problems: [] });

    const zipFiles = Object.keys(inZip).filter((p) => p !== 'manifest.json' && p !== 'logbook.json').sort();
    expect((await tree(root)).filter((p) => p !== 'logbook.json')).toEqual(zipFiles);
    // Byte for byte: the folder is the backup's layout (PLAN §1.2, D7).
    for (const path of zipFiles) expect(new Uint8Array(await readFile(join(root, path))), path).toEqual(inZip[path]);
    expect(zipFiles.some((p) => p.startsWith('trash/2026/2026-08-15--draft--'))).toBe(true);

    const harbour = (await journal.listEntries()).find((e) => e.title === 'Harbour')!;
    const photoId = (harbour.blocks[1] as { mediaId: string }).mediaId;
    expect(new Uint8Array(await (await journal.getMediaBlob(photoId))!.arrayBuffer())).toEqual(pngBytes());
  });

  it('restores an encrypted backup with its passcode, and can keep the journal encrypted', async () => {
    const web = await webJournal();
    await web.enableEncryption('sea breeze', FAST_KDF);
    const zip = await exportBackup(web, { keepEncrypted: true });
    const { root, journal } = await folderJournal();
    await expect(importBackup(journal, zip, { mode: 'merge', passcode: 'wrong one' })).rejects.toThrow(/passcode/i);
    expect((await tree(root)).filter((p) => p !== 'logbook.json')).toEqual([]);

    await importBackup(journal, zip, { mode: 'merge', passcode: 'sea breeze' });
    expect((await journal.listEntries()).map((e) => e.title).sort()).toEqual(['Harbour', 'Quiet day']);
    await journal.enableEncryption('sea breeze', FAST_KDF);
    const files = (await tree(root)).filter((p) => p !== 'logbook.json');
    expect(files.every((p) => p.endsWith('.enc'))).toBe(true);
    for (const p of files) expect(await readFile(join(root, p), 'utf8')).not.toMatch(/Harbour|Boats everywhere|harbour\.png/);
  });

  it('backs up a desktop folder to a zip the website restores', async () => {
    const { journal: desktop } = await folderJournal();
    await importBackup(desktop, await exportBackup(await webJournal()), { mode: 'merge' });
    await desktop.saveEntry(desktop.newEntry({ date: '2026-10-09', title: 'Written on the desktop' }));

    const web = await Journal.open(new MemoryStore());
    const report = await importBackup(web, await exportBackup(desktop), { mode: 'replace' });
    expect(report).toMatchObject({ entriesAdded: 4, mediaAdded: 3, verified: true });
    expect((await web.listEntries()).map((e) => e.title).sort()).toEqual(['Harbour', 'Quiet day', 'Written on the desktop']);
    expect((await web.listTrash()).map((e) => e.title)).toEqual(['Draft']);
  });
});
