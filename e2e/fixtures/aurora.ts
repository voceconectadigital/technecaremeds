/**
 * Aurora — apoio dos testes de ponta a ponta.
 *
 * AUTENTICAÇÃO DE TESTE, E POR QUE ELA É SEGURA
 *
 * O provedor local aceita `local:<sujeito>:<e-mail>` e o boot da API RECUSA
 * usá-lo fora de desenvolvimento e teste — está no código do provedor, não na
 * confiança de quem configura. Aqui o teste grava esse token no
 * `localStorage`, que é exatamente onde a aplicação o guarda: entrar pela tela
 * a cada teste custaria segundos por caso e não provaria nada além do que o
 * E2E-WEB-001 já prova uma vez.
 */
import { test as base, expect, type Page } from '@playwright/test';

/** Identificadores da massa determinística (`e2e/fixtures/seed.mjs`). */
export const E2E = {
  orgA: '0193d900-0000-7000-8000-00000000000a',
  orgB: '0193d900-0000-7000-8000-00000000000b',
  clienteA: '0193d900-0003-7000-8000-00000000000a',
  clienteB: '0193d900-0003-7000-8000-00000000000b',
  emailCoordA: 'coord.a@e2e.test',
  emailTecA: 'tec.a@e2e.test',
  emailCoordB: 'coord.b@e2e.test',
  /** Uma pessoa, dois vínculos — a persona do seletor de organização (§05). */
  emailConsultora: 'consultora@e2e.test',
  /**
   * Enxerga a ordem de serviço e NÃO enxerga nota interna nem custo.
   *
   * Existe para provar o negativo. Todo teste de vazamento feito com quem pode
   * ver tudo prova metade: confirma que a informação chega a quem deve, e não
   * diz nada sobre quem não deve.
   */
  emailAuditora: 'auditora@e2e.test',
} as const;

export interface Sessao {
  email: string;
  organizationId: string;
}

/**
 * Entra sem passar pela tela de login.
 *
 * `addInitScript` roda ANTES de qualquer script da página, então a aplicação
 * já monta com sessão — sem a piscada de "entrar" que um `evaluate` depois do
 * carregamento produziria.
 */
export async function entrarComo(page: Page, sessao: Sessao): Promise<void> {
  await page.addInitScript(({ email, organizationId }) => {
    localStorage.setItem('aurora:token', `local:${email}:${email}`);
    localStorage.setItem('aurora:organizacao', organizationId);
  }, sessao);
}

/**
 * Ruído de console REPROVA o teste, em todo teste.
 *
 * Havia uma spec só para isso, visitando telas em jejum. Ela deu sete telas
 * limpas no mesmo dia em que a agenda emitia "chave duplicada" a cada
 * renderização — porque a agenda vazia não tem lista para duplicar chave. O
 * defeito só aparece com dado dentro, e quem tem dado dentro são os testes de
 * fluxo.
 *
 * Então a vigilância deixa de ser uma spec e passa a ser condição de todo
 * teste: quem monta o cenário mais rico é quem melhor observa.
 *
 * Não há isenção por padrão: o teste que provoca uma reclamação de propósito
 * declara qual, com `tolera()`.
 */
const tolerado = new WeakMap<Page, RegExp[]>();

/**
 * Declara que ESTE teste provoca de propósito uma reclamação do navegador.
 *
 * A tolerância é por teste, e nomeada, porque a versão preguiçosa disto — um
 * filtro global ignorando toda resposta 4xx — teria engolido calada as duas
 * falhas que a vigilância achou no primeiro dia: um 422 na lente de recursos
 * e um 422 no catálogo de sintomas. Quem tolera, tolera uma coisa só, e
 * escreve qual.
 */
export function tolera(page: Page, ...padroes: RegExp[]): void {
  tolerado.set(page, [...(tolerado.get(page) ?? []), ...padroes]);
}

async function comConsoleVigiado(page: Page, use: (p: Page) => Promise<void>): Promise<void> {
  const erros: string[] = [];

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    erros.push(m.text());
  });
  // Exceção não capturada é sempre defeito: nenhum teste "espera" um throw
  // que escapou até o topo.
  page.on('pageerror', (e) => erros.push(`exceção não capturada: ${e.message}`));

  await use(page);

  const padroes = tolerado.get(page) ?? [];
  const sobrou = erros.filter((t) => !padroes.some((r) => r.test(t)));
  expect(sobrou, 'o navegador reclamou durante este teste').toEqual([]);
}
export const test = base.extend<{ comoCoordenadorA: Page; comoCoordenadorB: Page }>({
  comoCoordenadorA: async ({ page }, use) => {
    await entrarComo(page, { email: E2E.emailCoordA, organizationId: E2E.orgA });
    await comConsoleVigiado(page, use);
  },
  comoCoordenadorB: async ({ page }, use) => {
    await entrarComo(page, { email: E2E.emailCoordB, organizationId: E2E.orgB });
    await comConsoleVigiado(page, use);
  },
});

export { expect };

/**
 * Cria uma solicitação pela API, para os testes que precisam de uma existindo.
 *
 * Usa a mesma credencial e a mesma rota que a tela usa — não é atalho por
 * dentro do banco. Um arranjo que escreve direto no banco monta um estado que
 * a aplicação não sabe produzir, e o teste passa a provar um mundo que não
 * existe.
 */
export async function criarSolicitacao(
  page: Page,
  input: { email: string; organizationId: string; customerId: string; summary: string }
): Promise<{ id: string; number: string }> {
  const r = await page.request.post(`${apiUrl()}/service-requests`, {
    headers: {
      authorization: `Bearer local:${input.email}:${input.email}`,
      'x-aurora-organization': input.organizationId,
    },
    data: { customer_id: input.customerId, summary: input.summary, source: 'phone' },
  });
  if (!r.ok()) throw new Error(`falha ao criar solicitação: ${r.status()} ${await r.text()}`);
  return r.json();
}

export function apiUrl(): string {
  return process.env.AURORA_E2E_API_URL ?? 'http://localhost:3311/v1';
}
