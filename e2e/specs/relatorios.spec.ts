/**
 * Aurora — "Gerar relatório" no Painel: fundação Basic/Advanced/Expert (reunião 16/10/2026, Fase 9).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Relatórios do Painel', () => {
  test('o diálogo oferece os três modelos e marca o que aguarda o modelo oficial', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/painel');
    await page.getByRole('button', { name: 'Gerar relatório' }).click();
    const d = page.getByRole('dialog');
    const modelos = d.getByRole('radiogroup', { name: 'Modelo de relatório' });
    for (const m of ['Basic', 'Advanced', 'Expert']) {
      await expect(modelos.getByText(m, { exact: true })).toBeVisible();
    }
    await expect(d.getByText(/AGUARDANDO MODELO PDF OFICIAL/).first()).toBeVisible();
    await modelos.getByText('Expert', { exact: true }).click();
    await expect(d.getByText('Aguardando modelo').first()).toBeVisible();
    await d.getByRole('button', { name: 'Ver relatório' }).click();
    await expect(d.getByRole('region', { name: 'Prévia do relatório' })).toBeVisible({ timeout: 15_000 });
  });
});
