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
import {
  assertCanExecuteWorkOrder,
  completionCheck,
  completionRequirementsFor,
  signWorkOrder,
} from './execution';
import { requiresOperationalResult } from './organization-config';
import { startSlaClock, stopSlaClock, pauseSlaClocks, resumeSlaClocks, cancelSlaClocks } from './sla';
import { releaseReservations } from './inventory';
import { decommissionAsset } from './assets';

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
        // `customer_label` entra AQUI, e não só na migration 0042.
        //
        // A migration semeou o vocabulário das organizações que já existiam.
        // Sem esta coluna no provisionamento, toda organização NOVA nasceria
        // com situações sem rótulo de cliente — e o portal dela mostraria a
        // palavra da equipe, ou nada.
        `INSERT INTO aurora.work_order_statuses
           (id, organization_id, key, label, customer_label, category, color, position,
            requires_wait_reason, is_system, created_by, visible_on_board)
         VALUES ($1, $2, $3, $4, $5, $6::aurora.status_category, $7, $8, $9, true, $10, $11)`,
        [
          id,
          org,
          s.key,
          s.label,
          s.customerLabel ?? null,
          s.category,
          s.color,
          s.position,
          s.requiresWaitReason ?? false,
          session.context.actorId,
          s.visibleOnBoard ?? true,
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
           (id, organization_id, key, label, customer_label, pauses_sla, responsible,
            position, is_system, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::aurora.wait_responsible, $8, true, $9)`,
        [
          id,
          org,
          w.key,
          w.label,
          w.customerLabel ?? null,
          w.pausesSla,
          w.responsible,
          i,
          session.context.actorId,
        ]
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
  /** Série da numeração (padrão `WO`; o laudo de obsolescência usa `OBC`). */
  numberSeries?: string;
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
    const serie = input.numberSeries ?? 'WO';
    const [seq] = await session.query<{ next_number: string }>(
      `SELECT aurora.next_number($1, $3, $2) AS next_number`,
      [session.context.organizationId, ano, serie]
    );
    numero = formatWorkOrderNumber(ano, Number(seq!.next_number), serie);
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

    // Os relógios de ATENDIMENTO e RESOLUÇÃO nascem com a OS publicada (§11).
    // O de RESPOSTA não nasce aqui: ele vive na solicitação, e mede o tempo até
    // alguém olhar — coisa diferente de tempo até consertar. Manter os dois no
    // mesmo relógio é o que a referência fazia, e é o que impede saber se o
    // gargalo está na triagem ou na oficina.
    for (const kind of ['onsite', 'resolution'] as const) {
      await startSlaClock(session, {
        documentType: 'work_order',
        documentId: id,
        kind,
        priority: input.priority ?? 'none',
        assetId: input.assetId ?? null,
        customerId: input.customerId,
        locationId: input.locationId ?? null,
      });
    }
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
  /** O parecer LIBERADO/PARADO, quando vem junto com a conclusão (OS-16). */
  operationalResult?: string | null;
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
  // FOR UPDATE: duas transições simultâneas da mesma OS leriam o mesmo estado e
  // passariam as duas pelo grafo. Com a linha travada, a segunda espera e lê o
  // estado novo.
  const [atual] = await session.query<{
    status_key: string;
    status_label: string;
    category: StatusCategory;
    version: number;
    number: string | null;
    resolution: string | null;
    operational_result: string | null;
    asset_id: string | null;
    laudo: boolean;
  }>(
    `SELECT s.key AS status_key, s.label AS status_label, w.status_category::text AS category,
            w.version, w.number, w.resolution, w.operational_result, w.asset_id,
            coalesce((SELECT t.system_key = 'obsolescence' FROM aurora.catalog_items t
                       WHERE t.id = w.work_order_type_id), false) AS laudo
       FROM aurora.work_orders w
       JOIN aurora.work_order_statuses s ON s.id = w.status_id
      WHERE w.id = $1
        FOR UPDATE OF w`,
    [workOrderId]
  );
  if (!atual) throw new NotFoundError('Ordem de serviço', workOrderId);

  // O parecer pode vir NA PRÓPRIA transição (quadro, aplicativo de campo): quem
  // conclui arrastando não precisa abrir o relatório só para marcar LIBERADO.
  if (
    input.operationalResult !== undefined &&
    input.operationalResult !== null &&
    !(OPERATIONAL_RESULTS as readonly string[]).includes(input.operationalResult)
  ) {
    throw new ValidationError('o parecer é LIBERADO (released) ou PARADO (stopped)', {
      field: 'operational_result',
      allowed: OPERATIONAL_RESULTS,
    });
  }
  const parecer = input.operationalResult ?? atual.operational_result;

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

  // EXECUTAR E CONCLUIR SÃO DE QUEM A OS É (PF-14). As arestas de execução
  // (iniciar, pausar, aguardar, retomar) e a de conclusão passam pela mesma
  // regra das demais ações de execução; atribuir, validar, fechar e cancelar
  // são atos de gestão e seguem só a permissão da aresta.
  const aresta = graph.find((t) => t.from === atual.status_key && t.to === destino.key);
  if (aresta && (aresta.permission === 'work_order.execute' || aresta.permission === 'work_order.complete')) {
    await assertCanExecuteWorkOrder(session, workOrderId);
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

  // O PARECER NA CONCLUSÃO (PF-41 · OS-16).
  //
  // Obrigatório por padrão em TODA OS de equipamento desde 29/10/2026 ("para
  // todas as OS indicar Liberado para uso ou Equipamento parado"); a
  // organização pode desligar (`require_operational_result = false`). OS sem
  // equipamento não tem o que liberar, e o laudo de obsolescência segue a regra
  // própria dele (justificativa e foto). 422, e não 412: não é um requisito da
  // natureza da OS (esses vêm em `missing`), é um campo que falta e que a pessoa
  // preenche no relatório.
  if (destino.category === 'review' && (await faltaParecer(session, atual, parecer))) {
    throw new ValidationError(
      'esta organização exige o parecer do equipamento (LIBERADO ou PARADO) para concluir a OS — ' +
        'preencha o resultado operacional no relatório de serviço',
      { field: 'operational_result' }
    );
  }

  // OS CANCELADA, NEGADA OU FECHADA NÃO TEM CRONÔMETRO CORRENDO.
  //
  // Fecha aqui, antes de mudar a situação, os cronômetros que ficaram abertos
  // nela (check-in sem check-out, por exemplo). Sem isto, o apontamento ficava
  // aberto numa OS que não aceita mais hora, e o índice de um cronômetro por
  // pessoa travava essa pessoa em todas as outras OS. O check-out posterior
  // continua possível: só registra a saída.
  if (destino.category === 'cancelled' || destino.category === 'closed') {
    await session.query(
      `UPDATE aurora.time_entries
          SET ended_at = greatest(now(), started_at + interval '1 microsecond'),
              note = coalesce(note, $2)
        WHERE work_order_id = $1 AND ended_at IS NULL`,
      [workOrderId, `encerrado automaticamente: OS ${destino.label.toLowerCase()}`]
    );
  }

  // Laudo de obsolescência: concluir exige a justificativa e ao menos uma foto.
  if (destino.category === 'review') await exigirLaudoCompleto(session, workOrderId);

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
            updated_by = $14,
            operational_result = coalesce($15, operational_result),
            service_report_updated_at = CASE WHEN $15::text IS NULL THEN service_report_updated_at ELSE now() END
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
      input.operationalResult ?? null,
    ]
  );

  // O PARECER TEM EFEITO NO EQUIPAMENTO (OS-16 · ATV-16). PARADO põe o ativo em
  // manutenção; LIBERADO devolve à operação o que estava em manutenção. Laudo de
  // obsolescência não entra: ele baixa o equipamento na validação.
  if (destino.category === 'review' && atual.asset_id && !atual.laudo && parecer) {
    await aplicarParecerNoAtivo(session, {
      assetId: atual.asset_id,
      workOrderId,
      workOrderNumber: atual.number,
      parecer: parecer as OperationalResult,
    });
  }

  // OS RELÓGIOS DE SLA SEGUEM A CATEGORIA (§11).
  //
  // Ligado aqui, e não numa rota, pela mesma razão do bloco de conclusão: é uma
  // consequência da transição, e transição é uma só para toda a aplicação.
  //
  // A pausa só acontece quando o MOTIVO determina pausa. Falta de peça, por
  // padrão, não pausa: o atraso é da organização, e um relógio que para aí
  // perdoaria o próprio atraso (ADR-004).
  if (destino.category === 'in_progress') {
    await resumeSlaClocks(session, 'work_order', workOrderId);
    await stopSlaClock(session, 'work_order', workOrderId, 'onsite');
  } else if (destino.category === 'waiting' && input.waitReasonId) {
    const [motivo] = await session.query<{ pauses_sla: boolean }>(
      `SELECT pauses_sla FROM aurora.wait_reasons WHERE id = $1`,
      [input.waitReasonId]
    );
    if (motivo?.pauses_sla) {
      await pauseSlaClocks(session, 'work_order', workOrderId, input.waitReasonId);
    }
  } else if (destino.category === 'review') {
    await resumeSlaClocks(session, 'work_order', workOrderId);
    await stopSlaClock(session, 'work_order', workOrderId, 'resolution');
  } else if (destino.category === 'cancelled') {
    // Cancelou: o prazo é descartado, não estourado. Contar como violação
    // puniria a organização por não executar o que o cliente desistiu de pedir.
    await cancelSlaClocks(session, 'work_order', workOrderId);
    // E a peça reservada volta a ficar disponível. Sem isto, cancelar uma OS
    // deixaria peça reservada para sempre, e o disponível iria minguando sem
    // que o físico mudasse — até alguém descobrir que "tem, mas não pode usar".
    await releaseReservations(session, workOrderId);
  }

  // Reabrir abre um relógio de RESOLUÇÃO novo; o anterior fica para o
  // histórico. É assim que reincidência se mede (§11).
  if (destino.category === 'in_progress' && atual.category === 'closed') {
    const [dados] = await session.query<{
      customer_id: string;
      asset_id: string | null;
      location_id: string | null;
      priority: RequestPriority;
    }>(
      `SELECT customer_id, asset_id, location_id, priority::text AS priority
         FROM aurora.work_orders WHERE id = $1`,
      [workOrderId]
    );
    if (dados) {
      await startSlaClock(session, {
        documentType: 'work_order',
        documentId: workOrderId,
        kind: 'resolution',
        priority: dados.priority,
        assetId: dados.asset_id,
        customerId: dados.customer_id,
        locationId: dados.location_id,
      });
    }
  }

  // Laudo de obsolescência validado: o equipamento sai de operação com a justificativa do laudo.
  if (destino.category === 'done' || destino.category === 'closed') {
    await baixarPeloLaudo(session, workOrderId);
  }
  // E quem valida ASSINA (OS-24): a assinatura pela sessão, a mesma da avaliação da OS.
  if (
    atual.laudo &&
    atual.category === 'review' &&
    (destino.category === 'done' || destino.category === 'closed')
  ) {
    await assinarValidacaoDoLaudo(session, workOrderId);
  }

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
    // O motivo de espera vai no evento: "aguardando peça" é o que o setor de
    // compras precisa saber NA HORA (reunião de 16/10/2026), e a automação só
    // consegue filtrar por aquilo que o evento carrega.
    let motivoDeEspera: string | null = null;
    if (destino.category === 'waiting' && input.waitReasonId) {
      const [m] = await session.query<{ key: string }>(`SELECT key FROM aurora.wait_reasons WHERE id = $1`, [
        input.waitReasonId,
      ]);
      motivoDeEspera = m?.key ?? null;
    }
    await emitEvent(session, {
      type: evento as EventType,
      aggregateId: workOrderId,
      payload: {
        number: atual.number,
        from: atual.status_key,
        to: destino.key,
        ...(motivoDeEspera ? { wait_reason_key: motivoDeEspera } : {}),
      },
    });
  }

  return { status: destino.key, category: destino.category, version: rows[0]!.version };
}

/* -------------------------------------------------------------------------- */
/* laudo de obsolescência (conversa com o cliente, 21/10/2026)                 */
/* -------------------------------------------------------------------------- */

const MIN_JUSTIFICATIVA_DO_LAUDO = 20;

async function dadosDoLaudo(
  session: TenantSession,
  workOrderId: string
): Promise<{
  asset_id: string | null;
  description: string;
  resolution: string | null;
  laudo: boolean;
} | null> {
  const [o] = await session.query<{
    asset_id: string | null;
    description: string;
    resolution: string | null;
    laudo: boolean;
  }>(
    `SELECT w.asset_id, w.description, w.resolution, (t.system_key = 'obsolescence') AS laudo
       FROM aurora.work_orders w
       JOIN aurora.catalog_items t ON t.id = w.work_order_type_id
      WHERE w.id = $1`,
    [workOrderId]
  );
  return o ?? null;
}

/** Concluir um laudo exige a justificativa técnica e ao menos uma foto: sem foto, não há prova. */
async function exigirLaudoCompleto(session: TenantSession, workOrderId: string): Promise<void> {
  const l = await dadosDoLaudo(session, workOrderId);
  if (!l?.laudo) return;
  if (l.description.trim().length < MIN_JUSTIFICATIVA_DO_LAUDO) {
    throw new ValidationError(
      `o laudo de obsolescência precisa da justificativa técnica (${MIN_JUSTIFICATIVA_DO_LAUDO}+ caracteres) na descrição`,
      { field: 'description' }
    );
  }
  const [f] = await session.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM aurora.attachments WHERE work_order_id = $1`,
    [workOrderId]
  );
  if ((f?.n ?? 0) < 1) {
    throw new ValidationError(
      'o laudo de obsolescência exige ao menos uma foto do equipamento antes de ser concluído',
      { field: 'attachments' }
    );
  }
}

