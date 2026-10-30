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
import { MetaDaSecao, valorDe, type Secao } from '../painel/relatorio';
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

/**
 * Uma seção do relatório entregue. As gravadas a partir da Fase 1 de
 * indicadores têm `state` e a meta; as mais antigas só têm `status` — e
 * continuam legíveis.
 */
type SecaoEntregue = Partial<Pick<Secao, 'state' | 'target' | 'target_evaluation' | 'target_label'>> & {
  key: string;
  label: string;
  status?: string;
  value: number | null;
  unit: string;
  note: string | null;
  definition: string | null;
};

function valor(s: SecaoEntregue): string {
  // 'awaiting_official_model' (gravado antes de 29/10/2026) era só o aviso do layout: o número existe.
  if (s.status === 'awaiting_definition') return 'Aguardando definição do cliente';
  return valorDe(s);
}

const EMAIL: Record<string, string> = {
  queued_no_transport: 'na fila (sem transporte configurado)',
  queued: 'na fila',
  sent: 'enviado',
  failed: 'falhou',
  suppressed: 'não enviado — preferências de notificação ou e-mail não verificado/bloqueado',
};

export function RelatorioAgendadoPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isLoading, isError, error } = useApiQuery(automationReportOutput, { params: { id } }) as {
    data:
      | {
          rule_name: string;
          tier: string;
          schedule_slot: string;
          filters: Record<string, string | null>;
          sections: SecaoEntregue[];
          email_state: string;
        }
      | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  if (isError) return <ErrorScreen error={error} />;
  const rotulo = data ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '';
  // As datas do período no fuso da organização em que o relatório foi gerado
  // (PF-51), quando o relatório o registrou; senão, no do navegador.
  const dia = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('pt-BR', {
        ...(data?.filters.timezone ? { timeZone: data.filters.timezone } : {}),
      });
    } catch {
      return new Date(iso).toLocaleDateString('pt-BR');
    }
  };
  return (
    <AppShell
      title={data ? `Relatório ${rotulo} — ${data.rule_name}` : 'Relatório agendado'}
      subtitle={
        data?.filters.from
          ? `Período: ${dia(data.filters.from)} a ${dia(data.filters.to ?? data.schedule_slot)}${
              data.filters.customer ? ` · Cliente: ${data.filters.customer}` : ''
            }`
          : undefined
      }
    >
      {isLoading || !data ? (
        <SkeletonList rows={6} label="relatório" />
      ) : (
        <Card>
          <p role="note" className="m-3 rounded-control bg-accent-soft px-3 py-2 text-xs text-text">
            E-mail: {EMAIL[data.email_state] ?? data.email_state}.
          </p>
          <section aria-label="Indicadores" className="flex flex-col divide-y divide-border-subtle">
            {data.sections.map((s) => (
              <div key={s.key} className="flex flex-col gap-0.5 px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  {/* Mesmo tratamento da prévia do relatório (PF-54): PROVISÓRIO
                      marcado e a meta — ou SEM META CONFIGURADA — ao lado. */}
                  <span className="flex items-center gap-2 text-sm text-text">
                    {s.label}
                    {s.state === 'PROVISIONAL' && (
                      <StatusChip size="sm" tone="warn" hint={s.note ?? undefined}>
                        Provisório
                      </StatusChip>
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      // relatório antigo (sem `state`): o que não estava disponível sai em destaque
                      s.state === undefined &&
                        s.status !== undefined &&
                        s.status !== 'available' &&
                        'text-warn-text'
                    )}
                  >
                    {valor(s)}
                  </span>
                </div>
                {s.target_evaluation !== undefined && (
                  <MetaDaSecao
                    s={{
                      target: s.target ?? null,
                      target_evaluation: s.target_evaluation,
                      target_label: s.target_label ?? null,
                    }}
                  />
                )}
                {(s.definition || (s.state === undefined && s.note)) && (
                  <span className="text-xs text-muted">
                    {[s.definition, s.state === undefined ? s.note : null].filter(Boolean).join(' · ')}
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
