/**
 * Aurora — contratos no cadastro do cliente (Anderson, 10/11/2026).
 *
 *   · a ficha lista o contrato do módulo com SLA geral, modalidade, equipes, precificação e pagamento,
 *     cada um no seu lugar — e mantém o relatório incluso e a vigência do cadastro;
 *   · sem contrato, diz que vale o padrão de antes;
 *   · criar manda os três conceitos separados, cobrindo todos os equipamentos e ativando;
 *   · editar não reenvia o início de um contrato vigente; sem permissão, não há botões;
 *   · a ficha do equipamento escreve "SLA geral do contrato" e "exceção" de forma diferente.
 *
 * A API é um cliente falso. A regra (permissões, isolamento, cascata) está nos testes de API e banco.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiClient, Customer, OperationDefinition } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { ApiProvider, PermissionsProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: ReactNode }) => <a {...(p as object)}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouterState: () => '/clientes/x',
}));

import { ContratosDoCliente } from '../features/clientes/contratos-do-cliente';
import { textoDoSlaEfetivo } from '../features/ativos/ficha';

const CLIENTE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Hospital Central',
  report_tier: 'advanced',
  contract_starts_on: '2026-01-01',
  contract_ends_on: '2026-12-31',
  contract_status: 'active',
} as unknown as Customer;

const CONTRATO = {
  id: '22222222-2222-4222-8222-222222222222',
  number: 'CT-2026-00001',
  title: 'Manutenção integral',
  customer_id: CLIENTE.id,
  kind: 'full_service',
  status: 'active',
  starts_on: '2026-01-01',
  ends_on: '2026-12-31',
  auto_renew: false,
  billing_model: 'per_hour',
  sla_policy_id: '33333333-3333-4333-8333-333333333333',
  sla_policy_name: 'SLA 4h',
  service_frequency: 'monthly',
  fixed_team_packages: [1, 10],
  payment_terms: 'upfront',
  covers_all_assets: true,
};

function montar(contratos: unknown[], permissions: string[]) {
  const chamadas: { op: string; args: unknown }[] = [];
  const client: ApiClient = {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition, args: unknown) => {
      chamadas.push({ op: op.operationId, args });
      if (op.operationId === 'contracts.list') return { items: contratos };
      if (op.operationId === 'contracts.options') {
        return { sla_policies: [{ id: CONTRATO.sla_policy_id, name: 'SLA 4h', is_default: false }] };
      }
      if (op.operationId === 'contracts.create' || op.operationId === 'contracts.update')
        return { id: CONTRATO.id };
      throw new Error(`operação sem resposta no teste: ${op.operationId}`);
    }) as ApiClient['call'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={client}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={permissions}>
                  <ContratosDoCliente cliente={CLIENTE} />
                </PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
  return chamadas;
}

describe('ContratosDoCliente', () => {
  it('mostra o contrato com SLA geral, atendimento, precificação e pagamento separados', async () => {
    montar([CONTRATO], ['contract.read']);
    const linha = await screen.findByTestId('contrato-CT-2026-00001');
    expect(within(linha).getByText('Vigente')).toBeTruthy();
    expect(within(linha).getByText('SLA 4h · todos os equipamentos')).toBeTruthy();
    expect(within(linha).getByText('Mensal · Equipe Fixa 1 + Equipe Fixa 10')).toBeTruthy();
    expect(within(linha).getByText('Hora técnica')).toBeTruthy();
    expect(within(linha).getByText('À vista')).toBeTruthy();
    // O cadastro de antes continua: relatório incluso e vigência.
    expect(screen.getByText('Advanced')).toBeTruthy();
    // Sem permissão de escrita, nenhum botão.
    expect(screen.queryByRole('button', { name: /Novo contrato/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar CT-2026-00001/ })).toBeNull();
  });

  it('sem contrato, diz que vale o padrão de antes', async () => {
    montar([], ['contract.read', 'contract.create']);
    expect(await screen.findByText('Nenhum contrato no módulo')).toBeTruthy();
    expect(screen.getByText(/segue o padrão do cliente ou da organização/)).toBeTruthy();
  });

  it('criar envia os três conceitos separados, cobrindo todos os equipamentos e ativando', async () => {
    const chamadas = montar([], ['contract.read', 'contract.create']);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Novo contrato/ }));
    await screen.findByRole('option', { name: 'SLA 4h' });
    await u.selectOptions(screen.getByLabelText('SLA geral do contrato'), 'SLA 4h');
    await u.selectOptions(screen.getByLabelText('Periodicidade das visitas'), 'Quinzenal');
    await u.click(screen.getByLabelText('Equipe Fixa 10'));
    await u.click(screen.getByLabelText('Equipe Fixa 2'));
    await u.selectOptions(screen.getByLabelText('Base de precificação'), 'Por demanda (cada acionamento)');
    await u.selectOptions(screen.getByLabelText('Condição de pagamento'), 'Mensal');
    await u.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(chamadas.some((c) => c.op === 'contracts.create')).toBe(true));
    const { body } = chamadas.find((c) => c.op === 'contracts.create')!.args as {
      body: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      customerId: CLIENTE.id,
      kind: 'full_service',
      startsOn: '2026-01-01', // a vigência do cadastro vem preenchida
      endsOn: '2026-12-31',
      slaPolicyId: CONTRATO.sla_policy_id,
      serviceFrequency: 'biweekly',
      fixedTeamPackages: [2, 10],
      billingModel: 'per_call',
      paymentTerms: 'monthly',
      coverAllAssets: true,
      activate: true,
    });
  });

  it('editar um contrato vigente não reenvia o início e pode limpar a modalidade', async () => {
    const chamadas = montar([CONTRATO], ['contract.read', 'contract.update']);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Editar CT-2026-00001/ }));
    expect((screen.getByLabelText(/^Início/) as HTMLInputElement).disabled).toBe(true);
    await u.selectOptions(screen.getByLabelText('Periodicidade das visitas'), 'Não informada');
    await u.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(chamadas.some((c) => c.op === 'contracts.update')).toBe(true));
    const { params, body } = chamadas.find((c) => c.op === 'contracts.update')!.args as {
      params: { id: string };
      body: Record<string, unknown>;
    };
    expect(params.id).toBe(CONTRATO.id);
    expect(body).not.toHaveProperty('startsOn');
    expect(body).not.toHaveProperty('notes');
    expect(body).toMatchObject({
      serviceFrequency: null,
      fixedTeamPackages: [1, 10],
      paymentTerms: 'upfront',
    });
  });
});

describe('textoDoSlaEfetivo (ficha do equipamento)', () => {
  it('regra geral e exceção nunca saem com o mesmo texto', () => {
    expect(
      textoDoSlaEfetivo({ source: 'contract', policy_name: 'SLA 4h', contract_number: 'CT-2026-00001' })
    ).toBe('SLA 4h — SLA geral do contrato CT-2026-00001');
    expect(
      textoDoSlaEfetivo({ source: 'asset', policy_name: 'SLA 2h', contract_number: 'CT-2026-00001' })
    ).toBe('SLA 2h — exceção deste equipamento');
    expect(textoDoSlaEfetivo({ source: 'organization', policy_name: 'Padrão', contract_number: null })).toBe(
      'Padrão — padrão da organização'
    );
    expect(textoDoSlaEfetivo({ source: 'none', policy_name: null, contract_number: null })).toBe(
      'Sem política de SLA'
    );
  });
});