/** Laudo validado: descomissiona o equipamento, com a justificativa do laudo como motivo. */
async function baixarPeloLaudo(session: TenantSession, workOrderId: string): Promise<void> {
  const l = await dadosDoLaudo(session, workOrderId);
  if (!l?.laudo || !l.asset_id) return;
  const [a] = await session.query<{ status: string }>(
    `SELECT status::text AS status FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
    [l.asset_id]
  );
  if (!a || a.status === 'decommissioned' || a.status === 'disposed') return;
  const motivo = [l.description.trim(), l.resolution?.trim()].filter(Boolean).join(' — ');
  await decommissionAsset(session, l.asset_id, motivo);
}

/**
 * A assinatura de quem VALIDA o laudo (OS-24 da auditoria de 29/10/2026).
 *
 * O mesmo mecanismo da avaliação da OS (migration 0079): assinatura pela SESSÃO
 * autenticada, com o resumo SHA-256 do que foi assinado (número, título,
 * resolução, conclusão, equipamento, local), o e-mail, o IP e o agente de quem
 * validou, e a hora. Não é ICP-Brasil e não afirma validade jurídica — decisão do
 * cliente. Validação sem pessoa (ator de sistema) não tem quem assine: nada é
 * forjado em nome de ninguém.
 */
async function assinarValidacaoDoLaudo(session: TenantSession, workOrderId: string): Promise<void> {
  const ator = session.context.actorId;
  if (!ator) return;
  const [quem] = await session.query<{ name: string; email: string }>(
    `SELECT name, email FROM aurora.users WHERE id = $1`,
    [ator]
  );
  if (!quem?.email) return;
  await signWorkOrder(session, workOrderId, {
    signerRole: 'supervisor',
    signerName: quem.name,
    method: 'session',
    signerEmail: quem.email,
  });
}

/* -------------------------------------------------------------------------- */
/* parecer LIBERADO/PARADO (PF-41 · OS-16 · ATV-16)                            */
/* -------------------------------------------------------------------------- */

export const OPERATIONAL_RESULTS = ['released', 'stopped'] as const;
export type OperationalResult = (typeof OPERATIONAL_RESULTS)[number];

/**
 * Esta conclusão está sem o parecer que a organização exige?
 *
 * Só OS de EQUIPAMENTO (sem ativo não há o que liberar) e nunca o laudo de
 * obsolescência, que tem regra própria.
 */
async function faltaParecer(
  session: TenantSession,
  os: { asset_id: string | null; laudo: boolean },
  parecer: string | null | undefined
): Promise<boolean> {
  if (!os.asset_id || os.laudo || parecer) return false;
  return requiresOperationalResult(session);
}

/**
 * O efeito do parecer no equipamento.
 *
 *   · PARADO   → `under_maintenance` ("em manutenção"), venha de onde vier;
 *   · LIBERADO → `active` ("em operação"), mas SÓ se estava em manutenção — um
 *     ativo de reserva ou emprestado continua de reserva ou emprestado.
 *
 * Ativo baixado ou descartado nunca é tocado: a OS não ressuscita equipamento.
 * A mudança fica na trilha de auditoria (gatilho `assets_audit`) e vira o
 * evento `asset.status_changed`, com a OS que a causou.
 */
async function aplicarParecerNoAtivo(
  session: TenantSession,
  input: { assetId: string; workOrderId: string; workOrderNumber: string | null; parecer: OperationalResult }
): Promise<void> {
  const [a] = await session.query<{ status: string }>(
    `SELECT status::text AS status FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [input.assetId]
  );
  if (!a || a.status === 'decommissioned' || a.status === 'disposed') return;
  const novo =
    input.parecer === 'stopped' ? 'under_maintenance' : a.status === 'under_maintenance' ? 'active' : null;
  if (!novo || novo === a.status) return;
  await session.query(
    `UPDATE aurora.assets SET status = $2::aurora.asset_status, updated_by = $3 WHERE id = $1`,
    [input.assetId, novo, session.context.actorId]
  );
  await emitEvent(session, {
    type: 'asset.status_changed',
    aggregateId: input.assetId,
    payload: {
      from: a.status,
      to: novo,
      reason: 'operational_result',
      operational_result: input.parecer,
      work_order_id: input.workOrderId,
      work_order_number: input.workOrderNumber,
    },
  });
}

