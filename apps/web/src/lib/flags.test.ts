import { describe, expect, it } from 'vitest';
import { allFlags, flagEmoji } from './flags.ts';

describe('the flag picker’s countries (D91)', () => {
  it('lists each country once, under its current code', () => {
    const flags = allFlags('en');
    const names = flags.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    const codes = flags.map((f) => f.code);
    for (const old of ['UK', 'SU', 'YU', 'CS', 'BU', 'DD', 'ZR', 'TP', 'FX']) expect(codes).not.toContain(old);
    for (const current of ['GB', 'RU', 'RS', 'MM', 'DE', 'CD', 'TL', 'FR', 'JP']) expect(codes).toContain(current);
    expect(flags.find((f) => f.code === 'GB')?.emoji).toBe(flagEmoji('GB'));
  });
});
