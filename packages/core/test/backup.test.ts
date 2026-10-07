import { describe, expect, it } from 'vitest';
import { Unzip, UnzipInflate, Zip, ZipPassThrough, strToU8 } from 'fflate';
import { BackupError, PasscodeRequiredError, exportBackup, importBackup, inspectBackup } from '../src/backup.ts';
import { WrongPasscodeError } from '../src/crypto.ts';
import { Journal } from '../src/journal.ts';
import { emptyDoc } from '../src/richtext.ts';
import { MemoryStore } from '../src/storage.ts';
import { SearchIndex } from '../src/search.ts';
import { FAST_KDF, pngBytes } from './helpers.ts';

async function seeded() {
  const journal = await Journal.open(new MemoryStore());
  const photo = await journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name: 'beach.png', width: 1, height: 1 });
  const e = await journal.saveEntry(
    journal.newEntry({
      date: '2026-10-07',
      title: 'A good day',
      mood: '😄',
      tags: ['beach'],
      blocks: [
        { id: 't', type: 'text', doc: emptyDoc('Swam at Glenelg') },
        { id: 'p', type: 'photo', mediaId: photo.id, caption: 'Sunset' },
      ],
    }),
  );
  const trashed = await journal.saveEntry(journal.newEntry({ date: '2026-09-01', title: 'Draft' }));
  await journal.trashEntry(trashed.id);
  return { journal, photo, entry: e };
}

async function listZip(blob: Blob): Promise<string[]> {
  const names: string[] = [];
  const unzip = new Unzip((f) => names.push(f.name));
  unzip.register(UnzipInflate);
  unzip.push(new Uint8Array(await blob.arrayBuffer()), true);
  return names;
}

describe('backup export/import', () => {
  it('round-trips a plaintext journal, including trash and media bytes', async () => {
    const { journal, photo, entry } = await seeded();
    const zip = await exportBackup(journal);
    const names = await listZip(zip);
    expect(names).toContain('manifest.json');
    expect(names).toContain(`entries/2026/2026-10-07--a-good-day--${entry.id}.json`);
    expect(names.some((n) => n.startsWith('trash/2026/2026-09-01--draft--'))).toBe(true);
    expect(names).toContain(`media/${photo.id.slice(0, 2)}/${photo.id}.png`);

    const target = await Journal.open(new MemoryStore());
    const report = await importBackup(target, zip, { mode: 'merge' });
    expect(report).toMatchObject({ entriesAdded: 2, mediaAdded: 1, verified: true, problems: [] });
    const restored = (await target.listEntries())[0]!;
    expect(restored).toEqual(entry);
    expect(await target.listTrash()).toHaveLength(1);
    expect(new Uint8Array(await (await target.getMediaBlob(photo.id))!.arrayBuffer())).toEqual(pngBytes());
  });

  it('merge keeps the newer copy of each entry', async () => {
    const { journal, entry } = await seeded();
    const zip = await exportBackup(journal);
    const edited = await journal.saveEntry({ ...entry, title: 'Edited after backup' });
    const report = await importBackup(journal, zip, { mode: 'merge' });
    expect(report.entriesUnchanged).toBe(2);
    expect((await journal.getEntry(entry.id))?.title).toBe(edited.title);
  });

  it('replace empties the journal first', async () => {
    const { journal } = await seeded();
    const zip = await exportBackup(journal);
    await journal.saveEntry(journal.newEntry({ title: 'not in backup' }));
    await importBackup(journal, zip, { mode: 'replace' });
    expect((await journal.listEntries()).map((e) => e.title)).toEqual(['A good day']);
  });

  it('exports an encrypted journal as ciphertext that needs the passcode to restore', async () => {
    const { journal } = await seeded();
    await journal.enableEncryption('backup-pass', FAST_KDF);
    const zip = await exportBackup(journal, { keepEncrypted: true });
    const bytes = new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()));
    expect(bytes).not.toContain('Glenelg');
    expect(bytes).not.toContain('a-good-day');
    expect((await inspectBackup(zip)).encrypted).toBe(true);

    const target = await Journal.open(new MemoryStore());
    await expect(importBackup(target, zip, { mode: 'merge' })).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(importBackup(target, zip, { mode: 'merge', passcode: 'nope-nope' })).rejects.toBeInstanceOf(WrongPasscodeError);
    const report = await importBackup(target, zip, { mode: 'merge', passcode: 'backup-pass' });
    expect(report.entriesAdded).toBe(2);
    expect((await target.listEntries())[0]?.title).toBe('A good day');
    expect(target.isEncrypted).toBe(false); // data re-saved under the target's own (no) passcode
  });

  it('rejects a tampered backup', async () => {
    const { journal } = await seeded();
    const zip = await exportBackup(journal);
    // Rebuild the zip with one entry file altered but the original manifest kept.
    const files = new Map<string, Uint8Array>();
    const unzip = new Unzip((f) => {
      const chunks: Uint8Array[] = [];
      f.ondata = (_e, d, final) => {
        chunks.push(d);
        if (final) files.set(f.name, new Uint8Array(chunks.flatMap((c) => [...c])));
      };
      f.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(new Uint8Array(await zip.arrayBuffer()), true);
    const parts: Uint8Array[] = [];
    const z = new Zip((_e, d) => parts.push(d));
    for (const [name, data] of files) {
      const f = new ZipPassThrough(name);
      z.add(f);
      f.push(name.startsWith('entries/') ? strToU8(new TextDecoder().decode(data).replace('Glenelg', 'Henley')) : data, true);
    }
    z.end();
    await expect(importBackup(await Journal.open(new MemoryStore()), new Blob(parts as BlobPart[]), { mode: 'merge' })).rejects.toBeInstanceOf(BackupError);
  });

  it('rejects files that are not zips', async () => {
    await expect(importBackup(await Journal.open(new MemoryStore()), new Blob(['hello']), { mode: 'merge' })).rejects.toBeInstanceOf(BackupError);
  });
});

describe('search', () => {
  it('finds entries by title, body, caption and tag with prefix matching', async () => {
    const { journal } = await seeded();
    const idx = new SearchIndex();
    idx.rebuild([...(await journal.listEntries()), ...(await journal.listTrash())]);
    expect(idx.search('glen').map((h) => h.id)).toHaveLength(1);
    expect(idx.search('sunset')).toHaveLength(1);
    expect(idx.search('beach')).toHaveLength(1);
    expect(idx.search('draft')).toHaveLength(0); // trashed entries are not indexed
    expect(idx.search('')).toEqual([]);
  });
});
