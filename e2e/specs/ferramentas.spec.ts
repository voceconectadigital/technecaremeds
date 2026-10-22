/**
 * Aurora — Ferramentas (reunião 16/10/2026, Fase 12).
 *
 * Vitrine sem backend: sete cartões, cada um com a situação declarada, e
 * nenhuma chamada de API própria — a página não pede dado que não existe.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Fase 12 · Ferramentas', () => {
  test('o menu leva às oito ferramentas (sete da reunião e a ONA), todas com situação', async ({
    comoCoordenadorA: page,
  }) => {
    const chamadas: string[] = [];
    page.on('request', (r) => {
      if (/\/v1\/(tools|ferramentas)/.test(r.url())) chamadas.push(r.url());
    });
    await page.goto('/');
    await page.getByRole('link', { name: 'Ferramentas' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ferramentas');
    const lista = page.getByRole('list', { name: 'Ferramentas' });
    await expect(lista.getByRole('listitem')).toHaveCount(8);
    for (const nome of ['Temperatura e Umidade', 'Rastreabilidade CME', 'Inteligência Artificial']) {
      await expect(lista.getByRole('heading', { name: nome })).toBeVisible();
    }
    await expect(lista.getByText('INTEGRAÇÃO PLANEJADA').first()).toBeVisible();
    await expect(lista.getByText('EM BREVE')).toBeVisible();
    await expect(lista.getByText('FUTURO').first()).toBeVisible();
    expect(chamadas).toEqual([]);
  });

  test('no celular a vitrine cabe sem rolagem horizontal', async ({ comoCoordenadorA: page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/ferramentas');
    await expect(page.getByRole('heading', { name: 'Geolocalização' })).toBeVisible();
    const larguras = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      tela: window.innerWidth,
    }));
    expect(larguras.doc).toBeLessThanOrEqual(larguras.tela + 1);
  });
});
