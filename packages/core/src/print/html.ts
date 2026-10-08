import { GRADIENTS, type Block, type Entry, type MediaMeta, type RichNode } from '../model.ts';
import { formatBytes, formatDuration } from '../media.ts';
import { dateRangeLabel, formatPrintDate, type BookOptions } from './book.ts';
import { coverCss, interiorCss } from './css.ts';
import { coverGeometry, interiorGeometry, type CoverDimensions, type CoverGeometry, type InteriorGeometry } from './geometry.ts';
import { MIN_PPI, PRINTABLE_IMAGE_TYPES, containBox, effectivePpi, round3, type ImageBox, type ImageUse } from './images.ts';
import { qrSvg } from './qr.ts';

export interface PrintWarning {
  kind: 'low-resolution' | 'unknown-size' | 'missing-media' | 'unsupported-image';
  /** null for the book cover. */
  entryId: string | null;
  /** Human label for where it appears: an entry's title and date, or "the book cover". */
  where: string;
  mediaId: string;
  fileName: string;
  ppi?: number;
  message: string;
}

export interface PrintDocument {
  /** `<body>` content. */
  html: string;
  css: string;
  /** Language for the `<html lang>` attribute. */
  lang: string;
  images: ImageUse[];
  warnings: PrintWarning[];
}

interface MediaSource {
  media: ReadonlyMap<string, MediaMeta>;
  /** URL the renderer loads for a media id, or null when the bytes are missing. */
  mediaUrl: (mediaId: string) => string | null;
}

export interface InteriorInput extends MediaSource {
  options: BookOptions;
  /** Already selected and ordered (see selectEntries). */
  entries: readonly Entry[];
  gutterIn: number;
  notesPages: number;
  /** Browser preview: simulate a black-and-white interior with a CSS filter (the server converts images instead). */
  preview?: boolean;
}

export interface CoverInput extends MediaSource {
  options: BookOptions;
  entries: readonly Entry[];
  pageCount: number;
  dims: CoverDimensions;
}

const POLAROID_PAD_IN = 0.08;
const GAP_IN = 0.1;
const QR_IN = 0.75;
const NOTE_LINE_IN = 0.32;

/** The book's interior as HTML + print CSS. Paginated by Paged.js in both the preview and the server. */
export function interiorDocument(input: InteriorInput): PrintDocument {
  const { options, entries } = input;
  const geo = interiorGeometry(options.product.trim, input.gutterIn);
  const ctx = new Ctx(input, geo, options);
  const parts: string[] = [titlePage(options, entries), versoPage(options, entries)];
  if (options.contents && entries.length) parts.push(contents(entries, options.locale));
  for (const e of entries) parts.push(entryHtml(e, ctx));
  for (let i = 0; i < input.notesPages; i++) parts.push(notesPage(geo));
  return {
    html: parts.join('\n'),
    css: interiorCss(geo, options.product, { preview: input.preview ?? false }),
    lang: options.locale,
    images: ctx.images,
    warnings: ctx.warnings,
  };
}

/** The wraparound cover: back, spine and front on one sheet sized from `/cover-dimensions/`. */
export function coverDocument(input: CoverInput): PrintDocument & { geometry: CoverGeometry } {
  const { options } = input;
  const geo = coverGeometry(options.product, input.pageCount, input.dims);
  const ctx = new Ctx(input, interiorGeometry(options.product.trim, 0), options);
  const cover = options.cover;
  const range = dateRangeLabel(input.entries, options.locale);
  const gradient = cover.kind === 'gradient' ? GRADIENTS[cover.gradient] : null;
  const tone = gradient ? gradient.ink : 'light';

  let art = '';
  if (cover.kind === 'photo') {
    // The photo fills the front panel out to the sheet edge (bleed included); back and spine are solid.
    const box: ImageBox = { widthIn: round3(geo.widthIn - geo.front.xIn), heightIn: geo.heightIn, fit: 'cover' };
    art = `<div class="cover-photo" style="left:${geo.front.xIn}in;width:${box.widthIn}in;height:${box.heightIn}in">${ctx.img(cover.mediaId, box, null, 'the book cover')}</div>`;
  }
  const bandClass = cover.kind === 'photo' ? ' front-band' : '';
  const spine =
    options.spineText && geo.spineText
      ? `<div class="spine" style="left:${geo.spine.xIn}in;width:${geo.spineIn}in"><p class="spine-text" style="font-size:${spineFontPt(geo.spineIn)}pt">${esc(options.title)}${options.author ? `<span class="spine-author">${esc(options.author)}</span>` : ''}</p></div>`
      : '';
  const html = `<div class="sheet tone-${tone}" style="width:${geo.widthIn}in;height:${geo.heightIn}in;background:${gradient ? gradient.css : '#1d1a17'}">
${art}
<div class="panel back" style="left:${geo.back.xIn}in;width:${geo.back.widthIn}in"><div class="back-meta">${range ? `<p>${esc(range)}</p>` : ''}<p>${input.entries.length} ${input.entries.length === 1 ? 'entry' : 'entries'}</p></div></div>
${spine}
<div class="panel front${bandClass}" style="left:${geo.front.xIn}in;width:${geo.front.widthIn}in"><div class="front-title"><h1>${esc(options.title)}</h1>${options.subtitle ? `<p class="subtitle">${esc(options.subtitle)}</p>` : ''}${options.author ? `<p class="author">${esc(options.author)}</p>` : ''}</div></div>
</div>`;
  return { html, css: coverCss(geo), lang: options.locale, images: ctx.images, warnings: ctx.warnings, geometry: geo };
}

