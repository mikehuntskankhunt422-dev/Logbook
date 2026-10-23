import { describe, expect, it } from 'vitest';
import { canMove, CENTRED, cropRect, maxZoom, MIN_CROP, panBy, placeText, zoomTo } from './icon-crop.ts';

describe('the app icon’s square (D101)', () => {
  it('starts as the largest square the picture holds, centred', () => {
    expect(cropRect(4000, 3000, CENTRED)).toEqual({ x: 500, y: 0, size: 3000 });
    expect(cropRect(600, 900, CENTRED)).toEqual({ x: 0, y: 150, size: 600 });
    expect(cropRect(800, 800, CENTRED)).toEqual({ x: 0, y: 0, size: 800 });
  });

  it('zooms in about the middle of the square, never past MIN_CROP of the picture’s pixels', () => {
    expect(maxZoom(4000, 3000)).toBe(3000 / MIN_CROP);
    expect(maxZoom(300, 200)).toBe(1);
    const z = zoomTo(4000, 3000, CENTRED, 2);
    expect(z.zoom).toBe(2);
    const r = cropRect(4000, 3000, z);
    expect(r.size).toBe(1500);
    expect(r.x + r.size / 2).toBeCloseTo(2000);
    expect(r.y + r.size / 2).toBeCloseTo(1500);
    expect(zoomTo(4000, 3000, CENTRED, 99).zoom).toBe(maxZoom(4000, 3000));
    expect(zoomTo(4000, 3000, CENTRED, 0.2).zoom).toBe(1);
  });

  it('keeps the square inside the picture when zooming out from a corner', () => {
    const corner = { zoom: 3, x: 1, y: 1 };
    const out = zoomTo(4000, 3000, corner, 1);
    const r = cropRect(4000, 3000, out);
    expect(r.x + r.size).toBeLessThanOrEqual(4000);
    expect(r.y + r.size).toBeLessThanOrEqual(3000);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it('follows a drag: the picture moves with the pointer, as far as it goes', () => {
    // A 300 px frame showing 3000 px of the picture: 1 screen pixel is 10 of the picture's.
    const moved = panBy(4000, 3000, CENTRED, 20, 0, 300);
    expect(cropRect(4000, 3000, moved).x).toBeCloseTo(300);
    expect(moved.y).toBe(0.5);
    expect(panBy(4000, 3000, CENTRED, -1e6, 0, 300).x).toBe(1);
    expect(panBy(4000, 3000, CENTRED, 1e6, 0, 300).x).toBe(0);
    // No room down a landscape picture at zoom 1: that slider has nothing to do.
    expect(canMove(4000, 3000, CENTRED)).toEqual({ x: true, y: false });
    expect(canMove(4000, 3000, zoomTo(4000, 3000, CENTRED, 2))).toEqual({ x: true, y: true });
    expect(canMove(800, 800, CENTRED)).toEqual({ x: false, y: false });
  });

  it('says where the square is in words', () => {
    expect(placeText(0.5, ['left', 'right'], 'across')).toBe('Centred');
    expect(placeText(0, ['left', 'right'], 'across')).toBe('At the left');
    expect(placeText(1, ['top', 'bottom'], 'down')).toBe('At the bottom');
    expect(placeText(0.3, ['left', 'right'], 'across')).toBe('30% across');
  });
});
