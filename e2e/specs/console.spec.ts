/**
 * Aurora — as telas que nenhum teste de fluxo visita.
 *
 * A vigilância de console vive na fixture e vale para TODO teste (ver
 * `e2e/fixtures/aurora.ts`), então este arquivo não repete a checagem: ele só
 * garante que cada tela principal seja ABERTA por alguém. Tela que ninguém
 * abre não tem console para vigiar.
 *
 * O que este arquivo NÃO prova: que a tela funciona com dado dentro. A agenda
 * vazia passou limpa por dias enquanto a agenda com itens emitia "chave
 * duplicada" a cada renderização — o defeito precisava de uma lista para
 * aparecer. Cobertura de tela vazia é o piso, não o teto; quem prova o resto
 * são os testes de fluxo, que montam o cenário antes de olhar.
 */
import { test, expect } from '../fixtures/aurora';

const TELAS = [
  '/',
  '/solicitacoes',
  '/solicitacoes/nova',
  '/ordens',
  '/ordens?vista=lista',
  '/ativos',
  '/estoque',
  '/contratos',
  '/orcamentos',
  '/agenda',
  '/configuracoes',
];

for (const caminho of TELAS) {
  test(`${caminho} abre sem reclamação`, async ({ comoCoordenadorA: page }) => {
    await page.goto(caminho);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    // Espera as consultas resolverem: o erro que interessa costuma chegar na
    // SEGUNDA renderização, quando os dados enfim aparecem.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  });
}
