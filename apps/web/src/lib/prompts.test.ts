import { describe, expect, it } from 'vitest';
import { PROMPTS, promptFor } from './prompts.ts';

describe('writing prompts (D94)', () => {
  it('gives the same prompt all day, and "Another" goes through every one before repeating', () => {
    expect(promptFor('2026-10-13')).toBe(promptFor('2026-10-13'));
    const seen = new Set(PROMPTS.map((_, turn) => promptFor('2026-10-13', turn)));
    expect(seen.size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
  });
});