/**
 * O que falta para concluir, inteiro: o que a natureza exige, o parecer e a
 * regra do laudo — a MESMA lista que a transição usa para recusar.
 *
 * Existe para a tela habilitar o botão Concluir só quando o servidor vai aceitar
 * (OS-17), em vez de descobrir na hora do clique.
 */
export async function completionStatus(
  session: TenantSession,
  workOrderId: string
): Promise<{
  required: string[];
  ok: boolean;
  missing: Array<{ requirement: string; label: string; detail: string }>;
  requires_operational_result: boolean;
}> {
  const [os] = await session.query<{
    asset_id: string | null;
    operational_result: string | null;
    laudo: boolean;
  }>(
    `SELECT w.asset_id, w.operational_result,
            coalesce((SELECT t.system_key = 'obsolescence' FROM aurora.catalog_items t
                       WHERE t.id = w.work_order_type_id), false) AS laudo
       FROM aurora.work_orders w WHERE w.id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('Ordem de serviço', workOrderId);

  const required: string[] = [];
  const missing: Array<{ requirement: string; label: string; detail: string }> = [];

  const requisitos = await completionRequirementsFor(session, workOrderId);
  if (requisitos.length > 0) {
    required.push(...requisitos);
    const check = await completionCheck(session, workOrderId, requisitos);
    missing.push(...check.missing);
  }

  const exigeParecer = Boolean(os.asset_id) && !os.laudo && (await requiresOperationalResult(session));
  if (exigeParecer) {
    required.push('operational_result');
    if (!os.operational_result) {
      missing.push({
        requirement: 'operational_result',
        label: 'parecer do equipamento (LIBERADO ou PARADO)',
        detail: 'marque no passo Parecer final se o equipamento pode voltar ao uso',
      });
    }
  }

  if (os.laudo) {
    const l = await dadosDoLaudo(session, workOrderId);
    required.push('obsolescence_justification', 'obsolescence_photo');
    if (!l || l.description.trim().length < MIN_JUSTIFICATIVA_DO_LAUDO) {
      missing.push({
        requirement: 'obsolescence_justification',
        label: 'justificativa técnica do laudo',
        detail: `ao menos ${MIN_JUSTIFICATIVA_DO_LAUDO} caracteres na descrição`,
      });
    }
    const [f] = await session.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM aurora.attachments WHERE work_order_id = $1`,
      [workOrderId]
    );
    if ((f?.n ?? 0) < 1) {
      missing.push({
        requirement: 'obsolescence_photo',
        label: 'foto do equipamento',
        detail: 'o laudo exige ao menos uma foto antes de ser concluído',
      });
    }
  }

  return { required, ok: missing.length === 0, missing, requires_operational_result: exigeParecer };
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
       FROM aurora.service_requests WHERE id = $1 FOR UPDATE`,
    [requestId]
  );
  if (!pedido) throw new NotFoundError('Solicitação', requestId);

  // A transição primeiro: se ela não for válida — falta permissão, estado
  // errado — nenhuma OS chega a ser criada.
  await transitionRequest(session, requestId, 'accepted');

  // Cada OS gerada herda o CLIENTE da solicitação; o ativo e o local que o
  // aceite indicar têm de ser desse cliente. O banco também recusa (0072), mas
  // aqui a mensagem diz qual alvo está errado.
  for (const [i, alvo] of targets.entries()) {
    if (alvo.assetId) {
      const [a] = await session.query<{ customer_id: string }>(
        `SELECT customer_id FROM aurora.assets WHERE id = $1`,
        [alvo.assetId]
      );
      if (!a) throw new NotFoundError('Ativo', alvo.assetId);
      if (a.customer_id !== pedido.customer_id) {
        throw new ValidationError(
          `targets[${i}].asset_id: o equipamento pertence a outro cliente, não ao da solicitação`,
          { field: `targets[${i}].asset_id` }
        );
      }
    }
    if (alvo.locationId) {
      const [l] = await session.query<{ customer_id: string }>(
        `SELECT customer_id FROM aurora.locations WHERE id = $1`,
        [alvo.locationId]
      );
      if (!l) throw new NotFoundError('Local', alvo.locationId);
      if (l.customer_id !== pedido.customer_id) {
        throw new ValidationError(
          `targets[${i}].location_id: o local pertence a outro cliente, não ao da solicitação`,
          { field: `targets[${i}].location_id` }
        );
      }
    }
  }

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

/**
 * Os motivos de espera desta organização.
 *
 * Existe porque a tela de transição PRECISA deles: quando um estado exige
 * motivo de parada, a pessoa tem de escolher entre os motivos que a
 * organização definiu — não digitar texto livre, que é como o mesmo motivo
 * vira sete grafias diferentes e o indicador de tempo perdido deixa de somar.
 *
 * `pauses_sla` vem junto porque muda o significado da escolha: parar por peça
 * do fabricante não conta contra o SLA; parar por falta de técnico conta. Quem
 * escolhe precisa ver isso ANTES de escolher.
 */
export async function listWaitReasons(session: TenantSession): Promise<WaitReasonRow[]> {
  return session.query<WaitReasonRow>(
    `SELECT id, key, label, pauses_sla, responsible::text AS responsible,
            requires_note, position
       FROM aurora.wait_reasons
      WHERE archived_at IS NULL
      ORDER BY position, label`
  );
}

export interface WaitReasonRow {
  id: string;
  key: string;
  label: string;
  pauses_sla: boolean;
  responsible: string | null;
  requires_note: boolean;
  position: number;
}
