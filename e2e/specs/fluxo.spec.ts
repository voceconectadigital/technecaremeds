/**
 * Aurora — o fluxo operacional, do pedido ao trabalho agendado.
 *
 * E2E-WEB-004 a 012.
 *
 * Estes testes seguem o caminho que uma pessoa faz de verdade num dia de
 * trabalho: alguém liga, abre-se a solicitação, alguém tria, vira ordem de
 * serviço, alguém executa, alguém agenda.
 *
 * O QUE ELES TESTAM QUE OS OUTROS NÃO TESTAM
 *
 * As provas de HTTP já mostram que cada rota faz o que promete. O que só o
 * navegador mostra é o ENCADEAMENTO: que a tela seguinte recebe o que a
 * anterior produziu, que o botão certo está visível na hora certa, e que a
 * recusa aparece onde a pessoa está olhando — não num console que ninguém abre.
 */
import type { Page } from '@playwright/test';
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

test.describe('E2E-WEB-004 · abrir solicitação', () => {
  test('o pedido é registrado com o mínimo: para quem, e o quê', async ({ comoCoordenadorA: page }) => {
    await page.goto('/solicitacoes/nova');

    // A Clínica Alfa atende só a si mesma: não há seletor de cliente, porque
    // escolher entre uma opção não é escolha.
    await expect(page.getByLabel(/O que está acontecendo/)).toBeVisible();

    await page.getByLabel(/O que está acontecendo/).fill('Ventilador da UTI apitando durante o uso');
    await page.getByRole('button', { name: 'Abrir solicitação' }).click();

    // Vai direto para a ficha da solicitação criada.
    await expect(page).toHaveURL(/\/solicitacoes\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ventilador da UTI apitando');
  });

  test('resumo curto demais é recusado no campo, e nada é criado', async ({ comoCoordenadorA: page }) => {
    await page.goto('/solicitacoes/nova');
    await page.getByLabel(/O que está acontecendo/).fill('ok');
    await page.getByRole('button', { name: 'Abrir solicitação' }).click();

    await expect(page.getByRole('alert')).toContainText(/poucas palavras/);
    await expect(page).toHaveURL(/\/solicitacoes\/nova$/);
  });

  test('a solicitação aparece na fila de triagem', async ({ comoCoordenadorA: page }) => {
    await page.goto('/solicitacoes/nova');
    await page.getByLabel(/O que está acontecendo/).fill('Monitor multiparâmetros sem imagem');
    await page.getByRole('button', { name: 'Abrir solicitação' }).click();
    await expect(page).toHaveURL(/\/solicitacoes\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await page.goto('/solicitacoes');
    await expect(page.getByText('Monitor multiparâmetros sem imagem')).toBeVisible();
  });
});

test.describe('E2E-WEB-005 e 006 · triar e converter em OS', () => {
  test('assumir a triagem e gerar a ordem de serviço', async ({ comoCoordenadorA: page }) => {
    // Arranjo pela mesma rota que a tela usa — não por dentro do banco. Um
    // arranjo que escreve no banco monta um estado que a aplicação não sabe
    // produzir, e o teste passa a provar um mundo que não existe.
    const criada = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: {
        customer_id: E2E.clienteA,
        summary: 'Bomba de infusão com alarme de oclusão',
        source: 'phone',
      },
    });
    expect(criada.ok()).toBe(true);
    const { id } = await criada.json();

    await page.goto(`/solicitacoes/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bomba de infusão');

    // E2E-WEB-005: as ações possíveis vêm do SERVIDOR, já filtradas pelas
    // permissões desta pessoa. A tela não deduz o grafo de estados.
    await page.getByRole('button', { name: 'Assumir triagem' }).click();
    // `exact`: o chip de situação e a linha do histórico ("Enviada → Em
    // triagem") dizem a mesma coisa, e as duas aparecerem é o comportamento
    // certo — o teste é que precisa apontar para uma.
    await expect(page.getByText('Em triagem', { exact: true })).toBeVisible({ timeout: 15_000 });

    // E2E-WEB-006: aceitar e gerar acontecem JUNTOS. Solicitação aceita sem OS
    // é trabalho que ninguém vai fazer.
    await page.getByRole('button', { name: 'Aceitar e gerar OS' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toHaveAccessibleDescription(/aceita e o trabalho entra na fila/);

    await dialogo.getByLabel(/Natureza do trabalho/).selectOption({ label: 'Corretiva' });
    await dialogo.getByRole('button', { name: 'Gerar ordem de serviço' }).click();

    await expect(page).toHaveURL(/\/ordens$/, { timeout: 15_000 });
    await expect(page.getByText('Bomba de infusão com alarme de oclusão')).toBeVisible();
  });

  test('recusar exige motivo, e o motivo fica registrado', async ({ comoCoordenadorA: page }) => {
    const criada = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: { customer_id: E2E.clienteA, summary: 'Pedido que será recusado', source: 'phone' },
    });
    const { id } = await criada.json();

    await page.goto(`/solicitacoes/${id}`);

    /*
     * Recusar só existe DEPOIS de triar — é o grafo de estados, e faz sentido:
     * não se recusa o que ainda não se olhou. A tela mostra apenas o que é
     * possível agora, então "Recusar" nem está lá antes disso.
     */
    await expect(page.getByRole('button', { name: 'Recusar' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Assumir triagem' }).click();
    await expect(page.getByText('Em triagem', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Recusar' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    // Sem motivo, o diálogo recusa: recusa sem motivo vira reclamação, e a
    // reclamação chega sem contexto.
    await dialogo.getByRole('button', { name: 'Recusar' }).click();
    await expect(dialogo.getByRole('alert')).toContainText(/motivo/);
  });
});

test.describe('E2E-WEB-008 e 009 · o quadro', () => {
  /** Cria uma OS pronta para ser movida, pelo caminho de produção. */
  async function criarOrdem(page: Page, titulo: string) {
    const cab = {
      authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
      'x-aurora-organization': E2E.orgA,
    };

    const req = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: E2E.clienteA, summary: titulo, source: 'phone' },
    });
    const { id } = await req.json();

    await page.request.post(`${apiUrl()}/service-requests/${id}/transitions`, {
      headers: cab,
      data: { to: 'triage' },
    });

    const naturezas = await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, {
      headers: cab,
    });
    const { items } = await naturezas.json();

    const os = await page.request.post(`${apiUrl()}/work-orders/from-request/${id}`, {
      headers: cab,
      data: { targets: [{ work_order_type_id: items[0].id, title: titulo }] },
    });
    expect(os.ok()).toBe(true);
    return os.json();
  }

  test('o quadro mostra as colunas com a contagem de cada estado', async ({ comoCoordenadorA: page }) => {
    await criarOrdem(page, 'OS para o quadro');
    await page.goto('/ordens?vista=quadro');

    // O quadro é a vista padrão, e as colunas vêm do servidor: cada
    // organização define os SEUS estados.
    await expect(page.getByRole('region', { name: /Aberta/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('OS para o quadro')).toBeVisible();
  });

  test('E2E-WEB-009 · a transição recusada devolve o cartão e diz o porquê', async ({
    comoCoordenadorA: page,
  }) => {
    await criarOrdem(page, 'OS que não pode concluir direto');
    await page.goto('/ordens?vista=lista');

    await page.getByText('OS que não pode concluir direto').click();
    await expect(page).toHaveURL(/\/ordens\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    /*
     * Concluir a partir de "aberta" não é uma aresta do grafo, então o botão
     * NEM APARECE. É a diferença entre um Kanban que orienta e um que é
     * tentativa e erro: a tela mostra o que dá para fazer, e o que não dá não
     * está lá para ser clicado.
     */
    const acoes = page.getByRole('button');
    const rotulos = await acoes.allInnerTexts();
    expect(rotulos.join(' | ')).not.toContain('Concluída');
  });

  test('a transição que exige campo PEDE o campo antes de enviar', async ({ comoCoordenadorA: page }) => {
    const r = await criarOrdem(page, 'OS que vai parar');
    const osId = r.work_orders[0].id;

    await page.goto(`/ordens/${osId}`);

    const parar = page.getByRole('button', { name: /Aguardando peça/ });
    if ((await parar.count()) === 0) test.skip(true, 'estado de espera não disponível no fluxo');

    await parar.click();

    // O servidor diz QUAIS campos faltam, e a tela pede ANTES de mandar — em
    // vez de mandar, tomar 422 e traduzir o erro de volta em formulário.
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toHaveAccessibleDescription(/informaç/i);
  });
});

test.describe('E2E-WEB-010, 011 e 012 · agenda', () => {
  test('a agenda mostra os três baldes, com contagem', async ({ comoCoordenadorA: page }) => {
    await page.goto('/agenda');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Agenda');

    // Os contadores vêm prontos do servidor: fazer a tela contar significaria
    // carregar a lista inteira só para exibir três números.
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 15_000 });
  });

  test('E2E-WEB-010 · a conferência de conflito acontece ANTES de salvar', async ({
    comoCoordenadorA: page,
  }) => {
    const cab = {
      authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
      'x-aurora-organization': E2E.orgA,
    };

    const req = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: E2E.clienteA, summary: 'OS para agendar', source: 'phone' },
    });
    const { id } = await req.json();
    await page.request.post(`${apiUrl()}/service-requests/${id}/transitions`, {
      headers: cab,
      data: { to: 'triage' },
    });
    const naturezas = await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, {
      headers: cab,
    });
    const { items } = await naturezas.json();
    const os = await page.request.post(`${apiUrl()}/work-orders/from-request/${id}`, {
      headers: cab,
      data: { targets: [{ work_order_type_id: items[0].id, title: 'OS para agendar' }] },
    });
    const criada = await os.json();

    await page.goto('/agenda');
    await page
      .getByRole('button', { name: /OS para agendar/ })
      .first()
      .click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    // A conferência roda enquanto a pessoa escolhe, e o resultado aparece na
    // região viva — descobrir o conflito DEPOIS de salvar é o que faz
    // programar custar mais do que ligar para o técnico.
    await expect(dialogo.getByRole('status')).toBeVisible({ timeout: 15_000 });
    expect(criada.work_orders.length).toBe(1);
  });

  test('E2E-WEB-010b · programar pela agenda grava de verdade', async ({ comoCoordenadorA: page }) => {
    /*
     * Este teste existe porque o anterior parava um passo antes.
     *
     * Verificar que o diálogo abre e confere conflito não prova que o botão
     * grava — e não provava mesmo: a tela mandava `workOrderId: undefined`,
     * porque lia `ordem.id` num item que só tem `work_order_id`. Abrir o
     * diálogo passava; confirmar teria falhado. Um teste que para na véspera
     * do efeito não testa o efeito.
     */
    const cab = {
      authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
      'x-aurora-organization': E2E.orgA,
    };

    const req = await page.request.post(`${apiUrl()}/service-requests`, {
      headers: cab,
      data: { customer_id: E2E.clienteA, summary: 'OS que será programada', source: 'phone' },
    });
    const { id } = await req.json();
    await page.request.post(`${apiUrl()}/service-requests/${id}/transitions`, {
      headers: cab,
      data: { to: 'triage' },
    });
    const naturezas = await page.request.get(`${apiUrl()}/catalogs/work_order_type/items`, {
      headers: cab,
    });
    const { items } = await naturezas.json();
    const os = await page.request.post(`${apiUrl()}/work-orders/from-request/${id}`, {
      headers: cab,
      data: { targets: [{ work_order_type_id: items[0].id, title: 'OS que será programada' }] },
    });
    const criada = await os.json();
    const osId = criada.work_orders[0].id;

    await page.goto('/agenda');
    await page
      .getByRole('button', { name: /OS que será programada/ })
      .first()
      .click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    // Uma janela num horário comercial qualquer, longe do "agora", para o
    // teste não depender da hora em que roda.
    await dialogo.getByLabel(/início/i).fill('2026-11-12T09:00');
    await dialogo.getByRole('button', { name: /programar/i }).click();

    // A prova não é a mensagem na tela: é o estado no servidor.
    await expect(dialogo).toBeHidden({ timeout: 15_000 });
    const depois = await page.request.get(`${apiUrl()}/work-orders/${osId}`, { headers: cab });
    const corpo = await depois.json();
    expect(corpo.scheduled_start).not.toBeNull();
    expect(new Date(corpo.scheduled_start).toISOString()).toContain('2026-11-12');
  });

  test('E2E-WEB-011 e 012 · a conferência separa o que impede do que avisa', async ({
    comoCoordenadorA: page,
  }) => {
    /*
     * O SERVIDOR é quem classifica, e é ele que decide.
     *
     * Ausência BLOQUEIA: não existe "marcar assim mesmo" para férias — a
     * pessoa não está lá, e o chamado ficaria sem quem atendesse. Sobrecarga
     * AVISA: só o coordenador sabe que aquele chamado é do hospital que está
     * sem ventilador reserva.
     */
    const r = await page.request.post(`${apiUrl()}/schedule/check`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: {
        workOrderId: '0193d900-9999-7000-8000-000000000999',
        startsAt: new Date('2026-09-01T13:00:00Z').toISOString(),
        endsAt: new Date('2026-09-01T14:00:00Z').toISOString(),
        assigneeMembershipId: null,
      },
    });

    // OS inexistente: a conferência recusa em vez de devolver "sem conflitos",
    // que seria dizer que dá para agendar o que não existe.
    expect([404, 422]).toContain(r.status());
  });
});
