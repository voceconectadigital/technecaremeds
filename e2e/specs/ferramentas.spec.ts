/**
 * Aurora — Ferramentas (reunião 16/10/2026, Fase 12).
 *
 * Vitrine sem backend: nove cartões, cada um com a situação declarada, e
 * nenhuma chamada de API própria — a página não pede dado que não existe.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Fase 12 · Ferramentas', () => {
  test('o menu leva às nove ferramentas (sete da reunião, Eficiência Energética e ONA), todas com situação', async ({
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
    await expect(page.getByText('Soluções novas de mercado, consulte disponibilidade.')).toBeVisible();
    await expect(page.getByText(/Nenhuma destas ferramentas mostra dado/)).toHaveCount(0);
    await expect(lista.locator(':scope > li')).toHaveCount(9);
    for (const nome of [
      'Temperatura e Umidade',
      'Rastreabilidade CME',
      'Eficiência Energética',
      'Inteligência Artificial',
    ]) {
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

  test('clicar na marca volta à página inicial, recarregando', async ({ comoCoordenadorA: page }) => {
    await page.goto('/ferramentas');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ferramentas');
    await Promise.all([
      page.waitForEvent('load'),
      page
        .getByRole('link', { name: /página inicial/ })
        .first()
        .click(),
    ]);
    expect(new URL(page.url()).pathname).not.toBe('/ferramentas');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Ferramentas');
  });
});
