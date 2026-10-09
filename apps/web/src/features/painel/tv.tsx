/**
 * Aurora — Modo Exibição: o Painel de Controle numa televisão.
 *
 * FEITO PARA SER LIDO A TRÊS METROS.
 *
 * Sem barra lateral, sem menu, sem nada clicável além de "tela cheia" e
 * "sair". Números grandes, gráficos com traço grosso e texto de 15px nos
 * eixos, 16:9 sem rolagem. Atualiza sozinho a cada minuto — a televisão do
 * corredor não tem quem aperte F5 — e diz há quanto tempo atualizou, para
 * ninguém tomar decisão sobre um número congelado.
 *
 * Os dados são a MESMA resposta do painel, com os mesmos filtros da URL: o
 * que estava na tela de quem clicou "Modo Exibição" é o que vai para a TV.
 * Configuração fixa, de propósito — editor de painel não é escopo desta tela.
 *
 * ESC (ou o botão) volta ao painel.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { BarChart, DonutChart, Logo, RateRing, TrendChart, cn, type Tone } from '@aurora/ui';
import { MARCA } from '@aurora/app-kit';
import type { ControlPanel } from '@aurora/contracts';
import { ErrorScreen } from '../../shell/error-boundary';
import { buscaDoPainel, disponibilidadeAgora, rotuloDoRecorte, usePainel, useFiltrosDoPainel } from './dados';
import { PERIODOS, formatarDuracao, rotuloDaFatia } from './rotulos';

const ATUALIZAR_MS = 60_000;

function useAgora(passoMs: number): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), passoMs);
    return () => clearInterval(t);
  }, [passoMs]);
  return agora;
}

export function ModoExibicaoPage() {
  const filtros = useFiltrosDoPainel();
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt, problema } = usePainel(filtros, {
    refetchMs: ATUALIZAR_MS,
  });
  const navigate = useNavigate();
  const agora = useAgora(15_000);
  const [cheia, setCheia] = useState(false);

  const sair = () =>
    void navigate({
      to: '/painel',
      search: buscaDoPainel(filtros) as never,
    });

  useEffect(() => {
    document.title = `Modo Exibição · ${MARCA.produto}`;
    const tecla = (e: KeyboardEvent) => {
      // Em tela cheia o navegador consome o primeiro ESC para sair dela.
      if (e.key === 'Escape' && !document.fullscreenElement) sair();
    };
    const mudou = () => setCheia(Boolean(document.fullscreenElement));
    document.addEventListener('keydown', tecla);
    document.addEventListener('fullscreenchange', mudou);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('fullscreenchange', mudou);
    };
  });

  if (isError) return <ErrorScreen error={error} />;

  const alternarTelaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const periodo =
    filtros.periodo === 'custom'
      ? `${filtros.de.split('-').reverse().join('/')} a ${filtros.ate.split('-').reverse().join('/')}`
      : `últimos ${PERIODOS.find((p) => p.valor === filtros.periodo)?.rotulo ?? '30 dias'}`;
  const desde = dataUpdatedAt ? Math.max(0, Math.round((agora.getTime() - dataUpdatedAt) / 60_000)) : null;

  return (
    <div
      className="flex min-h-dvh w-full flex-col gap-4 bg-bg p-4 text-text lg:h-dvh lg:overflow-hidden lg:p-6"
      data-modo-exibicao
    >
      <header className="flex items-center gap-4">
        <Logo
          src={MARCA.logoHorizontal}
          srcEscuro={MARCA.logoHorizontalEscuro}
          nome={MARCA.produto}
          largura={150}
        />
        <div className="min-w-0 flex-1 border-l border-border pl-4">
          <h1 className="truncate text-2xl font-semibold tracking-display lg:text-3xl">Painel de Controle</h1>
          <p className="truncate text-sm text-muted lg:text-base">
            {data ? `${rotuloDoRecorte(data, filtros.cliente, filtros.setor)} · ` : ''}
            {periodo}
          </p>
        </div>
        <div className="hidden text-right sm:block" aria-live="off">
          <p data-numeric className="text-3xl font-semibold tabular-nums lg:text-4xl">
            {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-xs text-muted lg:text-sm">{dataPorExtenso(agora)}</p>
        </div>
        <div className="flex items-center gap-1">
          <BotaoTv rotulo={cheia ? 'Sair da tela cheia' : 'Tela cheia'} onClick={alternarTelaCheia}>
            {cheia ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </BotaoTv>
          <BotaoTv rotulo="Sair do Modo Exibição (Esc)" onClick={sair}>
            <X className="size-5" />
          </BotaoTv>
        </div>
      </header>

      {problema ? (
        <p className="flex flex-1 items-center justify-center text-xl text-muted">{problema}</p>
      ) : isLoading || !data ? (
        <div aria-busy="true" className="grid flex-1 grid-cols-3 gap-4 lg:grid-cols-6">
          <span className="sr-only">Carregando o painel</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-card bg-surface-sunken" />
          ))}
        </div>
      ) : (
        <Corpo d={data} />
      )}

      <footer className="flex items-center justify-between text-xs text-subtle lg:text-sm">
        <span className="flex items-center gap-1.5">
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
          {desde === null ? 'carregando…' : desde === 0 ? 'atualizado agora' : `atualizado há ${desde} min`} ·
          atualiza sozinho a cada minuto
        </span>
        <span>Esc para sair</span>
      </footer>
    </div>
  );
}

/** "Sexta-feira, 09 de outubro" — maiúscula só na primeira letra. */
function dataPorExtenso(d: Date): string {
  const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function BotaoTv({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className="flex size-11 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  );
}

/**
 * A altura que sobra para o gráfico, medida no próprio contêiner.
 *
 * A TV tem altura fixa (16:9) e o gráfico precisa caber nela sem rolagem: em
 * vez de adivinhar quanto ocupam cabeçalho, números e títulos, o painel mede
 * o espaço que recebeu do grid e entrega esse número ao gráfico.
 */
function Medido({ children, minimo = 140 }: { children: (altura: number) => ReactNode; minimo?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAltura(Math.floor(el.getBoundingClientRect().height));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="min-h-40 flex-1 overflow-hidden lg:min-h-0">
      {altura > 0 && children(Math.max(minimo, altura))}
    </div>
  );
}

function Corpo({ d }: { d: ControlPanel }) {
  const k = d.kpis;
  const rotulos = d.series.map((p) => rotuloDaFatia(p.start, d.granularity));
  const mttr = formatarDuracao(k.mttr.data.value);
  const tomSla: Tone =
    k.sla.data.rate === null
      ? 'neutral'
      : k.sla.data.rate >= 90
        ? 'good'
        : k.sla.data.rate >= 75
          ? 'warn'
          : 'bad';

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
        <Numero rotulo="Abertos" valor={k.opened.data.count} tom="info" />
        <Numero rotulo="Concluídos" valor={k.completed.data.count} tom="good" />
        <Numero
          rotulo="Backlog"
          valor={k.backlog.data.count}
          tom={k.backlog.data.count > 0 ? 'warn' : 'neutral'}
        />
        <Numero rotulo="MTTR" valor={mttr.valor} unidade={mttr.unidade} tom="info" />
        <Numero rotulo="SLA" valor={k.sla.data.rate} unidade="%" tom={tomSla} />
        <Numero
          rotulo="Disponíveis"
          valor={disponibilidadeAgora(d.park.byStatus).taxa}
          unidade="%"
          tom="accent"
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-2">
        <Painel titulo="Abertos × concluídos" className="lg:col-span-2">
          <Medido>
            {(h) => (
              <TrendChart
                scale="tv"
                height={h - 36}
                label="Ordens abertas e concluídas por período"
                labels={rotulos}
                series={[
                  { key: 'a', label: 'Abertos', values: d.series.map((p) => p.opened), series: 1 },
                  { key: 'c', label: 'Concluídos', values: d.series.map((p) => p.completed), series: 2 },
                ]}
              />
            )}
          </Medido>
        </Painel>
        <Painel titulo="Prazos">
          <Medido>
            {(h) => {
              const tam = Math.min(170, Math.max(96, h - 40));
              return (
                <div className="flex h-full items-center justify-around gap-2">
                  <RateRing
                    value={k.sla.data.rate}
                    label="SLA cumprido"
                    tone="info"
                    size={tam}
                    caption="SLA cumprido"
                  />
                  <RateRing
                    value={k.plan_compliance.data.rate}
                    label="Preventivas em dia"
                    tone="good"
                    size={tam}
                    caption="Preventivas em dia"
                  />
                </div>
              );
            }}
          </Medido>
        </Painel>

        <Painel titulo="Backlog">
          <Medido>
            {(h) => (
              <TrendChart
                scale="tv"
                height={h - 10}
                label="Backlog por período"
                labels={rotulos}
                series={[
                  {
                    key: 'b',
                    label: 'Backlog',
                    values: d.series.map((p) => p.backlog),
                    tone: 'warn',
                    area: true,
                  },
                ]}
              />
            )}
          </Medido>
        </Painel>
        <Painel titulo="Disponibilidade do parque (agora)">
          <Medido>
            {(h) => {
              const disp = disponibilidadeAgora(d.park.byStatus);
              return disp.base === 0 ? (
                <p className="text-muted">Nenhum equipamento no recorte.</p>
              ) : (
                <div className="flex h-full items-center">
                  <DonutChart
                    size={Math.min(200, Math.max(110, h - 8))}
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
                </div>
              );
            }}
          </Medido>
        </Painel>
        <Painel titulo="Equipamentos por setor">
          <Medido>
            {(h) =>
              d.park.bySector.length === 0 ? (
                <p className="text-muted">Nenhum equipamento ligado a um setor.</p>
              ) : (
                <BarChart
                  label="Equipamentos por setor"
                  // Cada barra precisa de ~30px: o número de barras segue a altura.
                  maxItems={Math.max(3, Math.min(8, Math.floor(h / 30) - 1))}
                  data={d.park.bySector.map((s) => ({ label: s.name, value: s.assets, series: 1 }))}
                />
              )
            }
          </Medido>
        </Painel>
      </div>
    </main>
  );
}

const COR: Record<Tone, string> = {
  neutral: 'before:bg-border-strong',
  accent: 'before:bg-accent',
  good: 'before:bg-good',
  warn: 'before:bg-warn',
  bad: 'before:bg-bad',
  info: 'before:bg-info',
};

function Numero({
  rotulo,
  valor,
  unidade,
  tom,
}: {
  rotulo: string;
  valor: number | string | null;
  unidade?: string;
  tom: Tone;
}) {
  const nulo = valor === null || valor === undefined;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border border-border bg-surface px-4 py-3 shadow-card lg:px-5',
        'before:absolute before:inset-x-0 before:top-0 before:h-1',
        COR[tom]
      )}
    >
      <p className="text-sm font-medium tracking-wide text-muted uppercase lg:text-base">{rotulo}</p>
      <p className="flex items-baseline gap-1.5">
        <span data-numeric className="text-4xl font-semibold tracking-display tabular-nums xl:text-6xl">
          {nulo ? '—' : typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        </span>
        {!nulo && unidade && <span className="text-lg text-muted lg:text-2xl">{unidade}</span>}
      </p>
    </div>
  );
}

function Painel({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col gap-2 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card',
        className
      )}
    >
      <h2 className="text-lg font-semibold text-text lg:text-xl">{titulo}</h2>
      {children}
    </section>
  );
}
