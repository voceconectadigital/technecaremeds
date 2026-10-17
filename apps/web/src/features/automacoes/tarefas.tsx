/**
 * Aurora — tarefas, 5W2H e PDCA das automações; relatório agendado entregue
 * (reunião 16/10/2026, Fase 10).
 *
 * Não é um Kanban paralelo: é a lista do plano de ação que as regras geram.
 * Tarefa operacional sobre equipamento continua sendo OS, no quadro de OS.
 */
import { useState } from 'react';
import { CheckCircle2, ListChecks } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { Button, Card, EmptyState, SkeletonList, StatusChip, cn, useToast } from '@aurora/ui';
import {
  automationReportOutput,
  automationTaskAdvance,
  automationTasksList,
  type AutomationTask,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';

const METODO: Record<string, string> = { task: 'Tarefa', '5w2h': '5W2H', pdca: 'PDCA' };
const FASE: Record<string, string> = { plan: 'Planejar', do: 'Executar', check: 'Checar', act: 'Agir' };
const ESTADO: Record<string, string> = { open: 'Aberta', done: 'Concluída', cancelled: 'Cancelada' };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function TarefasPage() {
  const [todas, setTodas] = useState(false);
  const { data, isLoading, isError, error } = useApiQuery(automationTasksList, {
    query: todas ? { all: 'true' } : {},
  }) as {
    data: { items: AutomationTask[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  if (isError) return <ErrorScreen error={error} />;
  const itens = data?.items ?? [];

  return (
    <AppShell title="Tarefas" subtitle="Tarefas, planos 5W2H e ciclos PDCA gerados pelas automações.">
      <Can permission="automation.read">
        <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
          Ver as de toda a equipe
        </label>
      </Can>
      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={4} label="tarefas" />
          </div>
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-5" />}
            title="Nenhuma tarefa"
            description="As automações de tarefa, 5W2H e PDCA criam itens aqui na periodicidade configurada."
          />
        ) : (
          <ul>
            {itens.map((t, i) => (
              <ItemTarefa key={t.id} t={t} primeiro={i === 0} />
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

function ItemTarefa({ t, primeiro }: { t: AutomationTask; primeiro: boolean }) {
  const toast = useToast();
  const avancar = useApiMutation(automationTaskAdvance, {
    invalidates: [automationTasksList],
    onError: (e: ApiError) => toast.error('Não foi possível avançar', e.problem.message),
  });
  const rotuloBotao =
    t.method === 'pdca' && t.pdca_phase && t.pdca_phase !== 'act'
      ? `Concluir ${FASE[t.pdca_phase]}`
      : 'Concluir';

  return (
    <li className={cn('flex flex-col gap-2 px-4 py-3', !primeiro && 'border-t border-border-subtle')}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip size="sm" tone="info">
          {METODO[t.method]}
        </StatusChip>
        <span className="min-w-0 flex-1 text-base text-text">{t.title}</span>
        {t.pdca_phase && t.state === 'open' && (
          <StatusChip size="sm" tone="warn">
            Fase: {FASE[t.pdca_phase]}
          </StatusChip>
        )}
        <StatusChip
          size="sm"
          tone={t.state === 'done' ? 'good' : t.state === 'cancelled' ? 'neutral' : 'warn'}
        >
          {ESTADO[t.state]}
        </StatusChip>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-3">
        <div>
          <dt className="inline">Responsável: </dt>
          <dd className="inline text-text">{t.owner_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="inline">Prazo: </dt>
          <dd className="inline text-text" data-numeric>
            {t.due_date ? new Date(`${t.due_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}
          </dd>
        </div>
        {t.rule_name && (
          <div>
            <dt className="inline">Automação: </dt>
            <dd className="inline text-text">{t.rule_name}</dd>
          </div>
        )}
        {t.method === '5w2h' && (
          <>
            <div>
              <dt className="inline">Por quê: </dt>
              <dd className="inline text-text">{t.why}</dd>
            </div>
            <div>
              <dt className="inline">Onde: </dt>
              <dd className="inline text-text">{t.where_text}</dd>
            </div>
            <div>
              <dt className="inline">Como: </dt>
              <dd className="inline text-text">{t.how}</dd>
            </div>
            <div>
              <dt className="inline">Quanto: </dt>
              <dd className="inline text-text" data-numeric>
                {t.how_much_cents === null ? '—' : reais(t.how_much_cents)}
              </dd>
            </div>
          </>
        )}
      </dl>
      {t.state === 'open' && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCircle2 className="size-3.5" />}
            loading={avancar.isPending}
            onClick={() => avancar.mutate({ params: { id: t.id }, body: { action: 'advance' } })}
          >
            {rotuloBotao}
          </Button>
          <Button
            size="sm"
            onClick={() => avancar.mutate({ params: { id: t.id }, body: { action: 'cancel' } })}
          >
            Cancelar tarefa
          </Button>
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

type Secao = {
  key: string;
  label: string;
  status: string;
  value: number | null;
  unit: string;
  note: string | null;
  definition: string | null;
};

function valor(s: Secao): string {
  if (s.status === 'awaiting_official_model') return 'AGUARDANDO MODELO PDF OFICIAL';
  if (s.status === 'awaiting_definition') return 'Aguardando definição do cliente';
  if (s.value === null) return 'Sem dados suficientes no período';
  const v = s.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return s.unit === 'percent'
    ? `${v} %`
    : s.unit === 'minutes'
      ? `${v} min`
      : s.unit === 'hours'
        ? `${v} h`
        : v;
}

export function RelatorioAgendadoPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isLoading, isError, error } = useApiQuery(automationReportOutput, { params: { id } }) as {
    data:
      | {
          rule_name: string;
          tier: string;
          schedule_slot: string;
          filters: Record<string, string | null>;
          sections: Secao[];
          email_state: string;
        }
      | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  if (isError) return <ErrorScreen error={error} />;
  const rotulo = data ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '';
  return (
    <AppShell
      title={data ? `Relatório ${rotulo} — ${data.rule_name}` : 'Relatório agendado'}
      subtitle={
        data?.filters.from
          ? `Período: ${new Date(data.filters.from).toLocaleDateString('pt-BR')} a ${new Date(
              data.filters.to ?? data.schedule_slot
            ).toLocaleDateString(
              'pt-BR'
            )}${data.filters.customer ? ` · Cliente: ${data.filters.customer}` : ''}`
          : undefined
      }
    >
      {isLoading || !data ? (
        <SkeletonList rows={6} label="relatório" />
      ) : (
        <Card>
          <p role="note" className="m-3 rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
            Layout provisório — AGUARDANDO MODELO PDF OFICIAL. E-mail:{' '}
            {data.email_state === 'queued_no_transport'
              ? 'na fila (sem transporte configurado)'
              : data.email_state}
            .
          </p>
          <section aria-label="Indicadores" className="flex flex-col divide-y divide-border-subtle">
            {data.sections.map((s) => (
              <div key={s.key} className="flex flex-col gap-0.5 px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-text">{s.label}</span>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      s.status !== 'available' && 'text-warn-text'
                    )}
                  >
                    {valor(s)}
                  </span>
                </div>
                {(s.definition || s.note) && (
                  <span className="text-xs text-muted">
                    {[s.definition, s.note].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            ))}
          </section>
        </Card>
      )}
    </AppShell>
  );
}
