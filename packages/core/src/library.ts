import type { Entry, Mood } from './model.ts';
import { today } from './dates.ts';
import { letterSealed } from './letters.ts';

/**
 * The Library (D112): every entry a book, shelved by month in a gallery for each year, in the
 * order the days come. A book is as thick as the entry is long, and a very long one stands taller.
 * The shelves past the newest book go on for good, ready for what's still to be written.
 */

export interface Book {
  id: string;
  title: string;
  /** The entry's day (YYYY-MM-DD). */
  date: string;
  words: number;
  mood: Mood | null;
  /** The spine's width in CSS pixels. */
  thickness: number;
  /** The book's height in CSS pixels. */
  height: number;
  /** Which leather a book without a mood is bound in (0–3), the same each time. */
  tone: number;
  /** A letter to your future self, still sealed: the day it opens (D122). */
  sealed?: string;
}

export interface LibraryMonth {
  /** YYYY-MM */
  month: string;
  books: Book[];
  words: number;
}

export interface LibraryGallery {
  /** YYYY */
  year: string;
  months: LibraryMonth[];
  books: number;
  words: number;
}

/** The thinnest spine: wide enough to tap (WCAG's 24 px target) and to show the day. */
export const BOOK_MIN_THICKNESS = 24;
export const BOOK_MAX_THICKNESS = 64;
export const BOOK_HEIGHT = 96;
/** The tallest a book stands: the shelves are made for it. */
export const BOOK_MAX_HEIGHT = 132;
/** An entry this long or longer makes the thickest book. */
const THICKEST_WORDS = 4000;

/** A spine's width: thin for a note, thicker the more was written (quickly at first, then slowly). */
export function bookThickness(words: number): number {
  const share = Math.sqrt(Math.min(1, Math.max(0, words) / THICKEST_WORDS));
  return Math.round(BOOK_MIN_THICKNESS + (BOOK_MAX_THICKNESS - BOOK_MIN_THICKNESS) * share);
}

/** A small number from a string, the same each time (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A book's height: most stand the same, give or take a little; a very long entry stands taller. */
export function bookHeight(words: number, id: string): number {
  const taller = words >= 3000 ? 28 : words >= 1500 ? 16 : 0;
  return Math.min(BOOK_MAX_HEIGHT, BOOK_HEIGHT + taller + (hash(id) % 9));
}

const byDay = (a: Entry, b: Entry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The library of these entries (trashed ones aren't on the shelves), oldest gallery first. */
export function shelveLibrary(entries: readonly Entry[], wordsOf: (entry: Entry) => number, day: string = today()): LibraryGallery[] {
  const galleries: LibraryGallery[] = [];
  for (const entry of entries.filter((e) => !e.deletedAt).sort(byDay)) {
    const year = entry.date.slice(0, 4);
    const month = entry.date.slice(0, 7);
    const words = Math.max(0, wordsOf(entry));
    let gallery = galleries.at(-1);
    if (gallery?.year !== year) galleries.push((gallery = { year, months: [], books: 0, words: 0 }));
    let shelf = gallery.months.at(-1);
    if (shelf?.month !== month) gallery.months.push((shelf = { month, books: [], words: 0 }));
    shelf.books.push({
      id: entry.id,
      title: entry.title,
      date: entry.date,
      words,
      mood: entry.mood,
      thickness: bookThickness(words),
      height: bookHeight(words, entry.id),
      tone: hash(entry.id) % 4,
      ...(letterSealed(entry, day) ? { sealed: entry.sealedUntil! } : {}),
    });
    shelf.words += words;
    gallery.books++;
    gallery.words += words;
  }
  return galleries;
}
