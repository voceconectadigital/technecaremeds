/**
 * Aurora — gráficos ao longo do tempo (Painel de Controle, planos, Modo Exibição).
 *
 * Mesma regra de `charts.tsx`: SVG à mão, tokens do tema, valor em TEXTO
 * sempre (legenda, tooltip e tabela para leitor de tela). O que estes dois
 * acrescentam é a dimensão que faltava ao produto — o tempo.
 *
 *   · `TrendChart`   — linhas (uma a quatro séries) sobre fatias do período,
 *                       com cursor vertical e dica no passar do mouse;
 *   · `ColumnChart`  — colunas empilhadas por fatia (realizado × pendente ×
 *                       vencido), com dica por coluna.
 *
 * UM EIXO SÓ. Duas grandezas de escala diferente nunca dividem o mesmo
 * gráfico: viram dois gráficos. Cor de série é IDENTIDADE (paleta de dados);
 * cor de ESTADO (vencido = crítico) vem por `tone`, e sempre com rótulo.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

type Tom = 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';

const COR_DE_SERIE = [
  'var(--color-data-1)',
  'var(--color-data-2)',
  'var(--color-data-3)',
  'var(--color-data-4)',
  'var(--color-data-5)',
  'var(--color-data-6)',
];
const COR_DE_TOM: Record<Tom, string> = {
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
  info: 'var(--color-info)',
  accent: 'var(--color-accent)',
  neutral: 'var(--color-border-strong)',
};

export interface TimeSeries {
  key: string;
  label: string;
  /**
   * Um valor por fatia. `null` = fatia SEM AMOSTRA: a linha se interrompe ali
   * e a dica diz "sem dados" — nunca vira zero (zero de MTTR seria "reparo
   * instantâneo").
   */
  values: Array<number | null>;
  /** 1 a 6 (paleta de dados). Cor segue a SÉRIE, nunca a posição. */
  series?: 1 | 2 | 3 | 4 | 5 | 6;
  tone?: Tom;
  /** Preenche a área sob a linha (use em uma série só). */
  area?: boolean;
  dashed?: boolean;
}

function corDaSerie(s: { series?: number; tone?: Tom }, i: number): string {
  if (s.tone) return COR_DE_TOM[s.tone];
  return COR_DE_SERIE[((s.series ?? i + 1) - 1) % COR_DE_SERIE.length]!;
}

/** Largura real do contêiner: o SVG desenha em pixels, sem esticar texto. */
function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setW(Math.floor(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Escala do eixo: passo "redondo" e INTEIRO (contagens não têm 1,3 chamado),
 * com no máximo ~4 divisões. Devolve o topo e as marcas.
 */
function escalaDoEixo(max: number): { topo: number; marcas: number[] } {
  const bruto = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  let passo = mag;
  for (const m of [1, 2, 5, 10]) {
    if (m * mag >= bruto) {
      passo = m * mag;
      break;
    }
  }
  passo = Math.max(1, Math.round(passo));
  const topo = Math.max(passo, Math.ceil(Math.max(max, 1) / passo) * passo);
  const marcas: number[] = [];
  for (let v = 0; v <= topo; v += passo) marcas.push(v);
  return { topo, marcas };
}

/**
 * Curva monotônica (Fritsch–Carlson): suaviza sem "inventar" — nunca passa
 * acima do maior vizinho nem abaixo de zero, que é o defeito da Catmull-Rom
 * comum num gráfico de contagem.
 */
function caminhoSuave(p: Array<[number, number]>): string {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const n = p.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1]![1] - p[i]![1]) / (p[i + 1]![0] - p[i]![0]));
  m.push(d[0]!);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  let out = `M${p[0]![0].toFixed(1)},${p[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[i + 1]!;
    const h = (x1 - x0) / 3;
    out += ` C${(x0 + h).toFixed(1)},${(y0 + m[i]! * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1]! * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return out;
}

