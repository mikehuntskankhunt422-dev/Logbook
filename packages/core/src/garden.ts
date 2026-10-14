import type { Entry, RichNode } from './model.ts';
import { richTextToPlain } from './richtext.ts';

/**
 * The garden (D97, docs/GARDEN.md): one plant per entry. Its size is the entry's own words, its
 * species its mood, and its rarity the rank the whole garden had when it was written, on 15 tiers
 * and then endless rings. Everything is worked out from the entries, so it needs no stored data.
 *
 * Growth rewards writing, not padding: it's earned per day you write (100 for turning up, and up to
 * 439 for your words on a slowing curve), and repeated sentences, text copied from other entries,
 * links, number lists and repeated-word filler add nothing.
 */

export const TIERS = [
  { name: 'Common', emoji: '🌱', at: 0 },
  { name: 'Uncommon', emoji: '🌿', at: 300 },
  { name: 'Rare', emoji: '🌷', at: 1_000 },
  { name: 'Epic', emoji: '🌸', at: 2_000 },
  { name: 'Legendary', emoji: '🪷', at: 3_500 },
  { name: 'Mythic', emoji: '🔥', at: 5_500 },
  { name: 'Radiant', emoji: '☀️', at: 8_500 },
  { name: 'Prismatic', emoji: '🌈', at: 13_000 },
  { name: 'Crystal', emoji: '💎', at: 20_000 },
  { name: 'Celestial', emoji: '🌙', at: 30_000 },
  { name: 'Aurora', emoji: '🌌', at: 45_000 },
  { name: 'Cosmic', emoji: '🪐', at: 70_000 },
  { name: 'Eternal', emoji: '👑', at: 105_000 },
  { name: 'Primordial', emoji: '🐉', at: 160_000 },
  { name: 'Worldbloom', emoji: '🌳', at: 250_000 },
] as const;
export const TOP_TIER = TIERS.length - 1;
/** Past Worldbloom, a ring every 100,000 more: ★2 at 350,000. */
export const RING_STEP = 100_000;

export const SIZE_STAGES = [
  { name: 'Little', from: 0, blooms: 1 },
  { name: 'Sprig', from: 20, blooms: 1 },
  { name: 'Stem', from: 60, blooms: 2 },
  { name: 'Bloom', from: 150, blooms: 3 },
  { name: 'Clump', from: 300, blooms: 5 },
  { name: 'Bush', from: 600, blooms: 7 },
  { name: 'Tall bush', from: 1_200, blooms: 9 },
  { name: 'Flowering tree', from: 2_500, blooms: 12 },
] as const;

/** Mood → species; no mood → Wildflower. */
export const SPECIES: Record<string, string> = {
  '😄': 'Sunflower',
  '🙂': 'Daisy',
  '😐': 'Tulip',
  '😔': 'Bluebell',
  '😢': 'Snowdrop',
  '😠': 'Poppy',
  '😴': 'Lavender',
  '🤩': 'Star lily',
  '🥰': 'Rose',
  '🤔': 'Iris',
};
export const WILDFLOWER = 'Wildflower';

export interface Rank {
  /** 0 = Common … 14 = Worldbloom. */
  tier: number;
  /** Rings past Worldbloom (★2 = 2); 1 below that. */
  ring: number;
  growth: number;
  /** Growth where the next tier or ring starts. */
  next: number;
  /** Growth where the current one started. */
  from: number;
}

export function rankFor(growth: number): Rank {
  let tier = 0;
  for (let i = 0; i < TIERS.length; i++) if (growth >= TIERS[i]!.at) tier = i;
  if (tier < TOP_TIER) return { tier, ring: 1, growth, from: TIERS[tier]!.at, next: TIERS[tier + 1]!.at };
  const top = TIERS[TOP_TIER]!.at;
  const ring = 1 + Math.floor((growth - top) / RING_STEP);
  const from = top + (ring - 1) * RING_STEP;
  return { tier, ring, growth, from, next: from + RING_STEP };
}

export function sizeStage(words: number): number {
  let s = 0;
  for (let i = 0; i < SIZE_STAGES.length; i++) if (words >= SIZE_STAGES[i]!.from) s = i;
  return s;
}

/** Plant height in garden units: 36 for nothing, 210 from 3,000 words. */
export function plantHeight(words: number): number {
  return Math.round(36 + 24 * Math.log2(1 + Math.min(words, 3000) / 20));
}

