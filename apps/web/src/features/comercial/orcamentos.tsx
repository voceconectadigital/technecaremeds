/**
 * Aurora — orçamentos (SPEC v0.2 §16 · EPIC-016).
 *
 * A SITUAÇÃO QUE A TELA MOSTRA É A EFETIVA, e não a gravada.
 *
 * Um orçamento vence pela DATA, e não pela varredura noturna. A linha no banco
 * pode dizer "enviado" enquanto o prazo já passou — e mostrar "enviado" faria
 * a tela oferecer "aprovar" num orçamento que o servidor vai recusar aprovar.
 *
 * Por isso a lista calcula o vencimento aqui, do mesmo jeito que o servidor
 * calcula: comparando `valid_until` com hoje. E a ficha usa `effective_status`,
 * que o servidor manda pronto.
 *
 * DINHEIRO É TEXTO ATÉ O ÚLTIMO MOMENTO.
 *
 * `total_cents` é `bigint` e chega como texto. `Number()` só entra na
 * formatação, e mesmo aí a conta é inteira — centavos divididos por cem, e não
 * reais somados em ponto flutuante.
 */
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { Card, EmptyState, Select, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { quotesList, QUOTE_STATUSES, type QuoteRow, type QuoteStatus } from '@aurora/contracts';
import { hojeLocal, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { AlternadorComercial } from './alternador';
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

export function OrcamentosPage() {
  const [situacao, setSituacao] = useUrlState<string>('situacao', '');
  const [busca, setBusca] = useState('');

  const { data, isLoading, isError, error } = useApiQuery(quotesList, {
    query: situacao ? { status: situacao as QuoteStatus } : {},
  }) as {
    data: { items: QuoteRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const itens = useMemo(() => data?.items ?? [], [data]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter((q) => q.number.toLowerCase().includes(termo));
  }, [itens, busca]);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Orçamentos"
      subtitle="O que foi proposto, o que o cliente decidiu, e o que está vencendo."
    >
      <div className="flex flex-col gap-4">
        <AlternadorComercial />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por número"
              aria-label="Filtrar orçamentos"
              className="h-10 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-sm text-text shadow-card transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--aurora-accent-soft)]"
            />
          </div>
          <Select
            value={situacao}
            aria-label="Situação"
            onChange={(e) => setSituacao(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Todas as situações</option>
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ROTULO[s]}
              </option>
            ))}
          </Select>
        </div>

        <Card>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={6} label="orçamentos" />
            </div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-5" />}
              title={itens.length === 0 ? 'Nenhum orçamento' : 'Nenhum orçamento com esse número'}
              filtered={itens.length > 0}
            />
          ) : (
            <ul>
              {filtrados.map((q, i) => {
                const efetiva = situacaoEfetiva(q);
                return (
                  <li key={q.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                    <Link
                      to="/orcamentos/$id"
                      params={{ id: q.id }}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-text" data-numeric>
                          {q.number}
                          {q.version > 1 && <span className="ml-1.5 text-xs text-muted">v{q.version}</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                          aberto {formatarDataRelativa(q.created_at)}
                          {q.valid_until && ` · vale até ${formatarData(q.valid_until)}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium text-text tabular-nums" data-numeric>
                        {reais(q.total_cents)}
                      </span>
                      <StatusChip tone={TOM[efetiva]} size="sm">
                        {ROTULO[efetiva]}
                      </StatusChip>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <p className="text-xs text-subtle" data-numeric>
          {filtrados.length === itens.length
            ? `${itens.length} ${itens.length === 1 ? 'orçamento' : 'orçamentos'}`
            : `${filtrados.length} de ${itens.length}`}
        </p>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A situação que VALE agora.
 *
 * A regra é a mesma do domínio: só um orçamento ainda em negociação vence.
 * Aprovado, recusado ou faturado não vira "vencido" porque a data passou — a
 * decisão já foi tomada, e a data deixou de importar.
 */
export function situacaoEfetiva(q: { status: QuoteStatus; valid_until: string | null }): QuoteStatus {
  const emNegociacao = q.status === 'draft' || q.status === 'sent' || q.status === 'viewed';
  if (!emNegociacao || !q.valid_until) return q.status;
  // Dia do calendário local, e não de UTC (PF-72): às 22 h já era "amanhã".
  const hoje = hojeLocal();
  return q.valid_until < hoje ? 'expired' : q.status;
}

/**
 * Centavos em texto viram reais.
 *
 * A divisão é feita sobre o INTEIRO, e a conversão para número acontece só no
 * fim: somar reais em ponto flutuante é o que produz o relatório que fecha com
 * três centavos de diferença que ninguém acha de onde vieram.
 */
export function reais(centavos: string): string {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return centavos;
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** `2026-11-12` → `12/11/2026`, sem passar por fuso. */
export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}
