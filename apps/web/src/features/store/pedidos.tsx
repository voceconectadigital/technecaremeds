/**
 * Aurora — pedidos da Store: comprar, acompanhar a entrega e receber a nota fiscal (conversa com o
 * cliente, 21/10/2026). Não há pagamento: é pedido e acompanhamento.
 *
 * Duas pontas na mesma tela:
 *   · o CLIENTE vê os seus pedidos, a previsão de entrega, a linha do tempo e baixa a nota fiscal;
 *     pode cancelar o pedido enquanto ele ainda não foi confirmado;
 *   · a PRESTADORA (quem pode editar orçamento) confirma com a previsão de entrega, despacha, entrega
 *     e anexa a nota fiscal.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, PackageCheck, Paperclip, ShoppingBag } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  Textarea,
  useToast,
} from '@aurora/ui';
import {
  customersList,
  storeOrderCancel,
  storeOrderDetail,
  storeOrderStatus,
  storeOrdersCreate,
  storeOrdersList,
  STORE_ORDER_STATUS_LABELS,
  type Customer,
  type StoreItem,
  type StoreOrderDetail,
  type StoreOrderRow,
} from '@aurora/contracts';
import { ApiError, Can, lerSessaoGuardada, useApi, useApiMutation, useApiQuery } from '@aurora/app-kit';

const TOM = {
  requested: 'info',
  confirmed: 'accent',
  separated: 'accent',
  shipped: 'warn',
  delivered: 'good',
  cancelled: 'neutral',
} as const;

/**
 * O andamento do pedido em uma linha (conversa de 23/10: "aprovado, sendo separado, em trânsito,
 * entregue, para o usuário e para nós como donos do Store vermos"). O passo "Separado" é opcional:
 * pedido despachado direto do aprovado aparece com ele marcado como pulado, não como pendente.
 */
const PASSOS = ['requested', 'confirmed', 'separated', 'shipped', 'delivered'] as const;

