import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { DOOR_HEIGHT, DOOR_WIDTH, HALL_HEIGHT, HALL_START, HALL_WIDTH, ROOM_APOTHEM } from '@logbook/core';
import { aisleShell, corridorShell, galleryShell } from './build.ts';

// No two surfaces of the walking Library share a plane where they could fight over a pixel, and
// none meet edge to edge where a crack could open (D117).

/** A geometry's corners, and its extent. */
function corners(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  const range = (k: 0 | 1 | 2): [number, number] => [Math.min(...out.map((c) => c[k])), Math.max(...out.map((c) => c[k]))];
  return { out, x: range(0), y: range(1), z: range(2), faces: p.count / 4 };
}

describe('the storage room’s long surfaces (D117)', () => {
  const aisle = aisleShell();

  it('are only the sides you see: no ends to lie in a neighbour’s surface', () => {
    expect(corners(aisle.floor).faces).toBe(1);
    expect(corners(aisle.ceiling).faces).toBe(1);
    expect(corners(aisle.walls).faces).toBe(2);
  });

  it('overlap: the floor and ceiling run under and over the walls, the walls into them, each aisle into the next', () => {
    const floor = corners(aisle.floor);
    const ceiling = corners(aisle.ceiling);
    const walls = corners(aisle.walls);
    expect(floor.y).toEqual([0, 0]);
    expect(ceiling.y).toEqual([HALL_HEIGHT, HALL_HEIGHT]);
    expect(floor.x[1]).toBeGreaterThan(HALL_WIDTH / 2);
    expect(ceiling.x[1]).toBeGreaterThan(HALL_WIDTH / 2);
    expect(walls.y[0]).toBeLessThan(0);
    expect(walls.y[1]).toBeGreaterThan(HALL_HEIGHT);
    // The walls' faces stand at the hall's sides, looking in.
    expect(walls.out.every((c) => Math.abs(Math.abs(c[0]) - HALL_WIDTH / 2) < 1e-9)).toBe(true);
    expect(floor.z[1] - floor.z[0]).toBeGreaterThan(2.4);
  });
});

describe('the corridor and the hall’s door (D117)', () => {
  const corridor = corridorShell();

  it('the corridor’s boards end under the hall’s concrete, which reaches a little under them', () => {
    const boards = corners(corridor.floor);
    const concrete = corners(corridor.hallFloor);
    expect(boards.faces).toBe(1);
    expect(concrete.faces).toBe(1);
    expect(boards.z[0]).toBeCloseTo(HALL_START);
    expect(concrete.z[1]).toBeGreaterThan(HALL_START + 0.2);
    // And under the first gallery's boards at the other end.
    expect(boards.z[1]).toBeGreaterThan(-ROOM_APOTHEM);
  });

  it('its walls and ceiling never share a plane with either door’s frame', () => {
    const walls = corners(corridor.walls).out;
    const sides = walls.filter((c) => Math.abs(c[1] - (DOOR_HEIGHT + 0.02)) > 1e-6 || Math.abs(c[0]) > 1.05);
    // The side walls' faces: just outside the doors' jambs (0.9 m out), never on them.
    const xs = new Set(walls.filter((c) => c[1] < DOOR_HEIGHT).map((c) => Math.abs(c[0]).toFixed(3)));
    expect([...xs]).toEqual([(DOOR_WIDTH / 2 + 0.02).toFixed(3)]);
    // The ceiling: just above the lintels (at the doors' height), never level with them.
    const ceiling = walls.filter((c) => c[1] > DOOR_HEIGHT && Math.abs(c[0]) > 1.05).map((c) => c[1]);
    expect(ceiling.length).toBeGreaterThan(0);
    for (const y of ceiling) expect(y).toBeCloseTo(DOOR_HEIGHT + 0.02, 5);
    // Into the gallery's wall and the hall's, where they're hidden, rather than ending at them.
    const z = walls.map((c) => c[2]);
    expect(Math.max(...z)).toBeGreaterThan(-ROOM_APOTHEM - 0.2);
    expect(Math.max(...z)).toBeLessThan(-ROOM_APOTHEM);
    expect(Math.min(...z)).toBeLessThan(HALL_START + 0.2);
    expect(Math.min(...z)).toBeGreaterThan(HALL_START);
    expect(sides.length).toBeGreaterThan(0);
  });
});

describe('a gallery (D117)', () => {
  const g = galleryShell();

  it('the rug lies a centimetre above the floor', () => {
    for (const y of corners(g.rug).y) expect(y).toBeCloseTo(0.01, 5);
    for (const y of corners(g.floor).y) expect(y).toBeCloseTo(0, 5);
  });

  it('its walls reach a centimetre into the room, so back-to-back doorways overlap rather than meet', () => {
    // The doorway wall towards +z: from just inside the room's edge.
    const near = corners(g.walls)
      .out.filter((c) => Math.abs(c[0]) <= 1 && c[2] > 0)
      .map((c) => c[2]);
    expect(Math.min(...near)).toBeCloseTo(ROOM_APOTHEM - 0.01, 5);
    expect(Math.max(...near)).toBeCloseTo(ROOM_APOTHEM + 0.2, 5);
  });
});
