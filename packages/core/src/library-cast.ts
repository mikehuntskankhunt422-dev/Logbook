import { addDays } from './dates.ts';
import type { Book, LibraryGallery } from './library.ts';
import { canStand, EYE, HALL_START, placeAt, type Spot } from './library-world.ts';

/**
 * The people of the walking Library (D116): the Librarian, in the first gallery, and the Clerk, in
 * the storage room. Each stands where nothing of yours is behind them (clear of the bookcases and
 * racks, and of the line down the middle you walk along), and can't be walked through.
 */

export type CastId = 'librarian' | 'clerk';

export interface CastMember {
  id: CastId;
  name: string;
  x: number;
  z: number;
  /** Which way they face, as a Spot's yaw (0 towards -z). */
  yaw: number;
}

/** Facing from (x, z) towards (tx, tz), as a yaw. */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

export const CAST: readonly CastMember[] = [
  // In the first gallery, to the right of the way through as you come in, looking at that door.
  { id: 'librarian', name: 'The Librarian', x: -1.4, z: 0.6, yaw: facing(-1.4, 0.6, 0, -2.9) },
  // A little way into the storage room, on the left, looking at its door.
  { id: 'clerk', name: 'The Clerk', x: -2.4, z: HALL_START - 3.2, yaw: facing(-2.4, HALL_START - 3.2, 0, HALL_START - 0.8) },
];

/** How close anyone can come to one of them. */
export const CAST_RADIUS = 0.55;

export const castMember = (id: CastId): CastMember => CAST.find((c) => c.id === id)!;

/** Whether someone can stand here: on the floor, and not where one of the cast stands. */
export function canStandAmong(x: number, z: number): boolean {
  return canStand(x, z) && CAST.every((c) => Math.hypot(x - c.x, z - c.z) >= CAST_RADIUS);
}

/** A step, as `step` takes it, around the cast as well as the walls. */
export function stepAmong(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
  if (canStandAmong(x + dx, z + dz)) return { x: x + dx, z: z + dz };
  if (canStandAmong(x + dx, z)) return { x: x + dx, z };
  if (canStandAmong(x, z + dz)) return { x, z: z + dz };
  return { x, z };
}

/** Where to stand to talk to one of them: a little in front, facing them. */
export function spotForCast(id: CastId, away = 1.5): Spot {
  const c = castMember(id);
  const x = c.x - Math.sin(c.yaw) * away;
  const z = c.z - Math.cos(c.yaw) * away;
  return { x, z, yaw: facing(x, z, c.x, c.z), pitch: Math.atan2(1.5 - EYE, away) };
}

// ── what they know ───────────────────────────────────────────────────────────────────────────────

export interface LibraryFacts {
  books: number;
  words: number;
  years: string[];
  first: Book | null;
  newest: Book | null;
  longest: Book | null;
  /** The month with the most books, and how many. */
  busiest: { month: string; books: number } | null;
  /** A book from within a fortnight of this day a year ago, the closest. */
  yearAgo: Book | null;
  /** The storage room's aisles with folders in them. */
  aisles: number;
}

/** What the cast know about the library: worked out from the shelves alone, never the entries' words. */
export function libraryFacts(galleries: readonly LibraryGallery[], today: string, racks = 0): LibraryFacts {
  const all = galleries.flatMap((g) => g.months.flatMap((m) => m.books));
  let longest: Book | null = null;
  for (const b of all) if (!longest || b.words > longest.words) longest = b;
  let busiest: LibraryFacts['busiest'] = null;
  for (const g of galleries) for (const m of g.months) if (!busiest || m.books.length > busiest.books) busiest = { month: m.month, books: m.books.length };
  const target = addDays(today, -365);
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
  let yearAgo: Book | null = null;
  for (const b of all) {
    const off = Math.abs(day(b.date) - day(target));
    if (off <= 14 && (!yearAgo || off < Math.abs(day(yearAgo.date) - day(target)))) yearAgo = b;
  }
  return {
    books: all.length,
    words: galleries.reduce((n, g) => n + g.words, 0),
    years: galleries.map((g) => g.year),
    first: all[0] ?? null,
    newest: all.at(-1) ?? null,
    longest,
    busiest,
    yearAgo,
    aisles: Math.ceil(racks / 2),
  };
}

/** Where someone is standing, in the cast's own words: "Gallery 2027", "the storage room, aisle 12". */
export function whereIs(z: number, label: string): string {
  const place = placeAt(z);
  return place.world === 'library' ? label : `the storage room, aisle ${place.aisle + 1}`;
}
