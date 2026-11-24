/**
 * Aurora — telas da rodada de 24/11/2026 (respostas do Anderson e vídeo do assistente de planos).
 *
 *   · o assistente pede o procedimento de CADA equipamento e não deixa avançar sem ele; o setor
 *     aparece com a unidade; o corpo enviado leva um item por equipamento, cada um com o seu;
 *   · o contrato suspenso mostra o motivo e "somente consulta"; suspender pede motivo;
 *   · conclusão da OS cobra a hora de início e de término.
 *
 * A API é um cliente falso; a regra está nos testes de banco e de HTTP.
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
  useRouterState: () => '/planos',
}));

import {
  NovoPlanoDialog,
  faltasDosEquipamentos,
  primeiroVencimento,
  rotuloDoSetor,
} from '../features/planos/novo-plano';
import { ContratosDoCliente } from '../features/clientes/contratos-do-cliente';
import { motivoDoBloqueio, formatarMinutos } from '../features/clientes/atendimento-do-contrato';
import { faltasParaConcluir } from '../features/ordens/executar';
import { paraCampoDeHora } from '../features/ordens/ficha';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const UNIDADE = '22222222-2222-4222-8222-222222222222';
const SETOR = '33333333-3333-4333-8333-333333333333';
const VENT = '44444444-4444-4444-8444-444444444444';
const MON = '55555555-5555-4555-8555-555555555555';
const VENT2 = '66666666-6666-4666-8666-666666666666';

function provedores(client: ApiClient, permissions: string[], filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={client}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={permissions}>{filho}</PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

describe('funções do assistente e da conclusão', () => {
  it('cada equipamento sem procedimento (ou sem data, na educação) é uma falta', () => {
    const f = faltasDosEquipamentos(
      [VENT, MON],
      { [VENT]: { principal: 'p', adicionais: [], data: '' } },
      false,
      '2026-11-24'
    );
    expect([...f.keys()]).toEqual([MON]);
    const e = faltasDosEquipamentos(
      [VENT, MON],
      {
        [VENT]: { principal: '', adicionais: [], data: '2026-11-23' },
        [MON]: { principal: '', adicionais: [], data: '2026-12-01' },
      },
      true,
      '2026-11-24'
    );
    expect(Object.fromEntries(e)).toEqual({ [VENT]: 'a data já passou' });
  });

  it('primeiro vencimento pela âncora e setor com a unidade', () => {
    expect(primeiroVencimento('2026-08-31', 'semester', 1)).toBe('2027-02-28');
    expect(primeiroVencimento('2026-11-24', 'week', 2)).toBe('2026-12-08');
    const locais = [
      { id: UNIDADE, parent_id: null, name: 'Bloco A' },
      { id: SETOR, parent_id: UNIDADE, name: 'UTI Adulto' },
    ] as never[];
    expect(rotuloDoSetor(locais[1]!, locais)).toBe('Bloco A › UTI Adulto');
  });

  it('o aviso de bloqueio do contrato e as horas na conclusão', () => {
    expect(motivoDoBloqueio({ status: 'active', ends_on: '2999-01-01', service_hold: 'blocked' })).toBe(
      'Atendimento bloqueado'
    );
    expect(motivoDoBloqueio({ status: 'expired', ends_on: '2020-01-01', service_hold: null })).toBe(
      'Contrato vencido'
    );
    expect(motivoDoBloqueio({ status: 'active', ends_on: null, service_hold: null })).toBeNull();
    expect(
      faltasParaConcluir(
        { service_description: 'Troca do sensor', service_started_at: null, service_ended_at: null },
        { ok: true, missing: [] }
      )
    ).toEqual(['Hora de início e de término do atendimento (passo Parecer final)']);
    expect(
      faltasParaConcluir(
        {
          service_description: 'Troca do sensor',
          service_started_at: '2026-11-24T12:00:00Z',
          service_ended_at: '2026-11-24T13:00:00Z',
        },
        { ok: true, missing: [] }
      )
    ).toEqual([]);
    expect(formatarMinutos(75)).toBe('1h15');
    expect(paraCampoDeHora(null)).toBe('');
    expect(paraCampoDeHora('2026-11-24T12:05:00')).toBe('2026-11-24T12:05');
  });
});

describe('NovoPlanoDialog — um procedimento por equipamento', () => {
  it('não avança sem o procedimento de cada equipamento e envia um item por equipamento', async () => {
    const chamadas: { op: string; args: unknown }[] = [];
    const client: ApiClient = {
      urlFor: (op: OperationDefinition) => `/v1${op.path}`,
      call: (async (op: OperationDefinition, args: unknown) => {
        chamadas.push({ op: op.operationId, args });
        switch (op.operationId) {
          case 'customers.list':
            return { items: [{ id: CLIENTE, name: 'Hospital Santa Clara' }] };
          case 'customers.detail':
            return {
              locations: [
                { id: UNIDADE, parent_id: null, name: 'Bloco A', location_type_key: 'unidade' },
                {
                  id: SETOR,
                  parent_id: UNIDADE,
                  name: 'UTI Adulto',
                  location_type_key: 'setor',
                  asset_count: 3,
                },
              ],
            };
          case 'contracts.list':
            return { items: [] };
          case 'assets.list':
            return {
              items: [
                {
                  id: VENT,
                  name: 'Ventilador 01',
                  status: 'active',
                  asset_category_id: 'c1',
                  category_name: 'Ventilador',
                },
                {
                  id: VENT2,
                  name: 'Ventilador 02',
                  status: 'active',
                  asset_category_id: 'c1',
                  category_name: 'Ventilador',
                },
                {
                  id: MON,
                  name: 'Monitor 01',
                  status: 'active',
                  asset_category_id: 'c2',
                  category_name: 'Monitor',
                },
              ],
            };
          case 'plans.formOptions':
            return {
              kinds: [
                { key: 'preventive', available: true, work_order_type: 'preventive', procedure_kind: null },
                { key: 'education', available: true, work_order_type: 'training', procedure_kind: null },
              ],
              templates: [
                {
                  key: 'prev_vent',
                  title: 'Preventiva de ventilador',
                  version: 1,
                  procedure_kind: null,
                  item_count: 5,
                },
                {
                  key: 'prev_mon',
                  title: 'Preventiva de monitor',
                  version: 2,
                  procedure_kind: null,
                  item_count: 4,
                },
                {
                  key: 'tse',
                  title: 'TSE geral',
                  version: 1,
                  procedure_kind: 'electrical_safety',
                  item_count: 3,
                },
              ],
            };
          case 'plans.create':
            return {
              id: '77777777-7777-4777-8777-777777777777',
              task_count: 3,
              cycles_opened: 3,
              work_orders: 3,
            };
          default:
            throw new Error(`operação sem resposta no teste: ${op.operationId}`);
        }
      }) as ApiClient['call'],
    };
    render(
      provedores(client, ['maintenance_plan.create'], <NovoPlanoDialog open onOpenChange={() => undefined} />)
    );
    const u = userEvent.setup();
    const d = await screen.findByRole('dialog', { name: 'Novo plano de manutenção' });
    await screen.findByRole('option', { name: 'Hospital Santa Clara' });
    await u.selectOptions(within(d).getByLabelText(/Cliente/), CLIENTE);
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('option', { name: /Bloco A › UTI Adulto/ });
    await u.selectOptions(within(d).getByLabelText(/Setor/), SETOR);
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    await screen.findByText(/Todos os equipamentos de UTI Adulto/);
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    await u.click(within(d).getByRole('button', { name: /Preventiva/ }));
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));

    // Passo Procedimentos: um seletor por equipamento; sem todos escolhidos, não avança.
    await screen.findByLabelText('Procedimento de Ventilador 01');
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('alert').textContent).toMatch(/faltam 3/);
    await u.selectOptions(screen.getByLabelText('Procedimento de Ventilador 01'), 'prev_vent');
    await u.click(screen.getByRole('button', { name: 'Aplicar a todos de Ventilador' }));
    expect((screen.getByLabelText('Procedimento de Ventilador 02') as HTMLSelectElement).value).toBe(
      'prev_vent'
    );
    await u.selectOptions(screen.getByLabelText('Procedimento de Monitor 01'), 'prev_mon');
    await u.click(screen.getByRole('button', { name: 'Adicionar procedimento a Monitor 01' }));
    await u.selectOptions(screen.getByLabelText('Procedimento adicional de Monitor 01'), 'tse');
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    await u.click(within(d).getByRole('button', { name: 'Continuar' }));
    // Revisão: a tabela mostra o procedimento de cada um
    const tabela = await screen.findByRole('table', { name: 'Equipamentos do plano' });
    expect(within(tabela).getByText('Preventiva de monitor + TSE geral')).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Criar plano' }));

    await waitFor(() => expect(chamadas.some((c) => c.op === 'plans.create')).toBe(true));
    const { body } = chamadas.find((c) => c.op === 'plans.create')!.args as { body: Record<string, unknown> };
    expect(body).toMatchObject({
      customer_id: CLIENTE,
      sector_id: SETOR,
      kind: 'preventive',
      items: [
        { asset_id: VENT, checklist_template_key: 'prev_vent', extra_checklist_template_keys: [] },
        { asset_id: VENT2, checklist_template_key: 'prev_vent', extra_checklist_template_keys: [] },
        { asset_id: MON, checklist_template_key: 'prev_mon', extra_checklist_template_keys: ['tse'] },
      ],
    });
  });
});

describe('ContratosDoCliente — atendimento suspenso', () => {
  const CONTRATO = {
    id: '88888888-8888-4888-8888-888888888888',
    number: 'CT-2026-00007',
    title: null,
    customer_id: CLIENTE,
    kind: 'full_service',
    status: 'active',
    starts_on: '2026-01-01',
    ends_on: '2099-12-31',
    auto_renew: true,
    billing_model: 'per_hour',
    billing_model_informed: true,
    covers_all_assets: true,
    service_hold: null as string | null,
    service_hold_reason: null as string | null,
    service_hold_at: null as string | null,
    renewal_count: 0,
  };
  const montar = (contratos: unknown[], permissions: string[]) => {
    const chamadas: { op: string; args: unknown }[] = [];
    const client: ApiClient = {
      urlFor: (op: OperationDefinition) => `/v1${op.path}`,
      call: (async (op: OperationDefinition, args: unknown) => {
        chamadas.push({ op: op.operationId, args });
        if (op.operationId === 'contracts.list') return { items: contratos };
        if (op.operationId === 'contracts.holdService') return { changed: true };
        throw new Error(`operação sem resposta no teste: ${op.operationId}`);
      }) as ApiClient['call'],
    };
    const cliente = {
      id: CLIENTE,
      name: 'Hospital',
      contract_starts_on: null,
      contract_ends_on: null,
    } as unknown as Customer;
    render(provedores(client, permissions, <ContratosDoCliente cliente={cliente} />));
    return chamadas;
  };

  it('suspenso: mostra o motivo, "somente consulta" e o botão de reativar', async () => {
    montar(
      [
        {
          ...CONTRATO,
          service_hold: 'suspended',
          service_hold_reason: 'Inadimplência',
          service_hold_at: '2026-11-24T10:00:00Z',
        },
      ],
      ['contract.read', 'contract.update']
    );
    const linha = await screen.findByTestId('contrato-CT-2026-00007');
    expect(within(linha).getAllByText('Atendimento suspenso').length).toBeGreaterThan(0);
    expect(within(linha).getByRole('status').textContent).toMatch(/Inadimplência.*somente consulta/s);
    expect(within(linha).getByRole('button', { name: 'Reativar atendimento' })).toBeTruthy();
    expect(within(linha).queryByRole('button', { name: 'Suspender atendimento' })).toBeNull();
  });

  it('suspender pede o motivo e manda a retenção certa', async () => {
    const chamadas = montar([CONTRATO], ['contract.read', 'contract.update']);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Suspender atendimento' }));
    const d = await screen.findByRole('dialog', { name: /Suspender o atendimento de CT-2026-00007/ });
    const confirmar = within(d).getByRole('button', { name: 'Suspender' });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    await u.type(within(d).getByLabelText(/Motivo/), 'Inadimplência de outubro');
    await u.click(confirmar);
    await waitFor(() => expect(chamadas.some((c) => c.op === 'contracts.holdService')).toBe(true));
    expect(chamadas.find((c) => c.op === 'contracts.holdService')!.args).toMatchObject({
      params: { id: CONTRATO.id },
      body: { hold: 'suspended', reason: 'Inadimplência de outubro' },
    });
  });

  it('sem permissão de editar, nenhum botão de atendimento', async () => {
    montar([CONTRATO], ['contract.read']);
    await screen.findByTestId('contrato-CT-2026-00007');
    expect(screen.queryByRole('button', { name: 'Suspender atendimento' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renovar' })).toBeNull();
  });
});
