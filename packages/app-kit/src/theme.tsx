/**
 * Aurora — estilos visuais (temas) escolhidos pela pessoa.
 *
 * TRÊS ESTILOS, CADA UM COM SUA PERSONALIDADE — não três cores do mesmo layout:
 *
 *   futuristico  painel de veículo elétrico premium; escuro, preciso. PADRÃO.
 *   mindfulness  calmo e contemplativo; claro, pedra quente, serifa nos títulos.
 *   wellness     limpo e acolhedor; claro, verde-água, humano.
 *
 * O estilo vive em `data-estilo` (paleta, superfícies, face de destaque) e o
 * MODO derivado dele em `data-theme` (`dark`/`light`) — o CSS que já sabia
 * escurecer continua valendo, e cada estilo só precisa declarar a diferença.
 * Tokens em packages/ui/src/styles/tokens.css.
 *
 * A aplicação inicial acontece no `index.html`, antes de o React montar —
 * senão a página pisca com o estilo errado a cada carregamento.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
export type Estilo = 'futuristico' | 'mindfulness' | 'wellness';

export const ESTILOS: readonly { id: Estilo; nome: string; descricao: string; modo: Theme }[] = [
  { id: 'futuristico', nome: 'Futurístico', descricao: 'Painel premium, escuro e preciso', modo: 'dark' },
  { id: 'mindfulness', nome: 'Mindfulness', descricao: 'Calmo, leve e equilibrado', modo: 'light' },
  { id: 'wellness', nome: 'Wellness', descricao: 'Limpo, acolhedor e humano', modo: 'light' },
];

export const ESTILO_PADRAO: Estilo = 'futuristico';
const CHAVE = 'aurora:estilo';

function valido(v: unknown): v is Estilo {
  return ESTILOS.some((e) => e.id === v);
}

function lerEstilo(): Estilo {
  try {
    const v = localStorage.getItem(CHAVE);
    return valido(v) ? v : ESTILO_PADRAO;
  } catch {
    return ESTILO_PADRAO;
  }
}

export function modoDoEstilo(estilo: Estilo): Theme {
  return ESTILOS.find((e) => e.id === estilo)?.modo ?? 'dark';
}

interface ThemeApi {
  /** Luminosidade derivada do estilo — para quem só precisa saber claro/escuro. */
  tema: Theme;
  estilo: Estilo;
  definir(estilo: Estilo): void;
  /** Próximo estilo da lista (atalho do menu). */
  alternar(): void;
}

const Ctx = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [estilo, setEstilo] = useState<Estilo>(lerEstilo);
  const tema = modoDoEstilo(estilo);

  useEffect(() => {
    const raiz = document.documentElement;
    raiz.dataset.estilo = estilo;
    raiz.dataset.theme = tema;
    raiz.style.colorScheme = tema;
  }, [estilo, tema]);

  const definir = useCallback((novo: Estilo) => {
    if (!valido(novo)) return;
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {
      /* sem armazenamento: vale só nesta aba */
    }
    setEstilo(novo);
  }, []);

  const alternar = useCallback(() => {
    const i = ESTILOS.findIndex((e) => e.id === estilo);
    definir(ESTILOS[(i + 1) % ESTILOS.length]!.id);
  }, [estilo, definir]);

  const api = useMemo<ThemeApi>(
    () => ({ tema, estilo, definir, alternar }),
    [tema, estilo, definir, alternar]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeApi {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTheme exige <ThemeProvider> acima na árvore');
  return t;
}
