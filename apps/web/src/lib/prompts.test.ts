import { describe, expect, it } from 'vitest';
import { HOLIDAY_PROMPTS } from '@logbook/core';
import { PROMPTS, promptFor } from './prompts.ts';

describe('writing prompts (D94)', () => {
  it('gives the same prompt all day, and "Another" goes through every one before repeating', () => {
    expect(promptFor('2026-10-13')).toBe(promptFor('2026-10-13'));
    const seen = new Set(PROMPTS.map((_, turn) => promptFor('2026-10-13', turn)));
    expect(seen.size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
  });

  it('starts with a holiday’s own prompts on its day, then the everyday ones (D108)', () => {
    const halloween = HOLIDAY_PROMPTS.halloween;
    expect(halloween.map((_, turn) => promptFor('2026-10-31', turn, 'halloween'))).toEqual([...halloween]);
    expect(promptFor('2026-10-31', halloween.length, 'halloween')).toBe(promptFor('2026-10-31', 0));
  });
});
