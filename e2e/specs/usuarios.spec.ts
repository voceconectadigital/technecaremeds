/**
 * Aurora — Usuários (reunião 16/10/2026, Fase 1), no navegador.
 *
 * Menu próprio, "Adicionar usuário" com os três perfis de acesso, profissão
 * como cadastro e escopo cliente → setores no mesmo formulário.
 */
import { test, expect, tolera } from '../fixtures/aurora';

test.describe('Usuários', () => {
  test('o menu leva a Usuários e o botão é "Adicionar usuário"', async ({ comoCoordenadorA: page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Usuários' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Usuários');
    await expect(page.getByRole('button', { name: 'Adicionar usuário' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Convidar' })).toHaveCount(0);
  });

  test('o formulário oferece exatamente Operador, Solicitante e Gestor', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/usuarios');
    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    const perfis = page.getByRole('radiogroup', { name: 'Perfil de acesso' });
    await expect(perfis.getByRole('radio')).toHaveCount(3);
    for (const nome of ['Operador', 'Solicitante', 'Gestor']) {
      await expect(perfis.getByText(nome, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Profissão / função')).toBeVisible();
    await expect(page.getByLabel('CPF')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar registro' })).toBeVisible();
  });

  test('adiciona um operador restrito a um cliente e ele aparece na lista', async ({
    comoCoordenadorA: page,
  }) => {
    const email = `operador.${Date.now()}@e2e.test`;
    await page.goto('/usuarios');
    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nome').fill('Olívia Operadora');
    await dialogo.getByLabel('E-mail').fill(email);
    await dialogo.getByLabel('Profissão / função').fill('Técnico(a)');
    // USR-04: técnico exige o registro no CFT — o registro novo já nasce com o tipo da profissão.
    await expect(
      dialogo.getByText('Esta profissão exige o registro no CFT.', { exact: false })
    ).toBeVisible();
    await dialogo.getByRole('button', { name: 'Adicionar registro' }).click();
    await expect(dialogo.getByLabel('Tipo')).toHaveValue('CFT');
    await dialogo.getByLabel('Número').fill('123456');
    await dialogo.getByLabel('Cliente / hospital').selectOption({ index: 1 });
    await dialogo.getByRole('button', { name: 'Adicionar usuário' }).click();
    await expect(dialogo).toBeHidden();

    const linha = page.getByRole('listitem').filter({ hasText: email });
    await expect(linha).toContainText('Operador');
    await expect(linha).toContainText('Técnico(a)');
    await expect(linha).toContainText('Ativo');
  });

  test('CPF inválido é recusado com mensagem no campo', async ({ comoCoordenadorA: page }) => {
    // A recusa (422) é o que este teste provoca de propósito.
    tolera(page, /422/);
    await page.goto('/usuarios');
    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nome').fill('Cecília CPF');
    await dialogo.getByLabel('E-mail').fill(`cpf.${Date.now()}@e2e.test`);
    await dialogo.getByLabel('CPF').fill('111.111.111-11');
    await dialogo.getByRole('button', { name: 'Adicionar usuário' }).click();
    await expect(dialogo.getByText('CPF inválido')).toBeVisible();
  });
});
