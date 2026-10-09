/**
 * A moldura da entrada — painel de marca à esquerda, formulário à direita.
 *
 * Redesenhada em 09/10/2026. A versão anterior era uma constelação animada
 * atrás de cartões translúcidos, e a do formulário um cartão de vidro sobre
 * dois degradês: três camadas de efeito numa tela cuja única tarefa é
 * entrar. Agora o painel usa a cor ESTRUTURAL da marca (os papéis `nav-*`:
 * azul-marinho no estilo Téchne, a superfície rebaixada nos outros), a logo
 * na variante para fundo escuro, o texto que já existia e nada piscando.
 *
 * Abaixo de 1024px o painel some e a logo sobe para o topo do formulário — no
 * celular, a pessoa veio entrar, não ler sobre a plataforma.
 */
import type { ReactNode } from 'react';
import { Activity, CalendarRange, ShieldCheck, Smartphone } from 'lucide-react';
import { Logo } from '@aurora/ui';
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

export function MolduraDeEntrada({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <VitrineDeEntrada />
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo
              src={MARCA.logoHorizontal}
              srcEscuro={MARCA.logoHorizontalEscuro}
              nome={MARCA.produto}
              largura={168}
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function VitrineDeEntrada() {
  return (
    <aside className="aurora-nav relative hidden flex-col justify-between overflow-hidden bg-nav p-12 xl:p-16 lg:flex">
      {/* Grade técnica muito fraca: textura de prancheta, e não enfeite. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(var(--aurora-nav-text) 1px, transparent 1px), linear-gradient(90deg, var(--aurora-nav-text) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(120% 90% at 0% 0%, black, transparent 70%)',
        }}
      />

      <div className="relative">
        <Logo
          src={MARCA.logoHorizontal}
          srcEscuro={MARCA.logoHorizontalEscuro}
          nome={MARCA.produto}
          largura={176}
        />
      </div>

      <div className="relative max-w-xl">
        <p className="text-xs font-semibold tracking-[0.12em] text-nav-label uppercase">
          Plataforma de engenharia clínica
        </p>
        <p className="mt-4 text-4xl leading-[1.1] font-bold tracking-display text-nav-text-active">
          Cada equipamento do hospital, visível e sob controle.
        </p>
        <p className="mt-4 max-w-lg text-md text-nav-text">
          {MARCA.descricao} — do chamado à peça, da agenda ao indicador.
        </p>
      </div>

      <ul className="relative grid max-w-2xl grid-cols-2 gap-x-8 gap-y-6 border-t border-nav-border pt-8">
        {CAPACIDADES.map(({ icone: Icone, titulo, texto }) => (
          <li key={titulo} className="flex gap-3">
            <Icone
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-[18px] shrink-0 text-nav-marker"
            />
            <div>
              <p className="text-sm font-semibold text-nav-text-active">{titulo}</p>
              <p className="mt-1 text-xs leading-relaxed text-nav-text">{texto}</p>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
