import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Aurora — configuração dos testes.
 *
 * DOIS PROJETOS, E A SEPARAÇÃO É DELIBERADA
 *
 * O Vitest 3 removeu `environmentMatchGlobs`, e a substituição — projetos
 * declarados — acabou sendo melhor do que o que havia antes: agora está
 * ESCRITO quem roda em Node e quem roda em jsdom, em vez de deduzido de uma
 * lista de padrões no meio da configuração.
 *
 * A separação não é estética. Montar um DOM falso para testar SQL custa tempo
 * em cada um dos mil e trezentos testes de banco e não prova nada; e rodar um
 * teste de componente em Node puro falha com "document is not defined" por um
 * motivo que não tem relação com o componente.
 */
// ESM de verdade: o Vite 8 avisa quando um .ts com sintaxe de módulo é
// carregado como CommonJS, e esse carregador vai virar o padrão.
const raiz = dirname(fileURLToPath(import.meta.url));

const alias = {
  '@aurora/domain': resolve(raiz, 'packages/domain/src'),
  '@aurora/db/testing/harness': resolve(raiz, 'packages/db/src/testing/harness'),
  '@aurora/db': resolve(raiz, 'packages/db/src'),
  '@aurora/events': resolve(raiz, 'packages/events/src'),
  '@aurora/workers': resolve(raiz, 'apps/workers/src'),
  '@aurora/config': resolve(raiz, 'packages/config/src'),
  '@aurora/contracts': resolve(raiz, 'packages/contracts/src'),
  '@aurora/ui': resolve(raiz, 'packages/ui/src'),
  '@aurora/web': resolve(raiz, 'apps/web/src'),
};

/** O que roda no navegador de mentira. */
const INTERFACE = [
  'packages/ui/**/*.test.{ts,tsx}',
  'apps/web/**/*.test.{ts,tsx}',
  'apps/portal/**/*.test.{ts,tsx}',
  'apps/field/**/*.test.{ts,tsx}',
];

const comum = {
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // `forks` e não `threads`: o PGlite carrega um WebAssembly por suíte, e
  // compartilhar thread entre suítes fazia uma vazar estado na outra.
  pool: 'forks' as const,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          ...comum,
          name: 'node',
          environment: 'node',
          include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', ...INTERFACE],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          ...comum,
          name: 'interface',
          environment: 'jsdom',
          include: INTERFACE,
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: ['./vitest.setup.ts', './vitest.setup.dom.ts'],
        },
      },
    ],
  },
});
