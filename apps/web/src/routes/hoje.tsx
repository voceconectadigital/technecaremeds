/**
 * Aurora — "Hoje" (SPEC v0.2 §34, §40).
 *
 * A TELA INICIAL NÃO É UM PAINEL DE INDICADORES.
 *
 * Quem abre a Aurora às sete da manhã não quer saber o MTTR do trimestre;
 * quer saber o que precisa dela agora. Indicador é para quem analisa, uma vez
 * por semana — e tem tela própria.
 *
 * Por isso aqui só entra o que tem AÇÃO associada: o que espera triagem, o que
 * está atribuído a mim, o que está parado. Cada bloco leva à lista já filtrada,
 * e não a uma lista genérica onde a pessoa refaz o filtro na mão.
 */
import { Link } from '@tanstack/react-router';
import { ArrowRight, ClipboardList, Inbox, PauseCircle } from 'lucide-react';
import { Card, CardHeader, EmptyState, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { requestsQueue, workOrdersBoard, type BoardColumn, type ServiceRequestRow } from '@aurora/contracts';
import { useApiQuery } from '../lib/api';
import { usePermissions } from '../lib/permissions';
import { useSessionQuery } from '../lib/use-session-query';
import { AppShell } from '../shell/app-shell';

export function HojePage() {
  const { data: sessao } = useSessionQuery();
  const { can } = usePermissions();

  const primeiroNome = (sessao?.user.name ?? '').split(/\s+/)[0];

  return (
    <AppShell
      title={primeiroNome ? `Bom dia, ${primeiroNome}` : 'Hoje'}
      subtitle="O que precisa de você agora."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {can('service_request.read') && <BlocoTriagem />}
        {can('work_order.read') && <BlocoParadas />}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function BlocoTriagem() {
  const { data, isLoading } = useApiQuery(requestsQueue, { query: { limit: 5 } }) as {
    data: { items: ServiceRequestRow[] } | undefined;
    isLoading: boolean;
  };

  const itens = data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Aguardando triagem"
        description="Pedidos que ainda não viraram trabalho."
        actions={
          <Link
            to="/solicitacoes"
            className="-mx-1 flex min-h-6 items-center gap-1 rounded-control px-1 text-sm font-medium text-accent-text hover:underline"
          >
            Ver fila
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        }
      />
      <div className="p-3">
        {isLoading ? (
          <SkeletonList rows={4} label="solicitações" />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="Nada aguardando triagem"
            description="Toda solicitação enviada já foi decidida."
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {itens.map((r) => (
              <li key={r.id}>
                <Link
                  to="/solicitacoes/$id"
                  params={{ id: r.id }}
                  className="flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text">{r.summary}</span>
                    <span className="block text-xs text-muted" data-numeric>
                      {r.number} · {formatarDataRelativa(r.created_at)}
                    </span>
                  </span>
                  <PrioridadeChip prioridade={r.priority} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * O bloco de OS paradas.
 *
 * Mostra o MOTIVO, e não só a contagem: "sete paradas" não é diagnóstico;
 * "cinco esperando peça, duas esperando o cliente" diz o que fazer. É a
 * pergunta que o §09 destravou e que a referência não respondia.
 */
function BlocoParadas() {
  const { data, isLoading } = useApiQuery(workOrdersBoard) as {
    data: { columns: BoardColumn[] } | undefined;
    isLoading: boolean;
  };

  const esperando = (data?.columns ?? []).filter((c) => c.category === 'waiting' && c.total > 0);
  const motivos = esperando.flatMap((c) => c.by_wait_reason);

  return (
    <Card>
      <CardHeader
        title="Paradas, e por quê"
        description="Onde o trabalho está travado agora."
        actions={
          <Link
            to="/ordens"
            className="-mx-1 flex min-h-6 items-center gap-1 rounded-control px-1 text-sm font-medium text-accent-text hover:underline"
          >
            Ver quadro
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        }
      />
      <div className="p-3">
        {isLoading ? (
          <SkeletonList rows={4} label="ordens de serviço" />
        ) : motivos.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="Nada parado"
            description="Nenhuma ordem de serviço está aguardando terceiro, peça ou cliente."
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {motivos.map((m) => (
              <li key={m.key} className="flex items-center gap-3 rounded-control px-2.5 py-2">
                <PauseCircle aria-hidden="true" className="size-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-base text-text">{m.label}</span>
                {/*
                 * Cronômetro pausado e cronômetro correndo são coisas
                 * diferentes: parar por peça do fabricante não conta contra o
                 * SLA; parar por falta de técnico conta.
                 */}
                <StatusChip tone={m.pauses_sla ? 'neutral' : 'warn'} size="sm">
                  {m.pauses_sla ? 'SLA pausado' : 'SLA correndo'}
                </StatusChip>
                <span className="w-8 text-right text-base font-semibold tabular-nums" data-numeric>
                  {m.total}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/*
 * A ESCALA É A DA SOLICITAÇÃO, e não uma tradução.
 *
 * Este mapa dizia `critical`, `high` e `normal` — três valores que o banco não
 * grava. O tipo do PostgreSQL é `request_priority`: none, low, urgent,
 * very_urgent, emergency. O efeito na tela era mudo e feio: toda OS urgente
 * procurava `TOM_PRIORIDADE['urgent']`, não achava, e renderizava um chip sem
 * tom e sem rótulo — um retângulo vazio ao lado do título.
 *
 * Ninguém viu porque a massa de teste nunca passou de `none`.
 */
const TOM_PRIORIDADE = {
  emergency: 'bad',
  very_urgent: 'bad',
  urgent: 'warn',
  low: 'neutral',
  none: 'neutral',
} as const;

const ROTULO_PRIORIDADE = {
  emergency: 'Emergência',
  very_urgent: 'Muito urgente',
  urgent: 'Urgente',
  low: 'Baixa',
  none: 'Sem prioridade',
} as const;

export function PrioridadeChip({ prioridade }: { prioridade: keyof typeof TOM_PRIORIDADE }) {
  // Sem urgência declarada não vira chip: um chip cinza em toda linha é ruído
  // que esconde os que importam. "Baixa" também não — dizer "esta é menos
  // importante" em cada linha não muda a decisão de ninguém.
  if (prioridade === 'none' || prioridade === 'low') return null;
  return (
    <StatusChip tone={TOM_PRIORIDADE[prioridade]} size="sm">
      {ROTULO_PRIORIDADE[prioridade]}
    </StatusChip>
  );
}

/**
 * "há 3 dias", e não "27/08/2026 14:32".
 *
 * Numa fila de triagem, a idade é a informação; a data exata não é. Quem
 * precisar do instante encontra na ficha.
 */
export function formatarDataRelativa(iso: string): string {
  const quando = new Date(iso).getTime();
  const minutos = Math.round((Date.now() - quando) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export { cn };
