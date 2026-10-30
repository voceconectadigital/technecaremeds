/**
 * Aurora — telas da ordem de serviço: itens da auditoria de 29/10/2026.
 *
 *   · OS-17 — "Concluir" só habilita sem pendência, e a tela diz o que falta e onde;
 *   · OS-07 — o passo "Preencher OS" mostra cliente, equipamento, local (nome), check-in e defeito;
 *   · OS-18 — nenhum "Salvar rascunho" no procedimento/checklist nem no "Preencher OS";
 *   · OS-12 — passo Anexos pergunta "Há anexos?", segue sem anexo e aceita documento/manual (PDF);
 *   · OS-20 · OS-26 — a folha de impressão traz tudo o que a OS registrou, seção por seção;
 *   · OS-24 — a assinatura de quem validou o laudo aparece com e-mail e resumo SHA-256;
 *   · OS-03 · ORC-01 · CLI-07 — sem o recurso de orçamento, sem etapas de orçamento nem botão;
 *   · OS-01 — a aba "Negados" pede a situação `denied` e as outras abas não misturam negados.
 *
 * A API é um cliente falso (como em `shell.test.tsx`) e o roteador é substituído: o que se prova
 * aqui é a tela; a conversa com a API de verdade está em `api-os-auditoria-29-10.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiClient, OperationDefinition, WorkOrderDetail } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { ApiProvider, PermissionsProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: ReactNode }) => <a {...(p as object)}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

import {
  CartaoConcluir,
  PassoAnexos,
  PassoPreencherOS,
  PassoProcedimento,
  faltasParaConcluir,
} from '../features/ordens/executar';
import { FolhaDeImpressao } from '../features/ordens/folha-de-impressao';
import { AndamentoDaOs, etapasDaOs } from '../features/ordens/orcamento-da-os';
import { AssinaturaDoLaudo, podeGerarOrcamento } from '../features/ordens/ficha';
import { ABAS_DA_LISTA, consultaDaAba, itensDaAba } from '../features/ordens/lista';

const ID = '0193dd00-0000-7000-8000-0000000000a1';

function clienteFalso(respostas: Record<string, unknown>): ApiClient {
  return {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition) => {
      const r = respostas[op.operationId];
      if (r === undefined) throw new Error(`operação sem resposta no teste: ${op.operationId}`);
      return r;
    }) as ApiClient['call'],
  };
}

function Envolver({
  children,
  respostas = {},
  permissions = [],
}: {
  children: ReactNode;
  respostas?: Record<string, unknown>;
  permissions?: string[];
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={clienteFalso(respostas)}>
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

const OS = {
  id: ID,
  number: 'WO-2026-0042',
  title: 'Monitor alarmando',
  status_label: 'Em execução',
  status_key: 'in_progress',
  status_category: 'in_progress',
  customer_name: 'Hospital Santa Clara',
  asset_name_snapshot: 'Monitor multiparamétrico',
  asset_serial_snapshot: 'PAT-0099',
  location_name_snapshot: 'UTI Adulto',
  description: 'Alarme de SpO2 dispara sem paciente.',
  work_order_type_label: 'Corretiva',
  service_description: 'Troca do sensor de SpO2.',
  service_observations: 'Cabo reserva entregue ao setor.',
  operational_result: 'stopped',
  final_opinion: 'Aguarda placa nova.',
  resolution: null,
  created_at: '2026-10-28T12:00:00.000Z',
  started_at: '2026-10-28T13:00:00.000Z',
  completed_at: null,
  quote_summary: null,
  uses_quotes: true,
  available_transitions: [],
} as unknown as WorkOrderDetail;

const CHECKIN = {
  id: '0193dd00-0000-7000-8000-0000000000b1',
  kind: 'check_in',
  occurred_at: '2026-10-28T13:05:00.000Z',
  membership_id: '0193dd00-0000-7000-8000-0000000000c1',
  person_name: 'Operador',
  latitude: -19.9191,
  longitude: -43.9386,
  accuracy_m: 12,
  position_source: 'device',
  justification: null,
  mine: true,
};

const CHECKLIST = {
  id: '0193dd00-0000-7000-8000-0000000000d1',
  template_id: '0193dd00-0000-7000-8000-0000000000d2',
  template_key: 'monitor-preventiva',
  template_version: 3,
  status: {},
  items: [
    {
      id: '0193dd00-0000-7000-8000-0000000000e1',
      kind: 'boolean',
      label: 'Alarmes funcionam',
      required: true,
    },
    {
      id: '0193dd00-0000-7000-8000-0000000000e2',
      kind: 'number',
      label: 'Tensão da bateria',
      required: false,
      unit: 'V',
    },
  ],
  answers: [
    {
      item_id: '0193dd00-0000-7000-8000-0000000000e1',
      value_text: null,
      value_number: null,
      value_boolean: true,
      value_options: null,
      value_date: null,
      photo_count: null,
      verdict: 'pass',
    },
  ],
};

/* -------------------------------------------------------------------------- */

