/**
 * Aurora — pente-fino de 17/10/2026: dinheiro em reais sem float no
 * arredondamento (excedente e glosa do contrato, custo de apontamento).
 *
 * `Number((x).toFixed(2))` arredonda o DOUBLE, e 1.005 guardado em ponto
 * flutuante é 1.00499…: o meio centavo sumia. Agora a conta é decimal exata,
 * meio-para-cima, uma vez só.
 */
import { describe, it, expect } from 'vitest';
import { overageAmount, penaltyForBreaches, entryCost, roundedMoneyProduct } from '@aurora/domain';

describe('roundedMoneyProduct', () => {
  it('meio centavo arredonda para cima', () => {
    expect(roundedMoneyProduct([201, 0.5], 100)).toBe(1.01); // 1,005
    expect(roundedMoneyProduct([1.005])).toBe(1.01);
    expect(roundedMoneyProduct([1.015])).toBe(1.02);
    expect(roundedMoneyProduct([2.675])).toBe(2.68);
  });

  it('abaixo do meio centavo arredonda para baixo', () => {
    expect(roundedMoneyProduct([1.0049])).toBe(1);
    expect(roundedMoneyProduct([200, 0.5], 100)).toBe(1);
  });

  it('divisor não decimal (minutos ÷ 60) arredonda uma vez, no fim', () => {
    expect(roundedMoneyProduct([50, 100], 60)).toBe(83.33);
    expect(roundedMoneyProduct([1, 0.3], 60)).toBe(0.01); // 0,005
  });

  it('notação exponencial e negativos', () => {
    expect(roundedMoneyProduct([1.5e3, 2])).toBe(3000);
    expect(roundedMoneyProduct([1e-7, 1])).toBe(0);
    expect(roundedMoneyProduct([-1.005])).toBe(-1.01);
  });
});

describe('contrato e apontamento nos limites de meio centavo', () => {
  it('excedente: 3 chamados × R$ 0,335 = R$ 1,005 → R$ 1,01', () => {
    expect(overageAmount(0, 3, 0.335)).toBe(1.01);
    // (float: 3 * 0.335 = 1.0050000000000001 passava; 1.005 × 1 não)
    expect(overageAmount(null, 1, 1.005)).toBe(1.01);
  });

  it('glosa: 201 × 0,5 % = 1,005 → 1,01', () => {
    const g = penaltyForBreaches({ percentPerBreach: 0.5, capPercent: null }, 1, 201);
    expect(g!.amount).toBe(1.01);
    expect(g!.percentApplied).toBe(0.5);
  });

  it('glosa com teto continua usando o percentual aplicado', () => {
    const g = penaltyForBreaches({ percentPerBreach: 0.1, capPercent: 0.25 }, 3, 1000);
    expect(g!.percentApplied).toBe(0.25);
    expect(g!.amount).toBe(2.5);
  });

  it('custo de apontamento: 1 min a R$ 0,30/h = R$ 0,005 → R$ 0,01', () => {
    const entrada = { startedAt: '2026-10-17T10:00:00.000Z', endedAt: '2026-10-17T10:01:00.000Z' };
    expect(entryCost(entrada, 0.3)).toBe(0.01);
    expect(entryCost({ ...entrada, endedAt: '2026-10-17T10:50:00.000Z' }, 100)).toBe(83.33);
    expect(entryCost(entrada, null)).toBeNull();
  });
});
