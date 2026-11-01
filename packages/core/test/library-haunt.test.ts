import { describe, expect, it } from 'vitest';
import { HALL_START, ROOM_STEP, canStand, entrance } from '../src/library-world.ts';
import { HAUNT, QUIET, haunted, hauntStep, sees, type Haunt, type HauntEvent, type HorrorLevel, type Watcher } from '../src/library-haunt.ts';
import { CAST, CAST_RADIUS, canStandAmong, libraryFacts, spotForCast, stepAmong } from '../src/library-cast.ts';
import type { LibraryGallery } from '../src/library.ts';

// A library with books in its first two galleries; the storage room's racks full to the third pair.
const ROOMS = 2;
const RACKS = 5;
const zone = (x: number, z: number) => haunted(z, ROOMS, RACKS);
const WIDE = Math.PI / 3;
/** Looking further in (+z, yaw π), or back the way you came (yaw 0). */
const at = (z: number, yaw = Math.PI, x = 0): Watcher => ({ x, z, yaw, half: WIDE });

/** Runs it for `seconds`, in 50 ms moments, gathering what happened. */
function run(h: Haunt, level: HorrorLevel, me: Watcher, seconds: number) {
  const events: HauntEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const out = hauntStep(h, level, me, 0.05, zone);
    h = out.haunt;
    events.push(...out.events);
  }
  return { h, events };
}

describe('where The Unwritten walks (D116)', () => {
  it('only past the first empty gallery after your books, and two aisles past your last folder', () => {
    expect(haunted(0, ROOMS, RACKS)).toBe(false);
    expect(haunted(2 * ROOM_STEP, ROOMS, RACKS)).toBe(false);
    expect(haunted(3 * ROOM_STEP, ROOMS, RACKS)).toBe(true);
    expect(haunted(40 * ROOM_STEP, ROOMS, RACKS)).toBe(true);
    // No books at all: the first gallery stays safe.
    expect(haunted(0, 0, 0)).toBe(false);
    expect(haunted(ROOM_STEP, 0, 0)).toBe(true);
    // The corridor and the storage room's first aisles are safe; racks 0–4 fill aisles 1–3.
    expect(haunted(HALL_START + 1, ROOMS, RACKS)).toBe(false);
    expect(haunted(HALL_START - 1.5 - 2.4 * 4.5, ROOMS, RACKS)).toBe(false);
    expect(haunted(HALL_START - 1.5 - 2.4 * 5.5, ROOMS, RACKS)).toBe(true);
  });

  it('sees what’s in front, inside the view and the haze', () => {
    expect(sees(at(0), 0, 10)).toBe(true);
    expect(sees(at(0), 0, -10)).toBe(false);
    expect(sees(at(0), 0, 30)).toBe(false);
    expect(sees(at(0), 8, 8)).toBe(true);
    expect(sees(at(0), 10, 2)).toBe(false);
  });
});

describe('The Unwritten (D116)', () => {
  const deep = 4 * ROOM_STEP;

  it('nothing at all while horror is off, or where your writing is', () => {
    expect(run(QUIET, 'off', at(deep), 20).events).toEqual([]);
    expect(run(QUIET, 'intense', at(ROOM_STEP), 20).events).toEqual([]);
    // Switched off while it's out: gone at once, without a word.
    const out = run(QUIET, 'intense', at(deep), 4).h;
    expect(out.here).toBe(true);
    expect(hauntStep(out, 'off', at(deep), 0.05, zone)).toEqual({ haunt: QUIET, events: [] });
  });

  it('appears further in after a few seconds where it walks, and stays still while it’s watched', () => {
    let { h, events } = run(QUIET, 'intense', at(deep), HAUNT.appearAfter - 0.2);
    expect(events).toEqual([]);
    ({ h, events } = run(h, 'intense', at(deep), 0.4));
    expect(events).toEqual(['appear']);
    expect(h).toMatchObject({ here: true, x: 0, z: deep + HAUNT.distance });
    expect(zone(h.x, h.z) && canStand(h.x, h.z)).toBe(true);
    // Watched for a long time: it hasn't moved.
    const still = run(h, 'intense', at(deep), 30);
    expect(still.events).toEqual([]);
    expect(still.h.z).toBe(h.z);
  });

  it('comes on while your back is turned, says so when it’s close, and on Intense it has you', () => {
    const h = run(QUIET, 'intense', at(deep), HAUNT.appearAfter + 0.1).h;
    const away = at(deep, 0);
    const { h: after, events } = run(h, 'intense', away, (HAUNT.distance - HAUNT.reach) / HAUNT.speed.intense + 0.5);
    expect(events).toEqual(['near', 'scare']);
    expect(after).toMatchObject({ here: false, cooldown: expect.any(Number) });
    expect(after.cooldown).toBeGreaterThan(HAUNT.rest.scare - 1);
    // Resting: not again straight away.
    expect(run(after, 'intense', at(deep), 10).events).toEqual([]);
  });

  it('on a day you’ve written, fresh ink slows him (D118)', () => {
    const h = run(QUIET, 'intense', at(deep), HAUNT.appearAfter + 0.1).h;
    const away = at(deep, 0);
    const time = (HAUNT.distance - HAUNT.reach) / HAUNT.speed.intense + 0.5;
    expect(run(h, 'intense', away, time).events).toContain('scare');
    let inked = h;
    const events: HauntEvent[] = [];
    for (let t = 0; t < time; t += 0.05) {
      const out = hauntStep(inked, 'intense', away, 0.05, zone, true);
      inked = out.haunt;
      events.push(...out.events);
    }
    expect(events).not.toContain('scare');
    expect(Math.hypot(inked.x - away.x, inked.z - away.z)).toBeGreaterThan(HAUNT.reach);
  });

  it('on Unsettling it only passes through you, more slowly', () => {
    const h = run(QUIET, 'unsettling', at(deep), HAUNT.appearAfter + 0.1).h;
    const slow = run(h, 'unsettling', at(deep, 0), (HAUNT.distance - HAUNT.reach) / HAUNT.speed.intense + 0.5);
    expect(slow.events).not.toContain('pass');
    const { events } = run(slow.h, 'unsettling', at(deep, 0), 10);
    expect(events.at(-1)).toBe('pass');
    expect(events).not.toContain('scare');
  });

  it('walked up to while watched, it’s gone', () => {
    let { h } = run(QUIET, 'intense', at(deep), HAUNT.appearAfter + 0.1);
    const out = hauntStep(h, 'intense', at(h.z - HAUNT.vanishAt + 0.1), 0.05, zone);
    expect(out.events).toEqual(['vanish']);
    expect(out.haunt.here).toBe(false);
    h = out.haunt;
    expect(h.cooldown).toBeGreaterThan(HAUNT.rest.vanish - 1);
  });

  it('never follows you to where your writing is: it stops at the edge, then gives up', () => {
    const h = run(QUIET, 'intense', at(deep), HAUNT.appearAfter + 0.1).h;
    // Back among your books, facing away from it.
    const safe = at(2 * ROOM_STEP, 0);
    const { h: after, events } = run(h, 'intense', safe, HAUNT.leaveAfter + 0.5);
    expect(events).toEqual(['leave']);
    expect(after.here).toBe(false);
    // While it waited it stayed where it walks.
    let w = run(QUIET, 'intense', at(deep), HAUNT.appearAfter + 0.1).h;
    for (let i = 0; i < 70; i++) {
      w = hauntStep(w, 'intense', safe, 0.05, zone).haunt;
      if (w.here) expect(zone(w.x, w.z)).toBe(true);
    }
  });

  it('walks the storage room too, coming down it towards you', () => {
    const far = HALL_START - 1.5 - 2.4 * 12;
    const h = run(QUIET, 'intense', at(far, 0), HAUNT.appearAfter + 0.1).h;
    expect(h.here).toBe(true);
    expect(h.z).toBeCloseTo(far - HAUNT.distance);
    expect(run(h, 'intense', at(far, Math.PI), 15).events).toContain('scare');
  });
});

