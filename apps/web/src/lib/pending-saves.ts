/**
 * Work that must reach storage before the app closes (D86): the editor's not-yet-saved typing.
 * The desktop app waits for these when its window is closed or the app quits; the browser build
 * keeps flushing on `pagehide` as before.
 */
/** A flush resolves true when everything it had is stored. */
const flushers = new Set<() => Promise<boolean>>();

/** Registers a flush for as long as the caller is mounted; returns the unregister function. */
export function onFlush(flush: () => Promise<boolean>): () => void {
  flushers.add(flush);
  return () => void flushers.delete(flush);
}

/** Runs every registered flush; true when all of them stored everything. */
export async function flushPendingSaves(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((f) => f().catch(() => false)));
  return results.every(Boolean);
}

/**
 * Work under way that an update mustn't cut off by restarting the app (D88): adding photos or a
 * video to an entry, a restore, a passcode change. The update waits for it before it installs.
 */
const work = new Set<Promise<unknown>>();

/** Records `p` as work in progress until it settles; returns it. */
export function trackWork<T>(p: Promise<T>): Promise<T> {
  work.add(p);
  const done = () => void work.delete(p);
  p.then(done, done);
  return p;
}

export function workInProgress(): boolean {
  return work.size > 0;
}

/** Resolves once nothing is in progress, including work that started while waiting. */
export async function workDone(): Promise<void> {
  while (work.size) await Promise.allSettled([...work]);
}
