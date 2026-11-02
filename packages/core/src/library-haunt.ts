import { canStand, HALL_ENTRY, HALL_START, placeAt, ROOM_APOTHEM, ROOM_STEP, step } from './library-world.ts';

/**
 * Horror in the walking Library (D116), switched on by choice: The Unwritten (Silas Quire, D118),
 * a tall figure in a long coat with a blank page for a face, walks the galleries of years nobody
 * has written yet and the aisles past the last folder. He never comes where your writing is. He
 * moves only while he isn't seen; walk up to him and he's gone; turn your back on him long enough
 * and he reaches you. Since D119 he's cleverer about it: he waits by doorways, comes round to
 * behind you out of the edge of your view, learns how you look back and how you get away, puts out
 * the lamps on anyone who stares too long, and grows bolder the longer you haven't written.
 * Plain numbers, so the rules can be tested without drawing anything.
 */

export type HorrorLevel = 'off' | 'unsettling' | 'intense';

export interface Haunt {
  /** Whether he's out, and where. */
  here: boolean;
  x: number;
  z: number;
  /** Seconds spent where he walks, before he shows himself. */
  waited: number;
  /** Seconds before he can come again. */
  cooldown: number;
  /** Seconds the watcher has been out of his reach while he's here. */
  outside: number;
  /** Whether "he's close" has been said this time. */
  warned: boolean;
  /** Seconds he's been watched without a break, and unwatched (D119). */
  watched: number;
  unseen: number;
  /** Seconds of darkness left: the lamps out, and in the dark he isn't seen (D119). */
  dark: number;
  /** Seen from where your writing is, standing past the edge of it: he only stands there (D119). */
  glimpse: boolean;
  /** Seconds spent near where he walks, looking that way, without going in (for a glimpse). */
  edge: number;
  /** Seconds before he can be glimpsed again (D120: once a visit, as good as). */
  glimpsed: number;
  /** What he's learnt this visit (D119): how often you've looked back at him, walked him away, and how often he's come. */
  glances: number;
  folded: number;
  came: number;
}

export const QUIET: Haunt = { here: false, x: 0, z: 0, waited: 0, cooldown: 0, outside: 0, warned: false, watched: 0, unseen: 0, dark: 0, glimpse: false, edge: 0, glimpsed: 0, glances: 0, folded: 0, came: 0 };

/** Whoever is walking: where, which way they look, and half their view's width (radians). */
export interface Watcher {
  x: number;
  z: number;
  yaw: number;
  half: number;
}

export type HauntEvent =
  /** He's standing further in. */
  | 'appear'
  /** He's standing between you and your writing (D119). */
  | 'behind'
  /** Seen from where your writing is, standing past its edge (D119). */
  | 'glimpse'
  /** Closer than he was: footsteps behind you. */
  | 'near'
  /** The lamps go out (D119); and come back. */
  | 'dark'
  | 'light'
  /** Turned round on, close (D119): face to face, for a moment, before he folds away. On Intense. */
  | 'face'
  /** Walked up to, he's gone. */
  | 'vanish'
  /** You left where he walks; he stays behind. */
  | 'leave'
  /** He reached you, on Unsettling: he passes through you, cold, and is gone. */
  | 'pass'
  /** He reached you, on Intense. */
  | 'scare';

