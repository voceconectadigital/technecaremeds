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

  // E `scrollIntoView` ao mover o destaque numa lista.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}

export {};
