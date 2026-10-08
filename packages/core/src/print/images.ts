import type { MediaMeta } from '../model.ts';

/** Lulu wants 300–600 PPI at the placed size (L3 p.23). */
export const MIN_PPI = 300;
export const MAX_PPI = 600;

/** Formats Chromium can draw and the server can resample. HEIC and friends get a placeholder and a warning. */
export const PRINTABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export interface ImageBox {
  widthIn: number;
  heightIn: number;
  /** `contain`: the box has the image's aspect ratio. `cover`: the image fills the box and is cropped. */
  fit: 'contain' | 'cover';
}

export interface ImageUse extends ImageBox {
  mediaId: string;
  fileName: string;
  /** Effective resolution where it's placed; null when the image's pixel size is unknown. */
  ppi: number | null;
}

/** Largest box with the image's aspect ratio inside maxW × maxH. Unknown sizes are treated as 4:3. */
export function containBox(meta: Pick<MediaMeta, 'width' | 'height'> | undefined, maxW: number, maxH: number): ImageBox {
  const aspect = meta?.width && meta.height ? meta.width / meta.height : 4 / 3;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { widthIn: round3(w), heightIn: round3(h), fit: 'contain' };
}

/** Pixels per inch along the limiting axis. For `cover` that's the axis that just fills the box. */
export function effectivePpi(meta: Pick<MediaMeta, 'width' | 'height'> | undefined, box: Pick<ImageBox, 'widthIn' | 'heightIn'>): number | null {
  if (!meta?.width || !meta.height) return null;
  return Math.round(Math.min(meta.width / box.widthIn, meta.height / box.heightIn));
}

/**
 * Pixel size to resample each image to: enough for MAX_PPI at its largest placement, never upscaled.
 * An image placed twice (say as a photo and the book cover) keeps the larger requirement.
 */
export function resampleTargets(uses: readonly ImageUse[], media: ReadonlyMap<string, MediaMeta>): Map<string, { widthPx: number; heightPx: number }> {
  const out = new Map<string, { widthPx: number; heightPx: number }>();
  for (const u of uses) {
    const meta = media.get(u.mediaId);
    if (!meta?.width || !meta.height || u.ppi === null) continue;
    const scale = Math.min(1, MAX_PPI / u.ppi);
    const widthPx = Math.max(1, Math.round(meta.width * scale));
    const heightPx = Math.max(1, Math.round(meta.height * scale));
    const prev = out.get(u.mediaId);
    if (!prev || widthPx > prev.widthPx) out.set(u.mediaId, { widthPx, heightPx });
  }
  return out;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
