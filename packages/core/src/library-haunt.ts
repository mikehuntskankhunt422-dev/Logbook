import { HALL_ENTRY, HALL_START, placeAt, ROOM_APOTHEM, step } from './library-world.ts';

/**
 * Horror in the walking Library (D116), switched on by choice: The Unwritten, a tall figure in a
 * long coat with a blank page for a face, walks the galleries of years nobody has written yet and
 * the aisles past the last folder. It never comes where your writing is. It moves only while it
 * isn't seen; walk up to it and it's gone; turn your back on it long enough and it reaches you.
 * Plain numbers, so the rules can be tested without drawing anything.
 */

export type HorrorLevel = 'off' | 'unsettling' | 'intense';

export interface Haunt {
  /** Whether it's out, and where. */
  here: boolean;
  x: number;
  z: number;
  /** Seconds spent where it walks, before it shows itself. */
  waited: number;
  /** Seconds before it can come again. */
  cooldown: number;
  /** Seconds the watcher has been out of its reach while it's here. */
  outside: number;
  /** Whether "it's close" has been said this time. */
  warned: boolean;
}

export const QUIET: Haunt = { here: false, x: 0, z: 0, waited: 0, cooldown: 0, outside: 0, warned: false };

/** Whoever is walking: where, which way they look, and half their view's width (radians). */
export interface Watcher {
  x: number;
  z: number;
  yaw: number;
  half: number;
}

export type HauntEvent =
  /** It's standing further in. */
  | 'appear'
  /** Closer than it was: footsteps behind you. */
  | 'near'
  /** Walked up to, it's gone. */
  | 'vanish'
  /** You left where it walks; it stays behind. */
  | 'leave'
  /** It reached you, on Unsettling: it passes through you, cold, and is gone. */
  | 'pass'
  /** It reached you, on Intense. */
  | 'scare';

export const HAUNT = {
  /** Seconds where it walks before it shows itself. */
  appearAfter: 3,
  /** How far further in it stands when it does. */
  distance: 13,
  /** As far as it can be seen through the haze. */
  sight: 22,
  /** Walk this close while looking at it and it's gone. */
  vanishAt: 3.2,
  /** This close and it has you. */
  reach: 1,
  /** "It's close." */
  near: 6,
  /** Metres a second while unseen. */
  speed: { unsettling: 1.1, intense: 1.6 } as Record<Exclude<HorrorLevel, 'off'>, number>,
  /** Seconds out of its reach before it gives up. */
  leaveAfter: 4,
  /** Seconds before it comes again, after each way it goes. */
  rest: { vanish: 15, leave: 6, pass: 20, scare: 30 },
} as const;

/**
 * Where it walks: galleries past the first empty one after your books (so the year after your
 * newest book stays safe), and in the storage room, aisles from two past the last folder.
 */
export function haunted(z: number, rooms: number, racks: number): boolean {
  const place = placeAt(z);
  if (place.world === 'library') return place.room >= Math.max(1, rooms + 1);
  return z <= HALL_START - HALL_ENTRY && place.aisle >= Math.ceil(racks / 2) + 2;
}

/** Whether the watcher has it in view: inside their view's width, and not lost in the haze. */
export function sees(me: Watcher, x: number, z: number): boolean {
  const dx = x - me.x;
  const dz = z - me.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return true;
  if (dist > HAUNT.sight) return false;
  const along = (-Math.sin(me.yaw) * dx - Math.cos(me.yaw) * dz) / dist;
  return Math.acos(Math.max(-1, Math.min(1, along))) <= me.half;
}

const rest = (seconds: number): Haunt => ({ ...QUIET, cooldown: seconds });

/** A moment (`dt` seconds) of it: where it is next, and what happened. */
export function hauntStep(h: Haunt, level: HorrorLevel, me: Watcher, dt: number, zone: (x: number, z: number) => boolean): { haunt: Haunt; events: HauntEvent[] } {
  if (level === 'off') return { haunt: QUIET, events: [] };
  const s: Haunt = { ...h, cooldown: Math.max(0, h.cooldown - dt) };
  const inside = zone(me.x, me.z);
  if (!s.here) {
    s.waited = inside ? s.waited + dt : 0;
    if (!inside || s.waited < HAUNT.appearAfter || s.cooldown > 0) return { haunt: s, events: [] };
    // Further in: on into the years to come, or on down the storage room.
    const deeper = me.z > -ROOM_APOTHEM ? 1 : -1;
    return { haunt: { ...QUIET, here: true, x: 0, z: me.z + deeper * HAUNT.distance }, events: ['appear'] };
  }
  s.outside = inside ? 0 : s.outside + dt;
  if (s.outside >= HAUNT.leaveAfter) return { haunt: rest(HAUNT.rest.leave), events: ['leave'] };
  const dist = Math.hypot(me.x - s.x, me.z - s.z);
  if (sees(me, s.x, s.z)) return dist <= HAUNT.vanishAt ? { haunt: rest(HAUNT.rest.vanish), events: ['vanish'] } : { haunt: s, events: [] };
  // Unseen: it comes on, on the floor, and no further than where it walks.
  const by = Math.min(HAUNT.speed[level] * dt, dist);
  if (by > 0) {
    const steps = Math.max(1, Math.ceil(by / 0.08));
    for (let i = 0; i < steps; i++) {
      const next = step(s.x, s.z, ((me.x - s.x) / dist) * (by / steps), ((me.z - s.z) / dist) * (by / steps));
      if (!zone(next.x, next.z)) break;
      s.x = next.x;
      s.z = next.z;
    }
  }
  const now = Math.hypot(me.x - s.x, me.z - s.z);
  const events: HauntEvent[] = [];
  if (!s.warned && now <= HAUNT.near) {
    s.warned = true;
    events.push('near');
  }
  if (now <= HAUNT.reach) return level === 'intense' ? { haunt: rest(HAUNT.rest.scare), events: [...events, 'scare'] } : { haunt: rest(HAUNT.rest.pass), events: [...events, 'pass'] };
  return { haunt: s, events };
}
