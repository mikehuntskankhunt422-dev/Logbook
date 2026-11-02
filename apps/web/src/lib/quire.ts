import { useSyncExternalStore } from 'react';
import { PAGES, type PageId } from './lore.ts';

/**
 * Silas Quire's pages (D119): which of his loose notebook pages you've found, out where he walks
 * and in the Clerk's drawer, and whether, with all of them found, he's been laid to rest (he stays
 * away while you keep writing). On this device, like the Library's other choices.
 */

export interface QuireState {
  found: PageId[];
  /** All found and laid to rest, until woken. */
  rest: boolean;
}

const KEY = 'logbook.quire';
const listeners = new Set<() => void>();
let current = load();

function load(): QuireState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof QuireState, unknown>>;
    const found = Array.isArray(raw.found) ? PAGES.map((p) => p.id).filter((id) => (raw.found as unknown[]).includes(id)) : [];
    return { found, rest: raw.rest === true && found.length === PAGES.length };
  } catch {
    return { found: [], rest: false };
  }
}

function save(next: QuireState) {
  current = next;
  try {
    if (!next.found.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
}

export const quire = (): QuireState => current;

/** A page found: whether it's new, how many are found now, and whether it was the last (he's laid to rest, then). */
export function findPage(id: PageId): { fresh: boolean; count: number; all: boolean } {
  const now = load();
  if (now.found.includes(id)) return { fresh: false, count: now.found.length, all: now.found.length === PAGES.length };
  const found = PAGES.map((p) => p.id).filter((p) => p === id || now.found.includes(p));
  const all = found.length === PAGES.length;
  save({ found, rest: all ? true : now.rest });
  return { fresh: true, count: found.length, all };
}

/** Laid to rest, or woken again (he walks again at once). */
export function setRest(rest: boolean): void {
  const now = load();
  save({ ...now, rest: rest && now.found.length === PAGES.length });
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

export function useQuire(): QuireState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}
