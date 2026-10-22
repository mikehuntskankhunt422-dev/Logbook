import { SIZE_STAGES, type Plant } from './garden.ts';
import { fnv1a32 } from './garden-weather.ts';
import { richTextToPlain } from './richtext.ts';

/**
 * Garden update 1, "History" (D98, docs/GARDEN.md): the Herbarium, the Almanac and the
 * Time-lapse, all worked out from the plants growGarden gives, so nothing new is stored.
 */

// ── the Herbarium ──────────────────────────────────────────────────────────────────────────────

export interface HerbariumSpecies {
  species: string;
  plants: number;
  /** The rarest tier any of them bloomed. */
  tier: number;
  /** The date of the first one (entry.date). */
  first: string;
}

export interface Herbarium {
  /** The species grown, in the order they first bloomed. Species are moods: never a target. */
  species: HerbariumSpecies[];
  /** Which size stages have been reached, by stage. */
  sizes: boolean[];
  /** Plants whose entry has a photo, a gallery or a file. */
  photos: number;
  /** Plants whose entry has a sound: a recording or background music. */
  music: number;
  /** Plants whose entry has a video or an embedded video. */
  video: number;
  /** Country flags found in entries' text ("JP"), in the order first written. */
  flags: string[];
}

const FLAG_RE = /([\u{1f1e6}-\u{1f1ff}])([\u{1f1e6}-\u{1f1ff}])/gu;
const letter = (c: string) => String.fromCharCode(65 + c.codePointAt(0)! - 0x1f1e6);

/** The country flags (regional-indicator pairs) in an entry's title and text: "JP", "PT"… */
export function entryFlags(entry: Plant['entry']): string[] {
  const texts = [entry.title];
  for (const b of entry.blocks) if (b.type === 'text') texts.push(richTextToPlain(b.doc));
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(FLAG_RE)) out.push(letter(m[1]!) + letter(m[2]!));
  return out;
}

export function herbarium(plants: Plant[]): Herbarium {
  const ordered = [...plants].sort((a, b) => cmp(a.entry.date, b.entry.date) || cmp(a.entry.createdAt, b.entry.createdAt) || cmp(a.entry.id, b.entry.id));
  const species = new Map<string, HerbariumSpecies>();
  const sizes = SIZE_STAGES.map(() => false);
  const flags = new Set<string>();
  let photos = 0;
  let music = 0;
  let video = 0;
  for (const p of ordered) {
    const s = species.get(p.species);
    if (s) {
      s.plants++;
      s.tier = Math.max(s.tier, p.tier);
    } else species.set(p.species, { species: p.species, plants: 1, tier: p.tier, first: p.entry.date });
    sizes[p.stage] = true;
    const kinds = new Set(p.entry.blocks.map((b) => b.type));
    if (kinds.has('photo') || kinds.has('gallery') || kinds.has('file')) photos++;
    if (kinds.has('audio') || p.entry.musicId || p.entry.musicUrl) music++;
    if (kinds.has('video') || kinds.has('embed')) video++;
    for (const f of entryFlags(p.entry)) flags.add(f);
  }
  return { species: [...species.values()], sizes, photos, music, video, flags: [...flags] };
}

// ── the Almanac ────────────────────────────────────────────────────────────────────────────────

export interface AlmanacMonth {
  /** "2026-10". */
  month: string;
  /** Growth from the month's entries. */
  growth: number;
  plants: number;
  /** Plant words. */
  words: number;
}

export interface Almanac {
  /** "2026". */
  year: string;
  /** Every year with an entry, newest first. */
  years: string[];
  /** January to December. */
  months: AlmanacMonth[];
  growth: number;
  plants: number;
  words: number;
  /** Days with at least one entry. */
  days: number;
  /** The plant with the most plant words. */
  longest: Plant | null;
  /** The rarest plant (then crowns, then words, then the earliest). */
  rarest: Plant | null;
  /** Entries by weekday, Monday first. */
  weekdays: number[];
  /** The weekday with the most entries (0 = Monday), or -1 with none. */
  busiest: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 0 = Monday … 6 = Sunday, from the date alone (no time zone). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  // Not Date.UTC, which reads the years 0–99 as 1900–1999.
  const at = new Date(0);
  at.setUTCFullYear(y!, m! - 1, d!);
  return (at.getUTCDay() + 6) % 7;
}

