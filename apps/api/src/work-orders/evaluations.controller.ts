/**
 * Aurora — avaliação e assinatura da OS pelo solicitante (conversa com o cliente, 21/10/2026).
 *
 * Rotas com caminho completo (`@Controller()` sem prefixo), como o `QrController`: `GET
 * /work-orders/:id/evaluation` tem um segmento a mais que `GET /work-orders/:id` e por isso não
 * disputa rota com ele, e `/evaluations/pending` vive fora do prefixo `work-orders` justamente
 * para não cair no `:id` (que exige uuid) conforme a ordem de declaração.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  withTenant,
  pendingEvaluations,
  getWorkOrderEvaluation,
  evaluateWorkOrder,
  type Database,
} from '@aurora/db';
import { ForbiddenError } from '@aurora/domain';
import { workOrderEvaluate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function meuVinculo(req: AuroraRequest): string {
  const id = req.auroraContext?.membershipId;
  if (!id) throw new ForbiddenError('esta rota exige um vínculo com a organização');
  return id;
}

@Controller()
export class EvaluationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** O campo de pendências: o que esta pessoa pediu, já foi concluído e ela ainda não avaliou. */
  @Get('evaluations/pending')
  @RequirePermissions('work_order.read')
  async pending(@Req() req: AuroraRequest): Promise<{ items: unknown[]; total: number }> {
    const eu = meuVinculo(req);
    const items = await withTenant(this.db, req.auroraContext!, (s) => pendingEvaluations(s, eu));
    return { items, total: items.length };
  }

  @Get('work-orders/:id/evaluation')
  @RequirePermissions('work_order.read')
  async get(
    @Req() req: AuroraRequest,
    @Param('id') id: string
  ): Promise<{ evaluation: unknown; can_evaluate: boolean }> {
    const eu = meuVinculo(req);
    const woId = uuidParam(id, 'id');
    return withTenant(this.db, req.auroraContext!, async (s) => {
      const evaluation = await getWorkOrderEvaluation(s, woId);
      const pendentes = evaluation ? [] : await pendingEvaluations(s, eu, 500);
      return { evaluation, can_evaluate: pendentes.some((p) => p.work_order_id === woId) };
    });
  }

  @Post('work-orders/:id/evaluation')
  @HttpCode(201)
  @RequirePermissions('service_request.create')
  async evaluate(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string; signature_id: string }> {
    const eu = meuVinculo(req);
    const b = parseWith(workOrderEvaluate.body, body);
    const r = await withTenant(this.db, req.auroraContext!, (s) =>
      evaluateWorkOrder(s, eu, uuidParam(id, 'id'), { rating: b.rating, comment: b.comment ?? null })
    );
    return { id: r.id, signature_id: r.signatureId };
  }
}
