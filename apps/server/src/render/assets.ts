import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PRINT_FONT_STYLESHEETS } from '@logbook/core';

/** Fake origin the render pages load from. Every request is answered from memory or refused. */
export const RENDER_ORIGIN = 'https://render.logbook.invalid';

export interface Asset {
  body: Buffer;
  contentType: string;
}

export interface RenderAssets {
  /** @font-face rules pointing at /fonts/… on the render origin. */
  fontCss: string;
  /** Path on the render origin → bytes. */
  files: Map<string, Asset>;
}

const require = createRequire(import.meta.url);

/** Reads the print fonts and Paged.js once at startup. */
export async function loadRenderAssets(): Promise<RenderAssets> {
  const files = new Map<string, Asset>();
  const css: string[] = [];
  for (const spec of PRINT_FONT_STYLESHEETS) {
    const cssPath = require.resolve(spec);
    const pkg = spec.split('/').slice(0, 2).join('/').replace('@fontsource/', '');
    const dir = path.dirname(cssPath);
    let text = await readFile(cssPath, 'utf8');
    // Keep only the woff2 source and serve it from the render origin.
    text = text.replace(/src:\s*url\(\.\/files\/([^)]+\.woff2)\)\s*format\('woff2'\)[^;]*;/g, (_, file: string) => {
      const route = `/fonts/${pkg}/${file}`;
      files.set(route, { body: Buffer.alloc(0), contentType: 'font/woff2' });
      return `src: url(${RENDER_ORIGIN}${route}) format('woff2');`;
    });
    // Print waits for fonts explicitly; never draw with a fallback.
    text = text.replace(/font-display:\s*swap;/g, 'font-display: block;');
    css.push(text);
    for (const [route, asset] of files) {
      if (asset.body.length || !route.startsWith(`/fonts/${pkg}/`)) continue;
      asset.body = await readFile(path.join(dir, 'files', route.slice(`/fonts/${pkg}/`.length)));
    }
  }
  // pagedjs's exports map hides dist/, so resolve the package entry and step across.
  const paged = path.join(path.dirname(require.resolve('pagedjs')), '..', 'dist', 'paged.polyfill.min.js');
  files.set('/paged.polyfill.js', { body: await readFile(paged), contentType: 'text/javascript' });
  return { fontCss: css.join('\n'), files };
}
