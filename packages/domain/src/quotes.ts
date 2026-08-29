/**
 * Aurora — orçamentos (SPEC v0.2 §16 · EPIC-016).
 *
 * O orçamento é o que destrava a OS parada: o motivo de espera "aguardando
 * aprovação de orçamento" já existe na máquina de estados desde o EPIC-008, e
 * até aqui não havia o que aprovar.
 *
 * DUAS DECISÕES QUE ATRAVESSAM O ARQUIVO
 *
 * 1. DINHEIRO É INTEIRO, EM CENTAVOS
 *    `0.1 + 0.2` não é `0.3` em ponto flutuante, e um orçamento de trinta
 *    linhas acumula essa diferença até o total não bater com a soma que o
 *    cliente faz na calculadora. Toda a aritmética daqui é em centavos
 *    inteiros; a conversão acontece na borda, uma vez.
 *
 * 2. REVISAR CRIA VERSÃO, NÃO REESCREVE
 *    A referência tem "Modificar", que sobrescreve. O histórico de propostas é
 *    argumento comercial — saber que a primeira versão custava 40 % mais é o
 *    que sustenta a conversa de desconto — e uma proposta sobrescrita apaga
 *    justamente isso. Aqui a versão anterior fica `superseded`, visível.
 */

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'approved',
  'rejected',
  'expired',
  'in_execution',
  'invoiced',
  'closed',
  'cancelled',
  'superseded',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_NATURES = ['parts', 'services', 'parts_and_services'] as const;
export type QuoteNature = (typeof QUOTE_NATURES)[number];

export const QUOTE_ITEM_KINDS = ['part', 'service'] as const;
export type QuoteItemKind = (typeof QUOTE_ITEM_KINDS)[number];

/** Situações a partir das quais nada mais acontece. */
export const TERMINAL_QUOTE_STATUSES: readonly QuoteStatus[] = Object.freeze([
  'rejected',
  'expired',
  'closed',
  'cancelled',
  'superseded',
]);

export interface QuoteTransition {
  readonly from: QuoteStatus;
  readonly to: QuoteStatus;
  readonly permission: string;
  /** Quem pode fazer, em linguagem de gente — a mensagem de recusa usa isto. */
  readonly label: string;
}

/**
 * O grafo do §16, declarado.
 *
 * `sent → expired` e `viewed → expired` existem porque a validade vence sozinha:
 * um orçamento enviado e nunca aberto expira do mesmo jeito que um aberto e não
 * decidido. Deixar de fora o primeiro caso faria a proposta esquecida ficar
 * eternamente "enviada", e o funil comercial contaria como viva uma proposta
 * que morreu há seis meses.
 */
export const QUOTE_TRANSITIONS: readonly QuoteTransition[] = Object.freeze([
  { from: 'draft', to: 'sent', permission: 'quote.send', label: 'enviar ao cliente' },
  { from: 'draft', to: 'cancelled', permission: 'quote.update', label: 'cancelar' },
  { from: 'sent', to: 'viewed', permission: 'quote.read', label: 'registrar abertura' },
  { from: 'sent', to: 'approved', permission: 'quote.approve', label: 'aprovar' },
  { from: 'sent', to: 'rejected', permission: 'quote.approve', label: 'recusar' },
  { from: 'sent', to: 'expired', permission: 'quote.update', label: 'expirar' },
  { from: 'sent', to: 'cancelled', permission: 'quote.update', label: 'cancelar' },
  { from: 'viewed', to: 'approved', permission: 'quote.approve', label: 'aprovar' },
  { from: 'viewed', to: 'rejected', permission: 'quote.approve', label: 'recusar' },
  { from: 'viewed', to: 'expired', permission: 'quote.update', label: 'expirar' },
  { from: 'viewed', to: 'cancelled', permission: 'quote.update', label: 'cancelar' },
  { from: 'approved', to: 'in_execution', permission: 'quote.update', label: 'iniciar execução' },
  { from: 'approved', to: 'invoiced', permission: 'quote.invoice', label: 'faturar' },
  { from: 'in_execution', to: 'invoiced', permission: 'quote.invoice', label: 'faturar' },
  { from: 'invoiced', to: 'closed', permission: 'quote.update', label: 'encerrar' },
]);