/** A complete HTML page for a PrintDocument. `head` carries font-face rules and, for paginated output, Paged.js. */
export function standaloneHtml(doc: PrintDocument, head = ''): string {
  return `<!doctype html>
<html lang="${esc(doc.lang)}">
<head>
<meta charset="utf-8">
${head}
<style>${doc.css}</style>
</head>
<body>
${doc.html}
</body>
</html>`;
}

/** Shared state while rendering one document: image uses and warnings. */
class Ctx {
  readonly images: ImageUse[] = [];
  readonly warnings: PrintWarning[] = [];
  private readonly src: MediaSource;
  readonly geo: InteriorGeometry;
  readonly options: BookOptions;
  constructor(src: MediaSource, geo: InteriorGeometry, options: BookOptions) {
    this.src = src;
    this.geo = geo;
    this.options = options;
  }

  meta(id: string): MediaMeta | undefined {
    return this.src.media.get(id);
  }

  /** An <img> at an exact size, or a placeholder; records the use and any warning. */
  img(mediaId: string, box: ImageBox, entry: Entry | null, whereOverride?: string): string {
    const meta = this.src.media.get(mediaId);
    const url = meta ? this.src.mediaUrl(mediaId) : null;
    const fileName = meta?.name ?? 'a photo';
    const where = whereOverride ?? (entry ? entryLabel(entry, this.options.locale) : 'the book cover');
    const warn = (kind: PrintWarning['kind'], message: string, ppi?: number) =>
      this.warnings.push({ kind, entryId: entry?.id ?? null, where, mediaId, fileName, message, ...(ppi === undefined ? {} : { ppi }) });
    const size = `width:${box.widthIn}in;height:${box.heightIn}in`;

    if (!meta || !url) {
      warn('missing-media', `${quote(fileName)} in ${where} is missing from this journal, so a blank space will print instead.`);
      return placeholder(size, 'Image missing');
    }
    if (!PRINTABLE_IMAGE_TYPES.has(meta.mime)) {
      warn('unsupported-image', `${quote(fileName)} in ${where} is a ${meta.mime || 'file'} image, which can't be printed. Convert it to JPEG or PNG and add it again.`);
      return placeholder(size, fileName);
    }
    const ppi = effectivePpi(meta, box);
    this.images.push({ ...box, mediaId, fileName: meta.name, ppi });
    if (ppi === null) warn('unknown-size', `Logbook couldn't read the size of ${quote(fileName)} in ${where}, so it can't check its print quality.`);
    else if (ppi < MIN_PPI) warn('low-resolution', `${quote(fileName)} in ${where} prints at ${ppi} PPI, below the ${MIN_PPI} PPI Lulu recommends. It may look soft or blocky.`, ppi);
    const fit = box.fit === 'cover' ? ';object-fit:cover' : '';
    return `<img src="${esc(url)}" alt="${esc(meta.name)}" style="${size}${fit}">`;
  }
}

function titlePage(o: BookOptions, entries: readonly Entry[]): string {
  const range = dateRangeLabel(entries, o.locale);
  return `<section class="front title-page">
<div class="title-block"><h1 class="book-title">${esc(o.title)}</h1>${o.subtitle ? `<p class="book-subtitle">${esc(o.subtitle)}</p>` : ''}${o.author ? `<p class="book-author">${esc(o.author)}</p>` : ''}</div>
${range ? `<p class="book-dates">${esc(range)}</p>` : ''}
</section>`;
}

