/**
 * Aurora — planos: tipo + cliente + setor e ▶ Executar (reunião 16/10/2026, Fase 6).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Planos: filtros e Executar', () => {
  test('o filtro de tipo existe nas duas abas e vai para a URL', async ({ comoCoordenadorA: page }) => {
    await page.goto('/planos');
    const grupo = page.getByRole('group', { name: 'Filtros dos planos' });
    await grupo.getByLabel('Tipo').selectOption('calibration');
    await expect(page).toHaveURL(/tipo=calibration/);
    await page.getByRole('tab', { name: 'Cronograma' }).click();
    await expect(page.getByRole('group', { name: 'Filtros dos planos' }).getByLabel('Tipo')).toHaveValue(
      'calibration'
    );
  });
});
