import { addDays, STREAK_MILESTONES, toIsoDate } from './dates.ts';
import type { Rank, Plant } from './garden.ts';
import type { Entry } from './model.ts';

/**
 * Garden update 4, "Wonders" (D103, docs/GARDEN.md): the garden's landmarks and the World Tree,
 * worked out from the entries and plants alone, so nothing is stored in the journal.
 */

export type LandmarkKind = 'stone' | 'lamp' | 'arch' | 'statue' | 'steps';

export interface Landmark {
  kind: LandmarkKind;
  /** What it counts: 1 for the first entry, 100, 200… for lamp posts, years for arches, plant words for the statue, days for path stones. */
  n: number;
  /** The day it marks (YYYY-MM-DD). */
  date: string;
  /** The entry it marks, while that's in the journal (not in Recently deleted). */
  entry?: Entry;
}

/** A lamp post for every this many entries. */
export const LAMP_EVERY = 100;

/** The day an entry was written, on this device's calendar: not the day it's about, which can be any. */
function writtenOn(e: Entry): string {
  const at = Date.parse(e.createdAt);
  return Number.isFinite(at) ? toIsoDate(new Date(at)) : e.date;
}

/**
 * The garden's landmarks (D103), in the order they were reached up to `today`: your first entry (a
 * stone), every 100th (a lamp post), each anniversary of the day you started (an arch), each streak
 * milestone reached (path stones), and your longest entry (a statue, last). `written` is every
 * entry that counts in the order written, trashed ones too (Garden.written), as they count for
 * Growth; a streak that broke keeps its stones. Stones, lamp posts and arches go by the day an
 * entry was written, path stones by the days entries are about, like the streak.
 */
export function gardenLandmarks(written: Entry[], plants: Plant[], today: string): Landmark[] {
  const first = written[0];
  if (!first) return [];
  const live = (e: Entry) => (e.deletedAt ? undefined : e);
  const start = writtenOn(first);
  const out: Landmark[] = [{ kind: 'stone', n: 1, date: start, entry: live(first) }];
  for (let i = LAMP_EVERY - 1; i < written.length; i += LAMP_EVERY) {
    const e = written[i]!;
    out.push({ kind: 'lamp', n: i + 1, date: writtenOn(e), entry: live(e) });
  }
  for (let years = 1; years <= 1000; years++) {
    const date = anniversary(start, years);
    if (date > today) break;
    out.push({ kind: 'arch', n: years, date });
  }
  for (const { days, date } of streakMilestones(written.map((e) => e.date))) out.push({ kind: 'steps', n: days, date });
  // Not yet reached: a clock that was wrong, or an entry about a day to come.
  const reached = out.filter((m) => m.date <= today);
  reached.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // The longest so far (the earliest of equals), whenever it was written.
  let longest: Plant | undefined;
  for (const p of plants) if (!longest || p.words > longest.words) longest = p;
  if (longest) reached.push({ kind: 'statue', n: longest.words, date: longest.entry.date, entry: longest.entry });
  return reached;
}

/** The landmarks as the garden shows them: of each kind only the latest (the 3,000th entry's lamp post stands for all 30), in the same order. */
export function latestLandmarks(marks: Landmark[]): Landmark[] {
  const last = new Map<LandmarkKind, Landmark>();
  for (const m of marks) last.set(m.kind, m);
  return marks.filter((m) => last.get(m.kind) === m);
}

/** `date` (YYYY-MM-DD) that many years on; 29 February is the 28th in other years. */
function anniversary(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) + years;
  const md = date.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${String(y).padStart(4, '0')}-${md === '02-29' && !leap ? '02-28' : md}`;
}

/** Each streak milestone (STREAK_MILESTONES) reached by a run of days with an entry, and the day it was first reached. */
export function streakMilestones(dates: Iterable<string>): { days: number; date: string }[] {
  const days = [...new Set(dates)].sort();
  const out: { days: number; date: string }[] = [];
  let run = 0;
  let previous = '';
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    const next = STREAK_MILESTONES[out.length];
    if (next !== undefined && run === next) out.push({ days: next, date: day });
  }
  return out;
}

export interface WorldTree {
  /** One blossom for every month written in, oldest first: coloured by that month's rarest plant, placed in the canopy (0–1 across and down). */
  blossoms: { month: string; tier: number; x: number; y: number }[];
  /** One ring round the trunk for every ★ (★2 is two rings); none before. */
  rings: number;
}

/** Blossoms are spread over the canopy as if it held at least this many months, so a young tree's don't jump about each month. */
const CANOPY_ROOM = 36;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The World Tree (D103, Worldbloom): its blossoms and rings. */
export function worldTree(plants: Plant[], rank: Pick<Rank, 'ring'>): WorldTree {
  const rarest = new Map<string, number>();
  for (const p of plants) {
    const month = p.entry.date.slice(0, 7);
    rarest.set(month, Math.max(rarest.get(month) ?? 0, p.tier));
  }
  const months = [...rarest.keys()].sort();
  // A sunflower spiral from the centre out, a place for each month since the first: evenly spread,
  // and a month keeps its place when another is written in, filled in later or emptied.
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const from = months.length ? index(months[0]!) : 0;
  const room = Math.max(months.length ? index(months.at(-1)!) - from + 1 : 0, CANOPY_ROOM);
  const blossoms = months.map((month) => {
    const i = index(month) - from;
    const r = Math.sqrt((i + 0.5) / room);
    const a = i * GOLDEN_ANGLE;
    return { month, tier: rarest.get(month)!, x: 0.5 + 0.46 * r * Math.cos(a), y: 0.5 + 0.42 * r * Math.sin(a) };
  });
  return { blossoms, rings: rank.ring > 1 ? rank.ring : 0 };
}