function versoPage(o: BookOptions, entries: readonly Entry[]): string {
  const n = entries.length;
  return `<section class="front verso"><p>${esc(o.title)}${o.author ? ` · ${esc(o.author)}` : ''}</p><p>${n} journal ${n === 1 ? 'entry' : 'entries'}, made into a book with Logbook.</p></section>`;
}

function contents(entries: readonly Entry[], locale: string): string {
  const items = entries
    .map((e) => {
      const date = formatPrintDate(e.date, locale, { day: 'numeric', month: 'short', year: 'numeric' });
      return `<li><a href="#${anchor(e)}"><span class="toc-date">${esc(date)}</span><span class="toc-title">${esc(e.title || 'Untitled')}</span></a></li>`;
    })
    .join('');
  return `<nav class="front toc" aria-label="Contents"><h2>Contents</h2><ol>${items}</ol></nav>`;
}

function notesPage(geo: InteriorGeometry): string {
  const lines = Math.max(1, Math.floor((geo.textHeightIn - 0.75) / NOTE_LINE_IN));
  return `<section class="notes-page"><h2>Notes</h2><div class="rules">${'<div class="rule"></div>'.repeat(lines)}</div></section>`;
}

function entryHtml(e: Entry, ctx: Ctx): string {
  const { geo, options } = ctx;
  const notes = new LinkNotes();
  const date = formatPrintDate(e.date, options.locale);
  let head = '';
  if (e.cover.kind === 'gradient') {
    const css = GRADIENTS[e.cover.gradient].css;
    head += `<div class="entry-band" style="background:${options.product.interior === 'bw' ? grayscaleGradient(css) : css}"></div>`;
  } else {
    head += `<figure class="entry-hero">${ctx.img(e.cover.mediaId, { widthIn: geo.textWidthIn, heightIn: round3(geo.textWidthIn * 0.5), fit: 'cover' }, e)}</figure>`;
  }
  head += `<p class="entry-date">${esc(date)}${e.mood ? ` <span class="mood" role="img" aria-label="mood">${e.mood}</span>` : ''}</p>`;
  if (e.title) head += `<h2 class="entry-title">${esc(e.title)}</h2>`;
  if (e.tags.length) head += `<p class="entry-tags">${e.tags.map((t) => `#${esc(t)}`).join(' ')}</p>`;

  const body = e.blocks.map((b) => blockHtml(b, e, ctx, notes)).join('\n');
  return `<article class="entry" id="${anchor(e)}"><header class="entry-head">${head}</header>\n${body}${notes.html()}</article>`;
}

function blockHtml(b: Block, e: Entry, ctx: Ctx, notes: LinkNotes): string {
  const { geo } = ctx;
  switch (b.type) {
    case 'text':
      return `<div class="rich">${richHtml(b.doc, notes)}</div>`;
    case 'photo': {
      const box = containBox(ctx.meta(b.mediaId), geo.textWidthIn - 2 * POLAROID_PAD_IN - 0.04, round3(geo.textHeightIn * 0.62));
      return `<figure class="photo"><div class="polaroid">${ctx.img(b.mediaId, box, e)}</div>${caption(b.caption)}</figure>`;
    }
    case 'gallery':
      return galleryHtml(b, e, ctx);
    case 'video': {
      const meta = ctx.meta(b.mediaId);
      const dur = meta?.durationMs ? formatDuration(meta.durationMs) : '';
      if (meta?.posterId && ctx.meta(meta.posterId)) {
        const box = containBox(ctx.meta(meta.posterId), geo.textWidthIn, round3(geo.textHeightIn * 0.45));
        return `<figure class="video"><div class="poster">${ctx.img(meta.posterId, box, e)}<span class="badge">${ICONS.play}${dur ? ` ${esc(dur)}` : ' Video'}</span></div>${caption(b.caption)}</figure>`;
      }
      return mediaCard('video', ICONS.film, meta?.name ?? 'Video', ['Video', dur].filter(Boolean).join(' · '), b.caption);
    }
    case 'audio': {
      const meta = ctx.meta(b.mediaId);
      const dur = meta?.durationMs ? formatDuration(meta.durationMs) : '';
      return mediaCard('audio', ICONS.mic, meta?.name ?? 'Audio recording', ['Audio', dur].filter(Boolean).join(' · '), b.caption, waveform(b.mediaId));
    }
    case 'file': {
      const meta = ctx.meta(b.mediaId);
      return `<div class="file-tag">${ICONS.clip}<span class="file-name">${esc(meta?.name ?? 'Attached file')}</span>${meta ? `<span class="file-size">${esc(formatBytes(meta.bytes))}</span>` : ''}</div>${caption(b.caption, 'p')}`;
    }
    case 'link':
      return linkCard('link', '', b.title || hostOf(b.url), b.url, b.caption);
    case 'embed':
      return linkCard('embed', b.provider === 'youtube' ? 'YouTube video' : 'Vimeo video', b.title || hostOf(b.url), b.url, b.caption);
  }
}

