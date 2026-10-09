/**
 * Aurora — Painel de Controle, Modo Exibição, setores, equipamento e planos,
 * no navegador (rodada "overdelivery").
 *
 * Cada teste entra pela URL (link profundo) e recarrega quando a tela tem
 * estado na URL: o painel compartilhado por link e a TV que reinicia de
 * madrugada precisam abrir no mesmo recorte. O console é vigiado pela
 * fixture — erro no navegador reprova o teste.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Painel de Controle', () => {
  test('mostra os números, os gráficos e o filtro de período na URL', async ({ comoCoordenadorA: page }) => {
    await page.goto('/painel');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Painel de Controle');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    for (const rotulo of ['Chamados abertos', 'Concluídos', 'Backlog', 'MTTR', 'MTBF', 'SLA cumprido']) {
      await expect(page.getByText(rotulo, { exact: true }).first()).toBeVisible();
    }
    await expect(
      page
        .getByRole('img', { name: 'Ordens abertas e concluídas por período' })
        .or(page.getByText('Sem dados no período.').first())
    ).toBeVisible();

    await page.getByRole('button', { name: '90 dias' }).click();
    await expect(page).toHaveURL(/periodo=90d/);
    await page.reload();
    await expect(page.getByRole('button', { name: '90 dias' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('período personalizado: incompleto vira aviso; completo recarrega pela URL', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/painel');
    await page.getByRole('button', { name: 'Personalizado' }).click();
    await expect(page.getByText('Escolha a data inicial e a final do período.')).toBeVisible();
    const hoje = new Date().toISOString().slice(0, 10);
    const inicio = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Início do período').fill(inicio);
    await page.getByLabel('Fim do período').fill(hoje);
    await expect(page).toHaveURL(new RegExp(`de=${inicio}.*ate=${hoje}|ate=${hoje}.*de=${inicio}`));
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText('Evolução dos chamados')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Início do período')).toHaveValue(inicio);
  });

  test('atalhos rápidos: cada um abre a rota real; "novo" abre o cadastro; teclado alcança', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/painel');
    const atalhos = page.getByRole('navigation', { name: 'Atalhos rápidos' });
    await expect(atalhos).toBeVisible();
    const destinos = await atalhos
      .getByRole('link')
      .evaluateAll((els) =>
        els.map((e) => [e.textContent?.trim() ?? '', (e as HTMLAnchorElement).getAttribute('href') ?? ''])
      );
    expect(destinos.length).toBeGreaterThanOrEqual(8);
    for (const [, href] of destinos) {
      await page.goto(href);
      // Rota existente: a tela tem título; a página de "não encontrado" não teria a moldura.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    }

    await page.goto('/painel');
    await page.getByRole('link', { name: 'Novo cliente' }).click();
    await expect(page).toHaveURL(/\/clientes\?novo=sim/);
    await expect(page.getByRole('dialog', { name: 'Novo cliente' })).toBeVisible();

    await page.goto('/painel');
    await page.getByRole('link', { name: 'Novo equipamento' }).focus();
    await expect(page.getByRole('link', { name: 'Novo equipamento' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Novo equipamento' })).toBeVisible();
  });

  test('o cartão leva à lista correspondente já filtrada', async ({ comoCoordenadorA: page }) => {
    await page.goto('/painel');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('link', { name: /Chamados abertos/ }).click();
    await expect(page).toHaveURL(/\/ordens\?.*categoria=open/);
  });

  test('o Modo Exibição abre sem a barra lateral, com relógio, e Esc volta', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/painel?periodo=90d');
    await page.getByRole('link', { name: 'Modo Exibição' }).click();
    await expect(page).toHaveURL(/\/painel\/tv\?periodo=90d/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel de Controle');
    await expect(page.locator('[data-modo-exibicao]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0);
    await expect(page.getByText(/atualiza sozinho a cada minuto/)).toBeVisible();

    // Link profundo + recarregar: a televisão reinicia e volta ao mesmo recorte.
    await page.reload();
    await expect(page.locator('[data-modo-exibicao]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/painel\?periodo=90d/);
  });

  test('16:9 sem rolagem na televisão', async ({ comoCoordenadorA: page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/painel/tv');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    const rola = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
    expect(rola).toBe(false);
  });
});

test.describe('Setores e Cliente → Setor → Equipamento', () => {
  test('a ficha do cliente mostra a seção Setores e cria setor pelo atalho', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/clientes');
    await page
      .getByRole('link')
      .filter({ hasText: /local|locais/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Setores' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('UTI Alfa').first()).toBeVisible();

    const nome = `Imaginologia ${Date.now() % 10_000}`;
    await page.getByRole('button', { name: 'Novo setor' }).click();
    await page.getByLabel('Nome do setor').fill(nome);
    await page.getByRole('button', { name: 'Criar setor' }).click();
    await expect(page.getByText(nome).first()).toBeVisible();

    // Link profundo da ficha sobrevive ao recarregar.
    await page.reload();
    await expect(page.getByText(nome).first()).toBeVisible({ timeout: 15_000 });
  });

  test('novo equipamento exige cliente e setor, e o setor é filtrado pelo cliente', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ativos');
    await page.getByRole('button', { name: 'Novo equipamento' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Novo equipamento' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByLabel('Setor')).toBeDisabled();

    await dialogo.getByLabel('Cliente / Hospital').selectOption({ index: 1 });
    await expect(dialogo.getByLabel('Setor')).toBeEnabled();
    await dialogo.getByLabel('Setor').selectOption({ label: 'UTI Alfa' });
    await dialogo.getByLabel('Nome do equipamento').fill(`Desfibrilador E2E ${Date.now() % 10_000}`);
    await dialogo.getByLabel('Categoria').selectOption({ index: 1 });
    await dialogo.getByRole('button', { name: 'Cadastrar equipamento' }).click();

    await expect(page).toHaveURL(/\/ativos\/[0-9a-f-]{36}/);
    await expect(page.getByText('UTI Alfa').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Planos de manutenção', () => {
  test('o módulo tem visão geral, cronograma e procedimentos, com a aba na URL', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Planos de manutenção');
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Programados').first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Cronograma' }).click();
    await expect(page).toHaveURL(/aba=cronograma/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Cronograma' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Carga por mês|Nada no cronograma/).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Procedimentos e checklists' }).click();
    await expect(page.getByText('Preventiva de ventilador pulmonar').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('cria um checklist com ponto de medição: tolerância é dado, sem veredito', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos?aba=procedimentos');
    await page.getByRole('button', { name: 'Novo checklist' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Título').fill(`Calibração E2E ${Date.now() % 10_000}`);
    await d.getByLabel('Tipo de procedimento').selectOption('calibration');
    await d.getByLabel('Texto do item 1').fill('Pressão a 100 mmHg');
    await d.getByLabel('Tipo do item 1').selectOption('medicao');
    await expect(d.getByText(/NÃO é calculada/)).toBeVisible();
    await d.getByLabel('Unidade').fill('mmHg');
    await d.getByLabel('Valor nominal').fill('100');
    await d.getByLabel('Tolerância para menos').fill('3');
    await d.getByLabel('Tolerância para mais').fill('3');
    await d.getByRole('button', { name: 'Salvar e publicar' }).click();
    await expect(d).toBeHidden();
  });

  test('cria um plano pelo assistente: cliente, setor, equipamentos, tipo, procedimento, periodicidade', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos');
    await page.getByRole('button', { name: 'Novo plano' }).click();
    const d = page.getByRole('dialog', { name: 'Novo plano de manutenção' });
    await d.getByLabel('Cliente / Hospital').selectOption({ index: 1 });
    await d.getByRole('button', { name: 'Continuar' }).click();
    await d.getByLabel('Setor').selectOption({ index: 1 });
    await d.getByRole('button', { name: 'Continuar' }).click();
    await expect(d.getByText(/Todos os equipamentos de UTI Alfa/)).toBeVisible();
    await d.getByRole('button', { name: 'Continuar' }).click();
    await d.getByRole('button', { name: /Preventiva/ }).click();
    await expect(d.getByRole('button', { name: /Educação continuada/ })).toBeDisabled();
    await d.getByRole('button', { name: 'Continuar' }).click();
    await d.getByLabel('Checklist / procedimento').selectOption({ index: 1 });
    await d.getByRole('button', { name: 'Continuar' }).click();
    await d.getByRole('button', { name: 'Continuar' }).click();
    await d.getByLabel('Nome do plano').fill(`Preventiva E2E ${Date.now() % 10_000}`);
    await d.getByRole('button', { name: 'Criar plano' }).click();
    await expect(page).toHaveURL(/\/planos\/[0-9a-f-]{36}/, { timeout: 15_000 });
  });
});
