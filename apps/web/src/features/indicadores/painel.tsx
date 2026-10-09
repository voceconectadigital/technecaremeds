/**
 * Aurora — indicadores (SPEC v0.2 §25 · EPIC-021).
 *
 * NENHUM NÚMERO APARECE SOZINHO NESTA TELA.
 *
 * Cada cartão traz a definição a um clique: o que entra no numerador, o que
 * entra no denominador, o que ficou de fora, e o aviso sobre comparar com o
 * sistema antigo. Isso não é enfeite — um percentual de SLA sem denominador
 * declarado é um número que duas pessoas leem de dois jeitos, e a reunião
 * inteira discute a métrica em vez do problema.
 *
 * E A COBERTURA APARECE JUNTO DO NÚMERO, não escondida.
 *
 * Um painel que mostra 92% de SLA calculado sobre 40% das ordens está mentindo
 * por omissão. Aqui, quando a cobertura é parcial, a frase vem embaixo do
 * número, no mesmo cartão, sem precisar de clique.
 *
 * O PERÍODO FICA NA URL. Um recorte que não sobrevive ao recarregamento é um
 * recorte que a pessoa refaz toda vez — e um painel que não pode ser
 * compartilhado por link é um painel que vira captura de tela no WhatsApp.
 *
 * O QUE ESTA TELA NÃO FAZ
 *
 * Não desenha gráfico de série temporal. A API entrega números de período, e
 * não séries; inventar uma série interpolando pontos seria desenhar uma
 * tendência que o dado não sustenta. Quando houver rota de série, o gráfico
 * entra — antes disso, o número honesto vale mais que a curva bonita.
 */
import { useState } from 'react';
import { HelpCircle, Minus, TrendingUp } from 'lucide-react';
import { Card, CardHeader, Dialog, DonutChart, EmptyState, Input, Skeleton, StatusChip } from '@aurora/ui';
import {
  insightBacklog,
  insightFirstResponse,
  insightMttr,
  insightPlanCompliance,
  insightPreventiveVsCorrective,
  insightSla,
  insightTimeByWaitReason,
  insightWorkOrdersCompleted,
  insightWorkOrdersOpened,
  type Coverage,
  type MetricDefinition,
} from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { AlternadorDoPainel } from '../painel/alternador';

interface Envelope {
  metric: string;
  definition: MetricDefinition;
  period: { from: string; to: string };
  coverage: Coverage | null;
  data: Record<string, unknown>;
}

