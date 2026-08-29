/**
 * Aurora — indicadores (SPEC v0.2 §25 · EPIC-021).
 *
 * O que estes testes protegem é a honestidade dos números: cobertura dita por
 * extenso, média sem amostra devolvendo nulo em vez de zero, e a primeira falha
 * não virando MTBF.
 */
import { describe, it, expect } from 'vitest';
import {
  METRIC_KEYS,
  METRIC_DEFINITIONS,
  coverage,
  ageBucket,
  bucketize,
  average,
  failureIntervals,
  withDefinition,
} from '../metrics';

describe('definições', () => {
  it('toda métrica declarada tem definição', () => {
    for (const k of METRIC_KEYS) {
      expect(METRIC_DEFINITIONS[k]).toBeDefined();
      expect(METRIC_DEFINITIONS[k].numerator.length).toBeGreaterThan(10);
    }
  });

  it('toda métrica diz o que fica de fora', () => {
    for (const k of METRIC_KEYS) {
      expect(METRIC_DEFINITIONS[k].exclusions.length).toBeGreaterThan(0);
    }
  });

  it('as métricas cuja fórmula a auditoria não confirmou avisam disso', () => {
    for (const k of ['mttr', 'mtbf', 'time_by_status', 'plan_compliance'] as const) {
      expect(METRIC_DEFINITIONS[k].comparability).toMatch(/não pôde ser confirmada/);
    }
  });

  it('"TMAC" não existe: no lugar há tempo de primeira resposta, definido', () => {
    expect(METRIC_KEYS).not.toContain('tmac');
    expect(METRIC_DEFINITIONS.first_response_time.comparability).toMatch(/TMAC/);
  });

  it('percentual tem denominador; contagem não tem', () => {
    for (const k of METRIC_KEYS) {
      const d = METRIC_DEFINITIONS[k];
      if (d.unit === 'percent') expect(d.denominator).not.toBeNull();
      if (d.unit === 'count' && d.key.startsWith('work_orders')) expect(d.denominator).toBeNull();
    }
  });
});

describe('cobertura', () => {
  it('diz por extenso quando algo ficou de fora', () => {
    const c = coverage(78, 22, 'ativos');
    expect(c.percent).toBe(78);
    expect(c.note).toBe('calculado sobre 78 % dos ativos (78 de 100)');
  });

  it('quando nada ficou de fora, diz isso também', () => {
    expect(coverage(10, 0, 'OS').note).toBe('calculado sobre todos os 10 OS');
  });

  it('sem universo não há percentual a afirmar', () => {
    const c = coverage(0, 0);
    expect(c.percent).toBeNull();
    expect(c.note).toBeNull();
  });
});

describe('faixas de idade', () => {
  it('os cortes são os da SPEC, e os extremos caem na faixa de baixo', () => {
    expect(ageBucket(0)).toBe('0-7');
    expect(ageBucket(7)).toBe('0-7');
    expect(ageBucket(8)).toBe('8-30');
    expect(ageBucket(30)).toBe('8-30');
    expect(ageBucket(31)).toBe('31-90');
    expect(ageBucket(90)).toBe('31-90');
    expect(ageBucket(91)).toBe('90+');
  });

  it('conta por faixa sem perder ninguém', () => {
    const c = bucketize([1, 5, 9, 40, 200, 300]);
    expect(c).toEqual({ '0-7': 2, '8-30': 1, '31-90': 1, '90+': 2 });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('médias', () => {
  it('sem amostra devolve nulo, não zero — zero afirmaria excelência', () => {
    const m = average([]);
    expect(m.value).toBeNull();
    expect(m.samples).toBe(0);
  });

  it('calcula e informa o tamanho da amostra', () => {
    const m = average([60, 120, 180]);
    expect(m.value).toBe(120);
    expect(m.samples).toBe(3);
  });
});

describe('MTBF', () => {
  it('uma falha não produz intervalo', () => {
    expect(failureIntervals([new Date('2025-01-01T00:00:00Z')])).toEqual([]);
    expect(failureIntervals([])).toEqual([]);
  });

  it('duas falhas produzem um intervalo, três produzem dois', () => {
    const f = [
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-02T00:00:00Z'),
      new Date('2025-01-04T00:00:00Z'),
    ];
    expect(failureIntervals(f)).toEqual([1440, 2880]);
  });

  it('a ordem de entrada não importa: os intervalos são cronológicos', () => {
    const desordenado = [
      new Date('2025-01-04T00:00:00Z'),
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-02T00:00:00Z'),
    ];
    expect(failureIntervals(desordenado)).toEqual([1440, 2880]);
  });

  it('o ativo com uma falha em cinco anos não vira o menos confiável', () => {
    // Tratar a única falha como intervalo zero produziria MTBF de 0 min para
    // ele. Excluído do cálculo, ele simplesmente não entra — e a cobertura diz.
    const media = average(failureIntervals([new Date('2020-01-01T00:00:00Z')]));
    expect(media.value).toBeNull();
  });
});

describe('o número viaja com a sua definição', () => {
  it('embrulha com definição, período, filtros e cobertura', () => {
    const r = withDefinition(
      'mttr',
      { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-02-01T00:00:00Z') },
      { customerId: 'c-1', teamId: null },
      { value: 240, samples: 12 },
      coverage(12, 3, 'OS corretivas')
    );

    expect(r.definition.numerator).toMatch(/abertura e conclusão/);
    expect(r.definition.exclusions.length).toBeGreaterThan(0);
    expect(r.period.from).toBe('2025-01-01T00:00:00.000Z');
    expect(r.filters.customerId).toBe('c-1');
    expect(r.coverage?.note).toMatch(/80 %/);
  });
});
