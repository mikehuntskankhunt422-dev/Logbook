import { strToU8, zipSync, type Zippable } from 'fflate';
import sharp from 'sharp';
import { BOOK_BUNDLE_FORMAT, BOOK_BUNDLE_VERSION, bookOptionsSchema, selectEntries, type BookBundle, type BookOptions, type Block, type Entry, type MediaMeta, type RichNode, GRADIENT_IDS, MOODS } from '@logbook/core';

/**
 * A deterministic sample journal for golden tests and the `samples/` PDFs: every block type, photos in
 * both orientations, galleries in both layouts, a low-resolution photo (to trigger a warning) and a
 * PNG with transparency (to prove it gets flattened).
 */
export interface SampleOptions {
  entries: number;
  seed?: number;
  book?: Partial<BookOptions>;
  /** Use a generated photo for the book cover. */
  photoCover?: boolean;
}

const WORDS =
  'morning light coffee walk harbour ferry market garden rain wind beach dinner friends laughed quiet late early train city river hills bread lemon book page letter garden dog park bicycle tram bridge sunset breakfast music radio kitchen window street cafe postcard island camp tent fire stars cold warm salt sand shell wave rock path trail forest fern moss creek school work home desk lamp chair sofa blanket tea biscuit storm cloud thunder puddle umbrella boots jacket scarf hat glove'.split(
    ' ',
  );

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s ^= this.s << 13;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5;
    return (this.s >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  sentence(): string {
    const n = this.int(6, 18);
    const w = Array.from({ length: n }, () => this.pick(WORDS));
    w[0] = w[0]![0]!.toUpperCase() + w[0]!.slice(1);
    return `${w.join(' ')}${this.pick(['.', '.', '.', '!', '?'])}`;
  }
  paragraph(): string {
    return Array.from({ length: this.int(2, 6) }, () => this.sentence()).join(' ');
  }
}

const COLORS = ['#ff5f6d', '#ffc371', '#00c6ff', '#0072ff', '#56ab2f', '#a8e063', '#8e2de2', '#f5af19', '#26d0ce', '#fd746c'];

async function photo(rng: Rng, w: number, h: number, format: 'jpeg' | 'png' = 'jpeg', alpha = false): Promise<Uint8Array> {
  const a = rng.pick(COLORS);
  const b = rng.pick(COLORS);
  const shapes = Array.from({ length: 6 }, () => {
    const r = rng.int(Math.min(w, h) / 12, Math.min(w, h) / 4);
    return `<circle cx="${rng.int(0, w)}" cy="${rng.int(0, h)}" r="${r}" fill="${rng.pick(COLORS)}"/>`;
  }).join('');
  const bg = alpha ? '' : `<rect width="${w}" height="${h}" fill="url(#g)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>${bg}${shapes}<rect x="${w * 0.05}" y="${h * 0.8}" width="${w * 0.5}" height="${h * 0.08}" fill="#ffffff"/></svg>`;
  const img = sharp(Buffer.from(svg));
  return new Uint8Array(format === 'png' ? await img.png().toBuffer() : await img.jpeg({ quality: 85 }).toBuffer());
}

function text(rng: Rng, extras: { link?: string } = {}): Block {
  const content: RichNode[] = [];
  if (rng.next() < 0.3) content.push({ type: 'heading', attrs: { level: rng.pick([2, 3]) }, content: [{ type: 'text', text: rng.sentence().replace(/[.!?]$/, '') }] });
  for (let i = rng.int(1, 4); i > 0; i--) {
    const p: RichNode[] = [{ type: 'text', text: `${rng.paragraph()} ` }];
    if (rng.next() < 0.25) p.push({ type: 'text', text: rng.pick(WORDS), marks: [{ type: rng.pick(['bold', 'italic', 'underline', 'strike']) }] }, { type: 'text', text: ` ${rng.sentence()}` });
    if (extras.link && i === 1) p.push({ type: 'text', text: ' More here', marks: [{ type: 'link', attrs: { href: extras.link } }] }, { type: 'text', text: '.' });
    content.push({ type: 'paragraph', content: p });
  }
  if (rng.next() < 0.2) content.push({ type: 'bulletList', content: Array.from({ length: rng.int(2, 4) }, () => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: rng.sentence() }] }] })) });
  if (rng.next() < 0.1) content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: rng.sentence() }] }] });
  return { id: `t${rng.int(0, 1e9)}`, type: 'text', doc: { type: 'doc', content } };
}

