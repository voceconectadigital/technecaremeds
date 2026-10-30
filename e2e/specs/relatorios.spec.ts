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
    // REL-08: nenhum modelo diz mais "aguardando modelo"; PDF e Excel com o nome do nível.
    await expect(d.getByText(/AGUARDANDO MODELO PDF OFICIAL/)).toHaveCount(0);
    await expect(d.getByRole('button', { name: 'Baixar PDF' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Baixar Excel' })).toBeVisible();
    // REL-16: o cartão do Expert não cita o órgão nem promete indicador que não é calculado.
    await expect(modelos.getByText(/FHEMIG/)).toHaveCount(0);
    await expect(modelos.getByText(/previstos, \d+ com cálculo hoje/)).toBeVisible();

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

test.describe('Gerador de relatório: página própria, filtros e atalho para automação (29/10/2026)', () => {
  test('REL-03: /relatorios abre o gerador com setor, tipo de manutenção e família/tipo de equipamento', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/relatorios');
    const d = page.getByRole('dialog');
    await expect(d.getByRole('radiogroup', { name: 'Modelo de relatório' })).toBeVisible();
    await expect(d.getByLabel('Setor')).toBeVisible();
    await expect(d.getByLabel('Família / tipo de equipamento')).toBeVisible();
    const tipo = d.getByLabel('Tipo de manutenção');
    await expect(tipo.locator('option')).toHaveCount(8); // "Todos os tipos" + os sete
    await tipo.selectOption('corrective');
    await d.getByRole('button', { name: 'Ver relatório' }).click();
    await expect(d.getByRole('region', { name: 'Prévia do relatório' })).toBeVisible({ timeout: 15_000 });
  });

  test('REL-15: "Criar automação com estes filtros" abre a Nova automação já preenchida', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/painel');
    await page.getByRole('button', { name: 'Gerar relatório' }).click();
    const d = page.getByRole('dialog');
    const atalho = d.getByRole('button', { name: 'Criar automação com estes filtros' });
    // Só aparece para quem cria automação.
    test.skip((await atalho.count()) === 0, 'o perfil do E2E não cria automação');
    await d.getByLabel('Tipo de manutenção').selectOption('preventive');
    await atalho.click();
    const nova = page.getByRole('dialog', { name: 'Nova automação' });
    await expect(nova).toBeVisible();
    await expect(nova.getByRole('radio', { name: /Relatório agendado/ })).toBeChecked();
    await expect(nova.getByRole('note', { name: 'Filtros vindos do relatório' })).toContainText(
      'tipo de manutenção'
    );
    await expect(nova.getByLabel('Nome da automação')).toHaveValue(/^Relatório Basic/);
  });

  test('REL-14: o Painel mostra o cartão da avaliação das OS', async ({ comoCoordenadorA: page }) => {
    await page.goto('/painel');
    await expect(page.getByText('Avaliação das OS')).toBeVisible({ timeout: 15_000 });
  });
});
