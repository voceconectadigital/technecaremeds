/**
 * Aurora — gestão do estoque interno (reunião 16/10/2026, Fase 8).
 *
 * Entrada, mínimo e máximo, valor em estoque, curva ABC e relatório por período
 * — sobre o mesmo razão que a OS movimenta. A saída de peça continua sendo pela
 * OS (ou por ajuste com motivo): aqui não existe "baixar" solto.
 *
 * A curva ABC segue a regra CONVENCIONAL (Pareto por valor consumido) e a tela
 * mostra a regra por extenso, como o servidor a devolve.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  FilterChip,
  Input,
  SegmentGroup,
  Select,
  Skeleton,
  StatusChip,
  useToast,
} from '@aurora/ui';
import {
  customersList,
  inventoryAbc,
  inventoryBalances,
  inventoryItemsCreate,
  inventoryItemsList,
  inventoryItemsUpdate,
  inventoryLimits,
  inventoryPeriodReport,
  inventoryReceipts,
  inventoryValuation,
  inventoryWarehouses,
  inventoryWarehousesCreate,
  type Customer,
  type InventoryItem,
  type Warehouse,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';

const PERIODOS = {
  mes: { rotulo: 'Mês', dias: 30 },
  semestre: { rotulo: 'Semestre', dias: 182 },
  ano: { rotulo: 'Ano', dias: 365 },
  personalizado: { rotulo: 'Personalizado', dias: 0 },
} as const;
type Periodo = keyof typeof PERIODOS;

function reais(centavos: number | string): string {
  return (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function PainelDeGestao() {
  const { can } = usePermissions();
  const [dialogo, setDialogo] = useState<'item' | 'almox' | 'entrada' | 'limites' | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [de, setDe] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [ate, setAte] = useState(new Date().toISOString().slice(0, 10));
  const intervalo = useMemo(() => {
    if (periodo === 'personalizado') {
      return {
        from: new Date(`${de}T00:00:00`).toISOString(),
        to: new Date(`${ate}T23:59:59`).toISOString(),
      };
    }
    const to = new Date();
    return {
      from: new Date(to.getTime() - PERIODOS[periodo].dias * 86_400_000).toISOString(),
      to: to.toISOString(),
    };
  }, [periodo, de, ate]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ações do estoque">
        <Can permission="inventory.create">
          <Button icon={<Plus className="size-4" />} onClick={() => setDialogo('item')}>
            Novo item
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setDialogo('almox')}>
            Novo almoxarifado
          </Button>
        </Can>
        <Can permission="inventory.move">
          <Button variant="primary" onClick={() => setDialogo('entrada')}>
            Registrar entrada
          </Button>
        </Can>
        <Can permission="inventory.update">
          <Button onClick={() => setDialogo('limites')}>Mínimo e máximo</Button>
        </Can>
      </div>

      {can('inventory.read_costs') && <ValorEmEstoque />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <SegmentGroup label="Período">
          {(Object.keys(PERIODOS) as Periodo[]).map((p) => (
            <FilterChip key={p} segment active={periodo === p} onClick={() => setPeriodo(p)}>
              {PERIODOS[p].rotulo}
            </FilterChip>
          ))}
        </SegmentGroup>
        {periodo === 'personalizado' && (
          <div className="flex gap-2">
            <Field label="De">
              <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </Field>
            <Field label="Até">
              <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      {can('inventory.read_costs') && <CurvaAbc intervalo={intervalo} />}
      <RelatorioDoPeriodo intervalo={intervalo} />
      {can('inventory.update') && <ItensNaStore />}

      {dialogo === 'item' && <DialogoNovoItem onFechar={() => setDialogo(null)} />}
      {dialogo === 'almox' && <DialogoNovoAlmox onFechar={() => setDialogo(null)} />}
      {dialogo === 'entrada' && <DialogoEntrada onFechar={() => setDialogo(null)} />}
      {dialogo === 'limites' && <DialogoLimites onFechar={() => setDialogo(null)} />}
    </div>
  );
}

function ValorEmEstoque() {
  const { data, isLoading } = useApiQuery(inventoryValuation) as {
    data:
      | {
          items: {
            warehouse_id: string;
            warehouse_name: string;
            owner: string;
            customer_name: string | null;
            items: number;
            value_cents: string;
            below_min: number;
            above_max: number;
          }[];
        }
      | undefined;
    isLoading: boolean;
  };
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const total = (data?.items ?? []).reduce((s, w) => s + Number(w.value_cents), 0);
  return (
    <Card>
      <CardHeader title="Valor em estoque" description={`Saldo × custo médio. Total: ${reais(total)}`} />
      <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {(data?.items ?? []).map((w) => (
          <li key={w.warehouse_id} className="rounded-control border border-border-subtle p-3">
            <p className="text-sm font-medium text-text">{w.warehouse_name}</p>
            <p className="text-xs text-muted">
              {w.owner === 'customer' ? `Estoque do cliente · ${w.customer_name}` : 'Estoque da organização'}
            </p>
            <p className="mt-1 text-lg font-semibold text-text tabular-nums">{reais(w.value_cents)}</p>
            <p className="text-xs text-muted">
              {w.items} itens · {w.below_min} abaixo do mínimo · {w.above_max} acima do máximo
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CurvaAbc({ intervalo }: { intervalo: { from: string; to: string } }) {
  const { data, isLoading, isError } = useApiQuery(inventoryAbc, { query: intervalo }) as {
    data:
      | {
          items: {
            item_id: string;
            sku: string;
            name: string;
            consumed_qty: number;
            value_cents: number;
            share_pct: number;
            cumulative_pct: number;
            abc_class: 'A' | 'B' | 'C';
          }[];
          total_value_cents: number;
          rule: string;
        }
      | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  return (
    <Card>
      <CardHeader title="Curva ABC" description={data?.rule ?? 'Pareto por valor consumido no período.'} />
      <div className="overflow-x-auto px-4 pb-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError || !data || data.items.length === 0 ? (
          <EmptyState
            title="Sem consumo no período"
            description="A curva nasce das saídas de peça para as OS."
          />
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Curva ABC do período</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2">Classe</th>
                <th>Item</th>
                <th className="text-right">Consumo</th>
                <th className="text-right">Valor</th>
                <th className="text-right">% do total</th>
                <th className="text-right">% acumulado</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.item_id} className="border-t border-border-subtle">
                  <td className="py-2">
                    <StatusChip
                      size="sm"
                      tone={i.abc_class === 'A' ? 'bad' : i.abc_class === 'B' ? 'warn' : 'neutral'}
                    >
                      {i.abc_class}
                    </StatusChip>
                  </td>
                  <td>
                    {i.name} <span className="text-xs text-muted">{i.sku}</span>
                  </td>
                  <td className="text-right tabular-nums">{i.consumed_qty}</td>
                  <td className="text-right tabular-nums">{reais(i.value_cents)}</td>
                  <td className="text-right tabular-nums">{i.share_pct.toFixed(1)}%</td>
                  <td className="text-right tabular-nums">{i.cumulative_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function RelatorioDoPeriodo({ intervalo }: { intervalo: { from: string; to: string } }) {
  const { data, isLoading } = useApiQuery(inventoryPeriodReport, { query: intervalo }) as {
    data:
      | {
          items: {
            item_id: string;
            sku: string;
            name: string;
            unit: string;
            received: number;
            consumed_by_work_orders: number;
            other_out: number;
            adjustments: number;
            on_hand_now: number;
          }[];
        }
      | undefined;
    isLoading: boolean;
  };
  return (
    <Card>
      <CardHeader
        title="Movimentação do período"
        description="Entradas, consumo pelas OS, outras saídas e ajustes."
      />
      <div className="overflow-x-auto px-4 pb-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Nenhuma movimentação no período" />
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <caption className="sr-only">Movimentação por item no período</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2">Item</th>
                <th className="text-right">Entradas</th>
                <th className="text-right">Consumo em OS</th>
                <th className="text-right">Outras saídas</th>
                <th className="text-right">Ajustes</th>
                <th className="text-right">Saldo atual</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((i) => (
                <tr key={i.item_id} className="border-t border-border-subtle">
                  <td className="py-2">
                    {i.name} <span className="text-xs text-muted">{i.sku}</span>
                  </td>
                  <td className="text-right tabular-nums">{i.received}</td>
                  <td className="text-right tabular-nums">{i.consumed_by_work_orders}</td>
                  <td className="text-right tabular-nums">{i.other_out}</td>
                  <td className="text-right tabular-nums">{i.adjustments}</td>
                  <td className="text-right tabular-nums">
                    {i.on_hand_now} {i.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function ItensNaStore() {
  const toast = useToast();
  const { data } = useApiQuery(inventoryItemsList) as { data: { items: InventoryItem[] } | undefined };
  const publicar = useApiMutation(inventoryItemsUpdate, {
    invalidates: [inventoryItemsList],
    onError: (e: ApiError) => toast.error('Não foi possível alterar', e.problem.message),
  });
  return (
    <Card>
      <CardHeader
        title="Itens na Store"
        description="O que aparece no catálogo comercial (Store) — com preço de lista, nunca com saldo."
      />
      <ul className="divide-y divide-border-subtle">
        {(data?.items ?? []).map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {i.name} <span className="text-xs text-muted">{i.sku}</span>
            </span>
            <span className="text-xs text-muted tabular-nums">
              {i.list_price_cents ? reais(i.list_price_cents) : 'sem preço de lista'}
            </span>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={i.store_published}
                onChange={(e) =>
                  publicar.mutate({ params: { id: i.id }, body: { store_published: e.target.checked } })
                }
              />
              Na Store
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* diálogos                                                                    */
/* -------------------------------------------------------------------------- */