function Legenda({ itens }: { itens: Array<{ label: string; cor: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {itens.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('inline-block', i.dashed ? 'h-0.5 w-3.5' : 'size-2 rounded-full')}
            style={{
              backgroundColor: i.dashed ? 'transparent' : i.cor,
              borderTop: i.dashed ? `2px dashed ${i.cor}` : undefined,
            }}
          />
          <span className="font-medium">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

function TabelaLeitor({
  label,
  rotulos,
  colunas,
}: {
  label: string;
  rotulos: string[];
  colunas: Array<{ label: string; values: Array<number | null> }>;
}) {
  return (
    <div className="aurora-sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            {colunas.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rotulos.map((r, i) => (
            <tr key={r + i}>
              <th scope="row">{r}</th>
              {colunas.map((c) => (
                <td key={c.label}>{c.values[i] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Quais rótulos do eixo X cabem sem colidir: no máximo um a cada ~64px. */
function rotulosVisiveis(n: number, largura: number): Set<number> {
  const cabem = Math.max(2, Math.floor(largura / 64));
  const passo = Math.max(1, Math.ceil(n / cabem));
  const s = new Set<number>();
  for (let i = 0; i < n; i += passo) s.add(i);
  // O último sempre aparece (é o "agora"); o vizinho perto demais sai.
  const anterior = Math.floor((n - 1) / passo) * passo;
  if (anterior !== n - 1 && n - 1 - anterior < passo * 0.75) s.delete(anterior);
  s.add(n - 1);
  return s;
}

/* -------------------------------------------------------------------------- */
/* linhas                                                                      */
/* -------------------------------------------------------------------------- */

export interface TrendChartProps {
  /** Rótulo de cada fatia (eixo X), na ordem das séries. */
  labels: string[];
  series: TimeSeries[];
  /** Título acessível. */
  label: string;
  height?: number;
  format?: (v: number) => string;
  /** Tamanho do texto: `tv` para o Modo Exibição. */
  scale?: 'md' | 'tv';
  className?: string;
  emptyMessage?: ReactNode;
}

export function TrendChart({
  labels,
  series,
  label,
  height = 220,
  format = (v) => String(v),
  scale = 'md',
  className,
  emptyMessage = 'Sem dados no período.',
}: TrendChartProps) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const idBase = useId().replace(/:/g, '');
  const tv = scale === 'tv';
  const fonte = tv ? 15 : 11;
  const margem = { top: 12, right: 12, bottom: tv ? 30 : 24, left: tv ? 48 : 32 };
  const n = labels.length;
  const numeros = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const { topo: max, marcas: grades } = escalaDoEixo(Math.max(0, ...numeros));
  const vazio = n === 0 || numeros.every((v) => v === 0);

  const w = Math.max(largura - margem.left - margem.right, 10);
  const h = height - margem.top - margem.bottom;
  const x = (i: number) => margem.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => margem.top + h - (v / max) * h;
  const visiveis = useMemo(() => rotulosVisiveis(n, w), [n, w]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {series.length > 1 && (
        <Legenda
          itens={series.map((s, i) => ({ label: s.label, cor: corDaSerie(s, i), dashed: s.dashed }))}
        />
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {vazio ? (
          <div className="flex h-full items-center justify-center rounded-control bg-surface-subtle text-sm text-muted">
            {emptyMessage}
          </div>
        ) : largura > 0 ? (
          <svg
            width={largura}
            height={height}
            role="img"
            aria-label={label}
            onMouseLeave={() => setFoco(null)}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = e.clientX - r.left - margem.left;
              const i = n <= 1 ? 0 : Math.round((px / w) * (n - 1));
              setFoco(Math.min(n - 1, Math.max(0, i)));
            }}
          >
            <defs>
              {series.map((s, si) => (
                <linearGradient key={s.key} id={`${idBase}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={corDaSerie(s, si)} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={corDaSerie(s, si)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {grades.map((g) => (
              <g key={g}>
                <line
                  x1={margem.left}
                  x2={margem.left + w}
                  y1={y(g)}
                  y2={y(g)}
                  stroke={g === 0 ? 'var(--color-border)' : 'var(--color-border-subtle)'}
                  strokeWidth={1}
                  strokeDasharray={g === 0 ? undefined : '2 4'}
                />
                <text
                  x={margem.left - 6}
                  y={y(g)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={fonte}
                  fill="var(--color-subtle)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {format(g)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              visiveis.has(i) ? (
                <text
                  key={l + i}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
                  fontSize={fonte}
                  fill="var(--color-subtle)"
                >
                  {l}
                </text>
              ) : null
            )}
            {series.map((s, si) => {
              const cor = corDaSerie(s, si);
              // Trechos contínuos: uma fatia sem amostra interrompe a linha.
              const trechos: Array<Array<[number, number]>> = [];
              let atual: Array<[number, number]> = [];
              s.values.forEach((v, i) => {
                if (v === null) {
                  if (atual.length) trechos.push(atual);
                  atual = [];
                } else atual.push([i, v]);
              });
              if (atual.length) trechos.push(atual);
              return (
                <g key={s.key}>
                  {trechos.map((t) => {
                    const curva = caminhoSuave(t.map(([i, v]) => [x(i), y(v)] as [number, number]));
                    const ultimo = t[t.length - 1]!;
                    return (
                      <g key={t[0]![0]}>
                        {s.area && t.length > 1 && (
                          <path
                            d={`${curva} L${x(ultimo[0]).toFixed(1)},${y(0)} L${x(t[0]![0]).toFixed(1)},${y(0)} Z`}
                            fill={`url(#${idBase}-g${si})`}
                          />
                        )}
                        {t.length > 1 ? (
                          <>
                            <path
                              d={curva}
                              fill="none"
                              stroke={cor}
                              strokeWidth={tv ? 3 : 2.25}
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              strokeDasharray={s.dashed ? '5 4' : undefined}
                            />
                            {/* O último ponto marcado: "onde estamos agora". */}
                            <circle
                              cx={x(ultimo[0])}
                              cy={y(ultimo[1])}
                              r={tv ? 4.5 : 3.5}
                              fill={cor}
                              stroke="var(--color-surface)"
                              strokeWidth={2}
                            />
                          </>
                        ) : (
                          // Ponto isolado: sem vizinho, a linha não teria comprimento.
                          <circle cx={x(t[0]![0])} cy={y(t[0]![1])} r={3.5} fill={cor} />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {foco !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(foco)}
                  x2={x(foco)}
                  y1={margem.top}
                  y2={margem.top + h}
                  stroke="var(--color-border-strong)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {series.map((s, si) =>
                  s.values[foco] === null || s.values[foco] === undefined ? null : (
                    <circle
                      key={s.key}
                      cx={x(foco)}
                      cy={y(s.values[foco] as number)}
                      r={4.5}
                      fill={corDaSerie(s, si)}
                      stroke="var(--color-surface)"
                      strokeWidth={2}
                    />
                  )
                )}
              </g>
            )}
          </svg>
        ) : null}
        {foco !== null && !vazio && largura > 0 && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-[10px] px-3 py-2.5 text-xs shadow-overlay"
            style={{
              left: Math.min(Math.max(x(foco) + 12, 0), Math.max(largura - 172, 0)),
              backgroundColor: 'var(--aurora-neutral-900)',
              color: 'var(--aurora-neutral-0)',
            }}
          >
            <p className="mb-1.5 font-semibold" style={{ color: 'var(--aurora-neutral-0)' }}>
              {labels[foco]}
            </p>
            {series.map((s, si) => (
              <p
                key={s.key}
                className="flex items-center gap-2"
                style={{ color: 'var(--aurora-neutral-300)' }}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: corDaSerie(s, si) }}
                />
                <span className="flex-1">{s.label}</span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--aurora-neutral-0)' }}>
                  {s.values[foco] === null || s.values[foco] === undefined
                    ? 'sem dados'
                    : format(s.values[foco] as number)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
      <TabelaLeitor
        label={label}
        rotulos={labels}
        colunas={series.map((s) => ({ label: s.label, values: s.values }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* colunas empilhadas                                                          */
/* -------------------------------------------------------------------------- */

export interface ColumnSegment {
  key: string;
  label: string;
  values: number[];
  series?: 1 | 2 | 3 | 4 | 5 | 6;
  tone?: Tom;
}

export interface ColumnChartProps {
  labels: string[];
  segments: ColumnSegment[];
  label: string;
  height?: number;
  scale?: 'md' | 'tv';
  className?: string;
  emptyMessage?: ReactNode;
}

/**
 * Colunas empilhadas: composição por fatia ("deste mês, quanto foi feito,
 * quanto está pendente, quanto venceu"). Fatias do TEMPO no eixo X, por isso
 * vertical — rótulo curto ("mai/26") cabe na base sem girar.
 */
export function ColumnChart({
  labels,
  segments,
  label,
  height = 220,
  scale = 'md',
  className,
  emptyMessage = 'Sem dados no período.',
}: ColumnChartProps) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const id = useId();
  const tv = scale === 'tv';
  const fonte = tv ? 15 : 11;
  const margem = { top: 10, right: 8, bottom: tv ? 30 : 22, left: tv ? 44 : 32 };
  const n = labels.length;
  const totais = labels.map((_, i) => segments.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const { topo: max, marcas } = escalaDoEixo(Math.max(0, ...totais));
  const vazio = n === 0 || totais.every((t) => t === 0);

  const w = Math.max(largura - margem.left - margem.right, 10);
  const h = height - margem.top - margem.bottom;
  const banda = w / Math.max(n, 1);
  const larguraBarra = Math.min(Math.max(banda * 0.62, 4), tv ? 72 : 44);
  const y = (v: number) => (v / max) * h;
  const visiveis = useMemo(() => rotulosVisiveis(n, w), [n, w]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Legenda itens={segments.map((s, i) => ({ label: s.label, cor: corDaSerie(s, i) }))} />
      <div ref={ref} className="relative w-full" style={{ height }}>
        {vazio ? (
          <div className="flex h-full items-center justify-center rounded-control bg-surface-subtle text-sm text-muted">
            {emptyMessage}
          </div>
        ) : largura > 0 ? (
          <svg
            width={largura}
            height={height}
            role="img"
            aria-label={label}
            onMouseLeave={() => setFoco(null)}
          >
            <defs>
              <clipPath id={`${id}-topo`}>
                <rect x={0} y={0} width={largura} height={margem.top + h} />
              </clipPath>
            </defs>
            {marcas.map((m) => (
              <g key={m}>
                <line
                  x1={margem.left}
                  x2={margem.left + w}
                  y1={margem.top + h - y(m)}
                  y2={margem.top + h - y(m)}
                  stroke="var(--color-border-subtle)"
                />
                <text
                  x={margem.left - 6}
                  y={margem.top + h - y(m)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={fonte}
                  fill="var(--color-subtle)"
                >
                  {m}
                </text>
              </g>
            ))}
            {labels.map((l, i) => {
              const cx = margem.left + banda * i + banda / 2;
              let acumulado = 0;
              return (
                <g key={l + i} onMouseEnter={() => setFoco(i)}>
                  {/* Alvo maior que a barra: passar o mouse não exige pontaria. */}
                  <rect
                    x={margem.left + banda * i}
                    y={margem.top}
                    width={banda}
                    height={h}
                    fill="transparent"
                  />
                  {segments.map((s, si) => {
                    const v = s.values[i] ?? 0;
                    if (v <= 0) return null;
                    const altura = y(v);
                    const topo = margem.top + h - acumulado - altura;
                    acumulado += altura;
                    return (
                      <rect
                        key={s.key}
                        x={cx - larguraBarra / 2}
                        y={topo}
                        width={larguraBarra}
                        // 2px de superfície entre segmentos: o empilhamento se lê sem cor.
                        height={Math.max(altura - 2, 1)}
                        rx={2}
                        fill={corDaSerie(s, si)}
                        opacity={foco === null || foco === i ? 1 : 0.45}
                        clipPath={`url(#${id}-topo)`}
                      />
                    );
                  })}
                  {visiveis.has(i) && (
                    <text
                      x={cx}
                      y={height - 6}
                      textAnchor="middle"
                      fontSize={fonte}
                      fill="var(--color-subtle)"
                    >
                      {l}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : null}
        {foco !== null && !vazio && largura > 0 && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-control border border-border bg-surface-raised px-3 py-2 text-xs shadow-raised"
            style={{
              left: Math.min(
                Math.max(margem.left + banda * foco + banda / 2 + 12, 0),
                Math.max(largura - 160, 0)
              ),
            }}
          >
            <p className="mb-1 font-semibold text-text">
              {labels[foco]} · {totais[foco]}
            </p>
            {segments.map((s, si) => (
              <p key={s.key} className="flex items-center gap-2 text-muted">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: corDaSerie(s, si) }}
                />
                <span className="flex-1">{s.label}</span>
                <span className="font-semibold text-text tabular-nums">{s.values[foco] ?? 0}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <TabelaLeitor
        label={label}
        rotulos={labels}
        colunas={segments.map((s) => ({ label: s.label, values: s.values }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* anel de taxa                                                                */
/* -------------------------------------------------------------------------- */

export interface RateRingProps {
  /** 0–100, ou nulo quando não há base (vira traço, nunca zero). */
  value: number | null;
  label: string;
  size?: number;
  tone?: Tom;
  caption?: ReactNode;
  className?: string;
}

/** Uma taxa (SLA, conformidade) como anel: o número no meio, a fração no traço. */
export function RateRing({ value, label, size = 112, tone = 'accent', caption, className }: RateRingProps) {
  const raio = size / 2 - 9;
  const c = 2 * Math.PI * raio;
  const frac = value === null ? 0 : Math.min(Math.max(value, 0), 100) / 100;
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={`${label}: ${value === null ? 'sem base' : `${value}%`}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={raio}
            fill="none"
            stroke="var(--color-surface-sunken)"
            strokeWidth={10}
          />
          {value !== null && frac > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={raio}
              fill="none"
              stroke={COR_DE_TOM[tone]}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${frac * c} ${c}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </svg>
        <span
          data-numeric
          className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-text"
          style={{ fontSize: size / 4.6 }}
        >
          {value === null ? '—' : `${value}%`}
        </span>
      </div>
      {caption && <span className="text-center text-xs text-muted">{caption}</span>}
    </div>
  );
}
