/**
 * Aurora — a ficha de vida do equipamento (conversa com o cliente, 21/10/2026):
 * QR desenhado, indicadores pontuais e impressão; e o destino do QR (`/q/:token`).
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

test.describe('Ativos · ficha de vida', () => {
  test('a ficha mostra a etiqueta com o QR, os indicadores do equipamento e o botão Imprimir', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ativos');
    await page.getByRole('link', { name: /Ventilador Alfa-1/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ventilador Alfa-1');

    await expect(page.getByRole('heading', { name: 'Etiqueta QR' })).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code do equipamento/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Imprimir etiqueta' })).toBeVisible();

    await expect(page.getByText('Indicadores do equipamento')).toBeVisible();
    await expect(page.getByText('MTTR (tempo de reparo)')).toBeVisible();
    await expect(page.getByText('MTBF (entre falhas)')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Imprimir', exact: true })).toBeVisible();
  });

  test('ler a etiqueta com a câmera (/q/:token) abre o equipamento', async ({ comoCoordenadorA: page }) => {
    const r = await page.request.get(`${apiUrl()}/assets?limit=1&status=active`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    expect(r.ok()).toBe(true);
    const ativo = (await r.json()).items[0] as { id: string; qr_token: string };

    await page.goto(`/q/${ativo.qr_token}`);
    await expect(page).toHaveURL(new RegExp(`/ativos/${ativo.id}`), { timeout: 15_000 });
  });

  test('etiqueta que não existe diz que não achou — sem pista do porquê', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/q/nao-existe-esta-etiqueta');
    await expect(page.getByText('Não encontramos este equipamento')).toBeVisible();
  });
});
