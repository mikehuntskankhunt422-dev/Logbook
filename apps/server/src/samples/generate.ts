import sharp from 'sharp';
import {
  GRADIENT_IDS,
  MOODS,
  bookOptionsSchema,
  entrySchema,
  mediaMetaSchema,
  type Block,
  type BookOptions,
  type Entry,
  type MediaMeta,
  type Product,
  type RichNode,
} from '@logbook/core';

export const SAMPLE_KINDS = { '40-page': { entries: 12, months: 3 }, '200-page': { entries: 64, months: 12 } } as const;
export type SampleKind = keyof typeof SAMPLE_KINDS;

export interface Sample {
  kind: SampleKind;
  options: BookOptions;
  entries: Entry[];
  media: Map<string, MediaMeta>;
  /** Original image bytes, as a journal would hold them. */
  files: Map<string, Buffer>;
  audioPeaks: Record<string, number[]>;
}

/** Small deterministic PRNG (mulberry32) so every run produces byte-identical journals. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

const WORDS =
  'morning harbour coffee walk esplanade dog gulls tide jetty breeze salt kelp sunlight bakery market friends laughter train window rain umbrella library garden tomatoes basil kitchen bread oven music radio evening lamp book chapter letter postcard bicycle hill lookout clouds horizon swim towel sandcastle shells pelican ferry island picnic thermos scarf jumper fireplace stars moon quiet notebook pencil sketch'.split(
    ' ',
  );

const PALETTE = ['#c96f53', '#4a7c8c', '#8aa05a', '#d9b44a', '#6b5b95', '#2f5d62', '#e07a5f', '#3d405b'];

/** A photo-like test image: gradient sky, a sun, hills. Rasterised by sharp, so the PDF sees a real bitmap. */
async function photo(r: ReturnType<typeof rng>, width: number, height: number, opts: { alpha?: boolean; format?: 'jpeg' | 'png'; orientation?: number } = {}): Promise<Buffer> {
  const [a, b, c] = [r.pick(PALETTE), r.pick(PALETTE), r.pick(PALETTE)];
  const hill = (y: number, amp: number, fill: string) => `<path fill="${fill}" d="M0 ${y} Q ${width * 0.3} ${y - amp} ${width * 0.6} ${y} T ${width} ${y} V ${height} H 0 Z"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#f4ead8"/></linearGradient></defs>
    ${opts.alpha ? '' : `<rect width="${width}" height="${height}" fill="url(#g)"/>`}
    <circle cx="${width * r.next()}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.12}" fill="#fff4d6"/>
    ${hill(height * 0.7, height * 0.15, b)}${hill(height * 0.82, height * 0.1, c)}
  </svg>`;
  const img = sharp(Buffer.from(svg));
  if (opts.format === 'png') return img.png().toBuffer();
  // EXIF orientation 6 = "rotate 90° clockwise to display": draw the upright picture, store it turned
  // 90° anticlockwise, and tag it. The app records the displayed dimensions, as browsers report them.
  const jpeg = img.jpeg({ quality: 85 });
  return opts.orientation ? sharp(await jpeg.toBuffer()).rotate(-90).withMetadata({ orientation: opts.orientation }).jpeg({ quality: 85 }).toBuffer() : jpeg.toBuffer();
}

function sentence(r: ReturnType<typeof rng>, words: number): string {
  const w = Array.from({ length: words }, () => r.pick(WORDS));
  return `${w[0]![0]!.toUpperCase()}${w.join(' ').slice(1)}.`;
}

function paragraph(r: ReturnType<typeof rng>, sentences: number): string {
  return Array.from({ length: sentences }, () => sentence(r, r.int(8, 18))).join(' ');
}

