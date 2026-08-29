/**
 * Aurora — solicitações pela HTTP (SPEC v0.2 §08, ADR-002 · EPIC-007).
 *
 * A superfície de escrita é deliberadamente estreita, e essa estreiteza é o que
 * o ADR-002 comprou: o portal do cliente escreve em UMA tabela, por DUAS rotas
 * — abrir e cancelar. Todo o resto do fluxo é operação interna, com permissão
 * própria. No modelo recusado (chamado como visão da OS), o cliente escreveria
 * na mesma tabela que o técnico e cada permissão viraria condicional de campo.
 *
 * Não existe `PATCH /service-requests/:id` que aceite `status`. Mudar de estado
 * é `POST /:id/transitions`, com o estado de destino no corpo — porque uma
 * transição não é uma edição de campo: ela valida guarda, exige campos,
 * escreve histórico e emite evento.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createServiceRequest,
  transitionRequest,
  duplicateHints,
  triageQueue,
  statusHistory,
  type Database,
} from '@aurora/db';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  availableTransitions,
  REQUEST_STATUSES,
  REQUEST_PRIORITIES,
  SERVICE_REQUEST_SOURCES,
  type RequestStatus,
  type RequestPriority,
  type ServiceRequestSource,
} from '@aurora/domain';
import { RequirePermissions, PermissionsCheckedInHandler } from '../common/permissions.guard';
import { optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} é obrigatório`, { field, allowed });
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} inválido`, { field, allowed });
  }
  return value as T;
}

@Controller('service-requests')
export class ServiceRequestsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Abre uma solicitação, devolvendo junto os avisos de duplicidade.
   *
   * Os avisos vêm na resposta da criação, e não numa consulta anterior, por um
   * motivo prático: entre "consultar" e "enviar" alguém pode ter aberto a
   * mesma. Avisar depois, com a solicitação já criada e apontando a parecida,
   * é honesto — e continua não bloqueando, como manda a SPEC §08.
   */
  @Post()
  @RequirePermissions('service_request.create')
  async create(
    @Req() req: AuroraRequest,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string; number: string; duplicate_hints: unknown[] }> {
    const ctx = req.auroraContext!;
    if (typeof body.summary !== 'string' || body.summary.trim().length < 3) {
      throw new ValidationError('summary precisa de ao menos 3 caracteres', { field: 'summary' });
    }
    const entrada = {
      customerId: uuidParam(body.customer_id, 'customer_id'),
      summary: body.summary.trim(),
      description: typeof body.description === 'string' ? body.description : '',
      source: oneOf<ServiceRequestSource>(body.source, SERVICE_REQUEST_SOURCES, 'source', 'portal'),
      locationId: optionalUuid(body.location_id, 'location_id'),
      assetId: optionalUuid(body.asset_id, 'asset_id'),
      reportedFailureCodeId: optionalUuid(body.reported_failure_code_id, 'reported_failure_code_id'),
      requestedPriority: oneOf<RequestPriority>(
        body.requested_priority,
        REQUEST_PRIORITIES,
        'requested_priority',
        'none'
      ),
      requesterName: typeof body.requester_name === 'string' ? body.requester_name : null,
      requesterPhone: typeof body.requester_phone === 'string' ? body.requester_phone : null,
      requesterEmail: typeof body.requester_email === 'string' ? body.requester_email : null,
      submit: body.submit !== false,
    };

    return withTenant(this.db, ctx, async (s) => {
      const hints = await duplicateHints(s, {
        assetId: entrada.assetId,
        locationId: entrada.locationId,
        failureCodeId: entrada.reportedFailureCodeId,
      });
      const criada = await createServiceRequest(s, entrada);
      return { ...criada, duplicate_hints: hints };
    });
  }

  /** Fila de triagem, já na ordem de prioridade e idade. */
  @Get('queue')
  @RequirePermissions('service_request.read')
  async queue(@Req() req: AuroraRequest, @Query('limit') limit?: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const max = Math.min(Number.parseInt(limit ?? '200', 10) || 200, 500);
    const items = await withTenant(this.db, ctx, (s) => triageQueue(s, { limit: max }));
    return { items };
  }

  /**
   * Ficha da solicitação, com as transições que ESTA pessoa pode fazer agora.
   *
   * A interface não deve descobrir o que é possível tentando e lendo o erro —
   * era assim na referência, e é o que a lista de transições disponíveis
   * elimina. O que vem aqui já está filtrado pelas permissões efetivas.
   */
  // Parâmetro restrito ao formato de uuid: sem isso `GET /service-requests/queue`
  // casaria com `:id`, e qual ganha dependeria da ordem de declaração.
  @Get(':id')
  @RequirePermissions('service_request.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    const ctx = req.auroraContext!;
    const requestId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const [row] = await s.query<Record<string, unknown>>(
        `SELECT r.*, c.name AS customer_name, l.name AS location_name, a.name AS asset_name,
                sintoma.label AS reported_failure_label,
                motivo.label AS rejection_reason_label
           FROM aurora.service_requests r
           JOIN aurora.customers c            ON c.id = r.customer_id
           LEFT JOIN aurora.locations l       ON l.id = r.location_id
           LEFT JOIN aurora.assets a          ON a.id = r.asset_id
           LEFT JOIN aurora.catalog_items sintoma ON sintoma.id = r.reported_failure_code_id
           LEFT JOIN aurora.catalog_items motivo  ON motivo.id = r.rejection_reason_id
          WHERE r.id = $1`,
        [requestId]
      );
      if (!row) throw new NotFoundError('Solicitação', requestId);

      const historico = await statusHistory(s, requestId);
      const disponiveis = availableTransitions(row.status as RequestStatus, ctx.permissions);
      return {
        ...row,
        history: historico,
        available_transitions: disponiveis.map((r) => ({
          to: r.to,
          requires: r.requires ?? [],
          note: r.note,
        })),
      };
    });
  }

  /**
   * Move a solicitação de estado.
   *
   * Uma rota só para todas as transições, e não `/accept`, `/reject`,
   * `/merge` separadas. O motivo é que o grafo é a fonte de verdade: uma rota
   * por transição criaria um segundo lugar onde as transições estão listadas,
   * e os dois divergiriam no dia em que o grafo mudasse.
   */
  @Post(':id/transitions')
  @RequirePermissions('service_request.read')
  @PermissionsCheckedInHandler(
    'cada aresta tem a sua permissão (service_request.triage, .accept, .reject, .merge); o guard aqui é o piso'
  )
  async transition(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ status: string; version: number }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId && body.to !== 'cancelled') {
      throw new ForbiddenError('esta transição exige um vínculo com a organização');
    }
    const to = oneOf<RequestStatus>(body.to, REQUEST_STATUSES, 'to');

    return withTenant(this.db, ctx, (s) =>
      transitionRequest(s, uuidParam(id, 'id'), to, {
        rejectionReasonId: optionalUuid(body.rejection_reason_id, 'rejection_reason_id'),
        mergedIntoRequestId: optionalUuid(body.merged_into_request_id, 'merged_into_request_id'),
        cancellationReason: typeof body.cancellation_reason === 'string' ? body.cancellation_reason : null,
        infoRequest: typeof body.info_request === 'string' ? body.info_request : null,
        priority:
          body.priority === undefined
            ? undefined
            : oneOf<RequestPriority>(body.priority, REQUEST_PRIORITIES, 'priority'),
        expectedVersion: typeof body.version === 'number' ? body.version : undefined,
      })
    );
  }
}