describe('the cast (D116)', () => {
  it('stand where there’s floor, clear of the way down the middle, and can’t be walked through', () => {
    for (const c of CAST) {
      expect(canStand(c.x, c.z), c.id).toBe(true);
      expect(Math.abs(c.x)).toBeGreaterThan(CAST_RADIUS + 0.5);
      expect(canStandAmong(c.x, c.z)).toBe(false);
      expect(canStandAmong(c.x + CAST_RADIUS + 0.05, c.z)).toBe(true);
      // Walking at them, you stop short.
      let p = { x: c.x + 2, z: c.z };
      for (let i = 0; i < 100; i++) p = stepAmong(p.x, p.z, -0.05, 0);
      expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThanOrEqual(CAST_RADIUS);
    }
    // The way in to the Library and the storage room is clear.
    const lib = entrance('library');
    for (let z = lib.z; z < 3 * ROOM_STEP; z += 0.1) expect(canStandAmong(0, z)).toBe(true);
  });

  it('can be talked to from in front of them, facing them', () => {
    for (const c of CAST) {
      const s = spotForCast(c.id);
      expect(canStandAmong(s.x, s.z), c.id).toBe(true);
      expect(sees({ x: s.x, z: s.z, yaw: s.yaw, half: 0.05 }, c.x, c.z)).toBe(true);
      expect(Math.hypot(s.x - c.x, s.z - c.z)).toBeCloseTo(1.5);
    }
  });
});

describe('what the cast know (D116)', () => {
  const book = (id: string, date: string, words: number, title = id) => ({ id, title, date, words, mood: null, thickness: 24, height: 96, tone: 0 });
  const galleries: LibraryGallery[] = [
    { year: '2025', books: 2, words: 330, months: [{ month: '2025-10', words: 330, books: [book('a', '2025-10-20', 30), book('b', '2025-10-30', 300, 'Long one')] }] },
    { year: '2026', books: 3, words: 90, months: [{ month: '2026-01', words: 10, books: [book('c', '2026-01-02', 10)] }, { month: '2026-10', words: 80, books: [book('d', '2026-10-01', 40), book('e', '2026-10-03', 40)] }] },
  ];

  it('counts, the first and newest, the longest, the busiest month, and a book from a year ago', () => {
    const f = libraryFacts(galleries, '2026-11-01', 7);
    expect(f).toMatchObject({ books: 5, words: 420, years: ['2025', '2026'], aisles: 4 });
    expect(f.first?.id).toBe('a');
    expect(f.newest?.id).toBe('e');
    expect(f.longest?.title).toBe('Long one');
    expect(f.busiest).toEqual({ month: '2025-10', books: 2 });
    // 2025-11-01 a year ago: the 30th of October is the closest within a fortnight.
    expect(f.yearAgo?.id).toBe('b');
    expect(libraryFacts(galleries, '2027-06-01').yearAgo).toBeNull();
  });

  it('an empty library: nothing to tell', () => {
    expect(libraryFacts([], '2026-11-01')).toEqual({ books: 0, words: 0, years: [], first: null, newest: null, longest: null, busiest: null, yearAgo: null, aisles: 0 });
  });
});
