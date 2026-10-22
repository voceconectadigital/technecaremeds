/**
 * Aurora — janela de 12 meses dos gráficos dos relatórios (22/10/2026).
 * Meses civis no fuso da organização: a virada de ano e o fuso não podem deslocar o mês.
 */
import { describe, it, expect } from 'vitest';
import { localMonthOfDay, trailingLocalMonths } from '../dia-local';

const SP = 'America/Sao_Paulo';

describe('localMonthOfDay', () => {
  it('vai do dia 1 ao último dia, de meia-noite a 23:59:59.999 locais', () => {
    const m = localMonthOfDay('2026-09-17', SP);
    expect(m.firstDay).toBe('2026-09-01');
    expect(m.lastDay).toBe('2026-09-30');
    expect(m.from.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-10-01T02:59:59.999Z');
  });
  it('fevereiro de ano bissexto e dezembro', () => {
    expect(localMonthOfDay('2028-02-10', SP).lastDay).toBe('2028-02-29');
    expect(localMonthOfDay('2026-12-31', SP).lastDay).toBe('2026-12-31');
  });
});

describe('trailingLocalMonths', () => {
  it('12 meses terminando no mês do dia, do mais antigo ao mais recente, atravessando o ano', () => {
    const meses = trailingLocalMonths('2026-09-30', 12, SP);
    expect(meses).toHaveLength(12);
    expect(meses[0]!.firstDay).toBe('2025-10-01');
    expect(meses[2]!.firstDay).toBe('2025-12-01');
    expect(meses[3]!.firstDay).toBe('2026-01-01');
    expect(meses[11]!.firstDay).toBe('2026-09-01');
  });
  it('meses consecutivos não se sobrepõem nem deixam lacuna', () => {
    const meses = trailingLocalMonths('2026-02-15', 12, SP);
    for (let i = 1; i < meses.length; i++) {
      expect(meses[i]!.from.getTime()).toBe(meses[i - 1]!.to.getTime() + 1);
    }
  });
});
