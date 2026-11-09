/**
 * Aurora — Qualidade · "Serviços concluídos" (pedido de Anderson, 06/11/2026).
 *
 * O cartão mostra o que o servidor devolveu — tipo, situação, cliente/setor/equipamento, plano,
 * procedimentos (um por resposta), parecer — e os dois caminhos de volta: a ficha da OS e o
 * relatório (a folha de impressão). O texto deixa claro que não é certificado.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiClient, OperationDefinition } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { ApiProvider, PermissionsProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, search, ...p }: Record<string, unknown> & { children: ReactNode }) => {
    let href = String(to);
    for (const [k, v] of Object.entries((params as Record<string, string>) ?? {}))
      href = href.replace(`$${k}`, v);
    const q = new URLSearchParams((search as Record<string, string>) ?? {}).toString();
    return (
      <a href={q ? `${href}?${q}` : href} {...(p as object)}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

import { ServicosConcluidos } from '../features/qualidade/pagina';

const OS_ID = '0193dd00-0000-7000-8000-0000000000a1';

function Envolver({ children, respostas }: { children: ReactNode; respostas: Record<string, unknown> }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cliente: ApiClient = {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition) => {
      const r = respostas[op.operationId];
      if (r === undefined) throw new Error(`operação sem resposta no teste: ${op.operationId}`);
      return r;
    }) as ApiClient['call'],
  };
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={cliente}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={['document.read', 'work_order.read']}>
                  {children}
                </PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

const REGISTRO = {
  work_order_id: OS_ID,
  number: 'WO-2026-0077',
  title: 'Calibração anual do monitor',
  kind: 'calibration',
  type_label: 'Calibração',
  status_key: 'validated',
  status_label: 'Validada',
  category: 'done',
  customer_id: '0193dd00-0000-7000-8000-0000000000b1',
  customer_name: 'Hospital Exemplo',
  location_name: 'UTI Adulto',
  asset_id: '0193dd00-0000-7000-8000-0000000000c1',
  asset_name: 'Monitor multiparamétrico',
  asset_tag: 'PAT-0099',
  asset_serial: 'SN-123',
  completed_at: '2026-11-05T14:00:00.000Z',
  validated_at: '2026-11-06T10:00:00.000Z',
  closed_at: null,
  operational_result: 'released',
  executor_name: 'Técnica Um',
  plan_id: '0193dd00-0000-7000-8000-0000000000d1',
  plan_name: 'Calibrações 2026',
  plan_task_name: 'Calibração anual',
  procedures: [
    {
      response_id: '0193dd00-0000-7000-8000-0000000000e1',
      template_id: '0193dd00-0000-7000-8000-0000000000e2',
      title: 'Protocolo de calibração de monitor',
      version: 2,
      procedure_kind: 'calibration',
    },
  ],
  measurement_sessions: 1,
  signatures: 0,
};

describe('Qualidade · Serviços concluídos', () => {
  it('mostra o serviço com origem, procedimento e os links para a OS e o relatório', async () => {
    render(
      <Envolver respostas={{ 'quality.serviceRecords': { items: [REGISTRO] } }}>
        <ServicosConcluidos />
      </Envolver>
    );
    await waitFor(() => expect(screen.getByText(/WO-2026-0077/)).toBeTruthy());
    const lista = screen.getByRole('list', { name: 'Serviços concluídos' }).textContent ?? '';
    expect(lista).toContain('Calibração');
    expect(lista).toContain('Validada');
    expect(lista).toContain('Hospital Exemplo · UTI Adulto · Monitor multiparamétrico · patrimônio PAT-0099');
    expect(lista).toContain('Plano: Calibrações 2026 — Calibração anual');
    expect(lista).toContain('Protocolo de calibração de monitor (v2)');
    expect(lista).toContain('Liberado para uso');
    expect(lista).toContain('1 sessão(ões) de medição');
    expect(screen.getByRole('link', { name: 'Abrir OS' }).getAttribute('href')).toBe(`/ordens/${OS_ID}`);
    expect(
      screen.getByRole('link', { name: 'Relatório de serviço da WO-2026-0077' }).getAttribute('href')
    ).toBe(`/ordens/${OS_ID}?modo=impressao`);
    expect(document.body.textContent).toContain('Não é certificado');
  });

  it('sem resultado, explica quando o serviço aparece', async () => {
    render(
      <Envolver respostas={{ 'quality.serviceRecords': { items: [] } }}>
        <ServicosConcluidos />
      </Envolver>
    );
    await waitFor(() => expect(screen.getByText('Nenhum serviço concluído com estes filtros')).toBeTruthy());
  });
});
