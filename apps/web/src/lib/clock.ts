/**
 * The clock (D92): alarms, a timer and a stopwatch. They belong to this device, not to the journal:
 * kept in the browser's storage, never synced, and they ring while the journal is locked.
 */

export interface Alarm {
  id: string;
  /** "07:30", local time. */
  time: string;
  label: string;
  /** Days it repeats on, 0 = Sunday; none: once, then it turns itself off. */
  days: number[];
  on: boolean;
  /** A once-only alarm's ring, set when it's switched on (`arm`). */
  onceAt?: number | null;
}

export interface TimerState {
  /** What it was set to. */
  durationMs: number;
  /** When it ends, while running. */
  endsAt: number | null;
  /** What was left when paused (null: not started, or finished). */
  leftMs: number | null;
}

export interface StopwatchState {
  /** While running: when it started, less the time it had already counted. */
  startedAt: number | null;
  /** While stopped: the time counted. */
  elapsedMs: number;
  /** Lap times, each from the start. */
  laps: number[];
}

export interface Snooze {
  key: string;
  label: string;
  at: number;
}

export interface ClockState {
  alarms: Alarm[];
  timer: TimerState;
  stopwatch: StopwatchState;
  snoozes: Snooze[];
  /** Rings up to here have been seen to (so a reload doesn't ring them again). */
  checkedUntil?: number;
}

/** Something that rings, at a time. `id` is a whole number for the system's notifications. */
export interface Ring {
  key: string;
  id: number;
  at: number;
  title: string;
  body: string;
}

export const SNOOZE_MS = 10 * 60_000;
/** Rung later than this (the app was closed, the computer asleep), it's only let go. */
export const STALE_MS = 5 * 60_000;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const EMPTY_CLOCK: ClockState = {
  alarms: [],
  timer: { durationMs: 5 * 60_000, endsAt: null, leftMs: null },
  stopwatch: { startedAt: null, elapsedMs: 0, laps: [] },
  snoozes: [],
};

const KEY = 'logbook.clock';

export function loadClock(): ClockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_CLOCK;
    const s = JSON.parse(raw) as Partial<ClockState>;
    return {
      alarms: Array.isArray(s.alarms) ? s.alarms.filter((a) => typeof a?.id === 'string' && /^\d\d:\d\d$/.test(a.time)) : [],
      timer: { ...EMPTY_CLOCK.timer, ...s.timer },
      stopwatch: { ...EMPTY_CLOCK.stopwatch, ...s.stopwatch },
      snoozes: Array.isArray(s.snoozes) ? s.snoozes : [],
      checkedUntil: typeof s.checkedUntil === 'number' ? s.checkedUntil : 0,
    };
  } catch {
    return EMPTY_CLOCK;
  }
}

export function saveClock(state: ClockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private browsing or full storage: the clock still works until the page closes.
  }
}

/** The alarm's next ring after `after`, or null when it's off (or a once-only one has rung). */
export function nextRing(alarm: Alarm, after: Date): number | null {
  if (!alarm.on) return null;
  if (!alarm.days.length && alarm.onceAt) return alarm.onceAt > after.getTime() ? alarm.onceAt : null;
  return nextTime(alarm, after);
}

/** The alarm switched on: a once-only one rings at the next time it shows. */
export function arm(alarm: Alarm, now: Date): Alarm {
  return { ...alarm, on: true, onceAt: alarm.days.length ? null : nextTime(alarm, now) };
}

function nextTime(alarm: Pick<Alarm, 'time' | 'days'>, after: Date): number | null {
  const [h = 0, m = 0] = alarm.time.split(':').map(Number);
  for (let d = 0; d <= 7; d++) {
    const t = new Date(after.getFullYear(), after.getMonth(), after.getDate() + d, h, m, 0, 0);
    if (t.getTime() <= after.getTime()) continue;
    if (alarm.days.length && !alarm.days.includes(t.getDay())) continue;
    return t.getTime();
  }
  return null;
}

/** A stable whole number (31 bits) for a ring, as Android's notifications want. */
export function ringId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) & 0x7fffffff;
}

export const alarmTitle = (a: Pick<Alarm, 'label' | 'time'>) => (a.label.trim() ? `⏰ ${a.label.trim()}` : `⏰ Alarm, ${formatTime(a.time)}`);

/**
 * Everything due to ring in the next `days` days, soonest first: each alarm's rings (a repeating
 * one's on every day it repeats), the timer, and snoozed rings. Handed to the system, so they
 * ring even when Logbook isn't open where it can (Android).
 */
export function upcoming(state: ClockState, now: Date, days = 14, max = 100): Ring[] {
  const until = now.getTime() + days * 86_400_000;
  const rings: Ring[] = [];
  const add = (key: string, at: number, title: string, body: string) => rings.push({ key, id: ringId(key), at, title, body });
  for (const a of state.alarms) {
    let at = nextRing(a, now);
    while (at !== null && at <= until) {
      add(`alarm:${a.id}:${at}`, at, alarmTitle(a), 'Logbook alarm');
      if (!a.days.length) break;
      at = nextRing(a, new Date(at));
    }
  }
  if (state.timer.endsAt && state.timer.endsAt > now.getTime()) add(`timer:${state.timer.endsAt}`, state.timer.endsAt, '⏲️ Time’s up', `Your ${formatDuration(state.timer.durationMs)} timer has finished.`);
  for (const s of state.snoozes) if (s.at > now.getTime()) add(`snooze:${s.key}`, s.at, s.label, 'Snoozed');
  return rings.sort((x, y) => x.at - y.at).slice(0, max);
}

/** "7:30 AM" or "07:30", as this computer shows times. */
export function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Every day", "Weekdays", "Weekends", "Mon, Wed", "Once". */
export function describeDays(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (!set.length) return 'Once';
  if (set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  return set.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ');
}

/** "1:05:09", "5:09" (timer), or with hundredths for the stopwatch: "5:09.42". */
export function formatClock(ms: number, hundredths = false): string {
  const total = Math.max(0, hundredths ? Math.floor(ms / 10) : Math.ceil(ms / 1000) * 100);
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const main = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return hundredths ? `${main}.${pad(cs)}` : main;
}

/** "5 minutes", "1 hour 30 minutes", "45 seconds". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const parts: string[] = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (sec || !parts.length) parts.push(`${sec} ${sec === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/** "in 7 hours 12 minutes", "in 3 minutes", "in under a minute". */
export function ringsIn(at: number, now: number): string {
  const min = Math.ceil((at - now) / 60_000);
  if (min <= 1) return 'in under a minute';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`);
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m && !d) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  return `in ${parts.join(' ')}`;
}
