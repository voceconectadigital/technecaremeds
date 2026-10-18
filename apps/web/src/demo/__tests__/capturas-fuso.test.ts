/**
 * Aurora — as capturas da demonstração estão no dia de BRASÍLIA.
 *
 * As capturas antigas pediam o período do Painel com `T00:00:00.000Z`: cada
 * fatia começava às 21h do dia anterior em Brasília, e o gráfico da
 * demonstração rotulava tudo com a data de ontem. `tools/demo/capturar.test.ts`
 * passou a pedir a meia-noite de Brasília, como a tela de verdade pede.
 *
 * Este teste trava isso no ARQUIVO: refazer as capturas com o período em UTC
 * volta a falhar aqui. As contas usam `timeZone: 'America/Sao_Paulo'`
 * explicitamente, então valem em qualquer fuso em que a suíte rodar.
 */
import { describe, it, expect } from 'vitest';
import dados from '../capturas.json';

interface Captura {
  op: string;
  query: Record<string, unknown> | null;
  body: unknown;
}

const capturas = (dados as { capturas: Captura[] }).capturas;

const horaEmBrasilia = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

describe('capturas da demonstração no fuso da organização', () => {
  const paineis = capturas.filter((c) => c.op === 'insights.controlPanel');

  it('existem capturas do Painel, por dia', () => {
    expect(paineis.length).toBeGreaterThan(0);
    for (const p of paineis) expect((p.body as { granularity: string }).granularity).toBe('day');
  });

  it('toda fatia do Painel começa à meia-noite de Brasília; a última termina no fim do período', () => {
    for (const p of paineis) {
      const series = (p.body as { series: Array<{ start: string; end: string }> }).series;
      expect(series.length).toBeGreaterThan(0);
      series.forEach((f, i) => {
        expect(horaEmBrasilia(f.start), f.start).toBe('00:00');
        const ultima = i === series.length - 1;
        expect(f.end, f.end).toBe(ultima ? (p.query as { to: string }).to : series[i + 1]!.start);
      });
    }
  });

  it('o período pedido é o da tela: "últimos 30 dias" = 30 fatias, da meia-noite ao último milissegundo', () => {
    for (const p of paineis) {
      const q = p.query as { from: string; to: string };
      expect(horaEmBrasilia(q.from)).toBe('00:00');
      expect(horaEmBrasilia(q.to)).toBe('23:59');
      expect((p.body as { series: unknown[] }).series).toHaveLength(30);
    }
  });

  it('nenhum período de indicador foi pedido à meia-noite UTC', () => {
    for (const c of capturas.filter((x) => x.op.startsWith('insights.') || x.op.startsWith('inventory.'))) {
      const from = c.query?.from;
      if (typeof from === 'string') expect(horaEmBrasilia(from), `${c.op} ${from}`).toBe('00:00');
    }
  });

  it('a aba Organização tem o que mostrar na demonstração (PF-41), com a exigência desligada', () => {
    const org = capturas.find((c) => c.op === 'organizations.current');
    expect(org).toBeDefined();
    expect((org!.body as { require_operational_result: boolean }).require_operational_result).toBe(false);
  });
});
