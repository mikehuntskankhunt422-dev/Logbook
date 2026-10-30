import { useEffect, useState, useSyncExternalStore } from 'react';
import { holidayOn, today, type Holiday, type HolidayChoices, type HolidayId } from '@logbook/core';
import { celebrate } from './motion.ts';

/**
 * Holidays (D108, D109): on unless switched off, all at once or one at a time, in Settings →
 * Appearance → Holidays, with your birthday. All of it belongs to the device (browser storage), like
 * the writing prompts, so the journal's format doesn't change and your birthday stays here.
 */

export interface HolidayPrefs {
  /** Holidays at all. */
  all: boolean;
  off: HolidayId[];
  /** MM-DD, or '' when not set. */
  birthday: string;
}

const KEY = 'logbook.holidays';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

// Kept as the stored text, so the snapshot only changes when a choice does.
let stored = read();

let parsed: { text: string; prefs: HolidayPrefs } | undefined;

/** The choices in the stored text, parsed once per change. */
function prefsOf(text: string): HolidayPrefs {
  if (parsed?.text === text) return parsed.prefs;
  let prefs: HolidayPrefs = { all: true, off: [], birthday: '' };
  try {
    const raw = JSON.parse(text || '{}') as { all?: unknown; off?: unknown; birthday?: unknown };
    prefs = {
      all: raw.all !== false,
      off: Array.isArray(raw.off) ? (raw.off.filter((x) => typeof x === 'string') as HolidayId[]) : [],
      birthday: typeof raw.birthday === 'string' && /^\d\d-\d\d$/.test(raw.birthday) ? raw.birthday : '',
    };
  } catch {
    // Unreadable: everything as it starts.
  }
  parsed = { text, prefs };
  return prefs;
}

export function holidayPrefs(): HolidayPrefs {
  return prefsOf(stored);
}

export function setHolidayPrefs(patch: Partial<HolidayPrefs>): void {
  const next = { ...holidayPrefs(), ...patch };
  const kept: Partial<HolidayPrefs> = {};
  if (!next.all) kept.all = false;
  if (next.off.length) kept.off = [...new Set(next.off)];
  if (next.birthday) kept.birthday = next.birthday;
  stored = Object.keys(kept).length ? JSON.stringify(kept) : '';
  try {
    if (stored) localStorage.setItem(KEY, stored);
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  for (const l of listeners) l();
}

export function setHolidayOn(id: HolidayId, on: boolean): void {
  const off = holidayPrefs().off.filter((x) => x !== id);
  setHolidayPrefs({ off: on ? off : [...off, id] });
}

// Another tab's change.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    stored = read();
    for (const l of listeners) l();
  });
}

/** The choices, as they change. */
export function useHolidayPrefs(): HolidayPrefs {
  const text = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => stored,
    () => stored,
  );
  return prefsOf(text);
}

function choicesOf(prefs: HolidayPrefs): HolidayChoices {
  return { all: prefs.all, off: new Set(prefs.off), birthday: prefs.birthday || undefined };
}

/** Today's date (YYYY-MM-DD), moving on at midnight while the app is open. */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());
    const timer = setInterval(check, 15_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}

/** The holiday today falls in, if it's on. */
export function useHoliday(): Holiday | undefined {
  const day = useToday();
  return holidayOn(day, choicesOf(useHolidayPrefs()));
}

/** The holiday a given day falls in, if it's on (for that day's writing prompt). */
export function useHolidayFor(date: string): Holiday | undefined {
  return holidayOn(date, choicesOf(useHolidayPrefs()));
}

/** The app's colours for the holiday (app.css, `data-holiday`), over the garden's colours while it lasts. */
export function useHolidayColours(holiday: Holiday | undefined): void {
  const id = holiday?.id;
  useEffect(() => {
    const root = document.documentElement;
    if (id) root.setAttribute('data-holiday', id);
    else root.removeAttribute('data-holiday');
  }, [id]);
}

const CHEERED = 'logbook.holidays.cheered';

/**
 * Confetti once: on your birthday, and as the new year begins (at midnight with the app open, or the
 * first time it's opened on 1 January). Once per year on this device; never with reduced motion.
 */
export function useHolidayCheer(holiday: Holiday | undefined, date: string): void {
  const due = holiday && (holiday.id === 'birthday' || (holiday.id === 'newyear' && date.endsWith('-01-01'))) ? `${holiday.id}:${date.slice(0, 4)}` : '';
  useEffect(() => {
    if (!due) return;
    try {
      const done = (localStorage.getItem(CHEERED) ?? '').split(' ');
      if (done.includes(due)) return;
      localStorage.setItem(CHEERED, [...done.filter((d) => d && !d.startsWith(due.split(':')[0]!)), due].join(' '));
    } catch {
      // Without storage it may cheer again next time: better than never.
    }
    celebrate('streak');
  }, [due]);
}

const EGGS = 'logbook.holidays.eggs';
/** Eggs hidden among the newest bed's plants at Easter. */
export const EGG_COUNT = 4;

/** Which of this Easter's eggs have been found on this device. */
export function useEggs(year: string): { found: number[]; find: (egg: number) => number } {
  const [found, setFound] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EGGS) ?? '{}') as { year?: string; found?: number[] };
      return saved.year === year && Array.isArray(saved.found) ? saved.found : [];
    } catch {
      return [];
    }
  });
  const find = (egg: number) => {
    const next = found.includes(egg) ? found : [...found, egg];
    setFound(next);
    try {
      localStorage.setItem(EGGS, JSON.stringify({ year, found: next }));
    } catch {
      // Found until the page closes.
    }
    return next.length;
  };
  return { found, find };
}
