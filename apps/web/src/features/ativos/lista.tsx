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
import { Boxes, ChevronRight, MapPin, Plus, Search } from 'lucide-react';
import { Button, Card, EmptyState, Select, SkeletonList, StatusChip, Thumb, cn } from '@aurora/ui';
import {
  assetsList,
  locationsList,
  ASSET_STATUSES,
  type AssetRow,
  type AssetStatus,
  type LocationRow,
} from '@aurora/contracts';
import { Can, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { AlternadorDeParque } from './alternador';
import { DialogoEquipamento } from './formulario';

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
  // Na URL: a busca global abre esta tela já filtrada (`?q=`), e o filtro
  // sobrevive ao recarregar e ao link compartilhado.
  const [busca, setBusca] = useUrlState<string>('q', '');
  // Na URL: o atalho "Novo equipamento" do Painel de Controle abre o diálogo direto (?novo=sim).
  const [novo, setNovo] = useUrlState<string>('novo', '');
  const criando = novo === 'sim';
  const setCriando = (abrir: boolean) => setNovo(abrir ? 'sim' : '');

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
      actions={
        <Can permission="asset.create">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCriando(true)}>
            Novo equipamento
          </Button>
        </Can>
      }
    >
      <div className="mb-4">
        <AlternadorDeParque />
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <ArvoreDeLocais locais={locais?.items ?? []} escolhido={local} onEscolher={setLocal} />

        <div className="flex min-w-0 flex-col gap-3">
          {noTeto && (
            /*
             * Dizer que há mais é o mínimo honesto.
             *
             * Mostrar 500 em silêncio ensina que o parque tem 500 — e é assim
             * que alguém descobre, meses depois, que metade dos equipamentos
             * nunca apareceu em nenhum relatório.
             */
            <p className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
              Esta lista mostra os primeiros {LIMITE}. Há mais {rotulo.toLowerCase()}s além destes — escolha
              um local na árvore ou filtre por situação para chegar ao que procura.
            </p>
          )}

          <Card className="overflow-hidden">
            {/* Barra de ferramentas DENTRO do painel: pesquisa e filtro são da
                tabela, e não soltos na página. */}
            <div className="flex flex-col gap-2 border-b border-border-subtle p-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Filtrar por nome, patrimônio ou série`}
                  aria-label={`Filtrar ${rotulo.toLowerCase()}s nesta lista`}
                  className="h-10 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-sm text-text shadow-card transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--aurora-accent-soft)]"
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
                origem="Todo equipamento pertence a um cliente e fica num setor ou sala. Cadastre o cliente em Clientes (com a unidade); os equipamentos entram pela importação de planilha."
              />
            ) : (
              /*
               * LINHA RICA, e não duas linhas de texto.
               *
               * A versão anterior concatenava tag, série, categoria e local
               * com pontos: "VNT-001 · SN-4471 · Ventilador pulmonar · Leito
               * 7". Isso é legível uma vez e ilegível numa lista de duzentos —
               * o olho não tem onde se apoiar, e é o que fazia o parque
               * parecer cadastro cru em vez de patrimônio.
               *
               * Agora cada informação tem coluna e peso próprios: o nome
               * comanda, fabricante e modelo ficam abaixo (é a pergunta
               * "quantos BeneHeart R3 temos?"), local e identificadores viram
               * colunas alinhadas, e garantia vencendo aparece como alerta.
               */
              <>
                {/* Cabeçalho de colunas discreto: as linhas são links (uma ficha
                  por equipamento), e não células — por isso ele é só visual e
                  some para o leitor de tela, que lê cada linha inteira. */}
                <div
                  aria-hidden="true"
                  className="hidden items-center gap-4 border-b border-border-subtle bg-surface-subtle px-4 py-2 text-2xs font-semibold tracking-label text-subtle uppercase md:flex"
                >
                  <span className="w-10 shrink-0" />
                  <span className="min-w-0 flex-1">Equipamento</span>
                  <span className="w-44 shrink-0">Local</span>
                  <span className="hidden w-36 shrink-0 lg:block">Identificação</span>
                  <span className="w-40 shrink-0 text-right">Situação</span>
                </div>
                <ul className="divide-y divide-border-subtle">
                  {filtrados.map((a) => (
                    <li key={a.id}>
                      <LinhaDeAtivo ativo={a} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <p className="text-xs text-subtle" data-numeric>
            {filtrados.length === itens.length
              ? `${itens.length} ${itens.length === 1 ? rotulo.toLowerCase() : `${rotulo.toLowerCase()}s`}`
              : `${filtrados.length} de ${itens.length}`}
          </p>
        </div>
      </div>
      <DialogoEquipamento
        open={criando}
        onOpenChange={setCriando}
        clienteInicial={locais?.items.find((l) => l.id === local)?.customer_id ?? undefined}
      />
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
                  escolhido === l.id ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-surface-hover'
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

/* -------------------------------------------------------------------------- */

/**
 * A linha de um ativo no parque.
 *
 * Quatro decisões de leitura:
 *
 *  · O NOME COMANDA e fabricante/modelo vêm abaixo dele. É a cadeia que
 *    responde "quantos BeneHeart R3 temos, e qual a taxa de falha desse
 *    modelo?" — a pergunta que justifica trocar de fornecedor, e que a
 *    referência auditada não respondia porque lá fabricante era texto livre.
 *  · OS IDENTIFICADORES ficam numa coluna monoespaçada e alinhada. Tag, série
 *    e patrimônio são lidos em comparação com uma etiqueta física, e para isso
 *    a coluna precisa ser estável, não concatenada no meio de uma frase.
 *  · A GARANTIA só aparece quando é notícia: vencida, ou vencendo em 90 dias.
 *    Uma data de garantia em toda linha é ruído que esconde as três que
 *    importam.
 *  · A SITUAÇÃO fica à direita, no mesmo lugar em toda linha, porque é o campo
 *    que se varre verticalmente.
 */
function LinhaDeAtivo({ ativo: a }: { ativo: AssetRow }) {
  const garantia = a.warranty_until ? new Date(a.warranty_until) : null;
  const diasDeGarantia = garantia ? Math.round((garantia.getTime() - Date.now()) / 86_400_000) : null;
  const garantiaEhNoticia = diasDeGarantia !== null && diasDeGarantia < 90;

  const identificadores = [a.tag, a.asset_number, a.serial_number].filter(Boolean);

  return (
    <Link
      to="/ativos/$id"
      params={{ id: a.id }}
      className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-surface-hover"
    >
      <Thumb name={a.name} size="sm" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text">{a.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {[a.manufacturer_name, a.model_name].filter(Boolean).join(' ') || a.category_name}
        </span>
      </span>

      {/*
        A CATEGORIA APARECE UMA VEZ SÓ.
        Ela estava embaixo do nome (quando não havia fabricante) E nesta
        coluna — dois rótulos idênticos na mesma linha, que é ruído que faz o
        olho desistir de procurar a diferença entre as linhas.
      */}
      <span className="hidden w-44 min-w-0 shrink-0 md:block">
        <span className="block truncate text-sm text-text">{a.location_name ?? 'sem local'}</span>
      </span>

      <span className="hidden w-36 shrink-0 lg:block" data-numeric>
        {identificadores.length > 0 ? (
          <>
            <span className="block truncate font-mono text-xs text-text">{identificadores[0]}</span>
            {identificadores[1] && (
              <span className="block truncate font-mono text-2xs text-subtle">{identificadores[1]}</span>
            )}
          </>
        ) : (
          <span className="text-2xs text-subtle">sem identificador</span>
        )}
      </span>

      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 md:w-40">
        {garantiaEhNoticia && (
          <StatusChip
            tone={diasDeGarantia! < 0 ? 'neutral' : 'warn'}
            size="sm"
            hint={`Garantia até ${garantia!.toLocaleDateString('pt-BR')}`}
          >
            {diasDeGarantia! < 0 ? 'Fora de garantia' : `Garantia: ${diasDeGarantia} d`}
          </StatusChip>
        )}
        <StatusChip tone={TOM_SITUACAO[a.status]} size="sm">
          {ROTULO_SITUACAO[a.status]}
        </StatusChip>
      </span>
    </Link>
  );
}
