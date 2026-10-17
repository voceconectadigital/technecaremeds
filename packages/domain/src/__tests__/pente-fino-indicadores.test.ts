/**
 * Aurora — pendências de indicadores do pente-fino de 17/10/2026 (domínio).
 *
 * PF-51: o dia é o do calendário no fuso da organização, e não o de UTC.
 * PF-52: o "mês anterior" do relatório agendado é o mês civil local.
 * Seleção de indicadores conferida ao SALVAR a regra agendada.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ORGANIZATION_TIMEZONE,
  addDaysToDay,
  dayOf,
  endOfLocalDay,
  localDay,
  previousLocalMonth,
  reportSelectionProblem,
  safeTimezone,
  startOfLocalDay,
  validateAction,
} from '../index';

describe('dia local (PF-51)', () => {
  it('31/10 às 21h30 em Brasília ainda é 31/10 — em UTC já seria 01/11', () => {
    const noite = new Date('2026-11-01T00:30:00Z');
    expect(noite.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(localDay(noite)).toBe('2026-10-31');
    expect(dayOf(noite)).toBe('2026-10-31');
    expect(dayOf(noite, 'UTC')).toBe('2026-11-01');
    expect(dayOf(noite, 'America/Manaus')).toBe('2026-10-31');
  });

  it('o padrão é o fuso padrão da organização; fuso inválido cai no padrão sem lançar', () => {
    expect(DEFAULT_ORGANIZATION_TIMEZONE).toBe('America/Sao_Paulo');
    expect(safeTimezone(null)).toBe('America/Sao_Paulo');
    expect(safeTimezone('Marte/Olympus')).toBe('America/Sao_Paulo');
    expect(safeTimezone('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(localDay(new Date('2026-11-01T00:30:00Z'), 'Marte/Olympus')).toBe('2026-10-31');
  });

  it('meia-noite e fim do dia locais; aritmética de calendário atravessa mês e ano', () => {
    expect(startOfLocalDay('2026-10-17').toISOString()).toBe('2026-10-17T03:00:00.000Z');
    expect(endOfLocalDay('2026-10-31').toISOString()).toBe('2026-11-01T02:59:59.999Z');
    expect(addDaysToDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToDay('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('mês anterior (PF-52)', () => {
  it('a passada de 01/11 08:00 (Brasília) é outubro inteiro, de 01/10 a 31/10 23:59:59.999', () => {
    const m = previousLocalMonth(new Date('2026-11-01T11:00:00Z'));
    expect(m.firstDay).toBe('2026-10-01');
    expect(m.lastDay).toBe('2026-10-31');
    expect(m.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-11-01T02:59:59.999Z');
  });

  it('01/11 às 00:30 UTC ainda é 31/10 em Brasília: o mês anterior é SETEMBRO', () => {
    const m = previousLocalMonth(new Date('2026-11-01T00:30:00Z'));
    expect(m.firstDay).toBe('2026-09-01');
    expect(m.lastDay).toBe('2026-09-30');
  });

  it('janeiro → dezembro do ano anterior; fevereiro bissexto', () => {
    expect(previousLocalMonth(new Date('2027-01-05T12:00:00Z'))).toMatchObject({
      firstDay: '2026-12-01',
      lastDay: '2026-12-31',
    });
    expect(previousLocalMonth(new Date('2028-03-01T12:00:00Z')).lastDay).toBe('2028-02-29');
  });
});

describe('seleção de indicadores (relatório sob demanda e regra agendada)', () => {
  it('fora do modelo, aguardando definição ou válida', () => {
    expect(reportSelectionProblem('basic', ['sla_compliance'])).toMatch(/fora do modelo Basic/);
    expect(reportSelectionProblem('basic', ['requests_fulfilled_ratio'])).toMatch(/aguardando definição/);
    expect(reportSelectionProblem('advanced', ['sla_compliance', 'mttr'])).toBeNull();
  });

  const relatorio = (params: Record<string, unknown>) =>
    validateAction({
      kind: 'send_report',
      params: { recipients: ['0193dd00-0002-7000-8000-00000000d001'], tier: 'basic', ...params },
    });

  it('a regra agendada confere a lista AO SALVAR', () => {
    expect(relatorio({ indicators: ['sla_compliance'] }).join()).toMatch(/fora do modelo Basic/);
    expect(relatorio({ indicators: ['requests_fulfilled_ratio'] }).join()).toMatch(/aguardando definição/);
    expect(relatorio({ indicators: 'mttr' }).join()).toMatch(/"indicators" é uma lista/);
    expect(relatorio({ indicators: ['mttr', 'work_orders_opened'] })).toEqual([]);
    expect(relatorio({})).toEqual([]);
  });

  it('período: dias (o de sempre) ou mês anterior — nunca os dois', () => {
    expect(relatorio({ periodDays: 30 })).toEqual([]);
    expect(relatorio({ periodo: 'mes_anterior' })).toEqual([]);
    expect(relatorio({ periodo: 'trimestre' }).join()).toMatch(/"periodo" é mes_anterior/);
    expect(relatorio({ periodo: 'mes_anterior', periodDays: 30 }).join()).toMatch(/não os dois/);
  });
});
