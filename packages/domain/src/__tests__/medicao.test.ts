/**
 * Aurora — envelope neutro de medição e a fronteira do item `measurement`
 * (gap V2 P2.3, P2.5 · critério 4 do PLAT §14).
 */
import { describe, it, expect } from 'vitest';
import {
  fonteManual,
  fonteDe,
  FONTES_DISPONIVEIS,
  MEASUREMENT_SOURCES,
  computeVerdict,
  validateAnswer,
  evaluateChecklist,
  certificadoCobreAMedicao,
  ValidationError,
  type ChecklistItem,
} from '../index';

const R = '0193dd00-0000-7000-8000-000000000001';
const I = '0193dd00-0000-7000-8000-000000000002';

const ponto: ChecklistItem = {
  id: I,
  kind: 'measurement',
  label: 'Temperatura da câmara',
  required: true,
  unit: '°C',
  nominalValue: 37,
  toleranceMinus: 0.3,
  tolerancePlus: 0.3,
  toleranceMode: 'absolute',
  readingsRequired: 3,
  requiresPhotoWhen: 'never',
  failAction: 'block_completion',
};

describe('fonte manual → envelope', () => {
  it('normaliza o formulário num envelope com origem manual', () => {
    const e = fonteManual.normalizar({
      response_id: R,
      item_id: I,
      readings: [37.1, 37.0, 37.2],
      unit: ' °C ',
      measured_at: '2026-10-01T14:05:00-03:00',
    });
    expect(e).toEqual({
      origem: 'manual',
      respostaId: R,
      itemId: I,
      leituras: [37.1, 37.0, 37.2],
      unidade: '°C',
      instrumentoId: null,
      medidoEmNoAparelho: '2026-10-01T14:05:00-03:00',
      motivoDaCorrecao: null,
    });
  });

  it('não converte texto em número — "37,1" é recusado, não adivinhado', () => {
    expect(() => fonteManual.normalizar({ response_id: R, item_id: I, readings: ['37,1'] })).toThrow(
      ValidationError
    );
    expect(() => fonteManual.normalizar({ response_id: R, item_id: I, readings: [Number.NaN] })).toThrow(
      /número/
    );
    expect(() => fonteManual.normalizar({ response_id: R, item_id: I, readings: [] })).toThrow(
      /ao menos uma/
    );
  });

  it('instante do aparelho sem fuso é recusado', () => {
    expect(() =>
      fonteManual.normalizar({ response_id: R, item_id: I, readings: [1], measured_at: '2026-10-01 14:05' })
    ).toThrow(/fuso/);
  });

  it('só a fonte manual tem adaptador — as outras origens dizem isso em vez de fingir', () => {
    expect(FONTES_DISPONIVEIS.map((f) => f.origem)).toEqual(['manual']);
    expect(fonteDe('manual')).toBe(fonteManual);
    for (const origem of MEASUREMENT_SOURCES.filter((o) => o !== 'manual')) {
      expect(() => fonteDe(origem)).toThrow(/ainda não tem adaptador/);
    }
  });
});

describe('o ponto de medição NÃO é julgado — fronteira metrológica', () => {
  it('o veredito é "na" dentro, no limite e muito fora da tolerância declarada', () => {
    for (const leituras of [
      [37.0, 37.0, 37.0],
      [37.3, 37.3, 37.3],
      [99, 99, 99],
      [-40, -40, -40],
    ]) {
      expect(computeVerdict(ponto, { readings: leituras })).toBe('na');
    }
  });

  it('por isso nunca bloqueia a conclusão, mesmo com fail_action = block_completion', () => {
    const r = evaluateChecklist([ponto], { [I]: { readings: [99, 99, 99] } });
    expect(r.blocking).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it('confere só a FORMA: quantas leituras e se são números', () => {
    expect(validateAnswer(ponto, { readings: [37, 37] })[0]?.message).toMatch(/exige 3 leitura/);
    expect(validateAnswer(ponto, { number: 37 })[0]?.message).toMatch(/não um número solto/);
    expect(validateAnswer(ponto, { readings: [37, 37, 37] })).toEqual([]);
  });

  it('sem resposta, o ponto obrigatório fica pendente', () => {
    const r = evaluateChecklist([ponto], {});
    expect(r.pending.map((p) => p.itemId)).toEqual([I]);
  });

  it('o módulo de medição não exporta função de cálculo metrológico', async () => {
    const modulo = await import('../medicao');
    const proibidas =
      /incerteza|expandida|fator_?k|arredond|veredito|tolerancia|conformidade|converter|media|desvio/i;
    const suspeitas = Object.keys(modulo).filter(
      (n) => typeof (modulo as Record<string, unknown>)[n] === 'function' && proibidas.test(n)
    );
    expect(suspeitas).toEqual([]);
  });
});

describe('o certificado registrado cobre o dia da medição? (aritmética de calendário)', () => {
  const cert = { nome: 'CAL-123', emitidoEm: '2026-03-10', venceEm: '2027-03-10', revogado: false };

  it('cobre o dia da emissão e o dia do vencimento', () => {
    expect(certificadoCobreAMedicao(cert, '2026-03-10')).toBe(true);
    expect(certificadoCobreAMedicao(cert, '2027-03-10')).toBe(true);
  });

  it('não cobre a medição feita ANTES da emissão — naquele dia valia o anterior', () => {
    expect(certificadoCobreAMedicao(cert, '2026-03-09')).toBe(false);
  });

  it('não cobre depois do vencimento', () => {
    expect(certificadoCobreAMedicao(cert, '2027-03-11')).toBe(false);
  });

  it('revogado não cobre nada', () => {
    expect(certificadoCobreAMedicao({ ...cert, revogado: true }, '2026-06-01')).toBe(false);
  });

  it('data mal formada é recusada em vez de comparada', () => {
    expect(() => certificadoCobreAMedicao({ ...cert, emitidoEm: '10/03/2026' }, '2026-06-01')).toThrow();
    expect(() => certificadoCobreAMedicao(cert, '01/06/2026')).toThrow();
  });
});
