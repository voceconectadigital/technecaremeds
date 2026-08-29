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
  createQuote,
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
  canTransitionQuote,
  allowedQuoteTransitions,
  QUOTE_STATUSES,
  QUOTE_NATURES,
  QUOTE_ITEM_KINDS,
  toCents,
  type QuoteStatus,
  type QuoteNature,
  type QuoteItemKind,
} from '@aurora/domain';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
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
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${field} deve ser um valor monetário não negativo`, { field });
  }
  return toCents(n);
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
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT id, number, version, status, customer_id, work_order_id,
                valid_until::text, total_cents::text, created_at
           FROM aurora.quotes
          WHERE ($1::uuid IS NULL OR customer_id = $1)
            AND ($2::text IS NULL OR status::text = $2)
          ORDER BY created_at DESC`,
        [customerId ?? null, status ?? null]
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
    const preco = await withTenant(this.db, ctx, (s) =>
      priceFor(
        s,
        uuidParam(itemId, 'itemId'),
        uuidParam(customerId, 'customerId'),
        contractId ? uuidParam(contractId, 'contractId') : null
      )
    );
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
        effectiveStatus: efetiva,
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
    const quantidade = Number(body.quantity);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new ValidationError('quantity deve ser positiva', { field: 'quantity' });
    }
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
        warrantyDays: body.warrantyDays == null ? null : Number(body.warrantyDays),
        deliveryDays: body.deliveryDays == null ? null : Number(body.deliveryDays),
      })
    );
    return { id: itemId };
  }

  @Post(':id/items/:itemId/remove')
  @RequirePermissions('quote.update')
  async removeItem(@Req() req: AuroraRequest, @Param('itemId') itemId: string): Promise<{ removed: true }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => removeQuoteItem(s, uuidParam(itemId, 'itemId')));
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
    return withTenant(this.db, ctx, async (s) => {
      await setQuoteDiscount(s, quoteId, {
        cents: body.value == null ? undefined : money(body.value, 'value'),
        percent: body.percent == null ? undefined : Number(body.percent),
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
