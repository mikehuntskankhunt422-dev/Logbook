import { today } from './dates.ts';
import type { Entry } from './model.ts';

/**
 * Letters to your future self (D122): an entry sealed until a day you choose. Until then its
 * words stay out of sight: the journal shows the envelope (its title, the day it was written and
 * the day it opens), search doesn't look inside, and the Library's book wears a wax seal. On the
 * day, it opens by itself. It's a seal, not a lock: the words are in the journal as ever (and in
 * its backups), for the passcode to guard; you can break the seal early if you choose.
 */

/** Whether an entry is still sealed on `day`. */
export const letterSealed = (entry: Pick<Entry, 'sealedUntil'>, day: string = today()): boolean => entry.sealedUntil !== null && entry.sealedUntil > day;

/** Letters that have opened by `day` (oldest first), not counting any in `told`. */
export function lettersOpened(entries: readonly Entry[], day: string, told: ReadonlySet<string>): Entry[] {
  return entries
    .filter((e) => !e.deletedAt && e.sealedUntil !== null && e.sealedUntil <= day && !told.has(`${e.id}@${e.sealedUntil}`))
    .sort((a, b) => (a.sealedUntil! < b.sealedUntil! ? -1 : a.sealedUntil! > b.sealedUntil! ? 1 : a.date < b.date ? -1 : 1));
}

/** The key a letter is remembered by once it's been said it opened (a new seal is a new letter). */
export const letterKey = (entry: Pick<Entry, 'id' | 'sealedUntil'>): string => `${entry.id}@${entry.sealedUntil}`;
