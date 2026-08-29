/**
 * Aurora — ficha do orçamento (SPEC v0.2 §16 · EPIC-016).
 *
 * AS VERSÕES NÃO SE SOBRESCREVEM.
 *
 * Revisar um orçamento cria uma versão nova e marca a anterior como
 * substituída. O que o cliente aprovou continua existindo exatamente como era
 * quando ele aprovou — e é isso que permite responder, seis meses depois, "o
 * que exatamente foi acordado?" sem depender de anexo em e-mail.
 *
 * A tela mostra a linha do tempo das versões porque essa é a informação que a
 * referência auditada não conseguia dar: lá, revisar sobrescrevia, e a única
 * cópia do que fora aprovado estava na caixa de entrada de alguém.
 *
 * A SITUAÇÃO EFETIVA COMANDA OS BOTÕES.
 *
 * As transições vêm do servidor calculadas sobre `effective_status`, e não
 * sobre a linha gravada. Um orçamento vencido não oferece "aprovar", mesmo que
 * o banco ainda diga "enviado".
 */
import { useParams } from '@tanstack/react-router';
import { CheckCircle2, Clock, FileText, History } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  SkeletonList,
  StatusChip,
  cn,
  useToast,
} from '@aurora/ui';
import {
  quoteDetail,
  quoteTransition,
  quoteVersions,
  quotesList,
  type QuoteItem,
  type QuoteStatus,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarData, reais } from './orcamentos';
import { formatarDataRelativa } from '../../routes/hoje';

const ROTULO: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  viewed: 'Visto pelo cliente',
  approved: 'Aprovado',
  rejected: 'Recusado',
  expired: 'Vencido',
  in_execution: 'Em execução',
  invoiced: 'Faturado',
  closed: 'Fechado',
  cancelled: 'Cancelado',
  superseded: 'Substituído',
};

const TOM: Record<QuoteStatus, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  approved: 'good',
  rejected: 'bad',
  expired: 'warn',
  in_execution: 'info',
  invoiced: 'good',
  closed: 'neutral',
  cancelled: 'neutral',
  superseded: 'neutral',
};

interface Detalhe {
  quote: {
    id: string;
    number: string;
    version: number;
    status: QuoteStatus;
    customer_id: string;
    work_order_id: string | null;
    valid_until: string | null;
    approver_contact_id: string | null;
    total_cents: string;
  };
  effective_status: QuoteStatus;
  items: QuoteItem[];
  transitions: Array<{ to: QuoteStatus; label: string; permission: string }>;
}