export const HAUNT = {
  /** Seconds where he walks before he shows himself (sooner the longer you haven't written: D119). */
  appearAfter: 3,
  /** How far further in he stands when he does. */
  distance: 13,
  /** As far as he can be seen through the haze. */
  sight: 22,
  /** Walk this close while looking at him and he's gone. */
  vanishAt: 3.2,
  /** This close and he has you. */
  reach: 1,
  /** "He's close." */
  near: 6,
  /** Metres a second while unseen. */
  speed: { unsettling: 1.1, intense: 1.6 } as Record<Exclude<HorrorLevel, 'off'>, number>,
  /** On a day you've written, fresh ink slows him to this much of his pace (D118). */
  inked: 0.7,
  /** A week without writing makes him this much bolder: sooner, faster, darker (D119). */
  bold: { days: 7, sooner: 1.5, faster: 0.25, darker: 6 },
  /** Watched this long without a break, the lamps go out for a while, and in the dark he comes (D119). */
  darkAfter: 14,
  darkFor: 1.5,
  /** Looked back at, he waits this long a glance before he comes again, and then comes faster (D119). */
  waitPerGlance: 0.6,
  waitMost: 2.4,
  hurryPerGlance: 0.1,
  hurryMost: 0.4,
  /** Walked away twice, he comes the third time from behind: between you and your writing (D119). */
  cutOffAfter: 2,
  /** Turned round on this close, on Intense, he's face to face with you first (D119). */
  faceAt: 2.2,
  /**
   * Near where he walks, looking that way this long, he may be seen standing past its edge; as far
   * as that edge may be (D119); and not again for this long (D120: rare, or it's no longer a fright).
   */
  glimpseAfter: 20,
  glimpseWithin: 9,
  glimpseAgain: 600,
  /** Seconds out of his reach before he gives up. */
  leaveAfter: 4,
  /** Seconds before he comes again, after each way he goes. */
  rest: { vanish: 15, leave: 6, pass: 20, scare: 30, glimpse: 6 },
} as const;

/** What else he goes by (D118, D119): whether you've written today, and how many days it's been since you last did. */
export interface HauntOptions {
  inked?: boolean;
  idle?: number;
}

/**
 * Where he walks: galleries past the first empty one after your books (so the year after your
 * newest book stays safe), and in the storage room, aisles from two past the last folder.
 */
export function haunted(z: number, rooms: number, racks: number): boolean {
  const place = placeAt(z);
  if (place.world === 'library') return place.room >= Math.max(1, rooms + 1);
  return z <= HALL_START - HALL_ENTRY && place.aisle >= Math.ceil(racks / 2) + 2;
}

/** Whether the watcher has him in view: inside their view's width, and not lost in the haze. */
export function sees(me: Watcher, x: number, z: number): boolean {
  const dx = x - me.x;
  const dz = z - me.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return true;
  if (dist > HAUNT.sight) return false;
  const along = (-Math.sin(me.yaw) * dx - Math.cos(me.yaw) * dz) / dist;
  return Math.acos(Math.max(-1, Math.min(1, along))) <= me.half;
}

/** He rests, keeping what he's learnt. */
const rest = (h: Haunt, seconds: number): Haunt => ({ ...QUIET, cooldown: seconds, glimpsed: h.glimpsed, glances: h.glances, folded: h.folded, came: h.came });

/** Which way is further in from here: on into the years to come, or on down the storage room. */
const deeperFrom = (z: number) => (z > -ROOM_APOTHEM ? 1 : -1);

/**
 * Where he shows himself, about `distance` from `z` the way `dir` goes: in a gallery, just inside
 * a doorway, half behind its jamb, as if he'd been looking round it; in the storage room, by the
 * racks. Out in the open only where neither will do.
 */
export function lurk(z: number, dir: 1 | -1, side: 1 | -1, zone: (x: number, z: number) => boolean): { x: number; z: number } {
  const wanted = z + dir * HAUNT.distance;
  const options: { x: number; z: number }[] = [];
  if (wanted > -ROOM_APOTHEM) {
    // Inside gallery k, by the doorway you'd come in by.
    const inside = ROOM_APOTHEM - 0.85;
    const k = Math.round((wanted + dir * inside) / ROOM_STEP);
    options.push({ x: side * 1.0, z: k * ROOM_STEP - dir * inside });
  } else options.push({ x: side * 3.4, z: wanted });
  options.push({ x: 0, z: wanted });
  return options.find((o) => canStand(o.x, o.z) && zone(o.x, o.z)) ?? { x: 0, z: wanted };
}

