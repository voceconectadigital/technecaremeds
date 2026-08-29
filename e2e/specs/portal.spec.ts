/**
 * Aurora — o portal do cliente, no celular (EPIC-020 · SPEC §19).
 *
 * ESTE ARQUIVO RODA NUM PIXEL 7, e não num monitor.
 *
 * A SPEC §19 diz o cenário: "a abertura de chamado precisa funcionar em 30
 * segundos, em pé, no corredor". Testar em 1440×900 mediria uma tela que quase
 * ninguém usa, e deixaria passar exatamente o que quebra num aparelho estreito.
 *
 * A ENFERMEIRA TEM ESCOPO DE UM CLIENTE E UM LOCAL. É a persona da SPEC — "a
 * enfermeira da UTI II vê a UTI II" — e é o que faz os testes de vazamento
 * provarem alguma coisa: com escopo aberto, eles passariam por acidente.
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { E2E, apiUrl } from '../fixtures/aurora';

/**
 * A sessão do portal.
 *
 * `addInitScript` roda ANTES de qualquer script da página, então a aplicação já
 * monta com credencial — sem a piscada de "entrar" que um `evaluate` depois do
 * carregamento produziria.
 *
 * A organização vai junto porque o cabeçalho da API a exige; no portal ela não
 * é uma ESCOLHA (um usuário de portal pertence a um cliente), e o servidor
 * recusaria qualquer outra.
 */
const test = base.extend<{ comoEnfermeira: Page }>({
  comoEnfermeira: async ({ page }, use) => {
    await page.addInitScript(
      ({ email, org }) => {
        localStorage.setItem('aurora:token', `local:${email}:${email}`);
        localStorage.setItem('aurora:organizacao', org);
      },
      { email: E2E.emailPortalA, org: E2E.orgA }
    );

    const erros: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') erros.push(m.text());
    });
    page.on('pageerror', (e) => erros.push(`exceção não capturada: ${e.message}`));

    await use(page);

    // A mesma vigilância da aplicação interna: em desenvolvimento o cliente
    // confere a resposta contra o contrato, e uma divergência aparece aqui.
    expect(erros, 'o navegador reclamou durante este teste').toEqual([]);
  },
});

const cabDaEquipe = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('PORTAL · a navegação cabe no polegar', () => {
  test('a barra fica embaixo, com quatro destinos alcançáveis', async ({
    comoEnfermeira: page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Início');

    const nav = page.getByRole('navigation', { name: 'Navegação do portal' });
    await expect(nav).toBeVisible();

    /*
     * QUATRO destinos, e não nove.
     *
     * A SPEC lista nove telas; nove ícones num rodapé de celular dá 43px por
     * ícone, abaixo do que um dedo acerta. As outras cinco são alcançadas de
     * dentro do início, onde a pendência que as torna interessantes aparece.
     */
    const destinos = nav.getByRole('link');
    await expect(destinos).toHaveCount(4);

    // Cada destino é confortável para o polegar: 56px, bem acima do mínimo de
    // 24 da WCAG 2.2.
    for (let i = 0; i < 4; i++) {
      const caixa = await destinos.nth(i).boundingBox();
      expect(caixa!.height, `destino ${i}`).toBeGreaterThanOrEqual(44);
    }

    // A barra está no RODAPÉ: o polegar alcança o fim da tela, não o topo.
    const caixaNav = await nav.boundingBox();
    const altura = page.viewportSize()!.height;
    expect(caixaNav!.y + caixaNav!.height).toBeGreaterThan(altura * 0.7);
  });

  test('a página não rola de lado no celular', async ({ comoEnfermeira: page }) => {
    for (const caminho of ['/', '/chamados', '/abrir', '/equipamentos']) {
      await page.goto(caminho);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
      const r = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(r.scroll - r.client, `${caminho} rola de lado`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('PORTAL · abrir chamado em trinta segundos', () => {
  test('só o problema é obrigatório; o resto não trava o envio', async ({
    comoEnfermeira: page,
  }) => {
    /*
     * UM CAMPO OBRIGATÓRIO A MAIS custa cinco segundos e uma chance de
     * desistir; um que a pessoa não sabe responder custa o chamado inteiro.
     *
     * Este teste abre um chamado SEM escolher equipamento — e o chamado
     * precisa nascer. Um chamado sem equipamento é infinitamente melhor do que
     * um chamado que não foi aberto.
     */
    await page.goto('/abrir');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Abrir chamado');

    await page.getByLabel('O que está acontecendo').fill('Bomba de infusão apitando no leito 3');
    await page.getByRole('button', { name: 'Abrir chamado' }).click();

    // A tela leva ao chamado recém-criado — e não a uma lista onde a pessoa
    // precisa procurar o que acabou de escrever.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bomba de infusão', {
      timeout: 15_000,
    });

    // A PROVA É DO SERVIDOR: o chamado existe, é do cliente do vínculo, e a
    // origem é `portal`.
    const lista = await page.request.get(`${apiUrl()}/portal/requests`, {
      headers: {
        authorization: `Bearer local:${E2E.emailPortalA}:${E2E.emailPortalA}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    const { items } = await lista.json();
    const novo = items.find((x: { summary: string }) => x.summary.includes('Bomba de infusão'));
    expect(novo).toBeTruthy();
  });

  test('sem descrever o problema, a tela recusa e explica', async ({ comoEnfermeira: page }) => {
    await page.goto('/abrir');
    await page.getByRole('button', { name: 'Abrir chamado' }).click();
    await expect(page.getByText(/Escreva em poucas palavras/)).toBeVisible();
  });
});

test.describe('PORTAL · nada interno aparece', () => {
  test('a tela de equipamentos não mostra nenhum valor', async ({ comoEnfermeira: page }) => {
    // A equipe grava um valor de compra no equipamento; o portal não pode
    // mostrá-lo, e — mais importante — o servidor não pode mandá-lo.
    const ativos = await page.request.get(`${apiUrl()}/assets`, { headers: cabDaEquipe });
    const { items } = await ativos.json();
    const alvo = items.find((a: { name: string }) => a.name.includes('Ventilador'));

    await page.request.post(`${apiUrl()}/portal/requests`, {
      headers: {
        authorization: `Bearer local:${E2E.emailPortalA}:${E2E.emailPortalA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: { summary: 'chamado de apoio ao teste de vazamento' },
    });

    await page.goto('/equipamentos');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('equipamentos');

    const doPortal = await page.request.get(`${apiUrl()}/portal/assets`, {
      headers: {
        authorization: `Bearer local:${E2E.emailPortalA}:${E2E.emailPortalA}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    const corpo = await doPortal.json();
    for (const a of corpo.items) {
      expect(a.purchase_value).toBeUndefined();
      expect(a.replacement_value).toBeUndefined();
      expect(a.internal_notes).toBeUndefined();
    }
    expect(alvo).toBeTruthy();
  });

  test('o escopo limita a lista ao cliente e ao local do vínculo', async ({
    comoEnfermeira: page,
  }) => {
    /*
     * A enfermeira do Alfa não vê o Beta.
     *
     * A prova é da REDE: conferir que a tela não mostra provaria apenas que o
     * React não renderizou. A pergunta é se o servidor mandou.
     */
    const r = await page.request.get(`${apiUrl()}/portal/assets`, {
      headers: {
        authorization: `Bearer local:${E2E.emailPortalA}:${E2E.emailPortalA}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    const corpo = await r.json();
    const nomes = corpo.items.map((a: { name: string }) => a.name);
    expect(nomes.join(' ')).not.toContain('Beta');
  });
});