/**
 * One year of the garden, by the entries' dates (as the beds are): Growth, plants and plant
 * words per month, and the year's longest entry, rarest plant and busiest weekday. With no year,
 * the newest year with an entry.
 */
export function almanac(plants: Plant[], year?: string): Almanac {
  const years = [...new Set(plants.map((p) => p.entry.date.slice(0, 4)))].sort().reverse();
  const y = year ?? years[0] ?? '';
  const months: AlmanacMonth[] = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, growth: 0, plants: 0, words: 0 }));
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const days = new Set<string>();
  let longest: Plant | null = null;
  let rarest: Plant | null = null;
  const earlier = (a: Plant, b: Plant) => cmp(a.entry.date, b.entry.date) || cmp(a.entry.createdAt, b.entry.createdAt) || cmp(a.entry.id, b.entry.id);
  const rarer = (a: Plant, b: Plant) => (a.tier - b.tier || a.crowns - b.crowns || a.words - b.words || -earlier(a, b)) > 0;
  for (const p of plants) {
    if (p.entry.date.slice(0, 4) !== y) continue;
    const m = months[Number(p.entry.date.slice(5, 7)) - 1];
    if (!m) continue;
    m.growth += p.growth;
    m.plants++;
    m.words += p.words;
    weekdays[weekdayOf(p.entry.date)]!++;
    days.add(p.entry.date);
    if (!longest || p.words > longest.words || (p.words === longest.words && earlier(p, longest) < 0)) longest = p;
    if (!rarest || rarer(p, rarest)) rarest = p;
  }
  const most = Math.max(...weekdays);
  return {
    year: y,
    years,
    months,
    growth: months.reduce((n, m) => n + m.growth, 0),
    plants: months.reduce((n, m) => n + m.plants, 0),
    words: months.reduce((n, m) => n + m.words, 0),
    days: days.size,
    longest,
    rarest,
    weekdays,
    busiest: most > 0 ? weekdays.indexOf(most) : -1,
  };
}

// ── the Time-lapse ─────────────────────────────────────────────────────────────────────────────

export interface TimeLapseMonth {
  /** "2026-10". */
  month: string;
  /** Its plants in bed order (by date); empty for a month with no entries. */
  plants: Plant[];
}

