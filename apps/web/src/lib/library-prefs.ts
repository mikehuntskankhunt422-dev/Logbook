import { useSyncExternalStore } from 'react';
import type { HorrorLevel } from '@logbook/core';

/**
 * How the walking Library looks and feels on this device (D116): horror off (as it starts),
 * Unsettling or Intense; the PS1 look; and whether horror makes a sound. Browser storage, like the
 * garden's choices: the journal doesn't change.
 */

export interface LibraryPrefs {
  horror: HorrorLevel;
  ps1: boolean;
  sounds: boolean;
}

const DEFAULTS: LibraryPrefs = { horror: 'off', ps1: false, sounds: true };
const KEY = 'logbook.library';
const listeners = new Set<() => void>();
let current = load();

function load(): LibraryPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof LibraryPrefs, unknown>>;
    return {
      horror: raw.horror === 'unsettling' || raw.horror === 'intense' ? raw.horror : 'off',
      ps1: raw.ps1 === true,
      sounds: raw.sounds !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

export function libraryPrefs(): LibraryPrefs {
  return current;
}

export function setLibraryPrefs(patch: Partial<LibraryPrefs>): void {
  current = { ...load(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

export function useLibraryPrefs(): LibraryPrefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}
