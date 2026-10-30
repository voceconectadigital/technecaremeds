/**
 * Aurora — ordens de serviço: itens da auditoria de 29/10/2026, pelo navegador.
 *
 *   · OS-01 — a Lista tem a aba "Negados", separada das ordens;
 *   · OS-20 · OS-26 — "Imprimir OS" abre a folha completa e chama a impressão; a ficha não tem
 *     mais o Imprimir genérico, que levava só a aba aberta;
 *   · OS-17 — no assistente, "Concluir" fica desabilitado e diz o que falta; preenchido, conclui
 *     e devolve à ficha;
 *   · OS-12 — o passo Anexos pergunta "Há anexos?" e deixa seguir sem anexo.
 *
 * O arranjo é pela API (o mesmo caminho da tela); a verificação é pelo navegador.
 */
import type { Page } from '@playwright/test';
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

async function ordemNova(page: Page, titulo: string): Promise<string> {
  const req = await page.request.post(`${apiUrl()}/service-requests`, {
    headers: cab,
    data: { customer_id: E2E.clienteA, summary: titulo, source: 'phone', requested_type: 'corrective' },
  });
  const { id } = await req.json();
  await page.request.post(`${apiUrl()}/service-requests/${id}/transitions`, {
    headers: cab,
    data: { to: 'triage' },
  });
  const naturezas = await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, { headers: cab });
  const { items } = await naturezas.json();
  const os = await page.request.post(`${apiUrl()}/work-orders/from-request/${id}`, {
    headers: cab,
    data: { targets: [{ work_order_type_id: items[0].id, title: titulo }] },
  });
  expect(os.ok()).toBe(true);
  const corpo = await os.json();
  return (corpo.work_orders?.[0]?.id ?? corpo.items?.[0]?.id ?? corpo.id) as string;
}

test.describe('OS — auditoria de 29/10/2026', () => {
  test('OS-01: a aba "Negados" mostra a OS negada, e "Todas" não a mistura', async ({
    comoCoordenadorA: page,
  }) => {
    const titulo = `Negado na triagem ${Date.now()}`;
    const id = await ordemNova(page, titulo);
    const negar = await page.request.post(`${apiUrl()}/work-orders/${id}/transitions`, {
      headers: cab,
      data: { to: 'denied', cancellation_reason: 'Equipamento fora da cobertura do contrato' },
    });
    expect(negar.ok()).toBe(true);

    await page.goto('/ordens?vista=lista&categoria=negados');
    await expect(page.getByRole('tab', { name: 'Negados' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(titulo)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Todas' }).click();
    await expect(page.getByRole('tab', { name: 'Todas' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(titulo)).toHaveCount(0);
  });

  test('OS-20 · OS-26: "Imprimir OS" abre a folha completa e chama a impressão', async ({
    comoCoordenadorA: page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __impressoes: number }).__impressoes = 0;
      window.print = () => {
        (window as unknown as { __impressoes: number }).__impressoes += 1;
      };
    });
    const id = await ordemNova(page, `OS para imprimir ${Date.now()}`);
    await page.request.post(`${apiUrl()}/work-orders/${id}/transitions`, {
      headers: cab,
      data: { to: 'in_progress' },
    });
    await page.request.patch(`${apiUrl()}/work-orders/${id}/service-report`, {
      headers: cab,
      data: { service_description: 'Troca do cabo de força e teste.', service_observations: 'Sem obs.' },
    });

    await page.goto(`/ordens/${id}`);
    // O Imprimir genérico da moldura não está na ficha: imprimiria só a aba aberta.
    await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Imprimir OS' }).click();

    await expect(page).toHaveURL(/modo=impressao/);
    const folha = page.getByTestId('folha-de-impressao');
    await expect(folha).toBeVisible({ timeout: 15_000 });
    await expect(folha.getByRole('heading', { name: 'Dados técnicos' })).toBeVisible();
    await expect(folha.getByRole('heading', { name: 'Serviço executado' })).toBeVisible();
    await expect(folha).toContainText('Troca do cabo de força e teste.');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes))
      .toBe(1);

    await page.getByRole('button', { name: 'Voltar à ficha' }).click();
    await expect(page.getByRole('tab', { name: 'Resumo' })).toBeVisible();
  });

  test('OS-17 · OS-12: Concluir só habilita sem pendência; Anexos deixa seguir sem anexo', async ({
    comoCoordenadorA: page,
  }) => {
    const id = await ordemNova(page, `OS do Concluir ${Date.now()}`);
    await page.request.post(`${apiUrl()}/work-orders/${id}/transitions`, {
      headers: cab,
      data: { to: 'in_progress' },
    });

    await page.goto(`/ordens/${id}/executar?passo=anexos`);
    await expect(page.getByRole('radiogroup', { name: 'Há anexos para esta OS?' })).toBeVisible();
    await page.getByLabel('Não, seguir sem anexo').check();
    await expect(page.getByText(/Sem anexos nesta OS/)).toBeVisible();

    await page.goto(`/ordens/${id}/executar?passo=concluir`);
    const concluir = page.getByRole('button', { name: 'Concluir ordem de serviço' });
    await expect(concluir).toBeDisabled();
    await expect(page.getByRole('list', { name: 'O que falta para concluir' })).toContainText(
      'Descrição do serviço'
    );

    await page.request.patch(`${apiUrl()}/work-orders/${id}/service-report`, {
      headers: cab,
      data: { service_description: 'Troca do fusível e teste funcional.' },
    });
    await page.reload();
    await expect(concluir).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/Pode concluir/)).toBeVisible();
    await concluir.click();
    await expect(page).toHaveURL(new RegExp(`/ordens/${id}$`), { timeout: 20_000 });

    const os = await (await page.request.get(`${apiUrl()}/work-orders/${id}`, { headers: cab })).json();
    expect(os.status_category).toBe('review');
    expect(os.resolution).toContain('fusível');
  });
});
