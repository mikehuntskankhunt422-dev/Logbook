/**
 * Which build this is. `vite build --mode desktop` (npm run build:desktop) makes the bundle the
 * desktop app loads (D77, D78), `--mode android` the one the Android app loads (D90); anything
 * only the apps need is imported behind these flags, so the browser build never carries it.
 *
 * Both apps are the same Tauri shell (apps/desktop/src-tauri): save dialogs, links opening in the
 * browser, a journal folder on disk. Only the desktop app lets the person choose that folder, and
 * only it installs its own updates.
 */
export const isDesktop = import.meta.env.VITE_PLATFORM === 'desktop';
export const isAndroid = import.meta.env.VITE_PLATFORM === 'android';
/** The desktop or the Android app, as opposed to the website. */
export const isApp = import.meta.env.VITE_PLATFORM !== 'web';
