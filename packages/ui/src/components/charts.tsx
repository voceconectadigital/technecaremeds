/**
 * Aurora — gráficos (SPEC v0.2 §25, §26, §40).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SVG À MÃO, E NÃO UMA BIBLIOTECA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Os gráficos deste produto são três: barra, rosca e linha de tendência. São
 * poucos, são simples, e nenhum precisa de zoom, de pan, de tooltip flutuante
 * nem de animação. Uma biblioteca de gráficos custa 40–150 kB comprimidos e
 * traz o próprio sistema de temas, que discorda do nosso na primeira cor.
 *
 * Aqui eles saem em SVG estático, leem os tokens (`--color-data-*`), e pesam o
 * que pesa o markup. O aplicativo de campo funciona offline: cada kilobyte é
 * um kilobyte que precisa ter descido antes de a pessoa entrar no elevador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GRÁFICO NÃO É IMAGEM: É DADO COM FORMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Todo gráfico daqui tem os valores em TEXTO — na legenda, no rótulo da barra
 * ou numa tabela só para leitor de tela. Um `<svg>` sem alternativa textual é
 * uma informação que simplesmente não existe para quem não enxerga, e num
 * painel operacional isso é a metade da tela.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChartDatum {
  label: string;
  value: number;
  /** 1 a 6, da paleta de dados. Sem isso, entra na ordem. */
  series?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Sobrescreve a cor: use para estado (atrasado = crítico), não para enfeite. */
  tone?: 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';
}

const COR_DE_SERIE = [
  'var(--color-data-1)',
  'var(--color-data-2)',
  'var(--color-data-3)',
  'var(--color-data-4)',
  'var(--color-data-5)',
  'var(--color-data-6)',
];

const COR_DE_TOM: Record<NonNullable<ChartDatum['tone']>, string> = {
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
  info: 'var(--color-info)',
  accent: 'var(--color-accent)',
  neutral: 'var(--color-border-strong)',
};

function corDe(d: ChartDatum, i: number): string {
  if (d.tone) return COR_DE_TOM[d.tone];
  return COR_DE_SERIE[((d.series ?? i + 1) - 1) % COR_DE_SERIE.length]!;
}

/* -------------------------------------------------------------------------- */
/* barras horizontais                                                         */
/* -------------------------------------------------------------------------- */

export interface BarChartProps {
  data: ChartDatum[];
  /** Título acessível do gráfico. */
  label: string;
  /** Formata o valor exibido ao lado da barra. */
  format?: (v: number) => string;
  /** Acima disso, agrupa o resto em "outros". */
  maxItems?: number;
  /**
   * `stacked`: rótulo e valor numa linha, barra fina embaixo — para cartão
   * de painel com altura para preencher. `inline` (padrão) é o compacto.
   */
  layout?: 'inline' | 'stacked';
  className?: string;
}

/**
 * Barras HORIZONTAIS, e essa escolha não é estética.
 *
 * Os rótulos deste domínio são frases — "Aguardando peça do fabricante",
 * "Preventiva trimestral de ventiladores". Em barra vertical eles viram texto
 * de 45 graus, que ninguém lê, ou reticências, que escondem justamente o que
 * distingue uma barra da outra.
 */
