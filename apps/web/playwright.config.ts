import { defineConfig, devices } from '@playwright/test';

/** E2E runs against the production build (vite preview) so the service worker and offline mode are real. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The print render server, for the "make print PDFs" test. Uses Playwright's Chromium (or CHROMIUM_PATH).
      command: 'node --experimental-strip-types --no-warnings ../server/src/main.ts',
      url: 'http://localhost:8787/health',
      env: { PORT: '8787', WEB_ORIGINS: 'http://localhost:4173' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
