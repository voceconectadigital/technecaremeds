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
      '@aurora/contracts': resolve(__dirname, 'packages/contracts/src'),
      '@aurora/ui': resolve(__dirname, 'packages/ui/src'),
      '@aurora/web': resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.tsx'],
    /*
     * Só a interface roda em jsdom. O resto roda em Node de verdade: montar um
     * DOM falso para testar SQL custa tempo em cada um dos mil e trezentos
     * testes de banco, e não prova nada.
     */
    environmentMatchGlobs: [
      ['packages/ui/**', 'jsdom'],
      ['apps/web/**', 'jsdom'],
      ['apps/portal/**', 'jsdom'],
      ['apps/field/**', 'jsdom'],
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts', './vitest.setup.dom.ts'],
  },
});
