import { SIZE_STAGES, type Plant } from './garden.ts';
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
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
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

/** Every month from the garden's first to `until` ("2026-10") or its last, whichever is later. */
export function timeLapseMonths(plants: Plant[], until: string): TimeLapseMonth[] {
  if (!plants.length) return [];
  const byMonth = new Map<string, Plant[]>();
  for (const p of plants) {
    const m = p.entry.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
  }
  const keys = [...byMonth.keys()].sort();
  const last = cmp(keys[keys.length - 1]!, until) > 0 ? keys[keys.length - 1]! : until;
  const out: TimeLapseMonth[] = [];
  let [y, m] = keys[0]!.split('-').map(Number) as [number, number];
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (cmp(month, last) > 0) break;
    out.push({ month, plants: (byMonth.get(month) ?? []).sort((a, b) => cmp(a.entry.date, b.entry.date) || cmp(a.entry.createdAt, b.entry.createdAt) || cmp(a.entry.id, b.entry.id)) });
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/** How long a time-lapse of this many months plays at 1×: a second a month, from 20 to 60 s. */
export function timeLapseDuration(months: number): number {
  return Math.min(60_000, Math.max(20_000, months * 1_000));
}
