/**
 * Aurora — Hoje: aguardando orçamento e aguardando peças (ORC-05).
 *
 * O CONTADOR LEVA À LISTA. Os dois cartões da tela Hoje abrem aqui (`?espera=pecas` ou
 * `?espera=orcamento`), e o número do cartão e a lista vêm da MESMA consulta (`today.waiting`),
 * com os mesmos recortes: cliente, setor e responsável. O escopo do vínculo vale em tudo — o
 * hospital só vê o próprio cliente.
 *
 * CADA LINHA VAI PARA O LUGAR CERTO: a OS (ficha) quando há OS; o orçamento quando ele ainda não
 * tem OS. Nada aqui edita a lista de OS: é uma lista própria, de leitura.
 */
import { Link } from '@tanstack/react-router';
import { FileCheck2, PackageSearch, X } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, Select, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { todayWaiting, type WaitingItem, type WaitingReason } from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { dataCurta } from '../features/painel/rotulos';

export type Espera = '' | 'pecas' | 'orcamento';

export const MOTIVO_DA_ESPERA: Record<Exclude<Espera, ''>, WaitingReason> = {
  pecas: 'parts',
  orcamento: 'quote',
};

const TITULO: Record<Exclude<Espera, ''>, string> = {
  pecas: 'Lista: aguardando peças',
  orcamento: 'Lista: aguardando orçamento',
};

type Resposta = {
  counts: { quote: number; parts: number };
  items: WaitingItem[];
  facets: Record<'customers' | 'sectors' | 'assignees', Array<{ id: string; label: string; total: number }>>;
};

/** Os contadores dos cartões — a mesma consulta da lista, com o cliente do Hoje. */
export function useContadoresDeEspera(cliente: string) {
  const { data } = useApiQuery(todayWaiting, { query: cliente ? { customer: cliente } : {} }) as {
    data: Resposta | undefined;
  };
  return data?.counts;
}

/** O link do cartão para a lista filtrada (mantém o resto da URL). */
export function LinkDaEspera({
  espera,
  children,
}: {
  espera: Exclude<Espera, ''>;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/"
      search={((anterior: Record<string, unknown>) => ({ ...anterior, espera })) as never}
      className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-accent-text hover:underline"
    >
      {children}
    </Link>
  );
}

/** A linha leva à OS; sem OS, ao orçamento. */
export function destinoDaLinha(i: WaitingItem): { to: string; params: { id: string } } {
  return i.kind === 'quote' || !i.work_order_id
    ? { to: '/orcamentos/$id', params: { id: i.quote_id! } }
    : { to: '/ordens/$id', params: { id: i.work_order_id } };
}

export function ListaDeEspera({ cliente }: { cliente: string }) {
  const [espera, setEspera] = useUrlState<Espera>('espera', '');
  const [setor, setSetor] = useUrlState<string>('espera_setor', '');
  const [responsavel, setResponsavel] = useUrlState<string>('espera_resp', '');
  const [clienteDaLista, setClienteDaLista] = useUrlState<string>('espera_cliente', '');
  const clienteEfetivo = cliente || clienteDaLista;

  const ativa = espera === 'pecas' || espera === 'orcamento';
  const query = {
    ...(ativa ? { reason: MOTIVO_DA_ESPERA[espera as 'pecas'] } : {}),
    ...(clienteEfetivo ? { customer: clienteEfetivo } : {}),
    ...(setor ? { sector: setor } : {}),
    ...(responsavel ? { assignee: responsavel } : {}),
  };
  const { data, isLoading, isError } = useApiQuery(todayWaiting, { query }, { enabled: ativa }) as {
    data: Resposta | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  if (!ativa) return null;

  const fechar = () => {
    setEspera('');
  };

  return (
    <section aria-label={TITULO[espera as 'pecas']} data-testid="lista-de-espera">
      <Card>
        <CardHeader
          title={TITULO[espera as 'pecas']}
          description={
            espera === 'pecas'
              ? 'Ordens paradas com o motivo "aguardando peça".'
              : 'Ordens paradas aguardando aprovação de orçamento, ordens com orçamento enviado sem resposta e orçamentos enviados ainda sem OS.'
          }
          actions={
            <Button size="sm" icon={<X className="size-4" />} onClick={fechar} aria-label="Fechar a lista">
              Fechar
            </Button>
          }
        />
        <div
          className="flex flex-col gap-2 px-4 pb-3 sm:flex-row"
          role="group"
          aria-label="Recortes da lista"
        >
          {!cliente && (data?.facets.customers.length ?? 0) > 0 && (
            <Select
              aria-label="Cliente da lista"
              value={clienteDaLista}
              onChange={(e) => setClienteDaLista(e.target.value)}
              className="sm:w-56"
            >
              <option value="">Todos os clientes</option>
              {data!.facets.customers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.total})
                </option>
              ))}
            </Select>
          )}
          <Select
            aria-label="Setor da lista"
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Todos os setores</option>
            {(data?.facets.sectors ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.total})
              </option>
            ))}
          </Select>
          <Select
            aria-label="Responsável da lista"
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Todos os responsáveis</option>
            {(data?.facets.assignees ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.total})
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={3} label="esperas" />
          </div>
        ) : isError ? (
          <p className="px-4 pb-4 text-sm text-bad-text">Não conseguimos carregar a lista agora.</p>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={
              espera === 'pecas' ? <PackageSearch className="size-5" /> : <FileCheck2 className="size-5" />
            }
            title="Nada esperando com esses recortes"
            filtered={Boolean(setor || responsavel || clienteDaLista)}
          />
        ) : (
          <ul>
            {data!.items.map((i, n) => {
              const destino = destinoDaLinha(i);
              return (
                <li
                  key={`${i.kind}-${i.work_order_id ?? i.quote_id}`}
                  className={cn(n > 0 && 'border-t border-border-subtle')}
                >
                  <Link
                    to={destino.to as never}
                    params={destino.params as never}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">
                        {i.work_order_number ? `OS ${i.work_order_number} · ` : ''}
                        {i.title}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[i.customer_name, i.sector_name, i.asset_name, i.assignee_name ?? 'sem responsável']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {i.quote_number && (
                      <StatusChip size="sm" tone="info" withoutDot>
                        Orçamento {i.quote_number}
                      </StatusChip>
                    )}
                    {i.wait_reason_label && (
                      <StatusChip size="sm" tone="warn">
                        {i.wait_reason_label}
                      </StatusChip>
                    )}
                    {i.since && (
                      <span className="hidden text-xs text-subtle sm:inline">desde {dataCurta(i.since)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
