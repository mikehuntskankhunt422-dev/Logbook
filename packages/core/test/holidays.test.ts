import { describe, expect, it } from 'vitest';
import { HOLIDAY_PROMPTS, holidayOn } from '../src/holidays.ts';

describe('holidays (D108)', () => {
  it('is Halloween from 24 to 31 October, the 31st being the day itself, every year', () => {
    expect(holidayOn('2026-10-23')).toBeUndefined();
    expect(holidayOn('2026-10-24')).toMatchObject({ id: 'halloween', emoji: '🎃', day: false });
    expect(holidayOn('2026-10-30')).toMatchObject({ id: 'halloween', day: false });
    expect(holidayOn('2027-10-31')).toMatchObject({ id: 'halloween', day: true });
    expect(holidayOn('2026-11-01')).toBeUndefined();
    expect(holidayOn('2026-03-28')).toBeUndefined();
  });

  it('is nothing once switched off', () => {
    expect(holidayOn('2026-10-31', new Set(['halloween']))).toBeUndefined();
  });

  it('has prompts for the day', () => {
    expect(HOLIDAY_PROMPTS.halloween.length).toBeGreaterThan(0);
  });
});
