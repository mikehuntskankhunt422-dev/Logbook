import { defineConfig } from 'vitest/config';

/** Golden-PDF tests: real Chromium, real Paged.js, real PDFs. Needs `npx playwright-core install chromium` or CHROMIUM_PATH. */
export default defineConfig({
  test: {
    name: 'server-render',
    environment: 'node',
    include: ['test/**/*.render.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // One Chromium per file is plenty; files run one after another to keep memory flat.
    fileParallelism: false,
  },
});
