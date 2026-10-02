/**
 * Aurora — oportunidade pela HTTP (gap V2 P1.7).
 *
 * Uma rota de transição, como documentos e orçamentos: a permissão sai da
 * aresta do grafo declarado no domínio. Não há rota de portal — se o cliente
 * vê as oportunidades dele é decisão comercial ainda não tomada (VAL-C).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createOpportunity,
  listOpportunities,
  opportunityDetail,
  transitionOpportunity,
  type Database,
} from '@aurora/db';
import { ForbiddenError, opportunityTransition, type OpportunityStatus } from '@aurora/domain';
import { opportunitiesList, opportunitiesCreate, opportunitiesTransition } from '@aurora/contracts';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('opportunity.read')
  async list(@Req() req: AuroraRequest, @Query() query: unknown): Promise<{ items: unknown[] }> {
    const q = parseWith(opportunitiesList.query, query);
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      listOpportunities(s, { status: q.status, customerId: q.customer, assetId: q.asset })
    );
    return { items };
  }

  @Post()
  @RequirePermissions('opportunity.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    const b = parseWith(opportunitiesCreate.body, body);
    const id = await withTenant(this.db, req.auroraContext!, (s) =>
      createOpportunity(s, {
        customerId: b.customer_id,
        origin: b.origin,
        title: b.title,
        need: b.need,
        priority: b.priority,
        dueOn: b.due_on ?? null,
        assetId: b.asset_id ?? null,
        workOrderId: b.work_order_id ?? null,
        serviceRequestId: b.service_request_id ?? null,
        supplierId: b.supplier_id ?? null,
      })
    );
    return { id };
  }

  @Get(':id')
  @RequirePermissions('opportunity.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    return withTenant(this.db, req.auroraContext!, (s) => opportunityDetail(s, uuidParam(id, 'id')));
  }

  @Post(':id/transitions')
  @HttpCode(200)
  @RequirePermissions('opportunity.read')
  @PermissionsCheckedInHandler(
    'cada aresta tem a sua permissão (opportunity.update, .authorize); o guard aqui é o piso'
  )
  async transition(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    const oppId = uuidParam(id, 'id');
    const b = parseWith(opportunitiesTransition.body, body);
    return withTenant(this.db, ctx, async (s) => {
      const { opportunity } = await opportunityDetail(s, oppId);
      const aresta = opportunityTransition(opportunity.status, b.to as OpportunityStatus);
      if (aresta && !ctx.permissions.has(aresta.permission)) throw new ForbiddenError(aresta.permission);
      await transitionOpportunity(s, oppId, b.to as OpportunityStatus, {
        note: b.note ?? null,
        reason: b.reason ?? null,
        quoteId: b.quote_id ?? null,
      });
      return (await opportunityDetail(s, oppId)).opportunity;
    });
  }
}
