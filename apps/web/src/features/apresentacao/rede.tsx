/**
 * Téchne Care — a rede do herói.
 *
 * É o SÍMBOLO DA MARCA ampliado até virar diagrama: o anel central da logo
 * passa a ser a plataforma, e os nós ligados a ele pelos traços verdes são os
 * públicos que ela atende. A mesma geometria do símbolo — anel, nós azuis de
 * tamanhos diferentes, ligações verde-limão — e por isso o desenho é da
 * Téchne Care, e não um enfeite de modelo de página.
 *
 * Um único momento de movimento: as ligações se traçam e os nós aparecem,
 * uma vez. Quem pediu menos movimento ao sistema recebe o desenho pronto (a
 * regra global de `prefers-reduced-motion` zera as durações).
 */
interface No {
  x: number;
  y: number;
  r: number;
  estilo: 'azul' | 'claro' | 'anel' | 'fundo';
  rotulo: readonly string[];
  /** Onde o rótulo fica em relação ao nó. */
  lado: 'abaixo' | 'acima' | 'esquerda';
}

const CENTRO = { x: 300, y: 270 };

const NOS: readonly No[] = [
  { x: 128, y: 124, r: 36, estilo: 'azul', rotulo: ['Hospitais'], lado: 'acima' },
  { x: 470, y: 126, r: 44, estilo: 'claro', rotulo: ['Prestadores', 'de serviço'], lado: 'acima' },
  { x: 522, y: 318, r: 28, estilo: 'azul', rotulo: ['Assistência', 'técnica'], lado: 'abaixo' },
  { x: 388, y: 462, r: 40, estilo: 'anel', rotulo: ['Engenharia', 'clínica'], lado: 'esquerda' },
  { x: 112, y: 394, r: 30, estilo: 'fundo', rotulo: ['Operação', 'multiempresa'], lado: 'abaixo' },
];

/** Pontos soltos, como os do símbolo: dão escala sem dizer nada. */
const PONTOS: readonly { x: number; y: number; r: number; cor: string }[] = [
  { x: 252, y: 64, r: 9, cor: 'var(--aurora-lime-500)' },
  { x: 566, y: 214, r: 7, cor: 'var(--aurora-brand-300)' },
  { x: 36, y: 250, r: 11, cor: 'var(--aurora-brand-700)' },
  { x: 262, y: 516, r: 6, cor: 'var(--aurora-brand-300)' },
  { x: 412, y: 206, r: 5, cor: 'var(--aurora-brand-200)' },
  { x: 566, y: 470, r: 13, cor: 'var(--aurora-brand-800)' },
];

const PREENCHIMENTO: Record<No['estilo'], { fill: string; stroke?: string; strokeWidth?: number }> = {
  azul: { fill: 'var(--aurora-brand-500)' },
  claro: { fill: 'var(--aurora-brand-200)' },
  anel: { fill: 'var(--aurora-brand-950)', stroke: 'var(--aurora-brand-100)', strokeWidth: 10 },
  fundo: { fill: 'var(--aurora-brand-800)', stroke: 'var(--aurora-brand-400)', strokeWidth: 3 },
};

export function RedeDaPlataforma({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 540"
      role="img"
      aria-label="A plataforma no centro, ligada a hospitais, prestadores de serviço, assistência técnica, engenharia clínica e operação multiempresa."
      className={className}
    >
      {/* Órbitas: o alcance da plataforma, quase invisíveis. */}
      <circle
        cx={CENTRO.x}
        cy={CENTRO.y}
        r={150}
        fill="none"
        stroke="var(--aurora-brand-800)"
        strokeWidth={1.5}
        strokeDasharray="2 8"
      />
      <circle
        cx={CENTRO.x}
        cy={CENTRO.y}
        r={236}
        fill="none"
        stroke="var(--aurora-brand-900)"
        strokeWidth={1.5}
        strokeDasharray="2 10"
      />

      {/* Ligações — o verde do símbolo. */}
      {NOS.map((n, i) => (
        <line
          key={`l-${n.rotulo.join(' ')}`}
          x1={CENTRO.x}
          y1={CENTRO.y}
          x2={n.x}
          y2={n.y}
          pathLength={1}
          stroke="var(--aurora-lime-500)"
          strokeWidth={8}
          strokeLinecap="round"
          className="aurora-anim-tracar"
          style={{ animationDelay: `${120 + i * 90}ms` }}
        />
      ))}

      {PONTOS.map((p, i) => (
        <circle
          key={`p-${p.x}-${p.y}`}
          cx={p.x}
          cy={p.y}
          r={p.r}
          fill={p.cor}
          className="aurora-anim-surgir"
          style={{ animationDelay: `${700 + i * 60}ms` }}
        />
      ))}

      {/* Os nós e os rótulos. */}
      {NOS.map((n, i) => {
        const p = PREENCHIMENTO[n.estilo];
        const centrado = n.lado !== 'esquerda';
        const tx = centrado ? n.x : n.x - n.r - 18;
        const ty =
          n.lado === 'abaixo'
            ? n.y + n.r + 30
            : n.lado === 'acima'
              ? n.y - n.r - 16 - (n.rotulo.length - 1) * 25
              : n.y - 4;
        return (
          <g
            key={`n-${n.rotulo.join(' ')}`}
            className="aurora-anim-surgir"
            style={{ animationDelay: `${420 + i * 90}ms` }}
          >
            <circle cx={n.x} cy={n.y} r={n.r} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
            <text
              x={tx}
              y={ty}
              textAnchor={centrado ? 'middle' : 'end'}
              fill="var(--aurora-brand-100)"
              fontSize={21}
              fontWeight={600}
              letterSpacing="-0.01em"
            >
              {n.rotulo.map((linha, j) => (
                <tspan key={linha} x={tx} dy={j === 0 ? 0 : 25}>
                  {linha}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}

      {/* O anel central — a plataforma. Desenhado por último, cobre a ponta
          das ligações como no símbolo. */}
      <circle
        cx={CENTRO.x}
        cy={CENTRO.y}
        r={58}
        fill="var(--aurora-brand-950)"
        stroke="var(--aurora-neutral-0)"
        strokeWidth={18}
      />
      <circle cx={CENTRO.x} cy={CENTRO.y} r={22} fill="var(--aurora-lime-500)" />
    </svg>
  );
}
