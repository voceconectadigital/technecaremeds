/**
 * Aurora — a vitrine ao lado da entrada.
 *
 * A tela de entrada é a primeira impressão do produto. Do lado esquerdo, em
 * telas largas, ela diz o que o sistema faz — sem números inventados: são
 * capacidades, não estatísticas. A constelação ecoa os nós da logo e se move
 * devagar (e para, para quem pediu menos movimento).
 */
import { Activity, CalendarRange, ShieldCheck, Smartphone } from 'lucide-react';
import { MARCA } from '@aurora/app-kit';

const CAPACIDADES = [
  {
    icone: Activity,
    titulo: 'Operação ao vivo',
    texto: 'Solicitações, ordens de serviço e SLA num só painel.',
  },
  {
    icone: CalendarRange,
    titulo: 'Agenda inteligente',
    texto: 'Técnico certo, na hora certa, sem conflito de turno.',
  },
  {
    icone: ShieldCheck,
    titulo: 'Rastreabilidade total',
    texto: 'Cada ativo com histórico, calibração e contrato.',
  },
  { icone: Smartphone, titulo: 'Campo sem rede', texto: 'O técnico executa e assina mesmo no subsolo.' },
] as const;

export function VitrineDeEntrada() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-12 lg:flex">
      <Constelacao />
      <div className="relative">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-text uppercase">
          Plataforma de engenharia clínica
        </p>
        <h2 data-display className="mt-4 max-w-xl text-4xl leading-[1.05] font-semibold text-text">
          Cada equipamento do hospital, <span className="text-brand-accent-text">visível</span> e sob
          controle.
        </h2>
        <p className="mt-4 max-w-lg text-md text-muted">
          {MARCA.descricao} — do chamado à peça, da agenda ao indicador.
        </p>
      </div>

      <ul className="relative grid max-w-2xl grid-cols-2 gap-3">
        {CAPACIDADES.map(({ icone: Icone, titulo, texto }) => (
          <li
            key={titulo}
            className="rounded-card border border-border bg-surface/60 p-4 shadow-card backdrop-blur-md"
          >
            <span className="grid size-9 place-items-center rounded-control bg-accent-soft text-accent-text">
              <Icone aria-hidden="true" className="size-[18px]" />
            </span>
            <p className="mt-3 text-sm font-semibold text-text">{titulo}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{texto}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Nós e arestas no espírito da logo — decorativo, ignorado por leitores de tela. */
function Constelacao() {
  const nos = [
    [120, 140, 5],
    [260, 90, 3],
    [380, 210, 6],
    [520, 120, 4],
    [610, 260, 5],
    [470, 340, 3],
    [300, 330, 4],
    [180, 260, 3],
  ] as const;
  const arestas = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 0],
    [2, 6],
    [2, 5],
  ] as const;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 720 420"
      className="pointer-events-none absolute top-[34%] -right-28 w-[720px] opacity-50"
    >
      <defs>
        <radialGradient id="no-brilho">
          <stop offset="0%" stopColor="var(--aurora-accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--aurora-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {arestas.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nos[a][0]}
          y1={nos[a][1]}
          x2={nos[b][0]}
          y2={nos[b][1]}
          stroke="var(--aurora-brand-accent)"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
      ))}
      {nos.map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r * 4} fill="url(#no-brilho)" opacity="0.25">
            <animate
              attributeName="opacity"
              values="0.1;0.35;0.1"
              dur={`${4 + (i % 3)}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={x}
            cy={y}
            r={r}
            fill={i % 2 ? 'var(--aurora-accent)' : 'var(--aurora-text)'}
            opacity="0.85"
          />
        </g>
      ))}
    </svg>
  );
}
