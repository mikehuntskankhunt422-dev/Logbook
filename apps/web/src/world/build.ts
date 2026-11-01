import * as THREE from 'three';
import {
  BOOK_DEPTH,
  CASE_HEIGHT,
  CASE_WIDTH,
  CORRIDOR,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  FOLDER_DEPTH,
  FOLDER_HEIGHT,
  HALL_ENTRY,
  HALL_HEIGHT,
  HALL_START,
  HALL_WIDTH,
  RACK_DEPTH,
  RACK_HEIGHT,
  RACK_LENGTH,
  RACK_ROOM,
  RACK_SHELVES,
  ROOM_APOTHEM,
  ROOM_SIDE,
  SHELF_DEPTH,
  SHELF_HEIGHTS,
  SHELF_ROOM,
  WALL_HEIGHT,
  WALL_SIDES,
  bookMetres,
  gallerySide,
  rackFront,
  type Book,
  type LibraryRoom,
  type RackThing,
  type ShelfThing,
} from '@logbook/core';
import { BOOK_WALL, FOLDER_RACK, atlasRect } from './atlas.ts';

/**
 * The 3D Library's shapes (D113), built from the plain layout in @logbook/core: boxes batched into
 * one geometry per material, so a gallery is a handful of draw calls however many books it holds.
 */

type V = readonly [number, number, number];
type Rect = { u0: number; u1: number; v0: number; v1: number };
const NONE: Rect = { u0: 0, u1: 0, v0: 0, v1: 0 };
const UP: V = [0, 1, 0];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const neg = (a: V): V => [-a[0], -a[1], -a[2]];
/** (up × t) · n: positive when facing along n, t is to your right, as every box needs. */
const rightHanded = (t: V, n: V) => t[2] * n[0] - t[0] * n[2] > 0;

/** Boxes, batched: 24 corners and 12 triangles each, in the order added (so a triangle says its box). */
export class Boxes {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  count = 0;

