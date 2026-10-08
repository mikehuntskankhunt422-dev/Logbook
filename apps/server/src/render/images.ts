import sharp from 'sharp';
import type { Asset } from './assets.ts';

/** Longest edge for images whose pixel size the journal didn't record (so no PPI target exists). */
const FALLBACK_MAX_EDGE = 6000;

/**
 * Prepares one image for print: applies EXIF orientation, flattens any transparency onto white
 * (Lulu requires flattened transparency), downsamples to the target, converts to greyscale for
 * black-and-white interiors, and re-encodes as high-quality JPEG. Never upscales.
 */
export async function prepareImage(bytes: Uint8Array, target: { widthPx: number; heightPx: number } | undefined, opts: { grayscale: boolean }): Promise<Asset> {
  let img = sharp(bytes, { failOn: 'none', animated: false, limitInputPixels: 268_402_689 })
    .rotate()
    .resize({
      width: target?.widthPx ?? FALLBACK_MAX_EDGE,
      height: target?.heightPx ?? FALLBACK_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' });
  img = opts.grayscale ? img.grayscale() : img.toColourspace('srgb');
  const body = await img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  return { body, contentType: 'image/jpeg' };
}
