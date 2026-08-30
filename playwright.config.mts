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
/*
 * O PORTAL SOBE NOUTRA PORTA, e não numa rota da web.
 *
 * São duas aplicações — a SPEC §19 pede navegação, vocabulário e densidade
 * próprios —, e em produção serão dois domínios com dois conjuntos de
 * cabeçalhos. Testá-las no mesmo servidor esconderia justamente o que a
 * separação existe para garantir.
 */
const PORTAL_PORT = 5312;
/*
 * E O APLICATIVO DE CAMPO NUMA TERCEIRA.
 *
 * Ele é a única das três que precisa funcionar com o aparelho no modo avião, e
 * a separação é o que torna o cache do casco possível de raciocinar: o
 * `service worker` guarda o casco DESTA aplicação, sem arrastar as dezesseis
 * telas da aplicação interna junto.
 */
const FIELD_PORT = 5313;

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
      // Portal e campo têm projeto próprio; este cobre a aplicação interna.
      testIgnore: /(portal|campo).*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      /*
       * O PORTAL É TESTADO NUM CELULAR, e não num monitor.
       *
       * A SPEC §19 diz o cenário: "em pé, no corredor". Testá-lo em 1440×900
       * mediria uma tela que quase ninguém usa — e deixaria passar exatamente
       * o que quebra num aparelho estreito.
       */
      name: 'portal',
      testMatch: /portal.*\.spec\.ts$/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${PORTAL_PORT}`,
      },
    },
    {
      /*
       * O APLICATIVO DE CAMPO, TAMBÉM NUM CELULAR — e este DESLIGA A REDE.
       *
       * `context.setOffline(true)` corta a rede no nível do navegador: `fetch`
       * falha, `navigator.onLine` vira falso, e a página se comporta como no
       * subsolo de um hospital. É a diferença entre testar o comportamento
       * offline e testar um simulador dele.
       */
      name: 'campo',
      testMatch: /campo.*\.spec\.ts$/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${FIELD_PORT}`,
      },
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
        // AS DUAS ORIGENS, separadas por vírgula: o portal roda noutra
        // porta, e sem a origem na lista o navegador recusa a chamada e a tela
        // mostra "Failed to fetch" — que foi exatamente o primeiro defeito que
        // o Playwright achou nesta base.
        AURORA_CORS_ORIGINS: `http://localhost:${WEB_PORT},http://localhost:${PORTAL_PORT},http://localhost:${FIELD_PORT}`,
      },
    },
    {
      command: 'npm run e2e:web',
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/v1` },
    },
    {
      command: 'npm run e2e:portal',
      port: PORTAL_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/v1` },
    },
    {
      /*
       * O CAMPO RODA CONTRA A BUILD, e não contra o servidor de desenvolvimento.
       *
       * É a única das três aplicações em que essa diferença importa. O
       * `service worker` — que é o que faz o aplicativo ABRIR sem rede — só é
       * registrado em produção, de propósito: em desenvolvimento ele cacheria
       * módulos que mudam a cada salvamento, e a tela mostraria a versão de dez
       * minutos atrás.
       *
       * Testar o modo avião contra o servidor de desenvolvimento provaria
       * apenas que a base local sobrevive na memória da aba. Recarregar sem
       * rede, que é o caso real — o sistema operacional derrubou o aplicativo
       * no meio do turno —, exige o casco em cache. Contra a build, exige de
       * verdade.
       */
      command: 'npm run e2e:field',
      port: FIELD_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/v1` },
    },
  ],
});
