/**
 * Aurora — documentos técnicos (SPEC v0.2 §18 · EPIC-018).
 *
 * A TELA ABRE NO QUE VENCE, e não no acervo inteiro.
 *
 * Laudo, calibração e certificado têm validade, e a validade vencida costuma
 * ser descoberta na auditoria — que é o momento mais caro possível para
 * descobri-la. O recorte padrão são os próximos 60 dias, que é o tempo médio
 * para agendar uma calibração e receber o laudo de volta.
 *
 * DOCUMENTO SEM VALIDADE NÃO VENCE, e por isso não aparece no recorte. Mas
 * aparece no acervo — "sem validade" é diferente de "não existe", e colapsar
 * os dois faria sumir da tela metade do que a organização tem.
 *
 * O VEREDITO É NULO ENQUANTO É RASCUNHO, e a tela mostra isso como ausência.
 * Um valor padrão "conforme" num documento que ninguém avaliou é a mentira
 * mais cara que um sistema de documentação técnica pode contar.
 */
import { useMemo } from 'react';
import { FileCheck2, FileWarning, Search } from 'lucide-react';
import { Card, EmptyState, Select, SkeletonList, StatusChip, Tabs, cn, tabIds } from '@aurora/ui';
import { documentsList, type DocumentRow } from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarData } from '../comercial/orcamentos';
import { AlternadorDeParque } from '../ativos/alternador';

const ABAS = [
  { id: 'vencendo', label: 'Vencendo' },
  { id: 'todos', label: 'Acervo' },
] as const;

/** Sessenta dias: o tempo médio para agendar uma calibração e receber o laudo. */
const JANELA_DIAS = 60;