/** A moment (`dt` seconds) of him: where he is next, and what happened. */
export function hauntStep(h: Haunt, level: HorrorLevel, me: Watcher, dt: number, zone: (x: number, z: number) => boolean, opts: HauntOptions = {}): { haunt: Haunt; events: HauntEvent[] } {
  if (level === 'off') return { haunt: QUIET, events: [] };
  const bold = Math.min(1, Math.max(0, (opts.idle ?? 0) / HAUNT.bold.days));
  const s: Haunt = { ...h, cooldown: Math.max(0, h.cooldown - dt), glimpsed: Math.max(0, h.glimpsed - dt) };
  const inside = zone(me.x, me.z);
  const deeper = deeperFrom(me.z);

  if (!s.here) {
    s.waited = inside ? s.waited + dt : 0;
    if (!inside) return glimpse(s, me, dt, deeper, zone);
    if (s.waited < HAUNT.appearAfter - HAUNT.bold.sooner * bold || s.cooldown > 0) return { haunt: { ...s, edge: 0 }, events: [] };
    const came = s.came + 1;
    const fresh = { ...rest(s, 0), here: true, came, glances: s.glances };
    // Walked away often enough, he comes from behind, between you and your writing, if there's
    // room for him there where he walks.
    if (s.folded >= HAUNT.cutOffAfter && zone(me.x, me.z - deeper * ROOM_STEP)) {
      const back = lurk(me.z, (-deeper) as 1 | -1, came % 2 ? 1 : -1, zone);
      if (zone(back.x, back.z) && Math.abs(back.z - me.z) > HAUNT.near) return { haunt: { ...fresh, ...back, folded: 0 }, events: ['behind'] };
    }
    return { haunt: { ...fresh, ...lurk(me.z, deeper, came % 2 ? 1 : -1, zone) }, events: ['appear'] };
  }

  // Only seen past the edge: he stands there for as long as he's watched, and is gone once he's
  // well out of view (never while he can still be seen, D120), or once you've gone from the edge.
  // Come in, and he's here for real.
  if (s.glimpse) {
    if (inside) s.glimpse = false;
    else {
      const inView = sees({ ...me, half: me.half + 0.35 }, s.x, s.z);
      s.unseen = inView ? 0 : s.unseen + dt;
      const near = Math.abs(s.z - me.z) <= HAUNT.glimpseWithin + 6;
      if (s.unseen > 0.3 || !near) return { haunt: { ...rest(s, HAUNT.rest.glimpse), glimpsed: HAUNT.glimpseAgain }, events: [] };
      return { haunt: s, events: [] };
    }
  }

  s.outside = inside ? 0 : s.outside + dt;
  if (s.outside >= HAUNT.leaveAfter) return { haunt: rest(s, HAUNT.rest.leave), events: ['leave'] };
  const events: HauntEvent[] = [];
  const dist = Math.hypot(me.x - s.x, me.z - s.z);

  // The lamps go out now and then, sooner the longer you've watched him; in the dark he isn't seen.
  if (s.dark > 0) {
    s.dark = Math.max(0, s.dark - dt);
    if (s.dark === 0) events.push('light');
  }
  const seen = s.dark === 0 && sees(me, s.x, s.z);
  if (seen) {
    const turnedOn = s.unseen >= 0.3;
    if (turnedOn) s.glances++;
    s.unseen = 0;
    s.watched += dt;
    if (dist <= HAUNT.vanishAt) {
      const face: HauntEvent[] = level === 'intense' && turnedOn && dist <= HAUNT.faceAt ? ['face'] : [];
      return { haunt: { ...rest(s, HAUNT.rest.vanish), folded: s.folded + 1 }, events: [...events, ...face, 'vanish'] };
    }
    if (s.watched >= HAUNT.darkAfter - HAUNT.bold.darker * bold) {
      s.watched = 0;
      s.dark = HAUNT.darkFor;
      events.push('dark');
    }
    return { haunt: s, events };
  }
  s.watched = 0;
  s.unseen += dt;

  // Looked back at, he waits a little longer each time before he comes on, and then comes faster.
  const wait = Math.min(HAUNT.waitMost, HAUNT.waitPerGlance * s.glances);
  if (s.dark === 0 && s.unseen < wait) return { haunt: s, events };
  const pace = HAUNT.speed[level] * (opts.inked ? HAUNT.inked : 1) * (1 + HAUNT.bold.faster * bold) * (1 + Math.min(HAUNT.hurryMost, HAUNT.hurryPerGlance * s.glances));
  const by = Math.min(pace * dt, dist);
  if (by > 0) {
    // Close, straight at you; further off, round to behind you, keeping out of the edge of your
    // view, so a glance aside doesn't catch him.
    const behind = { x: me.x + Math.sin(me.yaw) * 1.2, z: me.z + Math.cos(me.yaw) * 1.2 };
    const goal = towards(s.x, s.z, dist < 3 ? me : behind);
    const gd = Math.hypot(goal.x - s.x, goal.z - s.z) || 1;
    const wary: Watcher = { ...me, half: me.half + 0.12 };
    const ways = [0, 0.8, -0.8, 1.4, -1.4].map((turn) => {
      const a = Math.atan2(goal.z - s.z, goal.x - s.x) + turn;
      return { x: Math.cos(a), z: Math.sin(a) };
    });
    const way = s.dark > 0 || dist < 3 ? ways[0]! : (ways.find((w) => !sees(wary, s.x + w.x * Math.min(by, gd), s.z + w.z * Math.min(by, gd))) ?? null);
    if (way) {
      const steps = Math.max(1, Math.ceil(by / 0.08));
      for (let i = 0; i < steps; i++) {
        const next = step(s.x, s.z, way.x * (by / steps), way.z * (by / steps));
        if (!zone(next.x, next.z)) break;
        s.x = next.x;
        s.z = next.z;
      }
    }
  }
  const now = Math.hypot(me.x - s.x, me.z - s.z);
  if (!s.warned && now <= HAUNT.near) {
    s.warned = true;
    events.push('near');
  }
  if (now <= HAUNT.reach) return level === 'intense' ? { haunt: rest(s, HAUNT.rest.scare), events: [...events, 'scare'] } : { haunt: rest(s, HAUNT.rest.pass), events: [...events, 'pass'] };
  return { haunt: s, events };
}