/** Grid: equal square cells. Collage: a repeating wide / two halves / three thirds rhythm. Rows never split across pages. */
function galleryHtml(b: Extract<Block, { type: 'gallery' }>, e: Entry, ctx: Ctx): string {
  const W = ctx.geo.textWidthIn;
  const rows: { cols: number; heightIn: number; items: typeof b.items }[] = [];
  if (b.layout === 'grid') {
    const cols = b.items.length <= 1 ? 1 : ctx.geo.trimWidthIn > 7 && b.items.length > 4 ? 3 : 2;
    const cell = round3((W - (cols - 1) * GAP_IN) / cols);
    for (let i = 0; i < b.items.length; i += cols) rows.push({ cols, heightIn: cols === 1 ? round3(W * 0.66) : cell, items: b.items.slice(i, i + cols) });
  } else {
    const pattern = [1, 2, 3];
    let i = 0;
    for (let r = 0; i < b.items.length; r++) {
      const cols = pattern[r % 3]!;
      const cell = (W - (cols - 1) * GAP_IN) / cols;
      rows.push({ cols, heightIn: round3(cols === 1 ? W * 0.56 : cols === 2 ? cell * 0.85 : cell * 1.25), items: b.items.slice(i, i + cols) });
      i += cols;
    }
  }
  const html = rows
    .map((row) => {
      const cellW = round3((W - (row.cols - 1) * GAP_IN) / row.cols);
      const cells = row.items
        .map((it) => `<div class="g-cell" style="width:${cellW}in">${ctx.img(it.mediaId, { widthIn: cellW, heightIn: row.heightIn, fit: 'cover' }, e)}${it.caption ? `<p class="g-cap">${esc(it.caption)}</p>` : ''}</div>`)
        .join('');
      return `<div class="g-row">${cells}</div>`;
    })
    .join('');
  return `<figure class="gallery ${b.layout}">${html}${caption(b.caption)}</figure>`;
}

function mediaCard(kind: string, icon: string, title: string, kicker: string, cap: string, extra = ''): string {
  return `<figure class="media-card ${kind}"><div class="card-body">${icon}<div class="card-text"><p class="kicker">${esc(kicker)}</p><p class="card-title">${esc(title)}</p></div></div>${extra}${caption(cap)}</figure>`;
}

function linkCard(kind: string, kicker: string, title: string, url: string, cap: string): string {
  const qr = /^https?:/i.test(url) ? qrSvg(url, QR_IN, `QR code for ${shortUrl(url)}`) : '';
  return `<figure class="link-card ${kind}">${qr}<div class="card-text">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<p class="card-title">${esc(title)}</p><p class="card-url">${esc(shortUrl(url))}</p>${cap ? `<p class="card-cap">${esc(cap)}</p>` : ''}</div></figure>`;
}

function caption(text: string, tag: 'figcaption' | 'p' = 'figcaption'): string {
  return text ? `<${tag} class="caption">${esc(text)}</${tag}>` : '';
}

function placeholder(size: string, label: string): string {
  return `<span class="img-missing" style="${size}"><span>${esc(label)}</span></span>`;
}

/** Decorative bars, seeded from the media id so a recording always prints the same shape. Not a real waveform. */
function waveform(seed: string): string {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const bars: string[] = [];
  for (let i = 0; i < 48; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const v = 0.25 + ((h % 1000) / 1000) * 0.75 * Math.sin(((i + 1) / 49) * Math.PI);
    const height = Math.max(0.12, v);
    bars.push(`<rect x="${i * 2}" y="${round3((1 - height) * 10)}" width="1.2" height="${round3(height * 20)}" rx="0.6"/>`);
  }
  return `<svg class="wave" viewBox="0 0 96 40" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(0 10)">${bars.join('')}</g></svg>`;
}

