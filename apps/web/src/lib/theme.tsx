/**
 * Aurora — tema claro e escuro.
 *
 * TRÊS ESTADOS, NÃO DOIS: claro, escuro e "o que o sistema disser". O terceiro
 * é o padrão, e é o que faz a tela acompanhar quem trabalha de dia e à noite
 * sem precisar mexer em nada.
 *
 * A aplicação inicial acontece no `index.html`, antes de o React montar —
 * senão a página pisca branca antes de escurecer, e quem trabalha de
 * madrugada no hospital recebe um flash na cara a cada carregamento.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
type Escolha = Theme | 'system';

const CHAVE = 'aurora:tema';

function lerEscolha(): Escolha {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function doSistema(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeApi {
  tema: Theme;
  escolha: Escolha;
  definir(escolha: Escolha): void;
  alternar(): void;
}

const Ctx = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [escolha, setEscolha] = useState<Escolha>(lerEscolha);
  const [doS, setDoS] = useState<Theme>(doSistema);

  // Quem está em "system" acompanha a mudança do sistema EM TEMPO REAL: o
  // computador escurece às 18h e a Aurora escurece junto, sem recarregar.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const aoMudar = () => setDoS(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', aoMudar);
    return () => mq.removeEventListener?.('change', aoMudar);
  }, []);

  const tema: Theme = escolha === 'system' ? doS : escolha;

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  const definir = useCallback((nova: Escolha) => {
    try {
      if (nova === 'system') localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, nova);
    } catch {
      /* sem armazenamento: vale só nesta aba */
    }
    setEscolha(nova);
  }, []);

  const alternar = useCallback(() => {
    definir(tema === 'dark' ? 'light' : 'dark');
  }, [tema, definir]);

  const api = useMemo<ThemeApi>(
    () => ({ tema, escolha, definir, alternar }),
    [tema, escolha, definir, alternar]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeApi {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTheme exige <ThemeProvider> acima na árvore');
  return t;
}
