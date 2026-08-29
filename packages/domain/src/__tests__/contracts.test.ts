/**
 * Aurora — aritmética de contratos (SPEC v0.2 §17 · EPIC-017).
 *
 * O que estes testes fixam são as decisões que ninguém revisa depois: qual
 * cobertura vence o empate, quando o aviso de renovação já chegou tarde, e o
 * que acontece quando não há regra de glosa configurada.
 */
import { describe, it, expect } from 'vitest';
import {
  rangesOverlap,
  coversDate,
  contractStatusOn,
  coverageSpecificity,
  renewalAlert,
  noticeDeadline,
  franchiseState,
  overageAmount,
  penaltyForBreaches,
  periodBounds,
  summarizeMeasurement,
  daysBetween,
} from '../contracts';

describe('vigência', () => {
  it('os extremos são inclusivos — a virada de contrato é o caso que importa', () => {
    expect(
      rangesOverlap(
        { startsOn: '2025-01-01', endsOn: '2025-12-31' },
        { startsOn: '2025-12-31', endsOn: '2026-12-31' }
      )
    ).toBe(true);

    expect(
      rangesOverlap(
        { startsOn: '2025-01-01', endsOn: '2025-12-30' },
        { startsOn: '2025-12-31', endsOn: '2026-12-31' }
      )
    ).toBe(false);
  });

  it('vigência aberta se sobrepõe a tudo que vier depois', () => {
    expect(
      rangesOverlap(
        { startsOn: '2020-01-01', endsOn: null },
        { startsOn: '2030-01-01', endsOn: '2030-12-31' }
      )
    ).toBe(true);
  });

  it('cobrir uma data inclui o primeiro e o último dia', () => {
    const v = { startsOn: '2025-03-01', endsOn: '2025-03-31' };
    expect(coversDate(v, '2025-03-01')).toBe(true);
    expect(coversDate(v, '2025-03-31')).toBe(true);
    expect(coversDate(v, '2025-04-01')).toBe(false);
  });

  it('expirado é derivado da data, não de alguém rodar a varredura', () => {
    const v = { startsOn: '2025-01-01', endsOn: '2025-06-30' };
    expect(contractStatusOn('active', v, '2025-06-30')).toBe('active');
    expect(contractStatusOn('active', v, '2025-07-01')).toBe('expired');
  });

  it('decisão humana vence o calendário', () => {
    const v = { startsOn: '2025-01-01', endsOn: '2025-06-30' };
    expect(contractStatusOn('suspended', v, '2025-03-01')).toBe('suspended');
    expect(contractStatusOn('terminated', v, '2025-12-01')).toBe('terminated');
  });

  it('conta dias entre datas', () => {
    expect(daysBetween('2025-01-01', '2025-02-01')).toBe(31);
    expect(daysBetween('2025-03-01', '2025-02-28')).toBe(-1);
  });
});

describe('especificidade da cobertura', () => {
  it('quem nomeia o ativo vence quem cobre o cliente', () => {
    const ativo = coverageSpecificity({ kind: 'asset', hasCategoryFilter: false, depth: 0 });
    const cliente = coverageSpecificity({ kind: 'customer', hasCategoryFilter: false, depth: 0 });
    expect(ativo).toBeGreaterThan(cliente);
  });

  it('subárvore mais funda vence subárvore mais rasa', () => {
    const fundo = coverageSpecificity({ kind: 'location_subtree', hasCategoryFilter: false, depth: 4 });
    const raso = coverageSpecificity({ kind: 'location_subtree', hasCategoryFilter: false, depth: 1 });
    expect(fundo).toBeGreaterThan(raso);
  });

  it('subárvore com filtro de categoria vence a mesma subárvore sem filtro', () => {
    const com = coverageSpecificity({ kind: 'location_subtree', hasCategoryFilter: true, depth: 2 });
    const sem = coverageSpecificity({ kind: 'location_subtree', hasCategoryFilter: false, depth: 2 });
    expect(com).toBeGreaterThan(sem);
  });

  it('a ordem é total: nunca há empate entre espécies diferentes', () => {
    const valores = [
      coverageSpecificity({ kind: 'asset', hasCategoryFilter: false, depth: 0 }),
      coverageSpecificity({ kind: 'location_subtree', hasCategoryFilter: false, depth: 0 }),
      coverageSpecificity({ kind: 'asset_category', hasCategoryFilter: false, depth: 0 }),
      coverageSpecificity({ kind: 'customer', hasCategoryFilter: false, depth: 0 }),
    ];
    expect(new Set(valores).size).toBe(4);
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
  });
});

