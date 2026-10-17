/**
 * Aurora — Planos de Manutenção: o módulo.
 *
 * TRÊS PERGUNTAS, TRÊS ABAS, UM MOTOR.
 *
 *   · Visão geral  — "está em dia?": programados × realizados × vencidos, por
 *                    mês, por tipo, por cliente e por setor, e os planos;
 *   · Cronograma   — "o que vem aí?": as atividades reais e as PREVISTAS pela
 *                    frequência, com cliente, setor, equipamento e procedimento;
 *   · Procedimentos— "o que se faz em cada uma?": os checklists versionados.
 *
 * Tudo lê o motor que já existia (planos/tarefas/ciclos da 0029, checklists
 * da 0024/0052). A Agenda continua sendo a das OS — o cronograma aponta para
 * ela, não a duplica.
 *
 * NADA DE HISTÓRICO INVENTADO: o painel conta os itens de ciclo que existem.
 * O que ainda não foi gerado só aparece no cronograma, marcado "previsto".
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Plus,
  Repeat,
  TriangleAlert,
  Play,
} from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  ColumnChart,
  EmptyState,
  FilterChip,
  RateRing,
  SegmentGroup,
  Select,
  Skeleton,
  SkeletonList,
  StatusChip,
  Tabs,
  cn,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  customersDetail,
  customersList,
  plansBoard,
  plansExecuteItem,
  plansList,
  plansSchedule,
  type Customer,
  type CustomerLocation,
  type PlanRow,
  type ScheduleEntry,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarDataRelativa } from '../../routes/hoje';
import { AlternadorDeTrabalho } from './alternador';
import { NovoPlanoDialog } from './novo-plano';
import { ProcedimentosAba } from './procedimentos';
import { ROTULO_ESTADO_ITEM, TOM_ESTADO_ITEM, dataCurta, rotuloDoMes, rotuloTipo } from '../painel/rotulos';

type Aba = 'visao' | 'cronograma' | 'procedimentos';

type Linha = { key: string; label: string; done: number; pending: number; late: number; skipped: number };

interface Board {
  byPlan?: Linha[];
  byProcedure?: Linha[];
  totals: { done: number; pending: number; late: number; skipped: number; scheduled: number };
  rate: number | null;
  byKind: Array<{ key: string; done: number; pending: number; late: number; skipped: number }>;
  byCustomer: Array<{
    key: string;
    label: string;
    done: number;
    pending: number;
    late: number;
    skipped: number;
  }>;
  bySector: Array<{
    key: string;
    label: string;
    done: number;
    pending: number;
    late: number;
    skipped: number;
  }>;
  byMonth: Array<{ key: string; done: number; pending: number; late: number; skipped: number }>;
  plans: { active: number; tasks: number };
}

/* -------------------------------------------------------------------------- */
/* recortes de tempo                                                           */
/* -------------------------------------------------------------------------- */

function dia(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
const DIA = 86_400_000;

const RECORTES_VISAO = {
  ano: {
    rotulo: 'Ano corrente',
    calc: () => ({
      from: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
      to: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)),
    }),
  },
  '90d': {
    rotulo: 'Últimos 90 dias',
    calc: () => ({
      from: new Date(dia(new Date()).getTime() - 89 * DIA),
      to: new Date(dia(new Date()).getTime() + DIA),
    }),
  },
  '12m': {
    rotulo: 'Últimos 12 meses',
    calc: () => ({
      from: new Date(dia(new Date()).getTime() - 364 * DIA),
      to: new Date(dia(new Date()).getTime() + DIA),
    }),
  },
  prox: {
    rotulo: 'Próximos 12 meses',
    calc: () => ({ from: dia(new Date()), to: new Date(dia(new Date()).getTime() + 365 * DIA) }),
  },
} as const;

