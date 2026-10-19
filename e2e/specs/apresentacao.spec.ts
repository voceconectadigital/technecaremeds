/**
 * Téchne Care — a apresentação comercial (`/apresentacao`), sem conta.
 *
 * O que só o navegador prova:
 *   - o link direto abre a página, e RECARREGAR continua nela (o servidor
 *     devolve o `index.html` para a rota, e o roteador a reconhece);
 *   - nenhuma requisição vai para a API — nem a pergunta pela sessão que a
 *     composição da aplicação faz nas outras telas;
 *   - o console fica limpo;
 *   - no celular, nada passa da largura da tela.
 *
 * Sem `entrarComo`: a página é para quem NÃO tem conta. Com sessão gravada,
 * o teste provaria outra coisa.
 */
import { test, expect, type Page } from '@playwright/test';
import { apiUrl } from '../fixtures/aurora';

interface Vigia {
  api: string[];
  console: string[];
}

function vigiar(page: Page): Vigia {
  const v: Vigia = { api: [], console: [] };
  const base = apiUrl();
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(base) || new URL(url).pathname.startsWith('/v1/')) v.api.push(`${r.method()} ${url}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') v.console.push(m.text());
  });
  page.on('pageerror', (e) => v.console.push(`exceção não capturada: ${e.message}`));
  return v;
}

const TITULOS = [
  /do chamado ao indicador/i,
  /14 módulos/i,
  /painel de controle e relatórios/i,
  /operação em campo/i,
  /muitas empresas/i,
  /ecossistema em evolução/i,
  /inteligência artificial/i,
  /segurança e governança/i,
  /conheça a téchne care/i,
];

async function conferirPagina(page: Page) {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Toda a sua operação. Uma única plataforma.' })
  ).toBeVisible({ timeout: 15_000 });
  for (const t of TITULOS) {
    await expect(page.getByRole('heading', { level: 2, name: t })).toBeAttached();
  }
  await expect(page).toHaveURL(/\/apresentacao$/);
  await expect(page).toHaveTitle('Téchne Care — Apresentação');
  await expect(page.locator('body')).not.toContainText(/aurora/i);
}

test('abre por link direto e continua depois de recarregar, sem chamar a API', async ({ page }) => {
  const v = vigiar(page);

  await page.goto('/apresentacao');
  await conferirPagina(page);

  await page.reload();
  await conferirPagina(page);

  // Os selos do que ainda não existe estão à vista de quem rola até lá.
  const eco = page.getByRole('region', { name: /ecossistema em evolução/i });
  await expect(eco.getByText('EM DESENVOLVIMENTO', { exact: true })).toHaveCount(2);
  await expect(eco.getByText('FUTURO', { exact: true })).toHaveCount(5);
  await expect(page.getByText('ROADMAP', { exact: true })).toBeVisible();

  // Espera a rede assentar: uma consulta disparada na montagem chegaria aqui.
  await page.waitForLoadState('networkidle');
  expect(v.api, 'requisição à API').toEqual([]);
  expect(v.console, 'erro no console').toEqual([]);
});

test('"Conhecer a plataforma" leva à visão do produto, e "Entrar no sistema" à entrada', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.getByRole('link', { name: 'Conhecer a plataforma' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /do chamado ao indicador/i })).toBeInViewport();
  await expect(page).toHaveURL(/\/apresentacao$/);

  await page.getByRole('link', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
});

test('cabe no celular sem rolagem lateral', async ({ page }) => {
  const v = vigiar(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/apresentacao');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Toda a sua operação. Uma única plataforma.' })
  ).toBeVisible({ timeout: 15_000 });

  const larguras = await page.evaluate(() => ({
    rolagem: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(larguras.rolagem, 'rolagem horizontal no celular').toBeLessThanOrEqual(larguras.janela);

  await page.waitForLoadState('networkidle');
  expect(v.api, 'requisição à API').toEqual([]);
  expect(v.console, 'erro no console').toEqual([]);
});
