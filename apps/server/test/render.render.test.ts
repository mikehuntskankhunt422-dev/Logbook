import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCT, PT_PER_IN, estimateCoverDimensions, gutterIn, type CoverDimensions } from '@logbook/core';
import { EstimatedCoverDimensions, type CoverDimensionsSource } from '../src/lulu.ts';
import { renderBook, type RenderedBook } from '../src/render/book.ts';
import { Renderer } from '../src/render/renderer.ts';
import { inspectPdf, type PdfReport } from './pdf-inspect.ts';
import { sampleBundle } from './sample-journal.ts';

let renderer: Renderer;
beforeAll(async () => {
  renderer = await Renderer.launch({ executablePath: process.env.CHROMIUM_PATH });
});
afterAll(async () => {
  await renderer?.close();
});

/** Lulu-style source returning fixed dimensions, for products the offline estimate can't size. */
const fixedCover = (widthIn: number, heightIn: number): CoverDimensionsSource => ({
  kind: 'lulu',
  get: async () => ({ widthIn, heightIn, source: 'lulu' }) satisfies CoverDimensions,
});

/** Largest difference between colour channels in any pixel (0 for a perfectly grey image). */
async function maxChannelSpread(jpeg: Uint8Array): Promise<number> {
  const { data, info } = await sharp(jpeg).resize(300, 300, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 3) return 0;
  let max = 0;
  for (let i = 0; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i]! - data[i + 1]!), Math.abs(data[i + 1]! - data[i + 2]!));
  return max;
}

function expectPrintable(r: PdfReport) {
  expect(r.unembeddedFonts).toEqual([]);
  // Chromium embeds static TrueType fonts as CID fonts; Type 3 would mean a bitmap or variable font slipped through.
  expect(r.fontSubtypes).not.toContain('Type3');
  expect(r.transparency).toEqual({ softMasks: 0, groups: 0, alpha: 0, blendModes: 0 });
}

describe('6×9 premium-colour paperback with a photo cover', () => {
  let out: RenderedBook;
  let interior: PdfReport;
  let cover: PdfReport;
  beforeAll(async () => {
    out = await renderBook(renderer, await sampleBundle({ entries: 12, photoCover: true }), new EstimatedCoverDimensions());
    [interior, cover] = await Promise.all([inspectPdf(out.interiorPdf), inspectPdf(out.coverPdf)]);
  });

  it('has the planned, even page count, at least the paperback minimum', () => {
    expect(interior.pages).toHaveLength(out.plan.totalPages);
    expect(out.plan.totalPages % 2).toBe(0);
    expect(out.plan.totalPages).toBeGreaterThanOrEqual(32);
    expect(out.plan.contentPages + out.plan.notesPages).toBe(out.plan.totalPages);
  });

  it('sizes every page at trim + bleed (6.25 × 9.25″) with the trim box 0.125″ inside', () => {
    for (const p of interior.pages) {
      expect([p.widthPt, p.heightPt]).toEqual([450, 666]);
      expect(p.trim).toEqual({ x: 9, y: 9, width: 432, height: 648 });
    }
  });

  it('embeds every font (TrueType, no Type 3) and uses no transparency', () => {
    expectPrintable(interior);
    expect(new Set(interior.fontNames.map((n) => n.split(/[-0-9]/)[0]))).toEqual(new Set(['BricolageGrotesque', 'Newsreader', 'NotoEmoji']));
  });

  it('embeds images as opaque RGB JPEGs (the PNG with an alpha channel included)', () => {
    expect(interior.imageColorSpaces.length).toBeGreaterThan(5);
    // Chromium tags JPEGs with an sRGB ICC profile, which is what Lulu recommends.
    for (const cs of interior.imageColorSpaces) expect(['ICCBased', 'DeviceRGB']).toContain(cs);
    expect(interior.jpegs).toHaveLength(interior.imageColorSpaces.length);
  });

  it('prints the cover as one page at the exact cover dimensions', () => {
    const d = estimateCoverDimensions(DEFAULT_PRODUCT, out.plan.totalPages)!;
    expect(cover.pages).toHaveLength(1);
    expect(cover.pages[0]!.widthPt).toBeCloseTo(d.widthIn * PT_PER_IN, 1);
    expect(cover.pages[0]!.heightPt).toBeCloseTo(d.heightIn * PT_PER_IN, 1);
    expect(cover.pages[0]!.trim.x).toBe(9);
    expectPrintable(cover);
    expect(out.cover.dims.source).toBe('estimate');
  });

  it('reports the 600 × 400 scan as low resolution, by file name', () => {
    expect(out.warnings).toContainEqual(expect.objectContaining({ kind: 'low-resolution', fileName: 'old-scan.jpg' }));
  });

  it('lays out the same way every time', async () => {
    const again = await renderBook(renderer, await sampleBundle({ entries: 12, photoCover: true }), new EstimatedCoverDimensions());
    expect(again.plan).toEqual(out.plan);
  });
});

