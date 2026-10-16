/**
 * Aurora — cliente EAS × empresa corporativa e edição (reunião 16/10/2026, Fase 2).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Clientes: classificação e edição', () => {
  test('cadastra uma empresa corporativa e a lista mostra a classificação', async ({
    comoCoordenadorA: page,
  }) => {
    const nome = `EngClin ${Date.now()}`;
    await page.goto('/clientes?novo=sim');
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nome', { exact: true }).fill(nome);
    await dialogo.getByRole('radio', { name: /Empresa corporativa/ }).check();
    await dialogo.getByLabel('Subtipo').selectOption('engenharia_clinica');
    await dialogo.getByRole('button', { name: 'Cadastrar cliente' }).click();
    // Pode haver a oferta da primeira unidade: recusa-se.
    const agoraNao = page.getByRole('button', { name: 'Agora não' });
    if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click();
    await expect(page.getByText(nome)).toBeVisible();
    await expect(page.getByText(/Empresa corporativa · Engenharia clínica/).first()).toBeVisible();
  });

  test('o formulário separa EAS de empresa corporativa e troca os subtipos', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/clientes?novo=sim');
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('radiogroup', { name: 'Classificação do cliente' })).toBeVisible();
    await expect(dialogo.getByLabel('Subtipo').locator('option', { hasText: 'Hospital' })).toHaveCount(1);
    await dialogo.getByRole('radio', { name: /Empresa corporativa/ }).check();
    await expect(dialogo.getByLabel('Subtipo').locator('option', { hasText: 'Hospital' })).toHaveCount(0);
    await expect(
      dialogo.getByLabel('Subtipo').locator('option', { hasText: 'Assistência técnica' })
    ).toHaveCount(1);
  });
});