/** Inline links print as text with a superscript number; the numbers resolve to URLs and QR codes after the entry. */
class LinkNotes {
  private readonly urls: string[] = [];
  number(url: string): number {
    const i = this.urls.indexOf(url);
    if (i >= 0) return i + 1;
    this.urls.push(url);
    return this.urls.length;
  }
  html(): string {
    if (!this.urls.length) return '';
    const items = this.urls
      .map((u, i) => {
        const qr = /^https?:/i.test(u) ? qrSvg(u, 0.55, `QR code for ${shortUrl(u)}`) : '';
        return `<li>${qr}<span class="note-num">${i + 1}</span><span class="note-url">${esc(shortUrl(u))}</span></li>`;
      })
      .join('');
    return `<aside class="link-notes"><h3>Links</h3><ol>${items}</ol></aside>`;
  }
}

/** TipTap JSON → HTML. Headings shift down a level: the entry title is the h2. */
export function richHtml(node: RichNode | undefined, notes: LinkNotes = new LinkNotes()): string {
  if (!node) return '';
  const kids = () => inline(node.content ?? [], notes);
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((n) => richHtml(n, notes)).join('');
    case 'paragraph':
      return `<p>${kids() || '&#8203;'}</p>`;
    case 'heading': {
      const level = Number(node.attrs?.['level']) >= 3 ? 4 : 3;
      return `<h${level}>${kids()}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${(node.content ?? []).map((n) => richHtml(n, notes)).join('')}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.['start'] ?? 1);
      return `<ol${start > 1 ? ` start="${start}"` : ''}>${(node.content ?? []).map((n) => richHtml(n, notes)).join('')}</ol>`;
    }
    case 'listItem':
      return `<li>${(node.content ?? []).map((n) => richHtml(n, notes)).join('')}</li>`;
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map((n) => richHtml(n, notes)).join('')}</blockquote>`;
    case 'horizontalRule':
      return '<hr>';
    case 'text':
    case 'hardBreak':
      return inline([node], notes);
    default:
      // Unknown node from a future editor version: keep its text.
      return (node.content ?? []).map((n) => richHtml(n, notes)).join('');
  }
}

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', underline: 'u' };

function inline(nodes: readonly RichNode[], notes: LinkNotes): string {
  let out = '';
  let openHref: string | null = null;
  const close = () => {
    if (openHref !== null) out += `</span><sup class="link-ref">${notes.number(openHref)}</sup>`;
    openHref = null;
  };
  for (const n of nodes) {
    const href = n.marks?.find((m) => m.type === 'link')?.attrs?.['href'];
    const h = typeof href === 'string' && href ? href : null;
    if (h !== openHref) {
      close();
      if (h !== null) {
        out += '<span class="ilink">';
        openHref = h;
      }
    }
    if (n.type === 'hardBreak') {
      out += '<br>';
      continue;
    }
    if (n.type !== 'text') {
      out += richHtml(n, notes);
      continue;
    }
    let t = esc(n.text ?? '');
    for (const m of n.marks ?? []) {
      const tag = MARK_TAGS[m.type];
      if (tag) t = `<${tag}>${t}</${tag}>`;
    }
    out += t;
  }
  close();
  return out;
}

export function shortUrl(url: string, max = 48): string {
  const s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Gradient stops converted to their luminance grey, for black-and-white interiors. */
export function grayscaleGradient(css: string): string {
  return css.replace(/#([0-9a-f]{6})\b/gi, (_, hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
      .toString(16)
      .padStart(2, '0');
    return `#${y}${y}${y}`;
  });
}

function spineFontPt(spineIn: number): number {
  return Math.max(6, Math.min(14, Math.floor(spineIn * 72 * 0.42)));
}

function entryLabel(e: Entry, locale: string): string {
  return `${quote(e.title || 'Untitled')} (${formatPrintDate(e.date, locale, { day: 'numeric', month: 'short', year: 'numeric' })})`;
}

function anchor(e: Entry): string {
  return `e-${e.id.replace(/[^a-z0-9_-]/gi, '')}`;
}

function quote(s: string): string {
  return `“${s}”`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Simple solid icons (no emoji font needed, no transparency). */
const icon = (d: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
const ICONS = {
  play: icon('M7 4.5v15l13-7.5z'),
  film: icon('M3 5h18v14H3zM5 7v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2zm12-8v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2zM9 7v10h6V7z'),
  mic: icon('M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h3v2H8v-2h3v-3.1A7 7 0 0 1 5 11z'),
  clip: icon('M16.5 6.5v9.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10a1.5 1.5 0 0 1-3 0V6.5h-2V15a3.5 3.5 0 0 0 7 0V5a5 5 0 0 0-10 0v11a6.5 6.5 0 0 0 13 0V6.5z'),
};
