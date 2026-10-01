/**
 * Téchne Care — validação da DEMONSTRAÇÃO PÚBLICA.
 *
 *   npm run demo:e2e                                  → contra o build local
 *   DEMO_URL=https://technecaremeds.voceconecta.com.br npm run demo:e2e
 *                                                     → contra o site publicado
 *
 * Separada da suíte principal: aquela sobe API e banco; esta prova justamente
 * que a demonstração vive sem os dois.
 */
import { defineConfig, devices } from '@playwright/test';

const PORTA = 4173;
const publicado = process.env.DEMO_URL;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: publicado ?? `http://localhost:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: publicado
    ? undefined
    : {
        command: 'npm run demo:build && npm run preview:demo --workspace @aurora/web',
        port: PORTA,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