function useListas() {
  const { data: itens } = useApiQuery(inventoryItemsList) as { data: { items: InventoryItem[] } | undefined };
  const { data: almox } = useApiQuery(inventoryWarehouses) as { data: { items: Warehouse[] } | undefined };
  return { itens: itens?.items ?? [], almox: almox?.items ?? [] };
}

function Rodape({
  onFechar,
  onSalvar,
  salvando,
  rotulo,
}: {
  onFechar: () => void;
  onSalvar: () => void;
  salvando: boolean;
  rotulo: string;
}) {
  return (
    <>
      <Button onClick={onFechar}>Cancelar</Button>
      <Button variant="primary" loading={salvando} onClick={onSalvar}>
        {rotulo}
      </Button>
    </>
  );
}

function Erro({ erro }: { erro: string | null }) {
  return erro ? (
    <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
      {erro}
    </p>
  ) : null;
}

function DialogoNovoItem({ onFechar }: { onFechar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ sku: '', name: '', unit: 'un', category: '', list_price: '' });
  const [erro, setErro] = useState<string | null>(null);
  const criar = useApiMutation(inventoryItemsCreate, {
    invalidates: [inventoryItemsList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Novo item de estoque"
      description="Código, nome e unidade. Preço de lista é o que a Store mostra, se o item for publicado."
      footer={
        <Rodape
          onFechar={onFechar}
          salvando={criar.isPending}
          rotulo="Cadastrar"
          onSalvar={() =>
            criar.mutate(
              {
                body: {
                  sku: f.sku,
                  name: f.name,
                  unit: f.unit || undefined,
                  category: f.category || null,
                  list_price: f.list_price ? f.list_price.replace(',', '.') : null,
                },
              },
              {
                onSuccess: () => {
                  toast.success('Item cadastrado');
                  onFechar();
                },
              }
            )
          }
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código (SKU)" required>
          <Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        </Field>
        <Field label="Nome" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Unidade">
          <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </Field>
        <Field label="Categoria">
          <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <Field label="Preço de lista (R$)">
          <Input
            inputMode="decimal"
            placeholder="89,90"
            value={f.list_price}
            onChange={(e) => setF({ ...f, list_price: e.target.value })}
          />
        </Field>
      </div>
      <Erro erro={erro} />
    </Dialog>
  );
}

function DialogoNovoAlmox({ onFechar }: { onFechar: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [cliente, setCliente] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Customer[] } | undefined };
  const criar = useApiMutation(inventoryWarehousesCreate, {
    invalidates: [inventoryWarehouses, inventoryValuation],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Novo almoxarifado"
      description="Da organização (prestadora) ou de um CLIENTE — o estoque do hospital, privado, gerido aqui."
      footer={
        <Rodape
          onFechar={onFechar}
          salvando={criar.isPending}
          rotulo="Criar"
          onSalvar={() =>
            criar.mutate(
              { body: { name: nome, customer_id: cliente || null } },
              {
                onSuccess: () => {
                  toast.success('Almoxarifado criado');
                  onFechar();
                },
              }
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nome" required>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="Dono do estoque">
          <Select value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">A própria organização</option>
            {(clientes?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                Cliente: {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Erro erro={erro} />
    </Dialog>
  );
}

function DialogoEntrada({ onFechar }: { onFechar: () => void }) {
  const toast = useToast();
  const { itens, almox } = useListas();
  const [f, setF] = useState({ item: '', almox: '', qty: '1', custo: '', ref: '' });
  const [erro, setErro] = useState<string | null>(null);
  const entrar = useApiMutation(inventoryReceipts, {
    invalidates: [inventoryBalances, inventoryValuation],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Registrar entrada"
      description="Compra, doação ou devolução: entra no razão com custo unitário e a referência (nota fiscal)."
      footer={
        <Rodape
          onFechar={onFechar}
          salvando={entrar.isPending}
          rotulo="Registrar"
          onSalvar={() =>
            entrar.mutate(
              {
                body: {
                  item_id: f.item,
                  warehouse_id: f.almox,
                  qty: Number(f.qty.replace(',', '.')),
                  unit_cost: f.custo.replace(',', '.'),
                  reference: f.ref,
                },
              },
              {
                onSuccess: () => {
                  toast.success('Entrada registrada');
                  onFechar();
                },
              }
            )
          }
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item" required>
          <Select value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>
            <option value="">Escolha…</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.sku})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Almoxarifado" required>
          <Select value={f.almox} onChange={(e) => setF({ ...f, almox: e.target.value })}>
            <option value="">Escolha…</option>
            {almox.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.customer_name ? ` (cliente ${w.customer_name})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantidade" required>
          <Input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        </Field>
        <Field label="Custo unitário (R$)" required>
          <Input
            inputMode="decimal"
            placeholder="40,00"
            value={f.custo}
            onChange={(e) => setF({ ...f, custo: e.target.value })}
          />
        </Field>
        <Field label="Referência (NF, pedido…)" required className="sm:col-span-2">
          <Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
        </Field>
      </div>
      <Erro erro={erro} />
    </Dialog>
  );
}

function DialogoLimites({ onFechar }: { onFechar: () => void }) {
  const toast = useToast();
  const { itens, almox } = useListas();
  const [f, setF] = useState({ item: '', almox: '', min: '0', max: '' });
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useApiMutation(inventoryLimits, {
    invalidates: [inventoryBalances, inventoryValuation],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Mínimo e máximo"
      description="Abaixo do mínimo, o item aparece para compra; acima do máximo, como excesso."
      footer={
        <Rodape
          onFechar={onFechar}
          salvando={salvar.isPending}
          rotulo="Salvar"
          onSalvar={() =>
            salvar.mutate(
              {
                body: {
                  item_id: f.item,
                  warehouse_id: f.almox,
                  min_qty: Number(f.min.replace(',', '.')),
                  max_qty: f.max ? Number(f.max.replace(',', '.')) : null,
                },
              },
              {
                onSuccess: () => {
                  toast.success('Limites salvos');
                  onFechar();
                },
              }
            )
          }
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item" required>
          <Select value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>
            <option value="">Escolha…</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Almoxarifado" required>
          <Select value={f.almox} onChange={(e) => setF({ ...f, almox: e.target.value })}>
            <option value="">Escolha…</option>
            {almox.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mínimo">
          <Input inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
        </Field>
        <Field label="Máximo">
          <Input inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </Field>
      </div>
      <Erro erro={erro} />
    </Dialog>
  );
}
