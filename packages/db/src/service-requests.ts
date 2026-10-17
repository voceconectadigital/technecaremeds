/**
 * Aurora — solicitações de serviço na camada de dados (SPEC v0.2 §08 · EPIC-007).
 */
import {
  newId,
  formatRequestNumber,
  canTransition,
  availableTransitions,
  findDuplicateHints,
  triageOrder,
  InvalidTransitionError,
  ValidationError,
  NotFoundError,
  type RequestStatus,
  type ServiceRequestSource,
  type RequestPriority,
  type DuplicateHint,
  type DuplicateCandidate,
} from '@aurora/domain';
import type { EventType } from '@aurora/events';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { startSlaClock, stopSlaClock, cancelSlaClocks } from './sla';

export interface ServiceRequestInput {
  customerId: string;
  summary: string;
  description?: string;
  source?: ServiceRequestSource;
  locationId?: string | null;
  assetId?: string | null;
  reportedFailureCodeId?: string | null;
  requestedPriority?: RequestPriority;
  /** Tipo da solicitação — lista fechada (0064). */
  requestedType?: string | null;
  requesterMembershipId?: string | null;
  requesterName?: string | null;
  requesterPhone?: string | null;
  requesterEmail?: string | null;
  /** Cria já submetida, que é o caminho de quem abre por telefone ou QR. */
  submit?: boolean;
}

export interface ServiceRequestRow {
  id: string;
  number: string;
  status: RequestStatus;
  priority: RequestPriority;
  summary: string;
  customer_id: string;
  location_id: string | null;
  asset_id: string | null;
  created_at: string;
  version: number;
}

/**
 * Cria a solicitação, reservando o número na série do ano.
 *
 * O número sai de `aurora.next_number`, que incrementa sob bloqueio de linha.
 * Deliberadamente não é `max(number) + 1`: sob duas submissões simultâneas
 * aquilo produz o mesmo número duas vezes, e é o defeito clássico deste campo.
 */
export async function createServiceRequest(
  session: TenantSession,
  input: ServiceRequestInput
): Promise<{ id: string; number: string }> {
  const id = newId();
  const ano = new Date().getUTCFullYear();
  const [seq] = await session.query<{ next_number: string }>(
    `SELECT aurora.next_number($1, 'SR', $2) AS next_number`,
    [session.context.organizationId, ano]
  );
  const numero = formatRequestNumber(ano, Number(seq!.next_number));
  const status: RequestStatus = input.submit === false ? 'draft' : 'submitted';

  await session.query(
    `INSERT INTO aurora.service_requests
       (id, organization_id, number, source, status, customer_id, location_id, asset_id,
        summary, description, reported_failure_code_id, requested_priority, priority,
        requester_membership_id, requester_name, requester_phone, requester_email,
        submitted_at, created_by, requested_type)
     VALUES ($1, $2, $3, $4::aurora.request_source, $5::aurora.request_status, $6, $7, $8,
             $9, $10, $11, $12::aurora.request_priority, $12::aurora.request_priority,
             $13, $14, $15, $16, $17, $18, $19)`,
    [
      id,
      session.context.organizationId,
      numero,
      input.source ?? 'portal',
      status,
      input.customerId,
      input.locationId ?? null,
      input.assetId ?? null,
      input.summary,
      input.description ?? '',
      input.reportedFailureCodeId ?? null,
      input.requestedPriority ?? 'none',
      input.requesterMembershipId ?? session.context.membershipId,
      input.requesterName ?? null,
      input.requesterPhone ?? null,
      input.requesterEmail ?? null,
      status === 'submitted' ? new Date().toISOString() : null,
      session.context.actorId,
      input.requestedType ?? null,
    ]
  );

  if (status === 'submitted') {
    await emitEvent(session, {
      type: 'service_request.created',
      aggregateId: id,
      payload: { number: numero, customer_id: input.customerId, asset_id: input.assetId ?? null },
    });

    // O relógio de RESPOSTA — tempo até alguém olhar — vive aqui, e não na OS.
    // É a separação do ADR-002 aparecendo no SLA: demanda e trabalho têm prazos
    // diferentes porque são coisas diferentes.
    await startSlaClock(session, {
      documentType: 'service_request',
      documentId: id,
      kind: 'response',
      priority: input.requestedPriority ?? 'none',
      assetId: input.assetId ?? null,
      customerId: input.customerId,
      locationId: input.locationId ?? null,
    });
  }
  return { id, number: numero };
}

