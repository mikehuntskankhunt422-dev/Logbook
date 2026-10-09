/**
 * True in the Tauri desktop app, which loads this same web app built with `--mode desktop` (D78).
 * It's a build-time constant, so the website's bundle drops desktop-only code and vice versa.
 */
export const IS_DESKTOP = import.meta.env.VITE_PLATFORM === 'desktop';
