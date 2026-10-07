import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import { PRINT_FONT_STYLESHEETS } from '@logbook/core';

const require = createRequire(import.meta.url);

/** Paged.js 0.4.3, pinned exactly (D34). Its package exports hide `dist/`, so locate it from the main entry. */
export const PAGED_JS_PATH = join(dirname(dirname(require.resolve('pagedjs'))), 'dist', 'paged.polyfill.js');

/** Fontsource packages that hold the static print fonts (D35). */
const FONT_PACKAGES = new Map(
  [...new Set(PRINT_FONT_STYLESHEETS.map((s) => s.split('/').slice(0, 2).join('/')))].map((pkg) => [
    pkg.replace('@fontsource/', ''),
    dirname(require.resolve(`${pkg}/package.json`)),
  ]),
);

/** `<link>` tags for the print fonts, served by the routed origin under /fonts/. */
export const FONT_LINKS = PRINT_FONT_STYLESHEETS.map((s) => `<link rel="stylesheet" href="/fonts/${s.replace('@fontsource/', '')}">`).join('');

/** Maps `/fonts/newsreader/files/x.woff2` to the file on disk; undefined for anything outside the font packages. */
export function fontFile(pathname: string): string | undefined {
  const [, , pkg, ...rest] = pathname.split('/');
  const root = pkg && FONT_PACKAGES.get(pkg);
  if (!root || !rest.length) return undefined;
  const file = normalize(join(root, ...rest));
  return file.startsWith(root + sep) && /\.(css|woff2?)$/.test(file) ? file : undefined;
}
