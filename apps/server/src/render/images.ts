import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { imagePlacements, pageGeometry, printPixelSize, type BookOptions, type Entry, type MediaMeta, type Placement } from '@logbook/core';

export interface PrintImage {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * One image made ready for print (D37): EXIF orientation applied, alpha flattened onto the white
 * page (soft masks are transparency), sRGB or greyscale, and resampled down to 600 PPI at its
 * largest placement. Never upscaled.
 */
export async function preparePrintImage(input: Buffer | string, outPath: string, opts: { boxes: Placement[]; grayscale: boolean }): Promise<PrintImage> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const px = { width: (swap ? meta.height : meta.width) ?? 1, height: (swap ? meta.width : meta.height) ?? 1 };
  const target = printPixelSize(px, opts.boxes);
  let img = sharp(input, { failOn: 'none' }).rotate();
  if (target.width < px.width) img = img.resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' });
  img = img.flatten({ background: '#ffffff' });
  img = opts.grayscale ? img.grayscale().toColourspace('b-w') : img.toColourspace('srgb');
  const info = await img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(outPath);
  return { path: outPath, width: info.width, height: info.height, bytes: info.size };
}

/**
 * Prepares every image a book shows. Sizes use the widest text block (no gutter), so a later gutter
 * change only ever needs fewer pixels.
 */
export async function preparePrintImages(
  args: { entries: Entry[]; options: BookOptions; meta(id: string): MediaMeta | undefined; source(id: string): Promise<Buffer | string | undefined> },
  outDir: string,
): Promise<Map<string, PrintImage>> {
  await mkdir(outDir, { recursive: true });
  const boxes = new Map<string, Placement[]>();
  for (const p of imagePlacements(args.entries, args.options, args.meta, pageGeometry(args.options.product.trim, 0))) {
    boxes.set(p.mediaId, [...(boxes.get(p.mediaId) ?? []), p.box]);
  }
  const out = new Map<string, PrintImage>();
  let n = 0;
  for (const [id, b] of boxes) {
    const src = await args.source(id);
    if (!src) continue;
    out.set(id, await preparePrintImage(src, join(outDir, `${String(n++).padStart(5, '0')}.jpg`), { boxes: b, grayscale: args.options.product.interior === 'bw' }));
  }
  return out;
}
