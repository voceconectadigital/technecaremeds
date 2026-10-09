/**
 * Téchne Care — a demonstração pública abre inteira, sem API e sem Supabase.
 *
 * Cada teste vigia a REDE e o CONSOLE da página do começo ao fim:
 *
 *   - qualquer pedido a /v1, /api ou *.supabase.co reprova — a demonstração
 *     não fala com servidor nenhum;
 *   - qualquer pedido a outro domínio reprova — nada pode depender de URL
 *     externa (fontes, imagens, scripts);
 *   - qualquer resposta >= 400 do próprio site reprova;
 *   - qualquer erro no console reprova.
 */
import { test, expect, type Page } from '@playwright/test';

const PROIBIDO = /\/v1(\/|$)|\/api(\/|$)|supabase\.co/i;

/*
 * A ÚNICA exceção externa: o beacon do Cloudflare Web Analytics, que a BORDA
 * injeta no domínio próprio (configuração da zona voceconecta.com.br, e não do
 * nosso código — o `*.pages.dev` não o tem). Não é backend, não carrega dado
 * nem imagem, e a página funciona sem ele. Desligá-lo é decisão de conta.
 */
const BEACON_DA_BORDA = /^https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/;

interface Vigia {
  backend: string[];
  externos: string[];
  falhas: string[];
  console: string[];
}

