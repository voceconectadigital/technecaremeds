/**
 * Aurora — automações (SPEC v0.2 §24 · EPIC-024).
 *
 * A TELA EXISTE PARA IMPEDIR A SEGUNDA-FEIRA RUIM.
 *
 * Uma automação ligada sem simulação é uma automação cujo alcance ninguém
 * conhece. O modo como isso termina é sempre o mesmo: alguém liga na
 * sexta-feira, e na segunda há quatrocentas ordens de serviço abertas que
 * ninguém pediu.
 *
 * Por isso a simulação está NA LISTA, ao lado do botão de ligar, e não
 * escondida num menu: a informação precisa estar onde a decisão é tomada.
 * Uma regra nunca simulada mostra isso em destaque, e o botão de ligar diz o
 * que está sendo ligado às cegas.
 *
 * A QUARENTENA É PROPRIEDADE, NÃO ERRO.
 *
 * Uma regra que falha repetidamente é desligada sozinha, com motivo. Uma
 * automação que falha em silêncio e continua ligada é pior do que automação
 * nenhuma: a equipe passa a contar com um efeito que não está acontecendo.
 */
import { useState } from 'react';
import { AlertTriangle, FlaskConical, Pause, Play, Workflow } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, SkeletonList, StatusChip, cn, useToast } from '@aurora/ui';
import {
  automationActivate,
  automationPause,
  automationRuns,
  automationSimulate,
  automationsList,
  type AutomationRule,
  type RuleRun,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarDataRelativa } from '../../routes/hoje';
import { AlternadorDeConfiguracoes } from '../configuracoes/alternador';

