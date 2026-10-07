import { describe, expect, it } from 'vitest';
import { coverHtml, coverLayout, estimateCoverDimensions } from '../src/print/cover.ts';
import { printBundleSchema, printMediaPlan, PRINT_BUNDLE_FORMAT } from '../src/print/bundle.ts';
import { pageGeometry } from '../src/print/geometry.ts';
import { bookOptionsSchema, formatDateRange, formatLongDate, formatMonth, selectEntries } from '../src/print/options.ts';
import { DEFAULT_PRODUCT } from '../src/print/products.ts';
import { effectivePpi, imageWarnings, place, printPixelSize } from '../src/print/resolution.ts';
import { entry, everyBlock, mediaTable } from './print-fixtures.ts';

const media = mediaTable();
const metaOf = (id: string) => media.get(id);

describe('cover geometry', () => {
  it("reads the spine from Lulu's example (6×9, 210 pages → 920 × 666 pt)", () => {
    const L = coverLayout(DEFAULT_PRODUCT, 210, { width: 920, height: 666, unit: 'pt' });
    expect(L.edge).toBeCloseTo(0.125);
    expect(L.spine).toBeCloseTo(920 / 72 - 12.25, 6);
    // Cross-check against the guide's formula (L3 p.13). Lulu's example is rounded to whole points.
    expect(Math.abs(L.spine - (210 / 444 + 0.06))).toBeLessThanOrEqual(0.5 / 72);
    expect(L.frontX).toBeCloseTo(0.125 + 6 + L.spine);
    expect(L.spineText).toBe(true);
    expect(L.approximate).toBe(false);
  });

  it('matches the guide formula across page counts when given the offline estimate', () => {
    for (const pages of [32, 80, 81, 200, 444, 800]) {
      const L = coverLayout(DEFAULT_PRODUCT, pages, estimateCoverDimensions(DEFAULT_PRODUCT, pages), true, true);
      expect(L.spine).toBeCloseTo(pages / 444 + 0.06, 9);
      expect(L.width).toBeCloseTo(12.25 + L.spine, 9);
      expect(L.height).toBeCloseTo(9.25, 9);
    }
  });

  it('drops spine text at 80 pages or fewer (D23) and when switched off', () => {
    const dims = estimateCoverDimensions(DEFAULT_PRODUCT, 80);
    expect(coverLayout(DEFAULT_PRODUCT, 80, dims).spineText).toBe(false);
    expect(coverLayout(DEFAULT_PRODUCT, 81, estimateCoverDimensions(DEFAULT_PRODUCT, 81)).spineText).toBe(true);
    expect(coverLayout(DEFAULT_PRODUCT, 200, estimateCoverDimensions(DEFAULT_PRODUCT, 200), false).spineText).toBe(false);
  });

  it('marks hardcover geometry approximate until the case-wrap question is answered', () => {
    const hc = { ...DEFAULT_PRODUCT, binding: 'hardcover' as const };
    expect(coverLayout(hc, 200, { width: 13.5, height: 10.25, unit: 'inch' }).approximate).toBe(true);
  });

  it('rejects dimensions that cannot belong to the trim', () => {
    expect(() => coverLayout(DEFAULT_PRODUCT, 100, { width: 600, height: 666, unit: 'pt' })).toThrow(/don't fit/);
  });

  it('renders an escaped wraparound page at the exact sheet size', () => {
    const L = coverLayout(DEFAULT_PRODUCT, 210, { width: 920, height: 666, unit: 'pt' });
    const options = bookOptionsSchema.parse({ title: 'Us <3', backText: 'A & B' });
    const { css, body } = coverHtml({ options, layout: L, dateRange: 'January – October 2026' });
    // Drawn at the exact size on a slightly larger sheet; the renderer crops to Lulu's size.
    expect(css).toContain(`size: ${Math.round((L.width + 0.05) * 1000) / 1000}in 9.3in;`);
    expect(css).toContain(`body { width: ${Math.round(L.width * 1000) / 1000}in; height: 9.25in;`);
    expect(body).toContain('Us &lt;3');
    expect(body).toContain('A &amp; B');
    expect(body).toContain('<div class="spine"><p>Us &lt;3 · 2026</p></div>');
    expect(css).not.toMatch(/opacity|rgba\(|transparent|shadow/i);
  });
});

describe('image resolution', () => {
  it('computes PPI for contained and cropped placements', () => {
    expect(effectivePpi({ width: 3000, height: 2000 }, { width: 5, height: 5, fit: 'contain' })).toBe(600);
    expect(effectivePpi({ width: 3000, height: 2000 }, { width: 5, height: 5, fit: 'cover' })).toBe(400);
  });

  it('lists images below 300 PPI by file name, worst first, with their entry', () => {
    const blocks = [...everyBlock(), { id: 'lo', type: 'photo' as const, mediaId: 'tiny', caption: '' }];
    const e = entry({ date: '2026-03-01', title: 'Trip', blocks, cover: { kind: 'photo', mediaId: 'tiny' } });
    const warnings = imageWarnings([e], bookOptionsSchema.parse({}), metaOf, pageGeometry('6x9', 0.125));
    // 640 px across a 4.475″ text block: 143 PPI. The same file in a collage cell prints at 340 PPI: no warning.
    expect(warnings.map((w) => [w.name, w.where, w.ppi])).toEqual([
      ['IMG_0042.jpg', 'entry cover', 143],
      ['IMG_0042.jpg', 'photo', 143],
    ]);
    expect(warnings[0]).toMatchObject({ entryTitle: 'Trip', entryDate: '2026-03-01' });
  });

  it('warns about images with unknown dimensions', () => {
    const e = entry({ date: '2026-03-01', blocks: [{ id: 'p', type: 'photo', mediaId: 'nodims', caption: '' }] });
    expect(imageWarnings([e], bookOptionsSchema.parse({}), metaOf, pageGeometry('6x9', 0))).toMatchObject([{ name: 'old.png', ppi: null }]);
  });

  it('checks the book cover photo against the front panel with bleed', () => {
    const box = place.frontCover(pageGeometry('6x9', 0));
    expect(box).toEqual({ width: 6.125, height: 9.25, fit: 'cover' });
    const options = bookOptionsSchema.parse({ cover: { kind: 'photo', mediaId: 'photo1' } });
    // 3000×2000 cropped to fill 6.125×9.25″: 216 PPI.
    expect(imageWarnings([], options, metaOf, pageGeometry('6x9', 0))).toMatchObject([{ where: 'book cover', ppi: 216 }]);
  });
});

describe('print bundle', () => {
  it('uploads only the images the pages show; videos, audio and files travel as metadata', () => {
    const e = entry({ date: '2026-03-01', blocks: everyBlock(), cover: { kind: 'photo', mediaId: 'portrait' } });
    const plan = printMediaPlan([e], bookOptionsSchema.parse({}), metaOf);
    expect(plan.files.sort()).toEqual(['g1', 'g2', 'g3', 'photo1', 'portrait', 'tiny', 'vidposter']);
    expect(plan.metaOnly.sort()).toEqual(['aud', 'doc', 'vid']);
  });

  it('validates a bundle and rejects unsafe file paths', () => {
    const base = {
      format: PRINT_BUNDLE_FORMAT,
      version: 1,
      createdAt: '2026-10-07T00:00:00.000Z',
      options: {},
      entries: [entry({ date: '2026-03-01' })],
      media: [{ meta: media.get('photo1')!, file: { path: 'media/photo1.jpg', sha256: 'a'.repeat(64), bytes: 10, width: 3000, height: 2000 } }],
    };
    expect(printBundleSchema.parse(base).options.product).toEqual(DEFAULT_PRODUCT);
    const evil = { ...base, media: [{ ...base.media[0]!, file: { ...base.media[0]!.file, path: 'media/../../etc/passwd' } }] };
    expect(printBundleSchema.safeParse(evil).success).toBe(false);
  });
});

describe('selection and dates', () => {
  const entries = [
    entry({ date: '2026-02-01', title: 'b' }),
    entry({ date: '2026-01-15', title: 'a' }),
    entry({ date: '2026-03-01', title: 'c', deletedAt: '2026-03-02T00:00:00.000Z' }),
  ];

  it('selects by range or by hand, oldest first, never from the trash', () => {
    expect(selectEntries(entries, { kind: 'range', from: '2026-01-01', to: '2026-12-31' }).map((e) => e.title)).toEqual(['a', 'b']);
    expect(selectEntries(entries, { kind: 'picked', ids: entries.map((e) => e.id) }).map((e) => e.title)).toEqual(['a', 'b']);
  });

  it('formats dates without Intl, so every renderer prints the same words', () => {
    expect(formatLongDate('2026-10-07')).toBe('Wednesday 7 October 2026');
    expect(formatLongDate('2024-02-29')).toBe('Thursday 29 February 2024');
    expect(formatMonth('2026-01')).toBe('January 2026');
    expect(formatDateRange('2026-01-03', '2026-10-07')).toBe('January – October 2026');
    expect(formatDateRange('2025-03-01', '2026-10-07')).toBe('March 2025 – October 2026');
    expect(formatDateRange('2026-10-01', '2026-10-31')).toBe('October 2026');
    expect(formatDateRange('2026-10-07', '2026-10-07')).toBe('7 October 2026');
  });
});

describe('print pixel size', () => {
  it('downsizes to 600 PPI at the largest placement and never upscales', () => {
    // A 6000×4000 photo in a 4.475×4.526″ contain box prints 4.475″ wide: 2685 px at 600 PPI.
    const box = { width: 4.475, height: 4.526, fit: 'contain' as const };
    expect(printPixelSize({ width: 6000, height: 4000 }, [box])).toEqual({ width: 2685, height: 1790 });
    expect(printPixelSize({ width: 640, height: 480 }, [box])).toEqual({ width: 640, height: 480 });
  });

  it('keeps enough pixels for the cropped area of a cover placement', () => {
    // 6000×2000 filling a 4×4″ square: scaled to 12×4″ and cropped, so 12″ × 600 = 7200 px wide (more than it has).
    expect(printPixelSize({ width: 6000, height: 2000 }, [{ width: 4, height: 4, fit: 'cover' }])).toEqual({ width: 6000, height: 2000 });
    // The same image as a small cell and a full-width photo: the larger placement wins.
    const both = printPixelSize({ width: 6000, height: 4000 }, [
      { width: 1.4, height: 1.4, fit: 'cover' },
      { width: 4.475, height: 4.526, fit: 'contain' },
    ]);
    expect(both.width).toBe(2685);
  });
});
