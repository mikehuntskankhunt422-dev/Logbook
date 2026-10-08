import { MARGIN_TEXT_INSET_IN, pageGeometry } from './geometry.ts';
import { inch } from './html.ts';
import type { Product } from './products.ts';

/**
 * Static (not variable) print fonts, as Fontsource stylesheets the renderer loads (D35). Variable
 * fonts embed as Type 3 in Chromium PDFs; these embed as TrueType. The UI keeps its variable fonts,
 * which have different family names, so the two never mix.
 */
export const PRINT_FONT_STYLESHEETS = [
  '@fontsource/newsreader/400.css',
  '@fontsource/newsreader/400-italic.css',
  '@fontsource/newsreader/700.css',
  '@fontsource/newsreader/700-italic.css',
  '@fontsource/bricolage-grotesque/400.css',
  '@fontsource/bricolage-grotesque/700.css',
  '@fontsource/noto-emoji/400.css',
] as const;

const SERIF = `'Newsreader', 'Noto Emoji', serif`;
const SANS = `'Bricolage Grotesque', 'Noto Emoji', sans-serif`;

const PALETTES = {
  color: { ink: '#1f1b16', muted: '#6f665d', rule: '#d4ccc2', accent: '#c2410c', plain: '#d6d0c8', screen: '#26211d' },
  bw: { ink: '#1a1a1a', muted: '#5c5c5c', rule: '#c8c8c8', accent: '#333333', plain: '#d0d0d0', screen: '#2a2a2a' },
};

/** Pages that carry no running head or page number. */
const QUIET_PAGES = ['front', 'divider', ':blank'];

/**
 * The print stylesheet for Paged.js. Margins depend on the gutter, so this is regenerated for each
 * layout pass; the body HTML is not. Transparency-free by construction: no opacity, alpha colours,
 * shadows, filters or blend modes (Lulu requires flattened transparency; test/print-css.test.ts
 * scans for them). No `leader()`: Paged.js doesn't support it and drops the whole rule.
 */
