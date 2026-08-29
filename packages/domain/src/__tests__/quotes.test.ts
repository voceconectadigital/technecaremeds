/**
 * Aurora — aritmética e grafo de orçamentos (SPEC v0.2 §16 · EPIC-016).
 */
import { describe, it, expect } from 'vitest';
import {
  QUOTE_TRANSITIONS,
  allowedQuoteTransitions,
  canTransitionQuote,
  toCents,
  fromCents,
  percentOf,
  itemTotal,
  computeTotals,
  effectiveStatus,
  resolvePrice,
  blockersToSend,
  TERMINAL_QUOTE_STATUSES,
  type QuoteItemInput,
} from '../quotes';

describe('grafo', () => {
  it('não há transição saindo de situação terminal', () => {
    for (const terminal of TERMINAL_QUOTE_STATUSES) {
      expect(allowedQuoteTransitions(terminal)).toHaveLength(0);
    }
  });

  it('aprovar exige permissão diferente de editar', () => {
    expect(canTransitionQuote('viewed', 'approved')?.permission).toBe('quote.approve');
    expect(canTransitionQuote('draft', 'sent')?.permission).toBe('quote.send');
    expect(canTransitionQuote('approved', 'invoiced')?.permission).toBe('quote.invoice');
  });

  it('a proposta enviada e nunca aberta ainda expira', () => {
    expect(canTransitionQuote('sent', 'expired')).not.toBeNull();
    expect(canTransitionQuote('viewed', 'expired')).not.toBeNull();
  });

  it('não se aprova rascunho — sem enviar não há o que o cliente tenha visto', () => {
    expect(canTransitionQuote('draft', 'approved')).toBeNull();
  });

  it('não se volta de faturado', () => {
    expect(canTransitionQuote('invoiced', 'draft')).toBeNull();
    expect(canTransitionQuote('invoiced', 'approved')).toBeNull();
  });

  it('cada par origem-destino aparece uma vez só', () => {
    const pares = QUOTE_TRANSITIONS.map((t) => `${t.from}→${t.to}`);
    expect(new Set(pares).size).toBe(pares.length);
  });
});

describe('dinheiro em centavos', () => {
  it('converte ida e volta sem perder centavo', () => {
    expect(toCents(1234.56)).toBe(123_456);
    expect(fromCents(123_456)).toBe(1234.56);
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
  });

  it('o percentual arredonda meio para cima', () => {
    expect(percentOf(1000, 10)).toBe(100);
    expect(percentOf(1005, 50)).toBe(503);
  });

  it('percentual fora da faixa é recusado', () => {
    expect(() => percentOf(1000, -1)).toThrow(/percentual inválido/);
    expect(() => percentOf(1000, 101)).toThrow(/percentual inválido/);
  });

  it('a linha arredonda uma vez, na própria linha', () => {
    const t = itemTotal({
      kind: 'service',
      description: 'Mão de obra',
      quantity: 1.5,
      unitPriceCents: 33_333,
    });
    expect(t.grossCents).toBe(50_000);
    expect(t.netCents).toBe(50_000);
  });

  it('desconto maior que a linha é recusado', () => {
    expect(() =>
      itemTotal({
        kind: 'part',
        description: 'Filtro',
        quantity: 1,
        unitPriceCents: 1000,
        discountCents: 1001,
      })
    ).toThrow(/maior que o valor da linha/);
  });

  it('quantidade zero ou negativa é recusada', () => {
    expect(() => itemTotal({ kind: 'part', description: 'x', quantity: 0, unitPriceCents: 100 })).toThrow(
      /quantidade deve ser positiva/
    );
  });
});

