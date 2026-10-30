/**
 * Ferramentas (16/10/2026, Fase 12; textos de 19/10): a vitrine é comercial, mas
 * cada ferramenta declara a situação e nenhuma promete dado — a vitrine não pode
 * virar backend falso.
 */
import { describe, it, expect } from 'vitest';
import { CHAMADA_DA_VITRINE, FERRAMENTAS, ROTULO_SITUACAO } from '../features/ferramentas/ferramentas';

describe('Ferramentas', () => {
  it('as sete ferramentas da reunião, a Eficiência Energética e a ONA pedidas depois, na ordem', () => {
    expect(FERRAMENTAS.map((f) => f.nome)).toEqual([
      'Temperatura e Umidade',
      'Geolocalização de Equipamentos',
      'Rastreabilidade CME',
      'Gases Medicinais',
      'Simuladores e Analisadores',
      'Eficiência Energética',
      'Integrações de Engenharia Clínica',
      'Inteligência Artificial',
      'ONA — Acreditação',
    ]);
  });

  it('a chamada é a frase pedida pelo cliente, e a recusada não volta', () => {
    expect(CHAMADA_DA_VITRINE).toBe('Soluções novas de mercado, consulte disponibilidade.');
    for (const f of FERRAMENTAS) {
      expect(JSON.stringify(f)).not.toMatch(/Nenhuma destas ferramentas mostra dado/);
    }
  });

  it('toda ferramenta tem situação, chamada, benefícios e a nota do que falta', () => {
    for (const f of FERRAMENTAS) {
      expect(['EM BREVE', 'FUTURO', 'INTEGRAÇÃO PLANEJADA']).toContain(ROTULO_SITUACAO[f.situacao]);
      expect(f.chamada.length, f.nome).toBeGreaterThan(10);
      expect(f.beneficios.length, f.nome).toBeGreaterThanOrEqual(3);
      expect(f.falta.length, f.nome).toBeGreaterThan(10);
    }
  });

  it('o texto da tela não tem jargão interno nem promete leitura ativa', () => {
    for (const f of FERRAMENTAS) {
      const tela = [f.chamada, f.proposito, ...f.beneficios, f.hoje ?? ''].join(' ');
      expect(tela, f.nome).not.toMatch(/\bN[0-4]\b|gateway|outbox|OpenAPI|Falta:/);
      expect(tela, f.nome).not.toMatch(/em tempo real|já monitora|monitorando agora/i);
    }
  });

  it('IA não é anunciada como ativa', () => {
    const ia = FERRAMENTAS.find((f) => f.key === 'inteligencia_artificial')!;
    expect(ia.situacao).toBe('futuro');
    expect(ia.hoje).toBeNull();
    expect(ia.falta).toMatch(/Nada de IA está ativo/);
  });

  it('Eficiência Energética cobre equipamento, setor e o estabelecimento todo, sem consumo medido', () => {
    const e = FERRAMENTAS.find((f) => f.key === 'eficiencia_energetica')!;
    expect(e.proposito).toMatch(/grande consumo/);
    expect(e.proposito).toMatch(/por setor/);
    expect(e.proposito).toMatch(/estabelecimento como um todo/);
    expect(e.hoje).toBeNull();
  });
});
