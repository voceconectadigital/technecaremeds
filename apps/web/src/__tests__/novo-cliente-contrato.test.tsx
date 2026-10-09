/**
 * Aurora — "Possui contrato?" no diálogo Novo cliente, e o selo do contrato.
 *
 * O tipo de contrato é o PERFIL — Básico, Completo ou Expert — e só aparece,
 * obrigatório, quando a resposta é Sim. A conversa com a API de verdade
 * (contrato em rascunho, 422, 403) está em `api-clientes-contrato.test.ts`;
 * aqui o que se prova é a tela e o corpo que ela manda.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient, OperationDefinition } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import type { ReactNode } from 'react';
import { ApiProvider, PermissionsProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';
import { DialogoNovoCliente } from '../features/clientes/novo-cliente';
import { SeloContratoDoCliente, SeloDePerfil } from '../features/comercial/perfil';

interface Chamada {
  op: string;
  body: Record<string, unknown> | undefined;
}

function clienteFalso(chamadas: Chamada[]): ApiClient {
  return {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition, args?: { body?: Record<string, unknown> }) => {
      chamadas.push({ op: op.operationId, body: args?.body });
      if (op.operationId === 'customers.create') {
        return {
          id: '0193dd00-0001-7000-8000-0000000000c1',
          name: args?.body?.name,
          trade_name: null,
          code: null,
          tax_id: null,
          is_internal: false,
          segment: null,
          status: 'active',
          location_count: 0,
          asset_count: 0,
          has_contract: args?.body?.has_contract === true,
          contract_profile: args?.body?.contract_profile ?? null,
        };
      }
      throw new Error(`operação sem resposta no teste: ${op.operationId}`);
    }) as ApiClient['call'],
  };
}

function Envolver({
  children,
  permissions,
  chamadas,
}: {
  children: ReactNode;
  permissions: string[];
  chamadas: Chamada[];
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={clienteFalso(chamadas)}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={permissions}>{children}</PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

const COM_CONTRATO = ['customer.read', 'customer.create', 'contract.create'];

function abrir(permissions = COM_CONTRATO) {
  const chamadas: Chamada[] = [];
  render(
    <Envolver permissions={permissions} chamadas={chamadas}>
      <DialogoNovoCliente open onOpenChange={() => {}} />
    </Envolver>
  );
  return chamadas;
}

describe('Novo cliente · possui contrato?', () => {
  it('começa em NÃO, e o tipo de contrato fica escondido', () => {
    abrir();
    expect(screen.getByRole('group', { name: 'Possui contrato?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Não' })).toBeChecked();
    expect(screen.queryByLabelText(/Tipo de contrato/)).not.toBeInTheDocument();
  });

  it('NÃO: cadastra sem contrato e sem tipo', async () => {
    const chamadas = abrir();
    await userEvent.type(screen.getByPlaceholderText('Ex.: Hospital São Lucas'), 'Clínica Avulsa');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    await waitFor(() => expect(chamadas).toHaveLength(1));
    expect(chamadas[0]!.body).toEqual({ name: 'Clínica Avulsa' });
  });

  it('SIM: o tipo aparece com exatamente Básico, Completo e Expert', async () => {
    abrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    const tipo = screen.getByLabelText(/Tipo de contrato/);
    const opcoes = Array.from((tipo as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opcoes).toEqual(['Escolha o tipo', 'Básico', 'Completo', 'Expert']);
    expect(opcoes.join(' ')).not.toMatch(/demanda|preventiva|integral/i);
  });

  it('SIM sem tipo: recusa no campo, e nada vai à API', async () => {
    const chamadas = abrir();
    await userEvent.type(screen.getByPlaceholderText('Ex.: Hospital São Lucas'), 'Hospital Sem Tipo');
    await userEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(await screen.findByText(/Escolha o tipo de contrato/)).toBeInTheDocument();
    expect(chamadas).toHaveLength(0);
  });

  it.each([
    ['Básico', 'basic'],
    ['Completo', 'complete'],
    ['Expert', 'expert'],
  ])('SIM + %s: manda o perfil %s', async (rotulo, perfil) => {
    const chamadas = abrir();
    await userEvent.type(screen.getByPlaceholderText('Ex.: Hospital São Lucas'), `Hospital ${rotulo}`);
    await userEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    await userEvent.selectOptions(screen.getByLabelText(/Tipo de contrato/), perfil);
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    await waitFor(() => expect(chamadas).toHaveLength(1));
    expect(chamadas[0]!.body).toEqual({
      name: `Hospital ${rotulo}`,
      has_contract: true,
      contract_profile: perfil,
    });
  });

  it('voltar para NÃO esconde e descarta o tipo escolhido', async () => {
    const chamadas = abrir();
    await userEvent.type(screen.getByPlaceholderText('Ex.: Hospital São Lucas'), 'Hospital Indeciso');
    await userEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    await userEvent.selectOptions(screen.getByLabelText(/Tipo de contrato/), 'expert');
    await userEvent.click(screen.getByRole('radio', { name: 'Não' }));
    expect(screen.queryByLabelText(/Tipo de contrato/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    await waitFor(() => expect(chamadas).toHaveLength(1));
    expect(chamadas[0]!.body).toEqual({ name: 'Hospital Indeciso' });
  });

  it('sem contract.create a pergunta não aparece (declarar é criar contrato)', () => {
    abrir(['customer.read', 'customer.create']);
    expect(screen.queryByRole('group', { name: 'Possui contrato?' })).not.toBeInTheDocument();
  });
});

describe('selo do contrato', () => {
  it('cliente: Sem contrato, ou o perfil — nunca o segmento', () => {
    const { rerender } = render(<SeloContratoDoCliente possui={false} perfil={null} />);
    expect(screen.getByText('Sem contrato')).toBeInTheDocument();
    rerender(<SeloContratoDoCliente possui perfil="basic" />);
    expect(screen.getByText('Básico')).toBeInTheDocument();
    rerender(<SeloContratoDoCliente possui perfil="complete" />);
    expect(screen.getByText('Completo')).toBeInTheDocument();
    rerender(<SeloContratoDoCliente possui perfil="expert" />);
    expect(screen.getByText('Expert')).toBeInTheDocument();
  });

  it('contrato anterior ao perfil diz que o perfil não foi definido — não inventa um', () => {
    render(<SeloDePerfil perfil={null} />);
    expect(screen.getByText('Perfil não definido')).toBeInTheDocument();
  });
});
