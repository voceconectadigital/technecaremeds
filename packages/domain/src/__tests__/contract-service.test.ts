import { describe, it, expect } from 'vitest';
import {
  addMonthsToDay,
  describeServiceBlock,
  nextRenewalEnd,
  renewalTerm,
  shouldAutoRenew,
} from '../contract-service';
import { addFrequency, subtractFrequency } from '../maintenance-plans';

describe('renovação (D-7)', () => {
  it('01/01 → 31/12 é "12 meses", e renova até 31/12 do ano seguinte (bissexto não empurra)', () => {
    expect(renewalTerm('2027-01-01', '2027-12-31')).toEqual({ months: 12 });
    expect(nextRenewalEnd('2027-12-31', { months: 12 })).toBe('2028-12-31');
    expect(nextRenewalEnd('2028-12-31', { months: 12 })).toBe('2029-12-31');
  });

  it('vigência que começa no meio do mês continua com o mesmo dia', () => {
    expect(renewalTerm('2026-11-24', '2027-11-23')).toEqual({ months: 12 });
    expect(nextRenewalEnd('2027-11-23', { months: 12 })).toBe('2028-11-23');
    expect(renewalTerm('2026-01-15', '2026-07-14')).toEqual({ months: 6 });
  });

  it('prazo que não fecha meses inteiros renova pelo mesmo número de dias', () => {
    expect(renewalTerm('2026-01-01', '2026-03-15')).toEqual({ days: 74 });
    expect(nextRenewalEnd('2026-03-15', { days: 74 })).toBe('2026-05-28');
  });

  it('o dia 31 vira o último dia do mês', () => {
    expect(addMonthsToDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDay('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('renova só vigente, com renovação automática, sem retenção e com término até hoje', () => {
    const base = { status: 'active', autoRenew: true, serviceHold: null, endsOn: '2026-11-24' };
    expect(shouldAutoRenew(base, '2026-11-24')).toBe(true);
    expect(shouldAutoRenew(base, '2026-11-23')).toBe(false);
    expect(shouldAutoRenew({ ...base, serviceHold: 'suspended' }, '2026-11-24')).toBe(false);
    expect(shouldAutoRenew({ ...base, serviceHold: 'blocked' }, '2026-11-24')).toBe(false);
    expect(shouldAutoRenew({ ...base, autoRenew: false }, '2026-11-24')).toBe(false);
    expect(shouldAutoRenew({ ...base, status: 'expired' }, '2026-11-25')).toBe(false);
    expect(shouldAutoRenew({ ...base, endsOn: null }, '2026-11-24')).toBe(false);
  });
});

describe('bloqueio (D-4)', () => {
  it('a mensagem diz contrato, motivo, desde quando e que fica só consulta', () => {
    const m = describeServiceBlock({
      contractId: 'x',
      contractNumber: 'CT-2026-00001',
      reason: 'suspended',
      heldAt: '2026-11-24T12:00:00Z',
      holdReason: 'Inadimplência',
      endsOn: null,
    });
    expect(m).toMatch(/CT-2026-00001/);
    expect(m).toMatch(/suspenso desde 24\/11\/2026 \(Inadimplência\)/);
    expect(m).toMatch(/somente consulta/);
    expect(
      describeServiceBlock({
        contractId: 'x',
        contractNumber: 'CT-1',
        reason: 'expired',
        heldAt: null,
        holdReason: null,
        endsOn: '2026-11-23',
      })
    ).toMatch(/venceu em 23\/11\/2026/);
  });
});

describe('primeiro vencimento por equipamento (educação continuada)', () => {
  it('subtrair e somar a frequência voltam ao vencimento informado', () => {
    const due = new Date('2027-03-31T00:00:00Z');
    const inicio = subtractFrequency(due, 'month', 1);
    expect(inicio.toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(subtractFrequency(due, 'year', 1).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(subtractFrequency(due, 'week', 2).toISOString().slice(0, 10)).toBe('2027-03-17');
    expect(
      addFrequency(subtractFrequency(due, 'year', 1), 'year', 1)
        .toISOString()
        .slice(0, 10)
    ).toBe('2027-03-31');
    expect(() => subtractFrequency(due, 'month', 0)).toThrow(RangeError);
  });
});
