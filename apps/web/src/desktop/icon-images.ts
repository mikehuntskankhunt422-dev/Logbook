import { fitWithin } from '@logbook/core';
import { cropRect, type IconCrop } from '../lib/icon-crop.ts';

/**
 * The person's picture made into the app's icons (D101): read upright, cut square where they put
 * the square, given its corners, and drawn at each size the computer needs. All on canvases in
 * the page; the desktop side only keeps and places the PNGs.
 */

export type IconShape = 'rounded' | 'square' | 'circle';

/** The picture as the crop works on it: at most this many pixels on its long side. */
const WORK_EDGE = 4096;
/** Bigger files than any photo, refused before they're read. */
const MOST_BYTES = 200 * 1024 * 1024;

export class PictureError extends Error {}

export interface Picture {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Frees its memory once the icon is made or the crop is cancelled. */
  release(): void;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new PictureError('This computer couldn’t draw the picture.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Part of `src` drawn at outW × outH, halving at most each time so no pixels are skipped. */
function shrink(src: CanvasImageSource, x: number, y: number, w: number, h: number, outW: number, outH: number): HTMLCanvasElement {
  // At least a pixel each way, or a sliver of a picture would never get there.
  [outW, outH] = [Math.max(1, Math.round(outW)), Math.max(1, Math.round(outH))];
  let from = src;
  for (;;) {
    const nextW = w > 2 * outW ? Math.ceil(w / 2) : outW;
    const nextH = h > 2 * outH ? Math.ceil(h / 2) : outH;
    const c = canvas(nextW, nextH);
    context(c).drawImage(from, x, y, w, h, 0, 0, nextW, nextH);
    // A step's canvas is let go of at once: WebKit holds on to their memory otherwise.
    if (from !== src && from instanceof HTMLCanvasElement) from.width = 0;
    if (nextW === outW && nextH === outH) return c;
    [from, x, y, w, h] = [c, 0, 0, nextW, nextH];
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  return img.decode().then(
    () => (URL.revokeObjectURL(url), img),
    () => {
      URL.revokeObjectURL(url);
      throw new PictureError('Logbook can’t open this kind of picture on this computer. Try a JPEG or PNG.');
    },
  );
}

/**
 * The picture upright (a photo's EXIF orientation applied), at most WORK_EDGE on its long side.
 * An <img> where createImageBitmap can't: older Safari (macOS 10.15–12), and SVG.
 */
export async function loadPicture(file: Blob): Promise<Picture> {
  if (file.size > MOST_BYTES) throw new PictureError('That picture is too big. Try one under 200 MB.');
  let full: ImageBitmap | HTMLImageElement;
  try {
    full = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    full = await loadImage(file);
  }
  const [width, height] = full instanceof HTMLImageElement ? [full.naturalWidth, full.naturalHeight] : [full.width, full.height];
  const done = () => {
    if (!(full instanceof HTMLImageElement)) full.close();
  };
  if (!width || !height) {
    done();
    throw new PictureError('Logbook can’t open this kind of picture on this computer. Try a JPEG or PNG.');
  }
  if (Math.max(width, height) <= WORK_EDGE) return { source: full, width, height, release: done };
  const fit = fitWithin(width, height, WORK_EDGE);
  const size = { width: Math.max(1, fit.width), height: Math.max(1, fit.height) };
  const work = shrink(full, 0, 0, width, height, size.width, size.height);
  done();
  return {
    source: work,
    width: size.width,
    height: size.height,
    release: () => {
      work.width = 0;
    },
  };
}

/** Clears what's outside the shape: rounded like Logbook's own icon, or round. */
function cutShape(c: HTMLCanvasElement, shape: IconShape) {
  if (shape === 'square') return;
  const ctx = context(c);
  const s = c.width;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  else {
    // Logbook's own icon: corners of 112 on 512. Drawn by hand: no roundRect before Safari 16.
    const r = (s * 112) / 512;
    ctx.moveTo(r, 0);
    ctx.arcTo(s, 0, s, s, r);
    ctx.arcTo(s, s, 0, s, r);
    ctx.arcTo(0, s, 0, 0, r);
    ctx.arcTo(0, 0, s, 0, r);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/** The square as it will look, into an on-screen canvas (its own pixel size). */
export function drawCrop(target: HTMLCanvasElement, picture: Picture, crop: IconCrop, shape: IconShape) {
  const r = cropRect(picture.width, picture.height, crop);
  const drawn = shrink(picture.source, r.x, r.y, r.size, r.size, target.width, target.height);
  cutShape(drawn, shape);
  const ctx = context(target);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(drawn, 0, 0);
  drawn.width = 0;
}

/** A small preview from the big one, as the system would shrink it. */
export function drawSmall(target: HTMLCanvasElement, from: HTMLCanvasElement) {
  const drawn = shrink(from, 0, 0, from.width, from.height, target.width, target.height);
  const ctx = context(target);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(drawn, 0, 0);
  drawn.width = 0;
}

function png(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new PictureError('This computer couldn’t make the icon.'))), 'image/png'));
}

/** One PNG for each size: drawn from the largest, each given its corners at its own size. */
export async function renderIcons(picture: Picture, crop: IconCrop, shape: IconShape, sizes: readonly number[]): Promise<Map<number, Blob>> {
  const r = cropRect(picture.width, picture.height, crop);
  const top = Math.max(...sizes);
  const master = shrink(picture.source, r.x, r.y, r.size, r.size, top, top);
  const out = new Map<number, Blob>();
  for (const size of [...sizes].sort((a, b) => a - b)) {
    const c = size === top ? master : shrink(master, 0, 0, top, top, size, size);
    cutShape(c, shape);
    out.set(size, await png(c));
    c.width = 0;
  }
  return out;
}
