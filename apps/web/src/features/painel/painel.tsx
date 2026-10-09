/**
 * Aurora — Painel de Controle.
 *
 * A TELA RESPONDE "COMO ESTAMOS INDO?" EM TRINTA SEGUNDOS.
 *
 * Primeiro os números que a diretoria pergunta (abertas, concluídas, backlog,
 * MTTR, MTBF, SLA, conformidade das preventivas, parque); depois o TEMPO —
 * para onde cada um está indo —; depois a composição (onde o backlog está,
 * em que situação o parque está, quem está produzindo).
 *
 * TODO NÚMERO É DO SERVIDOR, COM DEFINIÇÃO E COBERTURA. A tela não soma, não
 * interpola, não inventa série: o que não tem base aparece como traço, e o
 * que tem base parcial diz a cobertura embaixo.
 *
 * Disponibilidade do parque NÃO é exibida como número: não há definição de
 * "tempo parado" confirmada pelo cliente (AI-HANDOFF §15-A). O que aparece é
 * a situação CADASTRADA de cada equipamento — e a tela diz isso.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Activity,
  AlarmClock,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Gauge,
  Inbox,
  Monitor,
  Timer,
  Wrench,
} from 'lucide-react';
import {
  BarChart,
  Card,
  CardHeader,
  ColumnChart,
  DonutChart,
  FilterChip,
  RateRing,
  Select,
  Skeleton,
  Sparkline,
  StatusChip,
  TrendChart,
  cn,
  type Tone,
} from '@aurora/ui';
import type { ControlPanel } from '@aurora/contracts';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { usePainel, useFiltrosDoPainel } from './dados';
import {
  PERIODOS,
  ROTULO_PRIORIDADE,
  ROTULO_SITUACAO_OS,
  ROTULO_STATUS_ATIVO,
  TOM_STATUS_ATIVO,
  formatarDuracao,
  rotuloDaFatia,
  type Periodo,
} from './rotulos';
import { AlternadorDoPainel } from './alternador';

export function PainelPage() {
  const filtros = useFiltrosDoPainel();
  const { data, isLoading, isError, error, isFetching } = usePainel(filtros);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell
      title="Painel de Controle"
      subtitle="Manutenção, prazos e parque — com a definição de cada número ao lado dele."
      actions={
        <Link
          to="/painel/tv"
          search={{
            ...(filtros.periodo !== '30d' ? { periodo: filtros.periodo } : {}),
            ...(filtros.cliente ? { cliente: filtros.cliente } : {}),
            ...(filtros.setor ? { setor: filtros.setor } : {}),
          }}
          className="inline-flex h-9 items-center gap-2 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent shadow-card transition-colors hover:bg-accent-hover"
        >
          <Monitor className="size-4" aria-hidden="true" />
          Modo Exibição
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <AlternadorDoPainel />
        <BarraDeFiltros d={data} f={filtros} atualizando={isFetching && !isLoading} />
        {isLoading || !data ? <Esqueleto /> : <Conteudo d={data} />}
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
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-card md:flex-row md:items-center">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-1.5">
        {PERIODOS.map((p) => (
          <FilterChip
            key={p.valor}
            active={f.periodo === p.valor}
            onClick={() => f.setPeriodo(p.valor as Periodo)}
          >
            {p.rotulo}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row md:justify-end">
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

function Conteudo({ d }: { d: ControlPanel }) {
  const k = d.kpis;
  const rotulos = d.series.map((p) => rotuloDaFatia(p.start, d.granularity));
  const mttr = formatarDuracao(k.mttr.data.value);
  const mtbf = formatarDuracao(k.mtbf.data.value);
  const abertasAgora = Object.values(d.open_now.byStatus).reduce((a, b) => a + b, 0);
  const prod = [...k.productivity.data].sort((a, b) => b.completed - a.completed);

  return (
    <div className="flex flex-col gap-5">
      {/* Os oito números. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          rotulo="Chamados abertos"
          valor={k.opened.data.count}
          icone={<Inbox className="size-4" />}
          tom="info"
          serie={d.series.map((p) => p.opened)}
          dica="OS abertas no período"
          link="/ordens"
        />
        <Kpi
          rotulo="Concluídos"
          valor={k.completed.data.count}
          icone={<CheckCircle2 className="size-4" />}
          tom="good"
          serie={d.series.map((p) => p.completed)}
          dica="OS concluídas no período"
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
              : 'nenhuma OS aberta'
          }
        />
        <Kpi
          rotulo="Equipamentos"
          valor={d.park.total}
          icone={<Boxes className="size-4" />}
          tom="accent"
          dica={`${d.park.byStatus.active ?? 0} em operação · ${d.park.byStatus.under_maintenance ?? 0} em manutenção`}
          link="/ativos"
        />
        <Kpi
          rotulo="MTTR"
          valor={mttr.valor}
          unidade={mttr.unidade}
          icone={<Timer className="size-4" />}
          tom="info"
          dica={k.mttr.coverage?.note ?? 'tempo médio de reparo das corretivas'}
          vazio="sem corretiva concluída"
        />
        <Kpi
          rotulo="MTBF"
          valor={mtbf.valor}
          unidade={mtbf.unidade}
          icone={<Activity className="size-4" />}
          tom="info"
          dica={k.mtbf.coverage?.note ?? 'tempo médio entre falhas'}
          vazio="precisa de 2+ falhas por ativo"
        />
        <Kpi
          rotulo="SLA cumprido"
          valor={k.sla.data.rate}
          unidade="%"
          icone={<AlarmClock className="size-4" />}
          tom={
            k.sla.data.rate === null
              ? 'neutral'
              : k.sla.data.rate >= 90
                ? 'good'
                : k.sla.data.rate >= 75
                  ? 'warn'
                  : 'bad'
          }
          dica={`${k.sla.data.met} no prazo · ${k.sla.data.breached} estourados`}
          vazio="nenhum relógio encerrado"
        />
        <Kpi
          rotulo="Preventivas em dia"
          valor={k.plan_compliance.data.rate}
          unidade="%"
          icone={<Wrench className="size-4" />}
          tom={
            k.plan_compliance.data.rate === null
              ? 'neutral'
              : k.plan_compliance.data.rate >= 90
                ? 'good'
                : k.plan_compliance.data.rate >= 70
                  ? 'warn'
                  : 'bad'
          }
          dica={`${k.plan_compliance.data.done} de ${k.plan_compliance.data.expected - k.plan_compliance.data.skipped} previstas`}
          vazio="nenhuma preventiva prevista"
          link="/planos"
        />
      </div>

      {/* O tempo. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Abertos × concluídos"
            description={`Por ${d.granularity === 'day' ? 'dia' : d.granularity === 'week' ? 'semana' : 'mês'} — se a linha de concluídos fica abaixo, o backlog cresce.`}
          />
          <div className="px-4 pb-4">
            <TrendChart
              label="Ordens abertas e concluídas por período"
              labels={rotulos}
              series={[
                { key: 'abertas', label: 'Abertos', values: d.series.map((p) => p.opened), series: 1 },
                {
                  key: 'concluidas',
                  label: 'Concluídos',
                  values: d.series.map((p) => p.completed),
                  series: 2,
                },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Prazos" description="Taxas do período, com a base de cada uma." />
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <RateRing
              value={k.sla.data.rate}
              label="SLA cumprido"
              tone="info"
              caption={
                <>
                  SLA cumprido
                  <br />
                  {k.sla.data.met + k.sla.data.breached} relógios
                </>
              }
            />
            <RateRing
              value={k.plan_compliance.data.rate}
              label="Conformidade das preventivas"
              tone="good"
              caption={
                <>
                  Preventivas em dia
                  <br />
                  {k.plan_compliance.data.expected} previstas
                </>
              }
            />
            <div className="col-span-2 mt-2">
              <RateRing
                value={k.mix.data.preventiveShare}
                label="Participação de preventivas"
                tone="accent"
                size={84}
                caption={`Preventivas no total concluído (${k.mix.data.preventive} × ${k.mix.data.corrective} corretivas)`}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Backlog ao longo do período"
            description="OS abertas e não concluídas no fim de cada fatia — mesma definição do cartão."
          />
          <div className="px-4 pb-4">
            <TrendChart
              label="Backlog por período"
              labels={rotulos}
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
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Concluídos por natureza"
            description="Realizado do período: o que foi planejado e o que foi apagar incêndio."
          />
          <div className="px-4 pb-4">
            <ColumnChart
              label="Concluídos por natureza e período"
              labels={rotulos}
              segments={[
                {
                  key: 'prev',
                  label: 'Preventivas',
                  values: d.series.map((p) => p.completedPreventive),
                  series: 2,
                },
                {
                  key: 'corr',
                  label: 'Corretivas',
                  values: d.series.map((p) => p.completedCorrective),
                  series: 1,
                },
                {
                  key: 'outras',
                  label: 'Outras',
                  values: d.series.map((p) =>
                    Math.max(p.completed - p.completedPreventive - p.completedCorrective, 0)
                  ),
                  series: 4,
                },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* A composição agora. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Abertas agora" description="Onde o trabalho em aberto está parado." />
          <div className="px-4 pb-4">
            {abertasAgora === 0 ? (
              <Vazio texto="Nenhuma OS em aberto." />
            ) : (
              <DonutChart
                label="OS abertas por situação"
                centerValue={abertasAgora}
                centerLabel="abertas"
                data={Object.entries(d.open_now.byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k2, v], i) => ({
                    label: ROTULO_SITUACAO_OS[k2] ?? k2,
                    value: v,
                    series: ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6,
                  }))}
              />
            )}
            {abertasAgora > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {Object.entries(d.open_now.byPriority)
                  .sort((a, b) => b[1] - a[1])
                  .map(([p, v]) => (
                    <StatusChip
                      key={p}
                      size="sm"
                      tone={
                        p === 'emergency' || p === 'very_urgent' ? 'bad' : p === 'urgent' ? 'warn' : 'neutral'
                      }
                    >
                      {ROTULO_PRIORIDADE[p] ?? p}: {v}
                    </StatusChip>
                  ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Situação do parque"
            description="Pelo status cadastrado de cada equipamento. Não é disponibilidade (definição pendente com o cliente)."
          />
          <div className="px-4 pb-4">
            {d.park.total === 0 ? (
              <Vazio texto="Nenhum equipamento no recorte." />
            ) : (
              <DonutChart
                label="Equipamentos por situação"
                centerValue={d.park.total}
                centerLabel="equipamentos"
                data={Object.entries(d.park.byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, v]) => ({
                    label: ROTULO_STATUS_ATIVO[s] ?? s,
                    value: v,
                    tone: TOM_STATUS_ATIVO[s],
                  }))}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Equipamentos por setor" description="Os setores com mais equipamentos em uso." />
          <div className="px-4 pb-4">
            {d.park.bySector.length === 0 ? (
              <Vazio texto="Nenhum equipamento ligado a um setor." />
            ) : (
              <BarChart
                label="Equipamentos por setor"
                data={d.park.bySector.map((s) => ({
                  label: d.customers.length > 1 ? `${s.name} · ${s.customer_name}` : s.name,
                  value: s.assets,
                  series: 1,
                }))}
              />
            )}
            {d.park.withoutSector > 0 && (
              <p className="mt-3 text-xs text-muted">
                {d.park.withoutSector} {d.park.withoutSector === 1 ? 'equipamento' : 'equipamentos'} sem setor
                —{' '}
                <Link to="/ativos" className="text-accent-text underline-offset-2 hover:underline">
                  revisar cadastro
                </Link>
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Produtividade" description="OS concluídas por responsável no período." />
          <div className="px-4 pb-4">
            {prod.length === 0 ? (
              <Vazio texto="Nenhuma OS concluída com responsável no período." />
            ) : (
              <BarChart
                label="OS concluídas por responsável"
                data={prod
                  .slice(0, 8)
                  .map((p) => ({ label: p.name ?? 'Sem nome', value: p.completed, series: 3 }))}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Idade do backlog" description="Há quanto tempo as OS em aberto esperam." />
          <div className="px-4 pb-4">
            {k.backlog.data.count === 0 ? (
              <Vazio texto="Backlog zerado." />
            ) : (
              <BarChart
                label="Backlog por faixa de idade"
                data={[
                  { label: 'até 7 dias', value: k.backlog.data.buckets['0-7'] ?? 0, tone: 'good' },
                  { label: '8 a 30 dias', value: k.backlog.data.buckets['8-30'] ?? 0, tone: 'info' },
                  { label: '31 a 90 dias', value: k.backlog.data.buckets['31-90'] ?? 0, tone: 'warn' },
                  { label: 'mais de 90 dias', value: k.backlog.data.buckets['90+'] ?? 0, tone: 'bad' },
                ]}
              />
            )}
          </div>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Gauge className="size-3.5" aria-hidden="true" />
        Definições completas de cada indicador em{' '}
        <Link to="/indicadores" className="text-accent-text underline-offset-2 hover:underline">
          Indicadores detalhados
        </Link>
        . Atualizado{' '}
        {new Date(d.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
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
  const corpo = (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn('flex size-7 items-center justify-center rounded-control', ACENTO[tom])}
          aria-hidden="true"
        >
          {icone}
        </span>
        <span className="text-xs font-medium tracking-wide text-muted uppercase">{rotulo}</span>
      </div>
      <p className="flex items-baseline gap-1">
        <span data-numeric className="text-3xl font-semibold tracking-display text-text tabular-nums">
          {nulo ? '—' : typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        </span>
        {!nulo && unidade && <span className="text-sm text-muted">{unidade}</span>}
      </p>
      {serie && serie.length > 1 && serie.some((v) => v > 0) && (
        <Sparkline values={serie} label={`Tendência de ${rotulo}`} goodDirection={direcaoBoa} height={28} />
      )}
      <p className="mt-auto text-xs text-subtle">{nulo && vazio ? vazio : dica}</p>
    </div>
  );
  return (
    <Card className="overflow-hidden">
      {link ? (
        <Link to={link} className="block h-full transition-colors hover:bg-surface-hover">
          {corpo}
        </Link>
      ) : (
        corpo
      )}
    </Card>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-control border border-dashed border-border-subtle px-4 text-center text-sm text-muted">
      {texto}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando o painel</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-card lg:col-span-2" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
