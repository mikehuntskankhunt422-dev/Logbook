import { formatBytes, formatDuration } from '../media.ts';
import type { Block, MediaMeta } from '../model.ts';
import { galleryColumns, type PageGeometry } from './geometry.ts';
import { aspectOf, esc, inch, shortUrl } from './html.ts';
import { qrSvg } from './qr.ts';
import { richTextToHtml } from './richtext-html.ts';

/** What a renderer supplies: the browser preview passes thumbnails, the server print-resolution files. */
export interface PrintAssets {
  /** URL of an image to place; undefined when the file isn't available (a same-size placeholder prints). */
  imageUrl(mediaId: string): string | undefined;
  /** YouTube/Vimeo thumbnail, fetched by the server at render time. The preview has none; the box is the same size. */
  embedThumbnailUrl?(block: Extract<Block, { type: 'embed' }>): string | undefined;
  /** Waveform peaks in 0–1, computed on the device when the bundle is prepared. */
  audioPeaks?(mediaId: string): number[] | undefined;
}

export interface BlockContext {
  geometry: PageGeometry;
  meta(id: string): MediaMeta | undefined;
  assets: PrintAssets;
  /** Link addresses collected for this entry's notes. */
  links: string[];
}

/**
 * Print HTML for one block, with the fallbacks from PLAN §1.4. Sizes come from stored dimensions,
 * never from loaded pixels, so a thumbnail and a 4000 px original lay out identically (D37).
 */
export function blockHtml(b: Block, ctx: BlockContext): string {
  switch (b.type) {
    case 'text':
      return `<div class="text">${richTextToHtml(b.doc, ctx.links)}</div>`;
    case 'photo':
      return figure('photo', photoImg(b.mediaId, ctx), b.caption);
    case 'gallery':
      return galleryHtml(b, ctx);
    case 'video':
      return videoHtml(b, ctx);
    case 'audio':
      return audioHtml(b, ctx);
    case 'file': {
      const m = ctx.meta(b.mediaId);
      const body = `<div class="file-tag">${ICONS.file}<span class="file-name">${esc(m?.name ?? 'File')}</span><span class="file-size">${m ? formatBytes(m.bytes) : ''}</span></div>`;
      return figure('file', body, b.caption);
    }
    case 'link': {
      const title = b.title || shortUrl(b.url).split('/')[0]!;
      const body = `<div class="link-card">${qrSvg(b.url, `QR code for ${shortUrl(b.url)}`)}<div class="link-text"><p class="link-title">${esc(title)}</p><p class="url">${esc(shortUrl(b.url))}</p></div></div>`;
      return figure('link', body, b.caption);
    }
    case 'embed':
      return embedHtml(b, ctx);
  }
}

