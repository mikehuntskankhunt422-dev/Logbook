import { createContext, useContext } from 'react';
import type { FsStore } from '@logbook/storage-fs';

export interface DesktopCtx {
  /** The journal folder, as the system shows it. */
  folder: string;
  store: FsStore;
}

/** Only provided in the desktop app; the website sees `null`. Holds no Tauri code itself. */
export const DesktopContext = createContext<DesktopCtx | null>(null);

export function useDesktop(): DesktopCtx | null {
  return useContext(DesktopContext);
}
