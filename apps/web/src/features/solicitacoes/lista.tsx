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
import { Clock, Inbox, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, SkeletonList, StatStrip, StatusChip, Tabs, Toolbar, cn } from '@aurora/ui';
import { requestsQueue, type ServiceRequestRow, type RequestStatus } from '@aurora/contracts';
import { Can, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { PrioridadeChip, formatarDataRelativa } from '../../routes/hoje';

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

  /*
   * Os quatro números da faixa saem da MESMA lista que a tela já carregou.
   * Contá-los aqui custa uma passada sobre um array que já está em memória;
   * pedir ao servidor custaria quatro consultas para responder o que ele já
   * respondeu.
   */
  const criticas = todas.filter((r) => r.priority === 'emergency' || r.priority === 'very_urgent').length;
  const aguardando = todas.filter((r) => r.status === 'info_needed').length;
  const abertas = todas.filter((r) => r.status === 'submitted' || r.status === 'triage');
  const maisAntiga = abertas.reduce<ServiceRequestRow | null>(
    (velha, r) => (!velha || r.created_at < velha.created_at ? r : velha),
    null
  );
  const envelhecida =
    maisAntiga !== null && Date.now() - new Date(maisAntiga.created_at).getTime() > 24 * 3_600_000;

  const abas = ABAS.map((a) => ({
    ...a,
    count: a.id === 'todas' ? todas.length : todas.filter((r) => r.status === a.id).length,
  }));

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Solicitações"
      subtitle="O que os clientes pediram. Na triagem, cada pedido é aceito (vira ordem de serviço), recusado ou devolvido pedindo informação."
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
      <div className="flex flex-col gap-5">
        {/*
         * A FAIXA RESPONDE A PERGUNTA DO GESTOR ANTES DA LISTA.
         *
         * "O que chegou, o que é crítico, o que está parado" é o que ele quer
         * saber ao bater o olho — e contar linhas de uma lista de cem itens
         * não é uma resposta. Os quatro números saem da mesma consulta que a
         * lista já faz, então não custam nada.
         */}
        <StatStrip
          items={[
            { label: 'Na fila', value: todas.length },
            {
              label: 'Críticas',
              value: criticas,
              tone: criticas > 0 ? 'bad' : 'good',
              hint: 'Emergência ou muito urgente',
            },
            {
              label: 'Aguardando informação',
              value: aguardando,
              tone: aguardando > 0 ? 'warn' : 'neutral',
              hint: 'Paradas esperando resposta de quem pediu',
            },
            {
              label: 'Mais antiga',
              value: maisAntiga ? formatarDataRelativa(maisAntiga.created_at).replace('há ', '') : '—',
              tone: envelhecida ? 'warn' : 'neutral',
              hint: 'Idade do pedido mais velho ainda sem decisão',
            },
          ]}
        />

        <Card className="overflow-hidden">
          <Toolbar
            embedded
            search={
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar por número ou resumo"
                  aria-label="Filtrar solicitações"
                  className="h-10 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-sm text-text shadow-card transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--aurora-accent-soft)]"
                />
              </div>
            }
            filters={
              <Tabs
                aria-label="Situação"
                items={abas}
                value={situacao}
                onChange={setSituacao}
                className="border-b-0"
              />
            }
          />

          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={6} label="solicitações" />
            </div>
          ) : filtradas.length === 0 ? (
            <>
              <EmptyState
                icon={<Inbox className="size-5" />}
                title={todas.length === 0 ? 'Nada aguardando triagem' : 'Nenhuma solicitação nesta situação'}
                description={
                  todas.length === 0
                    ? 'Toda solicitação enviada já foi decidida. As novas aparecem aqui assim que chegam.'
                    : undefined
                }
                filtered={todas.length > 0}
                origem="Solicitações chegam do Portal do cliente, do aplicativo de campo ou de quem abre aqui mesmo. Na triagem, cada uma é aceita (vira OS), recusada ou devolvida pedindo informação."
                action={
                  todas.length === 0 ? (
                    <Link
                      to="/solicitacoes/nova"
                      className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:border-accent"
                    >
                      Abrir solicitação
                    </Link>
                  ) : undefined
                }
              />
            </>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {filtradas.map((r) => (
                <li key={r.id}>
                  <LinhaDeSolicitacao solicitacao={r} />
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

/**
 * A linha rica de uma solicitação.
 *
 * A versão anterior era duas linhas de texto e dois chips à direita — todas
 * iguais, e a pessoa tinha de LER cada uma para saber qual pegar primeiro.
 *
 * O que mudou: a urgência virou uma BARRA na borda esquerda, que é lida antes
 * de qualquer texto; a idade ganha destaque quando passa de um dia, porque
 * pedido velho na fila de triagem é o defeito que a triagem existe para
 * impedir; e o cartão inteiro tem alvo maior, porque a ação mais comum aqui é
 * abrir.
 */
function LinhaDeSolicitacao({ solicitacao: r }: { solicitacao: ServiceRequestRow }) {
  const critica = r.priority === 'emergency' || r.priority === 'very_urgent';
  const urgente = r.priority === 'urgent';
  const idadeEmHoras = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
  const envelhecida = idadeEmHoras > 24 && (r.status === 'submitted' || r.status === 'triage');

  return (
    <Link
      to="/solicitacoes/$id"
      params={{ id: r.id }}
      className="relative flex items-center gap-4 py-3 pr-4 pl-5 transition-colors hover:bg-surface-hover"
    >
      {/* A urgência, antes do texto. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-2 left-0 w-[3px] rounded-r-pill',
          critica ? 'bg-bad' : urgente ? 'bg-warn' : 'bg-transparent'
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text">{r.summary}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span data-numeric className="font-medium">
            {r.number}
          </span>
          <span className={cn(envelhecida && 'font-medium text-warn-text')}>
            aberta {formatarDataRelativa(r.created_at)}
          </span>
          {envelhecida && (
            <span className="inline-flex items-center gap-1 text-warn-text">
              <Clock aria-hidden="true" className="size-3" />
              na fila há mais de um dia
            </span>
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <PrioridadeChip prioridade={r.priority} />
        <SituacaoChip status={r.status} />
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

const SITUACOES: Record<string, { rotulo: string; tom: 'neutral' | 'info' | 'warn' | 'good' | 'bad' }> = {
  draft: { rotulo: 'Rascunho', tom: 'neutral' },
  submitted: { rotulo: 'Enviada', tom: 'info' },
  triage: { rotulo: 'Em triagem', tom: 'info' },
  info_needed: { rotulo: 'Aguardando informação', tom: 'warn' },
  accepted: { rotulo: 'Aceita', tom: 'good' },
  rejected: { rotulo: 'Recusada', tom: 'bad' },
  merged: { rotulo: 'Unida a outra', tom: 'neutral' },
  duplicate: { rotulo: 'Duplicada', tom: 'neutral' },
  in_service: { rotulo: 'Em atendimento', tom: 'info' },
  fulfilled: { rotulo: 'Atendida', tom: 'good' },
  closed: { rotulo: 'Encerrada', tom: 'neutral' },
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
