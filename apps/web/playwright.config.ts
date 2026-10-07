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
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