export function AndamentoDoPedido({ status }: { status: StoreOrderRow['status'] }) {
  if (status === 'cancelled') return null;
  const atual = PASSOS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Andamento do pedido">
      {PASSOS.map((p, i) => {
        const feito = i < atual || status === 'delivered';
        const agora = i === atual && status !== 'delivered';
        return (
          <li key={p} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className={feito || agora ? 'text-accent' : 'text-subtle'}>
                →
              </span>
            )}
            <span
              aria-current={agora ? 'step' : undefined}
              className={
                'rounded-pill px-2 py-0.5 ' +
                (agora
                  ? 'bg-accent text-on-accent font-semibold'
                  : feito
                    ? 'bg-accent-soft text-accent-text'
                    : 'bg-surface-sunken text-subtle')
              }
            >
              {STORE_ORDER_STATUS_LABELS[p]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function reais(centavos: string | number | null): string {
  return centavos === null
    ? 'Preço sob consulta'
    : (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/* -------------------------------------------------------------------------- */
/* fazer o pedido                                                             */
/* -------------------------------------------------------------------------- */

export type Carrinho = Map<string, number>;

export function DialogoDoPedido({
  itens,
  carrinho,
  onMudar,
  onFechar,
  onFeito,
}: {
  itens: StoreItem[];
  carrinho: Carrinho;
  onMudar: (c: Carrinho) => void;
  onFechar: () => void;
  onFeito: () => void;
}) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [cliente, setCliente] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Customer[] } | undefined };
  const varios = (clientes?.items.length ?? 0) > 1;
  const criar = useApiMutation(storeOrdersCreate, {
    invalidates: [storeOrdersList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  const linhas = [...carrinho.entries()]
    .map(([id, qtd]) => ({ item: itens.find((i) => i.id === id), qtd }))
    .filter((l): l is { item: StoreItem; qtd: number } => Boolean(l.item));
  const total = linhas.reduce(
    (s, l) => (l.item.list_price_cents === null ? s : s + Number(l.item.list_price_cents) * l.qtd),
    0
  );
  const semPreco = linhas.some((l) => l.item.list_price_cents === null);

  function mudarQtd(id: string, texto: string) {
    const n = Number(texto.replace(',', '.'));
    const novo = new Map(carrinho);
    if (!Number.isFinite(n) || n <= 0) novo.delete(id);
    else novo.set(id, n);
    onMudar(novo);
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Fazer pedido"
      description="Os preços são os de lista de hoje e ficam gravados no pedido. Nada é cobrado aqui: você acompanha a entrega e recebe a nota fiscal."
      footer={
        <>
          <Button onClick={onFechar}>Voltar</Button>
          <Button
            variant="primary"
            disabled={linhas.length === 0}
            loading={criar.isPending}
            onClick={() => {
              setErro(null);
              criar.mutate(
                {
                  body: {
                    ...(cliente ? { customer_id: cliente } : {}),
                    items: linhas.map((l) => ({ item_id: l.item.id, quantity: l.qtd })),
                    ...(nota.trim() ? { note: nota.trim() } : {}),
                  },
                },
                {
                  onSuccess: (r) => {
                    toast.success(
                      `Pedido ${(r as { number: string }).number} feito`,
                      'Acompanhe a entrega na aba Pedidos.'
                    );
                    onFeito();
                  },
                }
              );
            }}
          >
            Fazer pedido
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2" aria-label="Itens do pedido">
          {linhas.map(({ item, qtd }) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-control border border-border-subtle p-2"
            >
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-text">{item.name}</span>
                <span className="block text-xs text-muted">{reais(item.list_price_cents)} cada</span>
              </span>
              <Input
                aria-label={`Quantidade de ${item.name}`}
                inputMode="decimal"
                className="w-24"
                defaultValue={String(qtd)}
                onBlur={(e) => mudarQtd(item.id, e.target.value)}
              />
              <Button size="sm" variant="ghost" onClick={() => mudarQtd(item.id, '0')}>
                Tirar
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-right text-sm text-text">
          Total: <strong className="tabular-nums">{reais(total)}</strong>
          {semPreco && (
            <span className="block text-xs text-muted">
              Itens sem preço (sob consulta) ficam fora do total.
            </span>
          )}
        </p>
        {varios && (
          <Field label="Para qual cliente">
            <Select value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Escolha…</option>
              {clientes!.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Observação" hint="Opcional. Ex.: urgência, setor de entrega.">
          <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={2000} />
        </Field>
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
/* a lista e o acompanhamento                                                 */
/* -------------------------------------------------------------------------- */

export function PedidosDaStore() {
  const [aberto, setAberto] = useState<string | null>(null);
  const { data, isLoading, isError } = useApiQuery(storeOrdersList, { query: {} }) as {
    data: { items: StoreOrderRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  const itens = data?.items ?? [];

  if (isLoading) return <SkeletonList rows={3} label="pedidos" />;
  if (isError) {
    return (
      <EmptyState
        icon={<ShoppingBag className="size-5" />}
        title="Não conseguimos carregar agora"
        description="Confira a conexão e tente de novo."
      />
    );
  }
  if (itens.length === 0) {
    return (
      <EmptyState
        icon={<PackageCheck className="size-5" />}
        title="Nenhum pedido ainda"
        description="Adicione itens do catálogo ao pedido: a previsão de entrega e a nota fiscal aparecem aqui."
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Pedidos">
        {itens.map((o) => (
          <li key={o.id}>
            <Card>
              <button
                type="button"
                onClick={() => setAberto(o.id)}
                className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text">{o.number}</span>
                    <StatusChip tone={TOM[o.status]} size="sm">
                      {STORE_ORDER_STATUS_LABELS[o.status]}
                    </StatusChip>
                  </span>
                  <span className="block text-sm text-muted">
                    {o.customer_name} · {o.item_count} {o.item_count === 1 ? 'item' : 'itens'} ·{' '}
                    {dataBr(o.created_at)}
                  </span>
                  <span className="mt-2 block">
                    <AndamentoDoPedido status={o.status} />
                  </span>
                  {o.expected_delivery && o.status !== 'delivered' && o.status !== 'cancelled' && (
                    <span className="block text-sm text-text">
                      Previsão de entrega: {dataBr(o.expected_delivery)}
                    </span>
                  )}
                </span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {reais(o.total_cents)}
                  {o.has_unpriced ? ' + sob consulta' : ''}
                </span>
              </button>
            </Card>
          </li>
        ))}
      </ul>
      {aberto && <DialogoDoAcompanhamento id={aberto} onFechar={() => setAberto(null)} />}
    </>
  );
}

function useArquivoDaNota() {
  const api = useApi();
  const urlDe = (id: string) => `${api.urlFor(storeOrdersList)}/${id}/invoice`;
  const cabecalhos = () => {
    const { token, organizationId } = lerSessaoGuardada();
    return {
      authorization: `Bearer ${token ?? ''}`,
      ...(organizationId ? { 'x-aurora-organization': organizationId } : {}),
    };
  };
  return {
    async subir(id: string, numero: string, arquivo: File): Promise<void> {
      if (arquivo.size > 10 * 1024 * 1024) throw new Error('O arquivo passa de 10 MB.');
      const r = await fetch(urlDe(id), {
        method: 'PUT',
        headers: {
          ...cabecalhos(),
          'content-type': arquivo.type,
          'x-aurora-file-name': encodeURIComponent(arquivo.name),
          'x-aurora-invoice-number': encodeURIComponent(numero),
        },
        body: await arquivo.arrayBuffer(),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(msg?.message ?? `O envio falhou (${r.status}).`);
      }
    },
    async baixar(id: string, nome: string): Promise<void> {
      const r = await fetch(urlDe(id), { headers: cabecalhos() });
      if (!r.ok) throw new Error(`O download falhou (${r.status}).`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

function DialogoDoAcompanhamento({ id, onFechar }: { id: string; onFechar: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nota = useArquivoDaNota();
  const [previsao, setPrevisao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [numeroNf, setNumeroNf] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: o } = useApiQuery(storeOrderDetail, { params: { id } }) as {
    data: StoreOrderDetail | undefined;
  };
  const refrescar = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('storeOrders.') });
  const mudar = useApiMutation(storeOrderStatus, { onError: (e: ApiError) => setErro(e.problem.message) });
  const cancelar = useApiMutation(storeOrderCancel, { onError: (e: ApiError) => setErro(e.problem.message) });

  if (!o) {
    return (
      <Dialog open onOpenChange={(a) => !a && onFechar()} title="Pedido" description="Carregando…">
        <SkeletonList rows={3} label="pedido" />
      </Dialog>
    );
  }

  async function passo(status: StoreOrderDetail['status']) {
    setErro(null);
    try {
      await mudar.mutateAsync({
        params: { id },
        body: {
          status,
          ...(previsao ? { expected_delivery: previsao } : {}),
          ...(observacao.trim() ? { note: observacao.trim() } : {}),
        },
      });
      await refrescar();
      setObservacao('');
    } catch {
      // A mensagem já está na tela (onError).
    }
  }

  async function anexarNota(arquivo: File) {
    setErro(null);
    if (!numeroNf.trim()) {
      setErro('Informe o número da nota fiscal antes de anexar o arquivo.');
      return;
    }
    setOcupado(true);
    try {
      await nota.subir(id, numeroNf.trim(), arquivo);
      toast.success('Nota fiscal anexada');
      await refrescar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const andando =
    o.status === 'requested' ||
    o.status === 'confirmed' ||
    o.status === 'separated' ||
    o.status === 'shipped';
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(a) => !a && onFechar()}
      title={`Pedido ${o.number}`}
      description={`${o.customer_name} · ${STORE_ORDER_STATUS_LABELS[o.status]}${o.requested_by_name ? ` · pedido por ${o.requested_by_name}` : ''}`}
      footer={<Button onClick={onFechar}>Fechar</Button>}
    >
      <div className="flex flex-col gap-4">
        <AndamentoDoPedido status={o.status} />
        {o.expected_delivery && andando && (
          <p className="rounded-control bg-accent-soft px-3 py-2 text-sm text-accent-text">
            Previsão de entrega: <strong>{dataBr(o.expected_delivery)}</strong>
          </p>
        )}
        {o.status === 'delivered' && (
          <p className="rounded-control bg-good-soft px-3 py-2 text-sm text-good-text">
            Entregue em {o.delivered_at ? new Date(o.delivered_at).toLocaleDateString('pt-BR') : '—'}.
          </p>
        )}
        {o.status === 'cancelled' && o.cancel_reason && (
          <p className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-muted">
            Cancelado: {o.cancel_reason}
          </p>
        )}

        <table className="w-full text-sm">
          <caption className="sr-only">Itens do pedido</caption>
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th scope="col">Item</th>
              <th scope="col" className="text-right">
                Qtd
              </th>
              <th scope="col" className="text-right">
                Preço
              </th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id} className="border-t border-border-subtle">
                <td className="py-1.5">
                  {i.name} <span className="text-xs text-muted">({i.sku})</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {Number(i.quantity)} {i.unit}
                </td>
                <td className="py-1.5 text-right tabular-nums">{reais(i.unit_price_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <th scope="row" colSpan={2} className="py-1.5 text-right">
                Total
              </th>
              <td className="py-1.5 text-right font-semibold tabular-nums">
                {reais(o.total_cents)}
                {o.has_unpriced ? ' + sob consulta' : ''}
              </td>
            </tr>
          </tfoot>
        </table>
        {o.note && <p className="text-sm whitespace-pre-wrap text-text">{o.note}</p>}

        <section aria-label="Nota fiscal" className="rounded-control border border-border-subtle p-3">
          <h3 className="text-sm font-semibold text-text">Nota fiscal</h3>
          {o.invoice_file_name ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>
                nº {o.invoice_number} · {o.invoice_file_name}
              </span>
              <Button
                size="sm"
                icon={<Download className="size-4" />}
                onClick={() => void nota.baixar(id, o.invoice_file_name ?? 'nota-fiscal')}
              >
                Baixar nota fiscal
              </Button>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Ainda não anexada: ela aparece aqui quando o pedido for confirmado e faturado.
            </p>
          )}
          <Can permission="quote.update">
            {(o.status === 'confirmed' ||
              o.status === 'separated' ||
              o.status === 'shipped' ||
              o.status === 'delivered') && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Número da nota fiscal">
                  <Input value={numeroNf} onChange={(e) => setNumeroNf(e.target.value)} maxLength={60} />
                </Field>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-control border border-border px-3 text-sm font-medium text-text hover:bg-surface-sunken">
                  <Paperclip aria-hidden="true" className="size-4" />
                  {ocupado ? 'Enviando…' : o.invoice_file_name ? 'Trocar arquivo' : 'Anexar nota fiscal'}
                  <input
                    type="file"
                    aria-label="Arquivo da nota fiscal"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={ocupado}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void anexarNota(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            )}
          </Can>
        </section>

        <section aria-label="Linha do tempo">
          <h3 className="text-sm font-semibold text-text">Linha do tempo</h3>
          <ol className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
            {o.events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="font-medium text-text">
                  {STORE_ORDER_STATUS_LABELS[e.status as keyof typeof STORE_ORDER_STATUS_LABELS] ?? e.status}
                </span>{' '}
                <span className="text-xs text-muted">
                  {new Date(e.occurred_at).toLocaleString('pt-BR')}
                  {e.actor_name ? ` · ${e.actor_name}` : ''}
                </span>
                {e.note && <span className="block text-muted">{e.note}</span>}
              </li>
            ))}
          </ol>
        </section>

        {/* O cliente cancela o pedido enquanto ele não foi confirmado. */}
        {o.status === 'requested' && (
          <Can permission="store.request_quote">
            <Button
              variant="ghost"
              loading={cancelar.isPending}
              onClick={() => {
                const motivo = window.prompt('Por que cancelar este pedido? (mínimo de 5 caracteres)');
                if (!motivo) return;
                setErro(null);
                cancelar.mutate(
                  { params: { id }, body: { reason: motivo } },
                  { onSuccess: () => void refrescar() }
                );
              }}
            >
              Cancelar pedido
            </Button>
          </Can>
        )}

        {/* A prestadora leva o pedido adiante. */}
        <Can permission="quote.update">
          {andando && (
            <div className="flex flex-col gap-2 rounded-control bg-surface-sunken p-3">
              <p className="text-sm font-semibold text-text">Andamento (prestadora)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Previsão de entrega" hint="Obrigatória para aprovar.">
                  <Input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
                </Field>
                <Field label="Observação">
                  <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                {o.status === 'requested' && (
                  <Button variant="primary" loading={mudar.isPending} onClick={() => void passo('confirmed')}>
                    Aprovar pedido
                  </Button>
                )}
                {(o.status === 'confirmed' || o.status === 'separated' || o.status === 'shipped') && (
                  <Button loading={mudar.isPending} disabled={!previsao} onClick={() => void passo(o.status)}>
                    Atualizar previsão de entrega
                  </Button>
                )}
                {o.status === 'confirmed' && (
                  <Button variant="primary" loading={mudar.isPending} onClick={() => void passo('separated')}>
                    Marcar como separado
                  </Button>
                )}
                {(o.status === 'confirmed' || o.status === 'separated') && (
                  <Button
                    variant={o.status === 'separated' ? 'primary' : 'secondary'}
                    loading={mudar.isPending}
                    onClick={() => void passo('shipped')}
                  >
                    Despachar (em trânsito)
                  </Button>
                )}
                {o.status === 'shipped' && (
                  <Button variant="primary" loading={mudar.isPending} onClick={() => void passo('delivered')}>
                    Marcar como entregue
                  </Button>
                )}
                {(o.status === 'requested' || o.status === 'confirmed' || o.status === 'separated') && (
                  <Button variant="ghost" loading={mudar.isPending} onClick={() => void passo('cancelled')}>
                    Cancelar (informe o motivo na observação)
                  </Button>
                )}
              </div>
            </div>
          )}
        </Can>

        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
