import { describe, expect, it } from 'vitest';
import { elapsed } from './time.ts';

describe('a frame’s time (D121)', () => {
  it('is the time since the last, in seconds, at most half a second', () => {
    expect(elapsed(1016, 1000)).toBeCloseTo(0.016);
    expect(elapsed(5000, 1000)).toBe(0.5);
  });

  it('never runs backwards: a frame stamped before the drawing was asked for takes no time', () => {
    expect(elapsed(1000, 1230)).toBe(0);
  });
});