  /**
   * A box centred at `c`, `w` wide along `t`, `h` tall, `d` deep along `n` (into the wall). Its
   * front (facing -n, what you see) shows `front` of the texture; every other side shows `rest`.
   */
  add(c: V, t: V, n: V, w: number, h: number, d: number, front: Rect = NONE, rest: Rect = NONE): void {
    // A box is the same box either way round; turned so every face winds (and is lit) outwards.
    if (!rightHanded(t, n)) t = neg(t);
    const face = (normal: V, a: V, b: V, ha: number, hb: number, half: number, r: Rect) => {
      const base = this.pos.length / 3;
      const centre = add(c, normal, half);
      const corners: [number, number, number, number][] = [
        [-1, -1, r.u0, r.v0],
        [1, -1, r.u1, r.v0],
        [1, 1, r.u1, r.v1],
        [-1, 1, r.u0, r.v1],
      ];
      for (const [sa, sb, u, v] of corners) {
        const p = add(add(centre, a, sa * ha), b, sb * hb);
        this.pos.push(...p);
        this.nor.push(...normal);
        this.uv.push(u, v);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // (a × b = normal for each, so every face winds outwards.)
    face(neg(n), t, UP, w / 2, h / 2, d / 2, front);
    face(n, neg(t), UP, w / 2, h / 2, d / 2, rest);
    face(t, n, UP, d / 2, h / 2, w / 2, rest);
    face(neg(t), neg(n), UP, d / 2, h / 2, w / 2, rest);
    face(UP, t, n, w / 2, d / 2, h / 2, rest);
    face(neg(UP), t, neg(n), w / 2, d / 2, h / 2, rest);
    this.count++;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** A hexagon lying flat at height `y`, corners on a circle of `r`, facing up (a floor) or down (a ceiling). */
function hexagon(r: number, y: number, facing: 'up' | 'down'): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    if (i === 0) shape.moveTo(r * Math.cos(a), r * Math.sin(a));
    else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  const g = new THREE.ShapeGeometry(shape);
  // A shape faces +z: turned to face +y or -y.
  g.rotateX(facing === 'up' ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

export interface GalleryShell {
  walls: THREE.BufferGeometry;
  cases: THREE.BufferGeometry;
  shelves: THREE.BufferGeometry;
  floor: THREE.BufferGeometry;
  rug: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  chain: THREE.BufferGeometry;
}

/** Everything every gallery has, the same in each, centred on the origin. */
export function galleryShell(): GalleryShell {
  const walls = new Boxes();
  const cases = new Boxes();
  const shelves = new Boxes();
  const thick = 0.2;
  for (let side = 0; side < 6; side++) {
    const s = gallerySide(0, side, -thick / 2);
    const n: V = [s.nx, 0, s.nz];
    const t: V = [s.tx, 0, s.tz];
    const mid: V = [s.x, 0, s.z];
    if (side === 1 || side === 4) {
      // A doorway: wall either side, and above.
      const part = (ROOM_SIDE - DOOR_WIDTH) / 2;
      for (const k of [-1, 1]) {
        const at = add(mid, t, k * (DOOR_WIDTH / 2 + part / 2));
        walls.add([at[0], WALL_HEIGHT / 2, at[2]], t, n, part + 0.05, WALL_HEIGHT, thick);
      }
      walls.add([mid[0], DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, mid[2]], t, n, DOOR_WIDTH, WALL_HEIGHT - DOOR_HEIGHT, thick);
      continue;
    }
    walls.add([mid[0], WALL_HEIGHT / 2, mid[2]], t, n, ROOM_SIDE + 0.05, WALL_HEIGHT, thick);
  }
  for (const side of WALL_SIDES) {
    const s = gallerySide(0, side);
    const n: V = [s.nx, 0, s.nz];
    const t: V = [s.tx, 0, s.tz];
    const back: V = add([s.x, 0, s.z], n, SHELF_DEPTH);
    const front: V = [s.x, 0, s.z];
    // Back board, sides, top, plinth, and a shelf under each row of books.
    cases.add([back[0] - n[0] * 0.01, CASE_HEIGHT / 2, back[2] - n[2] * 0.01], t, n, CASE_WIDTH, CASE_HEIGHT, 0.02);
    for (const k of [-1, 1]) {
      const at = add(add(front, n, SHELF_DEPTH / 2), t, k * (CASE_WIDTH / 2 - 0.02));
      cases.add([at[0], CASE_HEIGHT / 2, at[2]], t, n, 0.04, CASE_HEIGHT, SHELF_DEPTH);
    }
    const mid = add(front, n, SHELF_DEPTH / 2);
    cases.add([mid[0], CASE_HEIGHT - 0.02, mid[2]], t, n, CASE_WIDTH, 0.04, SHELF_DEPTH + 0.04);
    for (const y of SHELF_HEIGHTS) shelves.add([mid[0], y - 0.012, mid[2]], t, n, CASE_WIDTH - 0.06, 0.024, SHELF_DEPTH);
  }
  // A lantern on a chain over the middle of the room.
  const lamp = new THREE.SphereGeometry(0.2, 18, 12);
  lamp.translate(0, WALL_HEIGHT - 0.75, 0);
  const chain = new Boxes();
  chain.add([0, WALL_HEIGHT - 0.3, 0], [1, 0, 0], [0, 0, 1], 0.02, 0.6, 0.02);
  return {
    walls: walls.geometry(),
    cases: cases.geometry(),
    shelves: shelves.geometry(),
    floor: hexagon(ROOM_SIDE + 0.2, 0, 'up'),
    rug: hexagon(ROOM_APOTHEM - 1.2, 0.005, 'up'),
    ceiling: hexagon(ROOM_SIDE + 0.2, WALL_HEIGHT, 'down'),
    lamp,
    chain: chain.geometry(),
  };
}

/** What a picked triangle was: a book (or folder), or nothing (a bookend, a guide card). */
export interface Shelved {
  geometry: THREE.BufferGeometry;
  items: (Book | null)[];
  /** The wall's normal, for pulling a book out towards you. */
  n: V;
}

/** The books of one wall of gallery `room` (its centre at the origin). */
export function bookWall(room: LibraryRoom, wall: number): Shelved | null {
  const things = room.walls[wall]!;
  if (!things.some((row) => row.length)) return null;
  const s = gallerySide(0, WALL_SIDES[wall]!);
  const n: V = [s.nx, 0, s.nz];
  const t: V = [s.tx, 0, s.tz];
  const left = (CASE_WIDTH - SHELF_ROOM) / 2 - CASE_WIDTH / 2;
  const boxes = new Boxes();
  const items: (Book | null)[] = [];
  things.forEach((row: ShelfThing[], r) => {
    for (const thing of row) {
      const h = thing.kind === 'book' ? bookMetres(thing.book).height : 0.24;
      const d = thing.kind === 'book' ? BOOK_DEPTH : 0.2;
      const along = left + thing.x + thing.width / 2;
      const c = add(add([s.x, SHELF_HEIGHTS[r]! + h / 2, s.z], t, along), n, 0.03 + d / 2);
      const front = atlasRect(BOOK_WALL, r, thing.x, thing.width, h);
      // The other sides: a sliver of the spine's own colour (just under its head band).
      const rest = { u0: front.u0 + (front.u1 - front.u0) * 0.2, u1: front.u0 + (front.u1 - front.u0) * 0.3, v0: front.v1 - (front.v1 - front.v0) * 0.12, v1: front.v1 - (front.v1 - front.v0) * 0.1 };
      boxes.add(c, t, n, thing.width * 0.98, h, d, front, rest);
      items.push(thing.kind === 'book' ? thing.book : null);
    }
  });
  return { geometry: boxes.geometry(), items, n };
}

// ── the storage room ─────────────────────────────────────────────────────────────────────────────

/** The middle (along the hall) of rack pair `pair`. */
export const pairZ = (pair: number) => HALL_START - HALL_ENTRY - pair * RACK_LENGTH - RACK_LENGTH / 2;

export interface AisleShell {
  floor: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  racks: THREE.BufferGeometry;
  light: THREE.BufferGeometry;
}

/** One length of the hall with a rack either side, the same for every pair, centred on z = 0. */
export function aisleShell(): AisleShell {
  const floor = new Boxes();
  floor.add([0, -0.05, 0], [1, 0, 0], [0, 0, 1], HALL_WIDTH, 0.1, RACK_LENGTH + 0.01);
  const ceiling = new Boxes();
  ceiling.add([0, HALL_HEIGHT + 0.05, 0], [1, 0, 0], [0, 0, 1], HALL_WIDTH, 0.1, RACK_LENGTH + 0.01);
  const walls = new Boxes();
  for (const k of [-1, 1]) walls.add([k * (HALL_WIDTH / 2 + 0.1), HALL_HEIGHT / 2, 0], [0, 0, 1], [k, 0, 0], RACK_LENGTH + 0.01, HALL_HEIGHT, 0.2);
  const racks = new Boxes();
  for (const index of [0, 1]) {
    const f = rackFront(index);
    const n: V = [f.nx, 0, 0];
    const t: V = [0, 0, f.tz];
    const mid: V = [f.x + f.nx * (RACK_DEPTH / 2), 0, 0];
    for (const k of [-1, 1]) racks.add([mid[0], RACK_HEIGHT / 2, k * (RACK_LENGTH / 2 - 0.03)], t, n, 0.05, RACK_HEIGHT, RACK_DEPTH);
    racks.add([mid[0] + f.nx * (RACK_DEPTH / 2 - 0.01), RACK_HEIGHT / 2, 0], t, n, RACK_LENGTH - 0.06, RACK_HEIGHT, 0.015);
    for (const y of RACK_SHELVES) racks.add([mid[0], y - 0.01, 0], t, n, RACK_LENGTH - 0.06, 0.02, RACK_DEPTH);
    racks.add([mid[0], RACK_HEIGHT, 0], t, n, RACK_LENGTH, 0.03, RACK_DEPTH);
  }
  const light = new Boxes();
  light.add([0, HALL_HEIGHT - 0.06, 0], [0, 0, 1], [1, 0, 0], RACK_LENGTH * 0.7, 0.05, 0.18);
  return { floor: floor.geometry(), ceiling: ceiling.geometry(), walls: walls.geometry(), racks: racks.geometry(), light: light.geometry() };
}

/** The folders on rack `index` (0 or 1 within its pair), the pair centred on z = 0. */
export function folderRack(shelves: RackThing[][], index: number): Shelved | null {
  if (!shelves.some((row) => row.length)) return null;
  const f = rackFront(index % 2);
  const n: V = [f.nx, 0, 0];
  const t: V = [0, 0, f.tz];
  const left = (RACK_LENGTH - RACK_ROOM) / 2 - RACK_LENGTH / 2;
  const boxes = new Boxes();
  const items: (Book | null)[] = [];
  shelves.forEach((row, r) => {
    for (const thing of row) {
      const h = thing.kind === 'folder' ? FOLDER_HEIGHT : 0.34;
      const along = left + thing.x + thing.width / 2;
      const c = add(add([f.x, RACK_SHELVES[r]! + h / 2, 0], t, along), n, 0.02 + FOLDER_DEPTH / 2);
      const front = atlasRect(FOLDER_RACK, r, thing.x, thing.width, h);
      const rest = { u0: front.u0, u1: front.u0 + (front.u1 - front.u0) * 0.08, v0: front.v0 + (front.v1 - front.v0) * 0.4, v1: front.v0 + (front.v1 - front.v0) * 0.42 };
      boxes.add(c, t, n, thing.width * 0.96, h, FOLDER_DEPTH, front, rest);
      items.push(thing.kind === 'folder' ? thing.book : null);
    }
  });
  return { geometry: boxes.geometry(), items, n };
}

/** The corridor from the first gallery's back door to the storage room, and the hall inside its door. */
export function corridorShell(): { walls: THREE.BufferGeometry; floor: THREE.BufferGeometry; hall: THREE.BufferGeometry } {
  const zMid = -ROOM_APOTHEM - CORRIDOR / 2;
  const walls = new Boxes();
  for (const k of [-1, 1]) walls.add([k * (DOOR_WIDTH / 2 + 0.1), DOOR_HEIGHT / 2, zMid], [0, 0, 1], [k, 0, 0], CORRIDOR + 0.4, DOOR_HEIGHT, 0.2);
  walls.add([0, DOOR_HEIGHT + 0.1, zMid], [1, 0, 0], [0, 0, 1], DOOR_WIDTH + 0.4, 0.2, CORRIDOR + 0.4);
  const floor = new Boxes();
  floor.add([0, -0.05, zMid], [1, 0, 0], [0, 0, 1], DOOR_WIDTH + 0.4, 0.1, CORRIDOR + 0.6);
  // The hall's front wall with its door, and the bare floor and ceiling before the first racks.
  const hall = new Boxes();
  const part = (HALL_WIDTH - DOOR_WIDTH) / 2;
  for (const k of [-1, 1]) hall.add([k * (DOOR_WIDTH / 2 + part / 2), HALL_HEIGHT / 2, HALL_START + 0.1], [1, 0, 0], [0, 0, -1], part, HALL_HEIGHT, 0.2);
  hall.add([0, DOOR_HEIGHT + (HALL_HEIGHT - DOOR_HEIGHT) / 2, HALL_START + 0.1], [1, 0, 0], [0, 0, -1], DOOR_WIDTH, HALL_HEIGHT - DOOR_HEIGHT, 0.2);
  const z = HALL_START - HALL_ENTRY / 2;
  hall.add([0, -0.05, z], [1, 0, 0], [0, 0, 1], HALL_WIDTH, 0.1, HALL_ENTRY + 0.01);
  hall.add([0, HALL_HEIGHT + 0.05, z], [1, 0, 0], [0, 0, 1], HALL_WIDTH, 0.1, HALL_ENTRY + 0.01);
  for (const k of [-1, 1]) hall.add([k * (HALL_WIDTH / 2 + 0.1), HALL_HEIGHT / 2, z], [0, 0, 1], [k, 0, 0], HALL_ENTRY + 0.01, HALL_HEIGHT, 0.2);
  return { walls: walls.geometry(), floor: floor.geometry(), hall: hall.geometry() };
}
