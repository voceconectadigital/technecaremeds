/**
 * Aurora — planos preventivos, no navegador (EPIC-013).
 *
 * A massa tem um plano com ciclo ABERTO e uma expressão que alcança a
 * subárvore. Sem o ciclo, a tela de cumprimento não teria o que mostrar e o
 * teste passaria contra uma tela vazia.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('EPIC-013 · planos preventivos', () => {
  test('o alternador leva das ordens aos planos, sob o mesmo item de menu', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/ordens');
    await page
      .getByRole('navigation', { name: 'Ordens e planos' })
      .getByRole('link', { name: 'Planos de manutenção' })
      .click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Planos de manutenção');
    expect(page.url()).toContain('/planos');
  });

  test('a lista diz quantas tarefas cada plano tem — plano sem tarefa não gera nada', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos');
    // Pelo PLANO da massa, e não pela tela inteira: outras suítes (o assistente
    // de criação) acrescentam planos à mesma organização, e "o único '1 tarefa'
    // da página" deixa de ser uma afirmação sobre este plano.
    const plano = page.getByRole('link', { name: /Preventiva trimestral Alfa/ });
    await expect(plano).toBeVisible({ timeout: 15_000 });

    // A massa tem uma tarefa; o chip de aviso não deve aparecer.
    await expect(plano.getByText('1 tarefa')).toBeVisible();
    await expect(plano.getByText('Sem tarefa')).toBeHidden();

    // O plano da massa é manual de propósito: a tela precisa dizer isso, senão
    // alguém espera ordens que nunca vão aparecer sozinhas.
    await expect(plano.getByText('Manual')).toBeVisible();
  });

  test('a ficha mostra o cumprimento do ciclo com os itens, e não só o percentual', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos');
    await page.getByRole('link', { name: /Preventiva trimestral Alfa/ }).click();

    // Pelo PAPEL: o texto sozinho casa com o cabeçalho da tarefa e com outro
    // elemento, e Playwright recusa localizador ambíguo — corretamente.
    await expect(page.getByRole('heading', { name: 'Troca de filtro' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/a cada trimestre/)).toBeVisible();
    await expect(page.getByText(/tolerância de 5 dias/)).toBeVisible();

    /*
     * A EXPRESSÃO ALCANÇA A SUBÁRVORE.
     *
     * O ventilador está no setor; o monitor está num leito dentro dele. Os
     * dois têm de aparecer como itens do ciclo — se só o ventilador
     * aparecesse, o alvo estaria comparando o local exato, e o sintoma real
     * seria uma preventiva que ignora tudo que está nas salas.
     */
    await expect(page.getByText('Ventilador Alfa-1')).toBeVisible();
    await expect(page.getByText('Monitor Alfa-2')).toBeVisible();

    // Só o resumo não deixa ninguém agir: a lista diz QUAL equipamento.
    await expect(page.getByText(/no prazo|atrasadas|feitas|dispensadas/).first()).toBeVisible();
  });

  test('pular um item exige motivo', async ({ comoCoordenadorA: page }) => {
    // Pular sem motivo transforma o indicador de cumprimento numa medida do
    // que alguém teve vontade de fazer.
    const planos = await page.request.get(`${apiUrl()}/maintenance-plans`, { headers: cab });
    const { items } = await planos.json();
    // Pelo nome: a lista é ordenada por nome e outras suítes criam planos.
    const plano = items.find((p: { name: string }) => p.name === 'Preventiva trimestral Alfa');

    const detalhe = await page.request.get(`${apiUrl()}/maintenance-plans/${plano.id}`, {
      headers: cab,
    });
    const { tasks } = await detalhe.json();
    const ciclo = tasks[0].open_cycle_id;

    const cumprimento = await page.request.get(`${apiUrl()}/maintenance-plans/cycles/${ciclo}/compliance`, {
      headers: cab,
    });
    const { items: itensDoCiclo } = await cumprimento.json();
    expect(itensDoCiclo.length).toBeGreaterThan(0);

    const semMotivo = await page.request.post(
      `${apiUrl()}/maintenance-plans/cycle-items/${itensDoCiclo[0].id}/skip`,
      { headers: cab, data: { reason: 'ok' } }
    );
    expect(semMotivo.status()).toBe(422);

    const comMotivo = await page.request.post(
      `${apiUrl()}/maintenance-plans/cycle-items/${itensDoCiclo[0].id}/skip`,
      { headers: cab, data: { reason: 'equipamento em comodato, devolvido ao fornecedor' } }
    );
    expect(comMotivo.status()).toBe(201);

    // E o item passa a contar como PULADO, e não como atrasado: a distinção é
    // o que faz o indicador significar algo.
    const depois = await page.request.get(`${apiUrl()}/maintenance-plans/cycles/${ciclo}/compliance`, {
      headers: cab,
    });
    const corpo = await depois.json();
    const item = corpo.items.find((i: { id: string }) => i.id === itensDoCiclo[0].id);
    expect(item.state).toBe('skipped');
  });
});