function textBlock(r: ReturnType<typeof rng>, id: string, i: number): Block {
  const content: RichNode[] = [];
  const paras = r.int(2, 5);
  for (let p = 0; p < paras; p++) content.push({ type: 'paragraph', content: [{ type: 'text', text: paragraph(r, r.int(3, 7)) }] });
  if (i % 3 === 0) {
    content.splice(1, 0, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: sentence(r, 3).slice(0, -1) }] });
    content.push({ type: 'bulletList', content: [1, 2, 3].map(() => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence(r, 5) }] }] })) });
    content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence(r, 12), marks: [{ type: 'italic' }] }] }] });
  }
  if (i % 5 === 0) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'We booked through ' },
        { type: 'text', text: 'the ferry office', marks: [{ type: 'link', attrs: { href: 'https://www.example.com/ferry/timetable' } }] },
        { type: 'text', text: ' and checked ' },
        { type: 'text', text: 'www.example.org', marks: [{ type: 'link', attrs: { href: 'https://www.example.org/' } }] },
        { type: 'text', text: ' twice. 🌊 ' },
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'Supercalifragilisticexpialidociousandthensomemoreletterswithoutanybreak.' },
      ],
    });
  }
  return { id, type: 'text', doc: { type: 'doc', content } };
}

/**
 * A deterministic sample journal that uses every block type, plus the cases print must survive:
 * a low-resolution photo, a PNG with transparency, an EXIF-rotated JPEG, emoji in text, a long word.
 */