export function DocumentosPage() {
  const [aba, setAba] = useUrlState<string>('aba', 'vencendo');
  const [tipo, setTipo] = useUrlState<string>('tipo', '');
  // Na URL: a busca global abre esta tela já filtrada (`?q=`), e o filtro
  // sobrevive ao recarregar e ao link compartilhado.
  const [busca, setBusca] = useUrlState<string>('q', '');

  const { data, isLoading, isError, error } = useApiQuery(documentsList, {
    query: aba === 'vencendo' ? { expiring_within_days: JANELA_DIAS } : {},
  }) as {
    data: { items: DocumentRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const { data: vencendo } = useApiQuery(documentsList, {
    query: { expiring_within_days: JANELA_DIAS },
  }) as { data: { items: DocumentRow[] } | undefined };

  const itens = useMemo(() => data?.items ?? [], [data]);

  const tipos = useMemo(() => [...new Set(itens.map((d) => d.type_name))].sort(), [itens]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter((d) => {
      if (tipo && d.type_name !== tipo) return false;
      if (!termo) return true;
      return (
        (d.number ?? '').toLowerCase().includes(termo) ||
        (d.title ?? '').toLowerCase().includes(termo) ||
        (d.asset_name ?? '').toLowerCase().includes(termo)
      );
    });
  }, [itens, tipo, busca]);

  if (isError) return <ErrorScreen error={error} />;

  const abas = ABAS.map((a) => ({
    ...a,
    count: a.id === 'vencendo' ? (vencendo?.items.length ?? 0) : undefined,
  }));

  return (
    <AppShell
      title="Documentos"
      subtitle="Laudos, certificados e relatórios — e o que está prestes a vencer."
    >
      <div className="flex flex-col gap-4">
        <AlternadorDeParque />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs aria-label="Recorte" idPrefix="doc" items={abas} value={aba} onChange={setAba} />
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Número, título ou equipamento"
                aria-label="Filtrar documentos"
                className="h-8 w-full rounded-control border border-border-strong bg-surface pr-3 pl-8 text-sm text-text placeholder:text-subtle"
              />
            </div>
            {tipos.length > 1 && (
              <Select
                value={tipo}
                aria-label="Tipo de documento"
                onChange={(e) => setTipo(e.target.value)}
                className="w-48"
              >
                <option value="">Todos os tipos</option>
                {tipos.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        <div role="tabpanel" id={tabIds('doc', aba).painel} aria-labelledby={tabIds('doc', aba).aba}>
          <Card>
            {isLoading ? (
              <div className="p-3">
                <SkeletonList rows={6} label="documentos" />
              </div>
            ) : filtrados.length === 0 ? (
              <EmptyState
                icon={
                  aba === 'vencendo' ? <FileCheck2 className="size-5" /> : <FileWarning className="size-5" />
                }
                title={
                  itens.length === 0
                    ? aba === 'vencendo'
                      ? `Nada vence nos próximos ${JANELA_DIAS} dias`
                      : 'Nenhum documento emitido'
                    : 'Nenhum documento com esse texto'
                }
                description={
                  itens.length === 0 && aba === 'vencendo'
                    ? 'Documentos sem data de validade não entram neste recorte — eles estão no acervo.'
                    : undefined
                }
                filtered={itens.length > 0}
              />
            ) : (
              <ul>
                {filtrados.map((d, i) => (
                  <li
                    key={d.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5',
                      i > 0 && 'border-t border-border-subtle'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-text">{d.title || d.type_name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                        {[d.number, d.version > 1 ? `v${d.version}` : null, d.asset_name]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>

                    <Veredito verdict={d.verdict} />
                    <Validade validUntil={d.valid_until} />
                    <StatusChip tone={TOM_SITUACAO[d.status] ?? 'neutral'} size="sm">
                      {ROTULO_SITUACAO[d.status] ?? d.status}
                    </StatusChip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O veredito, com a ausência dita por extenso.
 *
 * Nulo significa "ainda não avaliado", e não "conforme". Um padrão positivo
 * num documento que ninguém avaliou é a mentira mais cara que um sistema de
 * documentação técnica pode contar — e ela só aparece na auditoria.
 */
function Veredito({ verdict }: { verdict: string | null }) {
  if (verdict === null) {
    return <span className="shrink-0 text-xs text-subtle">sem parecer</span>;
  }
  return (
    <StatusChip tone={TOM_VEREDITO[verdict] ?? 'neutral'} size="sm">
      {ROTULO_VEREDITO[verdict] ?? verdict}
    </StatusChip>
  );
}

/**
 * A validade, com o vencido em destaque.
 *
 * "Sem validade" é dito, e não deixado em branco: um espaço vazio na coluna de
 * validade se lê como "não olhei ainda".
 */
function Validade({ validUntil }: { validUntil: string | null }) {
  if (validUntil === null) {
    return <span className="hidden shrink-0 text-xs text-subtle sm:block">sem validade</span>;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = validUntil < hoje;

  return (
    <span
      className={cn(
        'hidden shrink-0 text-xs tabular-nums sm:block',
        vencido ? 'font-medium text-bad-text' : 'text-muted'
      )}
      data-numeric
    >
      {vencido ? 'venceu ' : 'até '}
      {formatarData(validUntil)}
    </span>
  );
}

const ROTULO_SITUACAO: Record<string, string> = {
  draft: 'Rascunho',
  under_review: 'Em revisão',
  issued: 'Emitido',
  released: 'Entregue ao cliente',
  cancelled: 'Cancelado',
  superseded: 'Substituído',
};

const TOM_SITUACAO: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  draft: 'neutral',
  under_review: 'warn',
  issued: 'info',
  released: 'good',
  cancelled: 'neutral',
  superseded: 'neutral',
};

const ROTULO_VEREDITO: Record<string, string> = {
  conforming: 'Conforme',
  non_conforming: 'Não conforme',
  conforming_with_restriction: 'Conforme com restrição',
};

const TOM_VEREDITO: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  conforming: 'good',
  non_conforming: 'bad',
  conforming_with_restriction: 'warn',
};
