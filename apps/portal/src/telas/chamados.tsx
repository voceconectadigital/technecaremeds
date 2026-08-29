/**
 * Aurora — os chamados do cliente (SPEC v0.2 §19).
 *
 * A SITUAÇÃO É DITA NA LINGUAGEM DE QUEM PEDIU.
 *
 * "Recebido", "Em atendimento", "Aguardando sua aprovação" — e não "triage",
 * "in_progress", "waiting/quote_approval". A tradução vem do servidor: para a
 * ordem de serviço é DADO configurável por organização; para o chamado é
 * código, porque o ciclo do chamado é o contrato com o cliente.
 *
 * "AGUARDANDO VOCÊ" É DESTAQUE, E NÃO MAIS UM CHIP CINZA.
 *
 * A pergunta que traz alguém a esta tela é "e aí, como está?". Quando a
 * resposta é "esperando você", dizê-la em cinza é desperdiçar a única chance de
 * a pessoa resolver sozinha o que a está travando.
 */
import { Link, useParams } from '@tanstack/react-router';
import { CircleAlert, Inbox, MessageSquare } from 'lucide-react';
import { Card, CardHeader, EmptyState, Skeleton, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { useApiQuery } from '@aurora/app-kit';
import {
  portalComments,
  portalRequestDetail,
  portalRequests,
  type PortalComment,
  type PortalRequest,
  type PortalWorkOrder,
} from '@aurora/contracts';
import { Casca } from '../casca';
import { quando } from '../formato';

export function ChamadosPage() {
  const { data, isLoading } = useApiQuery(portalRequests) as {
    data: { items: PortalRequest[] } | undefined;
    isLoading: boolean;
  };

  const itens = data?.items ?? [];

  return (
    <Casca titulo="Meus chamados" subtitulo="O que você pediu, e em que pé está.">
      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={5} label="chamados" />
          </div>
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="Nenhum chamado ainda"
            description="Quando algum equipamento precisar de atenção, abra um chamado — leva menos de um minuto."
          />
        ) : (
          <ul>
            {itens.map((r, i) => (
              <li key={r.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                <Link
                  to="/chamados/$id"
                  params={{ id: r.id }}
                  // `min-h-14`: alvo confortável para o polegar, bem acima do
                  // mínimo de 24 da WCAG 2.2.
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text">{r.summary}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                      {r.number} · {quando(r.created_at)}
                      {r.asset_name ? ` · ${r.asset_name}` : ''}
                    </span>
                  </span>
                  <StatusChip tone={tom(r.status)} size="sm">
                    {r.status_label}
                  </StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

export function ChamadoPage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const { data, isLoading, isError } = useApiQuery(portalRequestDetail, { params: { id } }) as {
    data: { request: PortalRequest; work_orders: PortalWorkOrder[] } | undefined;
    isLoading: boolean;
    isError: boolean;
  };

  if (isError) {
    return (
      <Casca titulo="Chamado">
        <Card>
          {/*
            "Não existe" e "não é seu" chegam aqui como a MESMA recusa, e a
            tela não tenta distinguir: distinguir contaria a quem tentou que o
            chamado do outro existe.
          */}
          <EmptyState
            icon={<CircleAlert className="size-5" />}
            title="Chamado não encontrado"
            description="Confira o endereço. Se você recebeu este link de outra pessoa, ele pode ser de outro cliente."
          />
        </Card>
      </Casca>
    );
  }

  if (isLoading || !data) {
    return (
      <Casca titulo="Chamado">
        <Skeleton className="h-64 w-full" />
      </Casca>
    );
  }

  const r = data.request;

  return (
    <Casca titulo={r.summary} subtitulo={`${r.number} · aberto ${quando(r.created_at)}`}>
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={tom(r.status)}>{r.status_label}</StatusChip>
              {r.asset_name && <span className="text-sm text-muted">{r.asset_name}</span>}
              {r.location_name && <span className="text-sm text-muted">· {r.location_name}</span>}
            </div>
            {r.description && <p className="text-sm whitespace-pre-wrap text-text">{r.description}</p>}
          </div>
        </Card>

        {data.work_orders.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox className="size-5" />}
              title="Ainda em triagem"
              description="Assim que o atendimento for programado, ele aparece aqui."
              className="py-6"
            />
          </Card>
        ) : (
          data.work_orders.map((w) => <Atendimento key={w.id} os={w} />)
        )}
      </div>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

function Atendimento({ os }: { os: PortalWorkOrder }) {
  return (
    <Card>
      <CardHeader
        title={os.title}
        description={os.number ?? undefined}
        actions={<StatusChip tone={os.waiting_on_customer ? 'warn' : 'info'}>{os.status_label}</StatusChip>}
      />
      <div className="flex flex-col gap-3 p-4">
        {/*
          "AGUARDANDO VOCÊ" É DESTAQUE.

          A pergunta que traz alguém aqui é "como está?", e quando a resposta é
          "esperando você", dizê-la em cinza desperdiça a única chance de a
          pessoa resolver sozinha o que a está travando.
        */}
        {os.wait_label && (
          <p
            className={cn(
              'flex items-start gap-2 rounded-control px-3 py-2 text-sm',
              os.waiting_on_customer ? 'bg-warn-soft text-warn-text' : 'bg-surface-sunken text-muted'
            )}
          >
            {os.waiting_on_customer && <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            {os.wait_label}
          </p>
        )}

        {os.scheduled_start && (
          <p className="text-sm text-muted">
            Programado para <strong className="text-text">{quando(os.scheduled_start)}</strong>
          </p>
        )}

        {os.resolution && (
          <div>
            <p className="text-xs text-subtle">O que foi feito</p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-text">{os.resolution}</p>
          </div>
        )}

        <Conversa workOrderId={os.id} />
      </div>
    </Card>
  );
}

/**
 * A conversa.
 *
 * O servidor devolve SÓ os comentários marcados como visíveis ao cliente — a
 * nota interna não é escondida aqui, ela não é lida lá. O tipo desta lista nem
 * tem o campo que diria a diferença.
 */
function Conversa({ workOrderId }: { workOrderId: string }) {
  const { data, isLoading } = useApiQuery(portalComments, { params: { id: workOrderId } }) as {
    data: { items: PortalComment[] } | undefined;
    isLoading: boolean;
  };

  if (isLoading) return <SkeletonList rows={2} label="mensagens" />;
  if (!data || data.items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <MessageSquare aria-hidden="true" className="size-3.5" />
        Mensagens da equipe
      </p>
      <ul className="flex flex-col gap-2">
        {data.items.map((c) => (
          <li key={c.id} className="rounded-control bg-info-soft px-3 py-2">
            <p className="text-xs text-muted">
              {c.author_name ?? 'Equipe'} · <span data-numeric>{quando(c.created_at)}</span>
            </p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-text">{c.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** O tom segue o SIGNIFICADO para o cliente, e não a categoria interna. */
function tom(status: string): 'neutral' | 'info' | 'warn' | 'good' | 'bad' {
  if (status === 'info_needed') return 'warn';
  if (status === 'rejected') return 'bad';
  if (status === 'fulfilled' || status === 'closed') return 'good';
  if (status === 'cancelled' || status === 'duplicate') return 'neutral';
  return 'info';
}
