import { GRADIENTS } from '../model.ts';
import { esc, inch } from './html.ts';
import type { BookOptions } from './options.ts';
import { BLEED_IN, SAFETY_IN, TRIMS, type Product } from './products.ts';

/** What Lulu's `/cover-dimensions/` returns (L1 ~8220). */
export interface CoverDimensions {
  width: number;
  height: number;
  unit: 'pt' | 'mm' | 'inch';
}

const PER_INCH = { pt: 72, mm: 25.4, inch: 1 };

export interface CoverLayout {
  /** Whole sheet including bleed (and, for hardcovers, the wrap). Inches. */
  width: number;
  height: number;
  /** Extra beyond the trim on each outer edge: the bleed for paperbacks. */
  edge: number;
  trimWidth: number;
  trimHeight: number;
  spine: number;
  /** Left edge of each panel's trim box on the sheet. */
  backX: number;
  spineX: number;
  frontX: number;
  spineText: boolean;
  /** True for the offline estimate, and for hardcovers until open question #7 is answered. */
  approximate: boolean;
}

/**
 * Chromium rounds page sizes to its own grid, sometimes down. The cover is drawn at the exact size
 * from the top-left corner of a sheet this much larger, and the renderer crops the PDF back to
 * Lulu's numbers (apps/server/src/render/pdf.ts).
 */
export const COVER_SHEET_PAD_IN = 0.05;

/** No spine text on books of 80 pages or fewer (L3 p.15, D23). */
export const SPINE_TEXT_MIN_PAGES = 81;

/**
 * Panel geometry from Lulu's sheet size. The spine is what's left after two trim-width panels and
 * the outer edges; the edge is read from the height, so the same maths covers a hardcover wrap.
 * Hardcover hinge areas aren't modelled yet (ASSUMPTIONS "not yet verified" #7).
 */
export function coverLayout(product: Product, pages: number, dims: CoverDimensions, wantSpineText = true, approximate = false): CoverLayout {
  const t = TRIMS[product.trim];
  const width = dims.width / PER_INCH[dims.unit];
  const height = dims.height / PER_INCH[dims.unit];
  const edge = (height - t.heightIn) / 2;
  const spine = width - 2 * t.widthIn - 2 * edge;
  if (spine <= 0 || edge < 0) throw new Error(`Cover dimensions ${dims.width}×${dims.height} ${dims.unit} don't fit a ${t.label} book.`);
  return {
    width,
    height,
    edge,
    trimWidth: t.widthIn,
    trimHeight: t.heightIn,
    spine,
    backX: edge,
    spineX: edge + t.widthIn,
    frontX: edge + t.widthIn + spine,
    spineText: wantSpineText && pages >= SPINE_TEXT_MIN_PAGES,
    approximate: approximate || product.binding === 'hardcover',
  };
}

/**
 * Offline stand-in for `/cover-dimensions/`, for the builder preview only (D39). Uses the guide's
 * paperback spine formula (pages/444 + 0.06″, L3 p.13) for both bindings; printed covers always use
 * Lulu's numbers.
 */
export function estimateCoverDimensions(product: Product, pages: number): CoverDimensions {
  const t = TRIMS[product.trim];
  const spine = pages / 444 + 0.06;
  return { width: 2 * t.widthIn + spine + 2 * BLEED_IN, height: t.heightIn + 2 * BLEED_IN, unit: 'inch' };
}

export interface CoverInput {
  options: BookOptions;
  layout: CoverLayout;
  /** "January – October 2026" */
  dateRange: string;
  /** URL of the cover photo when options.cover is a photo. */
  frontImageUrl?: string;
}

/**
 * The wraparound cover as a single page at Lulu's exact size: back, spine, front. Printed with
 * Chromium's own paged media (one page, nothing to paginate). Text stays 0.5″ inside every trim
 * edge and fold.
 */
