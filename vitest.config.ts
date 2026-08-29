import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aurora/domain': resolve(__dirname, 'packages/domain/src'),
      '@aurora/db/testing/harness': resolve(__dirname, 'packages/db/src/testing/harness'),
      '@aurora/db': resolve(__dirname, 'packages/db/src'),
      '@aurora/events': resolve(__dirname, 'packages/events/src'),
      '@aurora/workers': resolve(__dirname, 'apps/workers/src'),
      '@aurora/config': resolve(__dirname, 'packages/config/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
  },
});
