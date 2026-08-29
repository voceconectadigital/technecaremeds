/**
 * Aurora — parque de ativos (SPEC v0.2 §06, §07 · EPIC-005).
 *
 * A ÁRVORE É O FILTRO, E O FILTRO ESTÁ NA URL.
 *
 * Um parque real não se navega por lista: são milhares de equipamentos, e a
 * pergunta nunca é "me mostre todos" — é "o que existe na UTI do Norte". A
 * árvore de locais à esquerda é o instrumento dessa pergunta, e a escolha vai
 * para a URL, porque um recorte que não sobrevive ao recarregamento é um
 * recorte que a pessoa refaz cinco vezes por dia.
 *
 * O RECORTE É DO SERVIDOR, E NÃO DAQUI.
 *
 * A lista já chega limitada aos locais que este vínculo alcança — a consulta
 * cruza `accessible_location_ids`. Filtrar no navegador seria filtrar depois
 * de ter recebido: as linhas que a pessoa não pode ver já teriam viajado.
 *
 * SOBRE O LIMITE DE 500
 *
 * A rota devolve no máximo 500 itens. A tela DIZ quando bateu no teto, em vez
 * de mostrar 500 e deixar a pessoa concluir que o parque tem 500 — que é como
 * se descobre, seis meses depois, que metade dos equipamentos "sumiu".
 */
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Boxes, ChevronRight, MapPin, Search } from 'lucide-react';
import {
  Card,
  EmptyState,
  Select,
  SkeletonList,
  StatusChip,
  cn,
} from '@aurora/ui';
import {
  assetsList,
  locationsList,
  ASSET_STATUSES,
  type AssetRow,
  type AssetStatus,
  type LocationRow,
} from '@aurora/contracts';
import { useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { useUrlState } from '../../lib/url-state';
import { AlternadorDeParque } from './alternador';

const LIMITE = 500;

const ROTULO_SITUACAO: Record<AssetStatus, string> = {
  active: 'Em uso',
  under_maintenance: 'Em manutenção',
  standby: 'Reserva',
  loaned: 'Emprestado',
  decommissioned: 'Baixado',
  disposed: 'Descartado',
};

const TOM_SITUACAO: Record<AssetStatus, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  active: 'good',
  under_maintenance: 'warn',
  standby: 'neutral',
  loaned: 'info',
  decommissioned: 'neutral',
  disposed: 'neutral',
};

