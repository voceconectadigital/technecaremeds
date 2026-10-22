/**
 * Aurora — o início do portal (SPEC v0.2 §19).
 *
 * A PRIMEIRA COISA DA TELA É O QUE PRECISA DE MIM.
 *
 * Não os meus chamados, não o meu parque: o que está parado esperando uma
 * decisão minha. Um orçamento aguardando aprovação no meio de dez chamados em
 * atendimento é um orçamento que fica lá duas semanas — e a OS parada junto.
 *
 * A separação vem do servidor, que sabe quais motivos de espera têm
 * `responsible = 'customer'`. A tela não adivinha.
 *
 * O VAZIO AQUI É BOA NOTÍCIA, e a tela diz isso. "Nada aguardando você" é uma
 * frase diferente de "nenhum resultado".
 */
import { Link } from '@tanstack/react-router';
import { CalendarClock, CheckCircle2, CircleAlert, Inbox } from 'lucide-react';
import { Card, CardHeader, EmptyState, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { useApiQuery } from '@aurora/app-kit';
import { portalHome, type PortalRequest, type PortalVisit } from '@aurora/contracts';
import { Casca } from '../casca';
import { quando, reais } from '../formato';
import { FalhaDeCarga } from './falha-de-carga';
import { AvaliarEAssinarOs } from './avaliar-os';

interface Inicio {
  pending_actions: Array<{
    kind: 'quote' | 'work_order';
    id: string;
    label: string;
    total_cents: string | null;
  }>;
  open_requests: PortalRequest[];
  next_visits: PortalVisit[];
}

export function InicioPage() {
  const { data, isLoading, isError, refetch } = useApiQuery(portalHome) as {
    data: Inicio | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => unknown;
  };

  if (isError) {
    return (
      <Casca titulo="Início" subtitulo="O que precisa de você, e o que está andando.">
        <Card>
          <FalhaDeCarga onTentar={() => void refetch()} />
        </Card>
      </Casca>
    );
  }

  return (
    <Casca titulo="Início" subtitulo="O que precisa de você, e o que está andando.">
      <div className="flex flex-col gap-4">
        {/* O que o cliente pediu que apareça ao entrar: as OS concluídas a avaliar e assinar. */}
        <AvaliarEAssinarOs />

        <Card>
          <CardHeader title="Precisa de você" />
          <div className="p-2">
            {isLoading ? (
              <SkeletonList rows={2} label="pendências" />
            ) : !data || data.pending_actions.length === 0 ? (
              /*
               * VAZIO É BOA NOTÍCIA, e a frase precisa dizer isso.
               *
               * "Nenhum resultado" numa lista de pendências deixa a pessoa
               * conferindo se a tela carregou. "Nada aguardando você" encerra
               * a pergunta.
               */
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title="Nada aguardando você"
                description="Quando um orçamento ou uma informação depender de você, aparece aqui."
                className="py-6"
              />
            ) : (
              <ul className="flex flex-col gap-2 p-1">
                {data.pending_actions.map((a) => (
                  <li key={`${a.kind}-${a.id}`}>
                    <Link
                      to={a.kind === 'quote' ? '/orcamentos' : '/chamados'}
                      className="flex items-center gap-3 rounded-control bg-warn-soft px-3 py-2.5 transition-colors hover:bg-warn-soft/80"
                    >
                      <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-warn" />
                      <span className="min-w-0 flex-1 text-sm text-warn-text">{a.label}</span>
                      {a.total_cents && (
                        <span
                          className="shrink-0 text-sm font-medium text-warn-text tabular-nums"
                          data-numeric
                        >
                          {reais(a.total_cents)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Seus chamados abertos"
            actions={
              <Link to="/chamados" className="text-sm text-accent-text hover:underline">
                ver todos
              </Link>
            }
          />
          <div className="p-2">
            {isLoading ? (
              <SkeletonList rows={3} label="chamados" />
            ) : !data || data.open_requests.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-5" />}
                title="Nenhum chamado aberto"
                description="Tudo o que você pediu já foi resolvido."
                className="py-6"
              />
            ) : (
              <ul className="flex flex-col">
                {data.open_requests.slice(0, 5).map((r, i) => (
                  <li key={r.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                    <Link
                      to="/chamados/$id"
                      params={{ id: r.id }}
                      className="flex items-center gap-3 px-2.5 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{r.summary}</span>
                        <span className="block truncate text-xs text-muted" data-numeric>
                          {r.number} · {quando(r.created_at)}
                          {r.asset_name ? ` · ${r.asset_name}` : ''}
                        </span>
                      </span>
                      <StatusChip tone="info" size="sm">
                        {r.status_label}
                      </StatusChip>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Próximas visitas" />
          <div className="p-2">
            {isLoading ? (
              <SkeletonList rows={2} label="visitas" />
            ) : !data || data.next_visits.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="Nenhuma visita programada"
                className="py-6"
              />
            ) : (
              <ul className="flex flex-col">
                {data.next_visits.slice(0, 5).map((v, i) => (
                  <li
                    key={v.id}
                    className={cn(
                      'flex items-baseline gap-3 px-2.5 py-2.5',
                      i > 0 && 'border-t border-border-subtle'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">{v.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {[v.asset_name, v.location_name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted" data-numeric>
                      {quando(v.scheduled_start)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Casca>
  );
}
