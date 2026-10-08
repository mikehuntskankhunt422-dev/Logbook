import { TRIMS, type Product, type TrimId } from './products.ts';

/** Lulu Book Creation Guide (ASSUMPTIONS.md, L3 p.23–24). All lengths are in inches. */
export const BLEED_IN = 0.125;
export const SAFETY_IN = 0.5;
export const PT_PER_IN = 72;

/** Books of this many pages or fewer get no spine text (D23, L3 p.15). */
export const SPINE_TEXT_MIN_PAGES = 81;

/**
 * Extra inside margin by total page count (L3 p.9). The guide's bands overlap at 400 and leave 60
 * unassigned; D22 resolves both edges to the larger gutter.
 */
export function gutterIn(pageCount: number): number {
  if (pageCount < 60) return 0;
  if (pageCount <= 150) return 0.125;
  if (pageCount < 400) return 0.5;
  if (pageCount <= 600) return 0.625;
  return 0.75;
}

/** Design margins measured from the trim edge, before the gutter. Every one is ≥ the 0.5″ safety margin. */
const MARGINS: Record<TrimId, { top: number; bottom: number; outside: number; inside: number }> = {
  '6x9': { top: 0.75, bottom: 0.85, outside: 0.65, inside: 0.65 },
  '8.5x11': { top: 0.85, bottom: 0.95, outside: 0.8, inside: 0.8 },
};

export interface InteriorGeometry {
  trimWidthIn: number;
  trimHeightIn: number;
  bleedIn: number;
  /** PDF page box = trim + bleed on every side (6×9 → 6.25 × 9.25″). */
  pageWidthIn: number;
  pageHeightIn: number;
  gutterIn: number;
  /** Margins from the page (bleed) edge, ready for CSS `@page` rules. */
  marginTopIn: number;
  marginBottomIn: number;
  marginOutsideIn: number;
  marginInsideIn: number;
  textWidthIn: number;
  textHeightIn: number;
}

export function interiorGeometry(trim: TrimId, gutter: number): InteriorGeometry {
  const t = TRIMS[trim];
  const m = MARGINS[trim];
  const inside = m.inside + gutter;
  return {
    trimWidthIn: t.widthIn,
    trimHeightIn: t.heightIn,
    bleedIn: BLEED_IN,
    pageWidthIn: t.widthIn + 2 * BLEED_IN,
    pageHeightIn: t.heightIn + 2 * BLEED_IN,
    gutterIn: gutter,
    marginTopIn: BLEED_IN + m.top,
    marginBottomIn: BLEED_IN + m.bottom,
    marginOutsideIn: BLEED_IN + m.outside,
    marginInsideIn: BLEED_IN + inside,
    textWidthIn: round4(t.widthIn - m.outside - inside),
    textHeightIn: round4(t.heightIn - m.top - m.bottom),
  };
}

/**
 * The guide's paperback spine formula (L3 p.13). Production covers are sized from Lulu's
 * `/cover-dimensions/` (PLAN §1.4); this is for unit-test cross-checks and offline previews only.
 * Hardcover spines use a step table we haven't verified, so they return null.
 */
export function estimateSpineIn(product: Product, pageCount: number): number | null {
  if (product.binding !== 'paperback') return null;
  return round4(pageCount / 444 + 0.06);
}

/** Offline estimate of `/cover-dimensions/` for a paperback (includes bleed, like Lulu's response). */
export function estimateCoverDimensions(product: Product, pageCount: number): CoverDimensions | null {
  const spine = estimateSpineIn(product, pageCount);
  if (spine === null) return null;
  const t = TRIMS[product.trim];
  return { widthIn: round4(2 * t.widthIn + 2 * BLEED_IN + spine), heightIn: t.heightIn + 2 * BLEED_IN, source: 'estimate' };
}

export interface CoverDimensions {
  widthIn: number;
  heightIn: number;
  /** `lulu` when it came from `/cover-dimensions/`; `estimate` for the offline formula. Only `lulu` covers may be ordered. */
  source: 'lulu' | 'estimate';
}

export interface CoverGeometry {
  widthIn: number;
  heightIn: number;
  /** Outer allowance on each edge: bleed for paperback. */
  wrapIn: number;
  spineIn: number;
  /** Panels in sheet coordinates (from the left edge of the full sheet, including the outer allowance). */
  back: { xIn: number; widthIn: number };
  spine: { xIn: number; widthIn: number };
  front: { xIn: number; widthIn: number };
  spineText: boolean;
  /**
   * True when the layout rests on something unverified: hardcover wrap and hinge areas inside Lulu's
   * dimensions (ASSUMPTIONS.md, unverified #7). Such covers need a check against Lulu's template.
   */
  provisional: boolean;
}

/**
 * Splits a wraparound cover into back, spine and front. The spine is always centred, so spine text
 * lands correctly even before the hardcover wrap allowance is verified.
 */
export function coverGeometry(product: Product, pageCount: number, dims: CoverDimensions): CoverGeometry {
  const t = TRIMS[product.trim];
  const wrap = BLEED_IN;
  const spine = round4(dims.widthIn - 2 * (t.widthIn + wrap));
  if (spine <= 0) throw new RangeError(`Cover width ${dims.widthIn}″ is too narrow for a ${t.label} book`);
  const backX = wrap;
  const spineX = wrap + t.widthIn;
  return {
    widthIn: dims.widthIn,
    heightIn: dims.heightIn,
    wrapIn: wrap,
    spineIn: spine,
    back: { xIn: backX, widthIn: t.widthIn },
    spine: { xIn: spineX, widthIn: spine },
    front: { xIn: round4(spineX + spine), widthIn: t.widthIn },
    spineText: pageCount >= SPINE_TEXT_MIN_PAGES,
    provisional: product.binding !== 'paperback',
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
