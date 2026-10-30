/**
 * Aurora — varredura de links do menu por perfil (OPS-04, auditoria de 29/10/2026).
 *
 * "Testar links e botões por perfil e mobile/desktop, inclusive refresh de rotas internas." O
 * console.spec abre uma lista FIXA de telas com o admin; este abre o que o MENU de cada perfil
 * oferece — o menu é filtrado por permissão, e um item visível que leva a "sem acesso" ou a uma
 * tela quebrada é link morto. Cada destino também é recarregado (refresh de rota interna).
 */
import type { Page } from '@playwright/test';
import { test, expect, E2E, entrarComo } from '../fixtures/aurora';

const PERFIS = [
  { nome: 'admin (coordenador A)', email: E2E.emailCoordA },
  { nome: 'técnico', email: E2E.emailTecA },
  { nome: 'auditora', email: E2E.emailAuditora },
] as const;

/** O que uma tela quebrada ou proibida mostra no lugar do conteúdo. */
const TELA_RUIM = /Você não tem acesso a esta tela|Não encontramos este registro|Algo deu errado/;

async function linksDoMenu(page: Page): Promise<string[]> {
  const menu = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(menu).toBeVisible({ timeout: 15_000 });
  const hrefs = await menu
    .locator('a[href^="/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter((h) => h && h !== '/'))];
}

async function abreBem(page: Page, caminho: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }), caminho).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]'), caminho).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(TELA_RUIM), caminho).toHaveCount(0);
}

for (const perfil of PERFIS) {
  test(`menu do perfil ${perfil.nome}: todo link abre, e recarregar a rota não quebra`, async ({ page }) => {
    test.setTimeout(180_000);
    await entrarComo(page, { email: perfil.email, organizationId: E2E.orgA });
    await page.goto('/');
    const links = await linksDoMenu(page);
    expect(links.length, 'o menu oferece telas').toBeGreaterThan(0);
    for (const href of links) {
      await page.goto(href);
      await abreBem(page, href);
      await page.reload();
      await abreBem(page, `${href} (recarregada)`);
    }
  });
}

test('no celular, o menu do admin também leva a telas que abrem', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await entrarComo(page, { email: E2E.emailCoordA, organizationId: E2E.orgA });
  await page.goto('/');
  // No celular o menu fica recolhido: lemos os destinos do mesmo componente, aberto ou não.
  const hrefs = await page
    .locator('nav[aria-label="Navegação principal"] a[href^="/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const destinos = [...new Set(hrefs.filter((h) => h && h !== '/'))];
  expect(destinos.length).toBeGreaterThan(0);
  for (const href of destinos) {
    await page.goto(href);
    await abreBem(page, href);
    const larguras = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      tela: window.innerWidth,
    }));
    expect(larguras.doc, `${href} sem rolagem horizontal`).toBeLessThanOrEqual(larguras.tela + 1);
  }
});
