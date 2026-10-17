/**
 * Aurora — estoque interno (gestão) e Store pela HTTP (reunião 16/10/2026, Fase 8).
 *
 * Almoxarifado de cliente é visível só a quem tem aquele cliente no escopo.
 * Custo e valor só com `inventory.read_costs`. A Store mostra catálogo, nunca
 * saldo — e pedir proposta vira oportunidade.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  withTenant,
  listInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  listWarehouses,
  createOwnedWarehouse,
  assertWarehouseVisible,
  receiveStock,
  setStockLimits,
  stockValuation,
  abcCurve,
  stockPeriodReport,
  storeItems,
  requestStoreQuote,
  type Database,
} from '@aurora/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@aurora/domain';
import {
  inventoryAbc,
  inventoryItemsCreate,
  inventoryItemsUpdate,
  inventoryLimits,
  inventoryPeriodReport,
  inventoryReceipts,
  inventoryWarehousesCreate,
  storeRequestQuote,
} from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/** Período: datas válidas, ordem certa, no máximo dois anos. */
function periodo(q: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('datas inválidas', { field: 'from' });
  }
  if (to <= from) throw new ValidationError('"to" precisa ser depois de "from"', { field: 'to' });
  if (to.getTime() - from.getTime() > 2 * 366 * 86_400_000) {
    throw new ValidationError('o período é de no máximo dois anos', { field: 'to' });
  }
  return { from, to };
}

function skuRepetido(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/sku/i.test(msg) && /uq|unique|duplic/i.test(msg))
    throw new ConflictError('já existe um item com este código');
  throw e;
}