/** "2026-10" in months since year 0, so years before 1000 and after 9999 still line up. */
const monthCount = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** Every month from the garden's first to `until` ("2026-10") or its last, whichever is later. */
export function timeLapseMonths(plants: Plant[], until: string): TimeLapseMonth[] {
  if (!plants.length) return [];
  const byMonth = new Map<string, Plant[]>();
  for (const p of plants) {
    const m = p.entry.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
  }
  const keys = [...byMonth.keys()].sort();
  const last = Math.max(monthCount(keys[keys.length - 1]!), monthCount(until));
  const out: TimeLapseMonth[] = [];
  for (let i = monthCount(keys[0]!); i <= last; i++) {
    const month = `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
    out.push({ month, plants: (byMonth.get(month) ?? []).sort((a, b) => cmp(a.entry.date, b.entry.date) || cmp(a.entry.createdAt, b.entry.createdAt) || cmp(a.entry.id, b.entry.id)) });
  }
  return out;
}

/** A place in the time-lapse: how far it has played, in months, from the first month it had then. */
export interface TimeLapseSpot {
  pos: number;
  first: string;
}

/**
 * Where a spot is among the months now, from 0 to the end (`months.length`); null is the end.
 * Counted from the spot's own first month, so the same month stays in view when an earlier one
 * goes; a spot whose own month has gone shows the new first month whole.
 */
export function timeLapsePlace(spot: TimeLapseSpot | null, months: TimeLapseMonth[]): number {
  const count = months.length;
  if (!spot || !count) return count;
  const first = months[0]!.month;
  const at = spot.pos + monthCount(spot.first) - monthCount(first);
  // 0 is the start of a play only while the first month is the same one.
  return at <= 0 && spot.first !== first ? Math.min(1, count) : Math.min(count, Math.max(0, at));
}

/**
 * What the time-lapse shows `pos` months in (2.5 is halfway through the third month): the month
 * it's on, and how many of each month's plants are up. A month's plants come up through its
 * second; at a whole number the month before is complete and shown.
 */
export function timeLapseFrame(months: TimeLapseMonth[], pos: number): { index: number; shown: number[] } {
  const whole = Math.floor(pos);
  const index = Math.max(0, Math.min(Math.ceil(pos) - 1, months.length - 1));
  const shown = months.map((m, i) => (i < whole ? m.plants.length : i === whole ? Math.ceil((pos - whole) * m.plants.length) : 0));
  return { index, shown };
}

/** How long a time-lapse of this many months plays at 1×: a second a month, from 20 to 60 s. */
export function timeLapseDuration(months: number): number {
  return Math.min(60_000, Math.max(20_000, months * 1_000));
}

// ── the Star map ───────────────────────────────────────────────────────────────────────────────

export interface Star {
  plant: Plant;
  /** Across the year, by its date: 0 is 1 January, 1 is 31 December. */
  x: number;
  /** Down the sky, from its entry's id: the same place on every device. */
  y: number;
}

export interface StarMap {
  year: string;
  /** "Lisbon", the year's most-used tag (its first letter capitalised), or '' with no tags. */
  tag: string;
  /** Up to 12 stars, in date order: the year's entries with the most plant words. */
  stars: Star[];
}

/** How many of a year's entries become stars. */
export const STARS = 12;

const byDate = (a: Plant, b: Plant) => cmp(a.entry.date, b.entry.date) || cmp(a.entry.createdAt, b.entry.createdAt) || cmp(a.entry.id, b.entry.id);

/** Where in its year a date falls, from 0 to 1. */
function yearFraction(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const at = (month: number, day: number) => {
    const t = new Date(0);
    t.setUTCFullYear(y!, month, day);
    return t.getTime();
  };
  const start = at(0, 1);
  return Math.min(1, Math.max(0, (at(m! - 1, d!) - start) / (at(12, 1) - start)));
}

/**
 * A year's constellation (D100): its twelve longest entries as stars, joined in date order, named
 * after the year's most-used tag. Placed by date and id alone, so every device draws the same sky.
 */
export function starMap(plants: Plant[], year: string): StarMap {
  const own = plants.filter((p) => p.entry.date.slice(0, 4) === year);
  const tags = new Map<string, number>();
  for (const p of own) for (const t of new Set(p.entry.tags)) tags.set(t, (tags.get(t) ?? 0) + 1);
  const top = [...tags].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? '';
  const chosen = [...own].sort((a, b) => b.words - a.words || byDate(a, b)).slice(0, STARS).sort(byDate);
  const xs = spread(chosen.map((p) => yearFraction(p.entry.date)));
  const stars = chosen.map((plant, i) => ({ plant, x: xs[i]!, y: 0.2 + ((fnv1a32(plant.entry.id) % 1000) / 1000) * 0.6 }));
  return { year, tag: capitalised(top), stars };
}

/**
 * A tag with its first letter capitalised, as a name: not in scripts without capitals at the start
 * of a name (Georgian has capitals, but not for that), and never cutting a character in two.
 */
function capitalised(tag: string): string {
  const [first = ''] = tag;
  return /\p{Script=Georgian}/u.test(first) ? tag : first.toUpperCase() + tag.slice(first.length);
}

/**
 * Stars at least STAR_GAP of the sky apart, so each can be tapped on a phone (entries of one day
 * would otherwise share a place), in the same order, and all still within the year.
 */
export const STAR_GAP = 0.085;
function spread(xs: number[]): number[] {
  const out = [...xs];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + STAR_GAP);
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i]!, 1 - (out.length - 1 - i) * STAR_GAP);
  return out;
}
