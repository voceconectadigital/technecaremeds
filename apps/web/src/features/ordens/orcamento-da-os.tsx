/**
 * Aurora — orçamento a partir da OS e o andamento do fluxo (reunião 16/10/2026, Fase 7).
 *
 * "Gerar orçamento": serviço/hora técnica e peças, com quantidade e valor
 * unitário. O total da tela é só prévia — quem calcula, em CENTAVOS, é o
 * servidor. Valor vai como TEXTO decimal ("150.50"): dinheiro não passa por
 * ponto flutuante entre a tela e o banco.
 *
 * "Andamento": abertura → triagem → agendamento → análise → execução →
 * (aguardando aprovação do orçamento · orçamento aprovado · aguardando peças)
 * → concluído, ou negado. É LIDO da situação da OS, do motivo de espera e do
 * orçamento — nenhum estado novo foi criado para isso.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, Input, Select, cn, useToast } from '@aurora/ui';
import {
  customersAddContact,
  customersContacts,
  inventoryBalances,
  quotesAddItem,
  quotesCreate,
  type CustomerContact,
  type StockBalance,
  type WorkOrderDetail,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';

interface Linha {
  tipo: 'service' | 'part';
  /** Peça vem do catálogo de itens (é ela que o estoque reserva na aprovação). */
  itemId: string;
  descricao: string;
  quantidade: string;
  unitario: string;
}

const DECIMAL = /^\d{1,12}([.,]\d{1,2})?$/;

/** Centavos de um texto decimal, sem float. Inválido → null. */
export function centavos(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!DECIMAL.test(t)) return null;
  const [i, f = ''] = t.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}

