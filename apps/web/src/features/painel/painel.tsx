/**
 * Aurora — Painel de Controle.
 *
 * A TELA RESPONDE "COMO ESTAMOS INDO?" EM TRINTA SEGUNDOS.
 *
 * Oito números no topo (MTTR, MTBF, backlog, SLA, disponibilidade agora,
 * chamados abertos, concluídos, preventivas vencidas) e seis gráficos — nem
 * um a mais: evolução dos chamados, OS por situação, preventivas, parque,
 * MTTR no tempo e backlog no tempo. Todos respondem ao MESMO filtro, e o
 * filtro é aplicado no SERVIDOR, dentro do escopo de quem pergunta.
 *
 * TODO NÚMERO É DO SERVIDOR, COM DEFINIÇÃO E COBERTURA. Ausência de dado é
 * traço ou "sem dados suficientes" — nunca zero. Disponibilidade aqui é a
 * fotografia do status CADASTRADO (disponíveis × indisponíveis agora), e a
 * tela diz isso: disponibilidade no tempo depende de uma definição do
 * cliente que ainda não existe (AI-HANDOFF §15-A).
 *
 * Cartões e gráficos levam à lista correspondente já filtrada, quando a
 * lista existe e aceita o filtro pela URL.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Activity,
  AlarmClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  HeartPulse,
  Inbox,
  Monitor,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import {
  BarChart,
  Card,
  CardHeader,
  ColumnChart,
  DonutChart,
  EmptyState,
  FilterChip,
  Input,
  SegmentGroup,
  Select,
  Skeleton,
  Sparkline,
  TrendChart,
  cn,
  type Tone,
} from '@aurora/ui';
import type { ControlPanel } from '@aurora/contracts';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { buscaDoPainel, disponibilidadeAgora, usePainel, useFiltrosDoPainel } from './dados';
import {
  PERIODOS,
  ROTULO_SITUACAO_OS,
  formatarDuracao,
  rotuloDaFatia,
  rotuloDoMes,
  type Periodo,
} from './rotulos';
import { AlternadorDoPainel } from './alternador';
import { AtalhosRapidos } from './atalhos';

const SEM_DADOS = 'Sem dados suficientes para este período.';

export function PainelPage() {
  const filtros = useFiltrosDoPainel();
  const { data, isLoading, isError, error, isFetching, problema } = usePainel(filtros);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Painel de Controle"
      subtitle="Visão consolidada da operação clínica: manutenção, prazos e parque."
      actions={
        <Link
          to="/painel/tv"
          search={buscaDoPainel(filtros) as never}
          className="inline-flex h-9 items-center gap-2 rounded-control border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text shadow-card transition-colors hover:bg-surface-hover"
        >
          <Monitor className="size-4" aria-hidden="true" />
          Modo Exibição
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        <AlternadorDoPainel />
        <BarraDeFiltros d={data} f={filtros} atualizando={isFetching && !isLoading} />
        <AtalhosRapidos />
        {problema ? (
          <Card>
            <EmptyState
              icon={<Gauge className="size-5" />}
              title="Período incompleto"
              description={problema}
            />
          </Card>
        ) : isLoading || !data ? (
          <Esqueleto />
        ) : (
          <Conteudo d={data} />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function BarraDeFiltros({
  d,
  f,
  atualizando,
}: {
  d: ControlPanel | undefined;
  f: ReturnType<typeof useFiltrosDoPainel>;
  atualizando: boolean;
}) {
  const setores = useMemo(
    () => (d?.sectors ?? []).filter((s) => !f.cliente || s.customer_id === f.cliente),
    [d, f.cliente]
  );
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentGroup label="Período">
          {PERIODOS.map((p) => (
            <FilterChip
              key={p.valor}
              segment
              active={f.periodo === p.valor}
              onClick={() => f.setPeriodo(p.valor as Periodo)}
            >
              {p.rotulo}
            </FilterChip>
          ))}
          <FilterChip segment active={f.periodo === 'custom'} onClick={() => f.setPeriodo('custom')}>
            Personalizado
          </FilterChip>
        </SegmentGroup>
        {f.periodo === 'custom' && (
          <span className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Início do período"
              value={f.de}
              onChange={(e) => f.setDe(e.target.value)}
              className="w-36"
            />
            <span className="text-xs text-muted">até</span>
            <Input
              type="date"
              aria-label="Fim do período"
              value={f.ate}
              onChange={(e) => f.setAte(e.target.value)}
              className="w-36"
            />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
        {/* Cliente só aparece para quem enxerga mais de um: o hospital não escolhe. */}
        {(d?.customers.length ?? 0) > 1 && (
          <Select
            aria-label="Cliente"
            value={f.cliente}
            onChange={(e) => f.setCliente(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Todos os clientes</option>
            {d!.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {setores.length > 0 && (
          <Select
            aria-label="Setor"
            value={f.setor}
            onChange={(e) => f.setSetor(e.target.value)}
            className="sm:w-52"
          >
            <option value="">Todos os setores</option>
            {setores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {atualizando && (
        <span className="text-xs text-subtle" aria-live="polite">
          atualizando…
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Categorias de situação que a lista de OS sabe filtrar pela URL. */
const CATEGORIAS_DA_LISTA = new Set(['open', 'in_progress', 'waiting', 'done']);

function Conteudo({ d }: { d: ControlPanel }) {
  const k = d.kpis;
  const rotulos = d.series.map((p) => rotuloDaFatia(p.start, d.granularity));
  const mttr = formatarDuracao(k.mttr.data.value);
  const mtbf = formatarDuracao(k.mtbf.data.value);
  const disp = disponibilidadeAgora(d.park.byStatus);
  const prev = d.preventives;
  const abertasAgora = Object.entries(d.open_now.byStatus).sort((a, b) => b[1] - a[1]);
  const totalAbertas = abertasAgora.reduce((a, [, v]) => a + v, 0);
  const amostrasMttr = d.series.reduce((a, p) => a + (p.mttrSamples ?? 0), 0);
  const fatia = d.granularity === 'day' ? 'dia' : d.granularity === 'week' ? 'semana' : 'mês';
  const tomTaxa = (v: number | null, bom: number, medio: number): Tone =>
    v === null ? 'neutral' : v >= bom ? 'good' : v >= medio ? 'warn' : 'bad';

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Indicadores-chave" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi
          rotulo="MTTR"
          valor={mttr.valor}
          unidade={mttr.unidade}
          icone={<Timer className="size-4" />}
          tom="info"
          dica={k.mttr.coverage?.note ?? `${k.mttr.data.samples} corretivas concluídas`}
          vazio={SEM_DADOS}
          link="/indicadores"
        />
        <Kpi
          rotulo="MTBF"
          valor={mtbf.valor}
          unidade={mtbf.unidade}
          icone={<Activity className="size-4" />}
          tom="info"
          dica={`${k.mtbf.data.assetsWithInterval} equipamentos com 2+ falhas`}
          vazio="Precisa de 2+ falhas por equipamento no período."
          link="/indicadores"
        />
        <Kpi
          rotulo="Backlog"
          valor={k.backlog.data.count}
          icone={<ClipboardList className="size-4" />}
          tom={k.backlog.data.count > 0 ? 'warn' : 'neutral'}
          serie={d.series.map((p) => p.backlog)}
          direcaoBoa="down"
          dica={
            k.backlog.data.oldestDays !== null
              ? `mais antiga há ${k.backlog.data.oldestDays} dias`
              : 'nenhuma OS em aberto'
          }
          link="/ordens?vista=lista"
        />
        <Kpi
          rotulo="SLA cumprido"
          valor={k.sla.data.rate}
          unidade="%"
          icone={<AlarmClock className="size-4" />}
          tom={tomTaxa(k.sla.data.rate, 90, 75)}
          dica={`${k.sla.data.met} no prazo · ${k.sla.data.breached} estourados`}
          vazio={SEM_DADOS}
          link="/indicadores"
        />
        <Kpi
          rotulo="Disponíveis agora"
          valor={disp.taxa}
          unidade="%"
          icone={<HeartPulse className="size-4" />}
          tom={tomTaxa(disp.taxa, 95, 85)}
          dica={`${disp.disponiveis} disponíveis · ${disp.indisponiveis} indisponíveis · ${d.park.total} equipamentos`}
          vazio="Nenhum equipamento no recorte."
          link="/ativos?situacao=under_maintenance"
        />
        <Kpi
          rotulo="Chamados abertos"
          valor={k.opened.data.count}
          icone={<Inbox className="size-4" />}
          tom="info"
          serie={d.series.map((p) => p.opened)}
          dica="OS abertas no período"
          link="/ordens?vista=lista&categoria=open"
        />
        <Kpi
          rotulo="Concluídos"
          valor={k.completed.data.count}
          icone={<CheckCircle2 className="size-4" />}
          tom="good"
          serie={d.series.map((p) => p.completed)}
          dica="OS concluídas no período"
          link="/ordens?vista=lista&categoria=done"
        />
        <Kpi
          rotulo="Preventivas vencidas"
          valor={prev && prev.totals.scheduled > 0 ? prev.totals.late : null}
          icone={<TriangleAlert className="size-4" />}
          tom={prev && prev.totals.late > 0 ? 'bad' : 'neutral'}
          dica={prev ? `${prev.totals.done} realizadas de ${prev.totals.scheduled} programadas` : null}
          vazio={SEM_DADOS}
          link="/planos?aba=cronograma&estado=late"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Grafico
          titulo="Evolução dos chamados"
          descricao={`Abertos × concluídos por ${fatia} — se concluídos ficam abaixo, o backlog cresce.`}
          className="lg:col-span-2"
        >
          <TrendChart
            label="Ordens abertas e concluídas por período"
            labels={rotulos}
            emptyMessage={SEM_DADOS}
            series={[
              { key: 'abertas', label: 'Abertos', values: d.series.map((p) => p.opened), series: 1 },
              { key: 'concluidas', label: 'Concluídos', values: d.series.map((p) => p.completed), series: 2 },
            ]}
          />
        </Grafico>

        <Grafico
          titulo="OS por situação"
          descricao="O trabalho em aberto agora, e onde ele está parado."
          destaque={totalAbertas > 0 ? `${totalAbertas.toLocaleString('pt-BR')} em aberto` : undefined}
        >
          {totalAbertas === 0 ? (
            <Vazio texto="Nenhuma OS em aberto." />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Barras, e não rosca: são situações a COMPARAR ("onde está
                  parado?"), e comprimento se compara; ângulo, não. Uma cor só —
                  a diferença é a grandeza, não a categoria. */}
              <BarChart
                label="OS abertas por situação"
                data={abertasAgora.map(([s, v]) => ({
                  label: ROTULO_SITUACAO_OS[s] ?? s,
                  value: v,
                  series: 1,
                }))}
              />
              <div className="flex flex-wrap gap-1.5">
                {abertasAgora
                  .filter(([s]) => CATEGORIAS_DA_LISTA.has(s))
                  .map(([s, v]) => (
                    <IrPara key={s} para={`/ordens?vista=lista&categoria=${s}`}>
                      {ROTULO_SITUACAO_OS[s] ?? s} ({v})
                    </IrPara>
                  ))}
              </div>
            </div>
          )}
        </Grafico>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Grafico
          className="lg:col-span-2"
          titulo="Preventivas"
          descricao="Programadas no período: realizadas, pendentes e vencidas (com a tolerância de cada plano)."
          acao={<IrPara para="/planos?aba=cronograma">Ver cronograma</IrPara>}
        >
          {!prev || prev.totals.scheduled === 0 ? (
            <Vazio texto={SEM_DADOS} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border-subtle bg-border-subtle sm:grid-cols-4">
                <Mini rotulo="Programadas" valor={prev.totals.scheduled} />
                <Mini rotulo="Realizadas" valor={prev.totals.done} tom="good" />
                <Mini rotulo="Pendentes" valor={prev.totals.pending} tom="info" />
                <Mini
                  rotulo="Vencidas"
                  valor={prev.totals.late}
                  tom={prev.totals.late > 0 ? 'bad' : undefined}
                />
              </div>
              <ColumnChart
                label="Preventivas por mês e situação"
                height={180}
                labels={prev.byMonth.map((m) => rotuloDoMes(m.key))}
                segments={[
                  { key: 'done', label: 'Realizadas', values: prev.byMonth.map((m) => m.done), tone: 'good' },
                  {
                    key: 'pending',
                    label: 'Pendentes',
                    values: prev.byMonth.map((m) => m.pending),
                    tone: 'info',
                  },
                  { key: 'late', label: 'Vencidas', values: prev.byMonth.map((m) => m.late), tone: 'bad' },
                ]}
              />
            </div>
          )}
        </Grafico>

        <Grafico
          titulo="Disponibilidade do parque"
          descricao="Agora, pelo status cadastrado: disponível = em operação ou reserva. Não é disponibilidade no tempo."
          acao={<IrPara para="/ativos?situacao=under_maintenance">Ver equipamentos em manutenção</IrPara>}
        >
          {disp.base === 0 ? (
            <Vazio texto="Nenhum equipamento no recorte." />
          ) : (
            <DonutChart
              label="Equipamentos disponíveis e indisponíveis"
              centerValue={disp.taxa === null ? '—' : `${disp.taxa.toLocaleString('pt-BR')}%`}
              centerLabel="disponíveis"
              data={[
                { label: 'Disponíveis', value: disp.disponiveis, tone: 'good' },
                { label: 'Em manutenção', value: disp.indisponiveis, tone: 'warn' },
                ...(disp.emprestados > 0
                  ? [{ label: 'Emprestados', value: disp.emprestados, tone: 'neutral' as const }]
                  : []),
              ]}
            />
          )}
        </Grafico>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Grafico
          titulo="MTTR no tempo"
          descricao={`Tempo médio de reparo das corretivas concluídas em cada ${fatia}.`}
        >
          {amostrasMttr < 2 ? (
            <Vazio texto={SEM_DADOS} />
          ) : (
            <TrendChart
              label="MTTR por período, em horas"
              labels={rotulos}
              series={[
                {
                  key: 'mttr',
                  label: 'MTTR (h)',
                  values: d.series.map((p) =>
                    p.mttrMinutes === null || p.mttrMinutes === undefined
                      ? null
                      : Math.round(p.mttrMinutes / 6) / 10
                  ),
                  series: 3,
                },
              ]}
            />
          )}
        </Grafico>
        <Grafico titulo="Backlog no tempo" descricao={`OS abertas e não concluídas no fim de cada ${fatia}.`}>
          <TrendChart
            label="Backlog por período"
            labels={rotulos}
            emptyMessage="Backlog zerado em todo o período."
            series={[
              {
                key: 'backlog',
                label: 'Backlog',
                values: d.series.map((p) => p.backlog),
                tone: 'warn',
                area: true,
              },
            ]}
          />
        </Grafico>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-4 text-xs text-subtle">
        <Gauge className="size-3.5" aria-hidden="true" />
        Definição de cada indicador em
        <Link
          to="/indicadores"
          className="inline-flex min-h-6 items-center text-accent-text underline-offset-2 hover:underline"
        >
          Indicadores detalhados
        </Link>
        · atualizado{' '}
        {new Date(d.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const ACENTO: Record<Tone, string> = {
  neutral: 'bg-surface-hover text-muted',
  accent: 'bg-accent-soft text-accent-text',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
  info: 'bg-info-soft text-info-text',
};

function Kpi({
  rotulo,
  valor,
  unidade,
  icone,
  tom,
  dica,
  serie,
  direcaoBoa = 'up',
  vazio,
  link,
}: {
  rotulo: string;
  valor: number | string | null;
  unidade?: string;
  icone: ReactNode;
  tom: Tone;
  dica?: string | null;
  serie?: number[];
  direcaoBoa?: 'up' | 'down';
  vazio?: string;
  link?: string;
}) {
  const nulo = valor === null || valor === undefined;
  /*
   * O KPI COMUNICA, NESTA ORDEM: métrica, valor, contexto e estado.
   * O número é o maior elemento do cartão e fica na cor do texto; só atenção
   * e problema o pintam. O estado mora no ícone (cor + forma) e na frase de
   * contexto — tendência só aparece onde há série real (sparkline), nunca
   * inventada.
   */
  const pintaNumero = tom === 'warn' || tom === 'bad';
  const corpo = (
    <div className="flex h-full flex-col gap-2 p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{rotulo}</span>
        <span
          className={cn('flex size-7 shrink-0 items-center justify-center rounded-control', ACENTO[tom])}
          aria-hidden="true"
        >
          {icone}
        </span>
      </div>
      <p className="flex items-baseline gap-1">
        <span
          data-numeric
          className={cn(
            'text-3xl leading-none font-bold tracking-display tabular-nums',
            nulo
              ? 'text-subtle'
              : pintaNumero
                ? tom === 'bad'
                  ? 'text-bad-text'
                  : 'text-warn-text'
                : 'text-text'
          )}
        >
          {nulo ? '—' : typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        </span>
        {!nulo && unidade && <span className="text-base font-semibold text-subtle">{unidade}</span>}
      </p>
      {serie && serie.length > 1 && serie.some((v) => v > 0) && (
        <Sparkline values={serie} label={`Tendência de ${rotulo}`} goodDirection={direcaoBoa} height={24} />
      )}
      <p className="mt-auto flex items-center gap-1 text-xs text-subtle">
        <span className="min-w-0 flex-1">{nulo && vazio ? vazio : dica}</span>
        {link && (
          <ChevronRight
            className="size-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
            aria-hidden="true"
          />
        )}
      </p>
    </div>
  );
  return (
    <Card className="overflow-hidden">
      {link ? (
        <Link to={link} className="group block h-full transition-colors hover:bg-surface-hover">
          {corpo}
        </Link>
      ) : (
        corpo
      )}
    </Card>
  );
}

function Grafico({
  titulo,
  descricao,
  destaque,
  acao,
  className,
  children,
}: {
  titulo: string;
  descricao: string;
  /** Um número de contexto ao lado do título (ex.: o total). */
  destaque?: string;
  acao?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={titulo}
        description={descricao}
        className="border-b-0 px-5 pt-5 pb-3"
        actions={
          destaque ? (
            <span data-numeric className="text-sm font-semibold text-text tabular-nums">
              {destaque}
            </span>
          ) : undefined
        }
      />
      <div className="flex-1 px-5 pb-5">
        {children}
        {/* No rodapé, e não no cabeçalho: no celular o cabeçalho não tem largura para ele. */}
        {acao && <div className="mt-2 flex justify-end">{acao}</div>}
      </div>
    </Card>
  );
}

function IrPara({ para, children }: { para: string; children: ReactNode }) {
  return (
    <Link
      to={para}
      className="inline-flex min-h-7 items-center gap-0.5 rounded-control px-2 text-xs font-medium text-accent-text hover:bg-accent-soft"
    >
      {children}
      <ChevronRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

function Mini({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: 'good' | 'info' | 'bad' }) {
  const cor =
    tom === 'good'
      ? 'text-good-text'
      : tom === 'info'
        ? 'text-info-text'
        : tom === 'bad'
          ? 'text-bad-text'
          : 'text-text';
  return (
    <div className="bg-surface px-3 py-2.5">
      <p className="text-xs text-muted">{rotulo}</p>
      <p data-numeric className={cn('text-xl font-bold tabular-nums', cor)}>
        {valor}
      </p>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-control bg-surface-subtle px-4 text-center text-sm text-muted">
      {texto}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando o painel</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-card lg:col-span-2" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
