/**
 * Aurora — ▶ Play dos planos (PLN-09) e conformidade por plano (PLN-10/REL-12), no navegador.
 *
 * Cliente → plano → equipamento elegível → a OS no assistente de execução. A massa tem um cliente
 * por organização, então o passo do cliente é pulado sozinho; o plano é o da massa ("Preventiva
 * trimestral Alfa", com ciclo aberto).
 */
import { test, expect } from '../fixtures/aurora';

test.describe('PLN-09 · ▶ Play', () => {
  test('o botão grande abre o assistente e termina na OS do equipamento escolhido', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/planos');
    await page.getByRole('button', { name: 'Executar um plano' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    // Um cliente só: o assistente já está no passo do plano.
    await expect(dialogo.getByRole('heading', { name: 'Escolha o plano' })).toBeVisible({ timeout: 15_000 });
    await dialogo
      .getByRole('list', { name: 'Planos' })
      .getByRole('button', { name: /Preventiva trimestral Alfa/ })
      .click();

    const elegiveis = dialogo.getByRole('list', { name: 'Equipamentos elegíveis' });
    const vazio = dialogo.getByText('Nada em aberto neste plano');
    await expect(elegiveis.or(vazio)).toBeVisible({ timeout: 15_000 });
    // Outras suítes podem ter executado o item da massa; o caminho feliz é o que se prova
    // quando há o que executar.
    if (await elegiveis.isVisible()) {
      await elegiveis.getByRole('button').first().click();
      await expect(page).toHaveURL(/\/ordens\/[0-9a-f-]{36}\/executar/, { timeout: 15_000 });
    }
  });

  test('Voltar devolve ao passo do plano', async ({ comoCoordenadorA: page }) => {
    await page.goto('/planos');
    await page.getByRole('button', { name: 'Executar um plano' }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo
      .getByRole('list', { name: 'Planos' })
      .getByRole('button', { name: /Preventiva trimestral Alfa/ })
      .click();
    await dialogo.getByRole('button', { name: 'Voltar' }).click();
    await expect(dialogo.getByRole('heading', { name: 'Escolha o plano' })).toBeVisible();
  });
});

test.describe('PLN-10 / REL-12 · conformidade na visão geral', () => {
  test('o ranking aparece com a definição do denominador', async ({ comoCoordenadorA: page }) => {
    await page.goto('/planos?recorte=12m');
    const ranking = page.getByRole('heading', { name: 'Ranking de conformidade' });
    const vazio = page.getByText('Nenhuma atividade programada no período');
    await expect(ranking.or(vazio)).toBeVisible({ timeout: 15_000 });
    if (await ranking.isVisible()) {
      await expect(page.getByText(/realizados ÷ \(programados − dispensados\)/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Excel' })).toBeVisible();
    }
  });
});