export function allowedQuoteTransitions(from: QuoteStatus): readonly QuoteTransition[] {
  return QUOTE_TRANSITIONS.filter((t) => t.from === from);
}

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): QuoteTransition | null {
  return QUOTE_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/* -------------------------------------------------------------------------- */
/* dinheiro                                                                    */
/* -------------------------------------------------------------------------- */

/** Centavos. O tipo é `number`, mas o contrato é: inteiro, sempre. */
export type Cents = number;

export function toCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`valor monetário inválido: ${value}`);
  return Math.round(value * 100);
}

export function fromCents(value: Cents): number {
  return Number((value / 100).toFixed(2));
}

/**
 * Percentual aplicado sobre um valor em centavos.
 *
 * O arredondamento é meio-para-cima e acontece UMA vez, no fim. Aplicar
 * percentual linha a linha e somar depois dá resultado diferente de somar e
 * aplicar no fim — a diferença é de centavos, e é exatamente a diferença que o
 * cliente encontra ao conferir e que custa uma ligação para explicar.
 */
export function percentOf(amount: Cents, percent: number): Cents {
  if (percent < 0 || percent > 100) throw new RangeError(`percentual inválido: ${percent}`);
  return Math.round((amount * percent) / 100);
}

export interface QuoteItemInput {
  readonly kind: QuoteItemKind;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: Cents;
  /** Desconto da linha, em centavos. */
  readonly discountCents?: Cents;
}

export interface QuoteItemTotal {
  readonly grossCents: Cents;
  readonly discountCents: Cents;
  readonly netCents: Cents;
}

/**
 * O total de uma linha.
 *
 * A quantidade é decimal (0,5 hora de serviço é legítimo) e o preço é inteiro,
 * então o produto arredonda aqui — uma vez, na linha, e nunca mais. Deixar a
 * fração correr até o total faria a soma das linhas impressas não bater com o
 * total impresso, no mesmo papel.
 */
export function itemTotal(item: QuoteItemInput): QuoteItemTotal {
  if (!(item.quantity > 0)) throw new RangeError('quantidade deve ser positiva');
  if (item.unitPriceCents < 0) throw new RangeError('preço unitário não pode ser negativo');

  const bruto = Math.round(item.quantity * item.unitPriceCents);
  const desconto = item.discountCents ?? 0;
  if (desconto < 0) throw new RangeError('desconto não pode ser negativo');
  if (desconto > bruto) {
    throw new RangeError('desconto da linha não pode ser maior que o valor da linha');
  }

  return { grossCents: bruto, discountCents: desconto, netCents: bruto - desconto };
}

export interface QuoteTotalsInput {
  readonly items: readonly QuoteItemInput[];
  /** Desconto geral em centavos. Excludente com `discountPercent`. */
  readonly discountCents?: Cents;
  readonly discountPercent?: number;
  readonly additionsCents?: Cents;
  readonly taxesCents?: Cents;
}

export interface QuoteTotals {
  readonly subtotalCents: Cents;
  readonly itemDiscountCents: Cents;
  readonly generalDiscountCents: Cents;
  readonly additionsCents: Cents;
  readonly taxesCents: Cents;
  readonly totalCents: Cents;
}

/**
 * Os totais do orçamento (§16 — bloco ausente na referência).
 *
 * A referência não tem totais estruturados: desconto, acréscimo e imposto, quando
 * existem, viram linha de texto. O efeito prático é que ninguém consegue
 * responder "quanto demos de desconto no trimestre" sem abrir proposta por
 * proposta.
 *
 * Desconto geral em valor e em percentual são excludentes de propósito. Aceitar
 * os dois obrigaria a decidir uma ordem de aplicação, e qualquer ordem que se
 * escolha vai surpreender metade dos usuários — sem contar que o vendedor que
 * preenche os dois quase sempre queria só um.
 */
