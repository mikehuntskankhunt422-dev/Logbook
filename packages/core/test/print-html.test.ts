import { describe, expect, it } from 'vitest';
import {
  bookOptionsSchema,
  coverDocument,
  dateRangeLabel,
  estimateCoverDimensions,
  formatPrintDate,
  grayscaleGradient,
  interiorDocument,
  interiorGeometry,
  qrSvg,
  resampleTargets,
  richHtml,
  selectEntries,
  shortUrl,
  standaloneHtml,
  type Block,
  type BookOptions,
  type Entry,
  type MediaMeta,
} from '../src/index.ts';

let seq = 0;
function entry(init: Partial<Entry> = {}): Entry {
  seq++;
  return {
    v: 1,
    id: `e${seq}`,
    date: '2026-10-07',
    title: `Entry ${seq}`,
    mood: null,
    cover: { kind: 'gradient', gradient: 'sunrise' },
    tags: [],
    blocks: [],
    createdAt: `2026-10-07T10:00:${String(seq % 60).padStart(2, '0')}Z`,
    updatedAt: '2026-10-07T10:00:00Z',
    rev: 1,
    deletedAt: null,
    ...init,
  };
}

function media(id: string, init: Partial<MediaMeta> = {}): MediaMeta {
  return { v: 1, id, name: `${id}.jpg`, mime: 'image/jpeg', bytes: 1000, width: 4000, height: 3000, createdAt: '2026-10-07T10:00:00Z', ...init };
}

const options = (o: Partial<BookOptions> = {}) => bookOptionsSchema.parse({ title: 'Our year', ...o });
const text = (s: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): Block => ({
  id: 'b',
  type: 'text',
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s, ...(marks ? { marks } : {}) }] }] },
});

function render(entries: Entry[], mediaList: MediaMeta[] = [], o: Partial<BookOptions> = {}, missing: string[] = []) {
  const map = new Map(mediaList.map((m) => [m.id, m]));
  return interiorDocument({
    options: options(o),
    entries,
    media: map,
    mediaUrl: (id) => (missing.includes(id) ? null : `media/${id}`),
    gutterIn: 0,
    notesPages: 0,
  });
}

describe('selectEntries', () => {
  const a = entry({ date: '2026-01-05', tags: ['trip'] });
  const b = entry({ date: '2025-12-31' });
  const c = entry({ date: '2026-02-01', tags: ['home'] });
  const d = entry({ date: '2026-01-10', deletedAt: '2026-03-01T00:00:00Z' });

  it('drops deleted entries and sorts oldest first', () => {
    expect(selectEntries([a, b, c, d], options()).map((e) => e.id)).toEqual([b.id, a.id, c.id]);
  });

  it('filters by inclusive date range, tags and exclusions', () => {
    expect(selectEntries([a, b, c], options({ from: '2026-01-05', to: '2026-02-01' })).map((e) => e.id)).toEqual([a.id, c.id]);
    expect(selectEntries([a, b, c], options({ tags: ['trip', 'home'] })).map((e) => e.id)).toEqual([a.id, c.id]);
    expect(selectEntries([a, b, c], options({ excludeIds: [a.id] })).map((e) => e.id)).toEqual([b.id, c.id]);
  });
});

describe('dates', () => {
  it('formats the calendar date regardless of the renderer’s time zone', () => {
    expect(formatPrintDate('2026-01-01', 'en-AU')).toBe('Thursday 1 January 2026');
    expect(formatPrintDate('2026-01-01', 'en-US')).toBe('Thursday, January 1, 2026');
  });

  it('falls back to en-AU for a locale Intl rejects', () => {
    expect(formatPrintDate('2026-01-01', 'not a locale!')).toBe('Thursday 1 January 2026');
  });

  it('labels a date range', () => {
    expect(dateRangeLabel([{ date: '2026-10-01' }, { date: '2025-03-04' }], 'en-AU')).toBe('March 2025 – October 2026');
    expect(dateRangeLabel([{ date: '2026-10-01' }, { date: '2026-10-30' }], 'en-AU')).toBe('October 2026');
    expect(dateRangeLabel([], 'en-AU')).toBe('');
  });
});

