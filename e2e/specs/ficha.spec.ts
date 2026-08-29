/**
 * Aurora — a ficha da ordem de serviço, no navegador (EPIC-009).
 *
 * A vigilância de console vale aqui como em todo teste (ver
 * `e2e/fixtures/aurora.ts`), e neste arquivo ela trabalha mais do que parece:
 * a ficha faz cinco chamadas diferentes, cada uma com o seu contrato, e o
 * cliente CONFERE a resposta contra o contrato em desenvolvimento. Uma
 * divergência entre o que a API devolve e o que o contrato declara reprova o
 * teste sem que nenhuma asserção fale disso.
 */
import type { Page } from '@playwright/test';
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

/** Cria uma OS pela API, pelo mesmo caminho que a tela usa. */
async function criarOrdem(
  page: Page,
  titulo: string
): Promise<{ id: string; number: string }> {
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
  const criada = await os.json();
  return criada.work_orders[0];
}

test.describe('EPIC-009 · ficha da ordem de serviço', () => {
  test('as cinco abas abrem, e a URL leva a pessoa de volta à mesma', async ({
    comoCoordenadorA: page,
  }) => {
    const os = await criarOrdem(page, 'OS da ficha completa');
    await page.goto(`/ordens/${os.id}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('OS da ficha completa');

    // A faixa de decisão fica FORA das abas: é o contexto de tudo o que elas
    // dizem, e some da tela seria ler "3h apontadas" sem saber que a OS está
    // parada há dois dias.
    const faixa = page.getByRole('term').filter({ hasText: 'Responsável' });
    await expect(faixa).toBeVisible();

    for (const aba of ['Execução', 'Anexos', 'Conversa', 'Histórico', 'Resumo']) {
      await page.getByRole('tab', { name: aba }).click();
      await expect(page.getByRole('tab', { name: aba })).toHaveAttribute('aria-selected', 'true');
      // O painel conhece a aba que o abriu: sem essa ligação o leitor de tela
      // anuncia "aba 2 de 5" e não sabe dizer o que ela abriu.
      const painel = page.getByRole('tabpanel');
      await expect(painel).toBeVisible();
      await expect(faixa).toBeVisible();
    }

    // A aba viaja na URL: quem manda o link da conversa quer que o outro caia
    // na conversa.
    await page.getByRole('tab', { name: 'Conversa' }).click();
    expect(page.url()).toContain('aba=conversa');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Conversa' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('a nota interna aparece marcada, e some para quem não pode lê-la', async ({
    comoCoordenadorA: page,
  }) => {
    const os = await criarOrdem(page, 'OS com conversa');

    await page.goto(`/ordens/${os.id}?aba=conversa`);

    // Escreve uma nota interna PELA TELA — não pela API. O caminho que a
    // pessoa usa é o caminho que o teste tem de exercitar.
    await page.getByRole('combobox', { name: /quem vê/i }).selectOption('internal');
    await page
      .getByRole('textbox')
      .fill('Terceira vez neste equipamento; avaliar substituição.');
    await page.getByRole('button', { name: 'Publicar' }).click();

    const interna = page.getByText('Terceira vez neste equipamento');
    await expect(interna).toBeVisible({ timeout: 15_000 });
    // Marcada de forma inconfundível: quem escreve para o cliente por engano
    // é quem estava lendo a outra conversa.
    await expect(page.getByText('o cliente não vê')).toBeVisible();

    await page.getByRole('combobox', { name: /quem vê/i }).selectOption('customer');
    await page.getByRole('textbox').fill('Peça encomendada, previsão de quinta.');
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Peça encomendada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('o cliente vê', { exact: true })).toBeVisible();

    /*
     * A PROVA QUE IMPORTA é a da rede, e não a da tela.
     *
     * Conferir que o texto sumiu do DOM provaria apenas que ele foi escondido.
     * A pergunta é se ele SAIU do servidor — porque um campo escondido por CSS
     * já viajou, já está no cache do dispositivo e já pode ser lido por quem
     * abrir as ferramentas de desenvolvedor.
     */
    const daAuditoria = await page.request.get(`${apiUrl()}/work-orders/${os.id}/comments`, {
      headers: {
        authorization: `Bearer local:${E2E.emailAuditora}:${E2E.emailAuditora}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    expect(daAuditoria.ok()).toBe(true);
    const corpo = await daAuditoria.json();
    expect(corpo.items.map((c: { visibility: string }) => c.visibility)).toEqual(['customer']);
    expect(JSON.stringify(corpo.items)).not.toContain('avaliar substituição');
    // E o seletor de destino não aparece para quem não pode escolher: oferecer
    // "nota interna" a quem não pode escrevê-la é um botão que só falha depois
    // de a pessoa ter digitado o texto.
    expect(corpo.can_write_internal).toBe(false);
  });

  test('a aba de execução diz quando o total de horas está incompleto', async ({
    comoCoordenadorA: page,
  }) => {
    const os = await criarOrdem(page, 'OS com cronômetro esquecido');

    // Um cronômetro iniciado e não parado — o defeito operacional mais comum
    // do apontamento. O total NÃO pode se apresentar como se estivesse
    // completo.
    await page.request.post(`${apiUrl()}/work-orders/${os.id}/timer/start`, { headers: cab });

    await page.goto(`/ordens/${os.id}?aba=execucao`);
    await expect(page.getByText(/cronômetro ainda correndo/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('em curso')).toBeVisible();
  });

  test('sem dados, cada aba explica o vazio em vez de mostrar nada', async ({
    comoCoordenadorA: page,
  }) => {
    // Vazio e erro são coisas diferentes, e uma OS recém-aberta sem peça, sem
    // anexo e sem conversa é o caso COMUM — não uma falha.
    const os = await criarOrdem(page, 'OS recém-aberta');

    await page.goto(`/ordens/${os.id}?aba=anexos`);
    await expect(page.getByText('Nenhum anexo')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Conversa' }).click();
    await expect(page.getByText('Nada dito ainda')).toBeVisible();

    await page.getByRole('tab', { name: 'Execução' }).click();
    await expect(page.getByText('Nenhuma hora apontada')).toBeVisible();
    await expect(page.getByText('Nenhuma peça movimentada')).toBeVisible();
  });
});
