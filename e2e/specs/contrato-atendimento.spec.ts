/**
 * Aurora — contrato que para o atendimento e renovação automática (Anderson, 24/11/2026: D-4, D-7).
 *
 * No navegador, pela ficha do cliente: cria o contrato com término e renovação automática, suspende o
 * atendimento com motivo e confere que a API recusa abrir chamado (409, "somente consulta"); reativa
 * e o chamado volta a abrir. Roda na organização B, com um cliente próprio — a A guarda a massa de
 * que os outros testes dependem.
 */
import { test, expect, E2E, apiUrl, tolera } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordB}:${E2E.emailCoordB}`,
  'x-aurora-organization': E2E.orgB,
};

test.describe('D-4/D-7 · contrato no cadastro do cliente', () => {
  test('renovação automática, suspender (tudo para) e reativar', async ({ comoCoordenadorB: page }) => {
    const nome = `Hospital Contrato E2E ${Date.now()}`;
    const r = await page.request.post(`${apiUrl()}/customers`, { headers: cab, data: { name: nome } });
    expect(r.ok()).toBe(true);
    const { id: cliente } = await r.json();

    await page.goto(`/clientes/${cliente}`);
    await page.getByRole('button', { name: 'Novo contrato' }).click();
    const d = page.getByRole('dialog', { name: new RegExp(`Novo contrato — ${nome}`) });
    const hoje = new Date();
    const fim = `${hoje.getFullYear() + 1}-12-31`;
    const inicio = `${hoje.getFullYear()}-01-01`;
    await d.getByLabel('Início', { exact: true }).fill(inicio);
    // Sem término, a renovação automática não existe (prazo indeterminado não tem ciclo).
    await d.getByLabel('Fim', { exact: true }).fill('');
    await expect(d.getByLabel(/Renovação automática/)).toBeDisabled();
    await d.getByLabel('Fim', { exact: true }).fill(fim);
    await d.getByLabel(/Renovação automática/).check();
    await d.getByLabel(/Ativar agora/).check();
    await d.getByRole('button', { name: 'Salvar' }).click();
    await expect(d).toBeHidden({ timeout: 15_000 });

    const linha = page.locator('[data-testid^="contrato-CT-"]').first();
    await expect(linha.getByText('Vigente')).toBeVisible({ timeout: 15_000 });
    await expect(linha.getByText('Renovação automática')).toBeVisible();

    // Suspender pede motivo.
    await linha.getByRole('button', { name: 'Suspender atendimento' }).click();
    const s = page.getByRole('dialog', { name: /Suspender o atendimento/ });
    await expect(s.getByRole('button', { name: 'Suspender' })).toBeDisabled();
    await s.getByLabel(/Motivo/).fill('Inadimplência do mês — teste E2E');
    await s.getByRole('button', { name: 'Suspender' }).click();
    await expect(s).toBeHidden({ timeout: 15_000 });
    await expect(linha.getByRole('status')).toContainText(/somente consulta/);

    // Na API, e não só na tela: abrir chamado é recusado com o motivo.
    tolera(page, /status of 409/i);
    const recusado = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: cliente, summary: 'Chamado durante a suspensão', source: 'phone' },
    });
    expect(recusado.status()).toBe(409);
    expect((await recusado.json()).message).toMatch(/Inadimplência do mês/);

    // Reativar devolve o atendimento.
    await linha.getByRole('button', { name: 'Reativar atendimento' }).click();
    const reativar = page.getByRole('dialog', { name: /Reativar o atendimento/ });
    await reativar.getByRole('button', { name: 'Reativar' }).click();
    await expect(reativar).toBeHidden({ timeout: 15_000 });
    await expect(linha.getByRole('button', { name: 'Suspender atendimento' })).toBeVisible({
      timeout: 15_000,
    });
    const aceito = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: cliente, summary: 'Chamado depois da reativação', source: 'phone' },
    });
    expect(aceito.status()).toBe(201);
  });
});