export function BarChart({
  data,
  label,
  format = String,
  maxItems = 8,
  layout = 'inline',
  className,
}: BarChartProps) {
  const ordenado = [...data].sort((a, b) => b.value - a.value);
  const visiveis = ordenado.slice(0, maxItems);
  const resto = ordenado.slice(maxItems);
  if (resto.length > 0) {
    visiveis.push({
      label: `outros (${resto.length})`,
      value: resto.reduce((s, d) => s + d.value, 0),
      tone: 'neutral',
    });
  }

  // O máximo é o da maior barra, nunca a soma: com a soma, uma distribuição
  // equilibrada vira oito barras minúsculas e o gráfico não diz nada.
  const maximo = Math.max(...visiveis.map((d) => d.value), 1);

  if (layout === 'stacked') {
    return (
      <div className={cn('flex flex-col gap-4', className)} role="img" aria-label={label}>
        {visiveis.map((d, i) => (
          <div key={d.label} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-text" title={d.label}>
                {d.label}
              </span>
              <span data-numeric className="shrink-0 font-bold tabular-nums text-text">
                {format(d.value)}
              </span>
            </span>
            <span className="relative h-2 overflow-hidden rounded-pill bg-surface-sunken">
              <span
                className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-normal"
                style={{
                  width: `${Math.max((d.value / maximo) * 100, d.value > 0 ? 2 : 0)}%`,
                  backgroundColor: corDe(d, i),
                }}
              />
            </span>
          </div>
        ))}
        <TabelaParaLeitor label={label} data={visiveis} format={format} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} role="img" aria-label={label}>
      {visiveis.map((d, i) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-2/5 shrink-0 truncate text-sm text-muted" title={d.label}>
            {d.label}
          </span>
          <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-control bg-surface-sunken">
            <span
              className="absolute inset-y-0 left-0 rounded-control transition-[width] duration-normal"
              style={{
                width: `${Math.max((d.value / maximo) * 100, d.value > 0 ? 2 : 0)}%`,
                backgroundColor: corDe(d, i),
              }}
            />
          </span>
          <span
            data-numeric
            className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-text"
          >
            {format(d.value)}
          </span>
        </div>
      ))}
      <TabelaParaLeitor label={label} data={visiveis} format={format} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* rosca                                                                      */
/* -------------------------------------------------------------------------- */

export interface DonutChartProps {
  data: ChartDatum[];
  label: string;
  /** O que aparece no meio. Normalmente o total. */
  centerValue?: ReactNode;
  centerLabel?: string;
  size?: number;
  className?: string;
}

/**
 * Rosca, e só para composição de um todo — nunca para comparar grandezas.
 *
 * Olho humano compara comprimento bem e ângulo mal. Ela está aqui porque
 * responde uma pergunta específica e comum: "deste total, quanto é de cada
 * tipo?" — e porque o buraco do meio é o melhor lugar do painel para o total.
 */
export function DonutChart({
  data,
  label,
  centerValue,
  centerLabel,
  size = 132,
  className,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const raio = size / 2 - 10;
  const circunferencia = 2 * Math.PI * raio;

  let acumulado = 0;

  return (
    <div className={cn('flex items-center gap-5', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          {/* O anel de trilho: sem ele, um total baixo fica boiando no vazio. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={raio}
            fill="none"
            stroke="var(--color-surface-sunken)"
            strokeWidth={14}
          />
          {total > 0 &&
            data.map((d, i) => {
              const fracao = d.value / total;
              const traco = fracao * circunferencia;
              const deslocamento = acumulado * circunferencia;
              acumulado += fracao;
              return (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={raio}
                  fill="none"
                  stroke={corDe(d, i)}
                  strokeWidth={14}
                  strokeDasharray={`${traco} ${circunferencia - traco}`}
                  strokeDashoffset={-deslocamento}
                  // Começa no topo: uma rosca que começa às 3 horas obriga a
                  // pessoa a procurar onde a leitura principia.
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
        </svg>
        {(centerValue !== undefined || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span data-numeric className="text-xl font-semibold tabular-nums text-text">
              {centerValue}
            </span>
            {centerLabel && <span className="text-2xs text-muted">{centerLabel}</span>}
          </div>
        )}
      </div>

      <ul className="flex min-w-0 flex-col gap-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: corDe(d, i) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">{d.label}</span>
            <span data-numeric className="font-semibold tabular-nums text-text">
              {d.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* linha de tendência                                                         */
/* -------------------------------------------------------------------------- */

export interface SparklineProps {
  values: number[];
  label: string;
  /** Subir é bom? Decide a cor da área. */
  goodDirection?: 'up' | 'down';
  height?: number;
  className?: string;
}

/**
 * A minilinha que mora dentro de um cartão de indicador.
 *
 * Sem eixo, sem grade, sem rótulo: ela não responde "quanto", responde "para
 * onde". O "quanto" é o número grande ao lado, e repetir a escala aqui roubaria
 * espaço da única coisa que a linha faz bem.
 */
export function Sparkline({ values, label, goodDirection = 'up', height = 36, className }: SparklineProps) {
  if (values.length < 2) return null;

  const largura = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const amplitude = max - min || 1;

  const pontos = values.map((v, i) => {
    const x = (i / (values.length - 1)) * largura;
    // Invertido: no SVG o y cresce para baixo, e um gráfico de cabeça para
    // baixo é o erro mais fácil de cometer aqui e mais difícil de notar.
    const y = height - ((v - min) / amplitude) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const subiu = values[values.length - 1]! >= values[0]!;
  const cor = subiu === (goodDirection === 'up') ? 'var(--color-good)' : 'var(--color-bad)';

  return (
    <svg
      viewBox={`0 0 ${largura} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${values.join(', ')}`}
      className={cn('block', className)}
    >
      <polygon points={`0,${height} ${pontos.join(' ')} ${largura},${height}`} fill={cor} opacity="0.1" />
      <polyline
        points={pontos.join(' ')}
        fill="none"
        stroke={cor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A alternativa textual dos gráficos de barra.
 *
 * Uma tabela de verdade, escondida visualmente. `aria-label` no `<svg>` diz o
 * que o gráfico É; esta tabela diz o que ele CONTÉM — e é a diferença entre
 * "gráfico de tempo por motivo de espera" e poder saber que "aguardando peça"
 * tem 14.
 */
function TabelaParaLeitor({
  label,
  data,
  format,
}: {
  label: string;
  data: ChartDatum[];
  format: (v: number) => string;
}) {
  return (
    <div className="aurora-sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
