import { useCallback, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

/**
 * Updates from signed releases (M5 §2.6, D87): checked at launch at most once a day and from
 * Settings, installed only when the user clicks. The plugin refuses anything not signed with the
 * release key, so a bad download fails here rather than installing.
 */

const LAST_CHECK = 'logbook:lastUpdateCheck';
const DAY_MS = 86_400_000;

export const updatesEnabled = () => invoke<boolean>('updates_enabled');
export const appVersion = () => getVersion();

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; update: Update }
  | { kind: 'installing'; version: string; percent: number | null }
  /** `during` says whether checking or installing failed: only the latter is worth interrupting for. */
  | { kind: 'error'; during: 'check' | 'install'; message: string };

/** True if the daily check is due, and records that it ran. */
export function dailyCheckDue(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK) ?? 0);
    if (now - last < DAY_MS) return false;
    localStorage.setItem(LAST_CHECK, String(now));
  } catch {
    // No storage: check every launch.
  }
  return true;
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  const find = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const update = await check({ timeout: 30_000 });
      setState(update ? { kind: 'available', update } : { kind: 'latest' });
    } catch (err) {
      setState({ kind: 'error', during: 'check', message: `Couldn't check for updates: ${String(err)}` });
    }
  }, []);

  const install = useCallback(async (update: Update) => {
    let total = 0;
    let done = 0;
    setState({ kind: 'installing', version: update.version, percent: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        if (e.event === 'Progress') {
          done += e.data.chunkLength;
          setState({ kind: 'installing', version: update.version, percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      // Windows has already handed over to the installer; macOS and Linux restart into the new version.
      await relaunch();
    } catch (err) {
      setState({ kind: 'error', during: 'install', message: `The update wasn't installed: ${String(err)}` });
    }
  }, []);

  return { state, find, install, dismiss: () => setState({ kind: 'idle' }) };
}

export function describe(state: UpdateState): string {
  switch (state.kind) {
    case 'checking':
      return 'Checking for updates…';
    case 'latest':
      return 'You have the latest version.';
    case 'available':
      return `Logbook ${state.update.version} is ready to install.`;
    case 'installing':
      return `Installing Logbook ${state.version}${state.percent === null ? '…' : ` (${state.percent}%)…`} Logbook restarts when it's done.`;
    case 'error':
      return state.message;
    default:
      return '';
  }
}
