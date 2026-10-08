import type { CoverGeometry, InteriorGeometry } from './geometry.ts';
import { BLEED_IN, SAFETY_IN } from './geometry.ts';
import type { Product } from './products.ts';

/**
 * Print stylesheets. Lulu needs flattened transparency (L3 p.23–24), so nothing here uses opacity,
 * rgba/hsla, shadows, filters or blend modes; a unit test enforces it. The one exception is the
 * preview-only greyscale filter, which never reaches a PDF.
 *
 * Font families are static (not variable) fonts, which Chromium embeds as TrueType rather than Type 3.
 * Hosts supply the @font-face rules: see PRINT_FONTS.
 */
export const PRINT_FONTS = {
  serif: 'Newsreader',
  sans: 'Bricolage Grotesque',
  emoji: 'Noto Emoji',
} as const;

/**
 * Fontsource stylesheets for PRINT_FONTS (static instances, SIL OFL). Hosts load exactly these so the
 * browser preview and the server measure text with the same files.
 */
export const PRINT_FONT_STYLESHEETS = [
  '@fontsource/newsreader/400.css',
  '@fontsource/newsreader/400-italic.css',
  '@fontsource/newsreader/600.css',
  '@fontsource/newsreader/600-italic.css',
  '@fontsource/newsreader/700.css',
  '@fontsource/newsreader/700-italic.css',
  '@fontsource/bricolage-grotesque/400.css',
  '@fontsource/bricolage-grotesque/600.css',
  '@fontsource/bricolage-grotesque/700.css',
  '@fontsource/bricolage-grotesque/800.css',
  '@fontsource/noto-emoji/400.css',
] as const;

const SERIF = `'${PRINT_FONTS.serif}', '${PRINT_FONTS.emoji}', Georgia, serif`;
const SANS = `'${PRINT_FONTS.sans}', '${PRINT_FONTS.emoji}', Arial, sans-serif`;

const INK = '#1d1a17';
const SOFT = '#5c544b';
const LINE = '#d8cfc3';
const ACCENT = '#c93a16';

