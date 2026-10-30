import { useEffect, useState, useSyncExternalStore } from 'react';
import { holidayOn, today, type Holiday, type HolidayId } from '@logbook/core';

/**
 * Holidays (D108): on unless switched off, each on its own, in Settings → Appearance. The choice
 * belongs to the device (browser storage), like the writing prompts, so the journal's format
 * doesn't change.
 */

const KEY = 'logbook.holidays';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

// Kept as the stored text, so the snapshot only changes when the choice does.
let stored = read();

/** The holidays switched off on this device. */
export function holidaysOff(): Set<HolidayId> {
  try {
    const parsed = JSON.parse(stored || '{}') as { off?: unknown };
    return new Set(Array.isArray(parsed.off) ? (parsed.off.filter((x) => typeof x === 'string') as HolidayId[]) : []);
  } catch {
    return new Set();
  }
}

export function setHolidayOn(id: HolidayId, on: boolean): void {
  const off = holidaysOff();
  if (on) off.delete(id);
  else off.add(id);
  stored = off.size ? JSON.stringify({ off: [...off] }) : '';
  try {
    if (stored) localStorage.setItem(KEY, stored);
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  for (const l of listeners) l();
}

/** Re-reads when another tab changes the choice. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    stored = read();
    for (const l of listeners) l();
  });
}

/** The holidays switched off, as the stored text changes. */
function useOffKey(): string {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => stored,
    () => stored,
  );
}

/** Today's date (YYYY-MM-DD), moving on at midnight while the app is open. */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}

/** Whether a holiday is on on this device. */
export function useHolidayOn(id: HolidayId): boolean {
  useOffKey();
  return !holidaysOff().has(id);
}

/** The holiday today falls in, if it's on. */
export function useHoliday(): Holiday | undefined {
  const day = useToday();
  useOffKey();
  return holidayOn(day, holidaysOff());
}

/** The holiday a given day falls in, if it's on (for that day's writing prompt). */
export function useHolidayFor(date: string): Holiday | undefined {
  useOffKey();
  return holidayOn(date, holidaysOff());
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
