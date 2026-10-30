/**
 * Aurora — ▶ Play: executar um plano em três escolhas (PLN-09, reunião 16/10/2026).
 *
 * Cliente → plano → equipamento elegível → a OS no assistente de execução. Nenhum motor novo: a
 * lista de elegíveis é a do servidor (itens de ciclo em aberto, no escopo de quem pergunta), e o
 * último passo é o mesmo "▶ Executar" da linha do cronograma — a OS nasce pela geração da
 * varredura, com o procedimento da versão certa, ou é reaberta se já existe.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Play } from 'lucide-react';
import { Button, Dialog, EmptyState, SkeletonList, StatusChip, cn, useToast } from '@aurora/ui';
import {
  customersList,
  plansBoard,
  plansEligibleItems,
  plansExecuteItem,
  plansList,
  plansSchedule,
  type Customer,
  type EligibleItem,
  type PlanRow,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { ROTULO_ESTADO_ITEM, TOM_ESTADO_ITEM, dataCurta } from '../painel/rotulos';

/** O botão grande. Só aparece para quem pode disparar a execução. */
export function BotaoPlay({ clienteInicial }: { clienteInicial?: string }) {
  const { can } = usePermissions();
  const [aberto, setAberto] = useState(false);
  if (!can('maintenance_plan.generate_cycle') && !can('work_order.execute')) return null;
  return (
    <>
      <Button
        variant="primary"
        size="lg"
        icon={<Play className="size-5" />}
        onClick={() => setAberto(true)}
        aria-label="Executar um plano"
      >
        Executar plano
      </Button>
      {aberto && <AssistenteDoPlay onClose={() => setAberto(false)} clienteInicial={clienteInicial} />}
    </>
  );
}

type Passo = 'cliente' | 'plano' | 'ativo';