describe('renovação', () => {
  const base = { startsOn: '2024-01-01', endsOn: '2025-12-31', autoRenew: false, renewalNoticeDays: 60 };

  it('não avisa antes de 90 dias', () => {
    expect(renewalAlert(base, '2025-09-01')).toBeNull();
  });

  it('avisa no marco mais próximo já cruzado', () => {
    expect(renewalAlert(base, '2025-10-05')?.threshold).toBe(90);
    expect(renewalAlert(base, '2025-11-05')?.threshold).toBe(60);
    expect(renewalAlert(base, '2025-12-05')?.threshold).toBe(30);
  });

  it('não avisa depois de vencido — aí não é aviso, é outro fato', () => {
    expect(renewalAlert(base, '2026-01-05')).toBeNull();
  });

  it('vigência aberta não vence, logo não avisa', () => {
    expect(renewalAlert({ ...base, endsOn: null }, '2025-12-05')).toBeNull();
  });

  it('com renovação automática, o aviso diz que a janela de decisão fechou', () => {
    const auto = { ...base, autoRenew: true };
    // 45 dias para o fim, aviso prévio de 60: já renovou por omissão.
    expect(renewalAlert(auto, '2025-11-16')?.noticeWindowClosed).toBe(true);
    // 75 dias para o fim: ainda dá para avisar que não quer renovar.
    expect(renewalAlert(auto, '2025-10-17')?.noticeWindowClosed).toBe(false);
  });

  it('sem renovação automática a janela nunca fecha — não há o que evitar', () => {
    expect(renewalAlert({ ...base, autoRenew: false }, '2025-12-20')?.noticeWindowClosed).toBe(false);
    expect(noticeDeadline({ ...base, autoRenew: false })).toBeNull();
  });

  it('a data-limite do aviso é a vigência menos o prazo', () => {
    expect(noticeDeadline({ ...base, autoRenew: true })).toBe('2025-11-01');
  });
});

describe('franquia e excedente', () => {
  it('sem franquia configurada não há estado de franquia', () => {
    expect(franchiseState(null, 10)).toBeNull();
    expect(franchiseState(0, 10)).toBeNull();
  });

  it('alerta em 80 % — antes da fatura, não depois', () => {
    expect(franchiseState(10, 7)?.warning).toBe(false);
    expect(franchiseState(10, 8)?.warning).toBe(true);
    expect(franchiseState(10, 8)?.exceeded).toBe(false);
    expect(franchiseState(10, 11)?.exceeded).toBe(true);
  });

  it('o saldo restante não fica negativo — quem estourou tem zero, não -3', () => {
    expect(franchiseState(10, 13)?.remaining).toBe(0);
  });

  it('só o excedente é cobrado: a franquia já está no valor fixo', () => {
    expect(overageAmount(10, 13, 150)).toBe(450);
    expect(overageAmount(10, 8, 150)).toBe(0);
  });

  it('sem tarifa de excedente não se cobra nada — inventar preço seria pior que não cobrar', () => {
    expect(overageAmount(10, 30, null)).toBe(0);
  });

  it('sem franquia, tudo é excedente', () => {
    expect(overageAmount(null, 4, 100)).toBe(400);
  });
});

describe('glosa', () => {
  it('sem regra configurada não há cálculo — a auditoria não confirmou fórmula nenhuma', () => {
    expect(penaltyForBreaches({ percentPerBreach: null, capPercent: 10 }, 5, 10_000)).toBeNull();
  });

  it('calcula por violação e respeita o teto', () => {
    const semTeto = penaltyForBreaches({ percentPerBreach: 2, capPercent: null }, 3, 10_000);
    expect(semTeto?.percentApplied).toBe(6);
    expect(semTeto?.amount).toBe(600);

    const comTeto = penaltyForBreaches({ percentPerBreach: 2, capPercent: 5 }, 10, 10_000);
    expect(comTeto?.percentApplied).toBe(5);
    expect(comTeto?.amount).toBe(500);
  });

  it('zero violações dá zero, e ainda assim é um cálculo — não um vazio', () => {
    const r = penaltyForBreaches({ percentPerBreach: 2, capPercent: 5 }, 0, 10_000);
    expect(r).not.toBeNull();
    expect(r?.amount).toBe(0);
  });

  it('nunca se aplica sozinha', () => {
    expect(penaltyForBreaches({ percentPerBreach: 2, capPercent: null }, 3, 1000)?.applied).toBe(false);
  });
});

describe('período de medição', () => {
  it('a competência vira o primeiro e o último dia do mês', () => {
    expect(periodBounds('2025-02')).toEqual({ startsOn: '2025-02-01', endsOn: '2025-02-28' });
    expect(periodBounds('2024-02')).toEqual({ startsOn: '2024-02-01', endsOn: '2024-02-29' });
    expect(periodBounds('2025-12')).toEqual({ startsOn: '2025-12-01', endsOn: '2025-12-31' });
  });

  it('competência inválida é recusada, não silenciosamente convertida', () => {
    expect(() => periodBounds('2025-13')).toThrow(/competência inválida/);
    expect(() => periodBounds('2025')).toThrow(/competência inválida/);
  });

  it('mês sem relógio de SLA não é mês de SLA perfeito', () => {
    const r = summarizeMeasurement({
      workOrders: 3,
      laborMinutes: 90,
      partsCost: 0,
      slaTotal: 0,
      slaMet: 0,
      planExpected: 0,
      planDone: 0,
    });
    expect(r.slaRate).toBeNull();
    expect(r.planCompliance).toBeNull();
    expect(r.laborHours).toBe(1.5);
  });

  it('as taxas saem em percentual, e as violações são a diferença', () => {
    const r = summarizeMeasurement({
      workOrders: 20,
      laborMinutes: 1200,
      partsCost: 350.5,
      slaTotal: 20,
      slaMet: 17,
      planExpected: 8,
      planDone: 6,
    });
    expect(r.slaRate).toBe(85);
    expect(r.slaBreaches).toBe(3);
    expect(r.planCompliance).toBe(75);
    expect(r.laborHours).toBe(20);
  });
});