describe('OS-17 — Concluir só com os critérios obrigatórios', () => {
  it('o que falta vem da descrição e da lista do servidor, com o passo onde se resolve', () => {
    expect(faltasParaConcluir({ service_description: '' }, { ok: true, missing: [] })).toEqual([
      'Descrição do serviço (passo Preencher OS)',
    ]);
    const faltas = faltasParaConcluir(
      { service_description: 'Troca do sensor de SpO2.' },
      {
        ok: false,
        missing: [
          {
            requirement: 'operational_result',
            label: 'parecer do equipamento (LIBERADO ou PARADO)',
            detail: '',
          },
          { requirement: 'checklist_complete', label: 'checklist preenchido por completo', detail: '1 de 2' },
          // A descrição vai como resolução no clique: com 10+ caracteres, não é pendência.
          { requirement: 'resolution_filled', label: 'descrição da resolução', detail: '' },
        ],
      }
    );
    expect(faltas).toEqual([
      'Parecer do equipamento (LIBERADO ou PARADO) (passo Parecer final)',
      'Checklist preenchido por completo (passo Procedimento)',
    ]);
  });

  it('com pendência, o botão fica desabilitado e a lista diz o que falta', () => {
    render(
      <Envolver>
        <CartaoConcluir
          faltas={['Parecer do equipamento (LIBERADO ou PARADO) (passo Parecer final)']}
          disponivel
          situacao="Em execução"
          verificando={false}
          ocupado={false}
          concluida={false}
          erro={null}
          onConcluir={() => {}}
        />
      </Envolver>
    );
    expect(screen.getByRole('button', { name: /Concluir ordem de serviço/ })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('list', { name: 'O que falta para concluir' }).textContent).toMatch(/Parecer/);
  });

  it('sem pendência habilita e conclui; o retorno é visível na tela', async () => {
    const onConcluir = vi.fn();
    const { rerender } = render(
      <Envolver>
        <CartaoConcluir
          faltas={[]}
          disponivel
          situacao="Em execução"
          verificando={false}
          ocupado={false}
          concluida={false}
          erro={null}
          onConcluir={onConcluir}
        />
      </Envolver>
    );
    const botao = screen.getByRole('button', { name: /Concluir ordem de serviço/ });
    expect(botao).toHaveProperty('disabled', false);
    expect(screen.getByText(/Pode concluir/)).toBeTruthy();
    await userEvent.click(botao);
    expect(onConcluir).toHaveBeenCalledTimes(1);

    rerender(
      <Envolver>
        <CartaoConcluir
          faltas={[]}
          disponivel
          situacao="Concluída"
          verificando={false}
          ocupado={false}
          concluida
          erro={null}
          onConcluir={onConcluir}
        />
      </Envolver>
    );
    expect(screen.getByRole('status').textContent).toMatch(/Ordem de serviço concluída/);
    expect(screen.getByRole('button', { name: /Concluir ordem de serviço/ })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('a recusa do servidor aparece na tela, e verificando ainda não habilita', () => {
    render(
      <Envolver>
        <CartaoConcluir
          faltas={[]}
          disponivel
          situacao="Em execução"
          verificando
          ocupado={false}
          concluida={false}
          erro="O servidor recusou: falta Parecer do equipamento."
          onConcluir={() => {}}
        />
      </Envolver>
    );
    expect(screen.getByRole('alert').textContent).toMatch(/O servidor recusou/);
    expect(screen.getByRole('button', { name: /Concluir ordem de serviço/ })).toHaveProperty(
      'disabled',
      true
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-07 · OS-18 — Preencher OS e procedimento, sem "Salvar rascunho"', () => {
  const respostas = {
    'workOrders.visits': { items: [CHECKIN] },
    'workOrders.parts': { items: [] },
    'workOrders.customerParts': { items: [] },
  };

  it('OS-07: mostra cliente, equipamento, local pelo nome, check-in e defeito alegado', async () => {
    render(
      <Envolver respostas={respostas}>
        <PassoPreencherOS id={ID} os={OS} />
      </Envolver>
    );
    expect(screen.getByText('Hospital Santa Clara')).toBeTruthy();
    expect(screen.getByText('Monitor multiparamétrico')).toBeTruthy();
    expect(screen.getByText('UTI Adulto')).toBeTruthy();
    expect(screen.getByText('Alarme de SpO2 dispara sem paciente.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(new Date(CHECKIN.occurred_at).toLocaleString('pt-BR'))).toBeTruthy()
    );
    // Descrição e observações já vêm com o que está gravado.
    expect(screen.getByDisplayValue('Troca do sensor de SpO2.')).toBeTruthy();
    expect(screen.getByDisplayValue('Cabo reserva entregue ao setor.')).toBeTruthy();
    expect(screen.queryByText(/rascunho/i)).toBeNull();
  });

  it('OS-18: o procedimento grava resposta a resposta — nenhum "Salvar rascunho"', async () => {
    render(
      <Envolver
        respostas={{ 'workOrders.checklists': { items: [CHECKLIST] } }}
        permissions={['work_order.execute']}
      >
        <PassoProcedimento id={ID} />
      </Envolver>
    );
    await waitFor(() => expect(screen.getByText('Alarmes funcionam')).toBeTruthy());
    expect(screen.getByText(/Cada resposta é gravada na hora/)).toBeTruthy();
    expect(screen.queryByText(/rascunho/i)).toBeNull();
    const rotulos = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(rotulos.some((r) => /rascunho/i.test(r))).toBe(false);
    expect(rotulos).toContain('Gravar');
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-12 — passo Anexos', () => {
  it('pergunta se há anexos; "Não" segue sem anexo; "Sim" abre fotos e documento/manual (PDF)', async () => {
    render(
      <Envolver respostas={{ 'workOrders.attachments': { items: [] } }}>
        <PassoAnexos id={ID} />
      </Envolver>
    );
    expect(screen.getByRole('radiogroup', { name: 'Há anexos para esta OS?' })).toBeTruthy();
    expect(screen.queryByText('Documento ou manual')).toBeNull();

    await userEvent.click(screen.getByLabelText('Não, seguir sem anexo'));
    expect(screen.getByRole('status').textContent).toMatch(/Sem anexos nesta OS/);

    await userEvent.click(screen.getByLabelText('Sim, anexar'));
    expect(screen.getByText('Foto ANTES')).toBeTruthy();
    expect(screen.getByText('Foto DEPOIS')).toBeTruthy();
    expect(screen.getByText('Documento ou manual')).toBeTruthy();
    const doc = screen.getByLabelText(/Escolher documento/) as HTMLInputElement;
    expect(doc.getAttribute('accept')).toContain('application/pdf');
    expect(doc.hasAttribute('capture')).toBe(false);
  });

  it('quem já anexou cai direto no "Sim", com o documento listado', async () => {
    render(
      <Envolver
        respostas={{
          'workOrders.attachments': {
            items: [
              {
                id: '0193dd00-0000-7000-8000-0000000000f1',
                purpose: 'document',
                file_name: 'manual.pdf',
                content_type: 'application/pdf',
                byte_size: '2048',
                sha256: 'a'.repeat(64),
                taken_at: null,
                uploaded_at: '2026-10-28T14:00:00.000Z',
                uploaded_by_name: 'Operador',
                checklist_answer_id: null,
              },
            ],
          },
        }}
      >
        <PassoAnexos id={ID} />
      </Envolver>
    );
    await waitFor(() => expect(screen.getByText(/manual\.pdf/)).toBeTruthy());
    expect((screen.getByLabelText('Sim, anexar') as HTMLInputElement).checked).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-20 · OS-26 · OS-24 — folha de impressão completa', () => {
  const ASSINATURA = {
    id: '0193dd00-0000-7000-8000-000000000101',
    signer_name: 'Gestora',
    signed_at: '2026-10-29T10:00:00.000Z',
    still_valid: true,
    signer_role: 'supervisor',
    signer_email: 'gestora@hospital.test',
    method: 'session',
    client_ip: '10.0.0.7',
    signed_content_sha256: 'b'.repeat(64),
  };
  const tudo = {
    'workOrders.visits': { items: [CHECKIN] },
    'workOrders.checklists': { items: [CHECKLIST] },
    'workOrders.parts': {
      items: [
        {
          id: '0193dd00-0000-7000-8000-000000000201',
          kind: 'consume',
          item_name: 'Sensor SpO2',
          item_sku: 'SP-1',
          warehouse_name: 'Central',
          qty: '1',
          unit: 'un',
        },
      ],
    },
    'workOrders.customerParts': { items: [] },
    'workOrders.attachments': {
      items: [
        {
          id: '0193dd00-0000-7000-8000-000000000301',
          purpose: 'before',
          file_name: 'antes.jpg',
          content_type: 'image/jpeg',
          byte_size: '1000',
          sha256: 'c'.repeat(64),
          taken_at: null,
          uploaded_at: '2026-10-28T13:10:00.000Z',
          uploaded_by_name: 'Operador',
          checklist_answer_id: null,
        },
      ],
    },
    'workOrders.timeEntries': { items: [], total_minutes: 95, open_entries: 0 },
    'workOrders.evaluation': {
      evaluation: {
        id: '0193dd00-0000-7000-8000-000000000401',
        work_order_id: ID,
        rating: 5,
        comment: 'Atendimento rápido.',
        evaluated_at: '2026-10-29T09:00:00.000Z',
        evaluator_name: 'Enfermeira Chefe',
        signature_id: '0193dd00-0000-7000-8000-000000000402',
      },
      can_evaluate: false,
    },
    'workOrders.signatures': { items: [ASSINATURA] },
  };

  it('traz dados técnicos, check-in, checklist com respostas, serviço, parecer, peças, anexos, avaliação e assinaturas', async () => {
    const pronta = vi.fn();
    const { container } = render(
      <Envolver respostas={tudo}>
        <FolhaDeImpressao os={OS} onPronta={pronta} />
      </Envolver>
    );
    await waitFor(() => expect(pronta).toHaveBeenCalled());
    const secoes = [...container.querySelectorAll('[data-secao]')].map((s) => s.getAttribute('data-secao'));
    expect(secoes).toEqual([
      'dados',
      'checkin',
      'checklist',
      'servico',
      'parecer',
      'pecas',
      'anexos',
      'avaliacao',
      'assinaturas',
    ]);
    const texto = screen.getByTestId('folha-de-impressao').textContent ?? '';
    expect(texto).toContain('Monitor multiparamétrico');
    expect(texto).toContain('PAT-0099');
    expect(texto).toContain('Alarmes funcionam');
    expect(texto).toContain('Sim');
    expect(texto).toContain('EQUIPAMENTO PARADO');
    expect(texto).toContain('Sensor SpO2');
    expect(texto).toContain('antes.jpg');
    expect(texto).toContain('Nota 5 de 5');
    expect(texto).toContain('gestora@hospital.test');
    expect(texto).toContain('b'.repeat(64));
    expect(texto).toContain('Não é assinatura ICP-Brasil');
  });

  it('seção sem dado não sai no papel', async () => {
    const pronta = vi.fn();
    const { container } = render(
      <Envolver
        respostas={{
          ...tudo,
          'workOrders.visits': { items: [] },
          'workOrders.checklists': { items: [] },
          'workOrders.parts': { items: [] },
          'workOrders.attachments': { items: [] },
          'workOrders.evaluation': { evaluation: null, can_evaluate: false },
          'workOrders.signatures': { items: [] },
        }}
      >
        <FolhaDeImpressao os={{ ...OS, operational_result: null, final_opinion: null }} onPronta={pronta} />
      </Envolver>
    );
    await waitFor(() => expect(pronta).toHaveBeenCalled());
    const secoes = [...container.querySelectorAll('[data-secao]')].map((s) => s.getAttribute('data-secao'));
    expect(secoes).toEqual(['dados', 'servico']);
  });

  it('OS-24: o laudo mostra a assinatura de quem validou, com e-mail, IP e SHA-256', async () => {
    render(
      <Envolver respostas={{ 'workOrders.signatures': { items: [ASSINATURA] } }}>
        <AssinaturaDoLaudo id={ID} />
      </Envolver>
    );
    await waitFor(() => expect(screen.getByText('Gestora')).toBeTruthy());
    const t = screen.getByTestId('assinatura-do-laudo').textContent ?? '';
    expect(t).toContain('gestora@hospital.test');
    expect(t).toContain('IP 10.0.0.7');
    expect(t).toContain('b'.repeat(64));
  });
});

/* -------------------------------------------------------------------------- */

describe('OS-03 · ORC-01 · CLI-07 — orçamento só quando a organização usa', () => {
  it('sem o recurso, as etapas de orçamento somem do andamento', () => {
    expect(etapasDaOs({ uses_quotes: true, quote_summary: null })).toContain('Orçamento aprovado');
    const sem = etapasDaOs({ uses_quotes: false, quote_summary: null });
    expect(sem).not.toContain('Aguardando aprovação do orçamento');
    expect(sem).not.toContain('Orçamento aprovado');
    expect(sem).toContain('Execução');

    render(<AndamentoDaOs os={{ ...OS, uses_quotes: false } as WorkOrderDetail} />);
    const nav = screen.getByRole('navigation', { name: 'Andamento da ordem de serviço' });
    expect(nav.textContent).not.toMatch(/Orçamento aprovado/);
    expect(nav.textContent).toMatch(/Execução/);
  });

  it('o botão "Gerar orçamento" respeita o recurso, a permissão e o estado', () => {
    expect(podeGerarOrcamento(OS, true)).toBe(true);
    expect(podeGerarOrcamento({ ...OS, uses_quotes: false } as WorkOrderDetail, true)).toBe(false);
    expect(podeGerarOrcamento(OS, false)).toBe(false);
    expect(podeGerarOrcamento({ ...OS, status_category: 'closed' } as WorkOrderDetail, true)).toBe(false);
  });
});

describe('OS-01 — aba "Negados" na lista', () => {
  const linha = (id: string, status_key: string) => ({ id, status_key }) as never;

  it('existe a aba, que pede a situação denied; as demais não misturam negados', () => {
    expect(ABAS_DA_LISTA.map((a) => a.label)).toContain('Negados');
    expect(ABAS_DA_LISTA.map((a) => a.label)).not.toContain('Rascunho');
    expect(consultaDaAba('negados')).toEqual({ limit: 200, status: 'denied' });
    expect(consultaDaAba('open')).toEqual({ limit: 200, category: 'open' });
    expect(consultaDaAba('todas')).toEqual({ limit: 200 });
    const itens = [linha('a', 'open'), linha('b', 'denied')];
    expect(itensDaAba('todas', itens).map((o: { id: string }) => o.id)).toEqual(['a']);
    expect(itensDaAba('negados', [linha('b', 'denied')]).map((o: { id: string }) => o.id)).toEqual(['b']);
  });
});