export function printCss(product: Product, gutterIn: number): string {
  const g = pageGeometry(product.trim, gutterIn);
  const p = PALETTES[product.interior];
  const m = g.margin;
  const marginText = `font-family: ${SANS}; font-size: 8pt; line-height: 1; color: ${p.muted};`;
  const quiet = QUIET_PAGES.flatMap((name) =>
    (name.startsWith(':') ? [name] : [name, `${name}:left`, `${name}:right`]).map(
      (sel) => `@page ${sel} { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }`,
    ),
  ).join('\n');

  return `
@page {
  size: ${inch(g.trimWidth)} ${inch(g.trimHeight)};
  bleed: ${inch(g.bleed)};
  marks: none;
  margin: ${inch(m.top)} ${inch(m.outside)} ${inch(m.bottom)} ${inch(m.inside)};
  @bottom-center { content: counter(page); vertical-align: top; padding-top: ${inch(MARGIN_TEXT_INSET_IN)}; ${marginText} }
}
@page :left {
  margin-left: ${inch(m.outside)};
  margin-right: ${inch(m.inside)};
  @top-left { content: string(runhead); vertical-align: bottom; padding-bottom: ${inch(MARGIN_TEXT_INSET_IN)}; ${marginText} }
}
@page :right {
  margin-left: ${inch(m.inside)};
  margin-right: ${inch(m.outside)};
  @top-right { content: string(runhead); vertical-align: bottom; padding-bottom: ${inch(MARGIN_TEXT_INSET_IN)}; ${marginText} }
}
${quiet}

html { font-family: ${SERIF}; font-size: ${g.bodyPt}pt; line-height: 1.5; color: ${p.ink}; font-variant-emoji: text; }
body { margin: 0; }
h1, h2, h3, h4, .sans, figcaption .media-label, .tags, .entry-date, .toc-month { font-family: ${SANS}; }
p { margin: 0 0 0.6em; orphans: 2; widows: 2; }
p.blank { height: 1.5em; margin: 0; }
h3 { font-size: 1.25em; line-height: 1.25; margin: 1em 0 0.4em; break-after: avoid; }
h4 { font-size: 1.08em; line-height: 1.25; margin: 0.9em 0 0.3em; break-after: avoid; }
blockquote { margin: 0.8em 0; padding-left: 0.9em; border-left: 2pt solid ${p.rule}; font-style: italic; }
hr { border: 0; border-top: 0.75pt solid ${p.rule}; margin: 1em 0; }
ul, ol { padding-left: 1.3em; margin: 0 0 0.6em; }
li > p { margin-bottom: 0.2em; }
.link { text-decoration: underline; text-decoration-thickness: 0.5pt; text-underline-offset: 0.15em; }
sup.link-ref { font-size: 0.65em; line-height: 0; margin-left: 0.1em; color: ${p.accent}; }
.url, .link-notes, .file-name { overflow-wrap: anywhere; }
.link-notes { font-size: 0.8em; color: ${p.muted}; margin: 1.2em 0 0; padding: 0.4em 0 0 1.4em; border-top: 0.5pt solid ${p.rule}; }

/* Title, colophon, contents */
.title-page, .colophon, .contents { page: front; }
.title-page { padding-top: ${inch(g.textHeight * 0.28)}; text-align: center; }
.title-page h1 { font-size: 2.4em; line-height: 1.1; margin: 0 0 0.4em; }
.title-page .subtitle { font-size: 1.2em; font-style: italic; }
.title-page .range { font-family: ${SANS}; color: ${p.muted}; margin-top: 1.4em; }
.title-page .author { margin-top: 2.5em; }
.colophon { break-before: page; padding-top: ${inch(g.textHeight * 0.62)}; font-size: 0.85em; color: ${p.muted}; }
.colophon .credit { font-size: 0.9em; }
.contents { break-before: right; }
.contents h2 { font-size: 1.6em; margin: 0 0 0.8em; }
.contents ol { list-style: none; padding: 0; margin: 0; font-size: 0.92em; }
.toc-month { font-weight: 700; margin: 0.9em 0 0.2em; break-after: avoid; }
.toc-entry { display: flex; align-items: baseline; gap: 0.35em; break-inside: avoid; }
.toc-title { flex: 0 1 auto; }
.toc-dots { flex: 1 1 0.5in; border-bottom: 0.9pt dotted ${p.muted}; }
.toc-page::after { content: target-counter(attr(data-ref), page); }

/* Month dividers and entries */
.month-divider { page: divider; break-before: right; break-after: page; padding-top: ${inch(g.textHeight * 0.36)}; text-align: center; }
.month-divider h2 { font-size: 2em; margin: 0 0 0.3em; }
.month-divider p { color: ${p.muted}; font-family: ${SANS}; }
.entry { string-set: runhead attr(data-runhead); }
.entry-new-page { break-before: page; }
.entry:not(.entry-new-page) + .entry { margin-top: 2.2em; }
.entry-head { break-inside: avoid; break-after: avoid; margin-bottom: 0.9em; }
.band { height: ${inch(g.entryBandHeight)}; margin-bottom: 0.22in; background-color: ${p.plain}; }
.band-thin { height: 0.12in; }
.band-photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
.entry-date { color: ${p.muted}; font-size: 0.85em; margin: 0 0 0.2em; }
.entry-title { font-size: 1.7em; line-height: 1.15; margin: 0 0 0.25em; }
.mood svg { display: inline-block; width: 0.9em; height: 0.9em; vertical-align: -0.08em; margin-left: 0.3em; }
.entry-date .mood svg { width: 1.2em; height: 1.2em; }
.tags { color: ${p.accent}; font-size: 0.8em; margin: 0; }

/* Blocks */
figure { margin: 0.9em 0; break-inside: avoid; }
figcaption { font-size: 0.85em; color: ${p.muted}; font-style: italic; text-align: center; margin-top: 0.4em; }
img { display: block; }
img.cover { width: 100%; height: 100%; object-fit: cover; }
.contained { margin: 0 auto; height: auto; object-fit: cover; }
.missing { display: flex; align-items: center; justify-content: center; margin: 0 auto; background: #f1ede8; border: 0.75pt solid ${p.rule}; color: ${p.muted}; font-family: ${SANS}; font-size: 0.75em; text-align: center; padding: 0.1in; box-sizing: border-box; }
.item-caption { font-size: 0.75em; color: ${p.muted}; margin: 0.25em 0 0; line-height: 1.3; }
figure.gallery { break-inside: auto; }
.cells .row { display: flex; gap: ${inch(g.galleryGap)}; margin-bottom: ${inch(g.galleryGap)}; break-inside: avoid; }
.cols-2 .cell { width: calc((100% - ${inch(g.galleryGap)}) / 2); }
.cols-3 .cell { width: calc((100% - ${inch(2 * g.galleryGap)}) / 3); }
.cell img, .cell .missing { width: 100%; aspect-ratio: 1 / 1; height: auto; object-fit: cover; }
.lead { margin-bottom: ${inch(g.galleryGap)}; break-inside: avoid; }
.lead img, .lead .missing { width: 100%; aspect-ratio: 3 / 2; height: auto; object-fit: cover; }
.poster { position: relative; margin: 0 auto; }
.poster img, .poster .missing { width: 100%; height: 100%; }
.play { position: absolute; left: 50%; top: 50%; width: 0.45in; height: 0.45in; margin: -0.225in 0 0 -0.225in; }
.media-label { display: flex; align-items: center; justify-content: center; gap: 0.4em; font-size: 0.8em; color: ${p.muted}; margin: 0.4em 0 0; font-family: ${SANS}; }
.icon { width: 1.4em; height: 1.4em; flex: none; color: ${p.accent}; }
.media-label .icon { width: 1.2em; height: 1.2em; }
.media-card, .file-tag, .audio-card { display: flex; align-items: center; gap: 0.6em; border: 0.75pt solid ${p.rule}; padding: 0.12in 0.16in; font-family: ${SANS}; font-size: 0.85em; }
.file-tag { display: inline-flex; }
.file-size { color: ${p.muted}; }
.audio-body { flex: 1; min-width: 0; }
.audio-body p { margin: 0; }
.waveform { display: block; width: 100%; height: 0.35in; color: ${p.accent}; margin: 0.06in 0; }
.embed-screen { position: relative; aspect-ratio: 16 / 9; margin: 0 auto 0.6em; background: ${p.screen}; }
.embed-card { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 0.3in; color: #ffffff; font-family: ${SANS}; box-sizing: border-box; }
.embed-provider { font-size: 0.75em; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 0.3em; }
.embed-title { font-size: 1.1em; font-weight: 700; margin: 0; }
.link-card { display: flex; align-items: center; gap: 0.18in; }
.link-card .qr { width: ${inch(g.qrSize)}; height: ${inch(g.qrSize)}; flex: none; }
.link-text { min-width: 0; }
.link-text p { margin: 0; }
.link-title { font-family: ${SANS}; font-weight: 700; }
.link-text .url { font-size: 0.85em; color: ${p.muted}; }
figure.embed figcaption, figure.link figcaption { text-align: left; }

/* Notes pages pad the book to an even count and the product minimum */
.notes-page { break-before: page; }
.notes-page h2 { font-size: 1.3em; margin: 0 0 0.2in; color: ${p.muted}; }
.notes-page .rule { height: 0.33in; border-bottom: 0.5pt solid ${p.rule}; }
${product.interior === 'bw' ? `.band[style] { background-image: linear-gradient(135deg, #e8e8e8 0%, #9a9a9a 100%) !important; }` : ''}
`.trim();
}
