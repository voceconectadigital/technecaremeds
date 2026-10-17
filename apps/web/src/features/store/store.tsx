/**
 * Aurora — Store (reunião 16/10/2026, Fase 8).
 *
 * Catálogo comercial da organização: o que ela oferece, com descrição e preço
 * de lista. NÃO é o estoque interno — a Store nunca mostra saldo de
 * almoxarifado. O objetivo desta versão é ver, consultar e PEDIR PROPOSTA: o
 * pedido vira oportunidade para o comercial. Não há carrinho, checkout nem
 * pagamento.
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
  Textarea,
  Thumb,
  useToast,
} from '@aurora/ui';
import {
  customersList,
  storeItemsList,
  storeRequestQuote,
  type Customer,
  type StoreItem,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';

function reais(centavos: string | null): string {
  return centavos === null
    ? 'Preço sob consulta'
    : (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function StorePage() {
  const [pedindo, setPedindo] = useState<StoreItem | null>(null);
  const { data, isLoading, isError, error } = useApiQuery(storeItemsList) as {
    data: { items: StoreItem[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  if (isError) return <ErrorScreen error={error} />;
  return (
    <AppShell
      title="Store"
      subtitle="Catálogo comercial: produtos e ofertas. Peça uma proposta — o comercial responde com orçamento."
    >
      {isLoading ? (
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
                    <p className="text-xs text-muted">{[i.category, i.sku].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                {i.summary && <p className="text-sm text-text">{i.summary}</p>}
                <p className="mt-auto text-base font-semibold text-text tabular-nums">
                  {reais(i.list_price_cents)}
                </p>
                <Can permission="store.request_quote">
                  <Button variant="primary" onClick={() => setPedindo(i)}>
                    Solicitar proposta
                  </Button>
                </Can>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {pedindo && <DialogoProposta item={pedindo} onFechar={() => setPedindo(null)} />}
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