export function IndicadoresPage() {
  const [de, setDe] = useUrlState<string>('de', trintaDiasAtras());
  const [ate, setAte] = useUrlState<string>('ate', hoje());
  const [explicando, setExplicando] = useState<MetricDefinition | null>(null);

  const periodo = { from: `${de}T00:00:00.000Z`, to: `${ate}T23:59:59.999Z` };
  const invalido = ate < de;

  return (
    <AppShell
      title="Indicadores detalhados"
      subtitle="Como estamos indo — com a definição de cada número ao lado dele."
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted">
            de
            <Input
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              aria-label="Início do período"
              className="w-36"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            até
            <Input
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              aria-label="Fim do período"
              className="w-36"
            />
          </label>
        </div>
      }
    >
      <div className="mb-4">
        <AlternadorDoPainel />
      </div>
      {invalido ? (
        <Card>
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="O fim do período vem antes do início"
            description="Troque as datas: nenhum indicador pode ser calculado sobre um intervalo invertido."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="volume" className="flex flex-col gap-3">
            <h2 id="volume" className="text-xl font-semibold tracking-display text-text">
              Volume
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Indicador op={insightWorkOrdersOpened} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightWorkOrdersCompleted} periodo={periodo} onExplicar={setExplicando} />
              {/*
                O backlog é FOTOGRAFIA, e não período: é o que está aberto num
                instante. Misturá-lo com os de período faria alguém somar
                "abertas" com "backlog" e chegar a um número que não significa
                nada.
              */}
              <Indicador op={insightBacklog} periodo={{ to: periodo.to }} onExplicar={setExplicando} />
            </div>
          </section>

          <section aria-labelledby="tempo" className="flex flex-col gap-3">
            <h2 id="tempo" className="text-xl font-semibold tracking-display text-text">
              Tempo
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Indicador op={insightMttr} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightFirstResponse} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightSla} periodo={periodo} onExplicar={setExplicando} />
            </div>
          </section>

          <section aria-labelledby="qualidade" className="flex flex-col gap-3">
            <h2 id="qualidade" className="text-xl font-semibold tracking-display text-text">
              Prevenção
            </h2>
            <div className="grid gap-3 lg:grid-cols-3">
              {/*
               * O MIX GANHA FORMA, porque ele é o único desta tela que é uma
               * COMPOSIÇÃO — "deste total, quanto foi planejado e quanto foi
               * apagar incêndio?" — e é a pergunta que um gestor de engenharia
               * clínica leva para a diretoria.
               *
               * As duas fatias usam as duas cores da marca: azul para
               * preventiva, verde para corretiva. Não há juízo de valor na
               * escolha (não é "verde = bom"): são as duas séries do gráfico,
               * na ordem da paleta de dados. O juízo está no número, que a
               * própria definição explica.
               */}
              <MixPreventiva periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightPlanCompliance} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightTimeByWaitReason} periodo={periodo} onExplicar={setExplicando} />
            </div>
          </section>
        </div>
      )}

      {explicando && <DialogoDefinicao definicao={explicando} onFechar={() => setExplicando(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Um cartão de indicador.
 *
 * O erro NÃO derruba o painel: um indicador que falhou mostra que falhou, e os
 * outros oito continuam. Um painel que some inteiro porque uma consulta deu
 * problema é um painel que ninguém confia o suficiente para abrir de manhã.
 */
function Indicador({
  op,
  periodo,
  onExplicar,
}: {
  // O tipo é o da operação; cada uma tem `data` de forma diferente, e por isso
  // a leitura é genérica e a apresentação decide o que mostrar.
  op: Parameters<typeof useApiQuery>[0];
  periodo: Record<string, string>;
  onExplicar: (d: MetricDefinition) => void;
}) {
  const { data, isLoading, isError } = useApiQuery(op, { query: periodo }) as {
    data: Envelope | undefined;
    isLoading: boolean;
    isError: boolean;
  };

  if (isLoading) return <Skeleton className="h-28 w-full" />;

  if (isError || !data) {
    return (
      <Card className="border-bad/30">
        <div className="p-4">
          <p className="text-sm text-bad-text">Este indicador não pôde ser calculado agora.</p>
          <p className="mt-1 text-xs text-muted">Os outros continuam válidos.</p>
        </div>
      </Card>
    );
  }

  const { valor, detalhe } = apresentar(data);
  const coberturaParcial =
    data.coverage !== null && data.coverage.percent !== null && data.coverage.percent < 100;

  return (
    <Card>
      <CardHeader
        // Nível 3: este cartão já está DENTRO de uma seção com `<h2>` própria
        // (Volume, Tempo, Prevenção). Deixá-lo em 2 criaria dois irmãos de
        // mesmo nível onde há hierarquia real.
        headingLevel={3}
        title={data.definition.label}
        actions={
          <button
            type="button"
            onClick={() => onExplicar(data.definition)}
            aria-label={`Como ${data.definition.label} é calculado`}
            className="rounded-control p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-text"
          >
            <HelpCircle aria-hidden="true" className="size-4" />
          </button>
        }
      />
      <div className="flex flex-col gap-1 px-4 pb-4">
        {/*
         * SEM AMOSTRA NÃO É UM TRAÇO GIGANTE.
         *
         * Um "—" em 39px ocupa o lugar de um número e não informa nada; o
         * cartão fica com cara de tela inacabada, que foi exatamente a
         * impressão relatada. A ausência de dado é uma RESPOSTA — "nenhum caso
         * fechou neste período" é informação útil para quem escolheu o
         * período — e merece o espaço dela, com forma própria.
         *
         * O que ela não pode é parecer um erro. Daí o tom neutro, o ícone
         * discreto e a frase que explica o porquê, que vem do próprio
         * apresentador.
         */}
        {valor === '—' ? (
          <div className="flex items-start gap-2 rounded-control bg-surface-subtle px-3 py-2.5">
            <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-subtle" />
            <p className="text-sm text-muted">{detalhe ?? 'sem amostra no período'}</p>
          </div>
        ) : (
          <>
            <p className="text-3xl font-semibold tracking-display text-text tabular-nums" data-numeric>
              {valor}
            </p>
            {detalhe && <p className="text-xs text-muted">{detalhe}</p>}
          </>
        )}

        {/*
          A COBERTURA FICA JUNTO DO NÚMERO, e não atrás de um clique.
          Um painel que mostra 92% de SLA calculado sobre 40% das ordens está
          mentindo por omissão — e ninguém detecta isso olhando o painel.
        */}
        {coberturaParcial && data.coverage?.note && (
          <p className="mt-1 flex items-start gap-1 text-xs text-warn-text">
            <span aria-hidden="true">▲</span>
            {data.coverage.note}
          </p>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Como transformar `data` em algo legível.
 *
 * Cada métrica tem a sua forma — contagem, média, distribuição. A função lê o
 * que EXISTE em vez de assumir uma forma, e cai num resumo honesto quando não
 * reconhece: mostrar "—" é melhor do que mostrar `[object Object]`, que é o
 * que se obtém assumindo.
 */
function apresentar(e: Envelope): { valor: string; detalhe: string | null } {
  const d = e.data;
  const unidade = e.definition.unit;

  if (typeof d.count === 'number' && d.average === undefined) {
    return { valor: String(d.count), detalhe: null };
  }

  if (typeof d.average === 'number' || d.average === null) {
    const media = d.average === null ? null : Number(d.average);
    const mediana = typeof d.median === 'number' ? d.median : null;
    return {
      valor: media === null ? '—' : formatar(media, unidade),
      // A MEDIANA VEM JUNTO porque as duas contam histórias diferentes: média
      // de 6 horas com mediana de 40 minutos significa que quase tudo é rápido
      // e três casos arrastaram o número — e a ação é olhar os três.
      detalhe:
        media === null
          ? `sem dado suficiente no período`
          : mediana !== null
            ? `mediana ${formatar(mediana, unidade)} · ${d.count} ${Number(d.count) === 1 ? 'caso' : 'casos'}`
            : `${d.count} ${Number(d.count) === 1 ? 'caso' : 'casos'}`,
    };
  }

  if (typeof d.percent === 'number') {
    return { valor: `${Math.round(d.percent)}%`, detalhe: null };
  }

  /* ---------------------------------------------------------------------- */
  /* As formas que a API DE FATO devolve, e que faltavam aqui.              */
  /*                                                                        */
  /* O painel mostrava "formato ainda não apresentado nesta tela" em cinco  */
  /* indicadores — MTTR, tempo de primeira resposta, SLA, preventiva ×      */
  /* corretiva e conformidade de plano. Não era uma pendência de produto:   */
  /* era este `if` que nunca casava. Os números existiam e chegavam ao      */
  /* navegador; a tela é que não sabia lê-los, e anunciava a própria        */
  /* limitação como se fosse um recurso a construir.                        */
  /* ---------------------------------------------------------------------- */

  /* `{ value, samples }` — MTTR e tempo de primeira resposta. */
  if ('value' in d && 'samples' in d) {
    const valor = d.value === null ? null : Number(d.value);
    const amostras = Number(d.samples ?? 0);
    return {
      valor: valor === null ? '—' : formatar(valor, unidade),
      // NULO NÃO É ZERO: um período sem amostra não teve excelência, e dizer
      // "0 min" afirmaria uma que não aconteceu.
      detalhe:
        valor === null ? 'sem caso concluído no período' : `${amostras} ${amostras === 1 ? 'caso' : 'casos'}`,
    };
  }

  /* `{ met, breached, rate }` — cumprimento de SLA. */
  if ('rate' in d && ('met' in d || 'breached' in d)) {
    const taxa = d.rate === null ? null : Number(d.rate);
    const cumpridos = Number(d.met ?? 0);
    const violados = Number(d.breached ?? 0);
    return {
      valor: taxa === null ? '—' : `${Math.round(taxa * (taxa <= 1 ? 100 : 1))}%`,
      detalhe:
        taxa === null
          ? 'nenhum relógio de SLA fechou no período'
          : `${cumpridos} no prazo · ${violados} ${violados === 1 ? 'violado' : 'violados'}`,
    };
  }

  /* `{ expected, done, skipped, rate }` — conformidade de plano preventivo. */
  if ('rate' in d && 'expected' in d) {
    const taxa = d.rate === null ? null : Number(d.rate);
    const previstas = Number(d.expected ?? 0);
    const feitas = Number(d.done ?? 0);
    const dispensadas = Number(d.skipped ?? 0);
    return {
      valor: taxa === null ? '—' : `${Math.round(taxa * (taxa <= 1 ? 100 : 1))}%`,
      detalhe:
        previstas === 0
          ? 'nenhuma preventiva prevista no período'
          : // As dispensadas saem do DENOMINADOR (§12) e por isso aparecem
            // separadas: escondê-las faria o número parecer melhor sem dizer
            // por quê.
            `${feitas} de ${previstas}${dispensadas > 0 ? ` · ${dispensadas} dispensada${dispensadas === 1 ? '' : 's'}` : ''}`,
    };
  }

  /* `{ preventive, corrective, preventiveShare }` — o mix. */
  if ('preventiveShare' in d) {
    const parcela = d.preventiveShare === null ? null : Number(d.preventiveShare);
    const preventivas = Number(d.preventive ?? 0);
    const corretivas = Number(d.corrective ?? 0);
    const total = preventivas + corretivas;
    return {
      valor: total === 0 || parcela === null ? '—' : `${Math.round(parcela * (parcela <= 1 ? 100 : 1))}%`,
      detalhe:
        total === 0
          ? 'nenhuma ordem concluída no período'
          : `${preventivas} preventiva${preventivas === 1 ? '' : 's'} · ${corretivas} corretiva${corretivas === 1 ? '' : 's'}`,
    };
  }

  if (Array.isArray(d.items)) {
    return {
      valor: String(d.items.length),
      detalhe: d.items.length === 1 ? '1 categoria' : `${d.items.length} categorias`,
    };
  }

  /*
   * Distribuição vazia — `time-by-wait-reason` devolve `[]` quando nada
   * esperou. É resposta, e não ausência de resposta: "nada parou no período"
   * é exatamente o que o gestor quer ver.
   */
  if (Array.isArray(d)) {
    return {
      valor: d.length === 0 ? '0' : String(d.length),
      detalhe: d.length === 0 ? 'nada ficou parado no período' : null,
    };
  }

  // Forma não reconhecida: melhor um traço honesto do que um número inventado.
  return { valor: '—', detalhe: 'formato ainda não apresentado nesta tela' };
}

function formatar(valor: number, unidade: string): string {
  if (unidade === 'percent') return `${Math.round(valor)}%`;
  if (unidade === 'days') return `${valor.toFixed(1)} d`;
  if (unidade === 'hours') return `${valor.toFixed(1)} h`;
  if (unidade === 'minutes') {
    if (valor < 60) return `${Math.round(valor)} min`;
    const h = Math.floor(valor / 60);
    const m = Math.round(valor % 60);
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  }
  return String(Math.round(valor));
}

/* -------------------------------------------------------------------------- */

function DialogoDefinicao({ definicao, onFechar }: { definicao: MetricDefinition; onFechar: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={definicao.label}
      description={definicao.purpose}
    >
      <dl className="flex flex-col gap-4 text-sm">
        <div>
          <dt className="text-xs font-semibold text-subtle">O que é contado</dt>
          <dd className="mt-0.5 text-text">{definicao.numerator}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-subtle">Dividido por</dt>
          <dd className="mt-0.5 text-text">
            {definicao.denominator ?? <span className="text-subtle">nada — é uma contagem simples</span>}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-subtle">O que fica de fora</dt>
          <dd className="mt-0.5">
            {definicao.exclusions.length === 0 ? (
              <span className="text-subtle">nada</span>
            ) : (
              <ul className="flex list-disc flex-col gap-1 pl-4 text-text">
                {definicao.exclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>

        {/*
          O AVISO DE COMPARABILIDADE É O CAMPO MAIS IMPORTANTE DESTE DIÁLOGO.
          A auditoria não conseguiu confirmar a fórmula da referência para
          várias métricas. Sem este aviso, alguém compara os dois números,
          encontra diferença, e conclui que o sistema novo está errado.
        */}
        <div className="rounded-control bg-warn-soft px-3 py-2">
          <dt className="text-xs font-semibold text-warn-text">Antes de comparar com o sistema antigo</dt>
          <dd className="mt-0.5 text-warn-text">{definicao.comparability}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-subtle">Chave</dt>
          <dd className="mt-0.5">
            <StatusChip tone="neutral" size="sm" withoutDot>
              <span data-numeric>{definicao.key}</span>
            </StatusChip>
          </dd>
        </div>
      </dl>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function trintaDiasAtras(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */

/**
 * Preventiva × corretiva, com a forma que o número sozinho não dá.
 *
 * Reusa o MESMO carregamento e o MESMO cartão dos outros indicadores — o que
 * muda é que, havendo amostra, a rosca aparece ao lado do percentual. Sem
 * amostra, cai no estado vazio como qualquer outro: um gráfico de zero fatias
 * seria um círculo cinza afirmando que existe uma distribuição.
 */
function MixPreventiva({
  periodo,
  onExplicar,
}: {
  periodo: Record<string, string>;
  onExplicar: (d: MetricDefinition) => void;
}) {
  const { data, isLoading, isError } = useApiQuery(insightPreventiveVsCorrective, { query: periodo }) as {
    data: Envelope | undefined;
    isLoading: boolean;
    isError: boolean;
  };

  if (isLoading) return <Skeleton className="h-52 w-full" />;
  if (isError || !data) {
    return (
      <Card className="border-bad/30">
        <div className="p-4">
          <p className="text-sm text-bad-text">Este indicador não pôde ser calculado agora.</p>
          <p className="mt-1 text-xs text-muted">Os outros continuam válidos.</p>
        </div>
      </Card>
    );
  }

  const preventivas = Number((data.data as Record<string, unknown>).preventive ?? 0);
  const corretivas = Number((data.data as Record<string, unknown>).corrective ?? 0);
  const total = preventivas + corretivas;
  const { valor, detalhe } = apresentar(data);

  return (
    <Card>
      <CardHeader
        headingLevel={3}
        title={data.definition.label}
        actions={
          <button
            type="button"
            onClick={() => onExplicar(data.definition)}
            aria-label={`Como ${data.definition.label} é calculado`}
            className="rounded-control p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-text"
          >
            <HelpCircle aria-hidden="true" className="size-4" />
          </button>
        }
      />
      <div className="p-4">
        {total === 0 ? (
          <div className="flex items-start gap-2 rounded-control bg-surface-subtle px-3 py-2.5">
            <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-subtle" />
            <p className="text-sm text-muted">{detalhe ?? 'nenhuma ordem concluída no período'}</p>
          </div>
        ) : (
          <DonutChart
            size={104}
            label="Ordens concluídas por natureza"
            centerValue={valor}
            centerLabel="preventiva"
            data={[
              { label: 'Preventivas', value: preventivas, series: 1 },
              { label: 'Corretivas', value: corretivas, series: 2 },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
