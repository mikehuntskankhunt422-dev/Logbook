import { createContext, useContext } from 'react';
import type { FsStore } from '@logbook/storage-fs';

export interface DesktopCtx {
  /** The journal folder, as the system shows it. */
  folder: string;
  store: FsStore;
  /** Calls back (debounced) when anything in the folder changes; resolves to a function that stops. */
  watch(onChange: () => void): Promise<() => void>;
  /** Shown once when the journal opens, e.g. what a restored backup brought. */
  notice?: string;
}

/** Only provided in the desktop app; the website sees `null`. Holds no Tauri code itself. */
export const DesktopContext = createContext<DesktopCtx | null>(null);

export function useDesktop(): DesktopCtx | null {
  return useContext(DesktopContext);
}
