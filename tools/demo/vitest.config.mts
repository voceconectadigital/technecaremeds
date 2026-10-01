/**
 * Configuração só da captura da demonstração (`npm run demo:capturar`).
 *
 * Reaproveita os apelidos da configuração da raiz e roda UM arquivo: a captura
 * não é teste de regressão e não entra no `npm test`.
 */
import { defineConfig } from 'vitest/config';
import raiz from '../../vitest.config.mts';

export default defineConfig({
  resolve: raiz.resolve,
  test: {
    include: ['tools/demo/capturar.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    setupFiles: ['./vitest.setup.ts'],
  },
});
