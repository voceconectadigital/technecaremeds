/**
 * Aurora — ordens de serviço na camada de dados (SPEC v0.2 §09, §10 · EPIC-008).
 */
import {
  newId,
  formatWorkOrderNumber,
  evaluateTransition,
  FACTORY_STATUSES,
  FACTORY_WAIT_REASONS,
  FACTORY_TRANSITIONS,
  InvalidTransitionError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PreconditionFailedError,
  eventForTransition,
  type StatusCategory,
  type TransitionDefinition,
  type RequestPriority,
} from '@aurora/domain';
import type { EventType } from '@aurora/events';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { transitionRequest } from './service-requests';
import { completionCheck, completionRequirementsFor } from './execution';

export interface StatusRow {
  id: string;
  key: string;
  label: string;
  category: StatusCategory;
  position: number;
  requires_wait_reason: boolean;
}

/**
 * Provisiona situações, motivos de espera e o grafo de fábrica.
 *
 * Idempotente. As situações e motivos entram como `is_system`: a organização
 * renomeia, recolore e reordena, mas não apaga nem muda a categoria — mudar a
 * categoria de "Concluída" reinterpretaria em silêncio todas as OS já
 * registradas nela.
 */
export async function provisionWorkOrderStates(session: TenantSession): Promise<{
  statuses: Map<string, string>;
  waitReasons: Map<string, string>;
  transitions: number;
}> {
  const org = session.context.organizationId;
  const statuses = new Map<string, string>();

  for (const s of FACTORY_STATUSES) {
    const existing = await session.query<{ id: string }>(
      `SELECT id FROM aurora.work_order_statuses WHERE key = $1`,
      [s.key]
    );
    let id = existing[0]?.id;
    if (!id) {
      id = newId();
      await session.query(
        `INSERT INTO aurora.work_order_statuses
           (id, organization_id, key, label, category, color, position, requires_wait_reason, is_system, created_by)
         VALUES ($1, $2, $3, $4, $5::aurora.status_category, $6, $7, $8, true, $9)`,
        [
          id,
          org,
          s.key,
          s.label,
          s.category,
          s.color,
          s.position,
          s.requiresWaitReason ?? false,
          session.context.actorId,
        ]
      );
    }
    statuses.set(s.key, id);
  }

  const waitReasons = new Map<string, string>();
  for (const [i, w] of FACTORY_WAIT_REASONS.entries()) {
    const existing = await session.query<{ id: string }>(
      `SELECT id FROM aurora.wait_reasons WHERE key = $1`,
      [w.key]
    );
    let id = existing[0]?.id;
    if (!id) {
      id = newId();
      await session.query(
        `INSERT INTO aurora.wait_reasons
           (id, organization_id, key, label, pauses_sla, responsible, position, is_system, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::aurora.wait_responsible, $7, true, $8)`,
        [id, org, w.key, w.label, w.pausesSla, w.responsible, i, session.context.actorId]
      );
    }
    waitReasons.set(w.key, id);
  }

  let transitions = 0;
  for (const t of FACTORY_TRANSITIONS) {
    const from = statuses.get(t.from);
    const to = statuses.get(t.to);
    if (!from || !to) continue;
    const r = await session.query(
      `INSERT INTO aurora.work_order_status_transitions
         (organization_id, from_status_id, to_status_id, permission_key, required_fields, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (from_status_id, to_status_id) DO NOTHING
       RETURNING from_status_id`,
      [org, from, to, t.permission, t.requires ?? [], t.note]
    );
    transitions += r.length;
  }

  return { statuses, waitReasons, transitions };
}

/** O grafo da organização, na forma que o motor de domínio consome. */
export async function loadTransitionGraph(session: TenantSession): Promise<TransitionDefinition[]> {
  const rows = await session.query<{
    from_key: string;
    to_key: string;
    permission_key: string;
    required_fields: string[];
    note: string;
  }>(
    `SELECT f.key AS from_key, t2.key AS to_key, t.permission_key, t.required_fields, t.note
       FROM aurora.work_order_status_transitions t
       JOIN aurora.work_order_statuses f  ON f.id = t.from_status_id
       JOIN aurora.work_order_statuses t2 ON t2.id = t.to_status_id
      ORDER BY f.position, t2.position`
  );
  return rows.map((r) => ({
    from: r.from_key,
    to: r.to_key,
    permission: r.permission_key,
    requires: r.required_fields,
    note: r.note,
  }));
}

export async function loadStatuses(session: TenantSession): Promise<StatusRow[]> {
  return session.query<StatusRow>(
    `SELECT id, key, label, category::text AS category, position, requires_wait_reason
       FROM aurora.work_order_statuses
      WHERE archived_at IS NULL
      ORDER BY position, label`
  );
}

