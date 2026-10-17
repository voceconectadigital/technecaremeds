/**
 * Aurora — abrir solicitação: Cliente → Equipamento → Tipo → Detalhes → Urgência
 * (reunião 16/10/2026, Fase 4).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Solicitações: fluxo simplificado', () => {
  test('sem "Sintoma", com equipamento, os sete tipos e urgência', async ({ comoCoordenadorA: page }) => {
    await page.goto('/solicitacoes/nova');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Abrir solicitação');
    await expect(page.getByLabel('Sintoma')).toHaveCount(0);
    await expect(page.getByLabel('Equipamento')).toBeVisible();
    const tipo = page.getByLabel('Tipo');
    for (const rotulo of [
      'Corretiva',
      'Preventiva',
      'Instrução Técnica',
      'Treinamento',
      'Calibração',
      'Teste de Segurança Elétrica',
      'Qualificação',
    ]) {
      await expect(tipo.locator('option', { hasText: rotulo })).toHaveCount(1);
    }
    await expect(tipo.locator('option')).toHaveCount(7);
    await expect(page.getByLabel('Urgência')).toBeVisible();
  });
});
