/**
 * How long a frame of the walking Library took, in seconds (D121): never less than nothing, never
 * more than half a second. A browser's frame time can come from a moment before the one the
 * drawing was asked for (it's when the frame began), so the first frame after a stop could
 * otherwise run time backwards, and whatever counts time down would count it up instead.
 */
export const elapsed = (now: number, last: number): number => Math.min(0.5, Math.max(0, (now - last) / 1000));
