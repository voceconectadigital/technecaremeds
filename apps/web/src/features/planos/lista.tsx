/**
 * Aurora — planos de manutenção preventiva (SPEC v0.2 §13 · EPIC-013).
 *
 * A PERGUNTA É "A PREVENTIVA ESTÁ EM DIA?", e ela não se responde com uma
 * lista de planos.
 *
 * Responde-se com o ciclo ABERTO de cada tarefa e o estado de cada item dentro
 * dele. Por isso a lista não para no nome do plano: mostra quantas tarefas ele
 * tem — plano sem tarefa não gera nada, e é o erro de cadastro mais comum — e
 * quando o próximo ciclo vence.
 *
 * O QUE A TELA DIZ QUE OUTRAS NÃO DIZEM
 *
 * "Tarefa sem ciclo aberto" NÃO é erro: pode ainda não ter chegado a
 * antecedência de geração. A tela distingue "ainda não" de "nunca vai" — a
 * primeira é normal, a segunda é um plano desligado que ninguém percebeu.
 */
import { Link, useParams } from '@tanstack/react-router';
import { CalendarClock, CircleAlert, CircleCheck, CircleSlash, Repeat } from 'lucide-react';
import { Card, CardHeader, EmptyState, Skeleton, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { cycleCompliance, planDetail, plansList, type PlanRow, type PlanTask } from '@aurora/contracts';
import { useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarDataRelativa } from '../../routes/hoje';
import { AlternadorDeTrabalho } from './alternador';

export function PlanosPage() {
  const { data, isLoading, isError, error } = useApiQuery(plansList) as {
    data: { items: PlanRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const itens = data?.items ?? [];

  return (
    <AppShell title="Planos preventivos" subtitle="O que se repete sozinho — e se está saindo no prazo.">
      <div className="flex flex-col gap-4">
        <AlternadorDeTrabalho />

        <Card>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={5} label="planos" />
            </div>
          ) : itens.length === 0 ? (
            <EmptyState
              icon={<Repeat className="size-5" />}
              title="Nenhum plano cadastrado"
              description="Um plano transforma 'toda quinta o filtro precisa ser trocado' em ordens que aparecem sozinhas."
            />
          ) : (
            <ul>
              {itens.map((p, i) => (
                <li key={p.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                  <Link
                    to="/planos/$id"
                    params={{ id: p.id }}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-text">{p.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {p.customer_name}
                        {p.next_cycle_ends_at
                          ? ` · próximo ciclo vence ${formatarDataRelativa(p.next_cycle_ends_at)}`
                          : ' · nenhum ciclo aberto'}
                      </span>
                    </span>

                    {/*
                     * PLANO SEM TAREFA NÃO GERA NADA.
                     *
                     * É o erro de cadastro mais comum: alguém cria o plano,
                     * salva, e descobre três meses depois que nenhuma
                     * preventiva foi aberta. Dizer isso na lista custa um chip
                     * e evita um trimestre.
                     */}
                    {p.task_count === 0 ? (
                      <StatusChip
                        tone="warn"
                        size="sm"
                        hint="Um plano sem tarefa nunca gera ordem de serviço"
                      >
                        Sem tarefa
                      </StatusChip>
                    ) : (
                      <span className="shrink-0 text-xs text-muted tabular-nums" data-numeric>
                        {p.task_count} {p.task_count === 1 ? 'tarefa' : 'tarefas'}
                      </span>
                    )}

                    {!p.auto_generate && (
                      <StatusChip
                        tone="neutral"
                        size="sm"
                        hint="O ciclo abre, mas as ordens só são criadas quando alguém confirma"
                      >
                        Manual
                      </StatusChip>
                    )}
                    <StatusChip tone={p.is_active ? 'good' : 'neutral'} size="sm">
                      {p.is_active ? 'Ativo' : 'Desligado'}
                    </StatusChip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

export function PlanoPage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const { data, isLoading, isError, error } = useApiQuery(planDetail, { params: { id } }) as {
    data: { plan: PlanRow & { created_at: string }; tasks: PlanTask[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Plano preventivo">
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={data.plan.name}
      subtitle={data.plan.customer_name}
      breadcrumbs={[{ label: 'Planos preventivos', href: '/planos' }, { label: data.plan.name }]}
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <StatusChip tone={data.plan.is_active ? 'good' : 'neutral'}>
              {data.plan.is_active ? 'Ativo' : 'Desligado'}
            </StatusChip>
            <StatusChip tone={data.plan.auto_generate ? 'info' : 'neutral'} size="sm">
              {data.plan.auto_generate ? 'Gera ordens sozinho' : 'Ordens criadas à mão'}
            </StatusChip>
            {data.plan.include_late_assets && (
              <StatusChip
                tone="neutral"
                size="sm"
                hint="Equipamento que entrou no meio do ciclo também entra na conta"
              >
                Inclui atrasados
              </StatusChip>
            )}
            {data.plan.description && <p className="w-full text-sm text-muted">{data.plan.description}</p>}
          </div>
        </Card>

        {data.tasks.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CircleAlert className="size-5" />}
              title="Este plano não tem tarefa"
              description="Sem tarefa, ele nunca vai gerar ordem de serviço — está cadastrado e inerte."
            />
          </Card>
        ) : (
          data.tasks.map((t) => <Tarefa key={t.id} tarefa={t} />)
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function Tarefa({ tarefa }: { tarefa: PlanTask }) {
  return (
    <Card>
      <CardHeader
        title={tarefa.name}
        description={`${descreverFrequencia(tarefa)} · tolerância de ${tarefa.tolerance_days} ${tarefa.tolerance_days === 1 ? 'dia' : 'dias'}`}
        actions={
          tarefa.open_cycle_id ? (
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              <span data-numeric>
                ciclo {tarefa.open_cycle_seq} · vence{' '}
                {tarefa.open_cycle_ends_at ? formatarDataRelativa(tarefa.open_cycle_ends_at) : '—'}
              </span>
            </span>
          ) : (
            /*
             * "Sem ciclo aberto" NÃO é erro.
             *
             * Pode ainda não ter chegado a antecedência de geração. Marcá-lo
             * como problema ensinaria a equipe a ignorar o aviso — e aí o
             * plano realmente desligado passaria junto.
             */
            <span className="text-sm text-subtle">
              sem ciclo aberto · abre {tarefa.lead_time_days} dias antes
            </span>
          )
        }
      />
      {tarefa.open_cycle_id && <Cumprimento cycleId={tarefa.open_cycle_id} />}
    </Card>
  );
}

/**
 * O cumprimento do ciclo: o resumo E os itens.
 *
 * Só o resumo não deixa ninguém agir — não diz QUAL equipamento ficou para
 * trás. Só os itens obrigam quem olha a contar na mão, e a conta com
 * tolerância é justamente a que se erra contando na mão.
 */
function Cumprimento({ cycleId }: { cycleId: string }) {
  const { data, isLoading } = useApiQuery(cycleCompliance, { params: { cycleId } }) as {
    data:
      | {
          summary: Record<string, unknown>;
          items: Array<{ id: string; asset_name: string; due_at: string; state: string }>;
        }
      | undefined;
    isLoading: boolean;
  };

  if (isLoading) {
    return (
      <div className="p-3">
        <SkeletonList rows={3} label="itens do ciclo" />
      </div>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={<CircleSlash className="size-5" />}
        title="O ciclo abriu sem nenhum item"
        description="A expressão do alvo não alcançou equipamento nenhum — vale conferir se ela ainda faz sentido."
        className="py-6"
      />
    );
  }

  const porEstado = new Map<string, number>();
  for (const i of data.items) porEstado.set(i.state, (porEstado.get(i.state) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-wrap gap-1.5 px-1">
        {ORDEM_ESTADO.map((e) =>
          porEstado.has(e) ? (
            <StatusChip key={e} tone={TOM_ESTADO[e]} size="sm">
              {porEstado.get(e)} {ROTULO_ESTADO[e]}
            </StatusChip>
          ) : null
        )}
      </div>

      <ul className="flex flex-col">
        {data.items.map((i, idx) => (
          <li
            key={i.id}
            className={cn(
              'flex items-baseline gap-3 px-2.5 py-2 text-sm',
              idx > 0 && 'border-t border-border-subtle'
            )}
          >
            <IconeEstado estado={i.state} />
            <span className="min-w-0 flex-1 truncate text-text">{i.asset_name}</span>
            <span className="shrink-0 text-xs text-muted" data-numeric>
              {formatarDataRelativa(i.due_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/*
 * SEIS ESTADOS, e a distinção entre "em andamento" e "sem ninguém" é a que
 * muda a decisão.
 *
 * Uma preventiva atrasada que JÁ está sendo feita precisa de paciência; uma
 * atrasada em que ninguém tocou precisa de alguém agora. Um rótulo só para as
 * duas faria a lista dizer menos do que o servidor sabe.
 */
const ROTULO_ESTADO: Record<string, string> = {
  done: 'feitas',
  skipped: 'dispensadas',
  on_time_started: 'no prazo, em andamento',
  on_time_not_started: 'no prazo, não iniciadas',
  late_started: 'atrasadas, em andamento',
  late_not_started: 'atrasadas, sem ninguém',
};

const TOM_ESTADO: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  done: 'good',
  skipped: 'neutral',
  on_time_started: 'info',
  on_time_not_started: 'neutral',
  late_started: 'warn',
  late_not_started: 'bad',
};

/** Da mais urgente para a menos: a ordem dos chips é a ordem de atenção. */
const ORDEM_ESTADO = [
  'late_not_started',
  'late_started',
  'on_time_not_started',
  'on_time_started',
  'done',
  'skipped',
] as const;

function IconeEstado({ estado }: { estado: string }) {
  const comum = 'size-3.5 shrink-0';
  if (estado === 'done') return <CircleCheck aria-hidden="true" className={`${comum} text-good`} />;
  if (estado === 'skipped') return <CircleSlash aria-hidden="true" className={`${comum} text-subtle`} />;
  if (estado.startsWith('late')) return <CircleAlert aria-hidden="true" className={`${comum} text-bad`} />;
  return <CalendarClock aria-hidden="true" className={`${comum} text-muted`} />;
}

const SINGULAR: Record<string, string> = {
  day: 'dia',
  week: 'semana',
  month: 'mês',
  quarter: 'trimestre',
  semester: 'semestre',
  year: 'ano',
};

const PLURAL: Record<string, string> = {
  day: 'dias',
  week: 'semanas',
  month: 'meses',
  quarter: 'trimestres',
  semester: 'semestres',
  year: 'anos',
};

/** "a cada 3 meses", e não "month/3". */
function descreverFrequencia(t: PlanTask): string {
  const unidade = t.frequency_interval === 1 ? SINGULAR[t.frequency_unit] : PLURAL[t.frequency_unit];
  return t.frequency_interval === 1 ? `a cada ${unidade}` : `a cada ${t.frequency_interval} ${unidade}`;
}
