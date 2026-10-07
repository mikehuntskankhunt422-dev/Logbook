import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'storage-idb',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