const RECORTES_CRONO = {
  '30d': {
    rotulo: 'Próximos 30 dias',
    calc: () => ({
      from: new Date(dia(new Date()).getTime() - 30 * DIA),
      to: new Date(dia(new Date()).getTime() + 31 * DIA),
    }),
  },
  '90d': {
    rotulo: 'Próximos 90 dias',
    calc: () => ({
      from: new Date(dia(new Date()).getTime() - 30 * DIA),
      to: new Date(dia(new Date()).getTime() + 91 * DIA),
    }),
  },
  '12m': {
    rotulo: 'Próximos 12 meses',
    calc: () => ({
      from: new Date(dia(new Date()).getTime() - 30 * DIA),
      to: new Date(dia(new Date()).getTime() + 366 * DIA),
    }),
  },
} as const;

/* -------------------------------------------------------------------------- */

export function PlanosModuloPage() {
  const [aba, setAba] = useUrlState<Aba>('aba', 'visao');
  const [cliente, setCliente] = useUrlState<string>('cliente', '');
  const [setor, setSetor] = useUrlState<string>('setor', '');
  // Tipo combinável com cliente e setor, nas duas abas (reunião 16/10/2026) — filtro do SERVIDOR.
  const [tipo, setTipo] = useUrlState<string>('tipo', '');
  const [criando, setCriando] = useState(false);

  return (
    <AppShell
      title="Planos de manutenção"
      subtitle="Preventiva, calibração, TSE e qualificação — o que se repete sozinho, e se está saindo no prazo."
      actions={
        <Can permission="maintenance_plan.create">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCriando(true)}>
            Novo plano
          </Button>
        </Can>
      }
    >
      <div className="flex flex-col gap-4">
        <AlternadorDeTrabalho />
        <Tabs
          idPrefix="planos"
          value={aba}
          onChange={(v) => setAba(v as Aba)}
          aria-label="Planos de manutenção"
          items={[
            { id: 'visao', label: 'Visão geral' },
            { id: 'cronograma', label: 'Cronograma' },
            { id: 'procedimentos', label: 'Procedimentos e checklists' },
          ]}
        />
        {aba !== 'procedimentos' && (
          <FiltroClienteSetor
            cliente={cliente}
            setor={setor}
            onCliente={(c) => {
              setCliente(c);
              setSetor('');
            }}
            onSetor={setSetor}
            tipo={tipo}
            onTipo={setTipo}
          />
        )}
        <div role="tabpanel" id={tabIds('planos', aba).painel} aria-labelledby={tabIds('planos', aba).aba}>
          {aba === 'visao' && <VisaoGeral cliente={cliente} setor={setor} tipo={tipo} />}
          {aba === 'cronograma' && <Cronograma cliente={cliente} setor={setor} tipo={tipo} />}
          {aba === 'procedimentos' && <ProcedimentosAba />}
        </div>
      </div>
      <NovoPlanoDialog
        open={criando}
        onOpenChange={setCriando}
        clienteInicial={cliente || undefined}
        setorInicial={setor || undefined}
      />
    </AppShell>
  );
}

const TIPOS_DE_PLANO = ['preventive', 'calibration', 'electrical_safety', 'qualification'] as const;