/* -------------------------------------------------------------------------- */
/* criação                                                                     */
/* -------------------------------------------------------------------------- */

export interface WorkOrderInput {
  customerId: string;
  workOrderTypeId: string;
  title: string;
  description?: string;
  locationId?: string | null;
  assetId?: string | null;
  serviceRequestId?: string | null;
  priority?: RequestPriority;
  criticalityId?: string | null;
  reportedFailureCodeId?: string | null;
  assigneeMembershipId?: string | null;
  source?: 'request' | 'plan' | 'manual' | 'inspection' | 'automation';
  /** Nasce publicada (`open`) ou como rascunho. */
  publish?: boolean;
}

async function statusIdByKey(session: TenantSession, key: string): Promise<string> {
  const [row] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.work_order_statuses WHERE key = $1 AND archived_at IS NULL`,
    [key]
  );
  if (!row) {
    throw new ValidationError(
      `a situação "${key}" não existe nesta organização; provisione as situações de fábrica primeiro`,
      { status: key }
    );
  }
  return row.id;
}

/**
 * Cria uma OS.
 *
 * O número só é gerado ao publicar (restrição `wo_number_when_published`): uma
 * série sem buraco não se gasta com rascunho que ninguém enviou.
 */
export async function createWorkOrder(
  session: TenantSession,
  input: WorkOrderInput
): Promise<{ id: string; number: string | null }> {
  const publica = input.publish !== false;
  const statusId = await statusIdByKey(session, publica ? 'open' : 'draft');

  let numero: string | null = null;
  if (publica) {
    const ano = new Date().getUTCFullYear();
    const [seq] = await session.query<{ next_number: string }>(
      `SELECT aurora.next_number($1, 'WO', $2) AS next_number`,
      [session.context.organizationId, ano]
    );
    numero = formatWorkOrderNumber(ano, Number(seq!.next_number));
  }

  const id = newId();
  await session.query(
    `INSERT INTO aurora.work_orders
       (id, organization_id, number, source, status_id, status_category, work_order_type_id,
        customer_id, location_id, asset_id, service_request_id, title, description,
        priority, criticality_id, reported_failure_code_id, assignee_membership_id, created_by)
     VALUES ($1, $2, $3, $4::aurora.work_order_source, $5, 'draft', $6,
             $7, $8, $9, $10, $11, $12,
             $13::aurora.request_priority, $14, $15, $16, $17)`,
    [
      id,
      session.context.organizationId,
      numero,
      input.source ?? 'manual',
      statusId,
      input.workOrderTypeId,
      input.customerId,
      input.locationId ?? null,
      input.assetId ?? null,
      input.serviceRequestId ?? null,
      input.title,
      input.description ?? '',
      input.priority ?? 'none',
      input.criticalityId ?? null,
      input.reportedFailureCodeId ?? null,
      input.assigneeMembershipId ?? null,
      session.context.actorId,
    ]
  );

  if (publica) {
    await emitEvent(session, {
      type: 'work_order.opened',
      aggregateId: id,
      payload: { number: numero, customer_id: input.customerId, asset_id: input.assetId ?? null },
    });
  }
  return { id, number: numero };
}

/* -------------------------------------------------------------------------- */
/* transições                                                                  */
/* -------------------------------------------------------------------------- */

export interface WorkOrderTransitionInput {
  waitReasonId?: string | null;
  waitNote?: string | null;
  resolution?: string | null;
  cancellationReason?: string | null;
  reworkReason?: string | null;
  reopenReason?: string | null;
  causeFailureCodeId?: string | null;
  actionCodeId?: string | null;
  assigneeMembershipId?: string | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  expectedVersion?: number;
}

/**
 * Move a OS para outra situação.
 *
 * A decisão é do motor de domínio contra o grafo da organização — a mensagem de
 * recusa nomeia as situações possíveis, que é o critério de aceite do épico. O
 * banco confere de novo por gatilho, para a regra valer também para o caminho
 * de escrita que ainda não existe.
 */
export async function transitionWorkOrder(
  session: TenantSession,
  workOrderId: string,
  toStatusKey: string,
  input: WorkOrderTransitionInput = {}
): Promise<{ status: string; category: StatusCategory; version: number }> {
  const [atual] = await session.query<{
    status_key: string;
    status_label: string;
    category: StatusCategory;
    version: number;
    number: string | null;
    resolution: string | null;
  }>(
    `SELECT s.key AS status_key, s.label AS status_label, w.status_category::text AS category,
            w.version, w.number, w.resolution
       FROM aurora.work_orders w
       JOIN aurora.work_order_statuses s ON s.id = w.status_id
      WHERE w.id = $1`,
    [workOrderId]
  );
  if (!atual) throw new NotFoundError('Ordem de serviço', workOrderId);

  if (input.expectedVersion !== undefined && input.expectedVersion !== atual.version) {
    throw new ConflictError(
      'a ordem de serviço mudou desde que você a carregou; recarregue e tente de novo',
      {
        expected_version: input.expectedVersion,
        current_version: atual.version,
      }
    );
  }

  const destinos = await loadStatuses(session);
  const destino = destinos.find((s) => s.key === toStatusKey);
  if (!destino) {
    throw new ValidationError(`situação "${toStatusKey}" não existe nesta organização`, {
      field: 'to',
      allowed: destinos.map((s) => s.key),
    });
  }

  const graph = await loadTransitionGraph(session);
  const avaliacao = evaluateTransition({
    from: { key: atual.status_key, label: atual.status_label, category: atual.category },
    to: {
      key: destino.key,
      label: destino.label,
      category: destino.category,
      requiresWaitReason: destino.requires_wait_reason,
    },
    graph,
    permissions: session.context.permissions,
    fields: {
      wait_reason_id: input.waitReasonId,
      resolution: input.resolution ?? atual.resolution,
      cancellation_reason: input.cancellationReason,
      rework_reason: input.reworkReason,
      reopen_reason: input.reopenReason,
      assignee: input.assigneeMembershipId,
      scheduled_start: input.scheduledStart?.toISOString(),
      customer_id: 'presente',
      location_id: 'presente',
      work_order_type_id: 'presente',
    },
  });
  if (!avaliacao.allowed) {
    throw new InvalidTransitionError(atual.status_label, destino.label, avaliacao.allowedTargets);
  }

  // O BLOCO DE CONCLUSÃO (SPEC §10).
  //
  // Roda aqui, e não numa rota, porque concluir é uma transição — e uma
  // transição vale igual pela API, pelo Kanban e pelo aplicativo de campo. Os
  // requisitos vêm da NATUREZA da OS: uma preventiva exige checklist e foto,
  // uma corretiva de urgência exige a resolução e mais nada.
  //
  // A recusa devolve a lista do que falta, item a item, com o detalhe. Nunca
  // "Erro!" — quem lê isso está de pé, ao lado do equipamento.
  if (destino.category === 'review') {
    const requisitos = await completionRequirementsFor(session, workOrderId);
    if (requisitos.length > 0) {
      // A resolução informada nesta chamada ainda não está gravada; passa junto
      // para não exigir duas idas ao banco nem recusar o que a pessoa acabou de
      // escrever.
      const check = await completionCheck(session, workOrderId, requisitos, {
        resolution: input.resolution ?? atual.resolution,
      });
      if (!check.ok) {
        throw new PreconditionFailedError(
          `faltam requisitos para concluir: ${check.missing.map((m) => m.label).join('; ')}`,
          { missing: check.missing }
        );
      }
    }
  }

  const rows = await session.query<{ status_category: StatusCategory; version: number }>(
    `UPDATE aurora.work_orders
        SET status_id = $2,
            wait_reason_id = $3,
            wait_note = $4,
            resolution = coalesce($5, resolution),
            cancellation_reason = coalesce($6, cancellation_reason),
            rework_reason = coalesce($7, rework_reason),
            reopen_reason = coalesce($8, reopen_reason),
            cause_failure_code_id = coalesce($9, cause_failure_code_id),
            action_code_id = coalesce($10, action_code_id),
            assignee_membership_id = coalesce($11, assignee_membership_id),
            scheduled_start = coalesce($12, scheduled_start),
            scheduled_end = coalesce($13, scheduled_end),
            updated_by = $14
      WHERE id = $1
      RETURNING status_category::text AS status_category, version`,
    [
      workOrderId,
      destino.id,
      destino.category === 'waiting' ? (input.waitReasonId ?? null) : null,
      destino.category === 'waiting' ? (input.waitNote ?? null) : null,
      input.resolution ?? null,
      input.cancellationReason ?? null,
      input.reworkReason ?? null,
      input.reopenReason ?? null,
      input.causeFailureCodeId ?? null,
      input.actionCodeId ?? null,
      input.assigneeMembershipId ?? null,
      input.scheduledStart?.toISOString() ?? null,
      input.scheduledEnd?.toISOString() ?? null,
      session.context.actorId,
    ]
  );

  const evento = eventForTransition(
    { key: atual.status_key, label: atual.status_label, category: atual.category },
    {
      key: destino.key,
      label: destino.label,
      category: destino.category,
      requiresWaitReason: destino.requires_wait_reason,
    }
  );
  if (evento) {
    await emitEvent(session, {
      type: evento as EventType,
      aggregateId: workOrderId,
      payload: { number: atual.number, from: atual.status_key, to: destino.key },
    });
  }

  return { status: destino.key, category: destino.category, version: rows[0]!.version };
}

/* -------------------------------------------------------------------------- */
/* aceite de solicitação                                                       */
/* -------------------------------------------------------------------------- */

export interface AcceptTarget {
  assetId?: string | null;
  locationId?: string | null;
  workOrderTypeId: string;
  title?: string;
  assigneeMembershipId?: string | null;
}

/**
 * Aceita a solicitação e gera 1..N ordens de serviço, numa operação.
 *
 * O critério de aceite do EPIC-007: "uma solicitação com 3 ativos gera 3 OS
 * vinculadas em uma operação". As OS herdam cliente, local, sintoma e
 * prioridade do relato — e nenhuma delas pode existir sem a solicitação ter
 * mudado de estado, porque tudo acontece na mesma transação.
 */
export async function acceptServiceRequest(
  session: TenantSession,
  requestId: string,
  targets: readonly AcceptTarget[]
): Promise<{ workOrders: Array<{ id: string; number: string | null }> }> {
  if (targets.length === 0) {
    throw new ValidationError('aceitar exige ao menos uma ordem de serviço a gerar', { field: 'targets' });
  }

  const [pedido] = await session.query<{
    customer_id: string;
    location_id: string | null;
    asset_id: string | null;
    summary: string;
    description: string;
    priority: RequestPriority;
    reported_failure_code_id: string | null;
  }>(
    `SELECT customer_id, location_id, asset_id, summary, description,
            priority::text AS priority, reported_failure_code_id
       FROM aurora.service_requests WHERE id = $1`,
    [requestId]
  );
  if (!pedido) throw new NotFoundError('Solicitação', requestId);

  // A transição primeiro: se ela não for válida — falta permissão, estado
  // errado — nenhuma OS chega a ser criada.
  await transitionRequest(session, requestId, 'accepted');

  const workOrders: Array<{ id: string; number: string | null }> = [];
  for (const [i, alvo] of targets.entries()) {
    const criada = await createWorkOrder(session, {
      customerId: pedido.customer_id,
      workOrderTypeId: alvo.workOrderTypeId,
      title:
        alvo.title ??
        (targets.length > 1 ? `${pedido.summary} (${i + 1}/${targets.length})` : pedido.summary),
      description: pedido.description,
      locationId: alvo.locationId ?? pedido.location_id,
      assetId: alvo.assetId ?? pedido.asset_id,
      serviceRequestId: requestId,
      priority: pedido.priority,
      reportedFailureCodeId: pedido.reported_failure_code_id,
      assigneeMembershipId: alvo.assigneeMembershipId ?? null,
      source: 'request',
    });
    workOrders.push(criada);
  }

  return { workOrders };
}

/* -------------------------------------------------------------------------- */
/* leitura                                                                     */
/* -------------------------------------------------------------------------- */

/** Histórico com duração e motivo — a base do "quanto tempo esperando o quê". */
export async function workOrderHistory(
  session: TenantSession,
  workOrderId: string
): Promise<Array<Record<string, unknown>>> {
  return session.query(
    `SELECT h.changed_at, h.seconds_in_from, h.from_category::text, h.to_category::text,
            f.label AS from_label, t.label AS to_label, w.label AS wait_reason_label
       FROM aurora.work_order_status_history h
       LEFT JOIN aurora.work_order_statuses f ON f.id = h.from_status_id
       JOIN aurora.work_order_statuses t      ON t.id = h.to_status_id
       LEFT JOIN aurora.wait_reasons w        ON w.id = h.wait_reason_id
      WHERE h.work_order_id = $1
      ORDER BY h.sequence`,
    [workOrderId]
  );
}

/** Tempo perdido por motivo de espera — a pergunta que o ADR-004 destravou. */
export async function waitTimeByReason(
  session: TenantSession,
  from: Date,
  to: Date
): Promise<
  Array<{ wait_reason_key: string; wait_reason_label: string; pauses_sla: boolean; total_seconds: string }>
> {
  return session.query(
    `SELECT wait_reason_key, wait_reason_label, pauses_sla, total_seconds, occurrences
       FROM aurora.wait_time_by_reason($1, $2)`,
    [from.toISOString(), to.toISOString()]
  );
}