describe('interior HTML', () => {
  it('has a title page, verso, contents and one article per entry', () => {
    const doc = render([entry({ title: 'First' }), entry({ title: '' })], [], { subtitle: 'Notes from home', author: 'Sam' });
    expect(doc.html).toContain('<h1 class="book-title">Our year</h1>');
    expect(doc.html).toContain('Notes from home');
    expect(doc.html.match(/<article class="entry"/g)).toHaveLength(2);
    expect(doc.html).toContain('<span class="toc-title">Untitled</span>');
    expect(doc.html).toMatch(/href="#e-e\d+"/);
  });

  it('omits contents when switched off', () => {
    expect(render([entry()], [], { contents: false }).html).not.toContain('class="front toc"');
  });

  it('appends the planned number of notes pages', () => {
    const doc = interiorDocument({ options: options(), entries: [entry()], media: new Map(), mediaUrl: () => null, gutterIn: 0, notesPages: 3 });
    expect(doc.html.match(/class="notes-page"/g)).toHaveLength(3);
  });

  it('escapes everything the user typed', () => {
    const doc = render([entry({ title: '<script>alert(1)</script>', tags: ['a"b'], blocks: [text('1 < 2 & "x"')] })], [], { title: 'T & <b>' });
    expect(doc.html).not.toContain('<script>');
    expect(doc.html).toContain('&lt;script&gt;');
    expect(doc.html).toContain('1 &lt; 2 &amp; &quot;x&quot;');
    expect(doc.html).toContain('T &amp; &lt;b&gt;');
    expect(doc.html).toContain('#a&quot;b');
  });

  it('turns inline links into numbered notes with QR codes, one per distinct URL', () => {
    const link = (href: string) => [{ type: 'link', attrs: { href } }];
    const block: Block = {
      id: 'b',
      type: 'text',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'See ' },
              { type: 'text', text: 'this', marks: link('https://example.com/a') },
              { type: 'text', text: ' bold', marks: [...link('https://example.com/a'), { type: 'bold' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'that', marks: link('https://www.example.org/') },
              { type: 'text', text: ' again', marks: link('https://example.com/a') },
            ],
          },
        ],
      },
    };
    const doc = render([entry({ blocks: [block] })]);
    // Adjacent text runs with the same link share one superscript.
    expect(doc.html).toContain('<span class="ilink">this<strong> bold</strong></span><sup class="link-ref">1</sup>');
    expect(doc.html).toContain('<span class="ilink">that</span><sup class="link-ref">2</sup>');
    expect(doc.html).toContain('<span class="ilink"> again</span><sup class="link-ref">1</sup>');
    expect(doc.html.match(/<li><svg class="qr"/g)).toHaveLength(2);
    expect(doc.html).toContain('<span class="note-url">example.org</span>');
  });

  it('renders every editor node and mark', () => {
    const html = richHtml({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'h' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q', marks: [{ type: 'italic' }, { type: 'strike' }, { type: 'underline' }] }] }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
        { type: 'mysteryNode', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }] },
      ],
    });
    expect(html).toBe(
      '<h3>H</h3><h4>h</h4><ul><li><p>one</p></li></ul><ol start="3"><li><p>&#8203;</p></li></ol>' +
        '<blockquote><p><u><s><em>q</em></s></u></p></blockquote><hr><p>a<br>b</p><p>kept</p>',
    );
  });

  it('prints link and embed blocks as cards with QR codes', () => {
    const doc = render([
      entry({
        blocks: [
          { id: 'l', type: 'link', url: 'https://www.example.com/some/long/path/', title: '', caption: 'Worth a read' },
          { id: 'm', type: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A song', caption: '' },
        ],
      }),
    ]);
    expect(doc.html).toContain('<p class="card-title">example.com</p><p class="card-url">example.com/some/long/path</p>');
    expect(doc.html).toContain('<p class="kicker">YouTube video</p><p class="card-title">A song</p>');
    expect(doc.html.match(/<svg class="qr"/g)).toHaveLength(2);
  });

  it('prints video as its poster frame with duration, and audio and files as cards', () => {
    const doc = render(
      [
        entry({
          blocks: [
            { id: 'v', type: 'video', mediaId: 'vid', caption: 'Waves' },
            { id: 'v2', type: 'video', mediaId: 'vid2', caption: '' },
            { id: 'a', type: 'audio', mediaId: 'aud', caption: '' },
            { id: 'f', type: 'file', mediaId: 'doc', caption: '' },
          ],
        }),
      ],
      [
        media('vid', { mime: 'video/mp4', name: 'beach.mp4', durationMs: 83_000, posterId: 'poster' }),
        media('poster', { width: 1920, height: 1080 }),
        media('vid2', { mime: 'video/mp4', name: 'no-poster.mp4' }),
        media('aud', { mime: 'audio/mpeg', name: 'voice.mp3', durationMs: 192_000 }),
        media('doc', { mime: 'application/pdf', name: 'tickets.pdf', bytes: 2_200_000 }),
      ],
    );
    expect(doc.html).toMatch(/<img src="media\/poster"[^>]*>.*1:23<\/span>/);
    expect(doc.html).toContain('<p class="card-title">no-poster.mp4</p>');
    expect(doc.html).toContain('<p class="kicker">Audio · 3:12</p>');
    expect(doc.html).toContain('<span class="file-name">tickets.pdf</span><span class="file-size">2.1 MB</span>');
    expect(doc.html).not.toContain('media/vid"');
  });
});