/**
 * Evento de domínio correspondente a uma transição — quando existe.
 *
 * Nem todo estado tem evento, e isso é deliberado. O catálogo de eventos (§31)
 * publica o que o mundo de fora precisa saber: `triaged`, `accepted`,
 * `rejected`, `merged`, `cancelled`, `fulfilled`. Estados derivados das ordens
 * de serviço — `in_service`, `closed` — não geram evento próprio porque o fato
 * que os causou já foi publicado pela OS; emitir de novo daria a automação dois
 * gatilhos para o mesmo acontecimento.
 *
 * O mapa é explícito, e não `service_request.${status}`, porque os nomes não
 * coincidem: o estado é `duplicate`, o evento é `merged`; o estado é
 * `info_needed`, o evento é `info_requested`. Derivar o nome faria emitir tipos
 * que o catálogo recusa — e a recusa só apareceria em produção, no primeiro
 * chamado marcado como duplicata.
 */
const EVENT_BY_STATUS: Partial<Record<RequestStatus, EventType>> = {
  triage: 'service_request.triaged',
  info_needed: 'service_request.info_requested',
  accepted: 'service_request.accepted',
  rejected: 'service_request.rejected',
  duplicate: 'service_request.merged',
  cancelled: 'service_request.cancelled',
  fulfilled: 'service_request.fulfilled',
};

/**
 * Solicitações abertas parecidas com a que está sendo aberta.
 *
 * Avisa, não bloqueia (SPEC §08). A janela padrão é de 7 dias.
 */
export async function duplicateHints(
  session: TenantSession,
  candidate: { assetId?: string | null; locationId?: string | null; failureCodeId?: string | null },
  opts: { windowDays?: number; now?: Date } = {}
): Promise<DuplicateHint[]> {
  const dias = opts.windowDays ?? 7;
  const abertas = await session.query<DuplicateCandidate>(
    `SELECT id, number, summary, created_at, asset_id, location_id, reported_failure_code_id
       FROM aurora.service_requests
      WHERE status IN ('submitted', 'triage', 'info_needed', 'accepted', 'in_service')
        AND created_at > now() - make_interval(days => $1)
        AND (($2::uuid IS NOT NULL AND asset_id = $2)
             OR ($3::uuid IS NOT NULL AND $4::uuid IS NOT NULL
                 AND location_id = $3 AND reported_failure_code_id = $4))
      ORDER BY created_at DESC
      LIMIT 20`,
    [dias, candidate.assetId ?? null, candidate.locationId ?? null, candidate.failureCodeId ?? null]
  );
  return findDuplicateHints(
    {
      assetId: candidate.assetId ?? null,
      locationId: candidate.locationId ?? null,
      failureCodeId: candidate.failureCodeId ?? null,
    },
    abertas,
    opts.now ?? new Date(),
    dias
  );
}

export interface TransitionInput {
  rejectionReasonId?: string | null;
  mergedIntoRequestId?: string | null;
  cancellationReason?: string | null;
  infoRequest?: string | null;
  /** Observação da recusa, que o cliente lê junto do motivo. */
  rejectionNote?: string | null;
  priority?: RequestPriority;
  /** Versão que o cliente carregou; protege contra escrita concorrente. */
  expectedVersion?: number;
}

/**
 * Move a solicitação de estado.
 *
 * A decisão de permitir ou não é do domínio (`canTransition`), com a mensagem
 * que nomeia as saídas possíveis. O banco confere de novo, por constraint e por
 * gatilho — não por desconfiança do código, mas porque a regra tem de valer
 * também para o caminho de escrita que ainda não existe.
 */
