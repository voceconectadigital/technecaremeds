/**
 * Aurora — "Gerar relatório" no Painel: Basic/Advanced/Expert (reunião 16/10/2026, Fase 9;
 * indicadores e metas, Fase 1 de 17/10/2026).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Relatórios do Painel', () => {
  test('o diálogo oferece os três modelos; Expert não herda o Basic e esconde o que aguarda definição', async ({
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

    // Basic: o que é ACTIVE vem marcado; o PROVISIONAL vem identificado e desmarcado.
    await expect(d.getByRole('checkbox', { name: /Chamados abertos/ })).toBeChecked();
    await expect(d.getByText('Provisório').first()).toBeVisible();

    // Expert: indicadores sem definição ficam fora do relatório, listados à parte.
    await modelos.getByText('Expert', { exact: true }).click();
    await expect(d.getByText(/aguardando definição — fora do relatório/)).toBeVisible();
    await expect(d.getByRole('checkbox', { name: /Chamados abertos/ })).toHaveCount(0);
    await d.getByRole('button', { name: 'Ver relatório' }).click();
    await expect(d.getByRole('region', { name: 'Prévia do relatório' })).toBeVisible({ timeout: 15_000 });
  });
});
