/**
 * Aurora — execução guiada da OS pela HTTP (reunião 16/10/2026, Fase 5).
 *
 * As rotas por id passam pelo `ScopeGuard` (OS fora do cliente/setor → 404).
 * Executar exige `work_order.execute` OU `work_order.execute_any`: o
 * coordenador que não é o técnico atribuído também conduz o assistente.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  withTenant,
  checkIn,
  checkOut,
  listVisits,
  updateServiceReport,
  addCustomerPart,
  listCustomerParts,
  type Database,
  type TenantSession,
} from '@aurora/db';
import { ForbiddenError, NotFoundError } from '@aurora/domain';
import {
  workOrderCheckIn,
  workOrderCheckOut,
  workOrderServiceReport,
  workOrderCustomerPartsAdd,
} from '@aurora/contracts';
import { PermissionsCheckedInHandler, RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { runFieldOperation } from '../common/client-operation';
import type { AuroraRequest } from '../common/context.middleware';

function podeExecutar(req: AuroraRequest): void {
  const p = req.auroraContext!.permissions;
  if (!p.has('work_order.execute') && !p.has('work_order.execute_any')) {
    throw new ForbiddenError('work_order.execute');
  }
}

async function existe(s: TenantSession, id: string): Promise<void> {
  const [os] = await s.query(`SELECT 1 FROM aurora.work_orders WHERE id = $1`, [id]);
  if (!os) throw new NotFoundError('Ordem de serviço', id);
}

const MOTIVO = 'aceita work_order.execute ou work_order.execute_any';

@Controller('work-orders')
export class ExecucaoGuiadaController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post(':id/check-in')
  @RequirePermissions('work_order.read')
  @PermissionsCheckedInHandler(MOTIVO)
  async entrar(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    podeExecutar(req);
    const b = parseWith(workOrderCheckIn.body, body);
    /*
     * CHECK-IN E CHECK-OUT SÃO OPERAÇÕES DE CAMPO: o aparelho reenvia quando o
     * sinal volta. Sob a garantia de idempotência (x-aurora-client-operation),
     * o reenvio devolve o desfecho da primeira vez — e não um 409 de "você já
     * fez check-in" que faria a fila achar que falhou.
     */
    const r = await runFieldOperation(
      this.db,
      req,
      'POST /work-orders/:id/check-in',
      { work_order_id: id, ...b },
      (s) =>
        checkIn(s, uuidParam(id, 'id'), {
          latitude: b.latitude,
          longitude: b.longitude,
          accuracyM: b.accuracy_m,
          justification: b.justification,
        })
    );
    return { visit_id: r.visitId, time_entry_id: r.timeEntryId, occurred_at: r.occurredAt };
  }

  @Post(':id/check-out')
  @RequirePermissions('work_order.read')
  @PermissionsCheckedInHandler(MOTIVO)
  async sair(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    podeExecutar(req);
    const b = parseWith(workOrderCheckOut.body, body);
    const r = await runFieldOperation(
      this.db,
      req,
      'POST /work-orders/:id/check-out',
      { work_order_id: id, ...b },
      (s) =>
        checkOut(s, uuidParam(id, 'id'), {
          latitude: b.latitude,
          longitude: b.longitude,
          accuracyM: b.accuracy_m,
          justification: b.justification,
        })
    );
    return { visit_id: r.visitId, minutes: r.minutes, occurred_at: r.occurredAt };
  }

  @Get(':id/visits')
  @RequirePermissions('work_order.read')
  async visitas(@Req() req: AuroraRequest, @Param('id') id: string) {
    const woId = uuidParam(id, 'id');
    return withTenant(this.db, req.auroraContext!, async (s) => {
      await existe(s, woId);
      return { items: await listVisits(s, woId) };
    });
  }

  @Patch(':id/service-report')
  @RequirePermissions('work_order.read')
  @PermissionsCheckedInHandler(MOTIVO)
  async relatorio(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    podeExecutar(req);
    const b = parseWith(workOrderServiceReport.body, body);
    await withTenant(this.db, req.auroraContext!, (s) =>
      updateServiceReport(s, uuidParam(id, 'id'), {
        serviceDescription: b.service_description,
        serviceObservations: b.service_observations,
        operationalResult: b.operational_result,
        finalOpinion: b.final_opinion,
      })
    );
    return { ok: true as const };
  }

  @Post(':id/customer-parts')
  @RequirePermissions('work_order.read')
  @PermissionsCheckedInHandler(MOTIVO)
  async pecaDoCliente(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown) {
    podeExecutar(req);
    const b = parseWith(workOrderCustomerPartsAdd.body, body);
    const novo = await withTenant(this.db, req.auroraContext!, (s) =>
      addCustomerPart(s, uuidParam(id, 'id'), b)
    );
    return { id: novo };
  }

  @Get(':id/customer-parts')
  @RequirePermissions('work_order.read')
  async pecasDoCliente(@Req() req: AuroraRequest, @Param('id') id: string) {
    const woId = uuidParam(id, 'id');
    return withTenant(this.db, req.auroraContext!, async (s) => {
      await existe(s, woId);
      return { items: await listCustomerParts(s, woId) };
    });
  }
}