export async function transitionRequest(
  session: TenantSession,
  requestId: string,
  to: RequestStatus,
  input: TransitionInput = {}
): Promise<{ status: RequestStatus; version: number }> {
  const [atual] = await session.query<{ status: RequestStatus; version: number; number: string }>(
    `SELECT status::text AS status, version, number FROM aurora.service_requests WHERE id = $1`,
    [requestId]
  );
  if (!atual) throw new NotFoundError('Solicitação', requestId);

  if (input.expectedVersion !== undefined && input.expectedVersion !== atual.version) {
    throw new ValidationError('a solicitação mudou desde que você a carregou; recarregue e tente de novo', {
      expected_version: input.expectedVersion,
      current_version: atual.version,
    });
  }

  const check = canTransition(atual.status, to, {
    permissions: session.context.permissions,
    fields: {
      rejection_reason_id: input.rejectionReasonId,
      merged_into_request_id: input.mergedIntoRequestId,
      cancellation_reason: input.cancellationReason,
      info_request: input.infoRequest,
    },
  });
  if (!check.allowed) {
    throw new InvalidTransitionError(
      atual.status,
      to,
      availableTransitions(atual.status, session.context.permissions).map((r) => r.to)
    );
  }

  const rows = await session.query<{ status: RequestStatus; version: number }>(
    `UPDATE aurora.service_requests
        SET status = $2::aurora.request_status,
            rejection_reason_id = coalesce($3, rejection_reason_id),
            merged_into_request_id = coalesce($4, merged_into_request_id),
            cancellation_reason = coalesce($5, cancellation_reason),
            info_request = coalesce($6, info_request),
            priority = coalesce($7::aurora.request_priority, priority),
            updated_by = $8,
            rejection_note = coalesce($9, rejection_note)
      WHERE id = $1
      RETURNING status::text AS status, version`,
    [
      requestId,
      to,
      input.rejectionReasonId ?? null,
      input.mergedIntoRequestId ?? null,
      input.cancellationReason ?? null,
      input.infoRequest ?? null,
      input.priority ?? null,
      session.context.actorId,
      input.rejectionNote ?? null,
    ]
  );

  // O relógio de resposta encerra na TRIAGEM: o compromisso é olhar, não
  // resolver. Encerrá-lo no aceite mediria outra coisa e esconderia o tempo que
  // a solicitação passou parada esperando decisão.
  if (to === 'triage') {
    await stopSlaClock(session, 'service_request', requestId, 'response');
  } else if (to === 'rejected' || to === 'duplicate' || to === 'cancelled') {
    await cancelSlaClocks(session, 'service_request', requestId);
  }

  const evento = EVENT_BY_STATUS[to];
  if (evento) {
    await emitEvent(session, {
      type: evento,
      aggregateId: requestId,
      payload: { number: atual.number, from: atual.status, to },
    });
  }

  return rows[0]!;
}

/**
 * Fila de triagem, já ordenada.
 *
 * A ordenação sai do domínio (`triageOrder`) e não do `ORDER BY`, porque a
 * regra — prioridade primeiro, idade depois — precisa valer igual na fila da
 * web, na do aplicativo de campo e em qualquer relatório. Regra de negócio
 * escrita três vezes em três `ORDER BY` diverge na primeira mudança.
 */
export async function triageQueue(
  session: TenantSession,
  opts: { limit?: number; scopeMembershipId?: string | null } = {}
): Promise<ServiceRequestRow[]> {
  const rows = await session.query<ServiceRequestRow>(
    `SELECT id, number, status::text AS status, priority::text AS priority, summary,
            customer_id, location_id, asset_id, created_at, version
       FROM aurora.service_requests r
      WHERE status IN ('submitted', 'triage', 'info_needed')
        AND ($2::uuid IS NULL
             OR (r.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
                 AND (r.location_id IS NULL
                      OR r.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))))
      LIMIT $1`,
    [opts.limit ?? 200, opts.scopeMembershipId ?? null]
  );
  return triageOrder(rows);
}

/** Histórico de estados com o tempo passado em cada um. */
export async function statusHistory(
  session: TenantSession,
  requestId: string
): Promise<
  Array<{ from_status: string | null; to_status: string; changed_at: string; seconds_in_from: string }>
> {
  return session.query(
    `SELECT from_status::text, to_status::text, changed_at, seconds_in_from
       FROM aurora.service_request_status_history
      WHERE request_id = $1
      ORDER BY sequence`,
    [requestId]
  );
}
