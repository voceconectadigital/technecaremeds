/**
 * Aurora — entrar no aplicativo de campo PELA TELA.
 *
 * O resto da suíte do campo grava a sessão no armazenamento antes de abrir a
 * página, e foi exatamente isso que escondeu dois defeitos:
 *
 *   1. a primeira sincronização disparava na tela de entrar, sem sessão, e
 *      levava 401 da API;
 *   2. depois de entrar, ninguém sincronizava — só o relógio de um minuto —, e
 *      o técnico via o dia vazio logo depois do login.
 *
 * Este caso faz o caminho de quem acabou de instalar: abre sem sessão, entra
 * pelo formulário e exige o dia no aparelho bem antes do relógio. A API da
 * suíte roda no modo `local` (e-mail e organização, sem senha); o formulário
 * com senha é coberto pelos testes de componente da tela.
 */
import { test, expect } from '@playwright/test';
import { E2E } from '../fixtures/aurora';

test.describe('CAMPO · entrar pela tela', () => {
  test('sem sessão não chama a API do dia; depois de entrar, o dia chega na hora', async ({ page }) => {
    const erros: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') erros.push(m.text());
    });
    page.on('pageerror', (e) => erros.push(`exceção não capturada: ${e.message}`));
    const pedidosDoDia: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/field/sync')) pedidosDoDia.push(r.url());
    });

    await page.goto('/entrar');
    await expect(page.getByLabel('Organização')).toBeVisible({ timeout: 20_000 });
    // Tempo para o provedor abrir a base e, no defeito antigo, disparar a sincronização.
    await page.waitForTimeout(2_000);
    expect(pedidosDoDia, 'sincronizou sem sessão').toEqual([]);

    await page.getByLabel('Seu e-mail').fill(E2E.emailTecA);
    await page.getByLabel('Organização').fill(E2E.orgA);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible({ timeout: 20_000 });
    // Bem antes do relógio de um minuto: quem trouxe o dia foi a entrada.
    await expect(page.getByText('Ventilador não pressuriza')).toBeVisible({ timeout: 15_000 });
    expect(pedidosDoDia.length).toBeGreaterThan(0);
    expect(erros, 'o navegador reclamou durante a entrada').toEqual([]);
  });
});
