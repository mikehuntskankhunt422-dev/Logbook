import { defineProject } from 'vitest/config';

// Unit tests only. e2e/ drives the real app through WebDriver with Node's test runner (`npm run test:e2e`).
export default defineProject({
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
  },
});
