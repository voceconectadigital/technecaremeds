/**
 * Aurora — ▶ Executar: solicitação → triagem → OS → assistente → check-in →
 * procedimento → preencher OS → peças → fotos → parecer → revisão
 * (reunião 16/10/2026, Fase 5).
 *
 * O arranjo é pela API — o mesmo caminho da tela —; o assistente é pelo
 * navegador, com a localização do aparelho concedida e fixada.
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

test.describe('▶ Executar (assistente da OS)', () => {
  test('a ficha oferece "Executar" e o assistente tem os oito passos', async ({ comoCoordenadorA: page }) => {
    const id = await ordemNova(page, 'OS do assistente — passos');
    await page.goto(`/ordens/${id}`);
    await page.getByRole('button', { name: 'Executar' }).click();
    await expect(page).toHaveURL(new RegExp(`/ordens/${id}/executar`));
    const passos = page.getByRole('navigation', { name: 'Passos da execução' });
    for (const p of [
      'Resumo',
      'Check-in',
      'Procedimento',
      'Preencher OS',
      'Anexos',
      'Parecer final',
      'Revisão',
      'Concluir',
    ]) {
      await expect(passos.getByRole('button', { name: new RegExp(p) })).toBeVisible();
    }
    // A ficha não tem mais a aba Conversa.
    await page.goto(`/ordens/${id}`);
    await expect(page.getByRole('tab', { name: 'Conversa' })).toHaveCount(0);
  });

  test('check-in com a localização do aparelho, OS preenchida e parecer LIBERADO', async ({
    comoCoordenadorA: page,
  }) => {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: -19.9191, longitude: -43.9386, accuracy: 15 });
    const id = await ordemNova(page, 'OS do assistente — fluxo');

    await page.goto(`/ordens/${id}/executar?passo=checkin`);
    await page.getByRole('button', { name: /Fazer check-in com a minha localização/ }).click();
    await expect(page.getByText(/Check-in feito em/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Avançar' }).click(); // procedimento
    await page.getByRole('button', { name: 'Avançar' }).click(); // preencher OS
    const descricao = page.getByLabel('Descrição do serviço');
    await descricao.fill('Troca do sensor e teste funcional.');
    await page.getByLabel('Observações').click(); // o blur grava
    await expect(page.getByRole('radiogroup', { name: 'Origem da peça' })).toBeVisible();

    await page.getByRole('button', { name: 'Avançar' }).click(); // anexos
    await expect(page.getByText('Foto ANTES')).toBeVisible();
    await expect(page.getByText('Foto DEPOIS')).toBeVisible();

    await page.getByRole('button', { name: 'Avançar' }).click(); // parecer
    await page.getByRole('radio', { name: /LIBERADO/ }).check();

    await page.getByRole('button', { name: 'Avançar' }).click(); // revisão
    await expect(page.getByText('Troca do sensor e teste funcional.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('LIBERADO')).toBeVisible();
  });
});
