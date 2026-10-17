/**
 * Téchne Care — o Painel de Controle, em miniatura e com dado de mentira.
 *
 * Montado com OS MESMOS componentes do painel de verdade (`Metric`,
 * `TrendChart`, `DonutChart`, `RateRing`), e não com uma captura: a figura
 * acompanha o produto quando o produto muda de cara, e não carrega dado de
 * cliente nenhum.
 *
 * Todo número aqui é FICTÍCIO e a figura diz isso na legenda e no selo. Os
 * indicadores escolhidos são só os que o catálogo marca como ativos
 * (`packages/domain/src/report-tiers.ts`): chamados abertos, OS concluídas,
 * backlog, SLA e preventiva × corretiva. Nenhum provisório, nenhuma fórmula.
 */
import { Card, DonutChart, Metric, RateRing, StatusChip, TrendChart } from '@aurora/ui';
import { CalendarRange, Building2, LayoutGrid } from 'lucide-react';

const MESES = ['mai', 'jun', 'jul', 'ago', 'set', 'out'];

function Filtro({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof CalendarRange;
  rotulo: string;
  valor: string;
}) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-sm text-muted">
      <Icone aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{rotulo}:</span>
      <span className="font-semibold text-text">{valor}</span>
    </span>
  );
}

export function PainelIlustrativo() {
  return (
    <figure className="m-0 min-w-0">
      <Card raised className="overflow-hidden p-0">
        {/* A barra da janela: filtros e o selo de ilustrativo. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-subtle px-4 py-3">
          <span aria-hidden="true" className="mr-2 hidden gap-1.5 sm:flex">
            <span className="size-2.5 rounded-full bg-border-strong" />
            <span className="size-2.5 rounded-full bg-border-strong" />
            <span className="size-2.5 rounded-full bg-border-strong" />
          </span>
          <Filtro icone={CalendarRange} rotulo="Período" valor="Últimos 6 meses" />
          <Filtro icone={Building2} rotulo="Cliente" valor="Hospital Exemplo" />
          <Filtro icone={LayoutGrid} rotulo="Setor" valor="UTI Adulto" />
          <StatusChip tone="warn" size="sm" className="ml-auto">
            Dados ilustrativos
          </StatusChip>
        </div>

        <div className="grid gap-3 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Chamados abertos" value={128} hint="No período" />
            <Metric label="OS concluídas" value={117} tone="good" hint="No período" />
            <Metric label="Backlog" value={23} tone="warn" hint="OS em aberto hoje" />
            <div className="flex items-center justify-center rounded-card border border-card-border bg-surface p-3 shadow-card">
              <RateRing value={94} label="SLA cumprido" size={96} tone="good" caption="SLA cumprido" />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <Card className="min-w-0 p-4 lg:col-span-7">
              <p className="mb-3 text-sm font-semibold text-text">Evolução dos chamados</p>
              <TrendChart
                label="Chamados abertos e concluídos por mês, dados ilustrativos"
                labels={MESES}
                height={190}
                series={[
                  {
                    key: 'abertos',
                    label: 'Abertos',
                    values: [18, 24, 21, 27, 19, 19],
                    series: 1,
                    area: true,
                  },
                  { key: 'concluidos', label: 'Concluídos', values: [15, 20, 22, 23, 18, 19], series: 2 },
                ]}
              />
            </Card>
            <Card className="flex min-w-0 flex-col p-4 lg:col-span-5">
              <p className="mb-3 text-sm font-semibold text-text">Preventiva × corretiva</p>
              <div className="flex flex-1 items-center justify-center">
                <DonutChart
                  label="Composição das OS do período, dados ilustrativos"
                  size={132}
                  className="flex-wrap justify-center"
                  centerValue="117"
                  centerLabel="OS"
                  data={[
                    { label: 'Preventivas', value: 71, series: 1 },
                    { label: 'Corretivas', value: 46, series: 2 },
                  ]}
                />
              </div>
            </Card>
          </div>
        </div>
      </Card>
      <figcaption className="mt-3 text-xs text-subtle">
        Composição feita com os componentes do painel. Números e nomes fictícios.
      </figcaption>
    </figure>
  );
}
