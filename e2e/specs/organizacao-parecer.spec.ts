/**
 * Aurora — Configurações → Organização: o parecer obrigatório na conclusão (PF-41).
 *
 * A persona `comoCoordenadorA` tem o papel de administrador (ver `seed.mjs`),
 * então tem `organization.update`. A regra no servidor (422 sem parecer) e a
 * recusa a quem não administra são provadas nos testes de API
 * (`pente-fino-campo.test.ts`, `pente-fino-lacunas.test.ts`); aqui se prova o
 * caminho da tela: o interruptor nasce desligado, liga, sobrevive ao recarregar
 * e desliga.
 *
 * A regra é da organização inteira e os specs rodam em série (`workers: 1`):
 * o teste devolve o interruptor a desligado no fim, mesmo falhando no meio,
 * para não mudar a conclusão das OS dos specs seguintes.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('Configurações da organização', () => {
  test('o parecer obrigatório liga, persiste e desliga', async ({ comoCoordenadorA: page }) => {
    await page.goto('/configuracoes/organizacao');
    await expect(page.getByRole('heading', { name: 'Execução da OS' })).toBeVisible();

    const interruptor = page.getByRole('switch', { name: /Exigir o parecer do equipamento/ });
    await expect(interruptor).not.toBeChecked();
    await expect(page.getByText('Desligado', { exact: true })).toBeVisible();

    try {
      await interruptor.click();
      await expect(page.getByText('Parecer obrigatório ligado')).toBeVisible({ timeout: 15_000 });
      await expect(interruptor).toBeChecked();

      // Vem do servidor, e não do estado da tela.
      await page.reload();
      await expect(page.getByRole('switch', { name: /Exigir o parecer do equipamento/ })).toBeChecked({
        timeout: 15_000,
      });
      await expect(page.getByText('Ligado', { exact: true })).toBeVisible();
    } finally {
      const atual = page.getByRole('switch', { name: /Exigir o parecer do equipamento/ });
      if (await atual.isChecked()) {
        await atual.click();
        await expect(atual).not.toBeChecked({ timeout: 15_000 });
      }
    }
    await expect(page.getByText('Desligado', { exact: true })).toBeVisible();
  });

  test('a aba aparece no alternador de Configurações', async ({ comoCoordenadorA: page }) => {
    await page.goto('/configuracoes/metas');
    await page
      .getByRole('navigation', { name: 'Configurações', exact: true })
      .getByRole('link', { name: 'Organização', exact: true })
      .click();
    await expect(page).toHaveURL(/\/configuracoes\/organizacao$/);
    await expect(page.getByRole('heading', { name: 'Execução da OS' })).toBeVisible();
  });
});
