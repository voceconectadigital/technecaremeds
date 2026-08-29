import { defineConfig, devices } from '@playwright/test';

/**
 * Aurora — testes de ponta a ponta (SPEC v0.2 §40).
 *
 * O QUE ESTES TESTES SÃO, E O QUE NÃO SÃO
 *
 * Eles exercitam o COMPORTAMENTO VISÍVEL: o que a pessoa vê, clica e recebe de
 * volta, contra a API de verdade e um PostgreSQL de verdade. Não espiam estado
 * interno, não chamam função de domínio, não conferem chamada de rede — isso
 * já é coberto pelas 1.392 provas de unidade e de HTTP, e repetir aqui só
 * tornaria o teste frágil sem provar nada novo.
 *
 * O que só o navegador prova: que a tela monta, que o clique chega, que o erro
 * aparece onde a pessoa olha, e que o isolamento entre organizações vale
 * também depois de passar por roteador, cache e sessão do navegador.
 *
 * BANCO PRÓPRIO. `aurora_e2e`, separado do de desenvolvimento: um teste que
 * apaga dado não pode apagar o dado com que alguém está trabalhando.
 */
const DATABASE_URL =
  process.env.AURORA_E2E_DATABASE_URL ??
  'postgres://aurora_e2e_api:e2e_local_only_2026@localhost:15432/aurora_e2e';

const API_PORT = 3311;
const WEB_PORT = 5311;

export default defineConfig({
  testDir: './e2e/specs',
  // Estado conhecido antes de tudo: sem isto, registros de uma execução
  // sobrevivem para a seguinte e o teste passa a olhar dado de ontem.
  globalSetup: './e2e/fixtures/global-setup.mts',
  // Um teste de ponta a ponta que passa às vezes é pior que nenhum: ele
  // ensina a equipe a reexecutar em vez de investigar.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Nova tentativa só na integração contínua, onde a lentidão da máquina é
  // real. Localmente, um teste instável precisa doer para ser consertado.
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Rastreio na primeira repetição e captura só quando falha: guardar vídeo
    // de tudo enche o disco e ninguém assiste.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: [
    {
      command: 'npm run e2e:api',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        NODE_ENV: 'test',
        AURORA_PORT: String(API_PORT),
        AURORA_LOG_LEVEL: 'error',
        AURORA_AUTH_PROVIDER: 'local',
        // O papel de aplicação é o de produção: medir com superusuário mediria
        // um sistema sem RLS, que não é o nosso.
        AURORA_DB_APP_ROLE: 'aurora_app',
        // A interface roda noutra porta: sem a origem na lista, o navegador
        // recusa a chamada e a tela mostra "Failed to fetch".
        AURORA_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: 'npm run e2e:web',
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/v1` },
    },
  ],
});
