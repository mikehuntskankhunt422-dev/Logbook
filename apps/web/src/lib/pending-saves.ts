/**
 * Work that must reach storage before the app closes (D86): the editor's not-yet-saved typing.
 * The desktop app waits for these when its window is closed or the app quits; the browser build
 * keeps flushing on `pagehide` as before.
 */
const flushers = new Set<() => Promise<unknown>>();

/** Registers a flush for as long as the caller is mounted; returns the unregister function. */
export function onFlush(flush: () => Promise<unknown>): () => void {
  flushers.add(flush);
  return () => void flushers.delete(flush);
}

/** Runs every registered flush; a failing one doesn't stop the others. */
export async function flushPendingSaves(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch(() => undefined)));
}
