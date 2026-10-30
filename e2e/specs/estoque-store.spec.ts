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

  test('a Store tem as abas Catálogo e Pedidos; sem pedido, a aba Pedidos diz isso', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/store');
    await expect(page.getByRole('tab', { name: 'Catálogo' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Pedidos' }).click();
    await expect(page.getByText('Nenhum pedido ainda')).toBeVisible();
    expect(page.url()).toContain('aba=pedidos');
  });

  test('a gestão do catálogo é só de quem edita o catálogo: o coordenador não vê a aba', async ({
    comoCoordenadorA: page,
  }) => {
    // 23/10/2026: "a Store é uma funcionalidade somente do adm da plataforma". O coordenador compra e
    // acompanha; cadastrar produto, preço e público fica com quem tem inventory.update.
    await page.goto('/store?aba=gerenciar');
    await expect(page.getByRole('tab', { name: 'Catálogo' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Gerenciar catálogo' })).toHaveCount(0);
  });
});
