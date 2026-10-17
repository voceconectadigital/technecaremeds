/**
 * Aurora — uma sincronização de cada vez (EPIC-014).
 *
 * Cada toque, o relógio e o aviso de rede pedem sincronização. Sem guarda, três
 * pedidos juntos eram três escoamentos em paralelo; com uma guarda ingênua, o
 * pedido do meio era descartado e o comando recém-enfileirado esperava o
 * relógio. Os dois casos estão aqui.
 */
import { describe, it, expect } from 'vitest';
import { umaPorVez } from '../uma-por-vez';

function adiado() {
  let soltar!: () => void;
  const promessa = new Promise<void>((r) => (soltar = r));
  return { promessa, soltar };
}

describe('UMA-001 · single-flight com repetição', () => {
  it('pedidos durante uma passada não rodam em paralelo, e viram UMA repetição', async () => {
    let emCurso = 0;
    let maximo = 0;
    let rodadas = 0;
    const portoes = [adiado(), adiado()];

    const sincronizar = umaPorVez(async () => {
      emCurso++;
      maximo = Math.max(maximo, emCurso);
      await portoes[rodadas++]?.promessa;
      emCurso--;
      return rodadas;
    });

    const primeira = sincronizar();
    const segunda = sincronizar();
    const terceira = sincronizar();
    portoes[0]!.soltar();
    await Promise.resolve();
    portoes[1]!.soltar();

    await Promise.all([primeira, segunda, terceira]);
    expect(maximo).toBe(1);
    // A passada original e UMA repetição pelos dois pedidos do meio.
    expect(rodadas).toBe(2);
  });

  it('depois de terminar, o próximo pedido roda de novo', async () => {
    let rodadas = 0;
    const sincronizar = umaPorVez(async () => ++rodadas);
    await sincronizar();
    await sincronizar();
    expect(rodadas).toBe(2);
  });

  it('uma falha não trava a guarda', async () => {
    let vez = 0;
    const sincronizar = umaPorVez(async () => {
      vez++;
      if (vez === 1) throw new Error('caiu');
      return vez;
    });
    await expect(sincronizar()).rejects.toThrow('caiu');
    await expect(sincronizar()).resolves.toBe(2);
  });
});
