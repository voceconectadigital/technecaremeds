import { describe, it, expect } from 'vitest';
import {
  parseCron,
  validateCron,
  cronMatches,
  dueSlot,
  nextRuns,
  countRuns,
  cronFromPeriodicity,
  MAX_LOOKBACK_MINUTES,
} from '../automation-schedule';
import { validateAction, validateActionsForTrigger } from '../automations';

const SP = 'America/Sao_Paulo';

describe('cron de cinco campos', () => {
  it('aceita listas, intervalos e passos; recusa o que não é cron', () => {
    expect(validateCron('*/15 8-18 * * 1-5')).toEqual([]);
    expect(validateCron('0 8 1,15 * *')).toEqual([]);
    expect(validateCron('0 8 * * 7')).toEqual([]);
    expect(validateCron('0 8 * *')[0]).toMatch(/cinco campos/);
    expect(validateCron('60 8 * * *')[0]).toMatch(/minuto/);
    expect(validateCron('0 8 * * seg')[0]).toMatch(/dia da semana/);
  });

  it('domingo é 0 ou 7; com dia do mês E da semana restritos vale um OU outro', () => {
    const domingo = parseCron('0 8 * * 7');
    expect(typeof domingo).not.toBe('string');
    // 2026-10-18 é domingo; 08:00 em Brasília = 11:00 UTC
    expect(cronMatches(domingo as never, new Date('2026-10-18T11:00:00Z'), SP)).toBe(true);
    const ou = parseCron('0 8 1 * 1') as never;
    expect(cronMatches(ou, new Date('2026-10-19T11:00:00Z'), SP)).toBe(true); // segunda
    expect(cronMatches(ou, new Date('2026-11-01T11:00:00Z'), SP)).toBe(true); // dia 1 (domingo)
    expect(cronMatches(ou, new Date('2026-10-20T11:00:00Z'), SP)).toBe(false);
  });
});

describe('passada devida e agenda', () => {
  it('acha a passada mais recente depois da última executada; nada antes da ativação', () => {
    const agora = new Date('2026-10-19T11:04:00Z');
    expect(dueSlot('0 8 * * 1', SP, agora, null)?.toISOString()).toBe('2026-10-19T11:00:00.000Z');
    expect(dueSlot('0 8 * * 1', SP, agora, new Date('2026-10-19T11:00:00Z'))).toBeNull();
    expect(dueSlot('0 8 * * 1', SP, agora, new Date('2026-10-19T11:02:00Z'))).toBeNull();
  });

  it('não recupera em massa: só olha MAX_LOOKBACK_MINUTES para trás', () => {
    const agora = new Date('2026-10-23T12:00:00Z');
    expect(MAX_LOOKBACK_MINUTES).toBeLessThan(7 * 1440);
    expect(dueSlot('0 8 * * 1', SP, agora, new Date('2026-10-01T00:00:00Z'))).toBeNull();
  });

  it('próximas passadas e contagem', () => {
    const de = new Date('2026-10-16T12:00:00Z');
    expect(nextRuns('0 8 * * *', SP, de, 2).map((d) => d.toISOString())).toEqual([
      '2026-10-17T11:00:00.000Z',
      '2026-10-18T11:00:00.000Z',
    ]);
    expect(countRuns('0 8 * * 1', SP, de, 28)).toBe(4);
  });

  it('periodicidade da tela vira cron', () => {
    expect(cronFromPeriodicity({ kind: 'daily', hour: 7 })).toBe('0 7 * * *');
    expect(cronFromPeriodicity({ kind: 'weekly', hour: 8, minute: 30, weekday: 1 })).toBe('30 8 * * 1');
    expect(cronFromPeriodicity({ kind: 'monthly', hour: 6, dayOfMonth: 5 })).toBe('0 6 5 * *');
  });
});

describe('ações da regra agendada', () => {
  const pessoa = '0190a0b0-0000-7000-8000-000000000001';
  it('ação de OS não cabe em regra de relógio; relatório/lembrete/tarefa não cabem em regra de evento', () => {
    expect(validateActionsForTrigger('schedule', [{ kind: 'change_status' }])).toHaveLength(1);
    expect(validateActionsForTrigger('schedule', [{ kind: 'create_work_order' }])).toEqual([]);
    expect(validateActionsForTrigger('event', [{ kind: 'send_report' }])).toHaveLength(1);
  });

  it('parâmetros: destinatários, modelo, método, 5W2H completo, valor em reais', () => {
    expect(validateAction({ kind: 'send_report', params: { recipients: [pessoa], tier: 'basic' } })).toEqual(
      []
    );
    expect(
      validateAction({ kind: 'send_report', params: { recipients: [pessoa], tier: 'gold' } })[0]
    ).toMatch(/tier/);
    expect(validateAction({ kind: 'reminder', params: { recipients: ['x'], title: 'a' } })[0]).toMatch(
      /recipients/
    );
    expect(
      validateAction({
        kind: 'create_task',
        params: { method: 'kanban', title: 'a', ownerMembershipId: pessoa },
      })[0]
    ).toMatch(/method/);
    const w = { method: '5w2h', title: 'a', ownerMembershipId: pessoa, why: 'b', where: 'c', how: 'd' };
    expect(validateAction({ kind: 'create_task', params: w })).toEqual([]);
    expect(validateAction({ kind: 'create_task', params: { ...w, how: '' } })[0]).toMatch(/how/);
    expect(validateAction({ kind: 'create_task', params: { ...w, howMuch: '1.500,00' } })[0]).toMatch(
      /howMuch/
    );
    expect(validateAction({ kind: 'create_task', params: { ...w, howMuch: '1500,50' } })).toEqual([]);
  });
});
