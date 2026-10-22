/**
 * Ferramentas (16/10/2026, Fase 12): as sete pedidas, todas com situação
 * declarada e nenhuma prometendo dado — a vitrine não pode virar backend falso.
 */
import { describe, it, expect } from 'vitest';
import { FERRAMENTAS, ROTULO_SITUACAO } from '../features/ferramentas/ferramentas';

describe('Ferramentas', () => {
  it('as sete ferramentas da reunião, mais a ONA pedida depois, na ordem', () => {
    expect(FERRAMENTAS.map((f) => f.nome)).toEqual([
      'Temperatura e Umidade',
      'Geolocalização',
      'Rastreabilidade CME',
      'Gases Medicinais',
      'Simuladores e Analisadores',
      'Integrações de Engenharia Clínica',
      'Inteligência Artificial',
      'ONA — Acreditação',
    ]);
  });

  it('toda ferramenta tem situação EM BREVE, FUTURO ou INTEGRAÇÃO PLANEJADA e diz o que falta', () => {
    for (const f of FERRAMENTAS) {
      expect(['EM BREVE', 'FUTURO', 'INTEGRAÇÃO PLANEJADA']).toContain(ROTULO_SITUACAO[f.situacao]);
      expect(f.falta.length, f.nome).toBeGreaterThan(10);
    }
  });

  it('IA não é anunciada como ativa', () => {
    const ia = FERRAMENTAS.find((f) => f.key === 'inteligencia_artificial')!;
    expect(ia.situacao).toBe('futuro');
    expect(ia.hoje).toBeNull();
    expect(ia.falta).toMatch(/Nada de IA está ativo/);
  });
});
