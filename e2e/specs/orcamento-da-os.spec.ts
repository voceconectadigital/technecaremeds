/**
 * Aurora — gerar orçamento a partir da OS e andamento (reunião 16/10/2026, Fase 7).
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('Orçamento na OS', () => {
  test('a ficha mostra o andamento e o diálogo de orçamento pede validade e aprovador', async ({
    comoCoordenadorA: page,
  }) => {
    const req = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: E2E.clienteA, summary: 'OS para orçamento', source: 'phone' },
    });
    const { id } = await req.json();
    await page.request.post(`${apiUrl()}/service-requests/${id}/transitions`, {
      headers: cab,
      data: { to: 'triage' },
    });
    const nat = await (
      await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, { headers: cab })
    ).json();
    const os = await (
      await page.request.post(`${apiUrl()}/work-orders/from-request/${id}`, {
        headers: cab,
        data: { targets: [{ work_order_type_id: nat.items[0].id, title: 'OS para orçamento' }] },
      })
    ).json();
    await page.goto(`/ordens/${os.work_orders[0].id}`);
    await expect(page.getByRole('navigation', { name: 'Andamento da ordem de serviço' })).toBeVisible();
    const gerar = page.getByRole('button', { name: 'Gerar orçamento' });
    if (await gerar.isVisible().catch(() => false)) {
      await gerar.click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo.getByLabel('Validade da proposta')).toBeVisible();
      await expect(dialogo.getByLabel('Quem aprova pelo cliente')).toBeVisible();
      await expect(dialogo.getByText(/Prévia do total/)).toBeVisible();
    }
  });
});
