import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { announce } from '../app/toasts.tsx';
import { saveEverything } from './saving.ts';

/**
 * Automatic updates (M5 slice F, D88). Logbook looks for a newer version shortly after it starts
 * and twice a day while it stays open, and offers it; nothing installs without a click. The files
 * come from GitHub Releases and must carry our updater signature (src-tauri/src/lib.rs).
 */

export type UpdateState =
  | { phase: 'idle' | 'checking' | 'current' }
  | { phase: 'available'; version: string }
  | { phase: 'installing'; version: string; received: number; total: number | null }
  | { phase: 'failed'; version: string | null; error: string };

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
/** Longest the page spends saving before an install (Windows ends the app as it installs). */
const SAVE_WAIT_MS = 10_000;
/** How long the offer stays on screen; Settings → Updates keeps it after that. */
const OFFER_MS = 60_000;

let state: UpdateState = { phase: 'idle' };
const listeners = new Set<() => void>();
function set(next: UpdateState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
}

/** Looks for a newer version. Resolves to it, or null when this one is the newest. */
export async function checkForUpdate(): Promise<string | null> {
  if (state.phase === 'installing') return state.version;
  set({ phase: 'checking' });
  try {
    const found = await invoke<{ version: string } | null>('update_check');
    set(found ? { phase: 'available', version: found.version } : { phase: 'current' });
    return found?.version ?? null;
  } catch (err) {
    set({ phase: 'failed', version: null, error: String(err) });
    throw err;
  }
}

/**
 * Saves everything, then downloads and installs the version found, and restarts into it. After a
 * failed try it looks again first, so a release that was fixed meanwhile is the one installed.
 */
export async function installUpdate(): Promise<void> {
  let version = state.phase === 'available' || state.phase === 'failed' ? state.version : null;
  if (!version) return;
  if (state.phase === 'failed') {
    version = await checkForUpdate().catch(() => null);
    if (!version) return;
  }
  set({ phase: 'installing', version, received: 0, total: null });
  const fail = (error: string) => set({ phase: 'failed', version, error });
  if (!(await saveEverything(SAVE_WAIT_MS))) {
    return fail("Your latest writing couldn't be saved, so Logbook didn't update. Copy it somewhere safe and try again.");
  }
  const stop = await listen<[number, number | null]>('logbook://update-progress', (e) => {
    const [received, total] = e.payload;
    set({ phase: 'installing', version, received, total });
  });
  try {
    // Doesn't come back when it works: the app restarts as the new version.
    await invoke('update_install');
  } catch (err) {
    fail(String(err));
  } finally {
    stop();
  }
}

/** The quiet checks: shortly after starting, then twice a day. A failed one says nothing. */
export function checkForUpdatesSoon(): void {
  let offered: string | null = null;
  const check = () =>
    checkForUpdate()
      .then((version) => {
        if (!version || version === offered) return;
        offered = version;
        announce(`Logbook ${version} is ready to install.`, { label: 'Update and restart', run: () => void installAndReport() }, OFFER_MS);
      })
      .catch((err: unknown) => console.warn('Update check failed:', err));
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}

/** Installing from the toast, where there's no panel to show a failure. */
async function installAndReport(): Promise<void> {
  announce('Downloading the update…');
  await installUpdate();
  const now = state;
  if (now.phase === 'failed') announce(`Logbook couldn't update: ${now.error}`, { label: 'Try again', run: () => void installAndReport() }, OFFER_MS);
}