function figure(kind: string, body: string, caption: string): string {
  return `<figure class="${kind}">${body}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}

/** An image that shows whole within the photo box; width from its aspect ratio, height follows. */
function photoImg(mediaId: string, ctx: BlockContext, extraClass = ''): string {
  const meta = ctx.meta(mediaId);
  const a = aspectOf(meta);
  const style = `width:min(100%, ${inch((ctx.geometry.photoMaxHeight * a.w) / a.h)});aspect-ratio:${a.w} / ${a.h}`;
  return img(mediaId, meta, ctx, `contained ${extraClass}`.trim(), style);
}

function img(mediaId: string, meta: MediaMeta | undefined, ctx: BlockContext, cls: string, style = ''): string {
  const url = ctx.assets.imageUrl(mediaId);
  const s = style ? ` style="${style}"` : '';
  if (!url) return `<div class="missing ${cls}"${s}><span>Missing image${meta ? `: ${esc(meta.name)}` : ''}</span></div>`;
  return `<img class="${cls}" src="${esc(url)}" alt=""${s}>`;
}

function galleryHtml(b: Extract<Block, { type: 'gallery' }>, ctx: BlockContext): string {
  const items = b.items;
  if (!items.length) return b.caption ? figure('gallery', '', b.caption) : '';
  if (items.length === 1) return figure('photo', photoImg(items[0]!.mediaId, ctx) + itemCaption(items[0]!.caption), b.caption);
  const cell = (item: (typeof items)[number], cls = 'cell') =>
    `<div class="${cls}">${img(item.mediaId, ctx.meta(item.mediaId), ctx, 'cover')}${itemCaption(item.caption)}</div>`;
  if (b.layout === 'collage') {
    const [lead, ...rest] = items;
    const restHtml = rest.length ? rows(rest.map((i) => cell(i)), 3) : '';
    return figure('gallery collage', cell(lead!, 'lead') + restHtml, b.caption);
  }
  return figure('gallery', rows(items.map((i) => cell(i)), galleryColumns(items.length)), b.caption);
}

/** Galleries are rows of cells rather than a CSS grid, so a long gallery breaks cleanly between pages. */
function rows(cells: string[], cols: number): string {
  let out = '';
  for (let i = 0; i < cells.length; i += cols) out += `<div class="row">${cells.slice(i, i + cols).join('')}</div>`;
  return `<div class="cells cols-${cols}">${out}</div>`;
}

function itemCaption(c: string): string {
  return c ? `<p class="item-caption">${esc(c)}</p>` : '';
}

function videoHtml(b: Extract<Block, { type: 'video' }>, ctx: BlockContext): string {
  const m = ctx.meta(b.mediaId);
  const label = `<p class="media-label">${ICONS.video}<span>Video${m?.durationMs ? ` · ${formatDuration(m.durationMs)}` : ''}</span></p>`;
  if (m?.posterId) {
    const poster = ctx.meta(m.posterId);
    const a = aspectOf(poster ?? m);
    const style = `width:min(100%, ${inch((ctx.geometry.photoMaxHeight * a.w) / a.h)});aspect-ratio:${a.w} / ${a.h}`;
    const body = `<div class="poster" style="${style}">${img(m.posterId, poster, ctx, 'cover')}${ICONS.play}</div>${label}`;
    return figure('video', body, b.caption);
  }
  return figure('video', `<div class="media-card">${ICONS.video}<span class="file-name">${esc(m?.name ?? 'Video')}</span></div>${label}`, b.caption);
}

function audioHtml(b: Extract<Block, { type: 'audio' }>, ctx: BlockContext): string {
  const m = ctx.meta(b.mediaId);
  const peaks = ctx.assets.audioPeaks?.(b.mediaId);
  const wave = peaks?.length ? waveformSvg(peaks) : '<div class="waveform"></div>';
  const body =
    `<div class="audio-card">${ICONS.audio}<div class="audio-body"><p class="file-name">${esc(m?.name ?? 'Audio')}</p>${wave}` +
    `<p class="media-label"><span>Audio${m?.durationMs ? ` · ${formatDuration(m.durationMs)}` : ''}</span></p></div></div>`;
  return figure('audio', body, b.caption);
}

/** Bars from 0–1 peaks, one opaque path. The card is the same height with or without it. */
export function waveformSvg(peaks: number[]): string {
  const n = Math.min(peaks.length, 120);
  const step = peaks.length / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = Math.max(0.04, Math.min(1, peaks[Math.floor(i * step)] ?? 0));
    const h = Math.round(p * 1000) / 100;
    d += `M${i * 2} ${(10 - h) / 2}h1.2v${h}h-1.2z`;
  }
  return `<svg class="waveform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * 2} 10" preserveAspectRatio="none" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

function embedHtml(b: Extract<Block, { type: 'embed' }>, ctx: BlockContext): string {
  const provider = b.provider === 'youtube' ? 'YouTube' : 'Vimeo';
  const thumb = ctx.assets.embedThumbnailUrl?.(b);
  const screen = thumb
    ? `<img class="cover" src="${esc(thumb)}" alt="">${ICONS.play}`
    : `<div class="embed-card"><p class="embed-provider">${provider}</p><p class="embed-title">${esc(b.title || 'Video')}</p></div>`;
  const body =
    `<div class="embed-screen" style="width:min(100%, ${inch(ctx.geometry.embedMaxWidth)})">${screen}</div>` +
    `<div class="link-card">${qrSvg(b.url, `QR code for ${shortUrl(b.url)}`)}<div class="link-text"><p class="link-title">${esc(b.title || `Watch on ${provider}`)}</p><p class="url">${esc(shortUrl(b.url))}</p></div></div>`;
  return figure('embed', body, b.caption);
}

/** Small opaque line icons. Text glyphs like ▶ are avoided: they can fall back to a colour emoji font. */
const svg = (body: string, cls = 'icon') =>
  `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  file: svg(`<path ${stroke} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path ${stroke} d="M14 3v5h5"/>`),
  video: svg(`<rect ${stroke} x="3" y="6" width="13" height="12" rx="2"/><path ${stroke} d="M16 10l5-3v10l-5-3z"/>`),
  audio: svg(`<path ${stroke} d="M9 18V5l11-2v13"/><circle ${stroke} cx="6" cy="18" r="3"/><circle ${stroke} cx="17" cy="16" r="3"/>`),
  play: svg('<circle cx="12" cy="12" r="11" fill="#ffffff"/><path fill="#1d1a17" d="M9.5 7.5v9l7-4.5z"/>', 'play'),
};
