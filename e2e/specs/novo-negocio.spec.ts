/**
 * Aurora — "Novo Negócio" no navegador (reunião 16/10/2026, Fase 11).
 *
 * Admin de UMA organização não é admin da plataforma: a página explica e não
 * lista organização nenhuma, e o atalho não aparece no alternador. O caminho
 * do admin global (criar, listar, isolar) é coberto em api-novo-negocio.test.
 */
import { test, expect } from '../fixtures/aurora';

test('Fase 11 · admin de organização não vê nem cria negócios', async ({ comoCoordenadorA: page }) => {
  await page.goto('/configuracoes/negocios');
  await expect(page.getByText('Exclusivo do admin global de plataforma')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo negócio' })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Configurações' }).getByRole('link', { name: 'Novo negócio' })
  ).toHaveCount(0);
});
