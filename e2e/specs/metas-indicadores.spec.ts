/**
 * Aurora — metas dos indicadores (Fase 1 de indicadores, 17/10/2026).
 *
 * A coordenação lê as metas, mas não as configura: `insight.manage_targets` é do
 * gestor e do administrador. Quem nega é o servidor (testes de API); aqui se
 * prova que a tela não oferece o que a pessoa não pode fazer — e que, sem meta
 * configurada, ela diz isso em vez de mostrar zero.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Metas dos indicadores', () => {
  test('a coordenação vê os indicadores sem meta e não vê "Nova meta"', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/configuracoes/metas');
    await expect(page.getByRole('heading', { name: 'Metas dos indicadores' })).toBeVisible();
    await expect(page.getByText('Somente leitura: configurar metas é da gestão.')).toBeVisible();
    await expect(page.getByText('Sem meta').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova meta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar' })).toHaveCount(0);
  });
});
