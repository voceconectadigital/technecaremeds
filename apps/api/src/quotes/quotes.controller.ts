/**
 * Aurora — orçamentos pela HTTP (SPEC v0.2 §16 · EPIC-016).
 *
 * Como nas ordens de serviço, há UMA rota de transição
 * (`POST /quotes/:id/transitions`) e não uma rota por verbo. Rotas `/approve`,
 * `/reject` e `/send` separadas seriam três caminhos para o mesmo ato, e o
 * terceiro caminho é sempre o que esquece uma verificação.
 *
 * A permissão exigida sai do próprio grafo: aprovar pede `quote.approve`,
 * faturar pede `quote.invoice`, e isso está declarado uma vez, no domínio. Um
 * decorador fixo no método obrigaria a repetir a tabela aqui — e as duas cópias
 * divergiriam na primeira mudança.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  withClientOperation,
  createQuote,
  createQuoteWithItems,
  addQuoteItem,
  removeQuoteItem,
  setQuoteDiscount,
  transitionQuote,
  reviseQuote,
  loadQuote,
  currentStatus,
  quoteItems,
  quoteVersions,
  priceFor,
  sweepExpiredQuotes,
  type Database,
} from '@aurora/db';
import {
  isUuid,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  canTransitionQuote,
  allowedQuoteTransitions,
  QUOTE_STATUSES,
  QUOTE_NATURES,
  QUOTE_ITEM_KINDS,
  centsFromDecimal,
  type QuoteStatus,
  type QuoteNature,
  type QuoteItemKind,
} from '@aurora/domain';
import { quotesCreateFromWorkOrder } from '@aurora/contracts';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { DATABASE } from '../common/tokens';
import { escopoRestrito } from '../common/scope-sql';
import type { AuroraRequest } from '../common/context.middleware';

function uuidParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError(`${field} deve ser um identificador válido`, { field });
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} deve ser um de: ${allowed.join(', ')}`, { field });
  }
  return value as T;
}

/**
 * Aceita valor em reais e devolve centavos.
 *
 * A borda converte, e o miolo trabalha só com inteiro. Deixar reais entrarem no
 * domínio significaria somar `float`, que é a origem da diferença de centavos
 * que o cliente encontra ao conferir a proposta.
 */
