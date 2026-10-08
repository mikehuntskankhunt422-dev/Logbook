import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Journal } from '../src/journal.ts';
import { MemoryStore } from '../src/storage.ts';
import { emptyDoc } from '../src/richtext.ts';
import { BUNDLE_LIMITS, BookBundleError, bookOptionsSchema, buildBookBundle, readBookBundle } from '../src/print/index.ts';
import { pngBytes } from './helpers.ts';

async function journalWithMedia() {
  const journal = await Journal.open(new MemoryStore());
  const png = (name: string) => journal.addMedia(new Blob([pngBytes()], { type: 'image/png' }), { name, width: 1, height: 1 });
  const photo = await png('photo.png');
  const cover = await png('cover.png');
  const poster = await png('poster.png');
  const unused = await png('unused.png');
  const video = await journal.addMedia(new Blob([new Uint8Array(100)], { type: 'video/mp4' }), { name: 'clip.mp4', durationMs: 4000 });
  await journal.updateMediaMeta({ ...video, posterId: poster.id });
  const audio = await journal.addMedia(new Blob([new Uint8Array(50)], { type: 'audio/mpeg' }), { name: 'voice.mp3' });

  const inBook = journal.newEntry({
    date: '2026-05-01',
    title: 'In the book',
    tags: ['trip'],
    blocks: [
      { id: 'a', type: 'text', doc: emptyDoc('hello') },
      { id: 'b', type: 'photo', mediaId: photo.id, caption: '' },
      { id: 'c', type: 'video', mediaId: video.id, caption: '' },
      { id: 'd', type: 'audio', mediaId: audio.id, caption: '' },
    ],
  });
  await journal.saveEntry(inBook);
  await journal.saveEntry(journal.newEntry({ date: '2026-05-02', title: 'Not tagged', blocks: [{ id: 'x', type: 'photo', mediaId: unused.id, caption: '' }] }));
  return { journal, ids: { photo: photo.id, cover: cover.id, poster: poster.id, unused: unused.id, video: video.id, audio: audio.id } };
}

describe('book bundle', () => {
  it('round-trips the selected entries and only the images that print', async () => {
    const { journal, ids } = await journalWithMedia();
    const options = bookOptionsSchema.parse({ title: 'Trip', tags: ['trip'], cover: { kind: 'photo', mediaId: ids.cover } });
    const blob = await buildBookBundle(journal, options);
    const bundle = readBookBundle(new Uint8Array(await blob.arrayBuffer()));

    expect(bundle.options.title).toBe('Trip');
    expect(bundle.entries.map((e) => e.title)).toEqual(['In the book']);
    expect([...bundle.files.keys()].sort()).toEqual([ids.photo, ids.cover, ids.poster].sort());
    // Video and audio travel as metadata only; their bytes stay on the device.
    expect(bundle.media.get(ids.video)?.name).toBe('clip.mp4');
    expect(bundle.media.get(ids.audio)?.name).toBe('voice.mp3');
    expect(bundle.media.has(ids.unused)).toBe(false);
    expect(bundle.files.get(ids.photo)).toEqual(pngBytes());
  });

  it('rejects junk, a missing manifest and invalid options', () => {
    expect(() => readBookBundle(new Uint8Array([1, 2, 3]))).toThrow(BookBundleError);
    expect(() => readBookBundle(zipSync({ 'other.txt': strToU8('x') }))).toThrow(/no book\.json/);
    const bad = { format: 'logbook-book', version: 1, options: { title: '' }, entries: [], media: [] };
    expect(() => readBookBundle(zipSync({ 'book.json': strToU8(JSON.stringify(bad)) }))).toThrow(/book\.json is invalid/);
  });

  it('ignores unexpected paths instead of trusting them', () => {
    const manifest = { format: 'logbook-book', version: 1, options: { title: 'T' }, entries: [], media: [] };
    const b = readBookBundle(zipSync({ 'book.json': strToU8(JSON.stringify(manifest)), '../evil': strToU8('x'), 'media/unknown': strToU8('x') }));
    expect(b.files.size).toBe(0);
  });

  it('stops at the size limit (zip bombs)', () => {
    const saved = BUNDLE_LIMITS.maxBytes;
    BUNDLE_LIMITS.maxBytes = 1000;
    try {
      const zip = zipSync({ 'book.json': strToU8('{}'), 'media/a': new Uint8Array(5000) });
      expect(() => readBookBundle(zip)).toThrow(/too large/);
    } finally {
      BUNDLE_LIMITS.maxBytes = saved;
    }
  });
});