@Controller()
export class EstoqueGestaoController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('inventory/items')
  @RequirePermissions('inventory.read')
  async items(@Req() req: AuroraRequest) {
    return { items: await withTenant(this.db, req.auroraContext!, (s) => listInventoryItems(s)) };
  }

  @Post('inventory/items')
  @RequirePermissions('inventory.create')
  async createItem(@Req() req: AuroraRequest, @Body() body: unknown) {
    const b = parseWith(inventoryItemsCreate.body, body);
    const id = await withTenant(this.db, req.auroraContext!, (s) =>
      createInventoryItem(s, {
        sku: b.sku,
        name: b.name,
        unit: b.unit,
        category: b.category ?? null,
        listPrice: b.list_price ?? null,
      }).catch(skuRepetido)
    );
    return { id };
  }

  @Patch('inventory/items/:id')
  @RequirePermissions('inventory.update')
  async updateItem(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    const b = parseWith(inventoryItemsUpdate.body, body);
    await withTenant(this.db, req.auroraContext!, (s) =>
      updateInventoryItem(s, uuidParam(id, 'id'), {
        name: b.name,
        category: b.category,
        listPrice: b.list_price,
        storePublished: b.store_published,
        storeSummary: b.store_summary,
      })
    );
    return { ok: true as const };
  }

  @Get('inventory/warehouses')
  @RequirePermissions('inventory.read')
  async warehouses(@Req() req: AuroraRequest) {
    const ctx = req.auroraContext!;
    return { items: await withTenant(this.db, ctx, (s) => listWarehouses(s, ctx.membershipId)) };
  }

  @Post('inventory/warehouses')
  @RequirePermissions('inventory.create')
  async createWarehouse(@Req() req: AuroraRequest, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    const b = parseWith(inventoryWarehousesCreate.body, body);
    const id = await withTenant(this.db, ctx, async (s) => {
      if (b.customer_id && ctx.membershipId) {
        const [ok] = await s.query(
          `SELECT 1 FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
          [ctx.membershipId, b.customer_id]
        );
        if (!ok) throw new NotFoundError('cliente', b.customer_id);
      }
      return createOwnedWarehouse(s, { name: b.name, kind: b.kind, customerId: b.customer_id ?? null });
    });
    return { id };
  }

  @Post('inventory/receipts')
  @RequirePermissions('inventory.move')
  async receive(@Req() req: AuroraRequest, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    const b = parseWith(inventoryReceipts.body, body);
    const id = await withTenant(this.db, ctx, async (s) => {
      await assertWarehouseVisible(s, b.warehouse_id, ctx.membershipId);
      return receiveStock(s, {
        itemId: b.item_id,
        warehouseId: b.warehouse_id,
        qty: b.qty,
        unitCost: b.unit_cost,
        reference: b.reference,
      });
    });
    return { id };
  }

  @Put('inventory/limits')
  @RequirePermissions('inventory.update')
  async limits(@Req() req: AuroraRequest, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    const b = parseWith(inventoryLimits.body, body);
    await withTenant(this.db, ctx, async (s) => {
      await assertWarehouseVisible(s, b.warehouse_id, ctx.membershipId);
      await setStockLimits(s, b.item_id, b.warehouse_id, b.min_qty, b.max_qty);
    });
    return { ok: true as const };
  }

  @Get('inventory/valuation')
  @RequirePermissions('inventory.read_costs')
  async valuation(@Req() req: AuroraRequest) {
    const ctx = req.auroraContext!;
    return { items: await withTenant(this.db, ctx, (s) => stockValuation(s, ctx.membershipId)) };
  }

  @Get('inventory/abc')
  @RequirePermissions('inventory.read_costs')
  async abc(@Req() req: AuroraRequest, @Query() query: unknown) {
    const ctx = req.auroraContext!;
    const q = parseWith(inventoryAbc.query, query);
    return withTenant(this.db, ctx, async (s) => {
      if (q.warehouse) await assertWarehouseVisible(s, q.warehouse, ctx.membershipId);
      return abcCurve(
        s,
        { ...periodo(q), warehouseId: q.warehouse ?? null, aLimit: q.a, bLimit: q.b },
        ctx.membershipId
      );
    });
  }

  @Get('inventory/period-report')
  @RequirePermissions('inventory.read')
  async report(@Req() req: AuroraRequest, @Query() query: unknown) {
    const ctx = req.auroraContext!;
    const q = parseWith(inventoryPeriodReport.query, query);
    return withTenant(this.db, ctx, async (s) => {
      if (q.warehouse) await assertWarehouseVisible(s, q.warehouse, ctx.membershipId);
      return {
        items: await stockPeriodReport(
          s,
          { ...periodo(q), warehouseId: q.warehouse ?? null },
          ctx.membershipId
        ),
      };
    });
  }

  @Get('store/items')
  @RequirePermissions('store.read')
  async store(@Req() req: AuroraRequest) {
    const itens = await withTenant(this.db, req.auroraContext!, (s) => storeItems(s));
    return {
      items: itens.map(({ image_key, ...resto }) => ({
        ...resto,
        image_url: image_key ? `/${image_key.replace(/^\/+/, '')}` : null,
      })),
    };
  }

  @Post('store/requests')
  @RequirePermissions('store.request_quote')
  async storeRequest(@Req() req: AuroraRequest, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('store.request_quote');
    const b = parseWith(storeRequestQuote.body, body);
    const id = await withTenant(this.db, ctx, async (s) => {
      // O cliente da proposta: o pedido, se estiver no escopo; senão, o do vínculo.
      const [cliente] = await s.query<{ customer_id: string }>(
        `SELECT customer_id FROM aurora.accessible_customer_ids($1)
          WHERE $2::uuid IS NULL OR customer_id = $2
          ORDER BY customer_id LIMIT 1`,
        [ctx.membershipId, b.customer_id ?? null]
      );
      if (!cliente) throw new NotFoundError('cliente', b.customer_id ?? '—');
      return requestStoreQuote(s, {
        itemId: b.item_id,
        quantity: b.quantity,
        notes: b.notes ?? null,
        customerId: cliente.customer_id,
      });
    });
    return { opportunity_id: id };
  }
}