export function coverHtml({ options, layout: L, dateRange, frontImageUrl }: CoverInput): { css: string; body: string } {
  const gradient = options.cover.kind === 'gradient' ? GRADIENTS[options.cover.gradient] : GRADIENTS.dusk;
  const photo = options.cover.kind === 'photo' && frontImageUrl;
  const ink = gradient.ink === 'light' ? '#ffffff' : '#1f1b16';
  const safe = SAFETY_IN;

  const css = `
@page { size: ${inch(L.width + COVER_SHEET_PAD_IN)} ${inch(L.height + COVER_SHEET_PAD_IN)}; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${inch(L.width)}; height: ${inch(L.height)}; position: relative; overflow: hidden; background-image: ${gradient.css}; font-family: 'Bricolage Grotesque', 'Noto Emoji', sans-serif; color: ${ink}; font-variant-emoji: text; }
.panel { position: absolute; top: ${inch(L.edge)}; height: ${inch(L.trimHeight)}; box-sizing: border-box; }
.back { left: ${inch(L.backX)}; width: ${inch(L.trimWidth)}; padding: ${inch(safe + 0.2)} ${inch(safe + 0.1)} ${inch(safe)}; }
.front { left: ${inch(L.frontX)}; width: ${inch(L.trimWidth)}; padding: ${inch(safe)}; display: flex; flex-direction: column; justify-content: flex-end; }
.front-photo { position: absolute; left: ${inch(L.frontX)}; top: 0; width: ${inch(L.trimWidth + L.edge)}; height: ${inch(L.height)}; object-fit: cover; display: block; }
.label { background: #fbf8f4; color: #1f1b16; padding: 0.22in 0.26in; }
.title { font-size: ${L.trimWidth > 7 ? 38 : 30}pt; font-weight: 700; line-height: 1.05; margin: 0 0 0.12in; }
.subtitle { font-family: 'Newsreader', 'Noto Emoji', serif; font-style: italic; font-size: 13pt; margin: 0 0 0.12in; }
.range, .author { font-size: 10pt; margin: 0; }
.back-text { font-family: 'Newsreader', 'Noto Emoji', serif; font-size: 11pt; line-height: 1.5; white-space: pre-wrap; margin: 0; max-height: ${inch(L.trimHeight - 2 * safe - 0.8)}; overflow: hidden; }
.made { position: absolute; left: ${inch(safe + 0.1)}; bottom: ${inch(safe)}; font-size: 8pt; margin: 0; }
.spine { position: absolute; top: ${inch(L.edge)}; left: ${inch(L.spineX)}; width: ${inch(L.spine)}; height: ${inch(L.trimHeight)}; display: flex; align-items: center; justify-content: center; }
.spine p { writing-mode: vertical-rl; margin: 0; font-size: ${Math.min(11, Math.max(6, L.spine * 72 * 0.45)).toFixed(1)}pt; font-weight: 700; white-space: nowrap; max-height: ${inch(L.trimHeight - 2 * safe)}; overflow: hidden; }
`.trim();

  const front = `
${photo ? `<img class="front-photo" src="${esc(frontImageUrl)}" alt="">` : ''}
<div class="panel front"><div class="label">
<p class="title">${esc(options.title)}</p>
${options.subtitle ? `<p class="subtitle">${esc(options.subtitle)}</p>` : ''}
${dateRange ? `<p class="range">${esc(dateRange)}</p>` : ''}
${options.author ? `<p class="author">${esc(options.author)}</p>` : ''}
</div></div>`;
  const back = `<div class="panel back">${options.backText ? `<p class="back-text">${esc(options.backText)}</p>` : ''}<p class="made">Made with Logbook</p></div>`;
  const year = dateRange.match(/\d{4}$/)?.[0] ?? '';
  const spine = L.spineText ? `<div class="spine"><p>${esc(options.title)}${year ? ` · ${year}` : ''}</p></div>` : '';
  return { css, body: `${back}${spine}${front}` };
}
