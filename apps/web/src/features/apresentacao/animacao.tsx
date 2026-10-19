/**
 * Téchne Care — movimento da apresentação.
 *
 * Uma arquitetura só para a página inteira:
 *   - UM `IntersectionObserver` compartilhado (nenhum listener de scroll);
 *   - o estado vive em `data-apr` e o desenho em CSS (`styles.css`, `.apr-*`),
 *     só com `transform`/`opacity` — nada que cause deslocamento de layout;
 *   - cada elemento anima UMA vez e deixa de ser observado;
 *   - MELHORIA PROGRESSIVA: sem JavaScript, sem `IntersectionObserver` ou com
 *     `prefers-reduced-motion`, nada é escondido — o conteúdo já nasce visível;
 *   - o que já está na dobra é revelado de imediato, nunca fica à espera de
 *     rolagem.
 */
import {
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

export type TipoDeEntrada = 'subir' | 'esquerda' | 'direita' | 'escala';

/** Passo de escalonamento entre irmãos, em ms (faixa de 70–120 ms). */
export const PASSO = 80;

/** Atraso de um item em um grupo; o teto evita listas longas que demoram a aparecer. */
export function escalonar(i: number, base = 0, passo = PASSO, teto = 5): number {
  return base + Math.min(i, teto) * passo;
}

function semMovimento(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined' ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/* ------------------------------------------------- observador compartilhado */

let observador: IntersectionObserver | undefined;
const ouvintes = new WeakMap<Element, () => void>();

function observar(el: Element, aoEntrar: () => void): () => void {
  observador ??= new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        const f = ouvintes.get(e.target);
        ouvintes.delete(e.target);
        observador?.unobserve(e.target);
        f?.();
      }
    },
    // Dispara um pouco antes da borda inferior: o movimento começa já à vista.
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  ouvintes.set(el, aoEntrar);
  observador.observe(el);
  return () => {
    ouvintes.delete(el);
    observador?.unobserve(el);
  };
}

function naDobra(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight * 0.92 && r.bottom > 0;
}

/* ---------------------------------------------------------------- Revelar */

type Etiqueta = 'div' | 'li' | 'p' | 'h1' | 'h2' | 'h3' | 'figure' | 'span' | 'ol' | 'ul';

interface RevelarProps extends Omit<HTMLAttributes<HTMLElement>, 'style'> {
  as?: Etiqueta;
  tipo?: TipoDeEntrada;
  /** Atraso em ms (use `escalonar`). */
  atraso?: number;
  /** Deslocamento vertical inicial em px (16–32 nos blocos, menos nos itens miúdos). */
  dist?: number;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Faz o elemento entrar (fade + deslocamento sutil) quando aparece na tela.
 * Mantém a semântica: `as` troca a etiqueta, o resto passa direto.
 */
export function Revelar({
  as = 'div',
  tipo = 'subir',
  atraso = 0,
  dist,
  className,
  style,
  children,
  ...resto
}: RevelarProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || semMovimento()) return;
    // Antes da pintura: sem lampejo de conteúdo visível que depois some.
    if (naDobra(el)) {
      el.dataset.apr = 'visivel';
      return;
    }
    el.dataset.apr = 'oculto';
    return observar(el, () => {
      el.dataset.apr = 'visivel';
    });
  }, []);

  const estilo: CSSProperties = { ...style };
  if (atraso) (estilo as Record<string, string>)['--apr-d'] = `${atraso}ms`;
  if (dist !== undefined) (estilo as Record<string, string>)['--apr-y'] = `${dist}px`;

  return createElement(
    as,
    {
      ...resto,
      ref,
      'data-tipo': tipo === 'subir' ? undefined : tipo,
      className: ['apr-r', className].filter(Boolean).join(' '),
      style: estilo,
    },
    children
  );
}

/* --------------------------------------------------------------- contagem */

/**
 * Conta de 0 até `alvo` quando o elemento de `ref` aparece. Sem movimento
 * (ou sem observador) devolve o valor final desde o primeiro quadro, e o
 * texto que a pessoa lê nunca é um valor intermediário errado em repouso.
 */
export function useContagem(
  alvo: number,
  atraso = 0,
  duracao = 1100
): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [valor, setValor] = useState(alvo);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || semMovimento()) {
      setValor(alvo);
      return;
    }
    setValor(0);
    let quadro = 0;
    const iniciar = () => {
      const inicio = performance.now() + atraso;
      const passo = (agora: number) => {
        const t = Math.min(Math.max((agora - inicio) / duracao, 0), 1);
        setValor(Math.round(alvo * (1 - Math.pow(1 - t, 3))));
        if (t < 1) quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
    };
    const parar = naDobra(el) ? (iniciar(), () => {}) : observar(el, iniciar);
    return () => {
      parar();
      cancelAnimationFrame(quadro);
    };
  }, [alvo, atraso, duracao]);

  return [ref, valor];
}
