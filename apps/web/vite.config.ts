import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const require = createRequire(import.meta.url);

/**
 * Two builds from one source: the website (default) and the bundle the desktop app loads
 * (`--mode desktop`, D77): no service worker or web manifest, its own output folder, and
 * `import.meta.env.VITE_PLATFORM === 'desktop'` (src/lib/platform.ts).
 */
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    resolve: {
      alias: [
        // Paged.js 0.4.3 (D34) runs inside the book preview iframe; its package exports hide dist/.
        { find: /^pagedjs-polyfill(?=\?|$)/, replacement: join(dirname(dirname(require.resolve('pagedjs'))), 'dist', 'paged.polyfill.min.js') },
        ...(desktop ? [{ find: /^virtual:pwa-register\/react$/, replacement: fileURLToPath(new URL('src/desktop/no-service-worker.ts', import.meta.url)) }] : []),
      ],
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.VITE_PLATFORM': JSON.stringify(desktop ? 'desktop' : 'web'),
    },
    plugins: [
      react(),
      !desktop &&
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
            // pdf.js shows proofs on the order page, which needs a connection anyway: not worth every install's offline cache.
            globIgnores: ['**/pdf-*.js', '**/pdf.worker*'],
            navigateFallback: 'index.html',
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
            cleanupOutdatedCaches: true,
          },
        }),
    ],
    // `npm run dev -w @logbook/server` serves the API (cover sizes, quotes, orders) on port 4242; the
    // e2e tests start it too. Without it the builder falls back to its estimates.
    // The desktop app's dev window loads port 5174 (apps/desktop/src-tauri/tauri.conf.json).
    server: {
      ...(desktop ? { port: 5174, strictPort: true } : {}),
      proxy: { '/api': 'http://127.0.0.1:4242' },
    },
    preview: {
      proxy: { '/api': 'http://127.0.0.1:4242' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      ...(desktop ? { outDir: 'dist-desktop' } : {}),
    },
  };
});
