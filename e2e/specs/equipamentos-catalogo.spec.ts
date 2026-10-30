/**
 * Aurora — equipamento: família → tipo, chip e etiqueta (reunião 16/10/2026, Fase 3).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Equipamentos: família, tipo, chip e QR', () => {
  test('o cadastro pede a família e depois o nome do catálogo (sem campo de tipo), a foto, o SLA e o chip', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ativos?novo=sim');
    const dialogo = page.getByRole('dialog');
    const familia = dialogo.getByLabel('Família');
    await expect(familia.locator('option', { hasText: 'Suporte à vida' })).toHaveCount(1);
    await expect(familia.locator('option', { hasText: 'Equipamentos de apoio' })).toHaveCount(1);
    // ATV-08 (19/10/2026): não há mais "Tipo do equipamento" — o nome vem do catálogo da família.
    await expect(dialogo.getByLabel('Tipo do equipamento')).toHaveCount(0);
    await expect(dialogo.getByLabel('Nome do equipamento')).toBeDisabled();
    await familia.selectOption({ label: 'Suporte à vida' });
    await expect(dialogo.getByLabel('Nome do equipamento')).toBeEnabled();
    // ATV-07 e ATV-15: a foto (obrigatória) e o SLA do equipamento, ligado por padrão.
    await expect(dialogo.getByLabel(/Foto do equipamento/)).toBeVisible();
    await expect(dialogo.getByLabel('SLA deste equipamento habilitado')).toBeChecked();
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
