import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { bookBodyHtml, bookDocument, type BookInput } from '../src/print/book-html.ts';
import { blockHtml } from '../src/print/blocks-html.ts';
import { pageGeometry } from '../src/print/geometry.ts';
import { DEFAULT_BOOK_OPTIONS, bookOptionsSchema } from '../src/print/options.ts';
import { printCss } from '../src/print/print-css.ts';
import { allProducts } from '../src/print/products.ts';
import { qrSvg } from '../src/print/qr.ts';
import { richTextToHtml, linkNotesHtml } from '../src/print/richtext-html.ts';
import type { RichNode } from '../src/model.ts';
import { entry, everyBlock, mediaTable, thumbAssets } from './print-fixtures.ts';

const media = mediaTable();
const geometry = pageGeometry('6x9', 0);
const ctx = () => ({ geometry, meta: (id: string) => media.get(id), assets: thumbAssets, links: [] as string[] });

function book(over: Partial<BookInput> = {}): string {
  const entries = [
    entry({ date: '2026-09-30', title: 'Last of <September>', mood: '😄', tags: ['beach', 'r&r'], blocks: everyBlock() }),
    entry({ date: '2026-10-01', title: '', cover: { kind: 'photo', mediaId: 'photo1' } }),
    entry({ date: '2026-10-07', title: 'Today' }),
  ];
  return bookBodyHtml({
    options: bookOptionsSchema.parse({ title: 'Our "year"', author: 'Sam & Alex' }),
    entries,
    meta: (id) => media.get(id),
    assets: thumbAssets,
    notesPages: 3,
    printedOn: '2026-10-07',
    ...over,
  });
}

describe('rich text to print HTML', () => {
  it('escapes everything the writer typed', () => {
    const doc: RichNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert("x")</script> & \'q\'' }] }] };
    expect(richTextToHtml(doc)).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
  });

  it('prints marks, headings, lists, quotes, rules and breaks', () => {
    const doc: RichNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] }, { type: 'hardBreak' }, { type: 'text', text: 's', marks: [{ type: 'strike' }, { type: 'underline' }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        { type: 'horizontalRule' },
        { type: 'paragraph' },
      ],
    };
    expect(richTextToHtml(doc)).toBe(
      '<h4>Sub</h4><p><em><strong>b</strong></em><br><u><s>s</s></u></p><ol start="3"><li><p>three</p></li></ol><blockquote><p>q</p></blockquote><hr><p class="blank"></p>',
    );
  });

  it('turns links into numbered notes without hyperlinks (D38), one note per link run', () => {
    const links: string[] = [];
    const html = richTextToHtml(everyBlock()[0]!.type === 'text' ? (everyBlock()[0] as { doc: RichNode }).doc : undefined, links);
    expect(links).toEqual(['https://example.com/glenelg']);
    expect(html).toContain('<span class="link"><strong>Glenelg</strong> beach</span><sup class="link-ref">1</sup>');
    expect(html).not.toMatch(/<a\b|href=/);
    expect(linkNotesHtml(links)).toBe('<ol class="link-notes"><li>example.com/glenelg</li></ol>');
  });

  it('prints a link whose text is its address as the short address, without a note', () => {
    const links: string[] = [];
    const doc: RichNode = { type: 'paragraph', content: [{ type: 'text', text: 'www.example.com', marks: [{ type: 'link', attrs: { href: 'https://www.example.com/' } }] }] };
    expect(richTextToHtml(doc, links)).toBe('<p><span class="url">example.com</span></p>');
    expect(links).toEqual([]);
  });

  it('keeps the words of unknown nodes', () => {
    const doc: RichNode = { type: 'doc', content: [{ type: 'mystery', content: [{ type: 'text', text: 'kept' }] }] };
    expect(richTextToHtml(doc)).toBe('<p>kept</p>');
  });
});

describe('block fallbacks', () => {
  it('sizes photos from stored dimensions, not loaded pixels', () => {
    const html = blockHtml({ id: 'p', type: 'photo', mediaId: 'portrait', caption: '' }, ctx());
    // 1500×2000 in a 4.526″-tall photo box: 3.395″ wide.
    expect(html).toContain('style="width:min(100%, 3.395in);aspect-ratio:1500 / 2000"');
  });

  it('falls back to 4:3 when an old record has no dimensions, and to a same-size placeholder when the file is missing', () => {
    const html = blockHtml({ id: 'p', type: 'photo', mediaId: 'nodims', caption: '' }, { ...ctx(), assets: { imageUrl: () => undefined } });
    expect(html).toContain('<div class="missing contained" style="width:min(100%, 6.035in);aspect-ratio:4 / 3"><span>Missing image: old.png</span></div>');
  });

  it('prints a video as its poster with a play badge and duration', () => {
    const html = blockHtml(everyBlock()[4]!, ctx());
    expect(html).toContain('src="thumb/vidposter.jpg"');
    expect(html).toContain('Video · 1:23');
    expect(html).not.toContain('thumb/vid.jpg');
  });

  it('prints audio and files as cards, links and embeds with QR codes', () => {
    const blocks = everyBlock();
    expect(blockHtml(blocks[5]!, ctx())).toContain('Audio · 1:05');
    expect(blockHtml(blocks[6]!, ctx())).toMatch(/tickets\.pdf.*244 KB/);
    const link = blockHtml(blocks[7]!, ctx());
    expect(link).toContain('<svg class="qr"');
    expect(link).toContain('example.org/a/long/path');
    const embed = blockHtml(blocks[8]!, ctx());
    expect(embed).toContain('<p class="embed-provider">YouTube</p>');
  });

  it('gives an embed the same box with or without a thumbnail, so layout matches', () => {
    const block = everyBlock()[8]!;
    const without = blockHtml(block, ctx());
    const withThumb = blockHtml(block, { ...ctx(), assets: { ...thumbAssets, embedThumbnailUrl: () => 'yt.jpg' } });
    const box = /<div class="embed-screen" style="[^"]+">/;
    expect(without.match(box)![0]).toBe(withThumb.match(box)![0]);
    expect(withThumb).toContain('src="yt.jpg"');
  });

  it('lays galleries out in rows that can break between pages', () => {
    const html = blockHtml({ id: 'g', type: 'gallery', layout: 'grid', items: ['g1', 'g2', 'g3', 'photo1', 'tiny'].map((mediaId) => ({ mediaId, caption: '' })), caption: '' }, ctx());
    expect(html.match(/class="row"/g)).toHaveLength(2);
    expect(html).toContain('cells cols-3');
  });
});

