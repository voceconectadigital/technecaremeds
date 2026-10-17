/**
 * Aurora — estoque interno (gestão) × Store (reunião 16/10/2026, Fase 8).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Estoque e Store', () => {
  test('a aba Gestão do estoque tem ações, período e relatório', async ({ comoCoordenadorA: page }) => {
    await page.goto('/estoque?aba=gestao');
    await expect(page.getByRole('group', { name: 'Período' })).toBeVisible();
    await expect(page.getByText('Movimentação do período')).toBeVisible({ timeout: 15_000 });
  });

  test('a Store é um item próprio do menu e não mostra saldo', async ({ comoCoordenadorA: page }) => {
    await page.goto('/store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Store');
    await expect(page.getByText(/Disponível|em estoque|saldo/i)).toHaveCount(0);
  });
});
