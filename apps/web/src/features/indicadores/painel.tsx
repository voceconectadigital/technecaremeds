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
import { HelpCircle, TrendingUp } from 'lucide-react';
import {
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Skeleton,
  StatusChip,
} from '@aurora/ui';
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
import { useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';
import { useUrlState } from '../../lib/url-state';

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
      title="Indicadores"
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
      {invalido ? (
        <Card>
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="O fim do período vem antes do início"
            description="Troque as datas: nenhum indicador pode ser calculado sobre um intervalo invertido."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-labelledby="volume" className="flex flex-col gap-2">
            <h2 id="volume" className="text-sm font-semibold text-muted">
              Volume
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Indicador op={insightWorkOrdersOpened} periodo={periodo} onExplicar={setExplicando} />
              <Indicador
                op={insightWorkOrdersCompleted}
                periodo={periodo}
                onExplicar={setExplicando}
              />
              {/*
                O backlog é FOTOGRAFIA, e não período: é o que está aberto num
                instante. Misturá-lo com os de período faria alguém somar
                "abertas" com "backlog" e chegar a um número que não significa
                nada.
              */}
              <Indicador
                op={insightBacklog}
                periodo={{ to: periodo.to }}
                onExplicar={setExplicando}
              />
            </div>
          </section>

          <section aria-labelledby="tempo" className="flex flex-col gap-2">
            <h2 id="tempo" className="text-sm font-semibold text-muted">
              Tempo
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Indicador op={insightMttr} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightFirstResponse} periodo={periodo} onExplicar={setExplicando} />
              <Indicador op={insightSla} periodo={periodo} onExplicar={setExplicando} />
            </div>
          </section>

          <section aria-labelledby="qualidade" className="flex flex-col gap-2">
            <h2 id="qualidade" className="text-sm font-semibold text-muted">
              Prevenção
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Indicador
                op={insightPreventiveVsCorrective}
                periodo={periodo}
                onExplicar={setExplicando}
              />
              <Indicador op={insightPlanCompliance} periodo={periodo} onExplicar={setExplicando} />
              <Indicador
                op={insightTimeByWaitReason}
                periodo={periodo}
                onExplicar={setExplicando}
              />
            </div>
          </section>
        </div>
      )}

      {explicando && (
        <DialogoDefinicao definicao={explicando} onFechar={() => setExplicando(null)} />
      )}
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
        <p className="text-2xl font-semibold text-text tabular-nums" data-numeric>
          {valor}
        </p>
        {detalhe && <p className="text-xs text-muted">{detalhe}</p>}

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

  if (Array.isArray(d.items)) {
    return {
      valor: String(d.items.length),
      detalhe: d.items.length === 1 ? '1 categoria' : `${d.items.length} categorias`,
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

function DialogoDefinicao({
  definicao,
  onFechar,
}: {
  definicao: MetricDefinition;
  onFechar: () => void;
}) {
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
            {definicao.denominator ?? (
              <span className="text-subtle">nada — é uma contagem simples</span>
            )}
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
          <dt className="text-xs font-semibold text-warn-text">
            Antes de comparar com o sistema antigo
          </dt>
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