function money(value: unknown, field: string): number {
  // Texto decimal ("150.50") vira centavos sem passar por float — é o que o
  // formulário de orçamento envia. Número continua aceito (clientes antigos).
  if (typeof value === 'string') {
    try {
      return centsFromDecimal(value);
    } catch {
      throw new ValidationError(`${field} deve ser um valor monetário não negativo`, { field });
    }
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${field} deve ser um valor monetário não negativo`, { field });
  }
  return centavosDeNumero(n, field);
}

/**
 * Número (clientes antigos) → centavos, arredondando meio-para-cima na
 * representação DECIMAL do número, e não no produto em ponto flutuante:
 * `Math.round(1.005 * 100)` dá 100 (porque 1.005 × 100 = 100.49999…), e o
 * certo é 101. `String(n)` é a escrita decimal mais curta que volta ao mesmo
 * número — "1.005" —, então o arredondamento sai como a pessoa digitou.
 *
 * Mesmo teto do texto decimal (12 dígitos inteiros): acima disso a soma dos
 * centavos deixa de ser exata e a coluna estouraria com 500.
 */
function centavosDeNumero(n: number, field: string): number {
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(String(n));
  if (!m) {
    throw new ValidationError(`${field} deve ser um valor monetário não negativo de até 12 dígitos`, {
      field,
    });
  }
  const fracao = (m[2] ?? '').padEnd(3, '0');
  const centavos = Number(m[1]) * 100 + Number(fracao.slice(0, 2));
  return Number(fracao[2]) >= 5 ? centavos + 1 : centavos;
}

/**
 * Quantidade da linha: positiva, até 3 casas decimais (a coluna é
 * `numeric(12,3)`) e no máximo 9 dígitos inteiros. Com 4 casas, o banco
 * truncaria a quantidade e o valor da linha — calculado com a quantidade
 * inteira — deixaria de bater com quantidade × preço no papel.
 */
function quantidadeDaLinha(value: unknown): number {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s) || !(Number(s) > 0)) {
    throw new ValidationError('quantity deve ser positiva, com até 3 casas decimais', {
      field: 'quantity',
    });
  }
  return Number(s);
}

/** Dias (garantia, prazo): inteiro de 0 a 36500, ou nulo. */
function dias(value: unknown, field: string): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 36_500) {
    throw new ValidationError(`${field} deve ser um número inteiro de dias`, { field });
  }
  return n;
}

@Controller('quotes')
export class QuotesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post()
  @RequirePermissions('quote.create')
  async create(
    @Req() req: AuroraRequest,
    @Body()
    body: {
      customerId?: unknown;
      workOrderId?: unknown;
      approverContactId?: unknown;
      nature?: unknown;
      validUntil?: unknown;
      paymentTerms?: unknown;
      customerNotes?: unknown;
      internalNotes?: unknown;
    }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (body.validUntil != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.validUntil))) {
      throw new ValidationError('validUntil deve ser uma data AAAA-MM-DD', { field: 'validUntil' });
    }
    const id = await withTenant(this.db, ctx, (s) =>
      createQuote(s, {
        customerId: uuidParam(body.customerId, 'customerId'),
        workOrderId: body.workOrderId ? uuidParam(body.workOrderId, 'workOrderId') : null,
        approverContactId: body.approverContactId
          ? uuidParam(body.approverContactId, 'approverContactId')
          : null,
        nature: body.nature ? oneOf<QuoteNature>(body.nature, QUOTE_NATURES, 'nature') : undefined,
        validUntil: body.validUntil ? String(body.validUntil) : null,
        paymentTerms: typeof body.paymentTerms === 'string' ? body.paymentTerms : null,
        customerNotes: typeof body.customerNotes === 'string' ? body.customerNotes : null,
        internalNotes: typeof body.internalNotes === 'string' ? body.internalNotes : null,
      })
    );
    return { id };
  }

  @Get()
  @RequirePermissions('quote.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    if (status && !QUOTE_STATUSES.includes(status as QuoteStatus)) {
      throw new ValidationError(`status desconhecido: ${status}`, { field: 'status' });
    }
    const cliente = customerId ? uuidParam(customerId, 'customerId') : null;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        // Escopo do vínculo: o `ScopeGuard` cobre só `/quotes/:id`; a LISTA se
        // recorta aqui. O orçamento não tem local próprio (o guard usa local
        // nulo), então o recorte é pelo cliente.
        `SELECT id, number, version, status, customer_id, work_order_id,
                valid_until::text, total_cents::text, created_at
           FROM aurora.quotes q
          WHERE ($1::uuid IS NULL OR q.customer_id = $1)
            AND ($2::text IS NULL OR q.status::text = $2)
            AND ($3::uuid IS NULL
                 OR q.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($3)))
          ORDER BY created_at DESC`,
        [cliente, status ?? null, escopoRestrito(ctx) ? ctx.membershipId : null]
      )
    );
    return { items };
  }

  @Get('price')
  @RequirePermissions('quote.read')
  async price(
    @Req() req: AuroraRequest,
    @Query('itemId') itemId?: string,
    @Query('customerId') customerId?: string,
    @Query('contractId') contractId?: string
  ): Promise<{ price: unknown }> {
    const ctx = req.auroraContext!;
    const item = uuidParam(itemId, 'itemId');
    const cliente = uuidParam(customerId, 'customerId');
    const contrato = contractId ? uuidParam(contractId, 'contractId') : null;
    const preco = await withTenant(this.db, ctx, async (s) => {
      // O preço acordado com um cliente é informação DELE: fora do escopo, 404
      // — a mesma resposta de "não existe".
      if (escopoRestrito(ctx)) {
        const [ok] = await s.query(
          `SELECT 1 FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
          [ctx.membershipId, cliente]
        );
        if (!ok) throw new NotFoundError('cliente', cliente);
      }
      return priceFor(s, item, cliente, contrato);
    });
    return { price: preco };
  }

  @Post('expire/sweep')
  @RequirePermissions('quote.update')
  async sweep(@Req() req: AuroraRequest): Promise<{ expired: number }> {
    const ctx = req.auroraContext!;
    const expired = await withTenant(this.db, ctx, (s) => sweepExpiredQuotes(s));
    return { expired };
  }

  @Get(':id')
  @RequirePermissions('quote.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    const quoteId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const quote = await loadQuote(s, quoteId);
      const efetiva = currentStatus(quote);
      return {
        quote,
        // A situação efetiva vem separada da gravada de propósito: a interface
        // precisa mostrar "vencido" antes de a varredura rodar, e precisa saber
        // que a linha ainda diz outra coisa.
        // `effective_status`, e não `effectiveStatus`: todo o resto desta
        // resposta vem do SQL em snake_case, e um único campo em camelCase no
        // meio é a espécie de inconsistência que faz a tela errar o nome e
        // ler `undefined` — em silêncio, porque `undefined` não é erro.
        effective_status: efetiva,
        items: await quoteItems(s, quoteId),
        transitions: allowedQuoteTransitions(efetiva).map((t) => ({
          to: t.to,
          label: t.label,
          permission: t.permission,
        })),
      };
    });
  }

  @Get(':id/versions')
  @RequirePermissions('quote.read')
  async versions(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const quoteId = uuidParam(id, 'id');
    const items = await withTenant(this.db, ctx, async (s) => {
      const q = await loadQuote(s, quoteId);
      return quoteVersions(s, q.number);
    });
    return { items };
  }

  @Post(':id/items')
  @RequirePermissions('quote.update')
  async addItem(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body()
    body: {
      kind?: unknown;
      itemId?: unknown;
      supplierId?: unknown;
      description?: unknown;
      quantity?: unknown;
      unitPrice?: unknown;
      discount?: unknown;
      unit?: unknown;
      warrantyDays?: unknown;
      deliveryDays?: unknown;
    }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const quantidade = quantidadeDaLinha(body.quantity);
    const itemId = await withTenant(this.db, ctx, (s) =>
      addQuoteItem(s, {
        quoteId: uuidParam(id, 'id'),
        kind: oneOf<QuoteItemKind>(body.kind, QUOTE_ITEM_KINDS, 'kind'),
        itemId: body.itemId ? uuidParam(body.itemId, 'itemId') : null,
        supplierId: body.supplierId ? uuidParam(body.supplierId, 'supplierId') : null,
        description: typeof body.description === 'string' ? body.description : undefined,
        quantity: quantidade,
        unitPriceCents: body.unitPrice == null ? undefined : money(body.unitPrice, 'unitPrice'),
        discountCents: body.discount == null ? undefined : money(body.discount, 'discount'),
        unit: typeof body.unit === 'string' ? body.unit : undefined,
        warrantyDays: dias(body.warrantyDays, 'warrantyDays'),
        deliveryDays: dias(body.deliveryDays, 'deliveryDays'),
      })
    );
    return { id: itemId };
  }

  @Post(':id/items/:itemId/remove')
  @RequirePermissions('quote.update')
  async removeItem(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string
  ): Promise<{ removed: true }> {
    const ctx = req.auroraContext!;
    const quoteId = uuidParam(id, 'id');
    // A linha precisa ser DESTE orçamento: o `ScopeGuard` conferiu o `:id`, não a linha.
    await withTenant(this.db, ctx, (s) => removeQuoteItem(s, uuidParam(itemId, 'itemId'), quoteId));
    return { removed: true };
  }

  @Post(':id/discount')
  @RequirePermissions('quote.update')
  async discount(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { value?: unknown; percent?: unknown; additions?: unknown; taxes?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const quoteId = uuidParam(id, 'id');
    let percent: number | undefined;
    if (body.percent != null) {
      percent = Number(body.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new ValidationError('percent deve ser um percentual entre 0 e 100', { field: 'percent' });
      }
    }
    return withTenant(this.db, ctx, async (s) => {
      // Só em rascunho (conferido em `setQuoteDiscount`, 409 fora dele).
      await setQuoteDiscount(s, quoteId, {
        cents: body.value == null ? undefined : money(body.value, 'value'),
        percent,
        additionsCents: body.additions == null ? undefined : money(body.additions, 'additions'),
        taxesCents: body.taxes == null ? undefined : money(body.taxes, 'taxes'),
      });
      return loadQuote(s, quoteId);
    });
  }

  /**
   * A rota única de transição.
   *
   * A permissão é conferida aqui, contra o grafo, e não por decorador: cada
   * destino tem a sua, e a tabela que diz qual é mora no domínio.
   */
  @Post(':id/transitions')
  @RequirePermissions('quote.read')
  @PermissionsCheckedInHandler(
    'cada aresta tem a sua permissão (quote.send, .approve, .update); o guard aqui é o piso'
  )
  async transition(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body()
    body: {
      to?: unknown;
      note?: unknown;
      rejectionReasonId?: unknown;
      contactId?: unknown;
      acceptanceNote?: unknown;
    }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const quoteId = uuidParam(id, 'id');
    const destino = oneOf<QuoteStatus>(body.to, QUOTE_STATUSES, 'to');

    return withTenant(this.db, ctx, async (s) => {
      const quote = await loadQuote(s, quoteId);
      const transicao = canTransitionQuote(currentStatus(quote), destino);

      if (transicao && !ctx.permissions.has(transicao.permission)) {
        throw new ForbiddenError(transicao.permission);
      }

      await transitionQuote(s, quoteId, destino, {
        note: typeof body.note === 'string' ? body.note : undefined,
        rejectionReasonId: body.rejectionReasonId
          ? uuidParam(body.rejectionReasonId, 'rejectionReasonId')
          : undefined,
        contactId: body.contactId ? uuidParam(body.contactId, 'contactId') : null,
        acceptance: {
          // O endereço vem do soquete, nunca de cabeçalho que o chamador
          // escreve: evidência que o próprio interessado pode forjar não é
          // evidência. Mesma decisão do limitador do EPIC-006.
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          note: typeof body.acceptanceNote === 'string' ? body.acceptanceNote : null,
        },
      });

      return loadQuote(s, quoteId);
    });
  }

  @Post(':id/revisions')
  @RequirePermissions('quote.update')
  async revise(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const novo = await withTenant(this.db, ctx, (s) => reviseQuote(s, uuidParam(id, 'id')));
    return { id: novo };
  }

  /** O preço que a cascata daria, para a tela mostrar antes de a linha existir. */
}