export function interiorCss(g: InteriorGeometry, product: Product, opts: { preview: boolean }): string {
  const big = g.trimWidthIn > 7;
  const accent = product.interior === 'bw' ? INK : ACCENT;
  const num = `font-family: ${SANS}; font-size: 8pt; color: ${SOFT}; vertical-align: top; padding-top: 0.16in;`;
  return `
@page {
  size: ${g.pageWidthIn}in ${g.pageHeightIn}in;
  margin: ${g.marginTopIn}in ${g.marginOutsideIn}in ${g.marginBottomIn}in ${g.marginInsideIn}in;
}
@page :left {
  margin-left: ${g.marginOutsideIn}in;
  margin-right: ${g.marginInsideIn}in;
  @bottom-left { content: counter(page); ${num} text-align: left; }
}
@page :right {
  margin-left: ${g.marginInsideIn}in;
  margin-right: ${g.marginOutsideIn}in;
  @bottom-right { content: counter(page); ${num} text-align: right; }
}
@page front {
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}

html { font-size: ${big ? 11.5 : 10.5}pt; }
body {
  margin: 0;
  font-family: ${SERIF};
  color: ${INK};
  background: #ffffff;
  line-height: 1.45;
  text-align: left;
  hyphens: manual;
  overflow-wrap: anywhere;
  orphans: 2;
  widows: 2;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3, h4 { font-family: ${SANS}; font-weight: 700; line-height: 1.15; break-after: avoid; margin: 0; }
p { margin: 0 0 0.55em; }
img, svg { display: block; }
figure { margin: 0 0 1em; break-inside: avoid; }

.front { page: front; }
.title-page { break-after: page; height: ${round2(g.textHeightIn - 0.1)}in; display: flex; flex-direction: column; justify-content: space-between; }
.title-block { margin-top: ${big ? 2.2 : 1.6}in; }
.book-title { font-size: ${big ? 34 : 28}pt; font-weight: 800; letter-spacing: -0.01em; }
.book-subtitle { font-size: 1.3rem; font-style: italic; margin-top: 0.4em; color: ${SOFT}; }
.book-author { font-family: ${SANS}; font-size: 1.05rem; font-weight: 600; margin-top: 1.6em; }
.book-dates { font-family: ${SANS}; font-size: 0.9rem; color: ${SOFT}; }
.verso { break-after: page; height: ${round2(g.textHeightIn - 0.1)}in; display: flex; flex-direction: column; justify-content: flex-end; font-size: 0.85rem; color: ${SOFT}; }
.verso p { margin: 0 0 0.3em; }

.toc { break-after: page; }
.toc h2 { font-size: 1.6rem; margin-bottom: 0.8em; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0 0 0.35em; break-inside: avoid; }
.toc a { display: flex; gap: 0.8em; color: inherit; text-decoration: none; }
.toc .toc-date { font-family: ${SANS}; font-size: 0.8rem; color: ${SOFT}; width: 7.5em; flex: none; padding-top: 0.15em; }
.toc .toc-title { flex: 1; }
.toc a::after { content: target-counter(attr(href), page); font-family: ${SANS}; font-size: 0.85rem; padding-left: 0.6em; }

.entry { break-before: page; }
.entry-head { margin-bottom: 1.1em; break-inside: avoid; }
.entry-band { height: 0.32in; border-radius: 0.06in; margin-bottom: 0.18in; }
.entry-hero { margin: 0 0 0.18in; }
.entry-hero img { border-radius: 0.06in; }
.entry-date { font-family: ${SANS}; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${accent}; margin-bottom: 0.3em; }
.mood { font-family: '${PRINT_FONTS.emoji}'; text-transform: none; font-size: 1.1rem; font-weight: 400; color: ${INK}; vertical-align: -0.1em; }
.entry-title { font-size: ${big ? 22 : 18}pt; font-weight: 800; }
.entry-tags { font-family: ${SANS}; font-size: 0.75rem; color: ${SOFT}; margin: 0.45em 0 0; }

.rich { margin-bottom: 0.6em; }
.rich h3 { font-size: 1.2rem; margin: 0.9em 0 0.35em; }
.rich h4 { font-size: 1.02rem; margin: 0.8em 0 0.3em; }
.rich ul, .rich ol { margin: 0 0 0.55em; padding-left: 1.3em; }
.rich li > p { margin-bottom: 0.2em; }
.rich blockquote { margin: 0.6em 0 0.8em; padding-left: 0.9em; border-left: 2pt solid ${accent}; font-style: italic; color: ${SOFT}; }
.rich hr { border: 0; border-top: 0.75pt solid ${LINE}; margin: 1em 25%; }
.ilink { text-decoration: underline; text-decoration-color: ${LINE}; text-underline-offset: 0.15em; }
.link-ref { font-family: ${SANS}; font-size: 0.6em; color: ${accent}; margin-left: 0.1em; }

.caption, .g-cap { font-style: italic; font-size: 0.88rem; color: ${SOFT}; margin: 0.4em 0 0; }
.photo { text-align: center; }
.photo .polaroid { display: inline-block; background: #ffffff; border: 0.5pt solid ${LINE}; padding: 0.08in; }
.photo .caption { text-align: center; }
.gallery .g-row { display: flex; gap: 0.1in; margin-bottom: 0.1in; break-inside: avoid; }
.gallery .g-cell { flex: none; }
.gallery .g-cell img { border-radius: 0.03in; }
.g-cap { font-size: 0.75rem; }

.video .poster { position: relative; display: inline-block; }
.video .badge { position: absolute; left: 0.1in; bottom: 0.1in; display: flex; align-items: center; gap: 0.3em; background: ${INK}; color: #ffffff; font-family: ${SANS}; font-size: 0.75rem; font-weight: 600; padding: 0.25em 0.6em 0.25em 0.45em; border-radius: 1em; }
.video .badge .icon { width: 0.9em; height: 0.9em; }

.media-card { border: 0.75pt solid ${LINE}; border-radius: 0.08in; padding: 0.14in 0.16in; }
.media-card .card-body { display: flex; align-items: center; gap: 0.14in; }
.media-card .icon { width: 0.32in; height: 0.32in; color: ${accent}; flex: none; }
.media-card .wave { width: 100%; height: 0.4in; margin-top: 0.1in; fill: ${accent}; }
.media-card .caption { margin-top: 0.5em; }
.kicker { font-family: ${SANS}; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${SOFT}; margin: 0 0 0.15em; }
.card-title { font-family: ${SANS}; font-weight: 600; margin: 0; }
.card-url { font-family: ${SANS}; font-size: 0.78rem; color: ${SOFT}; margin: 0.2em 0 0; }
.card-cap { font-style: italic; font-size: 0.88rem; margin: 0.4em 0 0; }

.link-card { display: flex; gap: 0.16in; align-items: center; border: 0.75pt solid ${LINE}; border-radius: 0.08in; padding: 0.12in; }
.link-card .qr { flex: none; }
.file-tag { display: inline-flex; align-items: center; gap: 0.4em; border: 0.75pt solid ${LINE}; border-radius: 1em; padding: 0.2em 0.8em 0.2em 0.5em; font-family: ${SANS}; font-size: 0.8rem; margin: 0 0 0.6em; break-inside: avoid; }
.file-tag .icon { width: 1.1em; height: 1.1em; color: ${accent}; }
.file-tag .file-size { color: ${SOFT}; }

.link-notes { margin-top: 1.2em; padding-top: 0.6em; border-top: 0.75pt solid ${LINE}; break-inside: avoid; }
.link-notes h3 { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: ${SOFT}; margin-bottom: 0.5em; }
.link-notes ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.12in 0.2in; }
.link-notes li { display: flex; align-items: center; gap: 0.08in; font-family: ${SANS}; font-size: 0.72rem; width: ${round2((g.textWidthIn - 0.2) / 2)}in; break-inside: avoid; }
.link-notes .qr { flex: none; }
.note-num { font-weight: 700; color: ${accent}; }
.note-url { color: ${SOFT}; }

.img-missing { display: flex; align-items: center; justify-content: center; background: #f2ebe1; border: 0.75pt dashed ${LINE}; color: ${SOFT}; font-family: ${SANS}; font-size: 0.75rem; text-align: center; padding: 0.1in; box-sizing: border-box; }

.notes-page { break-before: page; }
.notes-page h2 { font-size: 1.1rem; color: ${SOFT}; margin-bottom: 0.25in; }
.notes-page .rule { height: 0.32in; border-bottom: 0.5pt solid ${LINE}; box-sizing: border-box; }
${opts.preview && product.interior === 'bw' ? `\nimg { filter: grayscale(1); }` : ''}
`;
}

