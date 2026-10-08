import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Golden-PDF tests need Chromium; they run with `npm run test:render` (vitest.render.config.ts).
    exclude: ['test/**/*.render.test.ts'],
  },
});
