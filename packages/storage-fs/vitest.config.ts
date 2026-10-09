import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'storage-fs',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
