/**
 * Aurora — logomarcas da organização (Anderson, 06/11/2026), pelo navegador.
 *
 *   · o administrador envia a logomarca em Configurações → Logomarcas e vê a prévia;
 *   · a folha de impressão da OS traz a logomarca no cabeçalho;
 *   · a outra organização não recebe a logomarca da primeira.
 *
 * A logomarca é um PNG de 1×1 gerado no teste — nenhuma marca real.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const cabA = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};
const cabB = {
  authorization: `Bearer local:${E2E.emailCoordB}:${E2E.emailCoordB}`,
  'x-aurora-organization': E2E.orgB,
};

test.describe('Logomarcas da organização', () => {
  test('enviar em Configurações, sair na folha da OS e não vazar para outra organização', async ({
    comoCoordenadorA: page,
  }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    // Vaga 2, para não disputar com outro teste que use a 1.
    await page.goto('/configuracoes/logomarcas');
    await expect(page.getByRole('heading', { name: 'Logomarcas', level: 1 })).toBeVisible();
    const vaga = page.getByTestId('previa-logo-2');
    const cartao = page.locator('section', { has: vaga });
    await cartao.getByRole('textbox').fill('Grupo E2E');
    await page.getByLabel('Arquivo da logomarca 2').setInputFiles({
      name: 'grupo-e2e.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect(vaga.getByRole('img', { name: 'Grupo E2E' })).toBeVisible({ timeout: 15_000 });

    try {
      // A folha de impressão de uma OS da organização traz a logomarca (OS pelo mesmo caminho da tela).
      const titulo = `OS com logomarca ${Date.now()}`;
      const sol = await page.request.post(`${apiUrl()}/service-requests`, {
        headers: cabA,
        data: { customer_id: E2E.clienteA, summary: titulo, source: 'phone', requested_type: 'corrective' },
      });
      const { id: solicitacao } = await sol.json();
      await page.request.post(`${apiUrl()}/service-requests/${solicitacao}/transitions`, {
        headers: cabA,
        data: { to: 'triage' },
      });
      const naturezas = await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, {
        headers: cabA,
      });
      const { items } = await naturezas.json();
      const os = await page.request.post(`${apiUrl()}/work-orders/from-request/${solicitacao}`, {
        headers: cabA,
        data: { targets: [{ work_order_type_id: items[0].id, title: titulo }] },
      });
      expect(os.ok()).toBe(true);
      const corpo = await os.json();
      const id = (corpo.work_orders?.[0]?.id ?? corpo.items?.[0]?.id ?? corpo.id) as string;
      await page.goto(`/ordens/${id}?modo=impressao`);
      const folha = page.getByTestId('folha-de-impressao');
      await expect(folha).toBeVisible({ timeout: 15_000 });
      await expect(
        folha.getByTestId('logos-da-organizacao').getByRole('img', { name: 'Grupo E2E' })
      ).toBeVisible();

      // A outra organização não vê a logomarca da primeira.
      const deB = await page.request.get(`${apiUrl()}/organizations/current/logos`, { headers: cabB });
      expect(deB.ok()).toBe(true);
      const corpoB = (await deB.json()) as { items: Array<{ label: string | null }> };
      expect(corpoB.items.some((l) => l.label === 'Grupo E2E')).toBe(false);
    } finally {
      await page.request.delete(`${apiUrl()}/organizations/current/logos/2`, { headers: cabA });
    }
  });
});
