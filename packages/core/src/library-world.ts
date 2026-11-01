import type { Book, LibraryGallery } from './library.ts';

/**
 * The Library you walk through (D113), in metres: a line of hexagonal galleries, as in Borges's
 * Library of Babel, one (or more, when it overflows) for each year with entries, then empty ones
 * for the years to come, for good, along +z. Two opposite sides of each hexagon are doorways; the
 * other four are bookcases, filled shelf by shelf in the order of the days. Behind the first
 * gallery, through its back door and a short corridor, the storage room runs the other way (-z)
 * for good: racks along both walls, each entry a manila folder. Everything here is plain numbers,
 * so the 3D view (apps/web/src/world) and the tests share it.
 */

/** A hexagon's side (and corner radius). */
export const ROOM_SIDE = 5;
/** From a gallery's centre to the middle of a side. */
export const ROOM_APOTHEM = (ROOM_SIDE * Math.sqrt(3)) / 2;
/** Gallery k's centre is at z = k × ROOM_STEP. */
export const ROOM_STEP = 2 * ROOM_APOTHEM;
export const DOOR_WIDTH = 1.8;
export const DOOR_HEIGHT = 2.6;
export const WALL_HEIGHT = 3.4;
/** The sides (0–5, counting from +x towards +z) with bookcases, in the order they're filled: front left, front right, back right, back left as you come in. */
export const WALL_SIDES = [0, 2, 3, 5] as const;
export const CASE_WIDTH = 4.4;
export const CASE_HEIGHT = 2.3;
export const SHELF_DEPTH = 0.36;
/** Shelf heights, top first (the order they're filled: like reading a page). */
export const SHELF_HEIGHTS = [1.78, 1.36, 0.94, 0.52, 0.1] as const;
/** Room along a shelf for books. */
export const SHELF_ROOM = 4.3;
/** A bookend between months. */
export const BOOKEND = 0.03;
export const BOOK_DEPTH = 0.22;
/** Eye height, and how far from anything a walker keeps. */
export const EYE = 1.6;
export const BODY = 0.3;

/** The storage room: a hall, 10 m wide, from the corridor behind the first gallery, onwards for good. */
export const CORRIDOR = 3;
export const HALL_START = -ROOM_APOTHEM - CORRIDOR;
export const HALL_WIDTH = 10;
export const HALL_HEIGHT = 4;
/** An open space inside the door before the first racks. */
export const HALL_ENTRY = 1.5;
export const RACK_LENGTH = 2.4;
export const RACK_DEPTH = 0.45;
export const RACK_HEIGHT = 2.2;
/** Rack shelf heights, top first. */
export const RACK_SHELVES = [1.68, 1.28, 0.88, 0.48, 0.08] as const;
export const RACK_ROOM = 2.3;
export const FOLDER_HEIGHT = 0.3;
export const FOLDER_DEPTH = 0.24;
/** A guide card between months. */
export const GUIDE = 0.012;

/** A book's size in the world, from its size on the flat shelves. */
export function bookMetres(book: Book): { thickness: number; height: number } {
  return { thickness: book.thickness / 600, height: book.height / 400 };
}

/** A folder's thickness: a sheet or two for a note, a fat file for a long entry. */
export function folderThickness(words: number): number {
  return 0.01 + 0.03 * Math.sqrt(Math.min(1, Math.max(0, words) / 4000));
}

/** Something on a shelf, `x` metres from its left end as you face it. */
export type ShelfThing = { kind: 'book'; book: Book; x: number; width: number } | { kind: 'divider'; month: string; x: number; width: number };

export interface LibraryRoom {
  index: number;
  /** "Gallery 2026", "Gallery 2026 · II" when a year fills more than one. */
  label: string;
  year: string;
  /** [wall (WALL_SIDES order)][shelf (SHELF_HEIGHTS order)] */
  walls: ShelfThing[][][];
  books: number;
  /** The first and last days on its shelves. */
  first?: string;
  last?: string;
}

const ROMAN = ['', '', ' · II', ' · III', ' · IV', ' · V', ' · VI', ' · VII', ' · VIII', ' · IX', ' · X'];
const part = (n: number) => ROMAN[n] ?? ` · ${n}`;

/** Fills shelves in order with books (and a divider before each month's first), opening new ones as they fill. */
function shelve<T extends { month: string; width: number }>(
  months: { month: string; items: T[] }[],
  room: number,
  shelvesPer: number,
  divider: number,
  place: (thing: { kind: 'divider'; month: string; width: number } | (T & { kind: 'item' }), unit: number, shelf: number, x: number) => void,
): void {
  let unit = 0;
  let shelf = 0;
  let x = 0;
  const next = () => {
    x = 0;
    if (++shelf === shelvesPer) {
      shelf = 0;
      unit++;
    }
  };
  for (const m of months) {
    if (!m.items.length) continue;
    // A divider never ends a shelf alone: it goes where its month's first item fits after it.
    if (x > 0 && x + divider + m.items[0]!.width > room) next();
    place({ kind: 'divider', month: m.month, width: divider }, unit, shelf, x);
    x += divider;
    for (const item of m.items) {
      if (x > 0 && x + item.width > room) next();
      place({ ...item, kind: 'item' }, unit, shelf, x);
      x += item.width;
    }
  }
}