function vigiar(page: Page, origem: string): Vigia {
  const v: Vigia = { backend: [], externos: [], falhas: [], console: [] };
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const u = new URL(url);
    if (PROIBIDO.test(u.pathname) || PROIBIDO.test(u.hostname)) v.backend.push(`${r.method()} ${url}`);
    if (u.origin !== origem && !BEACON_DA_BORDA.test(url)) v.externos.push(url);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) v.falhas.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    // Navegar no meio de um carregamento cancela pedidos da tela anterior:
    // isso é o navegador, e não uma falha da demonstração.
    if (r.failure()?.errorText.includes('ERR_ABORTED')) return;
    v.falhas.push(`falhou ${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') v.console.push(m.text());
  });
  page.on('pageerror', (e) => v.console.push(`pageerror: ${e.message}`));
  return v;
}

function conferirLimpo(v: Vigia) {
  expect(v.backend, 'chamada a backend (/v1, /api, supabase)').toEqual([]);
  expect(v.externos, 'pedido a domínio externo').toEqual([]);
  expect(v.falhas, 'resposta de erro ou pedido falho').toEqual([]);
  expect(v.console, 'erro no console').toEqual([]);
}

/** A tela terminou de carregar: título visível e nenhum esqueleto ocupado. */
async function telaPronta(page: Page, titulo: RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByTestId('faixa-demonstracao')).toBeVisible();
  // Nenhum aviso de erro de carregamento na tela.
  await expect(page.getByText(/não foi possível carregar|erro inesperado/i)).toHaveCount(0);
  // Nada rola de lado: a página cabe na largura da janela (medido depois de o
  // conteúdo assentar — durante a troca de tela a moldura antiga ainda mede).
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
      message: 'rolagem horizontal',
    })
    .toBeLessThanOrEqual(1);
}

const TELAS: Array<[string, RegExp]> = [
  ['/solicitacoes', /Solicitações/],
  ['/ordens', /Ordens/],
  ['/agenda', /Agenda/],
  // O título de Ativos é o rótulo que a organização usa para o parque.
  ['/ativos', /Ativos|Equipamentos/],
  ['/estoque', /Estoque/],
  ['/contratos', /Contratos/],
  ['/orcamentos', /Orçamentos/],
  ['/indicadores', /Indicadores/],
  ['/painel', /Painel de Controle/],
  ['/planos', /Planos de manutenção/],
  ['/planos?aba=cronograma', /Planos de manutenção/],
  ['/planos?aba=procedimentos', /Planos de manutenção/],
  ['/clientes', /Clientes/],
  ['/configuracoes', /Configurações|Pessoas|Membros/],
];

test('entra na demonstração e percorre todas as telas principais', async ({ page, baseURL }) => {
  const v = vigiar(page, new URL(baseURL!).origin);

  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page).toHaveTitle('Téchne Care — Demonstração');
  await expect(page.getByTestId('selo-demonstracao')).toBeVisible();
  await page.getByRole('button', { name: 'Explorar plataforma' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByTestId('faixa-demonstracao')).toBeVisible();
  await expect(page).toHaveTitle(/Demonstração/);

  for (const [rota, titulo] of TELAS) {
    await page.goto(rota);
    await telaPronta(page, titulo);
  }

  conferirLimpo(v);
});

test('rota profunda abre direto por URL e sobrevive ao recarregamento', async ({ page, baseURL }) => {
  const v = vigiar(page, new URL(baseURL!).origin);

  // Link direto, sem passar pela entrada: é o link que se manda ao cliente.
  await page.goto('/agenda');
  await telaPronta(page, /Agenda/);

  // Uma ficha de OS, aberta a partir da lista, e recarregada.
  await page.goto('/ordens?vista=lista');
  await telaPronta(page, /Ordens/);
  await page.locator('a[href^="/ordens/"]').first().click();
  await expect(page).toHaveURL(/\/ordens\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  // Uma ficha de ativo, recarregada.
  await page.goto('/ativos');
  await telaPronta(page, /Ativos|Equipamentos/);
  await page.locator('a[href^="/ativos/"]').first().click();
  await expect(page).toHaveURL(/\/ativos\/[0-9a-f-]{36}/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  for (const [rota, titulo] of TELAS) {
    await page.goto(rota);
    await page.reload();
    await telaPronta(page, titulo);
  }

  // A ficha do cliente (setores e equipamentos por setor), recarregada.
  await page.goto('/clientes');
  await page.locator('a[href^="/clientes/"]').first().click();
  await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]{36}/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Setores' })).toBeVisible();

  // O Modo Exibição: fora da moldura (sem faixa nem menu), mesmo dado, sem rolagem lateral.
  await page.goto('/painel/tv');
  await expect(page.getByRole('heading', { level: 1, name: 'Painel de Controle' })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);

  conferirLimpo(v);
});

test('a busca global encontra OS, ativo e solicitação nas respostas locais', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name === 'celular', 'o atalho de teclado da paleta é de mesa');
  const v = vigiar(page, new URL(baseURL!).origin);

  await page.goto('/ordens');
  await telaPronta(page, /Ordens/);

  for (const [termo, esperado] of [
    ['WO-2026', /WO-2026-\d{4}/],
    ['ventilador', /Ventilador/],
    ['PAT-0501', /Autoclave/],
    ['SR-2026', /SR-2026-\d{4}/],
  ] as const) {
    await page.keyboard.press('Control+K');
    const caixa = page
      .getByRole('dialog')
      .getByRole('combobox')
      .or(page.getByRole('dialog').getByRole('textbox'))
      .first();
    await caixa.fill(termo);
    await expect(page.getByRole('option', { name: esperado }).first()).toBeVisible();
    await page.keyboard.press('Escape');
  }

  conferirLimpo(v);
});

test('a abertura de solicitação não chama rede e avisa que é demonstração', async ({ page, baseURL }) => {
  const v = vigiar(page, new URL(baseURL!).origin);

  await page.goto('/solicitacoes/nova');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  await page.getByLabel('Cliente').selectOption({ index: 1 });
  await page.getByLabel('O que está acontecendo').fill('Monitor reiniciando sozinho no leito 3');
  await page.getByRole('button', { name: 'Abrir solicitação' }).click();
  await expect(page.getByText(/Disponível na versão conectada/)).toBeVisible();
  // Continua na mesma tela: nada foi "criado".
  await expect(page).toHaveURL(/\/solicitacoes\/nova$/);

  conferirLimpo(v);
});
