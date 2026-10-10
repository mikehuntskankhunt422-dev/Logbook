/**
 * Which build this is. `vite build --mode desktop` (npm run build:desktop) makes the bundle the
 * desktop app loads (D77, D78); anything only the desktop needs is imported behind this flag, so
 * the browser build never carries it.
 */
export const isDesktop = import.meta.env.VITE_PLATFORM === 'desktop';