export async function generateSample(kind: SampleKind, product: Product): Promise<Sample> {
  const spec = SAMPLE_KINDS[kind];
  const r = rng(kind === '40-page' ? 40 : 200);
  const media = new Map<string, MediaMeta>();
  const files = new Map<string, Buffer>();
  const audioPeaks: Record<string, number[]> = {};
  let n = 0;
  const addImage = async (width: number, height: number, opts: Parameters<typeof photo>[3] & { name?: string } = {}) => {
    const id = `img${String(++n).padStart(3, '0')}`;
    const bytes = await photo(r, width, height, opts);
    files.set(id, bytes);
    const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    media.set(id, mediaMetaSchema.parse({ id, name: opts.name ?? `IMG_${1000 + n}.${opts.format === 'png' ? 'png' : 'jpg'}`, mime, bytes: bytes.length, width, height, createdAt: '2026-01-01T00:00:00.000Z' }));
    return id;
  };
  const addMeta = (m: Partial<MediaMeta> & Pick<MediaMeta, 'id' | 'name' | 'mime' | 'bytes'>) => {
    const meta = mediaMetaSchema.parse({ ...m, createdAt: '2026-01-01T00:00:00.000Z' });
    media.set(meta.id, meta);
    return meta.id;
  };
  const sizes: [number, number][] = [
    [3000, 2000],
    [2000, 3000],
    [4000, 3000],
    [2400, 2400],
  ];

  const entries: Entry[] = [];
  for (let i = 0; i < spec.entries; i++) {
    const month = 1 + Math.floor((i * spec.months) / spec.entries);
    const day = 1 + ((i * 7) % 27);
    const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const blocks: Block[] = [textBlock(r, `t${i}`, i)];
    if (i % 2 === 0) {
      const [w, h] = r.pick(sizes);
      blocks.push({ id: `p${i}`, type: 'photo', mediaId: await addImage(w, h), caption: i % 4 === 0 ? sentence(r, 6) : '' });
    }
    if (i === 1) blocks.push({ id: 'lowres', type: 'photo', mediaId: await addImage(640, 480, { name: 'old-phone-photo.jpg' }), caption: 'An old phone photo (prints below 300 PPI)' });
    if (i === 2) blocks.push({ id: 'alpha', type: 'photo', mediaId: await addImage(1600, 1200, { format: 'png', alpha: true, name: 'sticker.png' }), caption: 'A PNG with transparency, flattened for print' });
    if (i === 3) blocks.push({ id: 'rotated', type: 'photo', mediaId: await addImage(2000, 3000, { orientation: 6, name: 'rotated.jpg' }), caption: 'Stored sideways with an EXIF rotation' });
    if (i % 4 === 1) {
      const count = r.int(3, 6);
      const items = [];
      for (let k = 0; k < count; k++) items.push({ mediaId: await addImage(...r.pick(sizes)), caption: k === 1 ? sentence(r, 3) : '' });
      blocks.push({ id: `g${i}`, type: 'gallery', layout: i % 8 === 1 ? 'collage' : 'grid', items, caption: sentence(r, 5) });
    }
    if (i % 5 === 2) {
      const poster = await addImage(1920, 1080, { name: `clip${i}.mp4.poster.jpg` });
      const vid = addMeta({ id: `vid${i}`, name: `clip${i}.mp4`, mime: 'video/mp4', bytes: 48_000_000, width: 1920, height: 1080, durationMs: 20_000 + i * 3_000, posterId: poster });
      media.set(poster, { ...media.get(poster)!, derivedFrom: vid });
      blocks.push({ id: `v${i}`, type: 'video', mediaId: vid, caption: sentence(r, 4) });
    }
    if (i % 6 === 3) {
      const aud = addMeta({ id: `aud${i}`, name: `voice-note-${i}.m4a`, mime: 'audio/mp4', bytes: 900_000, durationMs: 45_000 + i * 1000 });
      if (i % 12 === 3) audioPeaks[aud] = Array.from({ length: 200 }, (_, k) => Math.abs(Math.sin(k / 7)) * (0.4 + 0.6 * r.next()));
      blocks.push({ id: `a${i}`, type: 'audio', mediaId: aud, caption: '' });
    }
    if (i % 7 === 4) blocks.push({ id: `f${i}`, type: 'file', mediaId: addMeta({ id: `doc${i}`, name: `boarding-pass-${i}.pdf`, mime: 'application/pdf', bytes: 180_000 + i }), caption: '' });
    if (i % 6 === 5) blocks.push({ id: `l${i}`, type: 'link', url: `https://www.example.com/places/${i}/a-rather-long-path-to-wrap`, title: sentence(r, 3).slice(0, -1), caption: sentence(r, 6) });
    if (i % 10 === 6) blocks.push({ id: `y${i}`, type: 'embed', provider: i % 20 === 6 ? 'youtube' : 'vimeo', videoId: i % 20 === 6 ? 'dQw4w9WgXcQ' : '76979871', url: i % 20 === 6 ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://vimeo.com/76979871', title: sentence(r, 4).slice(0, -1), caption: '' });
    if (i > 0 && i % 2 === 1) blocks.push(textBlock(r, `t${i}b`, i + 1));

    const cover = i % 5 === 4 ? { kind: 'photo' as const, mediaId: await addImage(3000, 2000) } : { kind: 'gradient' as const, gradient: GRADIENT_IDS[i % GRADIENT_IDS.length]! };
    entries.push(
      entrySchema.parse({
        id: `${kind}-e${String(i).padStart(3, '0')}`,
        date,
        title: i % 6 === 0 ? '' : sentence(r, r.int(2, 5)).slice(0, -1),
        mood: i % 3 === 2 ? null : MOODS[i % MOODS.length],
        cover,
        tags: i % 3 === 0 ? ['seaside'] : i % 3 === 1 ? ['family', 'weekend'] : [],
        blocks,
        createdAt: `${date}T08:00:00.000Z`,
        updatedAt: `${date}T08:00:00.000Z`,
        rev: 1,
      }),
    );
  }

  const options = bookOptionsSchema.parse({
    title: kind === '40-page' ? 'A Season by the Sea' : 'Our Year in Pages',
    subtitle: `Logbook ${kind} sample`,
    author: 'The Logbook team',
    backText: 'A generated sample journal used to test print files. Every block type appears at least once.',
    selection: { kind: 'range', from: '2026-01-01', to: '2026-12-31' },
    product,
    cover: { kind: 'photo', mediaId: await addImage(2400, 3600, { name: 'cover.jpg' }) },
  });
  return { kind, options, entries, media, files, audioPeaks };
}
