import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCT,
  PageCountError,
  PT_PER_IN,
  allProducts,
  coverGeometry,
  estimateCoverDimensions,
  gutterIn,
  interiorGeometry,
  packageId,
  paddedPageCount,
  parsePackageId,
  planPages,
  type Product,
} from '../src/index.ts';

describe('package IDs', () => {
  it('builds Lulu’s dotted format', () => {
    expect(packageId(DEFAULT_PRODUCT)).toBe('0600X0900.FC.PRE.PB.080CW444.MXX');
    expect(packageId({ trim: '8.5x11', interior: 'bw', binding: 'hardcover', finish: 'gloss' })).toBe('0850X1100.BW.STD.CW.060UW444.GXX');
  });

  it('has 16 distinct curated products that round-trip', () => {
    const ids = allProducts().map(packageId);
    expect(new Set(ids).size).toBe(16);
    for (const p of allProducts()) expect(parsePackageId(packageId(p))).toEqual(p);
    expect(parsePackageId('0600X0900FCPREPB080CW444MXX')).toBeNull();
  });
});

describe('gutter bands (L3 p.9, D22)', () => {
  it.each([
    [24, 0],
    [59, 0],
    [60, 0.125], // unassigned in the guide; D22 picks the larger
    [61, 0.125],
    [150, 0.125],
    [151, 0.5],
    [399, 0.5],
    [400, 0.625], // in two bands in the guide; D22 picks the larger
    [600, 0.625],
    [601, 0.75],
    [800, 0.75],
  ])('%i pages → %f″', (pages, gutter) => {
    expect(gutterIn(pages)).toBe(gutter);
  });
});

