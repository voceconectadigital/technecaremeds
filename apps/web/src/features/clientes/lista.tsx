/**
 * Aurora — clientes (SPEC v0.2 §05 · EPIC-003).
 *
 * A TELA RESPONDE "ONDE EU CADASTRO O HOSPITAL?".
 *
 * O cliente é a raiz de quase tudo: ativos ficam em locais de um cliente,
 * solicitações e ordens são para um cliente, contratos são com um cliente.
 * Antes desta tela, a única forma de criar um era pelo banco — e a pergunta
 * acima chegava ao suporte em toda implantação.
 *
 * A lista vem recortada pelo escopo do vínculo, no servidor. Quem só atende
 * dois hospitais vê dois, e não a rede inteira "filtrada depois".
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Boxes, Building2, ChevronRight, MapPin, Plus, Search } from 'lucide-react';
import { Button, Card, EmptyState, Metric, MetricGrid, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { customersList, type Customer } from '@aurora/contracts';
import { Can, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { DialogoNovoCliente, rotuloDoSegmento } from './novo-cliente';

export function ClientesPage() {
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState('');
  const { can } = usePermissions();

  const { data, isLoading, isError, error } = useApiQuery(customersList) as {
    data: { items: Customer[]; single_customer: boolean } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const itens = useMemo(() => data?.items ?? [], [data]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter((c) =>
      [c.name, c.trade_name, c.code, c.tax_id].some((v) => v?.toLowerCase().includes(termo))
    );
  }, [itens, busca]);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Clientes"
      subtitle="Os hospitais, clínicas e unidades que vocês atendem."
      actions={
        <Can permission="customer.create">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCriando(true)}>
            Novo cliente
          </Button>
        </Can>
      }
    >
      <div className="flex flex-col gap-4">
        {itens.length > 0 && (
          <MetricGrid columns={3}>
            <Metric
              label="Clientes atendidos"
              value={itens.length}
              icon={<Building2 className="size-4" />}
              tone="accent"
              hint="Hospitais, clínicas e unidades"
            />
            <Metric
              label="Locais mapeados"
              value={itens.reduce((s, c) => s + (c.location_count ?? 0), 0)}
              icon={<MapPin className="size-4" />}
              tone="info"
              hint="Unidades, prédios, setores e salas"
            />
            <Metric
              label="Equipamentos sob gestão"
              value={itens.reduce((s, c) => s + (c.asset_count ?? 0), 0)}
              icon={<Boxes className="size-4" />}
              tone="good"
              hint="Ativos ligados a estes clientes"
            />
          </MetricGrid>
        )}
        {itens.length > 0 && (
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por nome, CNPJ ou código"
              aria-label="Filtrar clientes"
              className="h-8 w-full rounded-control border border-border-strong bg-surface pr-3 pl-8 text-sm text-text placeholder:text-subtle"
            />
          </div>
        )}

        <Card>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={5} label="clientes" />
            </div>
          ) : itens.length === 0 ? (
            /*
             * O vazio ENSINA o modelo. Quem chega aqui pela primeira vez ainda
             * não sabe que o cliente vem antes do equipamento — e descobre isso
             * ao tentar cadastrar um ativo e não ter onde pendurá-lo.
             */
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="Nenhum cliente cadastrado"
              description="Clientes são os hospitais, clínicas e unidades que vocês atendem. Ativos, solicitações e contratos ficam sempre ligados a um cliente — por isso ele vem primeiro."
              action={
                can('customer.create') ? (
                  <Button
                    variant="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => setCriando(true)}
                  >
                    Novo cliente
                  </Button>
                ) : undefined
              }
            />
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="Nenhum cliente com esse termo"
              filtered
            />
          ) : (
            <ul>
              {filtrados.map((c, i) => (
                <LinhaCliente key={c.id} cliente={c} primeira={i === 0} />
              ))}
            </ul>
          )}
        </Card>

        {itens.length > 0 && (
          <p className="text-xs text-subtle" data-numeric>
            {filtrados.length === itens.length
              ? `${itens.length} ${itens.length === 1 ? 'cliente' : 'clientes'}`
              : `${filtrados.length} de ${itens.length}`}
          </p>
        )}
      </div>

      <DialogoNovoCliente open={criando} onOpenChange={setCriando} oferecerUnidade />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function LinhaCliente({ cliente: c, primeira }: { cliente: Customer; primeira: boolean }) {
  const segmento = rotuloDoSegmento(c.segment);
  const detalhes = [c.trade_name && c.trade_name !== c.name ? c.trade_name : null, segmento, c.tax_id, c.code]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={cn(!primeira && 'border-t border-border-subtle')}>
      <Link
        to="/clientes/$id"
        params={{ id: c.id }}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-card border border-border-subtle bg-surface-subtle text-subtle"
        >
          <Building2 className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-text">
            {c.name}
            {c.is_internal && (
              <StatusChip
                tone="accent"
                size="sm"
                withoutDot
                className="ml-2"
                hint="A própria organização, quando ela atende a si mesma"
              >
                Interno
              </StatusChip>
            )}
          </span>
          {detalhes && (
            <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
              {detalhes}
            </span>
          )}
        </span>

        <span className="hidden shrink-0 text-right text-xs text-muted sm:block" data-numeric>
          <span className="block">
            {c.location_count} {c.location_count === 1 ? 'local' : 'locais'}
          </span>
          <span className="block">
            {c.asset_count} {c.asset_count === 1 ? 'ativo' : 'ativos'}
          </span>
        </span>

        {c.status !== 'active' && (
          <StatusChip tone="neutral" size="sm">
            Inativo
          </StatusChip>
        )}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle" />
      </Link>
    </li>
  );
}
