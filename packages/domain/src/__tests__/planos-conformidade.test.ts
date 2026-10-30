/**
 * Aurora — a fronteira de "vencido" dos itens de plano (PLN-03, reunião 16/10/2026).
 *
 * "Vencido" só depois do PRAZO FINAL: vencimento + tolerância da tarefa. Antes disso o item é
 * pendente — no prazo —, esteja ou não alguém trabalhando nele.
 */
import { describe, it, expect } from 'vitest';
import { complianceState, summarizeCompliance, type ItemFacts } from '../maintenance-plans';

const DIA = 86_400_000;
const DUE = '2026-04-01T00:00:00.000Z';
const due = new Date(DUE).getTime();
const item = (extra: Partial<ItemFacts> = {}): ItemFacts => ({
  dueAt: DUE,
  toleranceDays: 5,
  status: 'generated',
  workOrderCategory: 'open',
  ...extra,
});

describe('PLN-03 · vencido = due_at + tolerância', () => {
  it('um dia ANTES do fim da tolerância ainda é no prazo', () => {
    expect(complianceState(item(), new Date(due + 4 * DIA))).toBe('on_time_not_started');
  });

  it('no instante exato do fim da tolerância ainda é no prazo', () => {
    expect(complianceState(item(), new Date(due + 5 * DIA))).toBe('on_time_not_started');
  });

  it('um dia DEPOIS do fim da tolerância é vencido', () => {
    expect(complianceState(item(), new Date(due + 6 * DIA))).toBe('late_not_started');
  });

  it('passado o vencimento mas dentro da tolerância não é vencido', () => {
    expect(complianceState(item(), new Date(due + DIA))).toBe('on_time_not_started');
  });

  it('sem tolerância, um dia depois do vencimento já é vencido', () => {
    expect(complianceState(item({ toleranceDays: 0 }), new Date(due + DIA))).toBe('late_not_started');
    expect(complianceState(item({ toleranceDays: 0 }), new Date(due - DIA))).toBe('on_time_not_started');
  });

  it('em andamento distingue "atrasado, em andamento" de "atrasado, sem ninguém"', () => {
    const emAndamento = item({ workOrderCategory: 'in_progress' });
    expect(complianceState(emAndamento, new Date(due + 4 * DIA))).toBe('on_time_started');
    expect(complianceState(emAndamento, new Date(due + 6 * DIA))).toBe('late_started');
  });

  it('feito e dispensado não vencem nunca', () => {
    const muitoDepois = new Date(due + 365 * DIA);
    expect(complianceState(item({ status: 'done' }), muitoDepois)).toBe('done');
    expect(complianceState(item({ workOrderCategory: 'closed' }), muitoDepois)).toBe('done');
    expect(complianceState(item({ status: 'skipped' }), muitoDepois)).toBe('skipped');
  });

  it('o resumo conta vencidos pela mesma fronteira e tira os dispensados do denominador', () => {
    const itens = [item(), item({ status: 'done' }), item({ status: 'skipped' })];
    const antes = summarizeCompliance(itens, new Date(due + 4 * DIA));
    const depois = summarizeCompliance(itens, new Date(due + 6 * DIA));
    expect(antes.late).toBe(0);
    expect(depois.late).toBe(1);
    // 1 feito ÷ (3 programados − 1 dispensado).
    expect(depois.rate).toBe(50);
  });
});