export async function sampleBundle(opts: SampleOptions): Promise<BookBundle> {
  const rng = new Rng(opts.seed ?? 42);
  const media = new Map<string, MediaMeta>();
  const files = new Map<string, Uint8Array>();
  let n = 0;
  const add = async (init: Partial<MediaMeta> & { mime: string; name: string }, bytes?: Uint8Array) => {
    const id = `m${String(++n).padStart(5, '0')}`;
    const meta: MediaMeta = { v: 1, id, bytes: bytes?.length ?? 1000, createdAt: '2026-01-01T00:00:00Z', ...init };
    media.set(id, meta);
    if (bytes) files.set(id, bytes);
    return meta;
  };
  // A pool of photos, reused across entries like a real camera roll would not be, but it keeps the sample small.
  const pool: MediaMeta[] = [];
  for (let i = 0; i < 10; i++) {
    const [w, h] = i % 3 === 2 ? [2000, 3000] : [3000, 2000];
    pool.push(await add({ name: `IMG_${1000 + i}.jpg`, mime: 'image/jpeg', width: w, height: h }, await photo(rng, w, h)));
  }
  const lowRes = await add({ name: 'old-scan.jpg', mime: 'image/jpeg', width: 600, height: 400 }, await photo(rng, 600, 400));
  const transparent = await add({ name: 'sticker.png', mime: 'image/png', width: 1200, height: 1200 }, await photo(rng, 1200, 1200, 'png', true));
  const poster = await add({ name: 'poster.jpg', mime: 'image/jpeg', width: 1920, height: 1080, derivedFrom: 'video' }, await photo(rng, 1920, 1080));
  const video = await add({ name: 'waves.mp4', mime: 'video/mp4', durationMs: 83_000, posterId: poster.id });
  const audio = await add({ name: 'voice-note.m4a', mime: 'audio/mp4', durationMs: 192_000 });
  const pdf = await add({ name: 'tickets.pdf', mime: 'application/pdf', bytes: 2_200_000 });

  const entries: Entry[] = [];
  const start = Date.UTC(2025, 2, 1);
  for (let i = 0; i < opts.entries; i++) {
    const date = new Date(start + i * 2.3 * 86_400_000).toISOString().slice(0, 10);
    const blocks: Block[] = [text(rng, i % 7 === 3 ? { link: `https://example.com/notes/${i}` } : {})];
    const kind = i % 10;
    if (kind === 1 || kind === 6) blocks.push({ id: `p${i}`, type: 'photo', mediaId: rng.pick(pool).id, caption: rng.next() < 0.6 ? rng.sentence() : '' });
    if (kind === 2) blocks.push({ id: `g${i}`, type: 'gallery', layout: 'grid', items: Array.from({ length: rng.int(2, 6) }, () => ({ mediaId: rng.pick(pool).id, caption: '' })), caption: rng.sentence() });
    if (kind === 4) blocks.push({ id: `c${i}`, type: 'gallery', layout: 'collage', items: Array.from({ length: rng.int(3, 7) }, () => ({ mediaId: rng.pick(pool).id, caption: rng.next() < 0.3 ? rng.pick(WORDS) : '' })), caption: '' });
    if (kind === 5) blocks.push({ id: `v${i}`, type: 'video', mediaId: video.id, caption: 'The sea, all afternoon.' });
    if (kind === 7) blocks.push({ id: `a${i}`, type: 'audio', mediaId: audio.id, caption: rng.sentence() }, { id: `f${i}`, type: 'file', mediaId: pdf.id, caption: '' });
    if (kind === 8) blocks.push({ id: `l${i}`, type: 'link', url: `https://www.example.org/places/${i}`, title: rng.next() < 0.5 ? 'A place we went' : '', caption: rng.sentence() });
    if (kind === 9) blocks.push({ id: `y${i}`, type: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A song for the drive', caption: '' });
    if (i === 3) blocks.push({ id: 'low', type: 'photo', mediaId: lowRes.id, caption: 'An old scan, too small for print.' });
    if (i === 5) blocks.push({ id: 'png', type: 'photo', mediaId: transparent.id, caption: 'A sticker with a transparent background.' });
    if (rng.next() < 0.5) blocks.push(text(rng));
    entries.push({
      v: 1,
      id: `e${String(i).padStart(4, '0')}`,
      date,
      title: rng.next() < 0.9 ? rng.sentence().split(' ').slice(0, rng.int(2, 6)).join(' ').replace(/[.!?]$/, '') : '',
      mood: rng.next() < 0.6 ? rng.pick(MOODS) : null,
      cover: i % 6 === 0 ? { kind: 'photo', mediaId: rng.pick(pool).id } : { kind: 'gradient', gradient: rng.pick(GRADIENT_IDS) },
      tags: rng.next() < 0.5 ? [rng.pick(['travel', 'family', 'home', 'food', 'walks'])] : [],
      blocks,
      createdAt: `${date}T09:00:00Z`,
      updatedAt: `${date}T09:00:00Z`,
      rev: 1,
      deletedAt: null,
    });
  }

  const options = bookOptionsSchema.parse({
    title: 'A Year of Small Things',
    subtitle: 'Notes, photos and the odd voice memo',
    author: 'Sam Rivers',
    ...(opts.photoCover ? { cover: { kind: 'photo', mediaId: pool[0]!.id } } : {}),
    ...opts.book,
  });
  return { options, entries: selectEntries(entries, options), media, files };
}

/** The zip the web app would upload for this bundle. */
export function bundleZip(b: BookBundle): Uint8Array {
  const files: Zippable = {};
  for (const [id, bytes] of b.files) files[`media/${id}`] = [bytes, { level: 0 }];
  files['book.json'] = strToU8(JSON.stringify({ format: BOOK_BUNDLE_FORMAT, version: BOOK_BUNDLE_VERSION, options: b.options, entries: b.entries, media: [...b.media.values()] }));
  return zipSync(files);
}
