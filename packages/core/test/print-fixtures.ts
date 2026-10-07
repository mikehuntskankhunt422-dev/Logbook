import { emptyDoc } from '../src/richtext.ts';
import { entrySchema, mediaMetaSchema, type Block, type Entry, type MediaMeta } from '../src/model.ts';
import type { PrintAssets } from '../src/print/blocks-html.ts';

let seq = 0;

export function entry(init: Partial<Entry> & { date: string }): Entry {
  seq++;
  return entrySchema.parse({
    id: `e${String(seq).padStart(4, '0')}`,
    title: '',
    cover: { kind: 'gradient', gradient: 'sunrise' },
    blocks: [{ id: `b${seq}`, type: 'text', doc: emptyDoc('Hello') }],
    createdAt: `${init.date}T09:00:00.000Z`,
    updatedAt: `${init.date}T09:00:00.000Z`,
    rev: 1,
    ...init,
  });
}

export function media(id: string, init: Partial<MediaMeta> = {}): MediaMeta {
  return mediaMetaSchema.parse({ id, name: `${id}.jpg`, mime: 'image/jpeg', bytes: 1000, width: 3000, height: 2000, createdAt: '2026-01-01T00:00:00.000Z', ...init });
}

/** A media table with one of everything the print layout handles. */
export function mediaTable(): Map<string, MediaMeta> {
  const list = [
    media('photo1'),
    media('portrait', { width: 1500, height: 2000 }),
    media('tiny', { name: 'IMG_0042.jpg', width: 640, height: 480 }),
    media('nodims', { name: 'old.png', mime: 'image/png', width: undefined, height: undefined }),
    media('g1'),
    media('g2'),
    media('g3'),
    media('vid', { name: 'surf.mp4', mime: 'video/mp4', bytes: 90_000_000, width: 1920, height: 1080, durationMs: 83_000, posterId: 'vidposter' }),
    media('vidposter', { name: 'surf.mp4.poster.jpg', width: 1920, height: 1080, derivedFrom: 'vid' }),
    media('aud', { name: 'birds.m4a', mime: 'audio/mp4', bytes: 2_000_000, width: undefined, height: undefined, durationMs: 65_000 }),
    media('doc', { name: 'tickets.pdf', mime: 'application/pdf', bytes: 250_000, width: undefined, height: undefined }),
  ];
  return new Map(list.map((m) => [m.id, m]));
}

export function everyBlock(): Block[] {
  return [
    {
      id: 't1',
      type: 'text',
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Beach <day>' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Swam at ' },
              { type: 'text', text: 'Glenelg', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/glenelg' } }] },
              { type: 'text', text: ' beach', marks: [{ type: 'link', attrs: { href: 'https://example.com/glenelg' } }] },
              { type: 'text', text: ' & ate chips.' },
            ],
          },
        ],
      },
    },
    { id: 'p1', type: 'photo', mediaId: 'photo1', caption: 'Sunset "golden" hour' },
    { id: 'g', type: 'gallery', layout: 'grid', items: [{ mediaId: 'g1', caption: '' }, { mediaId: 'g2', caption: 'Pier' }, { mediaId: 'g3', caption: '' }], caption: '' },
    { id: 'c', type: 'gallery', layout: 'collage', items: [{ mediaId: 'photo1', caption: '' }, { mediaId: 'tiny', caption: '' }], caption: 'Collage' },
    { id: 'v', type: 'video', mediaId: 'vid', caption: 'Waves' },
    { id: 'a', type: 'audio', mediaId: 'aud', caption: '' },
    { id: 'f', type: 'file', mediaId: 'doc', caption: '' },
    { id: 'l', type: 'link', url: 'https://www.example.org/a/long/path/', title: 'Tide times', caption: '' },
    { id: 'y', type: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Clip', caption: '' },
  ];
}

export const thumbAssets: PrintAssets = { imageUrl: (id) => `thumb/${id}.jpg` };
