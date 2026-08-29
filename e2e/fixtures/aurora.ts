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

export const test = base.extend<{ comoCoordenadorA: Page; comoCoordenadorB: Page }>({
  comoCoordenadorA: async ({ page }, use) => {
    await entrarComo(page, { email: E2E.emailCoordA, organizationId: E2E.orgA });
    await use(page);
  },
  comoCoordenadorB: async ({ page }, use) => {
    await entrarComo(page, { email: E2E.emailCoordB, organizationId: E2E.orgB });
    await use(page);
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
