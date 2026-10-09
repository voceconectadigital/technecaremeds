/**
 * Aurora — Painel de Controle.
 *
 * A TELA RESPONDE "COMO ESTAMOS INDO?" EM TRINTA SEGUNDOS.
 *
 * Um KPI herói (disponibilidade do parque agora), sete indicadores num painel
 * só (MTTR, MTBF, SLA, backlog, chamados abertos, concluídos, preventivas
 * vencidas) e cinco gráficos, com a evolução dos chamados como protagonista. Todos respondem ao MESMO filtro, e o
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
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  Inbox,
  Monitor,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import {
  BarChart,
  Card,
  ColumnChart,
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

type Filtros = ReturnType<typeof useFiltrosDoPainel>;

export function PainelPage() {
  const filtros = useFiltrosDoPainel();
  const { data, isLoading, isError, error, isFetching, problema } = usePainel(filtros);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Painel de Controle"
      subtitle="Visão executiva da operação de engenharia clínica."
      actions={
        <>
          <FiltrosDeRecorte d={data} f={filtros} atualizando={isFetching && !isLoading} />
          <Link
            to="/painel/tv"
            search={buscaDoPainel(filtros) as never}
            className="inline-flex h-10 items-center gap-2 rounded-control bg-[var(--aurora-brand-950)] px-4 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
          >
            <Monitor className="size-4" aria-hidden="true" />
            Modo Exibição
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Navegação do módulo à esquerda, recorte de tempo à direita: uma
            linha só, e não duas barras empilhadas. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <AlternadorDoPainel />
          <Periodo f={filtros} />
        </div>
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

function Periodo({ f }: { f: Filtros }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}

/** Cliente e setor moram no cabeçalho, ao lado do título: são o "de quem". */
function FiltrosDeRecorte({
  d,
  f,
  atualizando,
}: {
  d: ControlPanel | undefined;
  f: Filtros;
  atualizando: boolean;
}) {
  const setores = useMemo(
    () => (d?.sectors ?? []).filter((s) => !f.cliente || s.customer_id === f.cliente),
    [d, f.cliente]
  );
  return (
    <>
      {atualizando && (
        <span className="text-xs text-subtle" aria-live="polite">
          atualizando…
        </span>
      )}
      {/* Cliente só aparece para quem enxerga mais de um: o hospital não escolhe. */}
      {(d?.customers.length ?? 0) > 1 && (
        <Select
          aria-label="Cliente"
          value={f.cliente}
          onChange={(e) => f.setCliente(e.target.value)}
          className="h-10 w-full sm:w-52"
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
          className="h-10 w-full sm:w-48"
        >
          <option value="">Todos os setores</option>
          {setores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Categorias de situação que a lista de OS sabe filtrar pela URL. */
const CATEGORIAS_DA_LISTA = new Set(['open', 'in_progress', 'waiting', 'done']);

const tomTaxa = (v: number | null, bom: number, medio: number): Tone =>
  v === null ? 'neutral' : v >= bom ? 'good' : v >= medio ? 'warn' : 'bad';

/*
 * A COMPOSIÇÃO É EDITORIAL, E NÃO UMA GRADE DE CAIXAS IGUAIS.
 *
 *   linha 1  [ disponibilidade do parque — herói ][ painel de indicadores 4×2 ]
 *   linha 2  [ evolução dos chamados — protagonista, 2/3 ][ OS por situação ]
 *   linha 3  [ preventivas ][ backlog no tempo ][ MTTR no tempo ]
 */
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

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Indicadores-chave" className="grid gap-4 lg:grid-cols-12">
        <Disponibilidade d={d} disp={disp} className="lg:col-span-4" />

        <Card className="overflow-hidden lg:col-span-8">
          <div className="grid h-full grid-cols-2 gap-px bg-border-subtle sm:grid-cols-4">
            <Kpi
              rotulo="MTTR"
              valor={mttr.valor}
              unidade={mttr.unidade}
              icone={Timer}
              dica={k.mttr.coverage?.note ?? `${k.mttr.data.samples} corretivas concluídas`}
              vazio={SEM_DADOS}
              link="/indicadores"
            />
            <Kpi
              rotulo="MTBF"
              valor={mtbf.valor}
              unidade={mtbf.unidade}
              icone={Activity}
              dica={`${k.mtbf.data.assetsWithInterval} equipamentos com 2+ falhas`}
              vazio="Precisa de 2+ falhas por equipamento."
              link="/indicadores"
            />
            <Kpi
              rotulo="SLA cumprido"
              valor={k.sla.data.rate}
              unidade="%"
              icone={AlarmClock}
              tom={tomTaxa(k.sla.data.rate, 90, 75)}
              dica={`${k.sla.data.met} no prazo · ${k.sla.data.breached} estourados`}
              vazio={SEM_DADOS}
              link="/indicadores"
            />
            <Kpi
              rotulo="Backlog"
              valor={k.backlog.data.count}
              icone={ClipboardList}
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
              rotulo="Chamados abertos"
              valor={k.opened.data.count}
              icone={Inbox}
              serie={d.series.map((p) => p.opened)}
              dica="OS abertas no período"
              link="/ordens?vista=lista&categoria=open"
            />
            <Kpi
              rotulo="Concluídos"
              valor={k.completed.data.count}
              icone={CheckCircle2}
              serie={d.series.map((p) => p.completed)}
              dica="OS concluídas no período"
              link="/ordens?vista=lista&categoria=done"
            />
            <Kpi
              rotulo="Preventivas vencidas"
              valor={prev && prev.totals.scheduled > 0 ? prev.totals.late : null}
              icone={TriangleAlert}
              tom={prev && prev.totals.late > 0 ? 'bad' : 'neutral'}
              dica={prev ? `${prev.totals.done} realizadas de ${prev.totals.scheduled} programadas` : null}
              vazio={SEM_DADOS}
              link="/planos?aba=cronograma&estado=late"
              largo
              progresso={
                prev && prev.totals.scheduled > 0
                  ? { feito: prev.totals.done, total: prev.totals.scheduled }
                  : undefined
              }
            />
          </div>
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Grafico
          protagonista
          titulo="Evolução dos chamados"
          descricao={`Abertos × concluídos por ${fatia}. Se os concluídos ficam abaixo, o backlog cresce.`}
          destaque={
            <span className="flex items-baseline gap-4">
              <Total rotulo="abertos" valor={k.opened.data.count} />
              <Total rotulo="concluídos" valor={k.completed.data.count} />
            </span>
          }
          className="lg:col-span-8"
        >
          <TrendChart
            label="Ordens abertas e concluídas por período"
            labels={rotulos}
            height={296}
            emptyMessage={SEM_DADOS}
            series={[
              {
                key: 'abertas',
                label: 'Abertos',
                values: d.series.map((p) => p.opened),
                series: 1,
                area: true,
              },
              { key: 'concluidas', label: 'Concluídos', values: d.series.map((p) => p.completed), series: 2 },
            ]}
          />
        </Grafico>

        <Grafico
          titulo="OS por situação"
          descricao="O trabalho em aberto agora, e onde está parado."
          destaque={totalAbertas > 0 ? <Total rotulo="em aberto" valor={totalAbertas} /> : undefined}
          className="lg:col-span-4"
        >
          {totalAbertas === 0 ? (
            <Vazio texto="Nenhuma OS em aberto." />
          ) : (
            <div className="flex h-full flex-col gap-4">
              {/* Barras, e não rosca: situações se COMPARAM ("onde está parado?"),
                  e comprimento se compara; ângulo, não. Uma cor só. */}
              <BarChart
                layout="stacked"
                label="OS abertas por situação"
                data={abertasAgora.map(([s, v]) => ({
                  label: ROTULO_SITUACAO_OS[s] ?? s,
                  value: v,
                  series: 1,
                }))}
              />
              <div className="mt-auto flex flex-wrap gap-1 border-t border-border-subtle pt-3">
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
          titulo="Preventivas"
          descricao="Realizadas, pendentes e vencidas, com a tolerância de cada plano."
          acao={<IrPara para="/planos?aba=cronograma">Ver cronograma</IrPara>}
        >
          {!prev || prev.totals.scheduled === 0 ? (
            <Vazio texto={SEM_DADOS} />
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-4 gap-2">
                <Mini rotulo="Programadas" valor={prev.totals.scheduled} />
                <Mini rotulo="Realizadas" valor={prev.totals.done} tom="good" />
                <Mini rotulo="Pendentes" valor={prev.totals.pending} tom="info" />
                <Mini
                  rotulo="Vencidas"
                  valor={prev.totals.late}
                  tom={prev.totals.late > 0 ? 'bad' : undefined}
                />
              </dl>
              <ColumnChart
                label="Preventivas por mês e situação"
                height={150}
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

        <Grafico titulo="Backlog no tempo" descricao={`OS abertas e não concluídas no fim de cada ${fatia}.`}>
          <TrendChart
            label="Backlog por período"
            labels={rotulos}
            height={200}
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

        <Grafico titulo="MTTR no tempo" descricao={`Tempo médio de reparo das corretivas, por ${fatia}.`}>
          {amostrasMttr < 2 ? (
            <Vazio texto={SEM_DADOS} />
          ) : (
            <TrendChart
              label="MTTR por período, em horas"
              labels={rotulos}
              height={200}
              series={[
                {
                  key: 'mttr',
                  label: 'MTTR (h)',
                  values: d.series.map((p) =>
                    p.mttrMinutes === null || p.mttrMinutes === undefined
                      ? null
                      : Math.round(p.mttrMinutes / 6) / 10
                  ),
                  series: 4,
                },
              ]}
            />
          )}
        </Grafico>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">
        <Gauge className="size-3.5" aria-hidden="true" />
        Definição de cada indicador em
        <Link
          to="/indicadores"
          className="inline-flex min-h-6 items-center font-medium text-accent-text underline-offset-2 hover:underline"
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

/**
 * O KPI HERÓI: disponibilidade do parque, na cor da moldura.
 *
 * É o número que o diretor clínico pergunta primeiro ("quanto do parque está
 * de pé agora?"), e por isso ocupa o lugar e o tamanho de herói. A barra
 * empilhada mostra a composição sem um segundo gráfico. É a fotografia do
 * status CADASTRADO — não disponibilidade no tempo (AI-HANDOFF §15-A).
 */
function Disponibilidade({
  d,
  disp,
  className,
}: {
  d: ControlPanel;
  disp: ReturnType<typeof disponibilidadeAgora>;
  className?: string;
}) {
  const tom = tomTaxa(disp.taxa, 95, 85);
  const partes = [
    { rotulo: 'Disponíveis', valor: disp.disponiveis, cor: 'bg-good' },
    { rotulo: 'Em manutenção', valor: disp.indisponiveis, cor: 'bg-warn' },
    ...(disp.emprestados > 0
      ? [{ rotulo: 'Emprestados', valor: disp.emprestados, cor: 'bg-nav-label' }]
      : []),
  ];
  return (
    <section
      aria-labelledby="kpi-disponibilidade"
      className={cn(
        'aurora-nav relative flex flex-col overflow-hidden rounded-card bg-nav p-6 shadow-raised',
        className
      )}
    >
      {/* Brilho de canto, muito fraco: a única textura do painel. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--aurora-brand-600), transparent 70%)' }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <h2 id="kpi-disponibilidade" className="text-sm font-semibold text-nav-text-active">
          Disponibilidade do parque
        </h2>
        <span className="rounded-[6px] bg-nav-raised px-2 py-0.5 text-2xs font-semibold tracking-label text-nav-text uppercase">
          Agora
        </span>
      </div>

      {disp.base === 0 ? (
        <p className="relative mt-6 text-sm text-nav-text">Nenhum equipamento no recorte.</p>
      ) : (
        <>
          <p className="relative mt-5 flex items-baseline gap-1.5">
            <span
              data-numeric
              className="text-[3.5rem] leading-none font-bold tracking-display text-nav-text-active tabular-nums"
            >
              {disp.taxa === null ? '—' : disp.taxa.toLocaleString('pt-BR')}
            </span>
            <span className="text-2xl font-semibold text-nav-text">%</span>
          </p>
          <p className="relative mt-2 flex items-center gap-2 text-sm text-nav-text">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                tom === 'good'
                  ? 'bg-good'
                  : tom === 'warn'
                    ? 'bg-warn'
                    : tom === 'bad'
                      ? 'bg-bad'
                      : 'bg-nav-label'
              )}
            />
            {disp.disponiveis} de {d.park.total} equipamentos disponíveis
          </p>

          <div className="relative mt-auto pt-6">
            <div
              className="flex h-2.5 overflow-hidden rounded-pill bg-nav-raised"
              role="img"
              aria-label={partes.map((p) => `${p.rotulo}: ${p.valor}`).join(', ')}
            >
              {partes.map((p) =>
                p.valor > 0 ? (
                  <span
                    key={p.rotulo}
                    className={cn('h-full border-r-2 border-[var(--aurora-nav-bg)] last:border-r-0', p.cor)}
                    style={{ width: `${(p.valor / disp.base) * 100}%` }}
                  />
                ) : null
              )}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-nav-text">
              {partes.map((p) => (
                <li key={p.rotulo} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', p.cor)} />
                  {p.rotulo}
                  <span data-numeric className="font-semibold text-nav-text-active tabular-nums">
                    {p.valor}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to="/ativos?situacao=under_maintenance"
              className="mt-4 inline-flex min-h-6 items-center gap-1 text-xs font-semibold text-nav-text-active hover:underline"
            >
              Ver equipamentos em manutenção
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Uma célula do painel de indicadores: rótulo, número, contexto.
 *
 * Sem ícone em círculo colorido — o ícone é traço, pequeno e neutro, e o
 * estado mora num ponto ao lado do rótulo e na cor do número (só atenção e
 * problema pintam o número). Tendência só aparece onde há série real.
 */
function Kpi({
  rotulo,
  valor,
  unidade,
  icone: Icone,
  tom = 'neutral',
  dica,
  serie,
  direcaoBoa = 'up',
  vazio,
  link,
  largo = false,
  progresso,
}: {
  rotulo: string;
  valor: number | string | null;
  unidade?: string;
  icone: typeof Timer;
  tom?: Tone;
  dica?: string | null;
  serie?: number[];
  direcaoBoa?: 'up' | 'down';
  vazio?: string;
  link: string;
  largo?: boolean;
  progresso?: { feito: number; total: number };
}) {
  const nulo = valor === null || valor === undefined;
  const corDoNumero = nulo
    ? 'text-subtle'
    : tom === 'bad'
      ? 'text-bad-text'
      : tom === 'warn'
        ? 'text-warn-text'
        : 'text-text';
  const ponto = tom === 'good' ? 'bg-good' : tom === 'warn' ? 'bg-warn' : tom === 'bad' ? 'bg-bad' : null;
  return (
    <Link
      to={link}
      className={cn(
        'group flex min-h-[124px] flex-col gap-2 bg-surface p-4 transition-colors hover:bg-surface-hover lg:p-5',
        largo && 'col-span-2'
      )}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <Icone aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 leading-tight">{rotulo}</span>
        {ponto && <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', ponto)} />}
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="flex items-baseline gap-1">
          <span
            data-numeric
            className={cn('text-[1.75rem] leading-none font-bold tracking-display tabular-nums', corDoNumero)}
          >
            {nulo ? '—' : typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
          </span>
          {!nulo && unidade && <span className="text-sm font-semibold text-subtle">{unidade}</span>}
        </span>
        {serie && serie.length > 1 && serie.some((v) => v > 0) && (
          <span className="w-20 shrink-0">
            <Sparkline
              values={serie}
              label={`Tendência de ${rotulo}`}
              goodDirection={direcaoBoa}
              height={26}
            />
          </span>
        )}
      </span>
      {progresso && (
        <span
          className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken"
          role="img"
          aria-label={`${progresso.feito} de ${progresso.total} realizadas`}
        >
          <span
            className="block h-full rounded-pill bg-good"
            style={{ width: `${Math.round((progresso.feito / progresso.total) * 100)}%` }}
          />
        </span>
      )}
      <span className="mt-auto text-xs leading-snug text-subtle">{nulo && vazio ? vazio : dica}</span>
    </Link>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <span className="flex items-baseline gap-1.5 text-xs text-subtle">
      <span data-numeric className="text-lg font-bold text-text tabular-nums">
        {valor.toLocaleString('pt-BR')}
      </span>
      {rotulo}
    </span>
  );
}

function Grafico({
  titulo,
  descricao,
  destaque,
  acao,
  protagonista = false,
  className,
  children,
}: {
  titulo: string;
  descricao: string;
  destaque?: ReactNode;
  acao?: ReactNode;
  protagonista?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div
        className={cn(
          'flex flex-col gap-2 px-5 pt-5 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
          protagonista && 'lg:px-6 lg:pt-6'
        )}
      >
        <div className="min-w-0">
          <h2 className={cn('font-bold tracking-tight text-text', protagonista ? 'text-xl' : 'text-lg')}>
            {titulo}
          </h2>
          <p className="mt-1 text-sm text-muted">{descricao}</p>
        </div>
        {destaque && <div className="shrink-0 pt-0.5">{destaque}</div>}
      </div>
      <div className={cn('flex-1 px-5 pb-5', protagonista && 'lg:px-6 lg:pb-6')}>
        {children}
        {acao && <div className="mt-2 flex justify-end">{acao}</div>}
      </div>
    </Card>
  );
}

function IrPara({ para, children }: { para: string; children: ReactNode }) {
  return (
    <Link
      to={para}
      className="inline-flex min-h-7 items-center gap-0.5 rounded-control px-2 text-xs font-semibold text-accent-text hover:bg-accent-soft"
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
    <div className="rounded-control bg-surface-subtle px-2.5 py-2">
      <dt className="truncate text-2xs font-medium text-muted">{rotulo}</dt>
      <dd data-numeric className={cn('text-lg font-bold tabular-nums', cor)}>
        {valor}
      </dd>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-control bg-surface-subtle px-4 text-center text-sm text-muted">
      {texto}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Carregando o painel</span>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 rounded-card lg:col-span-4" />
        <Skeleton className="h-64 rounded-card lg:col-span-8" />
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-96 rounded-card lg:col-span-8" />
        <Skeleton className="h-96 rounded-card lg:col-span-4" />
      </div>
    </div>
  );
}
