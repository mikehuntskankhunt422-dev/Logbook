import type { BookOptions } from '@logbook/core';

/**
 * The book being built, kept in memory for this session only. It holds titles and dates, and the
 * journal's settings store isn't encrypted, so it isn't persisted; it's dropped when the journal locks.
 */
let draft: BookOptions | null = null;

export function getBookDraft(): BookOptions | null {
  return draft;
}

export function setBookDraft(next: BookOptions): void {
  draft = next;
}

export function clearBookDraft(): void {
  draft = null;
}
