/**
 * Aurora — do relatório à automação (REL-15) e o cartão da avaliação das OS (REL-14), 29/10/2026.
 */
import { describe, it, expect } from 'vitest';
import { automacaoDoRelatorio, parametrosDoRecorte } from '../features/automacoes/do-relatorio';
import { cartaoDaAvaliacao } from '../features/painel/rotulos';

describe('"Criar automação com estes filtros" (REL-15)', () => {
  const corpo = {
    tier: 'advanced' as const,
    indicators: ['work_orders_opened', 'sla_compliance'],
    customer_id: 'c1',
    sector_id: 's1',
    plan_kind: 'calibration',
    asset_category_id: 'f1',
    work_order_type: 'corrective',
  };

  it('a Nova automação abre com o modelo, os indicadores, o cliente, o setor e os filtros do relatório', () => {
    expect(automacaoDoRelatorio(corpo, 'Hospital A')).toEqual({
      nome: 'Relatório Advanced — Hospital A',
      tier: 'advanced',
      indicadores: ['work_orders_opened', 'sla_compliance'],
      cliente: 'c1',
      setor: 's1',
      tipoDePlano: 'calibration',
      categoria: 'f1',
      tipoDeManutencao: 'corrective',
    });
  });

  it('volta como parâmetros da ação send_report, com os nomes que o servidor confere', () => {
    expect(parametrosDoRecorte(automacaoDoRelatorio(corpo))).toEqual({
      tier: 'advanced',
      indicators: ['work_orders_opened', 'sla_compliance'],
      customerId: 'c1',
      sectorId: 's1',
      planKind: 'calibration',
      assetCategoryId: 'f1',
      workOrderType: 'corrective',
    });
  });

  it('sem filtro, só o nível — nada de campo vazio mandado ao servidor', () => {
    const i = automacaoDoRelatorio({ tier: 'basic' });
    expect(i.nome).toBe('Relatório Basic');
    expect(parametrosDoRecorte(i)).toEqual({ tier: 'basic' });
  });
});

describe('cartão "Avaliação das OS" do Painel (REL-14)', () => {
  const periodo = { from: '2026-10-01T03:00:00.000Z', to: '2026-10-31T03:00:00.000Z' };

  it('média, quantidade e período', () => {
    const c = cartaoDaAvaliacao({ average: 4.5, count: 12 }, periodo);
    expect(c.valor).toBe('4,5');
    expect(c.dica).toMatch(/^12 avaliações · \d\d\/\d\d\/\d\d a \d\d\/\d\d\/\d\d$/);
  });

  it('sem avaliação, nulo — nunca zero', () => {
    const c = cartaoDaAvaliacao({ average: null, count: 0 }, periodo);
    expect(c.valor).toBeNull();
    expect(c.vazio).toMatch(/^Nenhuma OS avaliada · /);
  });

  it('resposta antiga sem o indicador: o cartão não quebra', () => {
    expect(cartaoDaAvaliacao(undefined, undefined).valor).toBeNull();
  });
});