/** The galleries with books, in order: each year its own, overflowing into more when it's full. */
export function libraryRooms(galleries: readonly LibraryGallery[]): LibraryRoom[] {
  const rooms: LibraryRoom[] = [];
  const perRoom = WALL_SIDES.length * SHELF_HEIGHTS.length;
  for (const g of galleries) {
    const start = rooms.length;
    const months = g.months.map((m) => ({ month: m.month, items: m.books.map((book) => ({ month: m.month, book, width: bookMetres(book).thickness })) }));
    shelve(months, SHELF_ROOM, perRoom, BOOKEND, (thing, unit, shelf, x) => {
      while (rooms.length <= start + unit) {
        const n = rooms.length - start + 1;
        rooms.push({ index: rooms.length, label: `Gallery ${g.year}${part(n)}`, year: g.year, walls: WALL_SIDES.map(() => SHELF_HEIGHTS.map(() => [])), books: 0 });
      }
      const room = rooms[start + unit]!;
      const wall = Math.floor(shelf / SHELF_HEIGHTS.length);
      const row = room.walls[wall]![shelf % SHELF_HEIGHTS.length]!;
      if (thing.kind === 'divider') row.push({ kind: 'divider', month: thing.month, x, width: thing.width });
      else {
        row.push({ kind: 'book', book: thing.book, x, width: thing.width });
        room.books++;
        room.first ??= thing.book.date;
        room.last = thing.book.date;
      }
    });
  }
  return rooms;
}

/** Gallery `index`: one with books, or past them an empty one for a year to come (the year after the last, or this year if there are none). */
export function roomAt(rooms: readonly LibraryRoom[], index: number, thisYear: number): LibraryRoom {
  const room = rooms[index];
  if (room) return room;
  const last = rooms.at(-1);
  const year = String((last ? Number(last.year) : thisYear - 1) + (index - rooms.length + 1));
  return { index, label: `Gallery ${year}`, year, walls: WALL_SIDES.map(() => SHELF_HEIGHTS.map(() => [])), books: 0 };
}

// ── the storage room ─────────────────────────────────────────────────────────────────────────────

/** Something on a rack shelf, `x` metres from its left end as you face it. */
export type RackThing = { kind: 'folder'; book: Book; x: number; width: number } | { kind: 'guide'; month: string; x: number; width: number };

export interface ArchiveRack {
  /** Racks go in pairs down the hall: 0 on the left as you go in, 1 opposite it, 2 next on the left… */
  index: number;
  /** [shelf (RACK_SHELVES order)] */
  shelves: RackThing[][];
  folders: number;
  first?: string;
  last?: string;
}

/** The racks with folders, in order. Past them, every rack is empty. */
export function archiveRacks(galleries: readonly LibraryGallery[]): ArchiveRack[] {
  const racks: ArchiveRack[] = [];
  const months = galleries.flatMap((g) => g.months.map((m) => ({ month: m.month, items: m.books.map((book) => ({ month: m.month, book, width: folderThickness(book.words) })) })));
  shelve(months, RACK_ROOM, RACK_SHELVES.length, GUIDE, (thing, unit, shelf, x) => {
    while (racks.length <= unit) racks.push({ index: racks.length, shelves: RACK_SHELVES.map(() => []), folders: 0 });
    const rack = racks[unit]!;
    if (thing.kind === 'divider') rack.shelves[shelf]!.push({ kind: 'guide', month: thing.month, x, width: thing.width });
    else {
      rack.shelves[shelf]!.push({ kind: 'folder', book: thing.book, x, width: thing.width });
      rack.folders++;
      rack.first ??= thing.book.date;
      rack.last = thing.book.date;
    }
  });
  return racks;
}

// ── where things are ─────────────────────────────────────────────────────────────────────────────

export interface Wall {
  /** The middle of the shelves' front, on the floor. */
  x: number;
  z: number;
  /** Outward normal (towards the wall), and the shelf's left-to-right direction as you face it. */
  nx: number;
  nz: number;
  tx: number;
  tz: number;
}

/** Side `side` (0–5) of gallery `room`, at the front of its bookcase. */
export function gallerySide(room: number, side: number, inset = SHELF_DEPTH): Wall {
  const a = ((side * 60 + 30) * Math.PI) / 180;
  const nx = Math.cos(a);
  const nz = Math.sin(a);
  const d = ROOM_APOTHEM - inset;
  // Facing the wall (along n), your right is (-nz, nx).
  return { x: nx * d, z: room * ROOM_STEP + nz * d, nx, nz, tx: -nz, tz: nx };
}

/** Rack `index`'s front. Going in (towards -z), your left is -x: even racks are on that wall, odd ones opposite. */
export function rackFront(index: number): Wall {
  const pair = Math.floor(index / 2);
  const nx = index % 2 === 0 ? -1 : 1;
  const z = HALL_START - HALL_ENTRY - pair * RACK_LENGTH - RACK_LENGTH / 2;
  const x = nx * (HALL_WIDTH / 2 - RACK_DEPTH);
  return { x, z, nx, nz: 0, tx: 0, tz: nx };
}

