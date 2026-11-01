import { describe, expect, it } from 'vitest';
import { holidayOn } from '@logbook/core';
import { CURIOUS_PROMPTS, PROMPTS, promptFor } from './prompts.ts';

describe('writing prompts (D94)', () => {
  it('gives the same prompt all day, and "Another" goes through every one before repeating', () => {
    expect(promptFor('2026-10-13')).toBe(promptFor('2026-10-13'));
    const seen = new Set(PROMPTS.map((_, turn) => promptFor('2026-10-13', turn)));
    expect(seen.size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
  });

  it('starts with a holiday’s own prompts on its day, then the everyday ones (D108)', () => {
    const halloween = holidayOn('2026-10-31')!.prompts;
    expect(halloween.map((_, turn) => promptFor('2026-10-31', turn, halloween))).toEqual([...halloween]);
    expect(promptFor('2026-10-31', halloween.length, halloween)).toBe(promptFor('2026-10-31', 0));
  });

  it('with the Curious prompts on, goes through those and the everyday ones alike (D115)', () => {
    const all = [...PROMPTS, ...CURIOUS_PROMPTS];
    const seen = new Set(all.map((_, turn) => promptFor('2026-11-01', turn, [], true)));
    expect(seen).toEqual(new Set(all));
    expect(new Set(all).size).toBe(all.length);
    // Off, only the everyday ones.
    expect(PROMPTS).toContain(promptFor('2026-11-01', 3));
  });
});
