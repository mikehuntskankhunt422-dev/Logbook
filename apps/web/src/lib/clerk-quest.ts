import { useSyncExternalStore } from 'react';
import { announce } from '../app/toasts.tsx';
import { giveShields } from './secrets.ts';

/**
 * The Clerk's quest (D123): three folders of his own, misfiled long ago on the empty racks out
 * past the last of yours. Find them (with horror on, they're where The Unwritten walks, all but
 * the first), take them back to him, and he gives you two streak shields and his lantern, by
 * which the storage room's lamps never go out on you. Kept on this device.
 */

export type ClerkFolderId = 'f1' | 'f2' | 'f3';

export const CLERK_NAME = 'Albert Ledger';

/** His folders: so many aisles past the first empty one (`aisles`), and what's in each. */
export const CLERK_FOLDERS: readonly { id: ClerkFolderId; aisles: number; title: string; text: string }[] = [
  {
    id: 'f1',
    aisles: 1,
    title: 'Staff record',
    text: 'Name: Albert Ledger. Post: Clerk, storage room. Started: the day the first entry was written. Duties: to file every entry, in order, for as long as there are entries. Note at the bottom, in his own hand: “Asked how long that would be. Nobody answered.”',
  },
  {
    id: 'f2',
    aisles: 4,
    title: 'A note, folded small',
    text: 'In the Librarian’s hand: “Albert. The racks go back further than either of us will ever walk. Don’t try to reach the end. File what comes, and come up for tea at four.” Underneath, in his: “Kept this. Never told her.”',
  },
  {
    id: 'f3',
    aisles: 8,
    title: 'The ledger’s last page',
    text: '“Filed: everything that came. Lost: three of my own folders, somewhere down the far aisles. Seen: a tall gentleman, asking for empty folders again. Didn’t give him any more. Felt bad about it. Still do. If he comes back with something written in one, I’ll file it first.”',
  },
];

export interface ClerkQuest {
  found: ClerkFolderId[];
  /** All three handed back. */
  done: boolean;
}

const KEY = 'logbook.clerk';
const SHIELDS = 2;
const listeners = new Set<() => void>();
let current = load();

function load(): ClerkQuest {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof ClerkQuest, unknown>>;
    const found = Array.isArray(raw.found) ? CLERK_FOLDERS.map((f) => f.id).filter((id) => (raw.found as unknown[]).includes(id)) : [];
    return { found, done: raw.done === true && found.length === CLERK_FOLDERS.length };
  } catch {
    return { found: [], done: false };
  }
}

function save(next: ClerkQuest) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
}

export const clerkQuest = (): ClerkQuest => current;

/** One of his folders found: whether it's new, and how many now. */
export function findClerkFolder(id: ClerkFolderId): { fresh: boolean; count: number } {
  const now = load();
  if (now.found.includes(id)) return { fresh: false, count: now.found.length };
  const found = CLERK_FOLDERS.map((f) => f.id).filter((f) => f === id || now.found.includes(f));
  save({ ...now, found });
  return { fresh: true, count: found.length };
}

/** All three handed back to him: his thanks, two shields and his lantern. False if there's nothing to hand back. */
export function handBack(): boolean {
  const now = load();
  if (now.done || now.found.length < CLERK_FOLDERS.length) return false;
  save({ ...now, done: true });
  giveShields(SHIELDS);
  announce(`🗂️ The Clerk has his folders back. Reward: ${SHIELDS} streak shields, and his lantern: in the storage room, the lamps never go out on you.`, { label: 'Encyclopedia', run: () => (location.hash = '#/library/encyclopedia') }, 9000);
  return true;
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

export function useClerkQuest(): ClerkQuest {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}