describe('images and warnings', () => {
  it('sizes photos to fit the text block with their aspect ratio', () => {
    const doc = render([entry({ blocks: [{ id: 'p', type: 'photo', mediaId: 'wide', caption: '' }, { id: 'q', type: 'photo', mediaId: 'tall', caption: '' }] })], [media('wide'), media('tall', { width: 3000, height: 4000 })]);
    const geo = interiorGeometry('6x9', 0);
    const [wide, tall] = doc.images;
    expect(wide!.widthIn).toBeLessThanOrEqual(geo.textWidthIn);
    expect(wide!.widthIn / wide!.heightIn).toBeCloseTo(4 / 3, 2);
    expect(tall!.heightIn).toBeLessThanOrEqual(geo.textHeightIn * 0.62);
    expect(tall!.widthIn / tall!.heightIn).toBeCloseTo(3 / 4, 2);
  });

  it('keeps every gallery row inside the text width', () => {
    for (const layout of ['grid', 'collage'] as const) {
      const items = Array.from({ length: 7 }, (_, i) => ({ mediaId: `g${i}`, caption: '' }));
      const doc = render([entry({ blocks: [{ id: 'g', type: 'gallery', layout, items, caption: '' }] })], items.map((i) => media(i.mediaId)), { product: { trim: '8.5x11', interior: 'color', binding: 'paperback', finish: 'matte' } });
      const geo = interiorGeometry('8.5x11', 0);
      const rows = [...doc.html.matchAll(/<div class="g-row">(.*?)<\/div><\/div>(?=<div class="g-row">|<\/figure>|$)/g)];
      expect(rows.length).toBeGreaterThan(1);
      const widths = [...doc.html.matchAll(/class="g-cell" style="width:([\d.]+)in"/g)].map((m) => Number(m[1]));
      expect(widths).toHaveLength(7);
      for (const w of widths) expect(w).toBeLessThanOrEqual(geo.textWidthIn);
    }
  });

  it('warns by file name about low resolution, missing, unsupported and unsized images', () => {
    const doc = render(
      [entry({ title: 'Beach day', date: '2026-01-02', blocks: ['small', 'gone', 'heic', 'nosize', 'fine'].map((id) => ({ id, type: 'photo' as const, mediaId: id, caption: '' })) })],
      [
        media('small', { name: 'beach.jpg', width: 800, height: 600 }),
        media('gone', { name: 'lost.jpg' }),
        media('heic', { name: 'IMG_1.HEIC', mime: 'image/heic' }),
        media('nosize', { name: 'mystery.png', mime: 'image/png', width: undefined, height: undefined }),
        media('fine'),
      ],
      {},
      ['gone'],
    );
    const byKind = Object.fromEntries(doc.warnings.map((w) => [w.kind, w]));
    expect(byKind['low-resolution']).toMatchObject({ fileName: 'beach.jpg', where: '“Beach day” (2 Jan 2026)' });
    expect(byKind['low-resolution']!.ppi).toBeLessThan(300);
    expect(byKind['low-resolution']!.message).toMatch(/“beach\.jpg” in “Beach day” \(2 Jan 2026\) prints at \d+ PPI/);
    expect(byKind['missing-media']!.fileName).toBe('lost.jpg');
    expect(byKind['unsupported-image']!.fileName).toBe('IMG_1.HEIC');
    expect(byKind['unknown-size']!.fileName).toBe('mystery.png');
    expect(doc.warnings).toHaveLength(4);
    expect(doc.html.match(/class="img-missing"/g)).toHaveLength(2);
  });

  it('resamples to 600 PPI at the largest placement and never upscales', () => {
    const big = media('big', { width: 8000, height: 6000 });
    const small = media('small', { width: 800, height: 600 });
    const map = new Map([big, small].map((m) => [m.id, m]));
    const t = resampleTargets(
      [
        { mediaId: 'big', fileName: '', widthIn: 2, heightIn: 1.5, fit: 'contain', ppi: 4000 },
        { mediaId: 'big', fileName: '', widthIn: 4, heightIn: 3, fit: 'contain', ppi: 2000 },
        { mediaId: 'small', fileName: '', widthIn: 4, heightIn: 3, fit: 'contain', ppi: 200 },
      ],
      map,
    );
    expect(t.get('big')).toEqual({ widthPx: 2400, heightPx: 1800 });
    expect(t.get('small')).toEqual({ widthPx: 800, heightPx: 600 });
  });
});

