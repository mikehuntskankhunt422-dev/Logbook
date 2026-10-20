import { describe, expect, it } from 'vitest';
import { almanac, entryFlags, growGarden, herbarium, timeLapseDuration, timeLapseFrame, timeLapseMonths, weekdayOf } from '../src/index.ts';
import type { Entry } from '../src/model.ts';
import { emptyDoc } from '../src/richtext.ts';

let n = 0;
function entry(text: string, opts: Partial<Entry> = {}): Entry {
  n++;
  const at = opts.createdAt ?? `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.000Z`;
  return { v: 1, id: `h${n}`, date: at.slice(0, 10), title: '', mood: null, cover: { kind: 'gradient', gradient: 'sunrise' }, tags: [], blocks: [{ id: `b${n}`, type: 'text', doc: emptyDoc(text) }], createdAt: at, updatedAt: at, rev: 1, deletedAt: null, expiresAt: null, musicId: null, musicUrl: null, ...opts } as Entry;
}
const words = (k: number, seed = 'w') => Array.from({ length: k }, (_, i) => `${seed}${i.toString(36)}x`).join(' ');
const at = (date: string) => ({ createdAt: `${date}T10:00:00.000Z`, date });

describe('garden history (D98)', () => {
  it('gives each plant its share of Growth, which adds up to the garden’s', () => {
    const g = growGarden([entry(words(100, 'a'), at('2026-03-01')), entry(words(100, 'b'), at('2026-03-01')), entry(words(700, 'c'), at('2026-03-02'))]);
    expect(g.plants.reduce((s, p) => s + p.growth, 0)).toBe(g.rank.growth);
    // The day's second entry adds only its words' share: no second 100 for turning up.
    expect(g.plants[1]!.growth).toBeLessThan(g.plants[0]!.growth);
  });

  it('lists the species grown, sizes reached and collections from writing', () => {
    const photo = { id: 'p', type: 'photo', mediaId: 'm1', caption: '' };
    const g = growGarden([
      entry(words(30, 'a'), { ...at('2026-01-05'), mood: '🥰' }),
      entry(`${words(700, 'b')} Lisbon 🇵🇹 and Tokyo 🇯🇵`, { ...at('2026-02-01'), mood: '🥰' }),
      entry('Hi', { ...at('2026-02-03'), blocks: [photo] as Entry['blocks'], musicUrl: 'https://example.com/a.mp3' }),
    ]);
    const h = herbarium(g.plants);
    expect(h.species).toEqual([
      { species: 'Rose', plants: 2, tier: 1, first: '2026-01-05' },
      { species: 'Wildflower', plants: 1, tier: expect.any(Number), first: '2026-02-03' },
    ]);
    expect(h.sizes.filter(Boolean)).toHaveLength(3);
    expect(h.sizes[5]).toBe(true);
    expect([h.photos, h.music, h.video]).toEqual([1, 1, 0]);
    expect(h.flags).toEqual(['PT', 'JP']);
    expect(entryFlags(entry('🇬🇧🇫🇷 a'))).toEqual(['GB', 'FR']);
  });

  it('sums a year by month and finds its longest entry, rarest plant and busiest weekday', () => {
    const g = growGarden([
      entry(words(40, 'a'), at('2025-12-30')),
      entry(words(50, 'b'), at('2026-01-05')),
      entry(words(900, 'c'), at('2026-01-12')),
      entry(words(60, 'd'), at('2026-03-19')),
    ]);
    expect(weekdayOf('2026-01-05')).toBe(0);
    expect(weekdayOf('2026-03-22')).toBe(6);
    // Two-digit years aren't read as the 1900s: 2 February 26 was a Monday.
    expect(weekdayOf('0026-02-02')).toBe(0);
    expect(weekdayOf('2024-02-29')).toBe(3);
    const a = almanac(g.plants);
    expect(a.year).toBe('2026');
    expect(a.years).toEqual(['2026', '2025']);
    expect(a.months).toHaveLength(12);
    expect(a.months[0]).toMatchObject({ month: '2026-01', plants: 2 });
    expect(a.months[1]).toMatchObject({ plants: 0, growth: 0 });
    expect(a.plants).toBe(3);
    expect(a.days).toBe(3);
    expect(a.growth).toBe(g.plants.slice(1).reduce((s, p) => s + p.growth, 0));
    expect(a.longest?.entry.date).toBe('2026-01-12');
    expect(a.rarest?.entry.date).toBe('2026-01-12');
    expect(a.busiest).toBe(0);
    expect(almanac(g.plants, '2025').plants).toBe(1);
    expect(almanac([]).busiest).toBe(-1);
  });

  it('plays every month from the first to now, a second a month within 20 to 60 seconds', () => {
    const g = growGarden([entry('one', at('2025-11-20')), entry('two', at('2026-01-02')), entry('three', at('2026-01-01'))]);
    const months = timeLapseMonths(g.plants, '2026-02');
    expect(months.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(months[2]!.plants.map((p) => p.entry.date)).toEqual(['2026-01-01', '2026-01-02']);
    // A future-dated entry stretches it past now.
    expect(timeLapseMonths(g.plants, '2025-12').at(-1)!.month).toBe('2026-01');
    expect(timeLapseMonths([], '2026-01')).toEqual([]);
    expect([3, 30, 90].map(timeLapseDuration)).toEqual([20_000, 30_000, 60_000]);
  });

  it('keeps odd years in order: a year before 1000 or a date in 9999', () => {
    const g = growGarden([entry('early', at('0999-12-05')), entry('now', at('1000-02-01'))]);
    expect(timeLapseMonths(g.plants, '1000-01').map((m) => [m.month, m.plants.length])).toEqual([
      ['0999-12', 1],
      ['1000-01', 0],
      ['1000-02', 1],
    ]);
    const late = growGarden([entry('now', at('2026-10-01')), entry('far', at('9999-12-31'))]);
    const months = timeLapseMonths(late.plants, '2026-10');
    expect(months.at(-1)).toMatchObject({ month: '9999-12' });
    expect(months).toHaveLength((9999 - 2026) * 12 + 3);
  });

  it('steps through the months: each month shown whole, and its plants coming up as it plays', () => {
    const g = growGarden([entry('a', at('2026-01-03')), entry('b', at('2026-01-09')), entry('c', at('2026-03-01'))]);
    const months = timeLapseMonths(g.plants, '2026-03');
    // The slider's month v is position v + 1: that month whole, and the ones before it.
    expect(timeLapseFrame(months, 1)).toEqual({ index: 0, shown: [2, 0, 0] });
    expect(timeLapseFrame(months, 2)).toEqual({ index: 1, shown: [2, 0, 0] });
    expect(timeLapseFrame(months, 3)).toEqual({ index: 2, shown: [2, 0, 1] });
    // Playing: halfway through January, one of its two plants is up; it starts empty.
    expect(timeLapseFrame(months, 0.5)).toEqual({ index: 0, shown: [1, 0, 0] });
    expect(timeLapseFrame(months, 0)).toEqual({ index: 0, shown: [0, 0, 0] });
  });
});
