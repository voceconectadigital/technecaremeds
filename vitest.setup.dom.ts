/**
 * Aurora — preparo dos testes de interface.
 *
 * Carregado em TODA suíte, e não só nas de jsdom: um `setupFiles` por ambiente
 * não existe no Vitest 2. Por isso tudo aqui é condicionado à presença de um
 * documento — em Node puro o arquivo não faz nada e não custa nada.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');

  // Sem isto, o segundo teste de um arquivo encontra o DOM do primeiro e
  // `getByRole` acha dois botões onde deveria haver um.
  afterEach(() => cleanup());

  /*
   * O jsdom não implementa `matchMedia`, e componentes que perguntam por
   * `prefers-reduced-motion` quebrariam no teste — não por defeito deles, mas
   * por falta do ambiente. O padrão é "sem preferência", que é o caso comum.
   */
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  // O Radix usa ResizeObserver para posicionar menus e diálogos.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  /*
   * localStorage utilizável.
   *
   * O Node 25 instala um `localStorage` global experimental que, sem caminho
   * de arquivo configurado, não tem `setItem`. Ele SOMBREIA o do jsdom, e o
   * resultado é código de sessão que falha em teste por um motivo que não tem
   * nada a ver com o código. Aqui o ambiente ganha uma implementação em
   * memória — que é o comportamento de uma aba nova, e é o que o teste quer.
   */
  const armazenamentoUsavel =
    typeof globalThis.localStorage?.setItem === 'function' &&
    (() => {
      try {
        globalThis.localStorage.setItem('__aurora_probe__', '1');
        globalThis.localStorage.removeItem('__aurora_probe__');
        return true;
      } catch {
        return false;
      }
    })();

  if (!armazenamentoUsavel) {
    const memoria = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => void memoria.set(k, String(v)),
        removeItem: (k: string) => void memoria.delete(k),
        clear: () => memoria.clear(),
        key: (i: number) => [...memoria.keys()][i] ?? null,
        get length() {
          return memoria.size;
        },
      },
    });
  }

  // E `scrollIntoView` ao mover o destaque numa lista.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}

export {};
