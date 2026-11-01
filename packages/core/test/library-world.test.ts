import { describe, expect, it } from 'vitest';
import { shelveLibrary, type Book, type LibraryGallery } from '../src/library.ts';
import {
  BOOKEND,
  CASE_WIDTH,
  DOOR_WIDTH,
  EYE,
  HALL_START,
  HALL_WIDTH,
  RACK_ROOM,
  RACK_SHELVES,
  ROOM_APOTHEM,
  ROOM_STEP,
  SHELF_HEIGHTS,
  SHELF_ROOM,
  WALL_SIDES,
  archiveRacks,
  bookMetres,
  canStand,
  entrance,
  folderThickness,
  gallerySide,
  libraryRooms,
  placeAt,
  rackFront,
  roomAt,
  spotForBook,
  spotForFolder,
  step,
  type LibraryRoom,
} from '../src/library-world.ts';
import type { Entry } from '../src/model.ts';
import { emptyDoc } from '../src/richtext.ts';

let n = 0;
function entry(date: string, words: number): Entry {
  n++;
  const at = `${date}T10:00:00.000Z`;
  const text = Array.from({ length: words }, (_, i) => `w${i}`).join(' ');
  return { v: 1, id: `e${n}`, date, title: `T${n}`, mood: null, cover: { kind: 'gradient', gradient: 'sunrise' }, tags: [], blocks: [{ id: `b${n}`, type: 'text', doc: emptyDoc(text) }], createdAt: at, updatedAt: at, rev: 1, deletedAt: null, expiresAt: null, musicId: null, musicUrl: null } as Entry;
}
const wordsOf = (e: Entry) => (e.blocks[0]!.type === 'text' ? ((e.blocks[0] as { doc: { content?: { content?: { text: string }[] }[] } }).doc.content?.[0]?.content?.[0]?.text.split(' ').filter(Boolean).length ?? 0) : 0);
const library = (entries: Entry[]): LibraryGallery[] => shelveLibrary(entries, wordsOf);
const days = (year: number, count: number, words = 50) => Array.from({ length: count }, (_, i) => entry(`${year}-${String(1 + Math.floor((i * 12) / count)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, words));
const booksIn = (room: LibraryRoom): Book[] => room.walls.flat(2).flatMap((t) => (t.kind === 'book' ? [t.book] : []));

/** Looks along a spot's yaw and pitch: the point `d` metres ahead. */
const ahead = (s: { x: number; z: number; yaw: number; pitch: number }, d: number) => ({ x: s.x - Math.sin(s.yaw) * Math.cos(s.pitch) * d, y: EYE + Math.sin(s.pitch) * d, z: s.z - Math.cos(s.yaw) * Math.cos(s.pitch) * d });

describe('the Library you walk through (D113)', () => {
  it('gives each year its own gallery, filled shelf by shelf in order, a bookend before each month', () => {
    const rooms = libraryRooms(library([...days(2025, 30), ...days(2026, 40)]));
    expect(rooms.map((r) => r.label)).toEqual(['Gallery 2025', 'Gallery 2026']);
    expect(rooms.map((r) => r.books)).toEqual([30, 40]);
    const order = booksIn(rooms[1]!).map((b) => b.date);
    expect(order).toEqual([...order].sort());
    expect(rooms[1]!.first?.startsWith('2026-01')).toBe(true);
    expect(rooms[1]!.last?.startsWith('2026-12')).toBe(true);
    // Twelve months, twelve bookends; every shelf within its length.
    expect(rooms[1]!.walls.flat(2).filter((t) => t.kind === 'divider')).toHaveLength(12);
    for (const room of rooms)
      for (const wall of room.walls)
        for (const shelf of wall) {
          for (const t of shelf) expect(t.x + t.width).toBeLessThanOrEqual(SHELF_ROOM + 1e-9);
          for (let i = 1; i < shelf.length; i++) expect(shelf[i]!.x).toBeCloseTo(shelf[i - 1]!.x + shelf[i - 1]!.width, 9);
          // A bookend never ends a shelf.
          if (shelf.length) expect(shelf.at(-1)!.kind).toBe('book');
        }
    expect(rooms[0]!.walls[0]![0]![0]).toMatchObject({ kind: 'divider', x: 0, width: BOOKEND });
  });

  it('opens another gallery when a year fills one, and empty ones for the years to come, for good', () => {
    const rooms = libraryRooms(library(days(2026, 2500, 4000)));
    expect(rooms.length).toBeGreaterThan(1);
    expect(rooms[1]!.label).toBe('Gallery 2026 · II');
    expect(rooms.reduce((n, r) => n + r.books, 0)).toBe(2500);
    // A full gallery: every shelf of every wall has books.
    expect(rooms[0]!.walls.every((w) => w.every((s) => s.length > 0))).toBe(true);
    const next = roomAt(rooms, rooms.length, 2026);
    expect(next).toMatchObject({ label: 'Gallery 2027', books: 0 });
    expect(roomAt(rooms, rooms.length + 99, 2026).label).toBe('Gallery 2126');
    expect(roomAt([], 0, 2026).label).toBe('Gallery 2026');
    expect(roomAt([], 3, 2026).label).toBe('Gallery 2029');
  });

  it('files every entry in a manila folder on the storage room racks, a guide card before each month', () => {
    const racks = archiveRacks(library([...days(2025, 20, 10), ...days(2026, 600, 3000)]));
    expect(racks.reduce((n, r) => n + r.folders, 0)).toBe(620);
    expect(racks.length).toBeGreaterThan(1);
    for (const r of racks) {
      expect(r.shelves).toHaveLength(RACK_SHELVES.length);
      for (const s of r.shelves) for (const t of s) expect(t.x + t.width).toBeLessThanOrEqual(RACK_ROOM + 1e-9);
    }
    expect(racks.flatMap((r) => r.shelves.flat()).filter((t) => t.kind === 'guide')).toHaveLength(24);
    expect(folderThickness(0)).toBeCloseTo(0.01);
    expect(folderThickness(4000)).toBeCloseTo(0.04);
    expect(folderThickness(9000)).toBeCloseTo(0.04);
    expect(archiveRacks([])).toEqual([]);
  });

  it('lets you walk in the galleries, through their doorways and down to the storage room, never into a bookcase or a wall', () => {
    const start = entrance('library');
    expect(canStand(start.x, start.z)).toBe(true);
    expect(canStand(0, 0)).toBe(true);
    // A bookcase: the front-left one is up against the wall.
    const side = gallerySide(0, WALL_SIDES[0]);
    expect(canStand(side.x, side.z)).toBe(false);
    expect(canStand(side.x - side.nx * 0.2, side.z - side.nz * 0.2)).toBe(false);
    expect(canStand(side.x - side.nx * 1, side.z - side.nz * 1)).toBe(true);
    // Doorways, not the wall beside them.
    const door = ROOM_APOTHEM;
    expect(canStand(0, door)).toBe(true);
    expect(canStand(DOOR_WIDTH / 2 + 0.2, door)).toBe(false);
    expect(canStand(0, 1000 * ROOM_STEP + door)).toBe(true);
    // Behind the first gallery: the corridor, then the hall, and its racks.
    expect(canStand(0, -ROOM_APOTHEM - 1)).toBe(true);
    expect(canStand(2, -ROOM_APOTHEM - 1)).toBe(false);
    expect(canStand(3, HALL_START - 5)).toBe(true);
    expect(canStand(HALL_WIDTH / 2 - 0.2, HALL_START - 5)).toBe(false);
    expect(canStand(-3, HALL_START - 100_000)).toBe(true);
    expect(canStand(Number.NaN, 0)).toBe(false);
  });

  it('walks you straight from gallery to gallery, and slides you along a wall rather than through it', () => {
    let at = entrance('library');
    let p = { x: at.x, z: at.z };
    for (let i = 0; i < 400; i++) p = step(p.x, p.z, 0, 0.05);
    expect(placeAt(p.z)).toEqual({ world: 'library', room: 2 });
    // Into the wall beside a doorway: stopped, but still moving along it.
    p = { x: 1.5, z: ROOM_APOTHEM - 1.2 };
    const moved = step(p.x, p.z, 0.05, 0.5);
    expect(canStand(moved.x, moved.z)).toBe(true);
    expect(moved.z).toBeLessThan(ROOM_APOTHEM);
    // Back through the first gallery's back door, down the corridor, into the storage room.
    at = entrance('library');
    p = { x: 0, z: at.z };
    for (let i = 0; i < 400; i++) p = step(p.x, p.z, 0, -0.05);
    expect(placeAt(p.z).world).toBe('storage');
    expect(p.z).toBeLessThan(HALL_START - 5);
  });

  it('stands you in front of a book or a folder, looking right at it', () => {
    const rooms = libraryRooms(library(days(2026, 1700)));
    for (const [wall, shelf, index] of [
      [0, 0, 0],
      [1, 2, 10],
      [3, 3, -1],
    ] as const) {
      const row = rooms[0]!.walls[wall]![shelf]!;
      const thing = row.at(index)!;
      const spot = spotForBook(0, wall, shelf, thing);
      expect(canStand(spot.x, spot.z)).toBe(true);
      // Looking along the spot's direction, you meet the book's spine.
      const side = gallerySide(0, WALL_SIDES[wall]!);
      const along = (CASE_WIDTH - SHELF_ROOM) / 2 + thing.x + thing.width / 2 - CASE_WIDTH / 2;
      const book = { x: side.x + side.tx * along, y: SHELF_HEIGHTS[shelf]! + 0.15, z: side.z + side.tz * along };
      const d = Math.hypot(book.x - spot.x, book.z - spot.z) / Math.cos(spot.pitch);
      const seen = ahead(spot, d);
      expect(Math.hypot(seen.x - book.x, seen.y - book.y, seen.z - book.z)).toBeLessThan(0.01);
      if (thing.kind === 'book') expect(bookMetres(thing.book).thickness).toBeGreaterThanOrEqual(0.04);
    }
    const racks = archiveRacks(library(days(2026, 2700)));
    for (const index of [0, 1, 2]) {
      const thing = racks[index]!.shelves[2]![3]!;
      const spot = spotForFolder(index, 2, thing);
      expect(canStand(spot.x, spot.z)).toBe(true);
      expect(placeAt(spot.z).world).toBe('storage');
      // Facing the rack's wall.
      expect(Math.sign(-Math.sin(spot.yaw))).toBe(rackFront(index).nx);
    }
  });
});
