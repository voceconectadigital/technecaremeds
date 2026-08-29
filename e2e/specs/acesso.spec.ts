/**
 * Aurora — acesso: entrar, escolher organização, e não ver o que é de outra.
 *
 * E2E-WEB-001, 002 e 003.
 *
 * O terceiro é o mais importante de toda a suíte. As 1.392 provas de unidade e
 * de HTTP já mostram que o PostgreSQL isola e que a API não abre caminho por
 * cima. O que só o navegador prova é que o isolamento sobrevive ao caminho
 * inteiro — roteador, cache do cliente, sessão guardada — e que trocar de
 * organização não deixa dado da anterior na tela.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

test.describe('E2E-WEB-001 · entrar', () => {
  test('sem sessão, a aplicação leva para a tela de entrada', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Aurora' })).toBeVisible();
  });

  test('a tela diz que é o provedor de desenvolvimento', async ({ page }) => {
    await page.goto('/entrar');
    // Uma tela de login que parece de produção e não é ensina a confiar nela.
    await expect(page.getByText(/Ambiente de desenvolvimento/)).toBeVisible();
  });

  test('e-mail inválido é recusado no próprio campo', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('isto-nao-e-email');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // O erro fica NO CAMPO, e é anunciado: quem já saiu dele precisa ser
    // avisado, não descobrir depois de tentar de novo.
    await expect(page.getByRole('alert')).toContainText(/endereço de e-mail válido/);
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('entrar leva à escolha de organização', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill(E2E.emailCoordA);
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Quem tem UMA organização é levado adiante por lá — escolher entre uma
    // opção não é escolha, é obstáculo.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bom dia|Hoje/);
  });
});

test.describe('E2E-WEB-002 · organização', () => {
  test('o nome da organização fica visível, não escondido num menu', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    // Quem atende duas empresas precisa saber em qual está ANTES de agir.
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Clínica Alfa');
  });

  test('sair limpa a sessão e volta para a entrada', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Conta de/ }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();

    await expect(page).toHaveURL(/\/entrar$/);
    // A organização escolhida some junto: pode ser outra pessoa no mesmo
    // computador, e o vínculo dela é outro.
    const guardado = await page.evaluate(() => ({
      token: localStorage.getItem('aurora:token'),
      org: localStorage.getItem('aurora:organizacao'),
    }));
    expect(guardado).toEqual({ token: null, org: null });
  });
});

test.describe('E2E-WEB-003 · isolamento entre organizações', () => {
  test('o coordenador de A nunca vê o cliente de B', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const corpo = await page.locator('body').innerText();
    expect(corpo).not.toContain('Hospital Beta');
    expect(corpo).not.toContain('Ventilador Beta-1');
  });

  test('forjar o cabeçalho de organização recebe 403, não dados', async ({ comoCoordenadorA: page }) => {
    // A camada 1 da §37: o cabeçalho SUGERE a organização; quem decide é a
    // consulta de vínculo no servidor.
    const r = await page.request.get(`${apiUrl()}/organizations/current`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgB,
      },
    });
    expect(r.status()).toBe(403);
  });

  test('a busca de A não encontra o ativo de B, nem pelo patrimônio exato', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Buscar OS, ativo/ }).click();

    const campo = page.getByRole('combobox');
    await expect(campo).toBeFocused();
    await campo.fill('PAT-BETA-001');

    // O resultado fora do alcance não aparece porque não é BUSCADO — o escopo
    // é aplicado na consulta, não filtrado depois.
    await expect(page.getByText(/Nada encontrado para/)).toBeVisible({ timeout: 15_000 });
  });

  test('a busca de A encontra o ativo de A pelo patrimônio', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Buscar OS, ativo/ }).click();
    await page.getByRole('combobox').fill('PAT-ALFA-001');

    await expect(page.getByRole('option', { name: /Ventilador Alfa-1/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a consultora escolhe entre as duas organizações que ela tem', async ({ page }) => {
    // A persona da §05: uma pessoa, dois vínculos. Sem escolher, a API recusa
    // com `organization.selection_required` — ambiguidade nunca é resolvida
    // por adivinhação.
    await page.addInitScript(() => {
      localStorage.setItem('aurora:token', 'local:consultora@e2e.test:consultora@e2e.test');
      localStorage.removeItem('aurora:organizacao');
    });
    await page.goto('/');

    await expect(page).toHaveURL(/\/organizacoes$/);
    await expect(page.getByRole('heading', { name: 'Escolha a organização' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Clínica Alfa/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hospital Beta/ })).toBeVisible();
  });

  test('escolher uma organização mostra a dela, e só a dela', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aurora:token', 'local:consultora@e2e.test:consultora@e2e.test');
      localStorage.removeItem('aurora:organizacao');
    });
    await page.goto('/organizacoes');

    await page.getByRole('button', { name: /Hospital Beta/ }).click();
    await expect(page).toHaveURL(/\/$/);

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav).toContainText('Hospital Beta');

    // Trocar é ação EXPLÍCITA, e o que ficou para trás fica para trás: nenhum
    // rastro da Clínica Alfa na tela.
    await expect(page.locator('body')).not.toContainText('Clínica Alfa');
    await expect(page.locator('body')).not.toContainText('Ventilador Alfa-1');
  });

  test('a mesma pessoa é UM cadastro, com dois vínculos', async ({ page }) => {
    const r = await page.request.get(`${apiUrl()}/me/organizations`, {
      headers: {
        authorization: 'Bearer local:consultora@e2e.test:consultora@e2e.test',
      },
    });
    expect(r.ok()).toBe(true);

    const { items } = await r.json();
    expect(items).toHaveLength(2);
    // Dois vínculos distintos para o MESMO e-mail: é o que faz o seletor
    // mostrar as duas em vez de metade.
    expect(new Set(items.map((i: { organization_id: string }) => i.organization_id)).size).toBe(2);
  });
});
