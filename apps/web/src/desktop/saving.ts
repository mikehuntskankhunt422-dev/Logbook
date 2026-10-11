import type { Journal } from '@logbook/core';
import { flushPendingSaves } from '../lib/pending-saves.ts';

/** The open journal, once there is one (boot.tsx sets it). */
let current: Journal | null = null;

export function setOpenJournal(journal: Journal): void {
  current = journal;
}

/**
 * Saves the editor's unsaved typing and waits for the folder to finish writing, giving up after
 * `ms`. True when everything is stored. Used before the window closes (D86) and before an update
 * installs, which on Windows ends the app straight away (D88).
 */
export async function saveEverything(ms: number): Promise<boolean> {
  const saved = flushPendingSaves().then(async (ok) => (await current?.store.whenIdle?.(), ok));
  return Promise.race([saved, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}
