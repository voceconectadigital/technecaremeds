/**
 * Aurora — indicadores, no navegador (EPIC-021).
 *
 * O que estes testes perseguem não é o número — é o que vem GRUDADO nele. Um
 * painel que mostra "92%" sem dizer sobre o quê passa em qualquer teste que
 * olhe só o valor, e é exatamente esse painel que a §25 existe para impedir.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('EPIC-021 · indicadores', () => {
  test('cada indicador traz a definição a um clique', async ({ comoCoordenadorA: page }) => {
    await page.goto('/indicadores');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Indicadores');

    // Os três agrupamentos existem, e separam volume de tempo de prevenção:
    // somar "abertas" com "MTTR" não significa nada, e a separação é o que
    // impede a leitura errada.
    // `exact`: "Tempo" também é começo de "Tempo de primeira resposta" e de
    // "MTTR — tempo médio de reparo", e o Playwright recusa localizador
    // ambíguo — corretamente.
    for (const grupo of ['Volume', 'Tempo', 'Prevenção']) {
      await expect(page.getByRole('heading', { name: grupo, exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await page.getByRole('button', { name: /Como .* é calculado/ }).first().click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText('O que é contado')).toBeVisible();
    await expect(dialogo.getByText('Dividido por')).toBeVisible();
    await expect(dialogo.getByText('O que fica de fora')).toBeVisible();

    /*
     * O AVISO DE COMPARABILIDADE É O CAMPO QUE MAIS IMPORTA.
     *
     * A auditoria não conseguiu confirmar a fórmula da referência para várias
     * métricas. Sem este aviso, alguém compara os dois números, encontra
     * diferença, e conclui que o sistema novo está errado.
     */
    await expect(dialogo.getByText('Antes de comparar com o sistema antigo')).toBeVisible();
  });

  test('o período fica na URL e sobrevive ao recarregamento', async ({
    comoCoordenadorA: page,
  }) => {
    // Um recorte que se perde é um recorte refeito toda vez — e um painel que
    // não pode ser mandado por link vira captura de tela no WhatsApp.
    await page.goto('/indicadores');
    await page.getByLabel('Início do período').fill('2026-01-01');
    await page.getByLabel('Fim do período').fill('2026-06-30');

    expect(page.url()).toContain('de=2026-01-01');
    expect(page.url()).toContain('ate=2026-06-30');

    await page.reload();
    await expect(page.getByLabel('Início do período')).toHaveValue('2026-01-01');
    await expect(page.getByLabel('Fim do período')).toHaveValue('2026-06-30');
  });

  test('período invertido é recusado com explicação, e não com número errado', async ({
    comoCoordenadorA: page,
  }) => {
    // Calcular sobre um intervalo invertido devolveria zero, e zero se parece
    // com "nada aconteceu" — que é a leitura errada mais cara possível.
    await page.goto('/indicadores?de=2026-06-30&ate=2026-01-01');
    await expect(page.getByText('O fim do período vem antes do início')).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('EPIC-021 · a resposta e o contrato', () => {
  test('nenhum dos nove indicadores cai no cartão de erro', async ({ comoCoordenadorA: page }) => {
    /*
     * ESTE TESTE FECHA UM BURACO DOS OUTROS.
     *
     * O cartão de erro existe para o painel não sumir inteiro quando uma
     * consulta falha — e é uma boa propriedade. Mas ele também ENGOLE, em
     * silêncio, uma divergência entre a resposta e o contrato: em
     * desenvolvimento o cliente confere a resposta contra o contrato e lança,
     * a consulta entra em erro, e o cartão mostra "não pôde ser calculado".
     *
     * Sem esta asserção, os testes acima passariam com os nove indicadores
     * quebrados — eles só olham a definição, que vem do catálogo e não da
     * consulta.
     */
    await page.goto('/indicadores');

    // Espera os nove terminarem de carregar antes de julgar.
    await expect(page.getByRole('heading', { name: 'Prevenção', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });

    await expect(page.getByText('não pôde ser calculado agora')).toHaveCount(0);

    // E os nove cartões existem: um painel com sete cartões passaria na
    // asserção acima sem que ninguém notasse os dois que sumiram.
    await expect(page.getByRole('button', { name: /Como .* é calculado/ })).toHaveCount(9);
  });
});
