import { describe, expect, it } from 'vitest';
import { almanac, entryFlags, growGarden, herbarium, STAR_GAP, starMap, STARS, timeLapseDuration, timeLapseFrame, timeLapseMonths, timeLapsePlace, weekdayOf } from '../src/index.ts';
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

  it('keeps a paused or playing place on its month when the months change', () => {
    const jan = entry('a', at('2026-01-03'));
    const months = timeLapseMonths(growGarden([jan, entry('b', at('2026-02-09')), entry('c', at('2026-03-01'))]).plants, '2026-03');
    const later = timeLapseMonths(growGarden([entry('b', at('2026-02-09')), entry('c', at('2026-03-01'))]).plants, '2026-03');
    // Null is the end, whatever the months.
    expect([timeLapsePlace(null, months), timeLapsePlace(null, later)]).toEqual([3, 2]);
    // On February when January goes: still February, now the first month.
    expect(timeLapsePlace({ pos: 2, first: '2026-01' }, later)).toBe(1);
    // On January when it goes: February, whole, rather than an empty garden.
    expect(timeLapsePlace({ pos: 1, first: '2026-01' }, later)).toBe(1);
    expect(timeLapsePlace({ pos: 0.5, first: '2026-01' }, later)).toBe(1);
    // The start of a play stays the start; a place past the end is the end.
    expect(timeLapsePlace({ pos: 0, first: '2026-01' }, months)).toBe(0);
    expect(timeLapsePlace({ pos: 3, first: '2026-01' }, later)).toBe(2);
  });

  it('makes a year’s twelve longest entries its constellation, in date order, named after its most-used tag', () => {
    const year = Array.from({ length: 15 }, (_, i) => entry(words(10 + i * 10, `s${i}`), { ...at(`2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`), tags: i % 3 ? ['lisbon'] : ['home'] }));
    const g = growGarden([...year, entry('other year', { ...at('2025-06-01'), tags: ['far'] })]);
    const map = starMap(g.plants, '2026');
    expect(map.stars).toHaveLength(STARS);
    expect(map.tag).toBe('Lisbon');
    // The three shortest are left out, and the stars run in date order.
    expect(Math.min(...map.stars.map((s) => s.plant.words))).toBeGreaterThan(Math.max(...g.plants.filter((p) => !map.stars.some((s) => s.plant === p) && p.entry.date.startsWith('2026')).map((p) => p.words)));
    const dates = map.stars.map((s) => s.plant.entry.date);
    expect(dates).toEqual([...dates].sort());
    // Placed by date across the year and by id down the sky, the same every time.
    for (const s of map.stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThanOrEqual(0.2);
      expect(s.y).toBeLessThanOrEqual(0.8);
    }
    expect(starMap(g.plants, '2026')).toEqual(map);
    expect(starMap(g.plants, '2026').stars[0]!.x).toBeLessThan(starMap(g.plants, '2026').stars.at(-1)!.x);
    // A year without tags is named after itself (in the app); one with no entries has no stars.
    expect(starMap(growGarden([entry('x', at('2024-03-03'))]).plants, '2024')).toMatchObject({ tag: '', stars: [{ x: expect.any(Number) }] });
    expect(starMap(g.plants, '2023').stars).toEqual([]);
  });

  it('keeps stars apart, in date order and within the year, so each can be tapped', () => {
    // Twelve entries in the last week of December, some on one day.
    const late = Array.from({ length: 12 }, (_, i) => entry(words(30, `late${i}`), at(`2026-12-${String(20 + Math.floor(i / 2)).padStart(2, '0')}`)));
    const xs = starMap(growGarden(late).plants, '2026').stars.map((s) => s.x);
    expect(xs).toHaveLength(12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(STAR_GAP - 1e-9);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
  });
});
