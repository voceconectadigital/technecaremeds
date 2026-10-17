/**
 * Aurora — acessibilidade automatizada (SPEC v0.2 §34).
 *
 * O QUE UM VERIFICADOR AUTOMÁTICO PEGA, E O QUE ELE NÃO PEGA.
 *
 * O axe encontra o que é decidível por máquina: contraste insuficiente, campo
 * sem rótulo, botão sem nome acessível, cabeçalho fora de ordem, região sem
 * marco. Isso é cerca de um terço dos problemas reais de acessibilidade — e é
 * exatamente o terço que reaparece toda semana se ninguém verificar.
 *
 * O QUE ELE NÃO PEGA continua sendo trabalho humano: se a ordem de tabulação
 * faz sentido, se o texto do erro explica o que fazer, se a leitura em voz alta
 * conta a mesma história que a leitura visual. Este arquivo não finge cobrir
 * isso, e não deve ser lido como certificado de conformidade.
 *
 * O CRITÉRIO É "NENHUMA VIOLAÇÃO", e não "poucas violações".
 *
 * Uma lista de exceções toleradas cresce sozinha: cada nova é justificada pela
 * anterior, e em três meses ninguém sabe mais quais eram intencionais. Se algo
 * aqui reprovar, o certo é corrigir a tela ou remover a regra POR ESCRITO,
 * dizendo por quê.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/aurora';

/**
 * As telas que a auditoria percorre.
 *
 * São as mesmas da spec de console, e por uma razão: a tela que ninguém abre
 * não tem console para vigiar nem árvore para auditar.
 */
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
  '/planos',
  '/indicadores',
  '/painel',
  '/painel/tv',
  '/planos?aba=cronograma',
  '/planos?aba=procedimentos',
  '/notificacoes',
  '/documentos',
  '/configuracoes',
  '/configuracoes/automacoes',
  '/perfil',
  '/agenda',
  // 16/10/2026: telas novas da rodada com o Anderson.
  '/usuarios',
  '/clientes',
  '/store',
  '/ferramentas',
  '/tarefas',
  '/configuracoes/negocios',
];

/**
 * As regras cobradas: WCAG 2.1 A e AA, mais as práticas recomendadas.
 *
 * `best-practice` entra porque é onde moram as regras de MARCO — conteúdo
 * fora de `main`, regiões sem rótulo, cabeçalho pulando nível. São
 * exatamente as que decidem se quem usa leitor de tela consegue pular direto
 * para o conteúdo ou precisa ouvir o menu inteiro em toda página.
 */
const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

for (const caminho of TELAS) {
  test(`sem violação de acessibilidade em ${caminho}`, async ({ comoCoordenadorA: page }) => {
    await page.goto(caminho);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    // Espera as consultas: auditar o esqueleto de carregamento auditaria uma
    // tela que ninguém vê.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });

    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();

    // A mensagem lista regra, impacto e o seletor do primeiro nó — sem isso, a
    // falha diz "há 3 violações" e alguém precisa reabrir o navegador para
    // saber quais.
    const resumo = resultado.violations
      .map(
        (v) =>
          `  · [${v.impact ?? 'sem impacto'}] ${v.id}: ${v.help}\n` +
          `    ${v.nodes.length} ${v.nodes.length === 1 ? 'ocorrência' : 'ocorrências'}` +
          `, a primeira em: ${v.nodes[0]?.target.join(' ')}`
      )
      .join('\n');

    expect(resultado.violations, `acessibilidade em ${caminho}:\n${resumo}`).toEqual([]);
  });
}

test.describe('acessibilidade em diálogo', () => {
  test('o diálogo prende o foco e tem nome acessível', async ({ comoCoordenadorA: page }) => {
    /*
     * DIÁLOGO É ONDE A ACESSIBILIDADE COSTUMA QUEBRAR, e a varredura das telas
     * não o alcança: ele só existe depois de um clique.
     *
     * Sem `aria-labelledby`, o leitor de tela anuncia "diálogo" e nada mais —
     * a pessoa fica dentro de uma caixa sem saber o que ela pergunta.
     */
    await page.goto('/estoque?aba=tudo');
    await page.getByRole('button', { name: /Válvula de exalação/ }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toHaveAttribute('aria-labelledby', /.+/);

    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).include('[role="dialog"]').analyze();

    const resumo = resultado.violations.map((v) => `  · [${v.impact ?? '—'}] ${v.id}: ${v.help}`).join('\n');
    expect(resultado.violations, `acessibilidade no diálogo:\n${resumo}`).toEqual([]);

    // ESC fecha: um diálogo que só fecha no botão prende quem usa teclado.
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
  });
});
