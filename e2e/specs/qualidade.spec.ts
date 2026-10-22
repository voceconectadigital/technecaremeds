/**
 * Aurora — Qualidade: o lugar dos certificados, no navegador (conversa com o cliente, 21/10/2026).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Qualidade · certificados', () => {
  test('o menu leva a Qualidade, com as quatro abas de tipo', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Qualidade' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Qualidade');
    for (const aba of ['Todos', 'Calibração', 'Segurança elétrica', 'Qualificação', 'Treinamento']) {
      await expect(page.getByRole('tab', { name: aba })).toBeVisible();
    }
  });

  test('cadastra um certificado de calibração vencido, anexa o PDF e o arquivo fica disponível', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/qualidade');
    await page.getByRole('button', { name: 'Novo certificado' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Novo certificado' });
    await dialogo.getByLabel('Título').fill('Calibração do ventilador e2e');
    await dialogo.getByLabel('Cliente').selectOption({ index: 1 });
    await dialogo.getByLabel('Número do certificado').fill('CAL-E2E-1');
    await dialogo.getByLabel('Emitido em').fill('2024-01-10');
    await dialogo.getByLabel('Válido até').fill('2025-01-10');
    await dialogo.getByLabel('Arquivo do certificado').setInputFiles({
      name: 'certificado.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    await dialogo.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page.getByText('Certificado cadastrado')).toBeVisible();

    const cartao = page.getByRole('listitem').filter({ hasText: 'Calibração do ventilador e2e' });
    await expect(cartao).toContainText('Vencido');
    await expect(cartao).toContainText('Venceu há');
    await expect(cartao.getByRole('button', { name: 'Baixar arquivo' })).toBeVisible();
    // Os vencidos abrem a lista, e a faixa de aviso diz quantos são.
    await expect(page.getByRole('status')).toContainText('vencido');
  });

  test('treinamento é de pessoa: pede o nome de quem foi treinado', async ({ comoCoordenadorA: page }) => {
    await page.goto('/qualidade?tipo=training');
    await page.getByRole('button', { name: 'Novo certificado' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Novo certificado' });
    await expect(dialogo.getByLabel('Quem foi treinado')).toBeVisible();
    await dialogo.getByLabel('Título').fill('Uso seguro do desfibrilador');
    await dialogo.getByLabel('Emitido em').fill('2026-05-01');
    await dialogo.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(dialogo.getByText('Informe quem foi treinado.')).toBeVisible();
  });
});
