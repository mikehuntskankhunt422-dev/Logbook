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
