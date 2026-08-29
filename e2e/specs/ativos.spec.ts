/**
 * Aurora — parque de ativos, no navegador (EPIC-005).
 *
 * O que estes testes perseguem é a diferença entre "a tela mostra" e "o
 * servidor manda": a árvore de locais é um FILTRO DE SERVIDOR, e o teste que
 * confirmasse apenas que a lista encolheu na tela não distinguiria um recorte
 * real de um `display: none`.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

test.describe('EPIC-005 · parque de ativos', () => {
  test('a árvore recorta a lista, e o recorte inclui a subárvore', async ({ comoCoordenadorA: page }) => {
    await page.goto('/ativos');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Sem recorte: os dois ativos da organização.
    await expect(page.getByRole('link', { name: /Ventilador Alfa-1/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /Monitor Alfa-2/ })).toBeVisible();

    // A unidade é a raiz; expandir revela o setor.
    await page.getByRole('button', { name: /Expandir Unidade Alfa/ }).click();
    await page.getByRole('button', { name: 'UTI Alfa', exact: true }).click();

    /*
     * O VENTILADOR está NA UTI; o MONITOR está num leito DENTRO da UTI.
     *
     * Escolher a UTI tem de trazer os dois. Se trouxesse só o ventilador, o
     * filtro estaria comparando o local exato em vez do prefixo do caminho — e
     * o sintoma no uso real seria uma unidade inteira parecendo vazia porque
     * os equipamentos estão nas salas, e não no andar.
     */
    await expect(page.getByRole('link', { name: /Ventilador Alfa-1/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /Monitor Alfa-2/ })).toBeVisible();
    expect(page.url()).toContain('local=');

    // O recorte sobrevive ao recarregamento: um filtro que se perde é um
    // filtro que a pessoa refaz cinco vezes por dia.
    await page.reload();
    await expect(page.getByRole('link', { name: /Monitor Alfa-2/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a busca por texto filtra sem ida ao servidor, e diz quantos sobraram', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ativos');
    await expect(page.getByRole('link', { name: /Ventilador Alfa-1/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('searchbox').fill('Monitor');
    await expect(page.getByRole('link', { name: /Ventilador Alfa-1/ })).toBeHidden();
    await expect(page.getByRole('link', { name: /Monitor Alfa-2/ })).toBeVisible();
    // Diz "1 de 2", e não só "1": saber que havia dois é o que impede a pessoa
    // de concluir que o parque tem um equipamento.
    await expect(page.getByText('1 de 2')).toBeVisible();
  });

  test('a ficha responde "vale a pena consertar de novo?"', async ({ comoCoordenadorA: page }) => {
    const cab = {
      authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
      'x-aurora-organization': E2E.orgA,
    };
    const lista = await page.request.get(`${apiUrl()}/assets`, { headers: cab });
    const { items } = await lista.json();
    const ativo = items.find((a: { name: string }) => a.name.includes('Ventilador'));

    await page.goto(`/ativos/${ativo.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ventilador Alfa-1');

    // O histórico fica na primeira dobra: é o que responde à pergunta cara.
    await expect(page.getByText('Histórico de atendimentos')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nenhum atendimento registrado')).toBeVisible();

    // Idade sem data de origem é NULA, e não zero: zero diria "novo".
    await expect(page.getByText('Sem data de origem')).toBeVisible();
  });

  test('sem permissão financeira, o bloco de valores não existe na página', async ({
    comoCoordenadorA: page,
  }) => {
    const cabCoord = {
      authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
      'x-aurora-organization': E2E.orgA,
    };
    const lista = await page.request.get(`${apiUrl()}/assets`, { headers: cabCoord });
    const { items } = await lista.json();
    const ativo = items[0];

    /*
     * A PROVA É DA REDE.
     *
     * Conferir que o cartão "Valores" não aparece provaria apenas que ele não
     * foi renderizado. A pergunta é se o número SAIU do servidor — e a
     * resposta se lê no corpo, com a credencial de quem não pode vê-lo.
     */
    const daAuditoria = await page.request.get(`${apiUrl()}/assets/${ativo.id}`, {
      headers: {
        authorization: `Bearer local:${E2E.emailAuditora}:${E2E.emailAuditora}`,
        'x-aurora-organization': E2E.orgA,
      },
    });
    expect(daAuditoria.ok()).toBe(true);
    const corpo = await daAuditoria.json();
    expect(corpo.purchase_value).toBeNull();
    expect(corpo.replacement_value).toBeNull();
    expect(corpo.internal_notes).toBeNull();
  });
});
