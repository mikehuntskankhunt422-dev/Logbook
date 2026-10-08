import { BLEED_IN, SAFETY_IN, TRIMS, type TrimId } from './products.ts';

/**
 * Page geometry in inches. The print stylesheet and the resolution checks both read from here, so
 * a photo's placed size in the PDF is exactly the size its PPI warning was computed for.
 */
interface TrimStyle {
  top: number;
  bottom: number;
  outside: number;
  /** Inside margin before the page-count gutter is added. */
  inside: number;
  bodyPt: number;
  /** Photos never exceed this share of the text block height, so a portrait shot leaves room for its caption. */
  photoMaxHeightShare: number;
  entryBandHeight: number;
  embedMaxWidth: number;
  qrSize: number;
  galleryGap: number;
}

const STYLES: Record<TrimId, TrimStyle> = {
  '6x9': { top: 0.85, bottom: 0.85, outside: 0.65, inside: 0.75, bodyPt: 10.5, photoMaxHeightShare: 0.62, entryBandHeight: 1.6, embedMaxWidth: 3.6, qrSize: 0.9, galleryGap: 0.12 },
  '8.5x11': { top: 1, bottom: 1, outside: 0.85, inside: 0.95, bodyPt: 11.5, photoMaxHeightShare: 0.62, entryBandHeight: 2, embedMaxWidth: 4.4, qrSize: 1, galleryGap: 0.15 },
};

export interface PageGeometry {
  trim: TrimId;
  trimWidth: number;
  trimHeight: number;
  bleed: number;
  gutter: number;
  margin: { top: number; bottom: number; outside: number; inside: number };
  textWidth: number;
  textHeight: number;
  bodyPt: number;
  photoMaxHeight: number;
  entryBandHeight: number;
  embedMaxWidth: number;
  qrSize: number;
  galleryGap: number;
}

export function pageGeometry(trim: TrimId, gutterIn: number): PageGeometry {
  const t = TRIMS[trim];
  const s = STYLES[trim];
  const margin = { top: s.top, bottom: s.bottom, outside: s.outside, inside: s.inside + gutterIn };
  const textWidth = round(t.widthIn - margin.inside - margin.outside);
  const textHeight = round(t.heightIn - margin.top - margin.bottom);
  return {
    trim,
    trimWidth: t.widthIn,
    trimHeight: t.heightIn,
    bleed: BLEED_IN,
    gutter: gutterIn,
    margin,
    textWidth,
    textHeight,
    bodyPt: s.bodyPt,
    photoMaxHeight: round(textHeight * s.photoMaxHeightShare),
    entryBandHeight: s.entryBandHeight,
    embedMaxWidth: s.embedMaxWidth,
    qrSize: s.qrSize,
    galleryGap: s.galleryGap,
  };
}

/** Running heads and folios sit this far from the text block, in a line box this tall (8 pt type). */
export const MARGIN_TEXT_INSET_IN = 0.15;
export const MARGIN_TEXT_LINE_IN = 0.15;

/** Body text, running heads and folios all stay inside Lulu's safety area. */
export function safetyOk(g: PageGeometry): boolean {
  const m = g.margin;
  const headRoom = Math.min(m.top, m.bottom) - MARGIN_TEXT_INSET_IN - MARGIN_TEXT_LINE_IN;
  return Math.min(headRoom, m.outside, m.inside) >= SAFETY_IN - 1e-9;
}

/** Gallery columns by item count. Single photos in a gallery behave like a photo block. */
export function galleryColumns(items: number): number {
  return items <= 1 ? 1 : items === 2 || items === 4 ? 2 : 3;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