export function AutomacoesPage() {
  const [vendo, setVendo] = useState<AutomationRule | null>(null);

  const { data, isLoading, isError, error } = useApiQuery(automationsList) as {
    data: { items: AutomationRule[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const itens = data?.items ?? [];

  return (
    <AppShell
      title="Automações"
      subtitle="O que o sistema faz sozinho — e quantos casos cada regra pegaria."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Automações' }]}
    >
      <div className="mb-4">
        <AlternadorDeConfiguracoes />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={5} label="automações" />
          </div>
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Workflow className="size-5" />}
            title="Nenhuma automação"
            description="Uma automação transforma “toda vez que X, faça Y” numa regra que roda sozinha — depois de simulada."
          />
        ) : (
          <ul>
            {itens.map((r, i) => (
              <li
                key={r.id}
                className={cn(
                  'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center',
                  i > 0 && 'border-t border-border-subtle'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-text">{r.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                    {r.trigger_kind === 'cron' ? 'no relógio' : `quando ${r.trigger_event}`} ·{' '}
                    {r.action_count} {Number(r.action_count) === 1 ? 'ação' : 'ações'}
                  </span>
                </span>

                <Simulacao regra={r} />

                {r.quarantine_reason && (
                  <StatusChip tone="bad" size="sm" hint={r.quarantine_reason}>
                    <AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />
                    em quarentena
                  </StatusChip>
                )}

                <StatusChip tone={TOM_ESTADO[r.state] ?? 'neutral'} size="sm">
                  {ROTULO_ESTADO[r.state] ?? r.state}
                </StatusChip>

                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setVendo(r)}>
                    Execuções
                  </Button>
                  <Can permission="automation.update">
                    <BotaoLigar regra={r} />
                  </Can>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {vendo && <DialogoExecucoes regra={vendo} onFechar={() => setVendo(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A simulação, ao lado do botão de ligar.
 *
 * Não é decoração: é a informação que decide. Uma regra nunca simulada mostra
 * isso em destaque, porque ligá-la é aceitar um alcance desconhecido — e o
 * alcance desconhecido de uma automação se mede em ordens de serviço abertas
 * durante a madrugada.
 */
function Simulacao({ regra }: { regra: AutomationRule }) {
  const toast = useToast();

  const simular = useApiMutation(automationSimulate, {
    invalidates: [automationsList],
    onError: (e: ApiError) => toast.error('A simulação falhou', e.problem.message),
  });

  if (regra.simulated_at === null) {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <StatusChip tone="warn" size="sm" hint="Ligar sem simular é aceitar um alcance desconhecido">
          nunca simulada
        </StatusChip>
        <Can permission="automation.update">
          <Button
            size="sm"
            variant="secondary"
            icon={<FlaskConical className="size-3.5" />}
            loading={simular.isPending}
            onClick={() =>
              simular.mutate(
                { params: { id: regra.id }, body: { days: 30 } },
                { onSuccess: () => toast.success('Simulada sobre os últimos 30 dias') }
              )
            }
          >
            Simular
          </Button>
        </Can>
      </span>
    );
  }

  return (
    <span className="shrink-0 text-right">
      <span className="block text-xs text-subtle">simulada</span>
      <span className="block text-sm text-text tabular-nums" data-numeric>
        {regra.simulated_matches ?? 0} {(regra.simulated_matches ?? 0) === 1 ? 'caso' : 'casos'} em 30 dias
      </span>
    </span>
  );
}

/**
 * Ligar e pausar.
 *
 * O botão de ligar de uma regra NUNCA SIMULADA diz o que está sendo feito.
 * Não bloqueia — há regras cujo alcance é obviamente pequeno, e travar o fluxo
 * ensinaria a simular por obrigação, sem olhar o resultado. Mas o rótulo não
 * finge que é uma decisão trivial.
 */
function BotaoLigar({ regra }: { regra: AutomationRule }) {
  const toast = useToast();
  const ligada = regra.state === 'active';

  const ligar = useApiMutation(automationActivate, {
    invalidates: [automationsList],
    onError: (e: ApiError) => toast.error('Não foi possível ligar', e.problem.message),
  });
  const pausar = useApiMutation(automationPause, {
    invalidates: [automationsList],
    onError: (e: ApiError) => toast.error('Não foi possível pausar', e.problem.message),
  });

  if (ligada) {
    return (
      <Button
        size="sm"
        icon={<Pause className="size-3.5" />}
        loading={pausar.isPending}
        onClick={() =>
          pausar.mutate(
            { params: { id: regra.id } },
            { onSuccess: () => toast.success(`${regra.name} pausada`) }
          )
        }
      >
        Pausar
      </Button>
    );
  }

  const semSimulacao = regra.simulated_at === null;

  return (
    <Button
      size="sm"
      variant="primary"
      icon={<Play className="size-3.5" />}
      loading={ligar.isPending}
      onClick={() =>
        ligar.mutate({ params: { id: regra.id } }, { onSuccess: () => toast.success(`${regra.name} ligada`) })
      }
    >
      {semSimulacao ? 'Ligar sem simular' : 'Ligar'}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */

function DialogoExecucoes({ regra, onFechar }: { regra: AutomationRule; onFechar: () => void }) {
  const { data, isLoading } = useApiQuery(automationRuns, {
    params: { id: regra.id },
    query: { limit: 50 },
  }) as { data: { items: RuleRun[] } | undefined; isLoading: boolean };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={regra.name}
      description="As últimas execuções desta regra."
      footer={<Button onClick={onFechar}>Fechar</Button>}
    >
      {isLoading ? (
        <SkeletonList rows={5} label="execuções" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<Workflow className="size-5" />}
          title="Ainda não rodou"
          description="Uma regra ligada que nunca rodou pode significar que a condição nunca bateu — ou que o gatilho não acontece."
          className="py-6"
        />
      ) : (
        <ul className="flex max-h-96 flex-col overflow-y-auto">
          {data.items.map((x, i) => (
            <li
              key={x.id}
              className={cn(
                'flex items-baseline gap-3 px-1 py-2 text-sm',
                i > 0 && 'border-t border-border-subtle'
              )}
            >
              {/*
                `skipped` é resultado LEGÍTIMO: a regra rodou e a condição não
                bateu. Confundi-lo com `failed` faria a tela acusar erro num
                comportamento correto — e a equipe pararia de olhar a lista.
              */}
              <StatusChip tone={TOM_RESULTADO[x.outcome] ?? 'neutral'} size="sm">
                {ROTULO_RESULTADO[x.outcome] ?? x.outcome}
              </StatusChip>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text" data-numeric>
                  {x.event_type ?? 'no relógio'}
                </span>
                {x.error && <span className="block truncate text-xs text-bad-text">{x.error}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted" data-numeric>
                {x.duration_ms !== null ? `${x.duration_ms} ms · ` : ''}
                {formatarDataRelativa(x.ran_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_ESTADO: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ligada',
  paused: 'Pausada',
  quarantined: 'Em quarentena',
};

const TOM_ESTADO: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  draft: 'neutral',
  active: 'good',
  paused: 'neutral',
  quarantined: 'bad',
};

const ROTULO_RESULTADO: Record<string, string> = {
  applied: 'aplicou',
  skipped: 'não era o caso',
  failed: 'falhou',
};

const TOM_RESULTADO: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  applied: 'good',
  skipped: 'neutral',
  failed: 'bad',
};
