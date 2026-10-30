/**
 * Aurora — Store: a gestão do catálogo (conversa com o cliente, 23/10/2026).
 *
 * "Não tem o local de cadastrar produtos e preços e disponibilizar para qual cliente eu quero que
 * veja ou se eu quiser por aberto a todos da rede de usuários." O cadastro existia, mas morava em
 * Estoque › Gestão › Itens na Store — longe de quem pensa na Store, e sem o público. Esta aba põe
 * tudo no lugar onde o dono da Store procura: produto, preço, descrição, publicar ou não e PARA
 * QUEM aparece (toda a rede ou clientes escolhidos).
 *
 * Só aparece para quem edita o catálogo (`inventory.update`): o cliente da Store só compra e
 * acompanha. O produto continua sendo um item do catálogo de estoque — é o mesmo cadastro, para o
 * pedido poder baixar e faturar o item —, mas a Store nunca mostra saldo.
 */
import { useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  SkeletonList,
  StatusChip,
  Textarea,
  useToast,
} from '@aurora/ui';
import {
  customersList,
  inventoryItemsCreate,
  inventoryItemsUpdate,
  storeCatalogList,
  storeItemAudience,
  type Customer,
  type StoreCatalogItem,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { reais } from './pedidos';

export function GerenciarCatalogo() {
  const [editando, setEditando] = useState<StoreCatalogItem | 'novo' | null>(null);
  const { data, isLoading, isError } = useApiQuery(storeCatalogList) as {
    data: { items: StoreCatalogItem[] } | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Customer[] } | undefined };
  const nomeDoCliente = new Map((clientes?.items ?? []).map((c) => [c.id, c.name]));
  const itens = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Cadastre produtos e preços e escolha para quem cada um aparece: toda a rede de clientes ou só os
          clientes que você marcar. Só o que estiver publicado entra no catálogo.
        </p>
        <Button variant="primary" onClick={() => setEditando('novo')}>
          <Plus aria-hidden="true" className="size-4" />
          Novo produto
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={4} label="produtos" />
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<Package className="size-5" />}
            title="Não conseguimos carregar o catálogo agora"
            description="Confira a conexão e tente de novo."
          />
        </Card>
      ) : itens.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package className="size-5" />}
            title="Nenhum produto cadastrado"
            description="Comece pelo botão Novo produto: nome, preço, descrição e para quem ele aparece."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border-subtle" aria-label="Produtos da Store">
            {itens.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text">{i.name}</p>
                  <p className="text-xs text-muted">
                    {[i.category, i.sku, i.unit].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="w-32 text-right tabular-nums text-text">{reais(i.list_price_cents)}</span>
                <StatusChip tone={i.store_published ? 'good' : 'neutral'} size="sm">
                  {i.store_published ? 'Publicado' : 'Fora da Store'}
                </StatusChip>
                <span className="w-48 truncate text-xs text-muted" title={publico(i, nomeDoCliente)}>
                  {publico(i, nomeDoCliente)}
                </span>
                <Button size="sm" onClick={() => setEditando(i)}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editando && (
        <DialogoDoProduto
          produto={editando === 'novo' ? null : editando}
          clientes={clientes?.items ?? []}
          onFechar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function publico(i: StoreCatalogItem, nomes: Map<string, string>): string {
  if (i.store_audience === 'all') return 'Toda a rede';
  const n = i.customer_ids.map((id) => nomes.get(id) ?? 'cliente');
  return n.length <= 2 ? `Só: ${n.join(', ')}` : `Só ${n.length} clientes`;
}

/** Centavos ("8990") → texto do campo ("89,90"). */
function paraCampo(centavos: string | null): string {
  return centavos === null ? '' : (Number(centavos) / 100).toFixed(2).replace('.', ',');
}

function DialogoDoProduto({
  produto,
  clientes,
  onFechar,
}: {
  produto: StoreCatalogItem | null;
  clientes: Customer[];
  onFechar: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    sku: produto?.sku ?? '',
    name: produto?.name ?? '',
    unit: produto?.unit ?? 'un',
    category: produto?.category ?? '',
    price: paraCampo(produto?.list_price_cents ?? null),
    summary: produto?.store_summary ?? '',
    published: produto?.store_published ?? true,
    audience: produto?.store_audience ?? ('all' as 'all' | 'selected'),
    customers: new Set(produto?.customer_ids ?? []),
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const criar = useApiMutation(inventoryItemsCreate);
  const editar = useApiMutation(inventoryItemsUpdate);
  const definirPublico = useApiMutation(storeItemAudience);

  async function salvar() {
    setErro(null);
    if (f.audience === 'selected' && f.customers.size === 0) {
      setErro('Marque ao menos um cliente — ou deixe o produto para toda a rede.');
      return;
    }
    setSalvando(true);
    try {
      const preco = f.price.trim() ? f.price.trim().replace(/\./g, '').replace(',', '.') : null;
      let id = produto?.id;
      if (!id) {
        ({ id } = await criar.mutateAsync({
          body: {
            sku: f.sku,
            name: f.name,
            unit: f.unit || undefined,
            category: f.category.trim() || null,
            list_price: preco,
          },
        }));
      }
      await editar.mutateAsync({
        params: { id },
        body: {
          name: f.name,
          category: f.category.trim() || null,
          list_price: preco,
          store_published: f.published,
          store_summary: f.summary.trim() || null,
        },
      });
      await definirPublico.mutateAsync({
        params: { id },
        body: { audience: f.audience, customer_ids: f.audience === 'selected' ? [...f.customers] : [] },
      });
      await qc.invalidateQueries({
        predicate: (q) => /^(store|inventory)\./.test(String(q.queryKey[0])),
      });
      toast.success(produto ? 'Produto atualizado' : 'Produto cadastrado');
      onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.problem.message : (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function marcar(id: string, sim: boolean) {
    const c = new Set(f.customers);
    if (sim) c.add(id);
    else c.delete(id);
    setF({ ...f, customers: c });
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title={produto ? `Editar: ${produto.name}` : 'Novo produto da Store'}
      description="Preço de lista em reais; sem preço, o produto aparece como “sob consulta”."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={salvando} onClick={() => void salvar()}>
            {produto ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do produto" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} />
          </Field>
          <Field
            label="Código (SKU)"
            required
            hint={produto ? 'O código não muda depois de criado.' : undefined}
          >
            <Input
              value={f.sku}
              disabled={!!produto}
              onChange={(e) => setF({ ...f, sku: e.target.value })}
              maxLength={60}
            />
          </Field>
          <Field label="Preço de lista (R$)">
            <Input
              inputMode="decimal"
              placeholder="89,90"
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })}
            />
          </Field>
          <Field label="Unidade">
            <Input
              value={f.unit}
              disabled={!!produto}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
              maxLength={20}
            />
          </Field>
          <Field label="Categoria">
            <Input
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
              maxLength={80}
            />
          </Field>
        </div>
        <Field label="Descrição na Store">
          <Textarea
            rows={3}
            value={f.summary}
            onChange={(e) => setF({ ...f, summary: e.target.value })}
            maxLength={1000}
          />
        </Field>

        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={f.published}
            onChange={(e) => setF({ ...f, published: e.target.checked })}
          />
          Publicado na Store
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Quem vê este produto</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="publico"
              checked={f.audience === 'all'}
              onChange={() => setF({ ...f, audience: 'all' })}
            />
            Toda a rede de clientes
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="publico"
              checked={f.audience === 'selected'}
              onChange={() => setF({ ...f, audience: 'selected' })}
            />
            Só os clientes que eu escolher
          </label>
          {f.audience === 'selected' && (
            <div className="max-h-56 overflow-y-auto rounded-control border border-border p-2">
              {clientes.length === 0 ? (
                <p className="text-sm text-muted">Nenhum cliente cadastrado.</p>
              ) : (
                clientes.map((c) => (
                  <label key={c.id} className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={f.customers.has(c.id)}
                      onChange={(e) => marcar(c.id, e.target.checked)}
                    />
                    {c.name}
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>

        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