describe('interior geometry', () => {
  it('adds bleed to the page box and the gutter to the inside margin only', () => {
    const plain = interiorGeometry('6x9', 0);
    const wide = interiorGeometry('6x9', 0.5);
    expect([plain.pageWidthIn, plain.pageHeightIn]).toEqual([6.25, 9.25]);
    expect(wide.marginInsideIn - plain.marginInsideIn).toBeCloseTo(0.5);
    expect(wide.marginOutsideIn).toBe(plain.marginOutsideIn);
    expect(plain.textWidthIn - wide.textWidthIn).toBeCloseTo(0.5);
  });

  it('keeps every margin outside Lulu’s 0.5″ safety zone', () => {
    for (const trim of ['6x9', '8.5x11'] as const) {
      const g = interiorGeometry(trim, 0);
      for (const m of [g.marginTopIn, g.marginBottomIn, g.marginOutsideIn, g.marginInsideIn]) expect(m - g.bleedIn).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('cover geometry', () => {
  it('matches Lulu’s /cover-dimensions/ example: 6×9, 210 pages → 920 × 666 pt', () => {
    const d = estimateCoverDimensions(DEFAULT_PRODUCT, 210)!;
    expect(Math.round(d.widthIn * PT_PER_IN)).toBe(920);
    expect(Math.round(d.heightIn * PT_PER_IN)).toBe(666);
  });

  it('centres the spine between back and front panels', () => {
    const d = estimateCoverDimensions(DEFAULT_PRODUCT, 210)!;
    const c = coverGeometry(DEFAULT_PRODUCT, 210, d);
    expect(c.spineIn).toBeCloseTo(210 / 444 + 0.06, 3);
    expect(c.spine.xIn + c.spineIn / 2).toBeCloseTo(c.widthIn / 2, 4);
    expect(c.front.xIn + c.front.widthIn + c.wrapIn).toBeCloseTo(c.widthIn, 4);
    expect(c.provisional).toBe(false);
  });

  it('drops spine text at 80 pages or fewer (D23)', () => {
    expect(coverGeometry(DEFAULT_PRODUCT, 80, estimateCoverDimensions(DEFAULT_PRODUCT, 80)!).spineText).toBe(false);
    expect(coverGeometry(DEFAULT_PRODUCT, 82, estimateCoverDimensions(DEFAULT_PRODUCT, 82)!).spineText).toBe(true);
  });

  it('has no offline estimate for hardcover and marks hardcover layouts provisional', () => {
    const hc: Product = { ...DEFAULT_PRODUCT, binding: 'hardcover' };
    expect(estimateCoverDimensions(hc, 100)).toBeNull();
    expect(coverGeometry(hc, 100, { widthIn: 13.5, heightIn: 9.75, source: 'lulu' }).provisional).toBe(true);
  });

  it('rejects dimensions too narrow for the trim', () => {
    expect(() => coverGeometry(DEFAULT_PRODUCT, 40, { widthIn: 12, heightIn: 9.25, source: 'lulu' })).toThrow(RangeError);
  });
});

describe('page planner', () => {
  const limits = { minPages: 32, maxPages: 800 };
  /** A fake renderer: `base` pages at no gutter, losing capacity as the gutter widens. */
  const layout = (base: number, perInch = 40) => {
    const calls: number[] = [];
    const measure = async (g: number) => {
      calls.push(g);
      return Math.ceil(base + g * perInch);
    };
    return { measure, calls };
  };

  it('pads short books to the product minimum', async () => {
    const plan = await planPages(layout(9).measure, limits);
    expect(plan).toMatchObject({ gutterIn: 0, contentPages: 9, notesPages: 23, totalPages: 32 });
  });

  it('always ends on an even page count', async () => {
    const plan = await planPages(layout(41).measure, limits);
    expect(plan.totalPages % 2).toBe(0);
    expect(plan).toMatchObject({ contentPages: 41, notesPages: 1, totalPages: 42 });
  });

  it('re-measures until the gutter matches the page count', async () => {
    const { measure, calls } = layout(180);
    const plan = await planPages(measure, limits);
    expect(calls).toEqual([0, 0.5]);
    expect(plan).toMatchObject({ gutterIn: 0.5, contentPages: 200, totalPages: 200, measurements: 2 });
  });

  it('uses the estimate to skip a measurement', async () => {
    const { measure, calls } = layout(180);
    await planPages(measure, limits, 190);
    expect(calls).toEqual([0.5]);
  });

  it('picks the larger gutter when it oscillates at a band edge', async () => {
    // Synthetic: at 0.125″ the book runs to 152 pages, which needs 0.5″; at 0.5″ it reports 150, which
    // needs only 0.125″. Real layouts rarely do this, but renderer noise at a band edge can.
    const pages = new Map([
      [0, 140],
      [0.125, 152],
      [0.5, 150],
    ]);
    const plan = await planPages(async (g) => pages.get(g)!, limits, 140);
    expect(plan).toMatchObject({ gutterIn: 0.5, contentPages: 150, totalPages: 150 });
  });

  it('even padding can cross a band edge: 59 content pages become 60 and need the 60-page gutter', async () => {
    const pages = new Map([
      [0, 59],
      [0.125, 61],
    ]);
    const plan = await planPages(async (g) => pages.get(g)!, limits, 40);
    expect(plan).toMatchObject({ gutterIn: 0.125, contentPages: 61, totalPages: 62 });
  });

  it('rejects books over the maximum and suggests volumes', async () => {
    const err = await planPages(layout(1500, 0).measure, limits).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageCountError);
    expect((err as PageCountError).suggestedVolumes).toBe(2);
    expect((err as PageCountError).message).toMatch(/1500 pages.*800.*2 volumes/);
  });

  it('rejects nonsense from the renderer', async () => {
    await expect(planPages(async () => 0, limits)).rejects.toThrow(RangeError);
  });

  it('paddedPageCount', () => {
    expect(paddedPageCount(1, 24)).toBe(24);
    expect(paddedPageCount(33, 32)).toBe(34);
    expect(paddedPageCount(34, 32)).toBe(34);
  });
});
