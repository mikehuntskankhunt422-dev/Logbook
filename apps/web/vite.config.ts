import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import desktopPkg from '../desktop/package.json' with { type: 'json' };

const require = createRequire(import.meta.url);

/**
 * Three builds from one source: the website (default), the bundle the desktop app loads
 * (`--mode desktop`, D77) and the one the Android app loads (`--mode android`, D90). The apps
 * have no service worker or web manifest, an output folder each, and
 * `import.meta.env.VITE_PLATFORM` set to 'desktop' or 'android' (src/lib/platform.ts).
 */
export default defineConfig(({ mode }) => {
  const platform = mode === 'desktop' || mode === 'android' ? mode : 'web';
  const app = platform !== 'web';
  return {
    resolve: {
      alias: [
        // Paged.js 0.4.3 (D34) runs inside the book preview iframe; its package exports hide dist/.
        { find: /^pagedjs-polyfill(?=\?|$)/, replacement: join(dirname(dirname(require.resolve('pagedjs'))), 'dist', 'paged.polyfill.min.js') },
        ...(app ? [{ find: /^virtual:pwa-register\/react$/, replacement: fileURLToPath(new URL('src/desktop/no-service-worker.ts', import.meta.url)) }] : []),
      ],
    },
    define: {
      // The apps' version lives in apps/desktop/package.json (tauri.conf.json reads it too).
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(app ? desktopPkg.version : pkg.version),
      'import.meta.env.VITE_PLATFORM': JSON.stringify(platform),
    },
    plugins: [
      react(),
      !app &&
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
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
            cleanupOutdatedCaches: true,
          },
        }),
    ],
    // The desktop app's dev window loads port 5174 (apps/desktop/src-tauri/tauri.conf.json), the
    // Android app's port 5175 (tauri.android.conf.json).
    server: {
      ...(platform === 'desktop' ? { port: 5174, strictPort: true } : {}),
      // `npx tauri android dev` loads it from the phone, over the network (TAURI_DEV_HOST).
      ...(platform === 'android' ? { port: 5175, strictPort: true, host: process.env.TAURI_DEV_HOST || false } : {}),
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      ...(app ? { outDir: `dist-${platform}` } : {}),
    },
  };
});