export function OrcamentoPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const toast = useToast();

  const { data, isLoading, isError, error } = useApiQuery(quoteDetail, { params: { id } }) as {
    data: Detalhe | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const { data: versoes } = useApiQuery(quoteVersions, { params: { id } }) as {
    data:
      | {
          items: Array<{
            id: string;
            version: number;
            status: QuoteStatus;
            total_cents: string;
            created_at: string;
            decided_at: string | null;
          }>;
        }
      | undefined;
  };

  const mover = useApiMutation(quoteTransition, {
    invalidates: [quoteDetail, quotesList, quoteVersions],
    onError: (e: ApiError) => toast.error('A mudança foi recusada', e.problem.message),
  });

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Orçamento">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const efetiva = data.effective_status;
  const gravadaDiverge = data.quote.status !== efetiva;

  return (
    <AppShell
      title={data.quote.number}
      subtitle={`Versão ${data.quote.version} · ${reais(data.quote.total_cents)}`}
      breadcrumbs={[{ label: 'Orçamentos', href: '/orcamentos' }, { label: data.quote.number }]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {data.transitions.map((t) => (
            <Button
              key={t.to}
              variant={t.to === 'approved' ? 'primary' : 'secondary'}
              loading={mover.isPending}
              onClick={() =>
                mover.mutate(
                  { params: { id }, body: { to: t.to } },
                  { onSuccess: () => toast.success(`${data.quote.number} agora está em ${t.label}`) }
                )
              }
            >
              {t.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={TOM[efetiva]}>{ROTULO[efetiva]}</StatusChip>
              {data.quote.valid_until && (
                <span className="flex items-center gap-1 text-sm text-muted">
                  <Clock aria-hidden="true" className="size-3.5" />
                  vale até {formatarData(data.quote.valid_until)}
                </span>
              )}
            </div>

            {gravadaDiverge && (
              /*
               * A DIVERGÊNCIA É DITA, e não escondida.
               *
               * O orçamento venceu pela data, mas a varredura ainda não rodou e
               * a linha no banco diz outra coisa. Esconder isso faria alguém
               * comparar a tela com um relatório e concluir que um dos dois
               * está errado — quando os dois estão certos e falam de momentos
               * diferentes.
               */
              <p className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
                Este orçamento venceu pela data. O registro ainda diz{' '}
                <strong>{ROTULO[data.quote.status]}</strong> — a varredura que atualiza a situação gravada
                roda periodicamente, e o que vale é a data.
              </p>
            )}
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Itens"
                actions={
                  <span className="text-sm font-semibold text-text tabular-nums" data-numeric>
                    {reais(data.quote.total_cents)}
                  </span>
                }
              />
              <div className="p-2">
                {data.items.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="size-5" />}
                    title="Nenhum item"
                    description="Um orçamento sem item não pode ser enviado."
                    className="py-6"
                  />
                ) : (
                  <ul>
                    {data.items.map((it, i) => (
                      <li
                        key={it.id}
                        className={cn(
                          'flex items-baseline gap-3 px-2.5 py-2',
                          i > 0 && 'border-t border-border-subtle'
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text">{it.description}</span>
                          <span className="block truncate text-xs text-muted" data-numeric>
                            {formatarQuantidade(it.quantity)}
                            {it.unit ? ` ${it.unit}` : ''} × {reais(it.unit_price_cents)}
                            {/* De onde veio o preço muda a conversa: preço de
                                tabela é discutido com o comercial; preço
                                digitado, com quem digitou. */}
                            {it.price_source && ` · ${ROTULO_PRECO[it.price_source] ?? it.price_source}`}
                          </span>
                        </span>
                        {Number(it.discount_cents) > 0 && (
                          <span className="shrink-0 text-xs text-muted tabular-nums" data-numeric>
                            −{reais(it.discount_cents)}
                          </span>
                        )}
                        <span className="shrink-0 text-sm text-text tabular-nums" data-numeric>
                          {reais(it.net_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Versões"
              description="Revisar cria versão nova. O que foi aprovado continua como era."
            />
            <div className="p-2">
              {!versoes ? (
                <SkeletonList rows={3} label="versões" />
              ) : (
                <ol className="flex flex-col">
                  {versoes.items.map((v, i) => (
                    <li
                      key={v.id}
                      className={cn(
                        'flex items-baseline gap-2 px-2.5 py-2 text-sm',
                        i > 0 && 'border-t border-border-subtle',
                        v.id === id && 'bg-accent-soft'
                      )}
                    >
                      {v.decided_at ? (
                        <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0 text-good" />
                      ) : (
                        <History aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-text" data-numeric>
                          v{v.version}
                          {v.id === id && <span className="ml-1 text-xs text-accent">atual</span>}
                        </span>
                        <span className="block text-xs text-muted" data-numeric>
                          {ROTULO[v.status]} · {formatarDataRelativa(v.created_at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted tabular-nums" data-numeric>
                        {reais(v.total_cents)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

const ROTULO_PRECO: Record<string, string> = {
  contract_price_list: 'tabela do contrato',
  default_price_list: 'tabela padrão',
  manual: 'preço digitado',
};

/** A quantidade vem como texto de `numeric`; só as casas inúteis saem. */
function formatarQuantidade(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return Number.isInteger(n) ? String(n) : valor.replace(/0+$/, '').replace(/\.$/, '');
}