function FiltroClienteSetor({
  cliente,
  setor,
  onCliente,
  onSetor,
  tipo,
  onTipo,
}: {
  cliente: string;
  setor: string;
  onCliente: (c: string) => void;
  onSetor: (s: string) => void;
  tipo: string;
  onTipo: (t: string) => void;
}) {
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Customer[] } | undefined };
  const { data: det } = useApiQuery(
    customersDetail,
    { params: { id: cliente } },
    { enabled: Boolean(cliente) }
  ) as {
    data: { locations: CustomerLocation[] } | undefined;
  };
  const setores = (det?.locations ?? []).filter((l) => l.location_type_key === 'setor');
  return (
    <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label="Filtros dos planos">
      <Select aria-label="Tipo" value={tipo} onChange={(e) => onTipo(e.target.value)} className="sm:w-56">
        <option value="">Todos os tipos</option>
        {TIPOS_DE_PLANO.map((t) => (
          <option key={t} value={t}>
            {rotuloTipo(t)}
          </option>
        ))}
      </Select>
      {(clientes?.items.length ?? 0) > 1 && (
        <Select
          aria-label="Cliente"
          value={cliente}
          onChange={(e) => onCliente(e.target.value)}
          className="sm:w-64"
        >
          <option value="">Todos os clientes</option>
          {clientes!.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {setores.length > 0 && (
        <Select
          aria-label="Setor"
          value={setor}
          onChange={(e) => onSetor(e.target.value)}
          className="sm:w-56"
        >
          <option value="">Todos os setores</option>
          {setores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function VisaoGeral({ cliente, setor, tipo }: { cliente: string; setor: string; tipo: string }) {
  const [recorte, setRecorte] = useUrlState<keyof typeof RECORTES_VISAO>('recorte', 'ano');
  const intervalo = useMemo(() => (RECORTES_VISAO[recorte] ?? RECORTES_VISAO.ano).calc(), [recorte]);
  const query = {
    from: intervalo.from.toISOString(),
    to: intervalo.to.toISOString(),
    ...(cliente ? { customer: cliente } : {}),
    ...(setor ? { sector: setor } : {}),
    ...(tipo ? { kind: tipo as (typeof TIPOS_DE_PLANO)[number] } : {}),
  };
  const board = useApiQuery(plansBoard, { query }) as {
    data: Board | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  const planos = useApiQuery(plansList, { query: cliente ? { customer: cliente } : {} }) as {
    data: { items: PlanRow[] } | undefined;
    isLoading: boolean;
  };

  if (board.isError) return <ErrorScreen error={board.error} />;
  const b = board.data;

  return (
    <div className="flex flex-col gap-5">
      <SegmentGroup label="Período">
        {Object.entries(RECORTES_VISAO).map(([k, v]) => (
          <FilterChip
            key={k}
            segment
            active={recorte === k}
            onClick={() => setRecorte(k as keyof typeof RECORTES_VISAO)}
          >
            {v.rotulo}
          </FilterChip>
        ))}
      </SegmentGroup>

      {board.isLoading || !b ? (
        <div aria-busy="true" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Numero
              icone={<Repeat className="size-4" />}
              rotulo="Planos ativos"
              valor={b.plans.active}
              dica={`${b.plans.tasks} tarefas`}
              tom="accent"
            />
            <Numero
              icone={<CalendarClock className="size-4" />}
              rotulo="Programados"
              valor={b.totals.scheduled}
              dica="itens de ciclo no período"
              tom="info"
            />
            <Numero
              icone={<CheckCircle2 className="size-4" />}
              rotulo="Realizados"
              valor={b.totals.done}
              tom="good"
            />
            <Numero
              icone={<Clock3 className="size-4" />}
              rotulo="Pendentes"
              valor={b.totals.pending}
              dica="dentro do prazo"
              tom="info"
            />
            <Numero
              icone={<TriangleAlert className="size-4" />}
              rotulo="Vencidos"
              valor={b.totals.late}
              dica="passou do prazo + tolerância"
              tom={b.totals.late > 0 ? 'bad' : 'neutral'}
            />
          </div>

          {b.totals.scheduled === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="Nenhuma atividade programada no período"
                description="Atividades aparecem aqui quando o ciclo do plano abre (na antecedência configurada). O que ainda vai acontecer está no Cronograma, como previsto."
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader
                    title="Realizado × pendente × vencido, por mês"
                    description="Pelo vencimento de cada atividade, com a tolerância da tarefa."
                  />
                  <div className="px-4 pb-4">
                    <ColumnChart
                      label="Atividades de plano por mês e situação"
                      labels={b.byMonth.map((m) => rotuloDoMes(m.key))}
                      segments={[
                        {
                          key: 'done',
                          label: 'Realizados',
                          values: b.byMonth.map((m) => m.done),
                          tone: 'good',
                        },
                        {
                          key: 'pending',
                          label: 'Pendentes',
                          values: b.byMonth.map((m) => m.pending),
                          tone: 'info',
                        },
                        { key: 'late', label: 'Vencidos', values: b.byMonth.map((m) => m.late), tone: 'bad' },
                        {
                          key: 'skipped',
                          label: 'Dispensados',
                          values: b.byMonth.map((m) => m.skipped),
                          tone: 'neutral',
                        },
                      ]}
                    />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Em dia" description="Realizados ÷ (programados − dispensados)." />
                  <div className="flex flex-col items-center gap-3 px-4 pb-4">
                    <RateRing
                      value={b.rate}
                      label="Conformidade dos planos"
                      tone={
                        b.rate === null ? 'neutral' : b.rate >= 90 ? 'good' : b.rate >= 70 ? 'warn' : 'bad'
                      }
                      size={140}
                      caption={`${b.totals.done} de ${b.totals.scheduled - b.totals.skipped}`}
                    />
                  </div>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Distribuicao
                  titulo="Por tipo"
                  linhas={b.byKind.map((k) => ({ ...k, label: rotuloTipo(k.key) }))}
                />
                <Distribuicao titulo="Por cliente" linhas={b.byCustomer} />
                <Distribuicao titulo="Por setor" linhas={b.bySector} />
                {b.byPlan && b.byPlan.length > 0 && <Distribuicao titulo="Por plano" linhas={b.byPlan} />}
                {b.byProcedure && b.byProcedure.length > 0 && (
                  <Distribuicao titulo="Por procedimento" linhas={b.byProcedure} />
                )}
              </div>
            </>
          )}
        </>
      )}

      <Card>
        <CardHeader
          title="Planos"
          description="Plano sem tarefa não gera nada — por isso a contagem aparece na lista."
        />
        {planos.isLoading ? (
          <div className="p-3">
            <SkeletonList rows={4} label="planos" />
          </div>
        ) : (planos.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Repeat className="size-5" />}
            title="Nenhum plano cadastrado"
            description="Um plano transforma 'todo semestre o monitor da UTI precisa de preventiva' em atividades que aparecem sozinhas."
          />
        ) : (
          <ul>
            {planos.data!.items.map((p, i) => (
              <li key={p.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                <Link
                  to="/planos/$id"
                  params={{ id: p.id }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-card bg-accent-soft text-accent-text"
                    aria-hidden="true"
                  >
                    <Repeat className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text">{p.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {p.customer_name}
                      {p.next_cycle_ends_at
                        ? ` · ciclo vence ${formatarDataRelativa(p.next_cycle_ends_at)}`
                        : ' · ciclo ainda não aberto'}
                    </span>
                  </span>
                  {p.task_count === 0 ? (
                    <StatusChip tone="warn" size="sm">
                      Sem tarefa
                    </StatusChip>
                  ) : (
                    <StatusChip tone="neutral" size="sm">
                      {p.task_count} {p.task_count === 1 ? 'tarefa' : 'tarefas'}
                    </StatusChip>
                  )}
                  {!p.auto_generate && (
                    <StatusChip
                      tone="info"
                      size="sm"
                      hint="As OS do ciclo são geradas à mão, depois de revisar"
                    >
                      Manual
                    </StatusChip>
                  )}
                  {!p.is_active && (
                    <StatusChip tone="neutral" size="sm">
                      Inativo
                    </StatusChip>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Numero({
  icone,
  rotulo,
  valor,
  dica,
  tom,
}: {
  icone: ReactNode;
  rotulo: string;
  valor: number;
  dica?: string;
  tom: 'good' | 'info' | 'bad' | 'accent' | 'neutral';
}) {
  const cor = {
    good: 'bg-good-soft text-good-text',
    info: 'bg-info-soft text-info-text',
    bad: 'bg-bad-soft text-bad-text',
    accent: 'bg-accent-soft text-accent-text',
    neutral: 'bg-surface-hover text-muted',
  }[tom];
  return (
    <Card>
      <div className="flex flex-col gap-2 p-4 lg:p-5">
        <span className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="min-w-0 flex-1 truncate">{rotulo}</span>
          <span
            className={cn('flex size-7 shrink-0 items-center justify-center rounded-control', cor)}
            aria-hidden="true"
          >
            {icone}
          </span>
        </span>
        <span
          data-numeric
          className={cn(
            'text-3xl leading-none font-bold tracking-display tabular-nums',
            tom === 'bad' && valor > 0 ? 'text-bad-text' : 'text-text'
          )}
        >
          {valor.toLocaleString('pt-BR')}
        </span>
        {dica && <span className="text-xs text-subtle">{dica}</span>}
      </div>
    </Card>
  );
}

/** Barras horizontais empilhadas por estado — composição de cada linha, com o número ao lado. */
function Distribuicao({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: Array<{ key: string; label: string; done: number; pending: number; late: number; skipped: number }>;
}) {
  const ordenadas = [...linhas]
    .sort((a, b) => b.done + b.pending + b.late + b.skipped - (a.done + a.pending + a.late + a.skipped))
    .slice(0, 8);
  const max = Math.max(1, ...ordenadas.map((l) => l.done + l.pending + l.late + l.skipped));
  const partes = [
    { k: 'done' as const, cor: 'bg-good', rotulo: 'Realizados' },
    { k: 'pending' as const, cor: 'bg-info', rotulo: 'Pendentes' },
    { k: 'late' as const, cor: 'bg-bad', rotulo: 'Vencidos' },
    { k: 'skipped' as const, cor: 'bg-border-strong', rotulo: 'Dispensados' },
  ];
  return (
    <Card>
      <CardHeader title={titulo} />
      <div className="flex flex-col gap-2.5 px-4 pb-4">
        {ordenadas.length === 0 ? (
          <p className="text-sm text-muted">Sem atividades.</p>
        ) : (
          ordenadas.map((l) => {
            const total = l.done + l.pending + l.late + l.skipped;
            return (
              <div key={l.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-muted" title={l.label}>
                    {l.label}
                  </span>
                  <span className="shrink-0 text-xs text-subtle tabular-nums" data-numeric>
                    {l.done}/{total - l.skipped}
                    {l.late > 0 && <span className="ml-1.5 text-bad-text">{l.late} venc.</span>}
                  </span>
                </div>
                <div
                  className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
                  style={{ width: `${Math.max((total / max) * 100, 6)}%` }}
                  role="img"
                  aria-label={`${l.label}: ${partes.map((p) => `${l[p.k]} ${p.rotulo.toLowerCase()}`).join(', ')}`}
                >
                  {partes.map((p) =>
                    l[p.k] > 0 ? <span key={p.k} className={p.cor} style={{ flexGrow: l[p.k] }} /> : null
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* cronograma                                                                  */
/* -------------------------------------------------------------------------- */

const FILTROS_ESTADO = [
  { v: '', r: 'Todas' },
  { v: 'late', r: 'Vencidas' },
  { v: 'pending', r: 'Pendentes' },
  { v: 'planned', r: 'Previstas' },
  { v: 'done', r: 'Realizadas' },
] as const;

function Cronograma({ cliente, setor, tipo }: { cliente: string; setor: string; tipo: string }) {
  const [recorte, setRecorte] = useUrlState<keyof typeof RECORTES_CRONO>('janela', '90d');
  const [estado, setEstado] = useUrlState<string>('estado', '');
  const intervalo = useMemo(() => (RECORTES_CRONO[recorte] ?? RECORTES_CRONO['90d']).calc(), [recorte]);
  const { data, isLoading, isError, error } = useApiQuery(plansSchedule, {
    query: {
      from: intervalo.from.toISOString(),
      to: intervalo.to.toISOString(),
      ...(cliente ? { customer: cliente } : {}),
      ...(setor ? { sector: setor } : {}),
      ...(tipo ? { kind: tipo as (typeof TIPOS_DE_PLANO)[number] } : {}),
    },
  }) as {
    data: { items: ScheduleEntry[]; truncated: boolean } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const itens = useMemo(() => data?.items ?? [], [data]);
  const filtrados = itens.filter((i) => !estado || i.state === estado);
  const porMes = useMemo(() => {
    const m = new Map<string, ScheduleEntry[]>();
    for (const i of filtrados) {
      const k = i.due_at.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [filtrados]);
  const meses = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const i of itens) {
      const k = i.due_at.slice(0, 7);
      const v = m.get(k) ?? { done: 0, pending: 0, late: 0, planned: 0, skipped: 0 };
      v[i.state] = (v[i.state] ?? 0) + 1;
      m.set(k, v);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [itens]);

  if (isError) return <ErrorScreen error={error} />;
  const contar = (s: string) => itens.filter((i) => i.state === s).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <SegmentGroup label="Janela">
          {Object.entries(RECORTES_CRONO).map(([k, v]) => (
            <FilterChip
              key={k}
              segment
              active={recorte === k}
              onClick={() => setRecorte(k as keyof typeof RECORTES_CRONO)}
            >
              {v.rotulo}
            </FilterChip>
          ))}
        </SegmentGroup>
        <Link
          to="/agenda"
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-accent-text hover:underline"
        >
          <CalendarDays className="size-4" aria-hidden="true" />
          As OS geradas entram na Agenda
        </Link>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-card" />
      ) : itens.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title="Nada no cronograma desta janela"
            description="Crie um plano para um setor — as atividades previstas aparecem aqui pela periodicidade."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Carga por mês"
              description="Atividades reais (geradas) e previstas (calculadas pela frequência do plano, ainda não geradas)."
            />
            <div className="px-4 pb-4">
              <ColumnChart
                label="Atividades do cronograma por mês"
                labels={meses.map(([k]) => rotuloDoMes(k))}
                segments={[
                  {
                    key: 'done',
                    label: 'Realizadas',
                    values: meses.map(([, v]) => v.done ?? 0),
                    tone: 'good',
                  },
                  {
                    key: 'pending',
                    label: 'Pendentes',
                    values: meses.map(([, v]) => v.pending ?? 0),
                    tone: 'info',
                  },
                  { key: 'late', label: 'Vencidas', values: meses.map(([, v]) => v.late ?? 0), tone: 'bad' },
                  {
                    key: 'planned',
                    label: 'Previstas',
                    values: meses.map(([, v]) => v.planned ?? 0),
                    series: 3,
                  },
                ]}
              />
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situação">
            {FILTROS_ESTADO.map((f) => (
              <FilterChip
                key={f.v}
                active={estado === f.v}
                onClick={() => setEstado(f.v)}
                count={f.v ? contar(f.v) : itens.length}
              >
                {f.r}
              </FilterChip>
            ))}
          </div>

          {data?.truncated && (
            <p className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
              Muitas atividades previstas nesta janela — mostrando as primeiras. Filtre por cliente ou setor.
            </p>
          )}

          {porMes.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ListChecks className="size-5" />}
                title="Nenhuma atividade com esse filtro"
                filtered
              />
            </Card>
          ) : (
            porMes.map(([mes, lista]) => (
              <Card key={mes}>
                <CardHeader
                  title={rotuloDoMesLongo(mes)}
                  actions={<span className="text-sm text-muted tabular-nums">{lista.length}</span>}
                />
                <ul>
                  {lista.map((i, n) => (
                    <LinhaCronograma
                      key={i.id ?? `${i.plan_id}-${i.asset_id}-${i.due_at}-${n}`}
                      i={i}
                      primeira={n === 0}
                    />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}

function rotuloDoMesLongo(chave: string): string {
  const [a, m] = chave.split('-');
  const d = new Date(Date.UTC(Number(a), Number(m) - 1, 1));
  const t = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function LinhaCronograma({ i, primeira }: { i: ScheduleEntry; primeira: boolean }) {
  const data = new Date(i.due_at);
  const corpo = (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span
        className={cn(
          'flex w-12 shrink-0 flex-col items-center rounded-control border py-1 leading-tight',
          i.projected ? 'border-dashed border-border-strong' : 'border-border bg-surface-subtle'
        )}
      >
        <span className="text-lg font-semibold text-text tabular-nums">
          {String(data.getUTCDate()).padStart(2, '0')}
        </span>
        <span className="text-2xs text-muted uppercase">
          {data.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text">{i.asset_name}</span>
        <span className="block truncate text-xs text-muted">
          {[i.sector_name, i.customer_name, i.plan_name].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="hidden shrink-0 sm:block">
        <StatusChip size="sm" tone="neutral" withoutDot>
          <ClipboardCheck className="mr-1 inline size-3" aria-hidden="true" />
          {rotuloTipo(i.kind)}
        </StatusChip>
      </span>
      <StatusChip size="sm" tone={TOM_ESTADO_ITEM[i.state] ?? 'neutral'}>
        {ROTULO_ESTADO_ITEM[i.state] ?? i.state}
      </StatusChip>
      {i.work_order_number && (
        <span className="hidden text-xs text-muted tabular-nums md:inline">OS {i.work_order_number}</span>
      )}
    </div>
  );
  return (
    <li
      className={cn('flex items-center', !primeira && 'border-t border-border-subtle')}
      title={`Vence ${dataCurta(i.due_at)}`}
    >
      <div className="min-w-0 flex-1">
        {i.work_order_id ? (
          <Link
            to="/ordens/$id"
            params={{ id: i.work_order_id }}
            className="block transition-colors hover:bg-surface-hover"
          >
            {corpo}
          </Link>
        ) : (
          corpo
        )}
      </div>
      <BotaoExecutarItem i={i} />
    </li>
  );
}

/**
 * ▶ Executar (reunião 16/10/2026): cliente → plano → setor → equipamento →
 * procedimento. Item real e em aberto abre o assistente da OS; sem OS ainda, a
 * OS nasce pela geração da varredura (com o procedimento da versão certa).
 * Previsto não executa: precisa do ciclo gerado.
 */
function BotaoExecutarItem({ i }: { i: ScheduleEntry }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const executar = useApiMutation(plansExecuteItem, {
    invalidates: [plansSchedule, plansBoard],
    onError: (e: ApiError) => toast.error('Não foi possível executar', e.problem.message),
  });
  const encerrada = ['done', 'closed', 'cancelled'].includes(i.work_order_category ?? '');
  const pode = can('maintenance_plan.generate_cycle') || can('work_order.execute');
  if (i.projected || !i.id || i.state === 'skipped' || i.state === 'done' || encerrada || !pode) return null;
  return (
    <Button
      size="sm"
      className="mr-3 shrink-0"
      icon={<Play className="size-3.5" />}
      loading={executar.isPending}
      aria-label={`Executar ${i.task_name} em ${i.asset_name}`}
      onClick={() => {
        if (i.work_order_id) {
          void navigate({ to: '/ordens/$id/executar', params: { id: i.work_order_id } });
          return;
        }
        executar.mutate(
          { params: { itemId: i.id! } },
          {
            onSuccess: (r) =>
              void navigate({
                to: '/ordens/$id/executar',
                params: { id: (r as { work_order_id: string }).work_order_id },
              }),
          }
        );
      }}
    >
      Executar
    </Button>
  );
}
