import type { Entry, MediaMeta } from '../model.ts';
import { galleryColumns, type PageGeometry } from './geometry.ts';
import { aspectOf } from './html.ts';
import type { BookOptions } from './options.ts';

/** Lulu wants images at 300–600 PPI at their placed size (L3 p.23). */
export const MIN_PPI = 300;
export const MAX_PPI = 600;

export type Fit = 'contain' | 'cover';

export interface Placement {
  width: number;
  height: number;
  fit: Fit;
}

/**
 * Effective resolution of an image placed in a box. `contain` shows the whole image (scaled until
 * one side meets the box); `cover` fills the box and crops (scaled until both sides cover it).
 */
export function effectivePpi(px: { width: number; height: number }, box: Placement): number {
  const sx = px.width / box.width;
  const sy = px.height / box.height;
  return box.fit === 'contain' ? Math.max(sx, sy) : Math.min(sx, sy);
}

/** The box each kind of image is placed in. Must match print-css.ts and blocks-html.ts. */
export const place = {
  photo(g: PageGeometry): Placement {
    return { width: g.textWidth, height: g.photoMaxHeight, fit: 'contain' };
  },
  galleryCell(g: PageGeometry, items: number): Placement {
    const cols = galleryColumns(items);
    const w = (g.textWidth - g.galleryGap * (cols - 1)) / cols;
    return { width: w, height: w, fit: 'cover' };
  },
  collageLead(g: PageGeometry): Placement {
    return { width: g.textWidth, height: (g.textWidth * 2) / 3, fit: 'cover' };
  },
  entryBand(g: PageGeometry): Placement {
    return { width: g.textWidth, height: g.entryBandHeight, fit: 'cover' };
  },
  frontCover(g: Pick<PageGeometry, 'trimWidth' | 'trimHeight' | 'bleed'>): Placement {
    return { width: g.trimWidth + g.bleed, height: g.trimHeight + 2 * g.bleed, fit: 'cover' };
  },
};

/** Width of a `contain` image in its box, from the stored aspect ratio. Used for inline sizes. */
export function containedWidth(meta: MediaMeta | undefined, box: Placement): number {
  const a = aspectOf(meta);
  return Math.min(box.width, (box.height * a.w) / a.h);
}

export type ImageUse = 'photo' | 'gallery' | 'video poster' | 'entry cover' | 'book cover';

export interface ImagePlacement {
  mediaId: string;
  box: Placement;
  where: ImageUse;
  entry?: Entry;
  /** The media record whose file name a person recognises (the video, for a poster frame). */
  named?: MediaMeta;
}

/** Every place a book prints an image, with its box. Must match blocks-html.ts. */
export function imagePlacements(entries: Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined, g: PageGeometry): ImagePlacement[] {
  const out: ImagePlacement[] = [];
  if (options.cover.kind === 'photo') out.push({ mediaId: options.cover.mediaId, box: place.frontCover(g), where: 'book cover' });
  for (const entry of entries) {
    if (entry.cover.kind === 'photo') out.push({ mediaId: entry.cover.mediaId, box: place.entryBand(g), where: 'entry cover', entry });
    for (const b of entry.blocks) {
      if (b.type === 'photo') out.push({ mediaId: b.mediaId, box: place.photo(g), where: 'photo', entry });
      if (b.type === 'video') {
        const video = metaOf(b.mediaId);
        if (video?.posterId) out.push({ mediaId: video.posterId, box: place.photo(g), where: 'video poster', entry, named: video });
      }
      if (b.type === 'gallery') {
        b.items.forEach((item, i) => {
          const box =
            b.items.length === 1
              ? place.photo(g)
              : b.layout === 'collage' && i === 0
                ? place.collageLead(g)
                : place.galleryCell(g, b.layout === 'collage' ? 3 : b.items.length);
          out.push({ mediaId: item.mediaId, box, where: 'gallery', entry });
        });
      }
    }
  }
  return out;
}

export interface ImageWarning {
  mediaId: string;
  /** The file name the person recognises. */
  name: string;
  where: ImageUse;
  entryId?: string;
  entryDate?: string;
  entryTitle?: string;
  /** null when the stored record has no pixel dimensions. */
  ppi: number | null;
}

/** Every image that would print below 300 PPI, worst first. */
export function imageWarnings(entries: Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined, g: PageGeometry): ImageWarning[] {
  const out: ImageWarning[] = [];
  for (const p of imagePlacements(entries, options, metaOf, g)) {
    const meta = metaOf(p.mediaId);
    if (!meta) continue;
    const ppi = meta.width && meta.height ? effectivePpi({ width: meta.width, height: meta.height }, p.box) : null;
    if (ppi !== null && ppi >= MIN_PPI) continue;
    out.push({
      mediaId: p.mediaId,
      name: (p.named ?? meta).name,
      where: p.where,
      entryId: p.entry?.id,
      entryDate: p.entry?.date,
      entryTitle: p.entry?.title,
      ppi: ppi === null ? null : Math.floor(ppi),
    });
  }
  return out.sort((a, b) => (a.ppi ?? -1) - (b.ppi ?? -1));
}

/**
 * Pixel size to resample an image to for print: enough for `ppi` at its largest placement, never
 * larger than the original (upscaling adds no detail; the builder warns instead).
 */
export function printPixelSize(px: { width: number; height: number }, boxes: Placement[], ppi = MAX_PPI): { width: number; height: number } {
  let need = 0;
  for (const box of boxes) {
    const inchesPerPx = box.fit === 'contain' ? Math.min(box.width / px.width, box.height / px.height) : Math.max(box.width / px.width, box.height / px.height);
    need = Math.max(need, Math.ceil(px.width * inchesPerPx * ppi));
  }
  if (!need || need >= px.width) return { width: px.width, height: px.height };
  return { width: need, height: Math.max(1, Math.round((px.height * need) / px.width)) };
}
