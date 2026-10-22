import { describe, expect, it } from 'vitest';
import { enderecoDaEtiqueta, matrizDeQr } from '../shell/qr';

describe('QR da etiqueta do ativo', () => {
  it('desenha uma matriz quadrada, com os três marcadores de canto', () => {
    const m = matrizDeQr('https://aurora.test/q/abc123');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((l) => l.length === m.length)).toBe(true);
    // O marcador de posição ocupa 7×7 e tem o canto superior esquerdo escuro.
    expect(m[0]![0]).toBe(true);
    expect(m[0]![m.length - 1]).toBe(true);
    expect(m[m.length - 1]![0]).toBe(true);
  });

  it('o mesmo texto dá a mesma matriz; texto diferente dá outra', () => {
    expect(matrizDeQr('A')).toEqual(matrizDeQr('A'));
    expect(matrizDeQr('A')).not.toEqual(matrizDeQr('B'));
  });

  it('o endereço da etiqueta é a origem + /q/ + token (a leitura por câmera abre o sistema)', () => {
    expect(enderecoDaEtiqueta('tok123', 'https://app.exemplo.com')).toBe('https://app.exemplo.com/q/tok123');
  });
});
