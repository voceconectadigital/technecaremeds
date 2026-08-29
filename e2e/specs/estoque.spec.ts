/**
 * Aurora — estoque, no navegador (EPIC-015).
 *
 * A massa tem um item ABAIXO do mínimo de propósito: uma massa em ordem faria
 * estes testes passarem contra uma tela vazia, que é o mesmo erro da spec de
 * console que dava sete telas limpas visitando telas sem dado dentro.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('EPIC-015 · estoque', () => {
  test('abre no que está acabando, e não num relatório que alguém precisa lembrar de rodar', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/estoque');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Estoque');

    // A aba padrão é a pergunta do dia.
    await expect(page.getByRole('tab', { name: /Abaixo do mínimo/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // O filtro HEPA tem 3 e mínimo 10; a válvula tem 20 e nenhum mínimo.
    await expect(page.getByText('Filtro HEPA')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Válvula de exalação')).toBeHidden();

    // "Sem mínimo definido" não é "mínimo zero": o item não vigiado fica fora.
    await page.getByRole('tab', { name: /Todos os saldos/ }).click();
    await expect(page.getByText('Válvula de exalação')).toBeVisible({ timeout: 15_000 });
  });

  test('o extrato abre em gaveta, sem tirar a pessoa da lista', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/estoque?aba=tudo');
    await page.getByRole('button', { name: /Válvula de exalação/ }).click();

    const gaveta = page.getByRole('dialog');
    await expect(gaveta).toBeVisible();
    await expect(gaveta.getByText('Extrato')).toBeVisible({ timeout: 15_000 });
    await expect(gaveta.getByText('Recebimento')).toBeVisible();

    // Os três números, e a diferença entre eles é o produto.
    await expect(gaveta.getByText('Em mãos')).toBeVisible();
    await expect(gaveta.getByText('Reservado')).toBeVisible();
    await expect(gaveta.getByText('Disponível')).toBeVisible();
  });

  test('o ajuste pede a CONTAGEM, e não a diferença', async ({ comoCoordenadorA: page }) => {
    await page.goto('/estoque?aba=tudo');
    await page.getByRole('button', { name: /Válvula de exalação/ }).click();

    const gaveta = page.getByRole('dialog');
    await gaveta.getByRole('button', { name: 'Ajustar saldo' }).click();

    // Pelo NOME acessível, e não por texto contido: a gaveta de fora tem o
    // botão "Ajustar saldo" dentro dela, e um localizador por texto pegaria as
    // duas, e o `toBeHidden` falharia contra a gaveta errada.
    const dialogo = page.getByRole('dialog', { name: 'Ajustar saldo' });

    /*
     * PEDIR A DIFERENÇA obrigaria quem está com a prateleira na frente a fazer
     * a subtração de cabeça — e a errar o sinal, que é o erro que produz um
     * ajuste no dobro do tamanho, na direção contrária.
     *
     * A tela pede o que foi contado e mostra a diferença calculada.
     */
    await dialogo.getByLabel(/Quanto há na prateleira/).fill('18');
    await expect(dialogo.getByText(/O ajuste será de/)).toBeVisible();
    await expect(dialogo.getByText('-2')).toBeVisible();

    // Sem motivo, não sai do lugar.
    await dialogo.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialogo.getByText(/Escreva o motivo/)).toBeVisible();

    await dialogo
      .getByLabel('Motivo')
      .fill('duas unidades danificadas no transporte, descartadas');
    await dialogo.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialogo).toBeHidden({ timeout: 15_000 });

    // A PROVA É DO SERVIDOR: o saldo mudou de verdade.
    const saldos = await page.request.get(`${apiUrl()}/inventory/balances`, { headers: cab });
    const { items } = await saldos.json();
    const valvula = items.find((b: { sku: string }) => b.sku === 'VAL-ALFA');
    expect(Number(valvula.on_hand)).toBe(18);
  });

  test('a contagem que bate não vira ajuste', async ({ comoCoordenadorA: page }) => {
    // Um ajuste de zero é uma linha no razão que não diz nada e confunde quem
    // conferir o extrato depois.
    await page.goto('/estoque?aba=tudo');
    await page.getByRole('button', { name: /Filtro HEPA/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ajustar saldo' }).click();

    const dialogo = page.getByRole('dialog', { name: 'Ajustar saldo' });
    await dialogo.getByLabel(/Quanto há na prateleira/).fill('3');
    await dialogo.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialogo.getByText(/bate com o sistema/)).toBeVisible();
    await expect(dialogo).toBeVisible();
  });
});
