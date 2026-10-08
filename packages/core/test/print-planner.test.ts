import { describe, expect, it } from 'vitest';
import { gutterForPages, padPageCount, planPagination, suggestVolumes } from '../src/print/planner.ts';
import { allProducts, DEFAULT_PRODUCT, podPackageId } from '../src/print/products.ts';
import { pageGeometry, safetyOk } from '../src/print/geometry.ts';

const hardcover = { ...DEFAULT_PRODUCT, binding: 'hardcover' as const };

describe('products', () => {
  it('maps the 16 curated products to unique dotted package IDs', () => {
    const ids = allProducts().map(podPackageId);
    expect(new Set(ids).size).toBe(16);
    for (const id of ids) expect(id).toMatch(/^(0600X0900|0850X1100)\.(FC\.PRE|BW\.STD)\.(PB|CW)\.(080CW444|060UW444)\.(MXX|GXX)$/);
    expect(podPackageId(DEFAULT_PRODUCT)).toBe('0600X0900.FC.PRE.PB.080CW444.MXX');
  });
});

describe('gutter bands (L3 p.9, D22)', () => {
  it.each([
    [32, 0],
    [59, 0],
    [60, 0.125], // gap in the guide: larger gutter
    [61, 0.125],
    [150, 0.125],
    [151, 0.5],
    [399, 0.5],
    [400, 0.625], // overlap in the guide: larger gutter
    [600, 0.625],
    [601, 0.75],
    [800, 0.75],
  ])('%i pages → %f″', (pages, gutter) => {
    expect(gutterForPages(pages)).toBe(gutter);
  });
});

describe('page count padding', () => {
  it('pads to the paperback minimum of 32 and the hardcover minimum of 24', () => {
    expect(padPageCount(5, DEFAULT_PRODUCT)).toEqual({ laidOut: 5, pages: 32, notesPages: 27, tooMany: false });
    expect(padPageCount(5, hardcover).pages).toBe(24);
  });

  it('makes odd counts even with one Notes page', () => {
    expect(padPageCount(101, DEFAULT_PRODUCT)).toMatchObject({ pages: 102, notesPages: 1 });
    expect(padPageCount(100, DEFAULT_PRODUCT)).toMatchObject({ pages: 100, notesPages: 0 });
  });

  it('flags books over 800 pages, including 799 laid out (padded to 800 is fine)', () => {
    expect(padPageCount(799, DEFAULT_PRODUCT)).toMatchObject({ pages: 800, tooMany: false });
    expect(padPageCount(801, DEFAULT_PRODUCT)).toMatchObject({ pages: 802, tooMany: true });
  });
});

describe('pagination planner', () => {
  /** A fake layout: content pages grow with the gutter, like real text reflowing into narrower lines. */
  const layoutOf = (base: number, perGutterInch: number) => async (g: number) => Math.round(base + g * perGutterInch);

  it('settles in one pass when the estimate is right', async () => {
    const plan = await planPagination(DEFAULT_PRODUCT, layoutOf(100, 8), 101);
    expect(plan).toMatchObject({ gutterIn: 0.125, pages: 102, passes: 1 });
  });

  it('grows the gutter until it matches its band', async () => {
    const plan = await planPagination(DEFAULT_PRODUCT, layoutOf(380, 40), 0);
    // 0 → 380 pages (0.5 band) → 400 pages (0.625 band) → 405 pages, still 0.625.
    expect(plan).toMatchObject({ gutterIn: 0.625, pages: 406 });
    expect(gutterForPages(plan.pages)).toBe(plan.gutterIn);
  });

  it('keeps the larger gutter when a band edge oscillates', async () => {
    // With 0.125″ the book is 151 pages (needs 0.5″); with 0.5″ it reflows to 150 (needs 0.125″).
    const layout = async (g: number) => (g >= 0.5 ? 149 : 151);
    const plan = await planPagination(DEFAULT_PRODUCT, layout, 150);
    expect(plan.gutterIn).toBe(0.5);
    expect(plan.pages).toBe(150);
    expect(gutterForPages(plan.pages)).toBeLessThanOrEqual(plan.gutterIn);
  });

  it('always ends on a gutter at least as wide as its page count needs', async () => {
    for (let base = 20; base < 800; base += 37) {
      const plan = await planPagination(DEFAULT_PRODUCT, layoutOf(base, 30), base);
      expect(gutterForPages(plan.pages)).toBeLessThanOrEqual(plan.gutterIn);
      expect(plan.pages % 2).toBe(0);
      expect(plan.passes).toBeLessThanOrEqual(5);
    }
  });
});

describe('volume suggestions', () => {
  it('splits an oversized book at month boundaries into volumes that fit', () => {
    const starts = [];
    let page = 1;
    for (let m = 1; m <= 12; m++)
      for (let d = 1; d <= 25; d++) {
        starts.push({ date: `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, page });
        page += 4;
      }
    const vols = suggestVolumes(starts, page - 1, 800);
    expect(vols.length).toBe(2);
    expect(vols[0]!.from).toBe('2026-01-01');
    expect(vols[0]!.to.endsWith('-25')).toBe(true); // ends on a month's last entry
    expect(vols[1]!.to).toBe('2026-12-25');
    for (const v of vols) expect(v.pages).toBeLessThanOrEqual(784);
  });

  it('suggests nothing without entries', () => {
    expect(suggestVolumes([], 0, 800)).toEqual([]);
  });
});

describe('page geometry', () => {
  it('keeps text, running heads and folios inside the safety area at every gutter', () => {
    for (const trim of ['6x9', '8.5x11'] as const)
      for (const g of [0, 0.125, 0.5, 0.625, 0.75]) {
        const geo = pageGeometry(trim, g);
        expect(safetyOk(geo)).toBe(true);
        expect(geo.margin.inside).toBeGreaterThanOrEqual(0.5 + g);
        expect(geo.textWidth).toBeGreaterThan(3.5);
      }
  });

  it('narrows the text block by exactly the gutter', () => {
    expect(pageGeometry('6x9', 0).textWidth - pageGeometry('6x9', 0.5).textWidth).toBeCloseTo(0.5);
  });
});
