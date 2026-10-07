import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Dev containers whose preinstalled Chromium differs from Playwright's build (same variable as apps/server).
const chromiumLaunch = process.env.LOGBOOK_CHROMIUM_PATH ? { executablePath: process.env.LOGBOOK_CHROMIUM_PATH } : {};

/**
 * LOGBOOK_E2E_ONLINE=1 runs "Prepare my book" against the real bucket (S3_* or R2_*) and the Lulu
 * sandbox from this environment's variables, by hand only. Otherwise the API keeps orders in a temp
 * folder (D51) and has no Lulu, so the tests never reach either, even where those variables are set.
 */
const online = Boolean(process.env.LOGBOOK_E2E_ONLINE);
const offlineApi = {
  LOCAL_STORAGE: 'on',
  LOCAL_STORAGE_DIR: join(tmpdir(), 'logbook-e2e', 'storage'),
  LULU_SANDBOX_CLIENT_KEY: '',
  LULU_SANDBOX_CLIENT_SECRET: '',
  ...Object.fromEntries(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].map((v) => [v, ''])),
};

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
      command: 'npm run start',
      cwd: '../server',
      url: 'http://127.0.0.1:4242/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...(online ? {} : offlineApi),
        DATABASE_PATH: join(tmpdir(), 'logbook-e2e', online ? 'orders-online.sqlite' : 'orders.sqlite'),
        LOG_LEVEL: online ? 'info' : 'warn',
      },
    },
  ],
});