export interface Spot {
  x: number;
  z: number;
  /** Turned towards -z at 0, anticlockwise from above (three.js's rotation.y). */
  yaw: number;
  pitch: number;
}

/**
 * Where to stand to look at something on a wall, `along` metres from its left end, at height `y`,
 * from `away` metres; near a corner, nearer the middle of the room (`middle`), where there's floor.
 */
export function spotFacing(wall: Wall, width: number, along: number, y: number, middle: { x: number; z: number }, away = 1.4): Spot {
  const px = wall.x + wall.tx * (along - width / 2);
  const pz = wall.z + wall.tz * (along - width / 2);
  let sx = px - wall.nx * away;
  let sz = pz - wall.nz * away;
  for (let i = 0; i < 40 && !canStand(sx, sz); i++) {
    sx += (middle.x - sx) * 0.15;
    sz += (middle.z - sz) * 0.15;
  }
  return { x: sx, z: sz, yaw: Math.atan2(-(px - sx), -(pz - sz)), pitch: Math.atan2(y - EYE, Math.hypot(px - sx, pz - sz)) };
}

/** Where to stand to look at a book in a gallery. */
export function spotForBook(room: number, wall: number, shelf: number, thing: ShelfThing): Spot {
  const side = gallerySide(room, WALL_SIDES[wall]!);
  return spotFacing(side, CASE_WIDTH, (CASE_WIDTH - SHELF_ROOM) / 2 + thing.x + thing.width / 2, SHELF_HEIGHTS[shelf]! + 0.15, { x: 0, z: room * ROOM_STEP });
}

/** Where to stand to look at a folder in the storage room. */
export function spotForFolder(rack: number, shelf: number, thing: RackThing): Spot {
  const front = rackFront(rack);
  return spotFacing(front, RACK_LENGTH, (RACK_LENGTH - RACK_ROOM) / 2 + thing.x + thing.width / 2, RACK_SHELVES[shelf]! + 0.15, { x: 0, z: front.z }, 1.3);
}

/** Where you come in: the first gallery, by its back door, looking in; or inside the storage room's door. */
export function entrance(world: 'library' | 'storage'): Spot {
  return world === 'library' ? { x: 0, z: -ROOM_APOTHEM + 1.4, yaw: Math.PI, pitch: 0 } : { x: 0, z: HALL_START - 0.8, yaw: 0, pitch: 0 };
}

// ── where you can walk ───────────────────────────────────────────────────────────────────────────

/** Keep this far from the bookcases (their depth, and your body). */
const CLEAR = SHELF_DEPTH + BODY;

function inGallery(x: number, z: number, room: number): boolean {
  if (room < 0) return false;
  const dz = z - room * ROOM_STEP;
  for (let side = 0; side < 6; side++) {
    const a = ((side * 60 + 30) * Math.PI) / 180;
    if (x * Math.cos(a) + dz * Math.sin(a) > ROOM_APOTHEM - CLEAR) return false;
  }
  return true;
}

/** Through a doorway: between gallery k-1 and k (k ≥ 1), or from the first into the corridor (k = 0). */
function inDoorway(x: number, z: number, k: number): boolean {
  const wall = k * ROOM_STEP - ROOM_APOTHEM;
  return Math.abs(x) <= DOOR_WIDTH / 2 - BODY && Math.abs(z - wall) <= CLEAR + 0.1;
}

/** Whether someone can stand here. */
export function canStand(x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (z > -ROOM_APOTHEM - 1) {
    const k = Math.round(z / ROOM_STEP);
    if (inGallery(x, z, k) || inGallery(x, z, k - 1) || inGallery(x, z, k + 1)) return true;
    if (inDoorway(x, z, Math.max(0, k)) || inDoorway(x, z, k + 1)) return true;
  }
  // The corridor to the storage room, and the hall itself.
  if (z <= -ROOM_APOTHEM + CLEAR && z >= HALL_START - 0.5 && Math.abs(x) <= DOOR_WIDTH / 2 - BODY) return true;
  return z <= HALL_START - BODY && Math.abs(x) <= HALL_WIDTH / 2 - RACK_DEPTH - BODY;
}

/** A step from here by (dx, dz): all of it if there's floor, else sliding along whatever's in the way. */
export function step(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
  if (canStand(x + dx, z + dz)) return { x: x + dx, z: z + dz };
  if (canStand(x + dx, z)) return { x: x + dx, z };
  if (canStand(x, z + dz)) return { x, z: z + dz };
  return { x, z };
}

/** Where someone is: a gallery, by number, or the storage room, by the pair of racks beside them. */
export function placeAt(z: number): { world: 'library'; room: number } | { world: 'storage'; aisle: number } {
  if (z > -ROOM_APOTHEM) return { world: 'library', room: Math.max(0, Math.round(z / ROOM_STEP)) };
  return { world: 'storage', aisle: Math.max(0, Math.floor((HALL_START - HALL_ENTRY - z) / RACK_LENGTH)) };
}
