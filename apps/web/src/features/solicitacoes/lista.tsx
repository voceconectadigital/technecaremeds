/**
 * Aurora — fila de triagem (SPEC v0.2 §08 · EPIC-007).
 *
 * A ordem NÃO é escolhida aqui. Vem do servidor, na regra da §08: prioridade
 * primeiro, idade como desempate. Reordenar no cliente criaria duas verdades
 * sobre "o que atender primeiro", e a do cliente é a que a pessoa vê.
 *
 * OS FILTROS FICAM NA URL. Um filtro escondido em modal é um filtro que a
 * pessoa esquece que aplicou e depois jura que o sistema perdeu os registros
 * — e um estado que não está na URL não pode ser compartilhado nem sobrevive
 * ao recarregamento.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { Inbox, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, SkeletonList, StatusChip, Tabs, cn } from '@aurora/ui';
import { requestsQueue, type ServiceRequestRow, type RequestStatus } from '@aurora/contracts';
import { useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';
import { useUrlState } from '../../lib/url-state';
import { Can } from '../../lib/permissions';

const ABAS = [
  { id: 'todas', label: 'Todas' },
  { id: 'submitted', label: 'Enviadas' },
  { id: 'triage', label: 'Em triagem' },
  { id: 'info_needed', label: 'Aguardando informação' },
] as const;

export function SolicitacoesPage() {
  const navigate = useNavigate();
  const [situacao, setSituacao] = useUrlState<string>('situacao', 'todas');
  const [busca, setBusca] = useState('');

  const { data, isLoading, isError, error } = useApiQuery(requestsQueue, {
    query: { limit: 200 },
  }) as {
    data: { items: ServiceRequestRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const todas = useMemo(() => data?.items ?? [], [data]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas.filter((r) => {
      if (situacao !== 'todas' && r.status !== (situacao as RequestStatus)) return false;
      if (!termo) return true;
      return r.summary.toLowerCase().includes(termo) || r.number.toLowerCase().includes(termo);
    });
  }, [todas, situacao, busca]);

  const abas = ABAS.map((a) => ({
    ...a,
    count: a.id === 'todas' ? todas.length : todas.filter((r) => r.status === a.id).length,
  }));

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Solicitações"
      subtitle="O que os clientes pediram e ainda aguarda decisão."
      actions={
        <Can permission="service_request.create">
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => void navigate({ to: '/solicitacoes/nova' })}
          >
            Abrir solicitação
          </Button>
        </Can>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs aria-label="Situação" items={abas} value={situacao} onChange={setSituacao} />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar por número ou resumo"
            aria-label="Filtrar solicitações"
            className="h-8 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-subtle sm:w-64"
          />
        </div>

        <Card>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={6} label="solicitações" />
            </div>
          ) : filtradas.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title={todas.length === 0 ? 'Nada aguardando triagem' : 'Nenhuma solicitação nesta situação'}
              description={
                todas.length === 0
                  ? 'Toda solicitação enviada já foi decidida. As novas aparecem aqui assim que chegam.'
                  : undefined
              }
              filtered={todas.length > 0}
            />
          ) : (
            <ul>
              {filtradas.map((r, i) => (
                <li key={r.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                  <Link
                    to="/solicitacoes/$id"
                    params={{ id: r.id }}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-text">{r.summary}</span>
                      <span className="mt-0.5 block text-xs text-muted" data-numeric>
                        {r.number} · aberta {formatarDataRelativa(r.created_at)}
                      </span>
                    </span>
                    <PrioridadeChip prioridade={r.priority} />
                    <SituacaoChip status={r.status} />
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

const SITUACOES: Record<string, { rotulo: string; tom: 'neutral' | 'info' | 'warn' | 'good' | 'bad' }> = {
  draft: { rotulo: 'Rascunho', tom: 'neutral' },
  submitted: { rotulo: 'Enviada', tom: 'info' },
  triage: { rotulo: 'Em triagem', tom: 'info' },
  info_needed: { rotulo: 'Aguardando informação', tom: 'warn' },
  accepted: { rotulo: 'Aceita', tom: 'good' },
  rejected: { rotulo: 'Recusada', tom: 'bad' },
  merged: { rotulo: 'Unida a outra', tom: 'neutral' },
  cancelled: { rotulo: 'Cancelada', tom: 'neutral' },
};

export function SituacaoChip({ status }: { status: string }) {
  const s = SITUACOES[status] ?? { rotulo: status, tom: 'neutral' as const };
  return (
    <StatusChip tone={s.tom} size="sm">
      {s.rotulo}
    </StatusChip>
  );
}