describe('totais', () => {
  const itens: QuoteItemInput[] = [
    { kind: 'part', description: 'Filtro', quantity: 2, unitPriceCents: 15_000 },
    { kind: 'part', description: 'Válvula', quantity: 1, unitPriceCents: 8_000, discountCents: 500 },
    { kind: 'service', description: 'Mão de obra', quantity: 3, unitPriceCents: 12_000 },
  ];

  it('soma as linhas já líquidas e separa o desconto de linha', () => {
    const t = computeTotals({ items: itens });
    expect(t.subtotalCents).toBe(30_000 + 7_500 + 36_000);
    expect(t.itemDiscountCents).toBe(500);
    expect(t.totalCents).toBe(t.subtotalCents);
  });

  it('desconto geral em percentual incide sobre o subtotal', () => {
    const t = computeTotals({ items: itens, discountPercent: 10 });
    expect(t.generalDiscountCents).toBe(percentOf(73_500, 10));
    expect(t.totalCents).toBe(73_500 - 7_350);
  });

  it('valor e percentual juntos são recusados — a ordem de aplicação surpreenderia metade', () => {
    expect(() => computeTotals({ items: itens, discountCents: 100, discountPercent: 5 })).toThrow(
      /não os dois/
    );
  });

  it('desconto geral maior que o subtotal é recusado', () => {
    expect(() => computeTotals({ items: itens, discountCents: 999_999 })).toThrow(/maior que o subtotal/);
  });

  it('acréscimo e imposto entram depois do desconto', () => {
    const t = computeTotals({
      items: itens,
      discountCents: 3_500,
      additionsCents: 1_000,
      taxesCents: 2_000,
    });
    expect(t.totalCents).toBe(73_500 - 3_500 + 1_000 + 2_000);
  });

  it('orçamento sem itens tem total zero, não erro', () => {
    expect(computeTotals({ items: [] }).totalCents).toBe(0);
  });
});

describe('validade', () => {
  it('expira sozinho, sem depender da varredura', () => {
    expect(effectiveStatus('sent', '2025-03-10', '2025-03-11')).toBe('expired');
    // No último dia de validade a proposta ainda vale: a validade é um prazo
    // até o fim daquele dia, não até a véspera.
    expect(effectiveStatus('viewed', '2025-03-10', '2025-03-10')).toBe('viewed');
  });

  it('o que já foi decidido não expira depois', () => {
    expect(effectiveStatus('approved', '2020-01-01', '2025-01-01')).toBe('approved');
    expect(effectiveStatus('rejected', '2020-01-01', '2025-01-01')).toBe('rejected');
  });

  it('sem validade informada nada expira', () => {
    expect(effectiveStatus('sent', null, '2099-01-01')).toBe('sent');
  });
});

describe('cascata de preço', () => {
  it('o alias do cliente vence a tabela do contrato, que vence o catálogo', () => {
    expect(resolvePrice({ customerAliasCents: 100, contractListCents: 200, catalogCents: 300 })).toEqual({
      cents: 100,
      source: 'customer_alias',
    });

    expect(resolvePrice({ contractListCents: 200, catalogCents: 300 })).toEqual({
      cents: 200,
      source: 'contract_price_list',
    });

    expect(resolvePrice({ catalogCents: 300 })).toEqual({ cents: 300, source: 'catalog' });
  });

  it('preço zero é resposta, não ausência — cortesia acordada existe', () => {
    expect(resolvePrice({ customerAliasCents: 0, catalogCents: 300 })).toEqual({
      cents: 0,
      source: 'customer_alias',
    });
  });

  it('sem nenhum degrau, não se inventa preço', () => {
    expect(resolvePrice({})).toBeNull();
  });
});

describe('o que impede enviar', () => {
  it('devolve todas as pendências de uma vez', () => {
    const faltas = blockersToSend({
      itemCount: 0,
      totalCents: 0,
      validUntil: null,
      approverContactId: null,
    });
    expect(faltas).toHaveLength(4);
  });

  it('proposta completa não tem pendência', () => {
    expect(
      blockersToSend({
        itemCount: 3,
        totalCents: 73_500,
        validUntil: '2025-12-31',
        approverContactId: 'c1',
      })
    ).toEqual([]);
  });
});
