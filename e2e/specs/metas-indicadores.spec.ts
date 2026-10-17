/**
 * Aurora — metas dos indicadores (Fase 1 de indicadores, 17/10/2026).
 *
 * A persona `comoCoordenadorA` tem o papel de administrador (ver `seed.mjs`), então
 * configura metas. O recorte por papel (gestor × operador × solicitante) e o
 * isolamento entre organizações são provados nos testes de API
 * (`api-metas-indicadores.test.ts`); aqui se prova o caminho da tela: sem meta
 * a página diz "Sem meta", e a meta criada aparece como ativa.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Metas dos indicadores', () => {
  test('sem meta configurada a tela diz isso; criar a meta da organização a deixa ativa', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/configuracoes/metas');
    await expect(page.getByRole('heading', { name: 'Metas dos indicadores' })).toBeVisible();
    await expect(page.getByText('Sem meta').first()).toBeVisible();

    await page.getByRole('button', { name: 'Nova meta' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Indicador').selectOption({ label: 'SLA' });
    await d.getByLabel('Meta (%)', { exact: true }).fill('90');
    await d.getByRole('button', { name: 'Salvar meta' }).click();

    await expect(page.getByText('Meta ativa')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/≥ 90 %/)).toBeVisible();
  });
});
