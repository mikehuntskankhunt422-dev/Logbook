/** Local calendar dates as 'YYYY-MM-DD' strings. Entries belong to the day the writer chose, not a UTC instant. */

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function today(): string {
  return toIsoDate(new Date());
}

export interface Streak {
  current: number;
  longest: number;
  wroteToday: boolean;
}

/**
 * A streak is a run of consecutive days with at least one entry. The current streak stays alive
 * until the end of today: if you wrote yesterday but not yet today, it still counts.
 *
 * `shielded` days (D115) are days a streak shield covered: they carry a streak over a day with
 * nothing written without adding to it.
 */
export function computeStreak(dates: Iterable<string>, todayIso: string, shielded: Iterable<string> = []): Streak {
  const days = new Set(dates);
  const covered = new Set([...shielded].filter((d) => !days.has(d)));
  const kept = (d: string) => days.has(d) || covered.has(d);
  const wroteToday = days.has(todayIso);
  let current = 0;
  let cursor = wroteToday ? todayIso : addDays(todayIso, -1);
  while (kept(cursor)) {
    if (days.has(cursor)) current++;
    cursor = addDays(cursor, -1);
  }
  let longest = 0;
  for (const d of [...days, ...covered]) {
    if (kept(addDays(d, -1))) continue; // not the start of a run
    let len = 0;
    for (let c = d; kept(c); c = addDays(c, 1)) if (days.has(c)) len++;
    longest = Math.max(longest, len);
  }
  return { current, longest, wroteToday };
}

/**
 * The days streak shields would have to cover to keep a streak going (D115): with nothing written
 * today or yesterday, every day missed since the last one kept, when that day ended a streak of at
 * least `least` days. Empty while the streak is alive, or with none worth keeping.
 */
export function missedDays(dates: Iterable<string>, todayIso: string, shielded: Iterable<string> = [], least = 2): string[] {
  const days = new Set(dates);
  const covered = new Set(shielded);
  const yesterday = addDays(todayIso, -1);
  if (days.has(todayIso) || days.has(yesterday) || covered.has(yesterday)) return [];
  let last: string | undefined;
  for (const d of [...days, ...covered]) if (d < yesterday && (!last || d > last)) last = d;
  if (!last) return [];
  // The streak as it stood the day after its last day.
  if (computeStreak(days, addDays(last, 1), covered).current < least) return [];
  const out: string[] = [];
  for (let d = addDays(last, 1); d <= yesterday; d = addDays(d, 1)) out.push(d);
  return out;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365, 500, 1000];

/** Heat-map intensity 0–4 from the number of words written on a day. */
export function heatLevel(words: number): 0 | 1 | 2 | 3 | 4 {
  if (words <= 0) return 0;
  if (words < 50) return 1;
  if (words < 200) return 2;
  if (words < 600) return 3;
  return 4;
}

/** Dates in previous years that share today's month and day (29 Feb falls back to 28 Feb). */
export function onThisDayDates(todayIso: string, entryDates: Iterable<string>): string[] {
  const mmdd = todayIso.slice(5);
  const year = Number(todayIso.slice(0, 4));
  const isLeapDay = mmdd === '02-29';
  const out = new Set<string>();
  for (const d of entryDates) {
    const y = Number(d.slice(0, 4));
    if (y >= year) continue;
    const md = d.slice(5);
    if (md === mmdd || (isLeapDay && md === '02-28')) out.add(d);
  }
  return [...out].sort().reverse();
}

export function yearsAgo(fromIso: string, toIso: string): number {
  return Number(toIso.slice(0, 4)) - Number(fromIso.slice(0, 4));
}

/** Monday-first weeks covering a month, padded with nulls, for calendar grids. */
export function monthGrid(year: number, month0: number): (string | null)[][] {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toIsoDate(new Date(year, month0, d)));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
