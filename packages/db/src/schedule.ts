/**
 * Aurora — agenda na camada de dados (SPEC v0.2 §13 · EPIC-012).
 *
 * A agenda é uma projeção da OS (ADR-011). Este módulo não cria entidade
 * nenhuma para representá-la: ele lê a OS por três recortes — calendário,
 * recursos e lista — e escreve de volta na própria OS.
 */
import {
  newId,
  detectConflicts,
  blockingConflicts,
  summarizeLoad,
  windowMinutes,
  overlapMinutes,
  bucketFor,
  shouldNotifyRequester,
  isRescheduleSignal,
  businessMinutesBetween,
  ValidationError,
  NotFoundError,
  ConflictError,
  type Conflict,
  type BlockKind,
  type BlockWindow,
  type BusyWindow,
  type LoadSummary,
  type ScheduleBucket,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { loadCalendar } from './sla';

/** Horas de diferença a partir das quais o solicitante é avisado (§13). */
const REQUESTER_NOTICE_HOURS = 4;

/* -------------------------------------------------------------------------- */
/* ausências                                                                   */
/* -------------------------------------------------------------------------- */

export interface AvailabilityBlockInput {
  membershipId: string;
  kind: BlockKind;
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
}

/**
 * Cria uma ausência.
 *
 * O efeito colateral importante mora no gatilho da 0033: as OS já marcadas para
 * a pessoa dentro do período caem no balde "Reagendar", com o motivo escrito. É
 * o caso que a agenda da referência não cobre e que produz o telefonema — o
 * técnico entra de férias e as OS continuam marcadas, sem ninguém saber.
 */
export async function createAvailabilityBlock(
  session: TenantSession,
  input: AvailabilityBlockInput
): Promise<string> {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new ValidationError('o fim da ausência precisa ser depois do início', { field: 'endsAt' });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.availability_blocks
       (id, organization_id, membership_id, kind, starts_at, ends_at, note, created_by)
     VALUES ($1, $2, $3, $4::aurora.availability_block_kind, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      input.membershipId,
      input.kind,
      input.startsAt,
      input.endsAt,
      input.note ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

async function blocksFor(
  session: TenantSession,
  membershipId: string,
  window: { startsAt: Date; endsAt: Date }
): Promise<BlockWindow[]> {
  const rows = await session.query<{
    id: string;
    kind: BlockKind;
    note: string | null;
    starts_at: Date;
    ends_at: Date;
  }>(
    `SELECT id, kind::text AS kind, note, starts_at, ends_at
       FROM aurora.availability_blocks
      WHERE membership_id = $1 AND starts_at < $3 AND ends_at > $2`,
    [membershipId, window.startsAt, window.endsAt]
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    note: r.note,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
  }));
}

async function busyFor(
  session: TenantSession,
  membershipId: string,
  window: { startsAt: Date; endsAt: Date }
): Promise<BusyWindow[]> {
  const rows = await session.query<{
    id: string;
    number: string | null;
    scheduled_start: Date;
    scheduled_end: Date | null;
  }>(
    `SELECT id, number, scheduled_start, scheduled_end
       FROM aurora.work_orders
      WHERE assignee_membership_id = $1
        AND scheduled_start IS NOT NULL
        AND status_category NOT IN ('closed', 'cancelled')
        AND scheduled_start < $3
        AND COALESCE(scheduled_end, scheduled_start) > $2`,
    [membershipId, window.startsAt, window.endsAt]
  );
  return rows.map((r) => ({
    workOrderId: r.id,
    number: r.number,
    startsAt: new Date(r.scheduled_start),
    endsAt: new Date(r.scheduled_end ?? r.scheduled_start),
  }));
}

/** Minutos já comprometidos no mesmo dia, fora a OS que está sendo agendada. */
async function bookedMinutesOnDay(
  session: TenantSession,
  membershipId: string,
  day: Date,
  exceptWorkOrderId: string
): Promise<number> {
  const inicio = new Date(day);
  inicio.setUTCHours(0, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 86_400_000);

  const janelas = await busyFor(session, membershipId, { startsAt: inicio, endsAt: fim });
  return janelas
    .filter((j) => j.workOrderId !== exceptWorkOrderId)
    .reduce((soma, j) => soma + overlapMinutes(j, { startsAt: inicio, endsAt: fim }), 0);
}

/* -------------------------------------------------------------------------- */
/* conferência                                                                 */
/* -------------------------------------------------------------------------- */

export interface ScheduleProposal {
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
  assigneeMembershipId?: string | null;
}

/**
 * Confere uma proposta de agendamento sem gravá-la.
 *
 * Existe como operação própria porque a tela precisa mostrar os avisos ENQUANTO
 * a pessoa arrasta o cartão, não depois de soltar. Descobrir o conflito só ao
 * salvar é o que faz programar custar mais que ligar para o técnico — o
 * problema que o §13 existe para resolver.
 */
export async function checkSchedule(session: TenantSession, proposal: ScheduleProposal): Promise<Conflict[]> {
  const [os] = await session.query<{
    id: string;
    assignee_membership_id: string | null;
    location_id: string | null;
    location_name: string | null;
    location_calendar_id: string | null;
    location_timezone: string | null;
    service_window_note: string | null;
  }>(
    `SELECT w.id, w.assignee_membership_id, w.location_id,
            l.name AS location_name, l.calendar_id AS location_calendar_id,
            l.timezone AS location_timezone, l.service_window_note
       FROM aurora.work_orders w
       LEFT JOIN aurora.locations l ON l.id = w.location_id
      WHERE w.id = $1`,
    [proposal.workOrderId]
  );
  if (!os) throw new NotFoundError('ordem de serviço não encontrada');

  const responsavel = proposal.assigneeMembershipId ?? os.assignee_membership_id;
  const janela = { startsAt: proposal.startsAt, endsAt: proposal.endsAt };

  let blocks: BlockWindow[] = [];
  let busy: BusyWindow[] = [];
  let ocupado = 0;
  let jornada: number | null = null;

  if (responsavel) {
    blocks = await blocksFor(session, responsavel, janela);
    busy = await busyFor(session, responsavel, janela);
    ocupado = await bookedMinutesOnDay(session, responsavel, proposal.startsAt, proposal.workOrderId);

    const [m] = await session.query<{ daily_hours: string | null }>(
      `SELECT daily_hours FROM aurora.memberships WHERE id = $1`,
      [responsavel]
    );
    jornada = m?.daily_hours == null ? null : Number(m.daily_hours);
  }

  const cabeNoLocal = await fitsLocationCalendar(
    session,
    os.location_calendar_id,
    os.location_timezone,
    janela
  );

  return detectConflicts({
    candidate: {
      ...janela,
      workOrderId: proposal.workOrderId,
      assigneeMembershipId: responsavel,
    },
    blocks,
    busy,
    bookedMinutesToday: ocupado,
    capacityMinutes: jornada === null ? null : Math.round(jornada * 60),
    locationWindowFits: cabeNoLocal,
    locationName: os.location_name ?? undefined,
    locationHint: os.service_window_note ?? undefined,
  });
}

/**
 * A janela cabe no calendário do local?
 *
 * Reaproveita o motor de tempo útil do EPIC-010 em vez de escrever uma segunda
 * leitura de calendário: se a janela tem duração e nenhum minuto ÚTIL dentro
 * dela, ela está fora do horário de atendimento. Uma segunda implementação
 * divergiria da primeira no primeiro feriado municipal.
 *
 * Sem calendário configurado a resposta é `null`, não `false`: não saber é
 * diferente de não caber, e avisar "fora da janela" para um local que não
 * declarou janela nenhuma é o aviso falso que faz os avisos verdadeiros serem
 * ignorados.
 */
async function fitsLocationCalendar(
  session: TenantSession,
  calendarId: string | null,
  timezone: string | null,
  window: { startsAt: Date; endsAt: Date }
): Promise<boolean | null> {
  if (!calendarId) return null;
  const calendario = await loadCalendar(session, calendarId, timezone ?? 'UTC');
  const uteis = businessMinutesBetween(window.startsAt, window.endsAt, calendario);
  return uteis > 0;
}

/* -------------------------------------------------------------------------- */
/* agendar                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScheduleResult {
  workOrderId: string;
  rescheduleCount: number;
  conflicts: Conflict[];
  notifiedRequester: boolean;
  signal: boolean;
}

/**
 * Programa (ou reprograma) a OS.
 *
 * Bloqueios recusam; avisos passam e voltam na resposta, para a tela mostrar o
 * que o coordenador aceitou. `force` NÃO existe: não há nada a forçar, porque a
 * única coisa que bloqueia é a ausência — e agendar trabalho para quem está de
 * férias não é uma decisão que alguém queira tomar conscientemente.
 */
export async function scheduleWorkOrder(
  session: TenantSession,
  proposal: ScheduleProposal
): Promise<ScheduleResult> {
  if (proposal.endsAt.getTime() <= proposal.startsAt.getTime()) {
    throw new ValidationError('o fim da janela precisa ser depois do início', { field: 'endsAt' });
  }

  const conflitos = await checkSchedule(session, proposal);
  const bloqueios = blockingConflicts(conflitos);
  if (bloqueios.length > 0) {
    throw new ConflictError(`não é possível agendar: ${bloqueios.map((b) => b.detail).join('; ')}`);
  }

  const [antes] = await session.query<{
    number: string | null;
    scheduled_start: Date | null;
    status_category: string;
  }>(`SELECT number, scheduled_start, status_category FROM aurora.work_orders WHERE id = $1`, [
    proposal.workOrderId,
  ]);
  if (!antes) throw new NotFoundError('ordem de serviço não encontrada');
  if (antes.status_category === 'closed' || antes.status_category === 'cancelled') {
    throw new ConflictError('ordem de serviço encerrada não se agenda');
  }

  const [depois] = await session.query<{ reschedule_count: number }>(
    `UPDATE aurora.work_orders
        SET scheduled_start = $2,
            scheduled_end = $3,
            assignee_membership_id = COALESCE($4, assignee_membership_id),
            updated_by = $5
      WHERE id = $1
      RETURNING reschedule_count`,
    [
      proposal.workOrderId,
      proposal.startsAt,
      proposal.endsAt,
      proposal.assigneeMembershipId ?? null,
      session.context.actorId,
    ]
  );

  const reagendamento = antes.scheduled_start !== null;
  let avisouSolicitante = false;

  if (reagendamento) {
    avisouSolicitante = shouldNotifyRequester(
      new Date(antes.scheduled_start!),
      proposal.startsAt,
      REQUESTER_NOTICE_HOURS
    );
    await emitEvent(session, {
      type: 'work_order.rescheduled',
      aggregateId: proposal.workOrderId,
      payload: {
        number: antes.number,
        previousStart: new Date(antes.scheduled_start!).toISOString(),
        newStart: proposal.startsAt.toISOString(),
        rescheduleCount: Number(depois!.reschedule_count),
        notifyRequester: avisouSolicitante,
      },
    });
  } else {
    await emitEvent(session, {
      type: 'work_order.scheduled',
      aggregateId: proposal.workOrderId,
      payload: {
        number: antes.number,
        startsAt: proposal.startsAt.toISOString(),
        endsAt: proposal.endsAt.toISOString(),
      },
    });
  }

  return {
    workOrderId: proposal.workOrderId,
    rescheduleCount: Number(depois!.reschedule_count),
    conflicts: conflitos,
    notifiedRequester: avisouSolicitante,
    signal: isRescheduleSignal(Number(depois!.reschedule_count)),
  };
}

/** Tira a OS da agenda — o arrastar de volta para o balde. */
export async function unscheduleWorkOrder(session: TenantSession, workOrderId: string): Promise<void> {
  const linhas = await session.query(
    `UPDATE aurora.work_orders
        SET scheduled_start = NULL, scheduled_end = NULL,
            window_invalidated_at = NULL, window_invalidated_reason = NULL,
            updated_by = $2
      WHERE id = $1 AND status_category NOT IN ('closed', 'cancelled')
      RETURNING id`,
    [workOrderId, session.context.actorId]
  );
  if (linhas.length === 0) {
    throw new ConflictError('ordem de serviço encerrada ou inexistente');
  }
}

/* -------------------------------------------------------------------------- */
/* as três lentes                                                              */
/* -------------------------------------------------------------------------- */

export interface AgendaEntry {
  work_order_id: string;
  number: string | null;
  title: string;
  status_category: string;
  priority: string;
  scheduled_start: Date;
  scheduled_end: Date | null;
  assignee_membership_id: string | null;
  assignee_name: string | null;
  customer_name: string | null;
  location_name: string | null;
  reschedule_count: number;
  window_invalidated_at: Date | null;
  /**
   * POR QUE a janela caiu.
   *
   * Vem junto porque é a razão de o balde "Reagendar" existir: mostrar que algo
   * precisa ser remarcado sem dizer o motivo manda o coordenador procurar em
   * outra tela, e cada tela a mais é um passo na direção do telefonema.
   */
  window_invalidated_reason: string | null;
}

/** Lente CALENDÁRIO: o que está marcado num intervalo. */
export async function agenda(
  session: TenantSession,
  range: {
    from: Date;
    to: Date;
    membershipId?: string | null;
    teamId?: string | null;
    /** Vínculo cujo escopo (cliente/setor) recorta a agenda; nulo = sem recorte. */
    scopeMembershipId?: string | null;
  }
): Promise<AgendaEntry[]> {
  return session.query<AgendaEntry>(
    `SELECT w.id AS work_order_id, w.number, w.title, w.status_category::text AS status_category,
            w.priority::text AS priority, w.scheduled_start, w.scheduled_end,
            w.assignee_membership_id, u.name AS assignee_name,
            c.name AS customer_name, l.name AS location_name,
            w.reschedule_count, w.window_invalidated_at, w.window_invalidated_reason
       FROM aurora.work_orders w
       LEFT JOIN aurora.memberships m ON m.id = w.assignee_membership_id
       LEFT JOIN aurora.users u       ON u.id = m.user_id
       LEFT JOIN aurora.customers c   ON c.id = w.customer_id
       LEFT JOIN aurora.locations l   ON l.id = w.location_id
      WHERE w.scheduled_start IS NOT NULL
        AND w.status_category NOT IN ('closed', 'cancelled')
        AND w.scheduled_start < $2
        AND COALESCE(w.scheduled_end, w.scheduled_start) > $1
        AND ($3::uuid IS NULL OR w.assignee_membership_id = $3)
        AND ($4::uuid IS NULL OR w.team_id = $4)
        AND ($5::uuid IS NULL
             OR (w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($5))
                 AND (w.location_id IS NULL
                      OR w.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($5)))))
      ORDER BY w.scheduled_start`,
    [range.from, range.to, range.membershipId ?? null, range.teamId ?? null, range.scopeMembershipId ?? null]
  );
}

export interface ResourceLoad {
  membershipId: string;
  name: string | null;
  load: LoadSummary;
  entries: AgendaEntry[];
  absent: boolean;
}

/**
 * Lente RECURSOS: técnico × tempo, com carga e capacidade.
 *
 * A ausência entra na lista como pessoa AUSENTE, e não como pessoa sem
 * trabalho. São a mesma linha vazia na tela e coisas opostas na cabeça de quem
 * programa: um dia livre convida a colocar trabalho; férias não.
 */
export async function resourceBoard(
  session: TenantSession,
  day: Date,
  teamId: string | null = null
): Promise<ResourceLoad[]> {
  const inicio = new Date(day);
  inicio.setUTCHours(0, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 86_400_000);

  const pessoas = await session.query<{
    id: string;
    name: string | null;
    daily_hours: string | null;
  }>(
    `SELECT m.id, u.name, m.daily_hours
       FROM aurora.memberships m
       JOIN aurora.users u ON u.id = m.user_id
      WHERE m.seat_type = 'staff' AND m.status = 'active'
        AND ($1::uuid IS NULL
             OR EXISTS (SELECT 1 FROM aurora.team_members tm
                         WHERE tm.team_id = $1 AND tm.membership_id = m.id))
      ORDER BY u.name`,
    [teamId]
  );

  const marcadas = await agenda(session, { from: inicio, to: fim });

  const resultado: ResourceLoad[] = [];
  for (const p of pessoas) {
    const minhas = marcadas.filter((e) => e.assignee_membership_id === p.id);
    const minutos = minhas.reduce(
      (soma, e) =>
        soma +
        overlapMinutes(
          {
            startsAt: new Date(e.scheduled_start),
            endsAt: new Date(e.scheduled_end ?? e.scheduled_start),
          },
          { startsAt: inicio, endsAt: fim }
        ),
      0
    );

    const ausencias = await blocksFor(session, p.id, { startsAt: inicio, endsAt: fim });

    resultado.push({
      membershipId: p.id,
      name: p.name,
      load: summarizeLoad(minutos, p.daily_hours == null ? null : Number(p.daily_hours)),
      entries: minhas,
      absent: ausencias.some((a) => a.kind === 'vacation' || a.kind === 'leave'),
    });
  }

  return resultado;
}

export interface BucketEntry extends Omit<AgendaEntry, 'scheduled_start'> {
  bucket: ScheduleBucket;
  scheduled_start: Date | null;
  due_at: Date | null;
  minutes: number | null;
}

/**
 * Lente LISTA: os três baldes do painel lateral.
 *
 * Uma consulta só para os três: o painel é persistente e recarrega a cada
 * arrasto, e três idas ao banco por arrasto é o tipo de lentidão que faz a
 * pessoa parar de arrastar.
 */
export async function buckets(
  session: TenantSession,
  now: Date = new Date(),
  customerId: string | null = null
): Promise<BucketEntry[]> {
  const rows = await session.query<
    AgendaEntry & { scheduled_start: Date | null; started_at: Date | null; due_at: Date | null }
  >(
    `SELECT w.id AS work_order_id, w.number, w.title, w.status_category::text AS status_category,
            w.priority::text AS priority, w.scheduled_start, w.scheduled_end, w.started_at,
            w.assignee_membership_id, u.name AS assignee_name,
            c.name AS customer_name, l.name AS location_name,
            w.reschedule_count, w.window_invalidated_at, w.window_invalidated_reason,
            (SELECT min(k.due_at) FROM aurora.sla_clocks k
              WHERE k.document_id = w.id AND k.document_type = 'work_order'
                AND k.state = 'running') AS due_at
       FROM aurora.work_orders w
       LEFT JOIN aurora.memberships m ON m.id = w.assignee_membership_id
       LEFT JOIN aurora.users u       ON u.id = m.user_id
       LEFT JOIN aurora.customers c   ON c.id = w.customer_id
       LEFT JOIN aurora.locations l   ON l.id = w.location_id
      WHERE w.status_category NOT IN ('closed', 'cancelled')
        AND w.started_at IS NULL
        AND ($1::uuid IS NULL OR w.customer_id = $1)
      ORDER BY w.scheduled_start NULLS LAST, w.created_at`,
    [customerId]
  );

  const saida: BucketEntry[] = [];
  for (const r of rows) {
    const balde = bucketFor(
      {
        scheduledStart: r.scheduled_start ? new Date(r.scheduled_start) : null,
        scheduledEnd: r.scheduled_end ? new Date(r.scheduled_end) : null,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        dueAt: r.due_at ? new Date(r.due_at) : null,
        windowInvalidated: r.window_invalidated_at !== null,
      },
      now
    );
    if (balde === null) continue;

    saida.push({
      ...r,
      bucket: balde,
      due_at: r.due_at ? new Date(r.due_at) : null,
      minutes:
        r.scheduled_start && r.scheduled_end
          ? windowMinutes({
              startsAt: new Date(r.scheduled_start),
              endsAt: new Date(r.scheduled_end),
            })
          : null,
    });
  }

  return saida;
}
