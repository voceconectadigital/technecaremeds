/**
 * Aurora — ordens de serviço: lista e quadro (SPEC v0.2 §09 · EPIC-009).
 *
 * A REGRA MAIS IMPORTANTE DESTA TELA
 *
 * Arrastar um cartão NUNCA muda o estado só no frontend. A sequência é:
 * arrastar → pedir a transição ao servidor → esperar a resposta → mover o
 * cartão. Recusado, o cartão VOLTA para a coluna de origem com a explicação.
 *
 * A alternativa — mover o cartão e desfazer se der erro — parece mais rápida e
 * mente: a pessoa vê a OS na coluna "concluída", vira para o lado, e quando
 * olha de novo ela voltou. Pior ainda quando ela não olha de novo.
 *
 * Quando a transição EXIGE campos (motivo de espera, resolução), o servidor
 * diz quais em `requires`, e a tela pede ANTES de enviar. É a diferença entre
 * um Kanban que orienta e um que é tentativa e erro.
 */
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ClipboardList, LayoutGrid, List } from 'lucide-react';
import { Button, Card, EmptyState, SkeletonList, StatusChip, Tabs, cn, useToast } from '@aurora/ui';
import {
  workOrdersBoard,
  workOrdersList,
  workOrderDetail,
  workOrderTransition,
  type BoardColumn,
  type WorkOrderRow,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';
import { useUrlState } from '../../lib/url-state';

export function OrdensPage() {
  const [vista, setVista] = useUrlState<'quadro' | 'lista'>('vista', 'quadro');

  return (
    <AppShell
      title="Ordens de serviço"
      subtitle="O que está em andamento, e onde está parado."
      bleed={vista === 'quadro'}
      actions={
        <div className="flex items-center gap-1 rounded-control border border-border p-0.5">
          <Button
            size="sm"
            variant={vista === 'quadro' ? 'secondary' : 'ghost'}
            icon={<LayoutGrid className="size-4" />}
            onClick={() => setVista('quadro')}
            aria-pressed={vista === 'quadro'}
          >
            Quadro
          </Button>
          <Button
            size="sm"
            variant={vista === 'lista' ? 'secondary' : 'ghost'}
            icon={<List className="size-4" />}
            onClick={() => setVista('lista')}
            aria-pressed={vista === 'lista'}
          >
            Lista
          </Button>
        </div>
      }
    >
      {vista === 'quadro' ? <Quadro /> : <Lista />}
    </AppShell>
  );
}

/* ---------------------------------------------------------------- o quadro */

function Quadro() {
  const toast = useToast();
  const [arrastando, setArrastando] = useState<WorkOrderRow | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  const colunas = useApiQuery(workOrdersBoard) as {
    data: { columns: BoardColumn[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const ordens = useApiQuery(workOrdersList, { query: { limit: 500 } }) as {
    data: { items: WorkOrderRow[] } | undefined;
    isLoading: boolean;
  };

  const transicao = useApiMutation(workOrderTransition, {
    invalidates: [workOrdersBoard, workOrdersList, workOrderDetail],
  });

  const porColuna = useMemo(() => {
    const mapa = new Map<string, WorkOrderRow[]>();
    for (const os of ordens.data?.items ?? []) {
      const lista = mapa.get(os.status_key) ?? [];
      lista.push(os);
      mapa.set(os.status_key, lista);
    }
    return mapa;
  }, [ordens.data]);

  if (colunas.isError) return <ErrorScreen error={colunas.error} />;

  if (colunas.isLoading) {
    return (
      <div className="p-4">
        <SkeletonList rows={4} label="colunas do quadro" />
      </div>
    );
  }

  function soltar(destino: BoardColumn) {
    const os = arrastando;
    setArrastando(null);
    setAlvo(null);
    if (!os || os.status_key === destino.key) return;

    /*
     * A transição é PEDIDA. O cartão não se move até a resposta chegar — a
     * lista é reconsultada pela invalidação, e é o servidor que decide onde
     * cada OS está.
     */
    transicao.mutate(
      { params: { id: os.id }, body: { to: destino.key, version: os.version } },
      {
        onSuccess: () => {
          toast.success(`${os.number ?? 'OS'} movida para ${destino.label}`, os.title);
        },
        onError: (e: ApiError) => {
          // O cartão volta sozinho, porque nunca saiu do lugar. O que a pessoa
          // recebe é a EXPLICAÇÃO — inclusive quando faltam campos.
          const faltando = (e.problem.details?.missing as string[] | undefined) ?? [];
          toast.error(
            `${os.number ?? 'A OS'} não pôde ir para ${destino.label}`,
            faltando.length > 0
              ? `Faltam informações: ${faltando.join(', ')}. Abra a ordem para preenchê-las.`
              : e.problem.message
          );
        },
      }
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {(colunas.data?.columns ?? []).map((coluna) => {
        const cartoes = porColuna.get(coluna.key) ?? [];
        const destacada = alvo === coluna.key && arrastando?.status_key !== coluna.key;

        return (
          <section
            key={coluna.id}
            aria-label={`${coluna.label}, ${coluna.total} ordens`}
            onDragOver={(e) => {
              e.preventDefault();
              setAlvo(coluna.key);
            }}
            onDragLeave={() => setAlvo((a) => (a === coluna.key ? null : a))}
            onDrop={() => soltar(coluna)}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-card border bg-surface-sunken/40',
              destacada ? 'border-accent bg-accent-soft/40' : 'border-border'
            )}
          >
            <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{coluna.label}</h2>
              <span className="text-sm text-muted tabular-nums" data-numeric>
                {coluna.total}
              </span>
            </header>

            {/* A quebra por motivo: "parado" não é diagnóstico. */}
            {coluna.by_wait_reason.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-border-subtle px-3 py-2">
                {coluna.by_wait_reason.map((m) => (
                  <StatusChip
                    key={m.key}
                    size="sm"
                    tone={m.pauses_sla ? 'neutral' : 'warn'}
                    hint={m.pauses_sla ? 'Com o SLA pausado' : 'Com o SLA correndo'}
                  >
                    {m.label} · {m.total}
                  </StatusChip>
                ))}
              </div>
            )}

            <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {cartoes.map((os) => (
                <li key={os.id}>
                  <CartaoDeOs
                    os={os}
                    onDragStart={() => setArrastando(os)}
                    onDragEnd={() => setArrastando(null)}
                    ocupada={transicao.isPending && arrastando?.id === os.id}
                  />
                </li>
              ))}
              {cartoes.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-subtle">Nenhuma OS aqui.</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CartaoDeOs({
  os,
  onDragStart,
  onDragEnd,
  ocupada,
}: {
  os: WorkOrderRow;
  onDragStart: () => void;
  onDragEnd: () => void;
  ocupada: boolean;
}) {
  return (
    <Link
      to="/ordens/$id"
      params={{ id: os.id }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={ocupada || undefined}
      className={cn(
        'block rounded-control border border-border bg-surface p-2.5 transition-colors hover:border-border-strong',
        ocupada && 'opacity-60'
      )}
    >
      <p className="line-clamp-2 text-sm text-text">{os.title}</p>
      <p className="mt-1 truncate text-xs text-muted" data-numeric>
        {os.number ?? 'sem número'}
        {os.asset_name_snapshot ? ` · ${os.asset_name_snapshot}` : ''}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <PrioridadeChip prioridade={os.priority} />
        {os.wait_reason_label && (
          <StatusChip tone="warn" size="sm">
            {os.wait_reason_label}
          </StatusChip>
        )}
      </div>
    </Link>
  );
}

/* ----------------------------------------------------------------- a lista */

function Lista() {
  const [categoria, setCategoria] = useUrlState<string>('categoria', 'todas');

  const { data, isLoading, isError, error } = useApiQuery(workOrdersList, {
    query: {
      limit: 200,
      ...(categoria !== 'todas' ? { category: categoria } : {}),
    },
  }) as {
    data: { items: WorkOrderRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const itens = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        aria-label="Categoria"
        value={categoria}
        onChange={setCategoria}
        items={[
          { id: 'todas', label: 'Todas' },
          { id: 'open', label: 'Abertas' },
          { id: 'in_progress', label: 'Em execução' },
          { id: 'waiting', label: 'Paradas' },
          { id: 'done', label: 'Concluídas' },
        ]}
      />

      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={8} label="ordens de serviço" />
          </div>
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="Nenhuma ordem de serviço"
            filtered={categoria !== 'todas'}
            description={
              categoria === 'todas'
                ? 'As ordens aparecem aqui assim que uma solicitação é aceita ou um plano preventivo abre um ciclo.'
                : undefined
            }
          />
        ) : (
          <ul>
            {itens.map((os, i) => (
              <li key={os.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                <Link
                  to="/ordens/$id"
                  params={{ id: os.id }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="w-20 shrink-0 text-xs text-muted tabular-nums" data-numeric>
                    {os.number ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text">{os.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[os.asset_name_snapshot, os.location_name_snapshot].filter(Boolean).join(' · ') ||
                        'sem equipamento'}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted sm:block">
                    {formatarDataRelativa(os.created_at)}
                  </span>
                  <PrioridadeChip prioridade={os.priority} />
                  <StatusChip tone={tomDaCategoria(os.category)} size="sm">
                    {os.status_label}
                  </StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function tomDaCategoria(c: string): 'neutral' | 'info' | 'warn' | 'good' {
  if (c === 'in_progress') return 'info';
  if (c === 'waiting') return 'warn';
  if (c === 'done') return 'good';
  return 'neutral';
}