/** Growth for a day's words: 100 × log2(1 + w/150), from at most 3,000 words (439). */
export function wordGrowth(words: number): number {
  return Math.round(100 * Math.log2(1 + Math.min(words, 3000) / 150));
}
/** For turning up: a day with an entry of at least this many written words. */
export const TURN_UP = 100;
export const TURN_UP_WORDS = 20;

// ── words ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Scripts written without spaces between words are cut into short runs instead: Chinese 2
 * characters, Japanese kana 3, Thai, Lao, Khmer and Burmese 4 letters (with their marks), so a
 * line of them counts about as many words as the same line in English.
 */
const UNSPACED = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30fc\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}';
const WORD_RE = new RegExp(
  '\\p{Script=Han}{1,2}' +
    '|[\\p{Script=Hiragana}\\p{Script=Katakana}\\u30fc]{1,3}' +
    '|(?:(?=\\p{L})[\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}]\\p{M}*){1,4}' +
    `|(?![${UNSPACED}])[\\p{L}\\p{N}](?:(?![${UNSPACED}])[\\p{L}\\p{M}\\p{N}'’-])*`,
  'gu',
);
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const SENTENCE_SPLIT = /[.!?…。！？\n]+/;
/** An entry's written words count up to 4 times its different words: "lol lol lol…" is 4. */
const VARIETY = 4;

/** The words of one piece of text that count: no links, no long or repeated-letter junk. */
function tokens(text: string, numbersLeft: { n: number }): string[] {
  const out: string[] = [];
  for (const m of text.normalize('NFKC').toLowerCase().matchAll(WORD_RE)) {
    const w = m[0];
    if (w.length > 40) continue;
    if (w.length >= 4 && /^(.)\1+$/u.test(w)) continue;
    if (!/\p{L}/u.test(w)) {
      // Numbers count, but only the first 25 in an entry (dates, prices), not lists of them.
      if (numbersLeft.n <= 0) continue;
      numbersLeft.n--;
    }
    out.push(w);
  }
  return out;
}

/** The pieces of writing in an entry: title, each paragraph or heading, captions, link titles. */
function pieces(entry: Entry): string[] {
  const out = [entry.title];
  const walk = (n: RichNode) => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') out.push(richTextToPlain(n));
    else for (const c of n.content ?? []) walk(c);
  };
  for (const b of entry.blocks) {
    if (b.type === 'text') walk(b.doc);
    else if (b.type === 'gallery') out.push(b.caption, ...b.items.map((i) => i.caption));
    else if (b.type === 'link' || b.type === 'embed') out.push(b.title, b.caption);
    else out.push(b.caption);
  }
  return out.filter((t) => t.trim());
}