describe('8.5×11 black-and-white hardcover', () => {
  let out: RenderedBook;
  let interior: PdfReport;
  let cover: PdfReport;
  beforeAll(async () => {
    const bundle = await sampleBundle({ entries: 4, seed: 7, book: { product: { trim: '8.5x11', interior: 'bw', binding: 'hardcover', finish: 'gloss' } } });
    out = await renderBook(renderer, bundle, fixedCover(19.25, 12.25));
    [interior, cover] = await Promise.all([inspectPdf(out.interiorPdf), inspectPdf(out.coverPdf)]);
  });

  it('uses the hardcover package ID and minimum', () => {
    expect(out.podPackageId).toBe('0850X1100.BW.STD.CW.060UW444.GXX');
    expect(out.plan.totalPages).toBe(24);
    expect(interior.pages).toHaveLength(24);
  });

  it('sizes pages at 8.75 × 11.25″', () => {
    for (const p of interior.pages) expect([p.widthPt, p.heightPt]).toEqual([630, 810]);
  });

  it('converts interior images to greyscale and keeps the cover in colour', async () => {
    // Chromium stores them as 3-channel JPEGs, so check the pixels rather than the colour space.
    expect(interior.jpegs.length).toBeGreaterThan(3);
    for (const jpeg of interior.jpegs) expect(await maxChannelSpread(jpeg)).toBeLessThanOrEqual(4);
    expect(cover.pages[0]).toMatchObject({ widthPt: 19.25 * 72, heightPt: 12.25 * 72 });
    expectPrintable(interior);
    expectPrintable(cover);
  });

  it('flags the hardcover cover layout as provisional until Lulu’s wrap is verified', () => {
    expect(out.cover.geometry.provisional).toBe(true);
  });
});

describe('gutter planning on a longer book', () => {
  it('settles on a gutter that suits the final page count', async () => {
    const out = await renderBook(renderer, await sampleBundle({ entries: 40, seed: 3 }), new EstimatedCoverDimensions());
    expect(out.plan.totalPages).toBeGreaterThan(60);
    // The planner may keep a larger gutter at a band edge, never a smaller one.
    expect(out.plan.gutterIn).toBeGreaterThanOrEqual(gutterIn(out.plan.totalPages));
    expect(out.plan.gutterIn).toBeGreaterThan(0);
    expect(out.plan.measurements).toBeLessThanOrEqual(4);
    expect((await inspectPdf(out.interiorPdf)).pages).toHaveLength(out.plan.totalPages);
  });
});

describe('network isolation', () => {
  it('refuses every request that leaves the render origin', async () => {
    const html = `<!doctype html><html><head>${renderer.pagedHead()}
<link rel="stylesheet" data-pagedjs-ignore href="https://fonts.example.com/x.css">
<style>@page { size: 6in 9in; } body { background: url(https://tracker.example.com/bg.png); }</style></head>
<body><p>Hello</p><img src="https://example.com/photo.jpg" width="10" height="10"><iframe src="https://example.net/"></iframe>
<script>fetch('https://api.example.com/steal').catch(() => {}); new WebSocket('wss://ws.example.com/');</script></body></html>`;
    const r = await renderer.paginate(html, new Map(), { pdf: false });
    expect(r.pages).toBe(1);
    for (const host of ['fonts.example.com', 'example.com/photo.jpg', 'example.net', 'api.example.com', 'ws.example.com']) {
      expect(r.blocked.some((u) => u.includes(host)), host).toBe(true);
    }
  });
});
