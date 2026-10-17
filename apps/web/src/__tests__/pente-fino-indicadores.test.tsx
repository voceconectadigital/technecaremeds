/**
 * Aurora — pendências de indicadores do pente-fino de 17/10/2026 (web).
 *
 *   · PF-72 — "hoje" e os períodos do Painel no calendário LOCAL, e não em UTC;
 *   · PF-55 — cor do Painel contra a meta configurada; sem meta, neutra;
 *   · PF-54 — a meta da seção (ou SEM META CONFIGURADA), a mesma peça na prévia
 *     do relatório e no relatório agendado.
 *
 * As contas são feitas contra o próprio relógio local do processo, então o
 * teste vale em qualquer fuso em que a suíte rodar.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  diaLocal,
  diaLocalDaqui,
  fimDoDiaLocal,
  hojeLocal,
  inicioDoDiaLocal,
  somarDias,
} from '@aurora/app-kit';
import { intervaloDe, rotuloDaFatia } from '../features/painel/rotulos';
import { intervaloDoPainel, textoDaMeta, tomPelaMeta } from '../features/painel/dados';
import { MetaDaSecao } from '../features/painel/relatorio';

describe('dia local (PF-72)', () => {
  it('31/10 às 22h30 no relógio local é 31/10, seja qual for o deslocamento de UTC', () => {
    expect(diaLocal(new Date(2026, 9, 31, 22, 30))).toBe('2026-10-31');
    expect(diaLocal(new Date(2026, 9, 31, 0, 5))).toBe('2026-10-31');
    expect(hojeLocal()).toBe(diaLocal(new Date()));
    expect(diaLocalDaqui(0)).toBe(hojeLocal());
  });

  it('soma de dias atravessa mês, ano e bissexto', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('meia-noite e fim do dia LOCAIS', () => {
    expect(inicioDoDiaLocal('2026-10-17').getTime()).toBe(new Date(2026, 9, 17).getTime());
    expect(fimDoDiaLocal('2026-10-17').getTime()).toBe(new Date(2026, 9, 17, 23, 59, 59, 999).getTime());
    expect(Number.isNaN(inicioDoDiaLocal('lixo').getTime())).toBe(true);
  });
});

describe('períodos do Painel (PF-51/PF-72)', () => {
  it('7 dias às 22h30 de 17/10: de 11/10 00:00 a 17/10 23:59:59.999, locais', () => {
    const i = intervaloDe('7d', new Date(2026, 9, 17, 22, 30));
    expect(i.from).toBe(new Date(2026, 9, 11).toISOString());
    expect(i.to).toBe(new Date(2026, 9, 17, 23, 59, 59, 999).toISOString());
  });

  it('período personalizado em dias locais; data malformada vira mensagem, não consulta', () => {
    const i = intervaloDoPainel({ periodo: 'custom', de: '2026-10-01', ate: '2026-10-31' });
    expect(i).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 31, 23, 59, 59, 999).toISOString(),
      problema: null,
    });
    expect(
      intervaloDoPainel({ periodo: 'custom', de: '2026-10-xx', ate: '2026-10-yy' }).problema
    ).toBeTruthy();
  });

  it('o rótulo da fatia é o dia local de início', () => {
    expect(rotuloDaFatia(new Date(2026, 9, 17).toISOString(), 'day')).toBe('17/10');
    expect(rotuloDaFatia(new Date(2026, 9, 1).toISOString(), 'month')).toBe('out/26');
  });
});

describe('cor pela meta (PF-55)', () => {
  const meta = (value: number, direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER') => ({
    id: '0193dd00-0000-7000-8000-000000000001',
    value,
    unit: 'percent',
    direction,
    scope: 'organization' as const,
    valid_from: '2026-01-01',
    valid_to: null,
  });

  it('sem meta ou sem número → neutro; com meta, no sentido dela (igualdade cumpre)', () => {
    expect(tomPelaMeta(70, null)).toBe('neutral');
    expect(tomPelaMeta(null, meta(90, 'HIGHER_IS_BETTER'))).toBe('neutral');
    expect(tomPelaMeta(90, meta(90, 'HIGHER_IS_BETTER'))).toBe('good');
    expect(tomPelaMeta(89.9, meta(90, 'HIGHER_IS_BETTER'))).toBe('bad');
    expect(tomPelaMeta(30, meta(60, 'LOWER_IS_BETTER'))).toBe('good');
    expect(tomPelaMeta(61, meta(60, 'LOWER_IS_BETTER'))).toBe('bad');
  });

  it('o texto diz de onde vem a cor', () => {
    expect(textoDaMeta(null)).toBe('sem meta');
    expect(textoDaMeta(meta(95, 'HIGHER_IS_BETTER'))).toBe('meta ≥ 95 %');
  });
});

describe('meta da seção (PF-54)', () => {
  it('sem meta: SEM META CONFIGURADA; com meta: valor, escopo e resultado', () => {
    const { rerender } = render(
      <MetaDaSecao
        s={{ target: null, target_evaluation: 'no_target', target_label: 'SEM META CONFIGURADA' }}
      />
    );
    expect(screen.getByText('SEM META CONFIGURADA')).toBeTruthy();
    rerender(
      <MetaDaSecao
        s={{
          target: { value: 95, unit: 'percent', direction: 'HIGHER_IS_BETTER', scope: 'customer' },
          target_evaluation: 'met',
          target_label: null,
        }}
      />
    );
    expect(screen.getByText(/Meta ≥ 95/)).toBeTruthy();
    expect(screen.getByText(/do cliente/)).toBeTruthy();
    expect(screen.getByText('Meta cumprida')).toBeTruthy();
  });

  it('indicador informativo não mostra meta nenhuma', () => {
    const { container } = render(
      <MetaDaSecao s={{ target: null, target_evaluation: 'informational', target_label: null }} />
    );
    expect(container.textContent).toBe('');
  });
});