/** Where to head for on the way to `goal`: in the galleries, through the doorways between, one at a time; the storage room is one open hall. */
function towards(x: number, z: number, goal: { x: number; z: number }): { x: number; z: number } {
  if (z <= -ROOM_APOTHEM || goal.z <= -ROOM_APOTHEM) return goal;
  const k = Math.round(z / ROOM_STEP);
  const kg = Math.round(goal.z / ROOM_STEP);
  if (k === kg) return goal;
  const dir = Math.sign(kg - k);
  const door = k * ROOM_STEP + dir * ROOM_APOTHEM;
  // In line with the doorway first, then through it.
  if (Math.abs(x) > 0.25 && Math.abs(z - door) > 0.3) return { x: 0, z: door - dir * 0.9 };
  return { x: 0, z: door + dir * 1.0 };
}

/**
 * Near where he walks but not in it, having looked that way a good while: he's there, past the
 * edge, standing in the dark. Only ever where he walks, and rarely (D120).
 */
function glimpse(s: Haunt, me: Watcher, dt: number, deeper: 1 | -1, zone: (x: number, z: number) => boolean): { haunt: Haunt; events: HauntEvent[] } {
  let edge: number | null = null;
  for (let d = 1; d <= HAUNT.glimpseWithin; d += 0.5) {
    if (zone(0, me.z + deeper * d)) {
      edge = me.z + deeper * d;
      break;
    }
  }
  if (edge === null) return { haunt: { ...s, edge: 0 }, events: [] };
  const spot = { x: 0, z: edge + deeper * 2.5 };
  if (!canStand(spot.x, spot.z) || !zone(spot.x, spot.z)) return { haunt: s, events: [] };
  // Only the time spent looking that way counts; and once he's been glimpsed, not again for a long while.
  if (sees(me, spot.x, spot.z)) s.edge += dt;
  if (s.cooldown > 0 || s.glimpsed > 0 || s.edge < HAUNT.glimpseAfter || !sees(me, spot.x, spot.z)) return { haunt: s, events: [] };
  return { haunt: { ...rest(s, 0), here: true, glimpse: true, ...spot }, events: ['glimpse'] };
}