/** Validação de borda de UMA linha, com o número dela na mensagem ("linha 3: …"). */
function naLinha<T>(indice: number, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new ValidationError(`linha ${indice + 1}: ${e.message}`, { ...e.details, line: indice + 1 });
    }
    throw e;
  }
}

/**
 * "Gerar orçamento" a partir da OS (PF-71).
 *
 * A tela fazia uma chamada para o cabeçalho e uma por linha: uma linha recusada
 * no meio deixava um orçamento pela metade, e "Gerar" de novo criava outro.
 * Aqui é UMA rota, UMA transação: cabeçalho e linhas nascem juntos ou não
 * nascem.
 *
 * Debaixo de `/work-orders/:id`, de propósito: a regra `work-orders/<uuid>` do
 * `ScopeGuard` recorta pelo cliente e pelo local da OS sem código novo, e o
 * cliente do orçamento é SEMPRE o da OS — não vem no corpo.
 *
 * REENVIO. A tela gera `clientRequestId` antes da primeira tentativa e o
 * repete na retentativa. É a mesma garantia de "no máximo uma vez" das
 * operações de campo (`withClientOperation`): a reserva do identificador mora
 * na transação do trabalho, então falha não deixa marca (a retentativa corrige
 * e tenta de novo) e sucesso devolve o MESMO orçamento a quem reenviar. O
 * conflito NÃO é gravado como pendência de campo (`runFieldOperation`): isto
 * é tela de escritório, e a tela "Precisa da sua atenção" é do técnico.
 */
