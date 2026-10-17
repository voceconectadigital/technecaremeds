/**
 * Aurora — equipamento: família → tipo, chip e etiqueta (reunião 16/10/2026, Fase 3).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Equipamentos: família, tipo, chip e QR', () => {
  test('o cadastro pede família e depois o tipo, e tem o bloco do chip', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ativos?novo=sim');
    const dialogo = page.getByRole('dialog');
    const familia = dialogo.getByLabel('Família');
    await expect(familia.locator('option', { hasText: 'Suporte à vida' })).toHaveCount(1);
    await expect(familia.locator('option', { hasText: 'Equipamentos de apoio' })).toHaveCount(1);
    await expect(dialogo.getByLabel('Tipo do equipamento')).toBeDisabled();
    await familia.selectOption({ label: 'Suporte à vida' });
    await expect(dialogo.getByLabel('Tipo do equipamento')).toBeEnabled();
    await expect(dialogo.getByLabel('Tipo de identificação')).toBeVisible();
    await expect(dialogo.getByLabel('Identificador do chip')).toBeVisible();
  });

  test('a lista filtra por família e por chip pela URL', async ({ comoCoordenadorA: page }) => {
    await page.goto('/ativos?chip=yes');
    await expect(page.getByLabel('Chip de localização')).toHaveValue('yes');
    await page.getByLabel('Família').selectOption({ label: 'Suporte à vida' });
    await expect(page).toHaveURL(/familia=life_support/);
  });
});
