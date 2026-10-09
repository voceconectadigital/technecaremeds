/**
 * Auditoria do redesign enterprise (09/10/2026) — contra a DEMONSTRAÇÃO.
 *
 * A suíte principal (`e2e/specs/acessibilidade.spec.ts`, `viewports.spec.ts`)
 * precisa de API e PostgreSQL e roda na integração contínua. Esta repete as
 * duas garantias que um redesenho visual pode quebrar — axe sem violação e
 * nenhuma página rolando de lado — sobre as respostas gravadas da demo, para
 * que a mudança de tokens e de moldura seja conferida em qualquer máquina.
 *
 * Também confere, nos quatro estilos, o contraste que o axe mede: um token
 * novo que passasse no claro e reprovasse no escuro apareceria aqui.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TELAS = [
  '/',
  '/solicitacoes',
  '/ordens',
  '/ordens?vista=lista',
  '/agenda',
  '/planos',
  '/ativos',
  '/estoque',
  '/contratos',
  '/orcamentos',
  '/painel',
  '/indicadores',
  '/configuracoes',
];

const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function entrar(page: Page, estilo?: string) {
  if (estilo) await page.addInitScript((e) => localStorage.setItem('aurora:estilo', e), estilo);
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Explorar plataforma' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function pronta(page: Page, caminho: string) {
  await page.goto(caminho);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

function resumo(v: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return v.map((x) => `  · [${x.impact}] ${x.id}: ${x.help} — ${x.nodes[0]?.target.join(' ')}`).join('\n');
}

test.describe('redesign: acessibilidade', () => {
  test.skip(({ isMobile }) => isMobile, 'uma passada basta; o celular entra na de largura');

  test('a entrada não tem violação', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
    expect(r.violations, resumo(r.violations)).toEqual([]);
  });

  for (const estilo of ['techne', 'futuristico', 'mindfulness', 'wellness']) {
    test(`estilo ${estilo}: nenhuma tela com violação`, async ({ page }) => {
      test.setTimeout(240_000);
      await entrar(page, estilo);
      const falhas: string[] = [];
      for (const caminho of TELAS) {
        await pronta(page, caminho);
        const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
        if (r.violations.length) falhas.push(`${caminho}\n${resumo(r.violations)}`);
      }
      expect(falhas, falhas.join('\n')).toEqual([]);
    });
  }
});

test.describe('redesign: larguras', () => {
  for (const largura of [390, 768, 1024, 1280, 1440]) {
    test(`${largura}px: nada rola de lado, sem rolagem dupla, e o título aparece`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: largura, height: 900 });
      await entrar(page);
      const falhas: string[] = [];
      for (const caminho of TELAS) {
        await pronta(page, caminho);
        const largo = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (largo > 1) falhas.push(`${caminho}: ${largo}px a mais`);
        // Rolagem dupla: só a área de conteúdo rola, nunca o documento.
        const alto = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        if (alto > 1) falhas.push(`${caminho}: documento rola ${alto}px (rolagem dupla)`);
        if (!(await page.getByRole('heading', { level: 1 }).isVisible()))
          falhas.push(`${caminho}: h1 oculto`);
      }
      expect(falhas, falhas.join('\n')).toEqual([]);
    });
  }
});
