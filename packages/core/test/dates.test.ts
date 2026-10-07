import { describe, expect, it } from 'vitest';
import { addDays, computeStreak, heatLevel, monthGrid, onThisDayDates, toIsoDate } from '../src/dates.ts';

describe('computeStreak', () => {
  it('is zero with no entries', () => {
    expect(computeStreak([], '2026-10-07')).toEqual({ current: 0, longest: 0, wroteToday: false });
  });

  it('counts consecutive days ending today', () => {
    const s = computeStreak(['2026-10-05', '2026-10-06', '2026-10-07'], '2026-10-07');
    expect(s).toEqual({ current: 3, longest: 3, wroteToday: true });
  });

  it('keeps yesterday’s streak alive until today ends', () => {
    expect(computeStreak(['2026-10-05', '2026-10-06'], '2026-10-07').current).toBe(2);
  });

  it('breaks after a missed day', () => {
    expect(computeStreak(['2026-10-04', '2026-10-05'], '2026-10-07').current).toBe(0);
  });

  it('tracks the longest run separately and ignores duplicate dates', () => {
    const s = computeStreak(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-03', '2026-10-07'], '2026-10-07');
    expect(s.longest).toBe(3);
    expect(s.current).toBe(1);
  });

  it('crosses month and year boundaries', () => {
    expect(computeStreak(['2025-12-31', '2026-01-01'], '2026-01-01').current).toBe(2);
  });
});

describe('onThisDayDates', () => {
  it('finds the same day in previous years only, newest first', () => {
    const dates = ['2024-10-07', '2025-10-07', '2026-10-07', '2025-10-08', '2023-10-07'];
    expect(onThisDayDates('2026-10-07', dates)).toEqual(['2025-10-07', '2024-10-07', '2023-10-07']);
  });

  it('maps 29 February to the 28th in non-leap years', () => {
    expect(onThisDayDates('2028-02-29', ['2027-02-28', '2024-02-29'])).toEqual(['2027-02-28', '2024-02-29']);
  });
});

describe('helpers', () => {
  it('heatLevel buckets word counts', () => {
    expect([0, 1, 49, 50, 199, 200, 599, 600].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('addDays handles DST-free local arithmetic', () => {
    expect(addDays('2026-04-05', 1)).toBe('2026-04-06'); // Adelaide DST ends 2026-04-05
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('monthGrid is Monday-first and padded to whole weeks', () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
  });

  it('toIsoDate uses local time', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