@Controller('work-orders')
export class WorkOrderQuotesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post(':id/quotes')
  @RequirePermissions('quote.create', 'quote.update')
  async createFromWorkOrder(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const woId = uuidParam(id, 'id');
    const b = parseWith(quotesCreateFromWorkOrder.body, body);

    // Mesmas regras de borda de `POST /quotes/:id/items`, linha a linha, ANTES
    // de abrir a transação.
    const linhas = b.items.map((l, i) =>
      naLinha(i, () => ({
        kind: l.kind,
        itemId: l.itemId ?? null,
        description: l.description,
        quantity: quantidadeDaLinha(l.quantity),
        unitPriceCents: l.unitPrice == null ? undefined : money(l.unitPrice, 'unitPrice'),
        unit: l.unit,
      }))
    );

    const r = await withClientOperation(
      this.db,
      ctx,
      {
        id: b.clientRequestId.toLowerCase(),
        route: 'POST /work-orders/:id/quotes',
        body: { work_order_id: woId, ...b },
      },
      async (s) => {
        const [os] = await s.query<{ customer_id: string }>(
          `SELECT customer_id FROM aurora.work_orders WHERE id = $1`,
          [woId]
        );
        if (!os) throw new NotFoundError('ordem de serviço', woId);
        const quoteId = await createQuoteWithItems(s, {
          customerId: os.customer_id,
          workOrderId: woId,
          nature: b.nature,
          validUntil: b.validUntil ?? null,
          approverContactId: b.approverContactId ?? null,
          paymentTerms: b.paymentTerms ?? null,
          customerNotes: b.customerNotes ?? null,
          internalNotes: b.internalNotes ?? null,
          items: linhas,
        });
        return { id: quoteId };
      }
    );

    if (!r.replayed) return r.value;
    // O identificador já foi usado por uma operação RECUSADA (só a fila de
    // campo grava recusa): devolver aquilo como sucesso mentiria.
    if (r.status >= 400) {
      throw new ConflictError('Este pedido já foi recusado antes; gere o orçamento de novo.', {
        client_operation_id: b.clientRequestId,
        replayed: true,
      });
    }
    return r.body as { id: string };
  }
}
