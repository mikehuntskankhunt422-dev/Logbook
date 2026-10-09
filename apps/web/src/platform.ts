/**
 * True in the Tauri desktop app, which loads this same web app built with `--mode desktop` (D78).
 * It's a build-time constant. Where it guards a dynamic `import()` of desktop code, write out
 * `import.meta.env.VITE_PLATFORM === 'desktop'` instead: the bundler folds that within a module, but
 * not a constant imported from here, and would otherwise emit the desktop chunks in the website.
 */
export const IS_DESKTOP = import.meta.env.VITE_PLATFORM === 'desktop';
