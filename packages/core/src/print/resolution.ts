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

export interface ImageWarning {
  mediaId: string;
  /** The file name the person recognises. */
  name: string;
  where: 'photo' | 'gallery' | 'video poster' | 'entry cover' | 'book cover';
  entryId?: string;
  entryDate?: string;
  entryTitle?: string;
  /** null when the stored record has no pixel dimensions. */
  ppi: number | null;
}

/** Every image that would print below 300 PPI, worst first. */
export function imageWarnings(entries: Entry[], options: BookOptions, metaOf: (id: string) => MediaMeta | undefined, g: PageGeometry): ImageWarning[] {
  const out: ImageWarning[] = [];
  const check = (mediaId: string, box: Placement, where: ImageWarning['where'], entry?: Entry, nameFrom?: MediaMeta) => {
    const meta = metaOf(mediaId);
    if (!meta) return;
    const ppi = meta.width && meta.height ? effectivePpi({ width: meta.width, height: meta.height }, box) : null;
    if (ppi !== null && ppi >= MIN_PPI) return;
    out.push({
      mediaId,
      name: (nameFrom ?? meta).name,
      where,
      entryId: entry?.id,
      entryDate: entry?.date,
      entryTitle: entry?.title,
      ppi: ppi === null ? null : Math.floor(ppi),
    });
  };
  if (options.cover.kind === 'photo') check(options.cover.mediaId, place.frontCover(g), 'book cover');
  for (const e of entries) {
    if (e.cover.kind === 'photo') check(e.cover.mediaId, place.entryBand(g), 'entry cover', e);
    for (const b of e.blocks) {
      if (b.type === 'photo') check(b.mediaId, place.photo(g), 'photo', e);
      if (b.type === 'video') {
        const video = metaOf(b.mediaId);
        if (video?.posterId) check(video.posterId, place.photo(g), 'video poster', e, video);
      }
      if (b.type === 'gallery') {
        b.items.forEach((item, i) => {
          if (b.items.length === 1) check(item.mediaId, place.photo(g), 'gallery', e);
          else if (b.layout === 'collage' && i === 0) check(item.mediaId, place.collageLead(g), 'gallery', e);
          else check(item.mediaId, place.galleryCell(g, b.layout === 'collage' ? 3 : b.items.length), 'gallery', e);
        });
      }
    }
  }
  return out.sort((a, b) => (a.ppi ?? -1) - (b.ppi ?? -1));
}
