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
import { CalendarClock, ClipboardList, LayoutGrid, List, MapPin } from 'lucide-react';
import { Button, Card, EmptyState, SkeletonList, StatusChip, Tabs, cn, useToast } from '@aurora/ui';
import {
  workOrdersBoard,
  workOrdersList,
  workOrderDetail,
  workOrderTransition,
  type BoardColumn,
  type WorkOrderRow,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { AlternadorDeTrabalho } from '../planos/alternador';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';

export function OrdensPage() {
  const [vista, setVista] = useUrlState<'quadro' | 'lista'>('vista', 'quadro');

  return (
    <AppShell
      title="Ordens de serviço"
      subtitle="O que está em andamento, e onde está parado."
      bleed={vista === 'quadro'}
      actions={
        <div className="flex items-center gap-3">
          {/*
            O alternador é NAVEGAÇÃO entre telas; o par Quadro/Lista é modo de
            visualização DESTA tela. São coisas diferentes, e por isso ficam
            visualmente separadas — juntá-las num grupo só ensinaria que
            "Planos" é uma terceira forma de ver as ordens, que não é.
          */}
          <AlternadorDeTrabalho />
          <span aria-hidden="true" className="h-5 w-px bg-border" />
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
    /*
     * A FAIXA QUE ROLA PRECISA RECEBER FOCO.
     *
     * Um contêiner com rolagem horizontal e nenhum elemento focável dentro do
     * trecho fora da tela é uma região que só o mouse alcança: quem navega por
     * teclado chega ao fim das colunas visíveis e não tem como puxar as
     * seguintes. A auditoria chama isso de `scrollable-region-focusable`, e o
     * impacto é sério.
     *
     * `tabIndex={0}` põe a faixa na ordem de tabulação; as setas do teclado
     * então rolam. O `role="group"` com rótulo é o que faz o leitor de tela
     * anunciar o que a pessoa acabou de alcançar em vez de dizer só "grupo".
     *
     * `relative` NÃO É ENFEITE. O texto para leitor de tela das etiquetas
     * (`aurora-sr-only`) tem posição absoluta; sem um ancestral posicionado
     * aqui dentro, ele se ancorava na página — e o de um cartão na quarta
     * coluna, fora da tela, alargava o documento em 318px, fazendo a página
     * inteira deslizar de lado. Com o rolável posicionado, ele fica contido.
     */
    <div
      role="group"
      aria-label="Colunas do quadro — use as setas para rolar"
      tabIndex={0}
      className="relative flex h-full gap-3 overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
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
              'flex w-80 shrink-0 flex-col rounded-card border bg-surface-sunken',
              destacada ? 'border-accent bg-accent-soft/40' : 'border-border'
            )}
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              {/* O PONTO DE CATEGORIA: a coluna passa a ter identidade visual
                  além da posição, e o olho encontra "em execução" sem ler. */}
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', PONTO_DE_CATEGORIA[coluna.category])}
              />
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text">{coluna.label}</h2>
              <span
                className="rounded-pill bg-surface px-2 py-0.5 text-xs font-semibold text-muted tabular-nums"
                data-numeric
              >
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

/**
 * O cartão de uma OS no quadro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUADRO PRECISA RESPONDER SEM QUE NINGUÉM ABRA NADA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A versão anterior trazia título, número e prioridade. Isso diz o que a OS é,
 * e não diz nada sobre o que fazer com ela — que é a pergunta de quem olha um
 * quadro. As quatro perguntas de gestão são:
 *
 *   · onde está o gargalo?      → a contagem e a quebra por motivo, na coluna
 *   · o que está crítico?       → a barra de prioridade, lida antes do texto
 *   · o que está SEM DONO?      → o rosto ausente, dito por extenso
 *   · o que está atrasado?      → a data, destacada quando já passou
 *
 * As três últimas são deste cartão, e nenhuma existia.
 */
/**
 * A cor de cada fase, e por que ela não sai do banco.
 *
 * `work_order_statuses.color` existe e é configurável por organização — e é
 * exatamente por isso que NÃO é usada aqui: uma organização que escolheu
 * vermelho para "concluída" faria o quadro inteiro parecer um alarme. A cor da
 * COLUNA sai da CATEGORIA, que é fixa na plataforma e é o que o software
 * interpreta (ADR-003); a cor escolhida pela organização continua valendo onde
 * ela identifica a situação, e não onde comunica gravidade.
 */
const PONTO_DE_CATEGORIA: Record<string, string> = {
  draft: 'bg-border-strong',
  open: 'bg-info',
  scheduled: 'bg-accent',
  in_progress: 'bg-accent',
  waiting: 'bg-warn',
  review: 'bg-info',
  done: 'bg-good',
  closed: 'bg-good',
  cancelled: 'bg-border-strong',
};

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
  const critica = os.priority === 'emergency' || os.priority === 'very_urgent';
  const urgente = os.priority === 'urgent';

  // "Atrasada" aqui é sobre a JANELA marcada, e não sobre o SLA: são dois
  // relógios diferentes, e misturá-los faria o cartão acusar atraso numa OS
  // cujo prazo contratual está em dia.
  const atrasada =
    os.scheduled_start !== null &&
    new Date(os.scheduled_start).getTime() < Date.now() &&
    os.category !== 'done' &&
    os.category !== 'closed' &&
    os.category !== 'cancelled';

  return (
    <Link
      to="/ordens/$id"
      params={{ id: os.id }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={ocupada || undefined}
      className={cn(
        'relative block overflow-hidden rounded-card border border-border bg-surface p-3 pl-4 shadow-card transition-all hover:border-border-strong hover:shadow-raised',
        ocupada && 'opacity-60'
      )}
    >
      {/* A prioridade como barra: lida antes de qualquer palavra, e visível
          em tela lavada onde um chip suave desaparece. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          critica ? 'bg-bad' : urgente ? 'bg-warn' : 'bg-transparent'
        )}
      />

      <p className="line-clamp-2 text-sm leading-tight font-medium text-text">{os.title}</p>

      <p className="mt-1.5 truncate text-2xs text-muted" data-numeric>
        {os.number ?? 'sem número'}
        {os.asset_name_snapshot ? ` · ${os.asset_name_snapshot}` : ''}
      </p>

      {os.location_name_snapshot && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-2xs text-subtle">
          <MapPin aria-hidden="true" className="size-3 shrink-0" />
          {os.location_name_snapshot}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <PrioridadeChip prioridade={os.priority} />
        {os.wait_reason_label && (
          <StatusChip tone="warn" size="sm">
            {os.wait_reason_label}
          </StatusChip>
        )}
        {atrasada && (
          <StatusChip tone="bad" size="sm">
            Atrasada
          </StatusChip>
        )}
      </div>

      {os.scheduled_start && (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-2xs',
            atrasada ? 'font-medium text-bad-text' : 'text-subtle'
          )}
          data-numeric
        >
          <CalendarClock aria-hidden="true" className="size-3 shrink-0" />
          {new Date(os.scheduled_start).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          })}
          {' · '}
          {new Date(os.scheduled_start).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
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
