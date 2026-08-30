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
  '@aurora/app-kit': resolve(raiz, 'packages/app-kit/src'),
  '@aurora/web': resolve(raiz, 'apps/web/src'),
};

/**
 * O que roda no navegador de mentira.
 *
 * `apps/field` NÃO está aqui, e a ausência é deliberada.
 *
 * A entrada existia por antecipação, antes de o aplicativo de campo ter uma
 * linha escrita. Hoje ele tem quatro suítes, e nenhuma toca o DOM: a fila, a
 * sincronização, o envio de anexos e a conformidade da porta de persistência são
 * lógica pura. Montar um DOM falso para elas custa tempo em toda execução e não
 * prova nada.
 *
 * E uma delas não apenas dispensa o DOM: ela é INCOMPATÍVEL com ele. A
 * conformidade exercita o adaptador de SQLite contra `node:sqlite`, e o ambiente
 * de cliente recusa empacotar módulo interno do Node — "Cannot bundle Node.js
 * built-in". Nesta máquina passava; na integração contínua, não. A CI está
 * certa: um teste que usa módulo interno do Node é um teste de Node.
 *
 * A parte que precisa mesmo de navegador — o IndexedDB — é conferida no
 * navegador de verdade, pela tela de diagnóstico do aparelho, e o teste de ponta
 * a ponta exige que ela passe.
 *
 * Quando existir teste de COMPONENTE do campo, ele entra aqui com um padrão
 * próprio — e não devolvendo a pasta inteira para o jsdom.
 */
const INTERFACE = [
  'packages/ui/**/*.test.{ts,tsx}',
  'apps/web/**/*.test.{ts,tsx}',
  'apps/portal/**/*.test.{ts,tsx}',
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