describe('print CSS', () => {
  it('sets the page box to trim + bleed with the gutter on the inside', () => {
    const doc = interiorDocument({ options: options(), entries: [], media: new Map(), mediaUrl: () => null, gutterIn: 0.5, notesPages: 0 });
    expect(doc.css).toContain('size: 6.25in 9.25in;');
    expect(doc.css).toMatch(/@page :left \{\s*margin-left: 0\.775in;\s*margin-right: 1\.275in;/);
    expect(doc.css).toMatch(/@page :right \{\s*margin-left: 1\.275in;\s*margin-right: 0\.775in;/);
  });

  it('uses no transparency (Lulu requires it flattened)', () => {
    const all = [
      interiorDocument({ options: options(), entries: [], media: new Map(), mediaUrl: () => null, gutterIn: 0, notesPages: 0 }).css,
      interiorDocument({ options: options({ product: { trim: '6x9', interior: 'bw', binding: 'paperback', finish: 'matte' } }), entries: [], media: new Map(), mediaUrl: () => null, gutterIn: 0, notesPages: 0 }).css,
      coverDocument({ options: options(), entries: [], media: new Map(), mediaUrl: () => null, pageCount: 100, dims: estimateCoverDimensions(options().product, 100)! }).css,
    ].join('\n');
    expect(all).not.toMatch(/\b(opacity|box-shadow|text-shadow|filter|mix-blend-mode|backdrop-filter)\s*:/);
    expect(all).not.toMatch(/\b(rgba|hsla)\(|transparent\b|#[0-9a-f]{8}\b|#[0-9a-f]{4}\b/i);
  });

  it('greys out images only in the browser preview of a black-and-white book', () => {
    const bw = options({ product: { trim: '6x9', interior: 'bw', binding: 'paperback', finish: 'matte' } });
    const make = (preview: boolean) => interiorDocument({ options: bw, entries: [], media: new Map(), mediaUrl: () => null, gutterIn: 0, notesPages: 0, preview }).css;
    expect(make(true)).toContain('filter: grayscale(1)');
    expect(make(false)).not.toContain('filter');
  });

  it('converts gradients to grey for black-and-white interiors', () => {
    expect(grayscaleGradient('linear-gradient(135deg, #ff0000 0%, #ffffff 100%)')).toBe('linear-gradient(135deg, #363636 0%, #ffffff 100%)');
  });
});

describe('cover', () => {
  const dims = estimateCoverDimensions(options().product, 120)!;

  it('lays out back, spine and front with spine text above 80 pages', () => {
    const doc = coverDocument({ options: options({ author: 'Sam' }), entries: [entry({ date: '2026-01-01' })], media: new Map(), mediaUrl: () => null, pageCount: 120, dims });
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
    expect(doc.css).toContain(`size: ${r4(dims.widthIn + 0.05)}in ${r4(dims.heightIn + 0.05)}in`);
    expect(doc.html).toContain(`style="width:${dims.widthIn}in;height:${dims.heightIn}in;`);
    expect(doc.html).toContain('class="spine-text"');
    expect(doc.html).toContain('<p>1 entry</p>');
    expect(doc.html).toContain('<p class="author">Sam</p>');
  });

  it('honours the spine-text switch and the 80-page rule', () => {
    const short = estimateCoverDimensions(options().product, 60)!;
    expect(coverDocument({ options: options(), entries: [], media: new Map(), mediaUrl: () => null, pageCount: 60, dims: short }).html).not.toContain('spine-text');
    expect(coverDocument({ options: options({ spineText: false }), entries: [], media: new Map(), mediaUrl: () => null, pageCount: 120, dims }).html).not.toContain('spine-text');
  });

  it('places a photo cover across the front panel and warns when it is too small', () => {
    const doc = coverDocument({
      options: options({ cover: { kind: 'photo', mediaId: 'c' } }),
      entries: [],
      media: new Map([['c', media('c', { name: 'cover.jpg', width: 1200, height: 900 })]]),
      mediaUrl: (id) => `media/${id}`,
      pageCount: 120,
      dims,
    });
    expect(doc.html).toContain('class="panel front front-band"');
    expect(doc.images[0]).toMatchObject({ mediaId: 'c', fit: 'cover', heightIn: dims.heightIn });
    expect(doc.warnings[0]).toMatchObject({ kind: 'low-resolution', entryId: null, where: 'the book cover' });
  });
});

describe('helpers', () => {
  it('shortUrl', () => {
    expect(shortUrl('https://www.example.com/')).toBe('example.com');
    expect(shortUrl(`https://example.com/${'x'.repeat(80)}`)).toHaveLength(48);
  });

  it('qrSvg is a solid, self-contained SVG at the requested size', () => {
    const svg = qrSvg('https://example.com', 0.75);
    expect(svg).toMatch(/^<svg class="qr"[^>]*width="0.75in" height="0.75in"/);
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toMatch(/opacity|rgba/);
  });

  it('standaloneHtml wraps a document with lang and styles', () => {
    const doc = render([entry()], [], { locale: 'en-GB' });
    const page = standaloneHtml(doc, '<link rel="stylesheet" href="fonts.css">');
    expect(page).toMatch(/^<!doctype html>\n<html lang="en-GB">/);
    expect(page).toContain('<link rel="stylesheet" href="fonts.css">');
  });
});