export function AssistenteDoPlay({
  onClose,
  clienteInicial,
}: {
  onClose: () => void;
  clienteInicial?: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [cliente, setCliente] = useState(clienteInicial ?? '');
  const [plano, setPlano] = useState<PlanRow | null>(null);
  const [passo, setPasso] = useState<Passo>(clienteInicial ? 'plano' : 'cliente');

  const clientes = useApiQuery(customersList) as {
    data: { items: Customer[] } | undefined;
    isLoading: boolean;
  };
  const planos = useApiQuery(plansList, { query: { customer: cliente } }, { enabled: Boolean(cliente) }) as {
    data: { items: PlanRow[] } | undefined;
    isLoading: boolean;
  };
  const elegiveis = useApiQuery(
    plansEligibleItems,
    { params: { id: plano?.id ?? '' } },
    { enabled: Boolean(plano) }
  ) as { data: { items: EligibleItem[] } | undefined; isLoading: boolean };

  const executar = useApiMutation(plansExecuteItem, {
    invalidates: [plansSchedule, plansBoard, plansEligibleItems],
    onError: (e: ApiError) => toast.error('Não foi possível executar', e.problem.message),
  });

  // Com um cliente só, o primeiro passo não pergunta nada.
  const unico = clientes.data?.items.length === 1 ? clientes.data.items[0]! : null;
  useEffect(() => {
    if (passo === 'cliente' && unico && !cliente) {
      setCliente(unico.id);
      setPasso('plano');
    }
  }, [passo, unico, cliente]);

  const irPara = (item: EligibleItem) => {
    if (item.work_order_id) {
      void navigate({ to: '/ordens/$id/executar', params: { id: item.work_order_id } });
      return;
    }
    executar.mutate(
      { params: { itemId: item.id } },
      {
        onSuccess: (r) =>
          void navigate({
            to: '/ordens/$id/executar',
            params: { id: (r as { work_order_id: string }).work_order_id },
          }),
      }
    );
  };

  const titulo =
    passo === 'cliente'
      ? 'Escolha o cliente'
      : passo === 'plano'
        ? 'Escolha o plano'
        : `${plano?.name ?? 'Plano'}`;
  const descricao =
    passo === 'cliente'
      ? 'Passo 1 de 3 — de quem é o equipamento.'
      : passo === 'plano'
        ? 'Passo 2 de 3 — os planos ativos deste cliente.'
        : 'Passo 3 de 3 — os equipamentos com atividade em aberto. Escolher abre a OS no assistente de execução.';

  const ativos = (planos.data?.items ?? []).filter((p) => p.is_active);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={titulo}
      description={descricao}
      footer={
        <>
          {passo !== 'cliente' && !(passo === 'plano' && unico) && (
            <Button
              icon={<ArrowLeft className="size-4" />}
              onClick={() => {
                if (passo === 'ativo') {
                  setPlano(null);
                  setPasso('plano');
                } else {
                  setCliente('');
                  setPasso('cliente');
                }
              }}
            >
              Voltar
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
        </>
      }
    >
      <ol aria-label="Passos" className="mb-3 flex gap-1.5 text-xs">
        {(['cliente', 'plano', 'ativo'] as const).map((p, i) => (
          <li
            key={p}
            aria-current={passo === p ? 'step' : undefined}
            className={cn(
              'rounded-full px-2 py-0.5',
              passo === p ? 'bg-accent-soft text-accent-text' : 'bg-surface-hover text-muted'
            )}
          >
            {i + 1}. {p === 'cliente' ? 'Cliente' : p === 'plano' ? 'Plano' : 'Equipamento'}
          </li>
        ))}
      </ol>

      {passo === 'cliente' &&
        (clientes.isLoading ? (
          <SkeletonList rows={3} label="clientes" />
        ) : (
          <ListaDeEscolha
            rotulo="Clientes"
            itens={(clientes.data?.items ?? []).map((c) => ({ id: c.id, titulo: c.name }))}
            vazio="Nenhum cliente no seu escopo."
            onEscolher={(id) => {
              setCliente(id);
              setPasso('plano');
            }}
          />
        ))}

      {passo === 'plano' &&
        (planos.isLoading ? (
          <SkeletonList rows={3} label="planos" />
        ) : (
          <ListaDeEscolha
            rotulo="Planos"
            itens={ativos.map((p) => ({
              id: p.id,
              titulo: p.name,
              detalhe: `${p.task_count} ${p.task_count === 1 ? 'tarefa' : 'tarefas'}`,
            }))}
            vazio="Este cliente não tem plano ativo."
            onEscolher={(id) => {
              setPlano(ativos.find((p) => p.id === id) ?? null);
              setPasso('ativo');
            }}
          />
        ))}

      {passo === 'ativo' &&
        (elegiveis.isLoading ? (
          <SkeletonList rows={3} label="equipamentos" />
        ) : (elegiveis.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Play className="size-5" />}
            title="Nada em aberto neste plano"
            description="Os itens do ciclo atual já foram realizados ou dispensados — ou o ciclo ainda não abriu."
            className="py-6"
          />
        ) : (
          <ul aria-label="Equipamentos elegíveis" className="flex flex-col">
            {elegiveis.data!.items.map((i, n) => (
              <li key={i.id} className={cn(n > 0 && 'border-t border-border-subtle')}>
                <button
                  type="button"
                  disabled={executar.isPending}
                  onClick={() => irPara(i)}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{i.asset_name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[i.sector_name, i.task_name, `vence ${dataCurta(i.due_at)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <StatusChip size="sm" tone={TOM_ESTADO_ITEM[i.state] ?? 'neutral'}>
                    {ROTULO_ESTADO_ITEM[i.state] ?? i.state}
                  </StatusChip>
                  {i.work_order_number && (
                    <span className="hidden text-xs text-muted tabular-nums sm:inline">
                      OS {i.work_order_number}
                    </span>
                  )}
                  <Play aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
                </button>
              </li>
            ))}
          </ul>
        ))}
    </Dialog>
  );
}

function ListaDeEscolha({
  rotulo,
  itens,
  vazio,
  onEscolher,
}: {
  rotulo: string;
  itens: Array<{ id: string; titulo: string; detalhe?: string }>;
  vazio: string;
  onEscolher: (id: string) => void;
}) {
  if (itens.length === 0) return <p className="py-4 text-sm text-muted">{vazio}</p>;
  return (
    <ul aria-label={rotulo} className="flex flex-col">
      {itens.map((x, n) => (
        <li key={x.id} className={cn(n > 0 && 'border-t border-border-subtle')}>
          <button
            type="button"
            onClick={() => onEscolher(x.id)}
            className="flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text">{x.titulo}</span>
            {x.detalhe && <span className="shrink-0 text-xs text-muted">{x.detalhe}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