/**
 * Chromium snaps PDF page sizes to a 1/300″ grid and can round down, which would clip the sheet's
 * edge. The cover prints on a page this much larger; the renderer then crops the PDF's MediaBox to
 * the exact size (top-left anchored), so nothing is lost and the dimensions are exact.
 */
export const COVER_PAGE_SLACK_IN = 0.05;

/** The cover is one page, laid out absolutely; Paged.js isn't needed. */
export function coverCss(g: CoverGeometry): string {
  const inset = SAFETY_IN + 0.15;
  return `
@page { size: ${round4(g.widthIn + COVER_PAGE_SLACK_IN)}in ${round4(g.heightIn + COVER_PAGE_SLACK_IN)}in; margin: 0; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { position: relative; overflow: hidden; font-family: ${SANS}; }
.tone-light { color: #ffffff; }
.tone-dark { color: ${INK}; }
.panel, .spine, .cover-photo { position: absolute; top: 0; height: 100%; box-sizing: border-box; }
.cover-photo img { width: 100%; height: 100%; }
.front { display: flex; flex-direction: column; justify-content: flex-end; padding: ${BLEED_IN + inset}in ${inset}in ${BLEED_IN + inset + 0.4}in; }
.front h1 { font-size: ${g.front.widthIn > 7 ? 46 : 36}pt; font-weight: 800; line-height: 1.05; letter-spacing: -0.01em; margin: 0; overflow-wrap: anywhere; }
.front .subtitle { font-family: ${SERIF}; font-style: italic; font-size: 15pt; margin: 0.35em 0 0; }
.front .author { font-size: 12pt; font-weight: 600; margin: 1.2em 0 0; }
.front-band .front-title { background: #ffffff; color: ${INK}; padding: 0.22in 0.25in; border-radius: 0.06in; }
.back { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; padding: ${BLEED_IN + inset}in ${inset}in ${BLEED_IN + inset}in; font-size: 9pt; }
.back-meta { text-align: center; }
.back-meta p { margin: 0 0 0.25em; }
.spine { display: flex; align-items: center; justify-content: center; }
.spine-text { writing-mode: vertical-rl; margin: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-height: ${round2(g.heightIn - 2 * (BLEED_IN + 0.75))}in; }
.spine-author { font-weight: 400; margin-inline-start: 1.2em; }
`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