/** A small, stable hash for sentences (cyrb53). */
function hash(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** What one entry holds, worked out once per saved version (see GardenCache). */
export interface EntryAnalysis {
  /** Each sentence that counts within the entry (repeats of 3+ words dropped), and its words. */
  keys: number[];
  sizes: number[];
  /** The most its written words can count: VARIETY × its different words. */
  cap: number;
  /** Words for voice, video and pictures. */
  extra: number;
}

function analyse(entry: Entry): EntryAnalysis {
  const numbers = { n: 25 };
  const own = new Set<number>();
  const vocab = new Set<string>();
  const keys: number[] = [];
  const sizes: number[] = [];
  for (const piece of pieces(entry)) {
    for (const sentence of piece.replace(URL_RE, ' ').split(SENTENCE_SPLIT)) {
      const t = tokens(sentence, numbers);
      if (!t.length) continue;
      const key = hash(t.join(' '));
      if (t.length >= 3 && own.has(key)) continue;
      own.add(key);
      keys.push(key);
      sizes.push(t.length);
      for (const w of t) vocab.add(w);
    }
  }
  let voice = 0;
  let pictures = 0;
  for (const b of entry.blocks) {
    if (b.type === 'audio' || b.type === 'video') voice += 40;
    else if (b.type === 'photo' || b.type === 'file') pictures += 10;
    else if (b.type === 'gallery') pictures += 10 * b.items.length;
  }
  return { keys, sizes, cap: VARIETY * vocab.size, extra: Math.min(voice, 200) + Math.min(pictures, 50) };
}

/** Plant words from an analysis, given the sentences of earlier entries (which it then joins). */
function count(a: EntryAnalysis, seen: Set<number>): { words: number; written: number } {
  let written = 0;
  for (let i = 0; i < a.keys.length; i++) if (!(a.sizes[i]! >= 5 && seen.has(a.keys[i]!))) written += a.sizes[i]!;
  for (const k of a.keys) seen.add(k);
  written = Math.min(written, a.cap);
  return { words: written + a.extra, written };
}

/**
 * An entry's plant words: its own written words (a sentence of 3+ words repeated in the entry, or
 * of 5+ words already in an earlier entry, adds nothing, and words count at most 4 times each
 * different word), plus a little for voice and pictures. `seen` holds the sentences of earlier
 * entries and gains this one's.
 */
export function plantWords(entry: Entry, seen: Set<number> = new Set()): { words: number; written: number } {
  return count(analyse(entry), seen);
}

/**
 * Analyses of entries by saved version, so that growing the garden again after a save only reads
 * the entry that changed. Keep one for the app's lifetime and pass it to every growGarden.
 */
export type GardenCache = Map<string, EntryAnalysis>;

// ── the garden ───────────────────────────────────────────────────────────────────────────────────

export interface Plant {
  entry: Entry;
  /** Plant words: the plant's size. */
  words: number;
  stage: number;
  species: string;
  /** Rarity: the garden's tier before this entry, plus 1 for 600+ words and 2 for 1,200+. */
  tier: number;
  /** Bloom bonus ribbons (0–2). */
  bonus: number;
  /** Crowns for plants that would bloom past Worldbloom (0–2). */
  crowns: number;
}

export interface Garden {
  plants: Plant[];
  rank: Rank;
}

const dayOf = (e: Entry) => (/^\d{4}-\d{2}-\d{2}T/.test(e.createdAt) ? e.createdAt.slice(0, 10) : e.date);

/**
 * The garden of these entries (live and trashed: trashed ones keep counting until they're gone
 * for good, and only live ones show; an entry in both lists counts once, as the live one). Taken
 * in the order they were written.
 */
export function growGarden(entries: Entry[], cache?: GardenCache): Garden {
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    const had = byId.get(e.id);
    if (!had || (had.deletedAt && !e.deletedAt)) byId.set(e.id, e);
  }
  const ordered = [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  const used = cache && new Set<string>();
  const seen = new Set<number>();
  const days = new Map<string, { words: number; turnedUp: boolean }>();
  let growth = 0;
  const plants: Plant[] = [];
  for (const entry of ordered) {
    let analysis: EntryAnalysis;
    if (cache && used) {
      const key = `${entry.id}\u0000${entry.rev}\u0000${entry.updatedAt}`;
      analysis = cache.get(key) ?? analyse(entry);
      cache.set(key, analysis);
      used.add(key);
    } else analysis = analyse(entry);
    const { words, written } = count(analysis, seen);
    const base = rankFor(growth).tier;
    const bonus = words >= 1_200 ? 2 : words >= 600 ? 1 : 0;
    const tier = Math.min(base + bonus, TOP_TIER);
    if (!entry.deletedAt)
      plants.push({ entry, words, stage: sizeStage(words), species: (entry.mood && SPECIES[entry.mood]) || WILDFLOWER, tier, bonus, crowns: base + bonus - tier });
    // This entry's share of its day's Growth.
    const key = dayOf(entry);
    const day = days.get(key) ?? { words: 0, turnedUp: false };
    const before = (day.turnedUp ? TURN_UP : 0) + wordGrowth(day.words);
    day.words += words;
    day.turnedUp ||= written >= TURN_UP_WORDS;
    days.set(key, day);
    growth += (day.turnedUp ? TURN_UP : 0) + wordGrowth(day.words) - before;
  }
  // Forget the versions that have been saved over.
  if (cache && used && cache.size > used.size) for (const k of cache.keys()) if (!used.has(k)) cache.delete(k);
  return { plants, rank: rankFor(growth) };
}

/** "Rare", or "Worldbloom ★3" past the top. */
export function rankName(rank: Pick<Rank, 'tier' | 'ring'>): string {
  const name = TIERS[rank.tier]!.name;
  return rank.ring > 1 ? `${name} ★${rank.ring}` : name;
}
