/**
 * Aurora — Store (reunião 16/10/2026, Fase 8).
 *
 * Catálogo comercial da organização: o que ela oferece, com descrição e preço
 * de lista. NÃO é o estoque interno — a Store nunca mostra saldo de
 * almoxarifado. O objetivo desta versão é ver, consultar e PEDIR PROPOSTA: o
 * pedido vira oportunidade para o comercial. Não há carrinho, checkout nem
 * pagamento.
 *
 * 21/10/2026 (conversa com o cliente): a Store também recebe PEDIDOS — o cliente monta o pedido, a
 * prestadora confirma com a previsão de entrega, despacha, entrega e anexa a nota fiscal, e o
 * cliente acompanha tudo na aba Pedidos (`pedidos.tsx`). Continua sem pagamento.
 */
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Thumb,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  customersList,
  storeItemsList,
  storeRequestQuote,
  type Customer,
  type StoreItem,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { DialogoDoPedido, PedidosDaStore, type Carrinho } from './pedidos';

function reais(centavos: string | null): string {
  return centavos === null
    ? 'Preço sob consulta'
    : (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function StorePage() {
  const [pedindo, setPedindo] = useState<StoreItem | null>(null);
  const [aba, setAba] = useUrlState<string>('aba', 'catalogo');
  // O carrinho é local: um pedido ainda não feito não é dado do servidor.
  const [carrinho, setCarrinho] = useState<Carrinho>(new Map());
  const [revisando, setRevisando] = useState(false);
  const { data, isLoading, isError, error } = useApiQuery(storeItemsList) as {
    data: { items: StoreItem[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  if (isError) return <ErrorScreen error={error} />;
  const abaAtual = aba === 'pedidos' ? 'pedidos' : 'catalogo';
  const totalDoCarrinho = [...carrinho.entries()].reduce((soma, [id, qtd]) => {
    const preco = data?.items.find((i) => i.id === id)?.list_price_cents;
    return preco === null || preco === undefined ? soma : soma + Number(preco) * qtd;
  }, 0);

  function adicionar(item: StoreItem) {
    setCarrinho((c) => new Map(c).set(item.id, (c.get(item.id) ?? 0) + 1));
  }

  return (
    <AppShell
      title="Store"
      subtitle="Catálogo comercial: compre peças e acessórios, acompanhe a entrega e receba a nota fiscal — ou peça uma proposta."
    >
      <div className="flex flex-col gap-4">
        <Tabs
          idPrefix="store"
          value={abaAtual}
          onChange={setAba}
          aria-label="Store"
          items={[
            { id: 'catalogo', label: 'Catálogo' },
            { id: 'pedidos', label: 'Pedidos' },
          ]}
        />
        <div
          role="tabpanel"
          id={tabIds('store', abaAtual).painel}
          aria-labelledby={tabIds('store', abaAtual).aba}
        >
          {abaAtual === 'pedidos' ? (
            <PedidosDaStore />
          ) : isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (data?.items.length ?? 0) === 0 ? (
            <Card>
              <EmptyState
                icon={<ShoppingBag className="size-5" />}
                title="Nenhuma oferta publicada"
                description="Os itens aparecem aqui quando o estoque os publica na Store (Estoque › Gestão › Itens na Store)."
              />
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data!.items.map((i) => (
                <li key={i.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <Thumb src={i.image_url ?? undefined} name={i.name} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text">{i.name}</p>
                        <p className="text-xs text-muted">
                          {[i.category, i.sku].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    {i.summary && <p className="text-sm text-text">{i.summary}</p>}
                    <p className="mt-auto text-base font-semibold text-text tabular-nums">
                      {reais(i.list_price_cents)}
                    </p>
                    <Can permission="store.request_quote">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => adicionar(i)}>
                          Adicionar ao pedido
                        </Button>
                        <Button onClick={() => setPedindo(i)}>Solicitar proposta</Button>
                      </div>
                    </Can>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        {abaAtual === 'catalogo' && carrinho.size > 0 && (
          <div
            role="region"
            aria-label="Seu pedido"
            className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent bg-surface p-3 shadow-card"
          >
            <span className="text-sm text-text">
              <strong>{carrinho.size}</strong> {carrinho.size === 1 ? 'item' : 'itens'} no pedido ·{' '}
              <strong className="tabular-nums">{reais(String(totalDoCarrinho))}</strong>
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setCarrinho(new Map())}>
                Esvaziar
              </Button>
              <Button variant="primary" onClick={() => setRevisando(true)}>
                Revisar e fazer o pedido
              </Button>
            </div>
          </div>
        )}
      </div>
      {pedindo && <DialogoProposta item={pedindo} onFechar={() => setPedindo(null)} />}
      {revisando && (
        <DialogoDoPedido
          itens={data?.items ?? []}
          carrinho={carrinho}
          onMudar={(c) => {
            setCarrinho(c);
            if (c.size === 0) setRevisando(false);
          }}
          onFechar={() => setRevisando(false)}
          onFeito={() => {
            setCarrinho(new Map());
            setRevisando(false);
            setAba('pedidos');
          }}
        />
      )}
    </AppShell>
  );
}

function DialogoProposta({ item, onFechar }: { item: StoreItem; onFechar: () => void }) {
  const toast = useToast();
  const [qtd, setQtd] = useState('1');
  const [obs, setObs] = useState('');
  const [cliente, setCliente] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Customer[] } | undefined };
  const pedir = useApiMutation(storeRequestQuote, { onError: (e: ApiError) => setErro(e.problem.message) });
  const varios = (clientes?.items.length ?? 0) > 1;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`Solicitar proposta: ${item.name}`}
      description="O pedido vai para o comercial, que responde com orçamento. Nada é cobrado aqui."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pedir.isPending}
            onClick={() =>
              pedir.mutate(
                {
                  body: {
                    item_id: item.id,
                    quantity: Number(qtd.replace(',', '.')),
                    notes: obs.trim() || null,
                    ...(cliente ? { customer_id: cliente } : {}),
                  },
                },
                {
                  onSuccess: () => {
                    toast.success(
                      'Pedido de proposta enviado',
                      'O comercial vai responder com um orçamento.'
                    );
                    onFechar();
                  },
                }
              )
            }
          >
            Enviar pedido
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
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
        <Field label="Quantidade" required>
          <Input inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />
        </Field>
        <Field label="Observação">
          <Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
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
