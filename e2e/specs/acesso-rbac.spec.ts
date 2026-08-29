/**
 * Aurora — a gaveta de acesso (EPIC-002).
 *
 * O teste persegue a pergunta que a tela existe para responder: "por que essa
 * pessoa não consegue?". Uma tela que mostrasse apenas a lista de permissões
 * passaria por uma versão fraca destes testes — por isso cada caso confere a
 * PROCEDÊNCIA, e não o resultado.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('EPIC-002 · acesso e permissões', () => {
  test('a gaveta diz de qual papel vem cada permissão', async ({ comoCoordenadorA: page }) => {
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pessoas');

    await page.getByRole('button', { name: /Ações para Rafael/ }).click();
    await page.getByRole('menuitem', { name: /Ver acesso e permissões/ }).click();

    const gaveta = page.getByRole('dialog');
    await expect(gaveta).toBeVisible();
    await expect(gaveta).toContainText('Rafael');

    // A procedência é o produto: sem o nome do papel ao lado da permissão, a
    // tela não responde à pergunta que trouxe a pessoa até aqui.
    await expect(gaveta.getByText('work_order.execute')).toBeVisible({ timeout: 15_000 });
    await expect(gaveta.getByText('Técnico').first()).toBeVisible();
  });

  test('a negação aparece em destaque, e o efetivo cai', async ({ comoCoordenadorA: page }) => {
    const membros = await page.request.get(`${apiUrl()}/organizations/current/members`, {
      headers: cab,
    });
    const { items } = await membros.json();
    const tecnico = items.find((m: { email: string }) => m.email === E2E.emailTecA);

    const antes = await page.request.get(
      `${apiUrl()}/memberships/${tecnico.membership_id}/permissions`,
      { headers: cab }
    );
    const corpoAntes = await antes.json();
    expect(corpoAntes.effective).toContain('work_order.complete');

    await page.goto('/configuracoes');
    await page.getByRole('button', { name: /Ações para Rafael/ }).click();
    await page.getByRole('menuitem', { name: /Ver acesso e permissões/ }).click();

    const gaveta = page.getByRole('dialog');
    await expect(gaveta.getByText('work_order.complete')).toBeVisible({ timeout: 15_000 });

    // Abre a exceção pela tela — o caminho que a pessoa usa.
    await gaveta
      .locator('li')
      .filter({ hasText: 'work_order.complete' })
      .getByRole('button', { name: 'Exceção' })
      .first()
      .click();

    const dialogoExcecao = page.getByRole('dialog').filter({ hasText: 'Exceção de permissão' });
    await dialogoExcecao.getByLabel('O que a exceção faz').selectOption('deny');
    await dialogoExcecao
      .getByLabel('Motivo')
      .fill('em treinamento até a avaliação de novembro');
    await dialogoExcecao.getByRole('button', { name: 'Salvar exceção' }).click();

    /*
     * A PROVA É DO SERVIDOR.
     *
     * Conferir que a linha ficou vermelha provaria que o CSS mudou. A pergunta
     * é se a pessoa PERDEU a permissão — e isso só o cálculo de permissões
     * efetivas responde.
     */
    await expect(dialogoExcecao).toBeHidden({ timeout: 15_000 });
    const depois = await page.request.get(
      `${apiUrl()}/memberships/${tecnico.membership_id}/permissions`,
      { headers: cab }
    );
    const corpoDepois = await depois.json();
    expect(corpoDepois.effective).not.toContain('work_order.complete');

    // E o papel CONTINUA concedendo: a linha do papel não some, senão quem
    // remover a exceção depois tem uma surpresa.
    const doPapel = corpoDepois.items.filter(
      (i: { permission_key: string; source: string }) =>
        i.permission_key === 'work_order.complete' && i.source === 'role'
    );
    expect(doPapel.length).toBeGreaterThan(0);
  });

  test('exceção sem motivo não é aceita, e a tela diz por quê', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/configuracoes');
    await page.getByRole('button', { name: /Ações para Rafael/ }).click();
    await page.getByRole('menuitem', { name: /Ver acesso e permissões/ }).click();

    const gaveta = page.getByRole('dialog');
    await expect(gaveta.getByText('work_order.read').first()).toBeVisible({ timeout: 15_000 });
    await gaveta
      .locator('li')
      .filter({ hasText: 'work_order.read' })
      .getByRole('button', { name: 'Exceção' })
      .first()
      .click();

    const dialogoExcecao = page.getByRole('dialog').filter({ hasText: 'Exceção de permissão' });
    await dialogoExcecao.getByRole('button', { name: 'Salvar exceção' }).click();

    // A recusa acontece ANTES de enviar, e explica: uma exceção sem motivo é
    // indistinguível de um engano seis meses depois.
    await expect(dialogoExcecao.getByText(/Escreva o motivo/)).toBeVisible();
    await expect(dialogoExcecao).toBeVisible();
  });
});
