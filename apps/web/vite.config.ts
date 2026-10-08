import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// pagedjs's exports map hides dist/, so point an alias at the polyfill the render server uses too.
const require = createRequire(import.meta.url);
const pagedPolyfill = path.join(path.dirname(require.resolve('pagedjs')), '..', 'dist', 'paged.polyfill.min.js');

/** Book-preview assets (static print fonts, Paged.js): fetched on first use and cached then, not precached for everyone. */
const PRINT_ASSET = /\/assets\/((newsreader|bricolage-grotesque|noto-emoji)-[a-z-]+-\d{3}-(normal|italic)|paged\.polyfill\.min)-[\w-]+\.(woff2?|js)$/;

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [{ find: /^pagedjs-polyfill(\?.*)?$/, replacement: `${pagedPolyfill}$1` }],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Logbook',
        short_name: 'Logbook',
        description: 'A private, local-first multimedia journal. Your entries stay on your device.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#fbf7f1',
        theme_color: '#e2451f',
        categories: ['lifestyle', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'New entry', short_name: 'New', url: '/#/new', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        globIgnores: ['**/assets/{newsreader,bricolage-grotesque,noto-emoji}-*-[0-9][0-9][0-9]-*', '**/assets/paged.polyfill.min-*'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: PRINT_ASSET,
            handler: 'CacheFirst',
            options: { cacheName: 'print-assets', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
