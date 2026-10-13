import { describe, expect, it } from 'vitest';
import { arm, describeDays, EMPTY_CLOCK, formatClock, formatDuration, nextRing, ringId, ringsIn, upcoming, type Alarm } from './clock.ts';

// Tuesday 13 October 2026, 08:00 local time.
const now = new Date(2026, 9, 13, 8, 0, 0);
const alarm = (time: string, days: number[] = [], on = true): Alarm => ({ id: 'a', time, label: '', days, on });
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('the clock (D92)', () => {
  it('finds an alarm’s next ring: later today, tomorrow, or on its next repeating day', () => {
    expect(nextRing(alarm('09:30'), now)).toBe(at(13, 9, 30));
    expect(nextRing(alarm('07:00'), now)).toBe(at(14, 7));
    expect(nextRing(alarm('08:00'), now)).toBe(at(14, 8)); // not the very moment
    expect(nextRing(alarm('07:00', [1]), now)).toBe(at(19, 7)); // next Monday
    expect(nextRing(alarm('09:00', [2]), now)).toBe(at(13, 9)); // today, a Tuesday
    expect(nextRing(alarm('07:00', [2]), now)).toBe(at(20, 7)); // a week on
    expect(nextRing(alarm('07:00', [], false), now)).toBeNull();
  });

  it('rings a once-only alarm at the time set when it was switched on, and then not again', () => {
    const once = arm(alarm('07:00'), now);
    expect(once.onceAt).toBe(at(14, 7));
    expect(nextRing(once, now)).toBe(at(14, 7));
    expect(nextRing(once, new Date(at(14, 7, 1)))).toBeNull();
    expect(arm(alarm('07:00', [1, 2]), now).onceAt).toBeNull();
  });

  it('lists what’s coming up, soonest first: every day a repeating alarm rings, the timer and snoozes', () => {
    const state = {
      ...EMPTY_CLOCK,
      alarms: [{ ...alarm('07:00', [1, 3, 5]), id: 'weekdays' }, { ...arm(alarm('12:00'), now), id: 'lunch', label: 'Lunch' }, { ...alarm('06:00', [], false), id: 'off' }],
      timer: { durationMs: 300_000, endsAt: now.getTime() + 300_000, leftMs: null },
      snoozes: [{ key: 'x', label: '⏰ Wake', at: now.getTime() + 600_000 }],
    };
    const rings = upcoming(state, now, 7);
    expect(rings.map((r) => r.at)).toEqual([now.getTime() + 300_000, now.getTime() + 600_000, at(13, 12), at(14, 7), at(16, 7), at(19, 7)]);
    expect(rings[2]?.title).toBe('⏰ Lunch');
    expect(rings[0]?.title).toBe('⏲️ Time’s up');
    // Whole numbers for Android, the same for the same ring, different for different ones.
    expect(new Set(rings.map((r) => r.id)).size).toBe(rings.length);
    expect(rings.every((r) => Number.isInteger(r.id) && r.id >= 0 && r.id < 2 ** 31)).toBe(true);
    expect(upcoming(state, now, 7)[3]?.id).toBe(rings[3]?.id);
    expect(ringId('a')).not.toBe(ringId('b'));
  });

  it('says times and days in words', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(64_100)).toBe('1:05'); // a timer counts the second it's in
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(65_432, true)).toBe('1:05.43');
    expect(formatDuration(90 * 60_000)).toBe('1 hour 30 minutes');
    expect(formatDuration(45_000)).toBe('45 seconds');
    expect(describeDays([])).toBe('Once');
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([5, 1, 2, 3, 4])).toBe('Weekdays');
    expect(describeDays([6, 0])).toBe('Weekends');
    expect(describeDays([3, 1])).toBe('Mon, Wed');
    expect(ringsIn(now.getTime() + 30_000, now.getTime())).toBe('in under a minute');
    expect(ringsIn(now.getTime() + (7 * 60 + 12) * 60_000, now.getTime())).toBe('in 7 hours 12 minutes');
  });
});
