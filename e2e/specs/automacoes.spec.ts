/**
 * Aurora — automações, no navegador (EPIC-024).
 *
 * A tela existe para impedir a segunda-feira ruim: uma regra ligada sem
 * simulação tem alcance desconhecido, e alcance desconhecido de automação se
 * mede em ordens de serviço abertas durante a madrugada.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('EPIC-024 · automações', () => {
  test('a rota existe e tem porta a partir de Configurações', async ({ comoCoordenadorA: page }) => {
    /*
     * A rota existia e nada levava até ela — que é a mesma coisa que não
     * existir. O alternador é a porta.
     */
    await page.goto('/configuracoes');
    await page
      .getByRole('navigation', { name: 'Configurações' })
      .getByRole('link', { name: 'Automações' })
      .click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Automações');
    expect(page.url()).toContain('/configuracoes/automacoes');
  });

  test('o vazio explica o que uma automação faz', async ({ comoCoordenadorA: page }) => {
    // Vazio EXPLICADO: quem nunca criou uma automação não sabe o que ela é, e
    // uma tela em branco não ensina.
    await page.goto('/configuracoes/automacoes');
    await expect(page.getByText('Nenhuma automação')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/depois de simulada/)).toBeVisible();
  });

  test('a volta para Pessoas mantém o alternador', async ({ comoCoordenadorA: page }) => {
    await page.goto('/configuracoes/automacoes');
    await page
      .getByRole('navigation', { name: 'Configurações' })
      .getByRole('link', { name: 'Pessoas' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pessoas');
    await expect(page.getByRole('navigation', { name: 'Configurações' })).toBeVisible();
  });
});
