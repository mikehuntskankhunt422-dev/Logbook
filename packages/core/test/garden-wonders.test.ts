import { describe, expect, it } from 'vitest';
import { gardenLandmarks, growGarden, latestLandmarks, streakMilestones, worldTree } from '../src/index.ts';
import type { Entry } from '../src/model.ts';
import { emptyDoc } from '../src/richtext.ts';

let n = 0;
function entry(text: string, date: string, opts: Partial<Entry> = {}, writtenOn = date): Entry {
  n++;
  const at = `${writtenOn}T10:00:${String(n % 60).padStart(2, '0')}.000Z`;
  return { v: 1, id: `w${n}`, date, title: `Entry ${n}`, mood: null, cover: { kind: 'gradient', gradient: 'sunrise' }, tags: [], blocks: [{ id: `b${n}`, type: 'text', doc: emptyDoc(text) }], createdAt: at, updatedAt: at, rev: 1, deletedAt: null, expiresAt: null, musicId: null, musicUrl: null, ...opts } as Entry;
}
const words = (k: number, seed = 'w') => Array.from({ length: k }, (_, i) => `${seed}${i.toString(36)}x`).join(' ');
/** `count` days in a row from `start`. */
const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe('landmarks (D103)', () => {
  it('marks the first entry, every 100th, each anniversary, the streak milestones and the longest entry', () => {
    const dates = days('2024-02-29', 120);
    const entries = dates.map((d, i) => entry(i === 50 ? words(900, 'long') : 'A few words today.', d));
    const g = growGarden(entries);
    const marks = gardenLandmarks(g.written, g.plants, '2026-03-01');
    const kinds = (k: string) => marks.filter((m) => m.kind === k);
    expect(kinds('stone')).toMatchObject([{ n: 1, date: '2024-02-29', entry: { id: entries[0]!.id } }]);
    expect(kinds('lamp')).toMatchObject([{ n: 100, date: dates[99], entry: { id: entries[99]!.id } }]);
    // 29 February is kept on the 28th in other years.
    expect(kinds('arch').map((m) => [m.n, m.date])).toEqual([
      [1, '2025-02-28'],
      [2, '2026-02-28'],
    ]);
    expect(kinds('steps').map((m) => [m.n, m.date])).toEqual([3, 7, 14, 30, 50, 100].map((k) => [k, dates[k - 1]]));
    expect(marks.at(-1)).toMatchObject({ kind: 'statue', entry: { id: entries[50]!.id } });
    // In the order they were reached, the statue last.
    expect(marks.slice(0, -1).map((m) => m.date)).toEqual([...marks.slice(0, -1).map((m) => m.date)].sort());
  });

  it('shows the latest of each kind, in the same order', () => {
    const dates = days('2025-01-01', 400);
    const g = growGarden(dates.map((d) => entry('A few words today.', d)));
    const shown = latestLandmarks(gardenLandmarks(g.written, g.plants, '2026-03-01'));
    expect(shown.map((m) => [m.kind, m.n])).toEqual([
      ['stone', 1],
      ['steps', 365],
      ['arch', 1],
      ['lamp', 400],
      ['statue', shown.at(-1)!.n],
    ]);
  });

  it('goes by the day the first entry was written, not the day it’s about, and leaves out days to come', () => {
    // Started on 5 January 2026 with an entry about 2010; a later one about 2030.
    const g = growGarden([entry('An old memory.', '2010-06-01', {}, '2026-01-05'), entry('Plans.', '2030-01-01', {}, '2026-01-06'), entry('Plans.', '2030-01-02', {}, '2026-01-07'), entry('Plans.', '2030-01-03', {}, '2026-01-08')]);
    const marks = gardenLandmarks(g.written, g.plants, '2027-02-01');
    expect(marks.filter((m) => m.kind !== 'statue').map((m) => [m.kind, m.n, m.date])).toEqual([
      ['stone', 1, '2026-01-05'],
      ['arch', 1, '2027-01-05'],
    ]);
  });

  it('counts entries in Recently deleted, without linking to them; no arch before the first anniversary', () => {
    const first = entry('Gone now.', '2026-01-02', { deletedAt: '2026-02-01T00:00:00.000Z' });
    const g = growGarden([first, entry('Still here.', '2026-01-03')]);
    const marks = gardenLandmarks(g.written, g.plants, '2026-12-31');
    expect(marks.map((m) => m.kind)).toEqual(['stone', 'statue']);
    expect(marks[0]).toMatchObject({ date: '2026-01-02', entry: undefined });
    expect(gardenLandmarks([], [], '2026-12-31')).toEqual([]);
  });

  it('keeps a streak’s path stones when it breaks, each where it was first reached', () => {
    const run = [...days('2026-01-01', 7), ...days('2026-02-01', 3)];
    expect(streakMilestones(run)).toEqual([
      { days: 3, date: '2026-01-03' },
      { days: 7, date: '2026-01-07' },
    ]);
    // Two entries on a day are one day.
    expect(streakMilestones(['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-03'])).toEqual([{ days: 3, date: '2026-01-03' }]);
  });
});

describe('the World Tree (D103)', () => {
  it('has a blossom for every month written in, in its rarest plant’s tier, inside the canopy', () => {
    const g = growGarden([entry('A note.', '2026-01-05'), entry(words(1300, 'big'), '2026-01-20'), entry('Another.', '2026-03-01')]);
    const tree = worldTree(g.plants, g.rank);
    expect(tree.blossoms.map((b) => [b.month, b.tier])).toEqual([
      ['2026-01', Math.max(...g.plants.filter((p) => p.entry.date.startsWith('2026-01')).map((p) => p.tier))],
      ['2026-03', g.plants[2]!.tier],
    ]);
    expect(tree.blossoms[0]!.tier).toBeGreaterThan(0);
    expect(tree.rings).toBe(0);
  });

  it('keeps each month’s blossom in place as months are added, and has a ring for every ★', () => {
    const months = Array.from({ length: 50 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String(1 + (i % 12)).padStart(2, '0')}-10`);
    const g = growGarden(months.map((d) => entry('A note.', d)));
    const all = worldTree(g.plants, { ring: 3 });
    expect(all.rings).toBe(3);
    for (const b of all.blossoms) {
      // Inside the canopy's ellipse.
      expect(((b.x - 0.5) / 0.46) ** 2 + ((b.y - 0.5) / 0.42) ** 2).toBeLessThanOrEqual(1);
    }
    // Up to three years of months, a month's blossom stays where it was as more come.
    const young = worldTree(g.plants.slice(0, 20), { ring: 1 });
    expect(young.rings).toBe(0);
    expect(worldTree(g.plants.slice(0, 36), { ring: 1 }).blossoms.slice(0, 20)).toEqual(young.blossoms);
    // A month filled in later, or emptied, moves no other.
    const gappy = worldTree([...g.plants.slice(0, 5), ...g.plants.slice(6, 20)], { ring: 1 });
    expect(gappy.blossoms).toEqual(young.blossoms.filter((_, i) => i !== 5));
  });
});
