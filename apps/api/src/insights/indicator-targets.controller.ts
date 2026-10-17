/**
 * Aurora — metas dos indicadores pela HTTP (auditoria 17/10/2026, §13).
 *
 * Leitura com `insight.read` (o operador e quem consulta o Painel veem a meta
 * que vale para eles). Escrita só com `insight.manage_targets` — gestor e
 * administrador. O backend é a autoridade: a tela só esconde o botão.
 *
 * O recorte por cliente do vínculo vale nas duas pontas (`indicator-targets.ts`).
 * Meta apagada é arquivada: a trilha de auditoria preserva o histórico.
 */
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  membershipScope,
  listIndicatorTargets,
  createIndicatorTarget,
  updateIndicatorTarget,
  archiveIndicatorTarget,
  type Database,
  type IndicatorTargetView,
} from '@aurora/db';
import { indicatorTargetsCreate, indicatorTargetsList, indicatorTargetsUpdate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function saida(t: IndicatorTargetView) {
  return {
    id: t.id,
    indicator_key: t.indicatorKey,
    customer_id: t.customerId,
    contract_id: t.contractId,
    scope: t.scope,
    valid_from: t.validFrom,
    valid_to: t.validTo,
    value: t.value,
    unit: t.unit,
    direction: t.direction,
    timeline: t.timeline,
    note: t.note,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

@Controller('indicator-targets')
export class IndicatorTargetsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('insight.read')
  async list(@Req() req: AuroraRequest, @Query() query: unknown) {
    const ctx = req.auroraContext!;
    const q = parseWith(indicatorTargetsList.query, query);
    const itens = await withTenant(this.db, ctx, async (s) =>
      listIndicatorTargets(s, await membershipScope(s, ctx.membershipId), {
        indicatorKey: q.indicator_key,
        customerId: q.customer_id,
        contractId: q.contract_id,
      })
    );
    return { items: itens.map(saida) };
  }

  @Post()
  @RequirePermissions('insight.manage_targets')
  async create(@Req() req: AuroraRequest, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    const b = parseWith(indicatorTargetsCreate.body, body);
    const t = await withTenant(this.db, ctx, async (s) =>
      createIndicatorTarget(s, await membershipScope(s, ctx.membershipId), {
        indicatorKey: b.indicator_key,
        customerId: b.customer_id ?? null,
        contractId: b.contract_id ?? null,
        validFrom: b.valid_from,
        validTo: b.valid_to ?? null,
        value: b.value,
        direction: b.direction,
        unit: b.unit,
        note: b.note ?? null,
      })
    );
    return saida(t);
  }

  @Patch(':id')
  @RequirePermissions('insight.manage_targets')
  async update(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    const ctx = req.auroraContext!;
    const b = parseWith(indicatorTargetsUpdate.body, body);
    const t = await withTenant(this.db, ctx, async (s) =>
      updateIndicatorTarget(s, await membershipScope(s, ctx.membershipId), uuidParam(id, 'id'), {
        validFrom: b.valid_from,
        validTo: b.valid_to,
        value: b.value,
        direction: b.direction,
        note: b.note,
      })
    );
    return saida(t);
  }

  @Delete(':id')
  @RequirePermissions('insight.manage_targets')
  async archive(@Req() req: AuroraRequest, @Param('id') id: string) {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, async (s) =>
      archiveIndicatorTarget(s, await membershipScope(s, ctx.membershipId), uuidParam(id, 'id'))
    );
    return { ok: true as const };
  }
}