export function computeTotals(input: QuoteTotalsInput): QuoteTotals {
  if (input.discountCents != null && input.discountPercent != null) {
    throw new RangeError('informe desconto geral em valor OU em percentual, não os dois');
  }

  let bruto = 0;
  let descontoLinhas = 0;
  for (const item of input.items) {
    const t = itemTotal(item);
    bruto += t.netCents;
    descontoLinhas += t.discountCents;
  }

  const descontoGeral =
    input.discountPercent != null ? percentOf(bruto, input.discountPercent) : (input.discountCents ?? 0);

  if (descontoGeral > bruto) {
    throw new RangeError('desconto geral não pode ser maior que o subtotal');
  }

  const acrescimos = input.additionsCents ?? 0;
  const impostos = input.taxesCents ?? 0;

  return {
    subtotalCents: bruto,
    itemDiscountCents: descontoLinhas,
    generalDiscountCents: descontoGeral,
    additionsCents: acrescimos,
    taxesCents: impostos,
    totalCents: bruto - descontoGeral + acrescimos + impostos,
  };
}

/* -------------------------------------------------------------------------- */
/* validade                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A situação efetiva, considerando a validade.
 *
 * Derivada, e não dependente de varredura, pela mesma razão dos contratos: um
 * orçamento que só expira quando o cron roda é um orçamento que pode ser
 * aprovado depois de vencido toda vez que o cron falha — e aí a promessa de
 * preço que a empresa fez há seis meses vira compromisso de hoje.
 */
export function effectiveStatus(stored: QuoteStatus, validUntil: string | null, today: string): QuoteStatus {
  if (stored !== 'sent' && stored !== 'viewed') return stored;
  if (validUntil === null) return stored;
  return today > validUntil ? 'expired' : stored;
}

/* -------------------------------------------------------------------------- */
/* preço                                                                       */
/* -------------------------------------------------------------------------- */

export const PRICE_SOURCES = ['customer_alias', 'contract_price_list', 'catalog', 'manual'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface PriceCandidates {
  readonly customerAliasCents?: Cents | null;
  readonly contractListCents?: Cents | null;
  readonly catalogCents?: Cents | null;
}

export interface ResolvedPrice {
  readonly cents: Cents;
  readonly source: PriceSource;
}

/**
 * A cascata de preço do §16: alias do cliente → tabela do contrato → catálogo.
 *
 * Devolve a ORIGEM junto com o valor, e não só o número. Quem monta a proposta
 * precisa saber por que aquele preço apareceu: um valor que veio da tabela do
 * contrato não se negocia da mesma forma que um que veio do catálogo padrão, e
 * sem a origem à vista o vendedor dá desconto sobre um preço que já era o
 * descontado.
 *
 * Preço zero é resposta legítima (item em garantia, cortesia acordada) e por
 * isso a cascata testa por `null`, não por falsidade. Tratar zero como ausente
 * faria o item de cortesia ser cobrado pelo preço de catálogo.
 */
export function resolvePrice(candidates: PriceCandidates): ResolvedPrice | null {
  if (candidates.customerAliasCents != null) {
    return { cents: candidates.customerAliasCents, source: 'customer_alias' };
  }
  if (candidates.contractListCents != null) {
    return { cents: candidates.contractListCents, source: 'contract_price_list' };
  }
  if (candidates.catalogCents != null) {
    return { cents: candidates.catalogCents, source: 'catalog' };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* envio                                                                       */
/* -------------------------------------------------------------------------- */

export interface SendableFacts {
  readonly itemCount: number;
  readonly totalCents: Cents;
  readonly validUntil: string | null;
  readonly approverContactId: string | null;
}

/**
 * O que impede enviar, dito por inteiro.
 *
 * Devolve TODAS as pendências, não a primeira. Um formulário que recusa uma
 * coisa de cada vez faz a pessoa descobrir o segundo problema depois de
 * corrigir o primeiro, e o terceiro depois do segundo — três idas ao servidor
 * para uma informação que cabia numa resposta só.
 */
export function blockersToSend(facts: SendableFacts): string[] {
  const faltas: string[] = [];
  if (facts.itemCount === 0) faltas.push('o orçamento não tem nenhum item');
  if (facts.totalCents <= 0) faltas.push('o total precisa ser maior que zero');
  if (facts.validUntil === null) faltas.push('a validade da proposta não foi informada');
  if (facts.approverContactId === null) {
    faltas.push('não há contato do cliente indicado para aprovar');
  }
  return faltas;
}
