/**
 * The square cut from a picture for the app's icon (D101): how far it's zoomed in, and where it
 * sits in the room the picture leaves around it, so the picture always fills the square.
 */
export interface IconCrop {
  /** 1 is the largest square the picture holds; more is closer in. */
  zoom: number;
  /** Where the square sits across and down the room left over: 0 at the left or top, 0.5 centred. */
  x: number;
  y: number;
}

export const CENTRED: IconCrop = { zoom: 1, x: 0.5, y: 0.5 };

/** The fewest of the picture's pixels a square may hold: closer in than this, an icon goes soft. */
export const MIN_CROP = 512;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far in a picture can be zoomed: 1 for one smaller than MIN_CROP. */
export function maxZoom(width: number, height: number): number {
  return Math.max(1, Math.min(width, height) / MIN_CROP);
}

/** The square, in the picture's pixels. */
export function cropRect(width: number, height: number, crop: IconCrop): { x: number; y: number; size: number } {
  const size = Math.min(width, height) / clamp(crop.zoom, 1, maxZoom(width, height));
  return { x: (width - size) * crop.x, y: (height - size) * crop.y, size };
}

/** Zoomed in or out about the middle of the square, as far as the picture goes. */
export function zoomTo(width: number, height: number, crop: IconCrop, zoom: number): IconCrop {
  const z = clamp(zoom, 1, maxZoom(width, height));
  const r = cropRect(width, height, crop);
  const size = Math.min(width, height) / z;
  const place = (middle: number, edge: number, keep: number) => {
    const room = edge - size;
    return room > 0 ? clamp((middle - size / 2) / room, 0, 1) : keep;
  };
  return { zoom: z, x: place(r.x + r.size / 2, width, crop.x), y: place(r.y + r.size / 2, height, crop.y) };
}

/** Moved by a drag of (dx, dy) screen pixels on a frame `frame` pixels wide: the picture follows. */
export function panBy(width: number, height: number, crop: IconCrop, dx: number, dy: number, frame: number): IconCrop {
  const r = cropRect(width, height, crop);
  const perPixel = r.size / frame;
  const move = (at: number, delta: number, room: number, keep: number) => (room > 0 ? clamp((at - delta * perPixel) / room, 0, 1) : keep);
  return { ...crop, x: move(r.x, dx, width - r.size, crop.x), y: move(r.y, dy, height - r.size, crop.y) };
}

/** Whether the square can move across (x) or down (y) at all. */
export function canMove(width: number, height: number, crop: IconCrop): { x: boolean; y: boolean } {
  const r = cropRect(width, height, crop);
  return { x: width - r.size > 0.5, y: height - r.size > 0.5 };
}

/** What a position slider says: "Centred", "At the left", "30% across". */
export function placeText(at: number, ends: readonly [string, string], along: string): string {
  if (Math.abs(at - 0.5) < 0.005) return 'Centred';
  if (at <= 0.005) return `At the ${ends[0]}`;
  if (at >= 0.995) return `At the ${ends[1]}`;
  return `${Math.round(at * 100)}% ${along}`;
}