export function AtivosPage() {
  const [local, setLocal] = useUrlState<string>('local', '');
  const [situacao, setSituacao] = useUrlState<string>('situacao', '');
  const [busca, setBusca] = useState('');

  const { data: locais } = useApiQuery(locationsList, { query: {} }, { staleTime: 5 * 60_000 }) as {
    data: { items: LocationRow[] } | undefined;
  };

  const { data, isLoading, isError, error } = useApiQuery(assetsList, {
    query: {
      ...(local ? { location: local } : {}),
      ...(situacao ? { status: situacao as AssetStatus } : {}),
      limit: LIMITE,
    },
  }) as {
    data: { items: AssetRow[]; asset_label: string } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const rotulo = data?.asset_label ?? 'Ativo';
  const itens = useMemo(() => data?.items ?? [], [data]);

  // A BUSCA POR TEXTO É LOCAL, e só ela.
  //
  // Filtra o que já está na tela — no máximo 500 linhas — e por isso é
  // instantânea, sem ida ao servidor a cada tecla. O recorte que MUDA o
  // conjunto (local, situação) vai para o servidor, porque só ele sabe o que
  // existe além destas 500.
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter(
      (a) =>
        a.name.toLowerCase().includes(termo) ||
        a.tag?.toLowerCase().includes(termo) ||
        a.serial_number?.toLowerCase().includes(termo) ||
        a.asset_number?.toLowerCase().includes(termo)
    );
  }, [itens, busca]);

  if (isError) return <ErrorScreen error={error} />;

  const noTeto = itens.length >= LIMITE;

  return (
    <AppShell
      title={`${rotulo}s`}
      subtitle="O parque, pela árvore de locais. Escolha onde para ver o que há lá."
    >
      <div className="mb-4">
        <AlternadorDeParque />
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <ArvoreDeLocais locais={locais?.items ?? []} escolhido={local} onEscolher={setLocal} />

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={`Filtrar por nome, patrimônio ou série`}
                aria-label={`Filtrar ${rotulo.toLowerCase()}s nesta lista`}
                className="h-8 w-full rounded-control border border-border-strong bg-surface pr-3 pl-8 text-sm text-text placeholder:text-subtle"
              />
            </div>
            <Select
              value={situacao}
              aria-label="Situação"
              onChange={(e) => setSituacao(e.target.value)}
              className="sm:w-48"
            >
              <option value="">Todas as situações</option>
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </option>
              ))}
            </Select>
          </div>

          {noTeto && (
            /*
             * Dizer que há mais é o mínimo honesto.
             *
             * Mostrar 500 em silêncio ensina que o parque tem 500 — e é assim
             * que alguém descobre, meses depois, que metade dos equipamentos
             * nunca apareceu em nenhum relatório.
             */
            <p className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
              Esta lista mostra os primeiros {LIMITE}. Há mais {rotulo.toLowerCase()}s além destes —
              escolha um local na árvore ou filtre por situação para chegar ao que procura.
            </p>
          )}

          <Card>
            {isLoading ? (
              <div className="p-3">
                <SkeletonList rows={8} label={`${rotulo.toLowerCase()}s`} />
              </div>
            ) : filtrados.length === 0 ? (
              <EmptyState
                icon={<Boxes className="size-5" />}
                title={
                  itens.length === 0
                    ? `Nenhum ${rotulo.toLowerCase()} aqui`
                    : `Nenhum ${rotulo.toLowerCase()} com esse texto`
                }
                description={
                  itens.length === 0 && local
                    ? 'Este local não tem nada cadastrado. Um local acima na árvore pode ter.'
                    : undefined
                }
                filtered={itens.length > 0}
              />
            ) : (
              <ul>
                {filtrados.map((a, i) => (
                  <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                    <Link
                      to="/ativos/$id"
                      params={{ id: a.id }}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-text">{a.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                          {[a.tag, a.serial_number, a.category_name, a.location_name]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <StatusChip tone={TOM_SITUACAO[a.status]} size="sm">
                        {ROTULO_SITUACAO[a.status]}
                      </StatusChip>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-subtle" data-numeric>
            {filtrados.length === itens.length
              ? `${itens.length} ${itens.length === 1 ? rotulo.toLowerCase() : `${rotulo.toLowerCase()}s`}`
              : `${filtrados.length} de ${itens.length}`}
          </p>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A árvore, montada de uma lista PLANA.
 *
 * O servidor devolve os locais em lista, ordenados por `path`, com `depth`.
 * Isso basta: a ordem já é a da travessia em profundidade, e `depth` dá o
 * recuo. Montar uma estrutura aninhada aqui custaria uma passada extra e um
 * mapa por id — e a lista plana ainda é o que o teclado percorre.
 *
 * Só os ramos até o local escolhido ficam abertos. Abrir tudo num parque com
 * dois mil locais entrega uma parede de texto; abrir nada obriga a clicar
 * sete vezes para chegar onde a pessoa já estava ontem.
 */
function ArvoreDeLocais({
  locais,
  escolhido,
  onEscolher,
}: {
  locais: LocationRow[];
  escolhido: string;
  onEscolher: (id: string) => void;
}) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const temFilho = useMemo(() => {
    const s = new Set<string>();
    for (const l of locais) if (l.parent_id) s.add(l.parent_id);
    return s;
  }, [locais]);

  // Um nó aparece quando o pai está aberto. A raiz sempre aparece.
  const visiveis = useMemo(
    () => locais.filter((l) => l.parent_id === null || abertos.has(l.parent_id)),
    [locais, abertos]
  );

  function alternar(id: string) {
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <Card className="h-max">
      <nav aria-label="Locais" className="flex flex-col p-2">
        <button
          type="button"
          onClick={() => onEscolher('')}
          className={cn(
            'flex items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-sm transition-colors',
            escolhido === '' ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-surface-hover'
          )}
        >
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          Todos os locais
        </button>

        {locais.length === 0 && (
          <p className="px-2 py-3 text-xs text-subtle">Nenhum local cadastrado ainda.</p>
        )}

        {visiveis.map((l) => {
          const ramo = temFilho.has(l.id);
          const aberto = abertos.has(l.id);
          return (
            <div key={l.id} className="flex items-center" style={{ paddingLeft: `${l.depth * 12}px` }}>
              {ramo ? (
                <button
                  type="button"
                  onClick={() => alternar(l.id)}
                  aria-expanded={aberto}
                  aria-label={`${aberto ? 'Recolher' : 'Expandir'} ${l.name}`}
                  // `min-h`/`min-w` de 24px: o ícone de 14 com folga de 4 dava
                  // 22×22, abaixo do mínimo de alvo de toque da WCAG 2.2
                  // (2.5.8). No dedo, 2px separam apontar de adivinhar.
                  className="flex min-h-6 min-w-6 items-center justify-center rounded-control p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn('size-3.5 transition-transform', aberto && 'rotate-90')}
                  />
                </button>
              ) : (
                // Espaço reservado: sem ele, os nós-folha ficam desalinhados
                // dos ramos e a árvore deixa de parecer uma árvore.
                <span aria-hidden="true" className="inline-block size-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onEscolher(l.id)}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-left text-sm transition-colors',
                  escolhido === l.id
                    ? 'bg-accent-soft text-accent-text'
                    : 'text-text hover:bg-surface-hover'
                )}
                title={l.location_type_name ? `${l.name} (${l.location_type_name})` : l.name}
              >
                {l.name}
              </button>
            </div>
          );
        })}
      </nav>
    </Card>
  );
}
