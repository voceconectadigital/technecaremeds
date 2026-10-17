/**
 * Aurora — orçamentos na camada de dados (SPEC v0.2 §16 · EPIC-016).
 */
import {
  newId,
  canTransitionQuote,
  allowedQuoteTransitions,
  effectiveStatus,
  resolvePrice,
  blockersToSend,
  itemTotal,
  ValidationError,
  NotFoundError,
  ConflictError,
  type QuoteStatus,
  type QuoteNature,
  type QuoteItemKind,
  type PriceSource,
  type Cents,
  ForbiddenError,
  InvalidTransitionError,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { reserve, releaseReservations, consume } from './inventory';
import { transitionWorkOrder } from './work-orders';

/* -------------------------------------------------------------------------- */
/* preço                                                                       */
/* -------------------------------------------------------------------------- */

export interface PricedItem {
  cents: Cents;
  source: PriceSource;
}

/**
 * O preço de um item para um cliente, pela cascata do §16.
 *
 * Uma consulta só, com os três degraus lado a lado, em vez de três idas ao
 * banco: montar um orçamento de trinta linhas com três consultas por linha são
 * noventa idas, e a tela demora o suficiente para o vendedor digitar o preço à
 * mão — que é exatamente o comportamento que a cascata existe para evitar.
 */
export async function priceFor(
  session: TenantSession,
  itemId: string,
  customerId: string,
  contractId: string | null
): Promise<PricedItem | null> {
  const [row] = await session.query<{
    alias_cents: string | null;
    list_cents: string | null;
    catalog_cents: string | null;
  }>(
    `SELECT
       (SELECT round(a.sale_price * 100)::bigint
          FROM aurora.customer_item_aliases a
         WHERE a.customer_id = $2 AND a.item_id = $1)::text AS alias_cents,
       (SELECT p.price_cents
          FROM aurora.price_list_items p
          JOIN aurora.contracts c ON c.price_list_id = p.price_list_id
         WHERE c.id = $3 AND p.item_id = $1)::text AS list_cents,
       (SELECT i.list_price_cents FROM aurora.inventory_items i WHERE i.id = $1)::text
         AS catalog_cents`,
    [itemId, customerId, contractId]
  );

  const resolvido = resolvePrice({
    customerAliasCents: row?.alias_cents == null ? null : Number(row.alias_cents),
    contractListCents: row?.list_cents == null ? null : Number(row.list_cents),
    catalogCents: row?.catalog_cents == null ? null : Number(row.catalog_cents),
  });

  return resolvido ? { cents: resolvido.cents, source: resolvido.source } : null;
}

/* -------------------------------------------------------------------------- */
/* cadastro                                                                    */
/* -------------------------------------------------------------------------- */

export interface QuoteInput {
  customerId: string;
  nature?: QuoteNature;
  workOrderId?: string | null;
  approverContactId?: string | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
}

/**
 * Abre um orçamento em rascunho.
 *
 * O contrato NÃO é escolhido por quem cria: é derivado do ativo da OS de
 * origem, pela mesma função que a cascata de SLA usa. Deixar o vendedor
 * escolher o contrato abriria a porta para orçar sob o acordo errado — e o
 * acordo errado é o que define o preço.
 */
export async function createQuote(session: TenantSession, input: QuoteInput): Promise<string> {
  const id = newId();
  const ano = new Date().getUTCFullYear();
  const [seq] = await session.query<{ next_number: string }>(
    `SELECT aurora.next_number($1, 'QT', $2) AS next_number`,
    [session.context.organizationId, ano]
  );

  let contractId: string | null = null;
  if (input.workOrderId) {
    const [os] = await session.query<{ contract_id: string | null; customer_id: string }>(
      `SELECT contract_id, customer_id FROM aurora.work_orders WHERE id = $1`,
      [input.workOrderId]
    );
    if (!os) throw new NotFoundError('ordem de serviço não encontrada');
    // Orçamento de um cliente sobre a OS de outro faria a aprovação reservar
    // peça (e o faturamento baixar estoque) na OS errada.
    if (os.customer_id !== input.customerId) {
      throw new ValidationError('a ordem de serviço é de outro cliente', { field: 'workOrderId' });
    }
    contractId = os.contract_id;
  }

  if (input.approverContactId) {
    const [contato] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.customer_contacts WHERE id = $1`,
      [input.approverContactId]
    );
    if (!contato) throw new NotFoundError('contato aprovador não encontrado');
    if (contato.customer_id !== input.customerId) {
      throw new ValidationError('o contato aprovador é de outro cliente', { field: 'approverContactId' });
    }
  }

  await session.query(
    `INSERT INTO aurora.quotes
       (id, organization_id, number, customer_id, nature, work_order_id, contract_id,
        approver_contact_id, valid_until, payment_terms, customer_notes, internal_notes, created_by)
     VALUES ($1, $2, $3, $4, $5::aurora.quote_nature, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      session.context.organizationId,
      `QT-${ano}-${String(seq!.next_number).padStart(5, '0')}`,
      input.customerId,
      input.nature ?? 'parts_and_services',
      input.workOrderId ?? null,
      contractId,
      input.approverContactId ?? null,
      input.validUntil ?? null,
      input.paymentTerms ?? null,
      input.customerNotes ?? null,
      input.internalNotes ?? null,
      session.context.actorId,
    ]
  );

  await emitEvent(session, {
    type: 'quote.created',
    aggregateId: id,
    payload: { customerId: input.customerId },
  });
  return id;
}

export interface QuoteItemArgs {
  quoteId: string;
  kind: QuoteItemKind;
  description?: string;
  itemId?: string | null;
  supplierId?: string | null;
  quantity: number;
  /** Em centavos. Ausente: resolvido pela cascata. */
  unitPriceCents?: Cents;
  discountCents?: Cents;
  unit?: string;
  warrantyDays?: number | null;
  deliveryDays?: number | null;
}

/**
 * Acrescenta uma linha.
 *
 * Quando o preço não vem informado, ele é resolvido pela cascata e a ORIGEM
 * fica gravada na linha. Sem a origem, três meses depois ninguém sabe se
 * aqueles R$ 180 vieram do acordo com o cliente ou do catálogo — e é essa
 * dúvida que faz a renegociação começar do zero.
 */
export async function addQuoteItem(session: TenantSession, args: QuoteItemArgs): Promise<string> {
  const [quote] = await session.query<{
    status: QuoteStatus;
    customer_id: string;
    contract_id: string | null;
  }>(`SELECT status, customer_id, contract_id FROM aurora.quotes WHERE id = $1`, [args.quoteId]);
  if (!quote) throw new NotFoundError('orçamento não encontrado');

  let precoCents = args.unitPriceCents;
  let origem: PriceSource = 'manual';
  let descricao = args.description;

  if (args.itemId) {
    const [item] = await session.query<{ name: string; unit: string }>(
      `SELECT name, unit FROM aurora.inventory_items WHERE id = $1`,
      [args.itemId]
    );
    if (!item) throw new NotFoundError('item de estoque não encontrado');
    descricao = descricao ?? item.name;

    if (precoCents === undefined) {
      const preco = await priceFor(session, args.itemId, quote.customer_id, quote.contract_id);
      if (!preco) {
        throw new ValidationError(
          'não há preço para este item: informe o valor ou cadastre-o na tabela de preço',
          { field: 'unitPriceCents' }
        );
      }
      precoCents = preco.cents;
      origem = preco.source;
    }
  }

  if (precoCents === undefined) {
    throw new ValidationError('informe o preço unitário', { field: 'unitPriceCents' });
  }
  if (!descricao || descricao.trim().length === 0) {
    throw new ValidationError('a linha precisa de descrição', { field: 'description' });
  }

  let totais: ReturnType<typeof itemTotal>;
  try {
    totais = itemTotal({
      kind: args.kind,
      description: descricao,
      quantity: args.quantity,
      unitPriceCents: precoCents,
      discountCents: args.discountCents,
    });
  } catch (e) {
    // Regra de linha violada é pedido errado (422), não falha do servidor.
    if (e instanceof RangeError) throw new ValidationError(e.message, { field: 'quantity' });
    throw e;
  }
  // Quantidade enorme × preço enorme estoura a coluna `bigint` e chegaria como 500.
  if (!Number.isSafeInteger(totais.grossCents)) {
    throw new ValidationError('valor da linha grande demais: confira quantidade e preço', {
      field: 'quantity',
    });
  }

  const [pos] = await session.query<{ next: string }>(
    `SELECT (COALESCE(max(position), 0) + 1)::text AS next FROM aurora.quote_items WHERE quote_id = $1`,
    [args.quoteId]
  );

  const id = newId();
  await session.query(
    `INSERT INTO aurora.quote_items
       (id, organization_id, quote_id, position, kind, item_id, supplier_id, description, unit,
        quantity, unit_price_cents, discount_cents, gross_cents, net_cents, price_source,
        warranty_days, delivery_days, created_by)
     VALUES ($1, $2, $3, $4, $5::aurora.quote_item_kind, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15::aurora.price_source, $16, $17, $18)`,
    [
      id,
      session.context.organizationId,
      args.quoteId,
      Number(pos!.next),
      args.kind,
      args.itemId ?? null,
      args.supplierId ?? null,
      descricao,
      args.unit ?? 'un',
      args.quantity,
      precoCents,
      totais.discountCents,
      totais.grossCents,
      totais.netCents,
      origem,
      args.warrantyDays ?? null,
      args.deliveryDays ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Abre o orçamento JÁ COM AS LINHAS, na transação de quem chama (PF-71).
 *
 * "Gerar orçamento" da OS fazia uma chamada para o cabeçalho e uma por linha:
 * uma linha recusada no meio deixava um orçamento pela metade, e tentar de novo
 * criava um segundo. Aqui é tudo ou nada — qualquer linha inválida desfaz o
 * cabeçalho junto, porque a transação é uma só.
 */
export async function createQuoteWithItems(
  session: TenantSession,
  input: QuoteInput & { items: Array<Omit<QuoteItemArgs, 'quoteId'>> }
): Promise<string> {
  if (input.items.length === 0) {
    throw new ValidationError('o orçamento precisa de ao menos uma linha', { field: 'items' });
  }
  const { items, ...cabecalho } = input;
  const id = await createQuote(session, cabecalho);
  for (const [i, linha] of items.entries()) {
    try {
      await addQuoteItem(session, { ...linha, quoteId: id });
    } catch (e) {
      // A linha que falhou vai na mensagem: a tela mostra "linha 3: …" e a
      // pessoa sabe onde corrigir. Item de estoque inexistente na linha é
      // pedido errado (422), não "orçamento não encontrado".
      if (e instanceof ValidationError || e instanceof NotFoundError) {
        throw new ValidationError(`linha ${i + 1}: ${e.message}`, { ...e.details, line: i + 1 });
      }
      throw e;
    }
  }
  return id;
}

/**
 * Remove uma linha. Com `quoteId`, só se a linha for DAQUELE orçamento — a rota
 * `/quotes/:id/items/:itemId/remove` não pode apagar linha de outro orçamento
 * (fora do escopo de quem chama) só porque o id da linha veio junto.
 */
export async function removeQuoteItem(
  session: TenantSession,
  itemId: string,
  quoteId: string | null = null
): Promise<void> {
  const linhas = await session.query(
    `DELETE FROM aurora.quote_items WHERE id = $1 AND ($2::uuid IS NULL OR quote_id = $2) RETURNING id`,
    [itemId, quoteId]
  );
  if (linhas.length === 0) throw new NotFoundError('linha do orçamento não encontrada');
}

/**
 * Desconto geral, acréscimos e impostos do cabeçalho — só em rascunho.
 *
 * Campo ausente mantém o valor gravado: mandar só `additions` não zera o
 * desconto geral. Valor e percentual são excludentes; informar um limpa o outro.
 */
export async function setQuoteDiscount(
  session: TenantSession,
  quoteId: string,
  discount: { cents?: Cents; percent?: number; additionsCents?: Cents; taxesCents?: Cents }
): Promise<void> {
  if (discount.cents != null && discount.percent != null) {
    throw new ValidationError('informe desconto geral em valor OU em percentual, não os dois');
  }
  const quote = await loadQuote(session, quoteId, { forUpdate: true });
  if (quote.status !== 'draft') {
    throw new ConflictError(
      `orçamento ${quote.number} não está em rascunho: desconto, acréscimo e imposto só mudam antes do envio — revise para criar uma versão nova`
    );
  }
  await session.query(
    `UPDATE aurora.quotes
        SET general_discount_cents = CASE
              WHEN $2::bigint IS NOT NULL THEN $2::bigint
              WHEN $3::numeric IS NOT NULL THEN 0
              ELSE general_discount_cents END,
            general_discount_percent = CASE
              WHEN $2::bigint IS NOT NULL THEN NULL
              WHEN $3::numeric IS NOT NULL THEN $3::numeric
              ELSE general_discount_percent END,
            additions_cents = COALESCE($4, additions_cents),
            taxes_cents = COALESCE($5, taxes_cents),
            updated_by = $6
      WHERE id = $1`,
    [
      quoteId,
      discount.cents ?? null,
      discount.percent ?? null,
      discount.additionsCents ?? null,
      discount.taxesCents ?? null,
      session.context.actorId,
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* máquina de estados                                                          */
/* -------------------------------------------------------------------------- */

export interface QuoteRow {
  id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  customer_id: string;
  work_order_id: string | null;
  valid_until: string | null;
  approver_contact_id: string | null;
  total_cents: string;
}

/**
 * Lê o cabeçalho. `forUpdate` trava a linha até o fim da transação: é o que
 * serializa duas transições (ou revisão e transição) sobre o mesmo orçamento.
 */
export async function loadQuote(
  session: TenantSession,
  id: string,
  opts: { forUpdate?: boolean } = {}
): Promise<QuoteRow> {
  const [q] = await session.query<QuoteRow>(
    `SELECT id, number, version, status, customer_id, work_order_id,
            valid_until::text, approver_contact_id, total_cents::text
       FROM aurora.quotes WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id]
  );
  if (!q) throw new NotFoundError('orçamento não encontrado');
  return q;
}

/** Hoje em ISO, isolado para o cálculo de validade ser testável. */
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A situação que vale agora — a gravada, corrigida pela validade.
 *
 * Quem pergunta "posso aprovar?" precisa da resposta de hoje, não da que estava
 * certa quando a linha foi escrita. Um orçamento vencido continua com `sent` no
 * banco até alguém rodar a varredura, e aprovar nesse intervalo transformaria
 * uma promessa de preço de seis meses atrás em compromisso de hoje.
 */
export function currentStatus(quote: QuoteRow, today = hoje()): QuoteStatus {
  return effectiveStatus(quote.status, quote.valid_until, today);
}

export interface TransitionOptions {
  note?: string;
  rejectionReasonId?: string;
  acceptance?: { ip?: string | null; userAgent?: string | null; note?: string | null };
  contactId?: string | null;
}

/**
 * Move o orçamento de situação, com os efeitos do §16.
 *
 * Os efeitos colaterais moram aqui, e não em gatilho, porque atravessam
 * agregados: enviar mexe na OS, aprovar mexe no estoque, faturar baixa saldo.
 * Um gatilho que fizesse isso esconderia dentro de um `UPDATE` de orçamento uma
 * reserva de peça — e a próxima pessoa a ler o código não teria como saber.
 */
export async function transitionQuote(
  session: TenantSession,
  quoteId: string,
  to: QuoteStatus,
  options: TransitionOptions = {}
): Promise<void> {
  // Travada: duas aprovações simultâneas reservariam a peça duas vezes, e
  // aprovar e recusar ao mesmo tempo deixariam o efeito de um com o estado do outro.
  const quote = await loadQuote(session, quoteId, { forUpdate: true });
  const from = currentStatus(quote);

  const transicao = canTransitionQuote(from, to);
  if (!transicao) {
    const possiveis = allowedQuoteTransitions(from);
    const lista =
      possiveis.length === 0
        ? 'nenhuma — esta é uma situação final'
        : possiveis.map((t) => `${t.to} (${t.label})`).join(', ');
    throw new ConflictError(
      `orçamento ${quote.number} está em "${from}" e não pode ir para "${to}". Possíveis: ${lista}`
    );
  }

  if (to === 'sent') {
    const [contagem] = await session.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM aurora.quote_items WHERE quote_id = $1`,
      [quoteId]
    );
    const faltas = blockersToSend({
      itemCount: Number(contagem!.total),
      totalCents: Number(quote.total_cents),
      validUntil: quote.valid_until,
      approverContactId: quote.approver_contact_id,
    });
    if (faltas.length > 0) {
      throw new ValidationError(`não é possível enviar: ${faltas.join('; ')}`);
    }
  }

  if (to === 'rejected' && !options.rejectionReasonId) {
    throw new ValidationError(
      'recusar exige o motivo: "recusado" sem porquê não alimenta análise de perda nenhuma',
      { field: 'rejectionReasonId' }
    );
  }

  // `AND status = $10`: a situação gravada ainda é a que foi lida. Com a trava
  // acima isso já vale; a condição é a segunda linha de defesa, e transforma
  // uma leitura velha em conflito em vez de efeito duplicado.
  const mudou = await session.query(
    `UPDATE aurora.quotes
        SET status = $2::aurora.quote_status,
            sent_at   = CASE WHEN $2 = 'sent'   THEN now() ELSE sent_at END,
            viewed_at = CASE WHEN $2 = 'viewed' THEN now() ELSE viewed_at END,
            viewed_by_contact_id = CASE WHEN $2 = 'viewed' THEN $3 ELSE viewed_by_contact_id END,
            invoiced_at = CASE WHEN $2 = 'invoiced' THEN now() ELSE invoiced_at END,
            accepted_ip = CASE WHEN $2 = 'approved' THEN $4 ELSE accepted_ip END,
            accepted_user_agent = CASE WHEN $2 = 'approved' THEN $5 ELSE accepted_user_agent END,
            acceptance_note = CASE WHEN $2 = 'approved' THEN $6 ELSE acceptance_note END,
            rejection_reason_id = COALESCE($7, rejection_reason_id),
            rejection_note = COALESCE($8, rejection_note),
            updated_by = $9
      WHERE id = $1 AND status = $10::aurora.quote_status
      RETURNING id`,
    [
      quoteId,
      to,
      options.contactId ?? null,
      options.acceptance?.ip ?? null,
      options.acceptance?.userAgent ?? null,
      options.acceptance?.note ?? null,
      options.rejectionReasonId ?? null,
      to === 'rejected' ? (options.note ?? null) : null,
      session.context.actorId,
      quote.status,
    ]
  );
  if (mudou.length === 0) {
    throw new ConflictError(
      `orçamento ${quote.number} mudou de situação enquanto este pedido era processado; recarregue e tente de novo`
    );
  }

  await applyEffects(session, quote, to);
}

async function applyEffects(session: TenantSession, quote: QuoteRow, to: QuoteStatus): Promise<void> {
  switch (to) {
    case 'sent':
      await emitEvent(session, {
        type: 'quote.sent',
        aggregateId: quote.id,
        payload: { number: quote.number, totalCents: Number(quote.total_cents) },
      });
      // A OS que originou a proposta passa a esperar pelo cliente. O motivo
      // `quote_approval` pausa o SLA, e é isso que impede o prestador de ser
      // penalizado pelo tempo que a decisão levou do outro lado.
      await waitForCustomer(session, quote.work_order_id);
      break;

    case 'viewed':
      await emitEvent(session, { type: 'quote.viewed', aggregateId: quote.id, payload: {} });
      break;

    case 'approved':
      await reserveApprovedParts(session, quote);
      await emitEvent(session, {
        type: 'quote.approved',
        aggregateId: quote.id,
        payload: { number: quote.number, totalCents: Number(quote.total_cents) },
      });
      await resumeWorkOrder(session, quote.work_order_id);
      break;

    case 'rejected':
      await emitEvent(session, {
        type: 'quote.rejected',
        aggregateId: quote.id,
        payload: { number: quote.number },
      });
      break;

    case 'expired':
      await emitEvent(session, {
        type: 'quote.expired',
        aggregateId: quote.id,
        payload: { number: quote.number },
      });
      break;

    case 'cancelled':
      // Só as reservas DESTE orçamento: as do campo e as de outro orçamento da
      // mesma OS continuam onde estão.
      if (quote.work_order_id) await releaseReservations(session, quote.work_order_id, quote.id);
      break;

    case 'invoiced':
      await consumeApprovedParts(session, quote);
      await emitEvent(session, {
        type: 'quote.invoiced',
        aggregateId: quote.id,
        payload: { number: quote.number, totalCents: Number(quote.total_cents) },
      });
      break;

    default:
      break;
  }
}

/**
 * Reserva as peças aprovadas.
 *
 * Reservar na aprovação, e não no envio, é deliberado: uma proposta enviada
 * pode nunca ser aprovada, e prender a peça enquanto o cliente decide faria a
 * OS do vizinho travar por causa de um trabalho que talvez não aconteça. Este é
 * o outro lado da diferença entre "tem" e "posso usar" do EPIC-015.
 *
 * Sem almoxarifado com saldo, a reserva é PULADA e não falha: o orçamento foi
 * aprovado, e recusar a aprovação porque a peça está em falta transformaria uma
 * boa notícia comercial em erro de sistema. A falta aparece na OS, que é onde
 * alguém pode agir sobre ela.
 *
 * PEÇA JÁ LANÇADA EM CAMPO (PF-34, migration 0075). Se o técnico registrou a
 * peça na OS ANTES da aprovação, ela já saiu do estoque por uma reserva do
 * campo; reservar a linha inteira de novo faria o faturamento baixá-la uma
 * segunda vez. Decisão (integridade primeiro, conservadora): cada linha reserva
 * só `max(0, quantidade − consumo de campo ainda livre)`, e o quanto foi abatido
 * fica gravado na linha (`field_consumed_qty`) — o mesmo consumo não abate dois
 * orçamentos da mesma OS. O VALOR do orçamento não muda: o cliente paga pela
 * peça usada; só o movimento de estoque deixa de duplicar.
 */
async function reserveApprovedParts(session: TenantSession, quote: QuoteRow): Promise<void> {
  if (!quote.work_order_id) return;

  const pecas = await session.query<{ id: string; item_id: string; quantity: string }>(
    `SELECT id, item_id, quantity::text FROM aurora.quote_items
      WHERE quote_id = $1 AND kind = 'part' AND item_id IS NOT NULL
      ORDER BY position`,
    [quote.id]
  );
  if (pecas.length === 0) return;

  // Trava a OS ANTES de ler o consumo livre: duas aprovações de orçamentos
  // diferentes da mesma OS leriam o mesmo consumo e o abateriam as duas vezes.
  // O lançamento de peça do campo (`consumeForWorkOrder`) segura a OS em
  // `FOR KEY SHARE`, que conflita com esta trava — consumo e aprovação
  // simultâneos também se enfileiram. Ordem: orçamento → OS → saldo.
  await session.query(`SELECT 1 FROM aurora.work_orders WHERE id = $1 FOR UPDATE`, [quote.work_order_id]);

  const livrePorItem = new Map<string, number>();
  for (const peca of pecas) {
    if (!livrePorItem.has(peca.item_id)) {
      livrePorItem.set(
        peca.item_id,
        await consumoDeCampoLivre(session, quote.work_order_id, peca.item_id, quote.id)
      );
    }
    const livre = livrePorItem.get(peca.item_id)!;
    const quantidade = Number(peca.quantity);
    // Mesma escala da coluna (numeric(12,3)): sem sobra de ponto flutuante.
    const abatido = Number(Math.min(quantidade, livre).toFixed(3));
    const aReservar = Number((quantidade - abatido).toFixed(3));
    if (abatido > 0) {
      livrePorItem.set(peca.item_id, Number((livre - abatido).toFixed(3)));
      await session.query(`UPDATE aurora.quote_items SET field_consumed_qty = $2 WHERE id = $1`, [
        peca.id,
        abatido,
      ]);
    }
    if (aReservar <= 0) continue;

    // Almoxarifado de cliente (0066) é estoque DAQUELE cliente: a aprovação só
    // reserva no da prestadora (sem cliente) ou no do próprio cliente do orçamento.
    const [saldo] = await session.query<{ warehouse_id: string }>(
      `SELECT b.warehouse_id FROM aurora.stock_balances b
         JOIN aurora.warehouses w ON w.id = b.warehouse_id
        WHERE b.item_id = $1 AND (b.on_hand - b.reserved) >= $2
          AND w.archived_at IS NULL
          AND (w.customer_id IS NULL OR w.customer_id = $3)
        ORDER BY (b.on_hand - b.reserved) DESC LIMIT 1`,
      [peca.item_id, aReservar, quote.customer_id]
    );
    if (!saldo) continue;

    await reserve(session, quote.work_order_id, peca.item_id, saldo.warehouse_id, aReservar, quote.id);
  }
}

/** Orçamento que já reservou/abateu peça e continua valendo (aprovado em diante, sem ter sido superado). */
const ORCAMENTO_VIVO = `('approved', 'in_execution', 'invoiced', 'closed')`;

/**
 * Quanto do item já foi consumido na OS e AINDA NÃO está coberto por orçamento
 * vivo — o que a aprovação de `quoteId` pode abater.
 *
 *   consumo líquido na OS (consumos − estornos deles − devoluções, pelo razão)
 *   − o consumido contra reserva de orçamento vivo (é peça daquele orçamento)
 *   − o que outro orçamento vivo da OS já abateu (`field_consumed_qty`)
 *
 * Orçamento superado ou cancelado sai das duas subtrações: o consumo que estava
 * com ele volta a ficar livre, e a versão nova o abate em vez de reservar de novo.
 */
async function consumoDeCampoLivre(
  session: TenantSession,
  workOrderId: string,
  itemId: string,
  quoteId: string
): Promise<number> {
  const [r] = await session.query<{ livre: string }>(
    `WITH movs AS (
       SELECT id, qty FROM aurora.stock_movements
        WHERE ref_type = 'work_order' AND ref_id = $1 AND item_id = $2
          AND kind IN ('consumption', 'return')
     ),
     liquido AS (
       SELECT -COALESCE(sum(q), 0) AS consumido FROM (
         SELECT qty AS q FROM movs
         UNION ALL
         SELECT e.qty FROM aurora.stock_movements e JOIN movs m ON m.id = e.reverses_id
       ) x
     ),
     de_orcamento AS (
       SELECT COALESCE(sum(r.consumed_qty), 0) AS consumido
         FROM aurora.stock_reservations r
         JOIN aurora.quotes q ON q.id = r.quote_id
        WHERE r.work_order_id = $1 AND r.item_id = $2
          AND q.id <> $3 AND q.status IN ${ORCAMENTO_VIVO}
     ),
     abatido AS (
       SELECT COALESCE(sum(i.field_consumed_qty), 0) AS qtd
         FROM aurora.quote_items i
         JOIN aurora.quotes q ON q.id = i.quote_id
        WHERE q.work_order_id = $1 AND i.item_id = $2 AND i.kind = 'part'
          AND q.id <> $3 AND q.status IN ${ORCAMENTO_VIVO}
     )
     -- Truncado na escala da linha do orçamento (numeric(12,3)): o razão tem 4
     -- casas, e arredondar para cima abateria mais do que saiu de fato.
     SELECT trunc(GREATEST(0, liquido.consumido - de_orcamento.consumido - abatido.qtd), 3)::text AS livre
       FROM liquido, de_orcamento, abatido`,
    [workOrderId, itemId, quoteId]
  );
  return Number(r?.livre ?? 0);
}

/**
 * Baixa as reservas do orçamento faturado — só as DELE (migration 0071).
 *
 * O que o técnico já consumiu em campo contra essas reservas não sai de novo:
 * só o pendente de cada uma é consumido aqui.
 */
async function consumeApprovedParts(session: TenantSession, quote: QuoteRow): Promise<void> {
  if (!quote.work_order_id) return;

  const reservas = await session.query<{ id: string; qty: string; consumed_qty: string }>(
    `SELECT id, qty::text, consumed_qty::text FROM aurora.stock_reservations
      WHERE work_order_id = $1 AND quote_id = $2 AND released_at IS NULL
      FOR UPDATE`,
    [quote.work_order_id, quote.id]
  );

  for (const r of reservas) {
    const restante = Number(r.qty) - Number(r.consumed_qty);
    if (restante > 0) await consume(session, r.id, restante);
  }
}

async function waitForCustomer(session: TenantSession, workOrderId: string | null): Promise<void> {
  if (!workOrderId) return;
  const [motivo] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.wait_reasons WHERE key = 'quote_approval'`
  );
  if (!motivo) return;

  const [os] = await session.query<{ status_category: string }>(
    `SELECT status_category FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  // Só a OS EM EXECUÇÃO passa a aguardar o cliente: é a única aresta do grafo
  // para `waiting`. OS ainda aberta/agendada/em análise continua onde está — o
  // "aguardando aprovação de orçamento" aparece pelo próprio orçamento
  // (`quote_summary` da ficha), sem estado redundante.
  if (!os || os.status_category !== 'in_progress') return;
  await efeitoNaOs(() =>
    transitionWorkOrder(efeitoDoOrcamento(session), workOrderId, 'waiting', { waitReasonId: motivo.id })
  );
}

/**
 * A mudança da OS é CONSEQUÊNCIA do orçamento, autorizada pela permissão de
 * enviar/aprovar que já foi conferida (`quote.send`, `quote.approve`). Quem
 * envia (o financeiro, o gestor) não precisa poder executar OS para que ela
 * passe a aguardar o cliente: a sessão do efeito recebe SÓ a permissão da
 * aresta (`work_order.execute`), e só durante esta chamada.
 */
function efeitoDoOrcamento(session: TenantSession): TenantSession {
  return {
    context: {
      ...session.context,
      permissions: new Set([...session.context.permissions, 'work_order.execute']),
    },
    query: (sql, params) => session.query(sql, params),
  };
}

/**
 * Efeito do orçamento sobre a OS. Enviar ou aprovar o orçamento NÃO falha porque
 * a OS não pode mudar (grafo da organização sem a aresta, por exemplo): a
 * recusa é avaliada antes de qualquer escrita, então a OS fica como estava e o
 * orçamento segue.
 */
async function efeitoNaOs(f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof InvalidTransitionError) return;
    throw e;
  }
}

async function resumeWorkOrder(session: TenantSession, workOrderId: string | null): Promise<void> {
  if (!workOrderId) return;
  const [os] = await session.query<{ status_category: string }>(
    `SELECT status_category FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (!os || os.status_category !== 'waiting') return;
  await efeitoNaOs(() => transitionWorkOrder(efeitoDoOrcamento(session), workOrderId, 'in_progress'));
}

/* -------------------------------------------------------------------------- */
/* revisão                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cria a versão N+1 em rascunho e supera a anterior.
 *
 * A ordem importa: a anterior vira `superseded` ANTES de a nova nascer, porque
 * o índice único deixa uma versão viva por número. A ordem inversa seria
 * recusada pelo banco — e é bom que seja: duas versões vivas do mesmo número
 * são duas propostas diferentes com o mesmo nome na mão do cliente.
 */
export async function reviseQuote(session: TenantSession, quoteId: string): Promise<string> {
  const quote = await loadQuote(session, quoteId, { forUpdate: true });
  if (quote.status === 'superseded') {
    throw new ConflictError(`o orçamento ${quote.number} v${quote.version} já foi revisado`);
  }
  if (quote.status === 'invoiced' || quote.status === 'closed') {
    throw new ConflictError('orçamento já faturado não se revisa: abra uma proposta nova');
  }
  // Em execução, a peça já está sendo usada contra esta versão: superá-la
  // deixaria o trabalho feito sem orçamento para faturar.
  if (quote.status === 'in_execution') {
    throw new ConflictError(
      'orçamento em execução não se revisa: fature-o ou abra uma proposta nova para o que mudou'
    );
  }
  // Aprovado pode ser revisado (a versão aprovada fica registrada como era),
  // mas a reserva que a aprovação fez é DESTA versão: sem soltá-la, ficaria
  // presa a uma versão morta e a nova, ao ser aprovada, reservaria de novo.
  if (quote.status === 'approved' && quote.work_order_id) {
    await releaseReservations(session, quote.work_order_id, quote.id);
  }

  await session.query(`UPDATE aurora.quotes SET status = 'superseded' WHERE id = $1`, [quoteId]);

  const novo = newId();
  await session.query(
    `INSERT INTO aurora.quotes
       (id, organization_id, number, version, supersedes_id, customer_id, nature,
        work_order_id, contract_id, approver_contact_id, valid_until, payment_terms,
        customer_notes, internal_notes, general_discount_cents, general_discount_percent,
        additions_cents, taxes_cents, created_by)
     SELECT $1, organization_id, number, version + 1, id, customer_id, nature,
            work_order_id, contract_id, approver_contact_id, valid_until, payment_terms,
            customer_notes, internal_notes, general_discount_cents, general_discount_percent,
            additions_cents, taxes_cents, $2
       FROM aurora.quotes WHERE id = $3`,
    [novo, session.context.actorId, quoteId]
  );

  // As linhas vêm junto: revisar quase sempre é mexer em uma coisa, e obrigar a
  // redigitar trinta linhas para mudar um preço é o que faz as pessoas usarem o
  // "Modificar" destrutivo da referência mesmo quando existe alternativa.
  await session.query(
    `INSERT INTO aurora.quote_items
       (id, organization_id, quote_id, position, kind, item_id, supplier_id, lot_id,
        description, unit, quantity, unit_price_cents, discount_cents, gross_cents, net_cents,
        price_source, warranty_days, delivery_days, created_by)
     SELECT gen_random_uuid(), organization_id, $1, position, kind, item_id, supplier_id, lot_id,
            description, unit, quantity, unit_price_cents, discount_cents, gross_cents, net_cents,
            price_source, warranty_days, delivery_days, $2
       FROM aurora.quote_items WHERE quote_id = $3 ORDER BY position`,
    [novo, session.context.actorId, quoteId]
  );

  await emitEvent(session, {
    type: 'quote.revised',
    aggregateId: novo,
    payload: { number: quote.number, fromVersion: quote.version, toVersion: quote.version + 1 },
  });

  return novo;
}

/* -------------------------------------------------------------------------- */
/* varredura                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Marca como expirados os orçamentos cuja validade passou.
 *
 * A varredura existe para o evento sair e o funil ficar limpo, não para a regra
 * valer: a regra já vale, derivada, em `currentStatus`. Se esta varredura nunca
 * rodar, nada de errado acontece — apenas o relatório fica desatualizado, que é
 * a falha certa para uma tarefa de fundo ter.
 */
export async function sweepExpiredQuotes(session: TenantSession, today = hoje()): Promise<number> {
  const vencidos = await session.query<{ id: string; number: string }>(
    `SELECT id, number FROM aurora.quotes
      WHERE status IN ('sent', 'viewed') AND valid_until IS NOT NULL AND valid_until < $1::date`,
    [today]
  );

  let expirados = 0;
  for (const q of vencidos) {
    // Só expira se ainda estiver aberto: uma aprovação concorrente vence a varredura.
    const mudou = await session.query(
      `UPDATE aurora.quotes SET status = 'expired' WHERE id = $1 AND status IN ('sent', 'viewed') RETURNING id`,
      [q.id]
    );
    if (mudou.length === 0) continue;
    expirados += 1;
    await emitEvent(session, {
      type: 'quote.expired',
      aggregateId: q.id,
      payload: { number: q.number },
    });
  }

  return expirados;
}

/* -------------------------------------------------------------------------- */
/* leitura                                                                     */
/* -------------------------------------------------------------------------- */

export async function quoteItems(session: TenantSession, quoteId: string): Promise<unknown[]> {
  return session.query(
    `SELECT id, position, kind, item_id, description, unit, quantity::text,
            unit_price_cents::text, discount_cents::text, net_cents::text, price_source,
            warranty_days, delivery_days, field_consumed_qty::text
       FROM aurora.quote_items WHERE quote_id = $1 ORDER BY position`,
    [quoteId]
  );
}

/** As versões de um número, da mais nova para a mais antiga — o histórico comercial. */
export async function quoteVersions(session: TenantSession, number: string): Promise<unknown[]> {
  return session.query(
    `SELECT id, version, status, total_cents::text, created_at, decided_at
       FROM aurora.quotes WHERE number = $1 ORDER BY version DESC`,
    [number]
  );
}
