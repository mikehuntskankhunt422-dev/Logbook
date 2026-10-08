import { defineConfig } from 'vitest/config';

/** Renders the sample books in Chromium and checks the PDFs. Needs a browser; run by the CI `print` job. */
export default defineConfig({
  test: {
    name: 'print',
    environment: 'node',
    include: ['test/**/*.golden.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