describe('book HTML', () => {
  const html = book();

  it('never contains hyperlinks or scripts', () => {
    expect(html).not.toMatch(/<a\b|href=|<script|javascript:/i);
  });

  it('escapes titles, tags, captions and options', () => {
    expect(html).toContain('Last of &lt;September&gt;');
    expect(html).toContain('#r&amp;r');
    expect(html).toContain('Sunset &quot;golden&quot; hour');
    expect(html).toContain('Our &quot;year&quot;');
    expect(html).toContain('Sam &amp; Alex');
  });

  it('builds front matter, month dividers, entries and Notes pages', () => {
    expect(html).toContain('<section class="title-page">');
    expect(html).toContain('<p class="range">September – October 2026</p>');
    expect(html.match(/class="month-divider"/g)).toHaveLength(2);
    expect(html).toContain('<p>2 entries</p>');
    expect(html.match(/<article class="entry entry-new-page"/g)).toHaveLength(3);
    expect(html.match(/class="notes-page"/g)).toHaveLength(3);
    expect(html).toContain('data-runhead="October 2026"');
  });

  it('points every contents line at its entry', () => {
    for (let i = 0; i < 3; i++) {
      expect(html).toContain(`data-ref="#entry-${i}"`);
      expect(html).toContain(`id="entry-${i}"`);
    }
  });

  it('credits Twemoji only when a mood is printed', () => {
    expect(html).toContain('Twemoji');
    expect(book({ entries: [entry({ date: '2026-01-01' })] })).not.toContain('Twemoji');
  });

  it('can flow entries and drop contents and dividers to save pages', () => {
    const lean = book({ options: bookOptionsSchema.parse({ entryStart: 'flow', contents: false, monthDividers: false }) });
    expect(lean).not.toContain('entry-new-page');
    expect(lean).not.toContain('class="contents"');
    expect(lean).not.toContain('month-divider');
    expect(lean).toContain('band band-thin');
  });

  it('is byte-identical for the same input', () => {
    expect(book()).toBe(book());
  });

  it('wraps into a document with the renderer head', () => {
    const doc = bookDocument({ css: 'p{}', body: '<p>x</p>', head: '<link rel="stylesheet" href="f.css">', title: 'A <b>' });
    expect(doc).toMatch(/^<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A &lt;b&gt;<\/title><link/);
  });
});

describe('print stylesheet', () => {
  /** Anything that would put transparency or an unsupported Paged.js function in the PDF. */
  const BANNED = [
    /opacity/i,
    /rgba\(|hsla\(/i,
    /\b(rgb|hsl)\([^)]*\//i,
    /\btransparent\b/i,
    /box-shadow|text-shadow/i,
    /(^|[\s;{])filter\s*:/i,
    /mix-blend-mode|backdrop-filter/i,
    /#[0-9a-f]{8}\b|#[0-9a-f]{4}\b/i,
    /leader\(/i,
  ];

  it.each(allProducts().filter((p) => p.finish === 'matte'))('is transparency-free for %o', (product) => {
    for (const gutter of [0, 0.5, 0.75]) {
      const css = printCss(product, gutter);
      for (const re of BANNED) expect(css, `${re}`).not.toMatch(re);
    }
  });

  it('sets the trim size with bleed and mirrors margins with the gutter on the inside', () => {
    const css = printCss({ ...DEFAULT_BOOK_OPTIONS.product }, 0.5);
    expect(css).toContain('size: 6in 9in;');
    expect(css).toContain('bleed: 0.125in;');
    expect(css).toMatch(/@page :left \{\s+margin-left: 0\.65in;\s+margin-right: 1\.25in;/);
    expect(css).toMatch(/@page :right \{\s+margin-left: 1\.25in;\s+margin-right: 0\.65in;/);
  });

  it('greys out gradient bands for black-and-white interiors', () => {
    expect(printCss({ ...DEFAULT_BOOK_OPTIONS.product, interior: 'bw' }, 0)).toContain('.band[style]');
    expect(printCss(DEFAULT_BOOK_OPTIONS.product, 0)).not.toContain('.band[style]');
  });
});

describe('QR codes', () => {
  it('draws one opaque path inside a white quiet zone', () => {
    const svg = qrSvg('https://example.com/');
    const size = encode('https://example.com/', { ecc: 'M', border: 4 }).size;
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain(`<rect width="${size}" height="${size}" fill="#ffffff"/>`);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(qrSvg('https://example.com/')).toBe(svg);
  });

  it('marks dark modules exactly where the encoder does', () => {
    const qr = encode('logbook', { ecc: 'M', border: 4 });
    const dark = qr.data.flat().filter(Boolean).length;
    const path = qrSvg('logbook').match(/ d="([^"]+)"/)![1]!;
    const covered = [...path.matchAll(/h(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(covered).toBe(dark);
  });
});
