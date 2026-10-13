import { useSyncExternalStore } from 'react';
import { announce } from '../app/toasts.tsx';
import { openExternal } from '../desktop/bridge.ts';

/**
 * New versions on Android (D90). The app comes as an APK from Logbook's releases on GitHub and
 * can't install its own updates, so it looks at the newest release shortly after it starts and
 * twice a day while it stays open, and offers that release's APK. The browser downloads it and
 * Android installs it over this one, keeping the journal, only if it carries the same signature.
 */

/** Where the releases are, as in the desktop updater's address (src-tauri/tauri.conf.json). */
const REPO = 'mikehuntskankhunt422-dev/Logbook';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
/** How long the offer stays on screen; Settings → Updates keeps it after that. */
const OFFER_MS = 60_000;

/**
 * A test build from a work branch (the release workflow's preview APK): a separate app with its own
 * journal, which a release's APK can't update, so it doesn't look.
 */
export const isPreview = import.meta.env.VITE_ANDROID_PREVIEW === '1';

export type UpdateState =
  | { phase: 'idle' | 'checking' | 'current' }
  | { phase: 'available'; version: string; url: string }
  | { phase: 'failed'; error: string };

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

/** [major, minor, patch] of "1.2.3" or "v1.2.3"; null for anything else. */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether release `tag` is newer than version `current`. */
export function isNewer(tag: string, current: string): boolean {
  const a = parseVersion(tag);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

interface Release {
  tag_name?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown }[];
}

/** The newer release's version and APK address, from GitHub's answer; null when there's none. */
export function newerApk(release: Release, current: string): { version: string; url: string } | null {
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!isNewer(tag, current)) return null;
  const apk = release.assets?.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk'));
  const url = typeof apk?.browser_download_url === 'string' ? apk.browser_download_url : '';
  // A release made without the Android signing key has no APK: nothing to offer.
  if (!url.startsWith(`https://github.com/${REPO}/releases/download/`)) return null;
  return { version: tag.replace(/^v/, ''), url };
}

/** Looks for a newer version. Resolves to it, or null when this one is the newest. */
export async function checkForUpdate(): Promise<string | null> {
  set({ phase: 'checking' });
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const found = newerApk((await res.json()) as Release, import.meta.env.VITE_APP_VERSION);
    set(found ? { phase: 'available', ...found } : { phase: 'current' });
    return found?.version ?? null;
  } catch (err) {
    const error = err instanceof Error && err.name === 'TimeoutError' ? 'GitHub took too long to answer.' : err instanceof Error ? err.message : String(err);
    set({ phase: 'failed', error: navigator.onLine ? error : "This phone isn't online." });
    throw err;
  }
}

/** Opens the new APK in the browser, which downloads it; Android then asks to install it. */
export async function downloadUpdate(): Promise<void> {
  if (state.phase !== 'available') return;
  const { url, version } = state;
  try {
    await openExternal(url);
  } catch (err) {
    announce(`Couldn't open the download for Logbook ${version}: ${String(err)}`);
  }
}

/** The quiet checks: shortly after starting, then twice a day. A failed one says nothing. */
export function checkForUpdatesSoon(): void {
  if (isPreview) return;
  let offered: string | null = null;
  const check = () =>
    checkForUpdate()
      .then((version) => {
        if (!version || version === offered) return;
        offered = version;
        announce(`Logbook ${version} is available.`, { label: 'Download', run: () => void downloadUpdate() }, OFFER_MS);
      })
      .catch((err: unknown) => console.warn('Update check failed:', err));
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}