export function formatarCentavos(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function DialogoOrcamentoDaOs({ os, onFechar }: { os: WorkOrderDetail; onFechar: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<Linha[]>([
    { tipo: 'service', itemId: '', descricao: 'Hora técnica', quantidade: '1', unitario: '' },
  ]);
  const { can } = usePermissions();
  const em15dias = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const [validade, setValidade] = useState(em15dias);
  const [aprovador, setAprovador] = useState('');
  const [novoContato, setNovoContato] = useState({ nome: '', email: '' });
  const { data: contatos } = useApiQuery(customersContacts, { params: { id: os.customer_id } }) as {
    data: { items: CustomerContact[] } | undefined;
  };
  const { data: saldos } = useApiQuery(
    inventoryBalances,
    { query: {} },
    { enabled: can('inventory.read') }
  ) as {
    data: { items: StockBalance[] } | undefined;
  };
  const itensDoCatalogo = [...new Map((saldos?.items ?? []).map((s) => [s.item_id, s.item_name])).entries()];
  const contato = useApiMutation(customersAddContact, { invalidates: [customersContacts] });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const criar = useApiMutation(quotesCreate, {});
  const item = useApiMutation(quotesAddItem, {});

  const totais = linhas.map((l) => {
    const u = centavos(l.unitario);
    const q = Number(l.quantidade.replace(',', '.'));
    return u === null || !(q > 0) ? null : Math.round(u * q);
  });
  const total = totais.reduce<number>((s, v) => s + (v ?? 0), 0);

  async function gerar() {
    setErro(null);
    const invalida = linhas.findIndex(
      (l, i) => l.descricao.trim().length < 2 || totais[i] === null || (l.tipo === 'part' && !l.itemId)
    );
    if (invalida >= 0) {
      setErro(
        `Linha ${invalida + 1}: descreva, informe quantidade e valor (ex.: 150,00) e, se for peça, escolha o item do catálogo.`
      );
      return;
    }
    if (!validade) {
      setErro('Informe até quando a proposta vale.');
      return;
    }
    setSalvando(true);
    try {
      let aprovadorId = aprovador;
      if (!aprovadorId && novoContato.nome.trim() && novoContato.email.trim()) {
        const c = (await contato.mutateAsync({
          params: { id: os.customer_id },
          body: { name: novoContato.nome.trim(), email: novoContato.email.trim() },
        })) as { id: string };
        aprovadorId = c.id;
      }
      const tem = (t: Linha['tipo']) => linhas.some((l) => l.tipo === t);
      const q = (await criar.mutateAsync({
        body: {
          customerId: os.customer_id,
          workOrderId: os.id,
          nature: tem('part') && tem('service') ? 'parts_and_services' : tem('part') ? 'parts' : 'services',
          validUntil: validade,
          ...(aprovadorId ? { approverContactId: aprovadorId } : {}),
        },
      })) as { id: string };
      for (const l of linhas) {
        await item.mutateAsync({
          params: { id: q.id },
          body: {
            kind: l.tipo,
            ...(l.tipo === 'part' ? { itemId: l.itemId } : {}),
            description: l.descricao.trim(),
            quantity: Number(l.quantidade.replace(',', '.')),
            unitPrice: l.unitario.trim().replace(',', '.'),
          },
        });
      }
      toast.success('Orçamento gerado', 'Revise e envie ao cliente para aprovação.');
      onFechar();
      void navigate({ to: '/orcamentos/$id', params: { id: q.id } });
    } catch (e) {
      setErro(e instanceof ApiError ? e.problem.message : (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title={`Gerar orçamento para ${os.number ?? 'a OS'}`}
      description="Serviço (hora técnica) e peças, com quantidade e valor unitário. Os totais finais são calculados pelo sistema."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={salvando} onClick={() => void gerar()}>
            Gerar orçamento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {linhas.map((l, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[9rem_1fr_6rem_8rem_auto]">
            <Field label="Tipo">
              <Select
                value={l.tipo}
                onChange={(e) =>
                  setLinhas(
                    linhas.map((x, j) => (j === i ? { ...x, tipo: e.target.value as Linha['tipo'] } : x))
                  )
                }
              >
                <option value="service">Serviço / hora técnica</option>
                <option value="part">Peça</option>
              </Select>
            </Field>
            {l.tipo === 'part' ? (
              <Field label="Peça do catálogo">
                <Select
                  value={l.itemId}
                  onChange={(e) => {
                    const nome = itensDoCatalogo.find(([id]) => id === e.target.value)?.[1] ?? '';
                    setLinhas(
                      linhas.map((x, j) => (j === i ? { ...x, itemId: e.target.value, descricao: nome } : x))
                    );
                  }}
                >
                  <option value="">Escolha…</option>
                  {itensDoCatalogo.map(([id, nome]) => (
                    <option key={id} value={id}>
                      {nome}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Descrição">
                <Input
                  value={l.descricao}
                  onChange={(e) =>
                    setLinhas(linhas.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))
                  }
                />
              </Field>
            )}
            <Field label="Qtd.">
              <Input
                inputMode="decimal"
                value={l.quantidade}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="Valor unit. (R$)">
              <Input
                inputMode="decimal"
                placeholder="150,00"
                value={l.unitario}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, unitario: e.target.value } : x)))
                }
              />
            </Field>
            <Button
              variant="ghost"
              aria-label={`Remover linha ${i + 1}`}
              icon={<Trash2 className="size-4" />}
              disabled={linhas.length === 1}
              onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <Button
          size="sm"
          className="self-start"
          icon={<Plus className="size-4" />}
          onClick={() =>
            setLinhas([...linhas, { tipo: 'part', itemId: '', descricao: '', quantidade: '1', unitario: '' }])
          }
        >
          Adicionar linha
        </Button>
        <div className="grid gap-3 border-t border-border-subtle pt-3 sm:grid-cols-2">
          <Field label="Validade da proposta" required>
            <Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          </Field>
          <Field
            label="Quem aprova pelo cliente"
            hint="Obrigatório para ENVIAR. Pode ser indicado agora ou na ficha do orçamento."
          >
            <Select value={aprovador} onChange={(e) => setAprovador(e.target.value)}>
              <option value="">
                {(contatos?.items.length ?? 0) > 0 ? 'Escolha…' : 'Nenhum contato — cadastre abaixo'}
              </option>
              {(contatos?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` · ${c.email}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {!aprovador && (
            <>
              <Field label="Novo contato aprovador — nome">
                <Input
                  value={novoContato.nome}
                  onChange={(e) => setNovoContato({ ...novoContato, nome: e.target.value })}
                />
              </Field>
              <Field label="E-mail do aprovador">
                <Input
                  type="email"
                  value={novoContato.email}
                  onChange={(e) => setNovoContato({ ...novoContato, email: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
        <p className="text-right text-sm text-text" data-numeric>
          Prévia do total: <strong>{formatarCentavos(total)}</strong>
        </p>
        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Andamento                                                                   */
/* -------------------------------------------------------------------------- */

const ETAPAS = [
  'Abertura',
  'Triagem',
  'Agendamento',
  'Análise',
  'Execução',
  'Aguardando aprovação do orçamento',
  'Orçamento aprovado',
  'Aguardando peças',
  'Concluído',
] as const;

export function etapaDaOs(os: WorkOrderDetail): { atual: string; negada: boolean; cancelada: boolean } {
  const q = os.quote_summary?.status;
  if (os.status_key === 'denied') return { atual: 'Negado', negada: true, cancelada: false };
  if (os.status_category === 'cancelled') return { atual: 'Cancelada', negada: false, cancelada: true };
  if (['review', 'done', 'closed'].includes(os.status_category))
    return { atual: 'Concluído', negada: false, cancelada: false };
  if (os.wait_reason_key === 'parts') return { atual: 'Aguardando peças', negada: false, cancelada: false };
  if (os.wait_reason_key === 'quote_approval' || q === 'sent' || q === 'viewed') {
    return { atual: 'Aguardando aprovação do orçamento', negada: false, cancelada: false };
  }
  if (q === 'approved' || q === 'in_execution')
    return { atual: 'Orçamento aprovado', negada: false, cancelada: false };
  if (os.status_category === 'in_progress' || os.status_category === 'waiting') {
    return { atual: 'Execução', negada: false, cancelada: false };
  }
  if (os.status_key === 'in_analysis') return { atual: 'Análise', negada: false, cancelada: false };
  if (os.status_category === 'scheduled') return { atual: 'Agendamento', negada: false, cancelada: false };
  return { atual: os.service_request_number ? 'Triagem' : 'Abertura', negada: false, cancelada: false };
}

export function AndamentoDaOs({ os }: { os: WorkOrderDetail }) {
  const e = etapaDaOs(os);
  const indice = ETAPAS.indexOf(e.atual as (typeof ETAPAS)[number]);
  return (
    <nav aria-label="Andamento da ordem de serviço">
      <ol className="flex flex-wrap gap-1 text-xs">
        {ETAPAS.map((etapa, i) => (
          <li
            key={etapa}
            aria-current={etapa === e.atual ? 'step' : undefined}
            className={cn(
              'rounded-full border px-2.5 py-1',
              etapa === e.atual
                ? 'border-accent bg-accent-soft font-medium text-accent-text'
                : indice >= 0 && i < indice
                  ? 'border-border-subtle text-text'
                  : 'border-border-subtle text-subtle'
            )}
          >
            {etapa}
          </li>
        ))}
        {(e.negada || e.cancelada) && (
          <li
            aria-current="step"
            className="rounded-full border border-bad bg-bad-soft px-2.5 py-1 font-medium text-bad-text"
          >
            {e.atual}
          </li>
        )}
      </ol>
    </nav>
  );
}

/** Rótulo do orçamento visto da OS. */
export function rotuloDoOrcamento(status: string): string {
  return (
    {
      draft: 'Orçamento em elaboração',
      sent: 'Aguardando aprovação do orçamento',
      viewed: 'Aguardando aprovação do orçamento',
      approved: 'Orçamento aprovado',
      in_execution: 'Orçamento aprovado',
      rejected: 'Orçamento reprovado',
      expired: 'Orçamento vencido',
      invoiced: 'Orçamento faturado',
      closed: 'Orçamento fechado',
      cancelled: 'Orçamento cancelado',
    }[status] ?? status
  );
}
