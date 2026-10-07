import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Dev containers whose preinstalled Chromium differs from Playwright's build (same variable as apps/server).
const chromiumLaunch = process.env.LOGBOOK_CHROMIUM_PATH ? { executablePath: process.env.LOGBOOK_CHROMIUM_PATH } : {};

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
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch } },
    // Preview page counts in the other engines (M2 §5). CI installs them; set LOGBOOK_ALL_BROWSERS=1 locally too.
    ...(process.env.LOGBOOK_ALL_BROWSERS
      ? [
          { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /parity\.spec\.ts/ },
          { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] }, testMatch: /parity\.spec\.ts/ },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The API, with orders stored in a temp folder (D51) and no Lulu, so the tests never reach it.
      command: 'npm run start',
      cwd: '../server',
      url: 'http://127.0.0.1:4242/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        LOCAL_STORAGE: 'on',
        LOCAL_STORAGE_DIR: join(tmpdir(), 'logbook-e2e', 'storage'),
        DATABASE_PATH: join(tmpdir(), 'logbook-e2e', 'orders.sqlite'),
        LULU_SANDBOX_CLIENT_KEY: '',
        LULU_SANDBOX_CLIENT_SECRET: '',
        LOG_LEVEL: 'warn',
      },
    },
  ],
});
