/**
 * Aurora — relógios de SLA (SPEC v0.2 §11 · EPIC-010).
 *
 * O ciclo de vida de um relógio, e onde cada evento o toca:
 *
 *   RESPOSTA     nasce quando a solicitação é enviada; encerra na triagem
 *   ATENDIMENTO  nasce quando a OS é aberta; encerra quando começa a execução
 *   RESOLUÇÃO    nasce quando a OS é aberta; encerra na conclusão
 *
 * Pausa e retomada acompanham a categoria `waiting` — mas só quando o MOTIVO
 * determina pausa (ADR-004). Falta de peça, por padrão, não pausa: o relógio
 * continua correndo, porque o atraso é da organização.
 */
import {
  newId,
  addBusinessMinutes,
  businessMinutesBetween,
  alwaysOpenCalendar,
  type BusinessCalendar,
  type RequestPriority,
  NotFoundError,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

export type SlaKind = 'response' | 'onsite' | 'resolution';
export type DocumentType = 'service_request' | 'work_order';

export interface SlaPolicyInput {
  name: string;
  calendarId?: string | null;
  isDefault?: boolean;
}

export async function createSlaPolicy(session: TenantSession, input: SlaPolicyInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.sla_policies (id, organization_id, name, calendar_id, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.calendarId ?? null,
      input.isDefault ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

export async function setSlaTarget(
  session: TenantSession,
  policyId: string,
  priority: RequestPriority,
  kind: SlaKind,
  durationMinutes: number,
  businessHoursOnly = true
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.sla_targets
       (organization_id, policy_id, priority, kind, duration_minutes, business_hours_only)
     VALUES ($1, $2, $3::aurora.request_priority, $4::aurora.sla_target_kind, $5, $6)
     ON CONFLICT (policy_id, priority, kind) DO UPDATE
        SET duration_minutes = EXCLUDED.duration_minutes,
            business_hours_only = EXCLUDED.business_hours_only`,
    [session.context.organizationId, policyId, priority, kind, durationMinutes, businessHoursOnly]
  );
}

/**
 * Calendário de uma política, no formato que o motor de tempo útil consome.
 *
 * Sem calendário configurado, devolve 24×7 no fuso pedido: uma organização que
 * ainda não configurou nada tem SLA que funciona, em vez de SLA que explode. É
 * o comportamento que a referência tinha, e é um ponto de partida honesto.
 */
export async function loadCalendar(
  session: TenantSession,
  calendarId: string | null,
  fallbackTimeZone: string
): Promise<BusinessCalendar> {
  if (!calendarId) return alwaysOpenCalendar(fallbackTimeZone);

  const [cal] = await session.query<{ timezone: string }>(
    `SELECT timezone FROM aurora.calendars WHERE id = $1 AND deleted_at IS NULL`,
    [calendarId]
  );
  if (!cal) return alwaysOpenCalendar(fallbackTimeZone);

  const windows = await session.query<{ weekday: number; starts_at: string; ends_at: string }>(
    `SELECT weekday, starts_at::text, ends_at::text FROM aurora.calendar_windows WHERE calendar_id = $1`,
    [calendarId]
  );
  const exceptions = await session.query<{
    on_date: string;
    kind: string;
    starts_at: string | null;
    ends_at: string | null;
  }>(
    `SELECT on_date::text, kind::text, starts_at::text, ends_at::text
       FROM aurora.calendar_exceptions WHERE calendar_id = $1`,
    [calendarId]
  );

  if (windows.length === 0) return alwaysOpenCalendar(cal.timezone);

  return {
    timeZone: cal.timezone,
    windows: windows.map((w) => ({
      weekday: Number(w.weekday),
      startsAt: w.starts_at.slice(0, 5),
      endsAt: w.ends_at.slice(0, 5),
    })),
    exceptions: exceptions.map((e) => ({
      date: e.on_date,
      kind: e.kind as 'holiday' | 'closed' | 'extended',
      startsAt: e.starts_at?.slice(0, 5) ?? null,
      endsAt: e.ends_at?.slice(0, 5) ?? null,
    })),
  };
}

/**
 * Fuso a usar: o do LOCAL, não o da organização (§11).
 *
 * "Uma prestadora de Belo Horizonte atendendo uma base em Manaus precisa
 * disso." Manaus não tem horário de verão; usar o fuso da matriz daria uma hora
 * de erro em todo prazo da filial durante metade do ano.
 */
async function timeZoneForLocation(session: TenantSession, locationId: string | null): Promise<string> {
  if (locationId) {
    const [loc] = await session.query<{ timezone: string | null }>(
      `SELECT timezone FROM aurora.locations WHERE id = $1`,
      [locationId]
    );
    if (loc?.timezone) return loc.timezone;
  }
  const [org] = await session.query<{ timezone: string }>(
    `SELECT timezone FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  return org?.timezone ?? 'UTC';
}

export interface StartClockInput {
  documentType: DocumentType;
  documentId: string;
  kind: SlaKind;
  priority: RequestPriority;
  assetId?: string | null;
  customerId: string;
  locationId?: string | null;
  startedAt?: Date;
}

/**
 * Abre um relógio, congelando alvo e calendário.
 *
 * Devolve `null` quando a política resolvida não define alvo para aquela
 * combinação de prioridade e tipo — que é o caso legítimo de "esta organização
 * não promete prazo para chamados sem prioridade". Um relógio com alvo
 * inventado seria pior que relógio nenhum.
 */
export async function startSlaClock(
  session: TenantSession,
  input: StartClockInput
): Promise<{ id: string; dueAt: Date } | null> {
  const [resolvida] = await session.query<{ policy_id: string | null }>(
    `SELECT aurora.resolve_sla_policy($1, $2) AS policy_id`,
    [input.assetId ?? null, input.customerId]
  );
  const policyId = resolvida?.policy_id ?? null;
  if (!policyId) return null;

  const [alvo] = await session.query<{
    duration_minutes: number;
    business_hours_only: boolean;
    calendar_id: string | null;
    name: string;
  }>(
    `SELECT t.duration_minutes, t.business_hours_only, p.calendar_id, p.name
       FROM aurora.sla_targets t
       JOIN aurora.sla_policies p ON p.id = t.policy_id
      WHERE t.policy_id = $1 AND t.priority = $2::aurora.request_priority
        AND t.kind = $3::aurora.sla_target_kind`,
    [policyId, input.priority, input.kind]
  );
  if (!alvo) return null;

  const fuso = await timeZoneForLocation(session, input.locationId ?? null);
  const calendario = alvo.business_hours_only
    ? await loadCalendar(session, alvo.calendar_id, fuso)
    : alwaysOpenCalendar(fuso);

  const inicio = input.startedAt ?? new Date();
  const vencimento = addBusinessMinutes(inicio, Number(alvo.duration_minutes), calendario);

  const [anterior] = await session.query<{ max: number | null }>(
    `SELECT max(attempt) AS max FROM aurora.sla_clocks
      WHERE document_type = $1 AND document_id = $2 AND kind = $3::aurora.sla_target_kind`,
    [input.documentType, input.documentId, input.kind]
  );

  const id = newId();
  await session.query(
    `INSERT INTO aurora.sla_clocks
       (id, organization_id, document_type, document_id, kind, policy_id, policy_name_snapshot,
        target_minutes, business_hours_only, calendar_snapshot, priority_snapshot,
        started_at, due_at, attempt)
     VALUES ($1, $2, $3, $4, $5::aurora.sla_target_kind, $6, $7, $8, $9, $10,
             $11::aurora.request_priority, $12, $13, $14)`,
    [
      id,
      session.context.organizationId,
      input.documentType,
      input.documentId,
      input.kind,
      policyId,
      alvo.name,
      Number(alvo.duration_minutes),
      alvo.business_hours_only,
      JSON.stringify(calendario),
      input.priority,
      inicio.toISOString(),
      vencimento.toISOString(),
      Number(anterior?.max ?? 0) + 1,
    ]
  );

  return { id, dueAt: vencimento };
}

/** Relógios em andamento de um documento. */
async function runningClocks(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  kind?: SlaKind
): Promise<
  Array<{
    id: string;
    kind: SlaKind;
    started_at: string;
    due_at: string;
    calendar_snapshot: BusinessCalendar;
    state: string;
    paused_minutes: number;
    target_minutes: number;
  }>
> {
  return session.query(
    `SELECT id, kind::text AS kind, started_at, due_at, calendar_snapshot, state::text AS state,
            paused_minutes, target_minutes
       FROM aurora.sla_clocks
      WHERE document_type = $1 AND document_id = $2
        AND state IN ('running', 'paused')
        AND ($3::text IS NULL OR kind::text = $3)
      ORDER BY attempt DESC`,
    [documentType, documentId, kind ?? null]
  );
}

/**
 * Encerra um relógio, gravando os dois tempos.
 *
 * `met` sai da comparação com `due_at`, e não de recalcular o alvo agora: o
 * prazo foi congelado na abertura, e é contra ele que o cumprimento se mede.
 */
export async function stopSlaClock(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  kind: SlaKind,
  at: Date = new Date()
): Promise<{ met: boolean; elapsedBusinessMinutes: number } | null> {
  const [clock] = await runningClocks(session, documentType, documentId, kind);
  if (!clock) return null;

  await resumeSlaClocks(session, documentType, documentId, at);

  const inicio = new Date(clock.started_at);
  const corridos = Math.round((at.getTime() - inicio.getTime()) / 60_000);
  const uteis = businessMinutesBetween(inicio, at, clock.calendar_snapshot);
  // Quem já recebeu o carimbo de violação não volta a "cumprido" só porque o
  // prazo foi empurrado por uma pausa posterior.
  const [carimbo] = await session.query<{ breached_at: string | null }>(
    `SELECT breached_at FROM aurora.sla_clocks WHERE id = $1`,
    [clock.id]
  );
  const cumpriu = at.getTime() <= new Date(clock.due_at).getTime() && !carimbo?.breached_at;

  await session.query(
    `UPDATE aurora.sla_clocks
        SET state = $2::aurora.sla_clock_state,
            stopped_at = $3,
            elapsed_minutes = $4,
            elapsed_business_minutes = $5,
            breached_at = CASE WHEN $6 THEN breached_at ELSE coalesce(breached_at, $3) END
      WHERE id = $1`,
    [clock.id, cumpriu ? 'met' : 'breached', at.toISOString(), corridos, uteis, cumpriu]
  );

  await emitEvent(session, {
    type: cumpriu ? 'sla.met' : 'sla.breached',
    aggregateId: documentId,
    payload: { kind, elapsed_business_minutes: uteis, due_at: clock.due_at },
  });

  return { met: cumpriu, elapsedBusinessMinutes: uteis };
}

/**
 * Pausa os relógios de um documento.
 *
 * Só é chamada quando o motivo de espera determina pausa (ADR-004). O
 * `due_at` é empurrado na retomada, e não aqui: enquanto está pausado, o prazo
 * antigo continua sendo a informação verdadeira — "venceria às 15h se não
 * estivesse parado".
 */
export async function pauseSlaClocks(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  waitReasonId: string | null,
  at: Date = new Date()
): Promise<number> {
  const clocks = await runningClocks(session, documentType, documentId);
  let pausados = 0;
  for (const c of clocks) {
    if (c.state !== 'running') continue;
    await session.query(
      `INSERT INTO aurora.sla_pauses (id, organization_id, clock_id, wait_reason_id, paused_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), session.context.organizationId, c.id, waitReasonId, at.toISOString()]
    );
    await session.query(`UPDATE aurora.sla_clocks SET state = 'paused' WHERE id = $1`, [c.id]);
    pausados++;
  }
  return pausados;
}

/**
 * Retoma os relógios pausados, empurrando o prazo pelo tempo útil perdido.
 *
 * O empurrão é em tempo ÚTIL: uma pausa de sexta 18h a segunda 8h não consome
 * prazo nenhum, porque nada correria naquele intervalo de qualquer forma.
 * Empurrar por tempo corrido daria ao fornecedor um fim de semana de brinde.
 */
export async function resumeSlaClocks(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  at: Date = new Date()
): Promise<number> {
  const clocks = await runningClocks(session, documentType, documentId);
  let retomados = 0;

  for (const c of clocks) {
    const [pausa] = await session.query<{ id: string; paused_at: string }>(
      `SELECT id, paused_at FROM aurora.sla_pauses WHERE clock_id = $1 AND resumed_at IS NULL`,
      [c.id]
    );
    if (!pausa) continue;

    const inicioPausa = new Date(pausa.paused_at);
    const uteisPerdidos = businessMinutesBetween(inicioPausa, at, c.calendar_snapshot);
    const novoPrazo = addBusinessMinutes(new Date(c.due_at), uteisPerdidos, c.calendar_snapshot);

    await session.query(`UPDATE aurora.sla_pauses SET resumed_at = $2, minutes = $3 WHERE id = $1`, [
      pausa.id,
      at.toISOString(),
      uteisPerdidos,
    ]);
    await session.query(
      `UPDATE aurora.sla_clocks
          SET state = 'running',
              due_at = $2,
              paused_minutes = paused_minutes + $3
        WHERE id = $1`,
      [c.id, novoPrazo.toISOString(), uteisPerdidos]
    );
    retomados++;
  }
  return retomados;
}

/** Cancela os relógios de um documento — a OS foi cancelada, o prazo é descartado. */
export async function cancelSlaClocks(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  at: Date = new Date()
): Promise<number> {
  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.sla_clocks
        SET state = 'cancelled', stopped_at = $3
      WHERE document_type = $1 AND document_id = $2 AND state IN ('running', 'paused')
      RETURNING id`,
    [documentType, documentId, at.toISOString()]
  );
  return rows.length;
}

export interface SlaStatus {
  id: string;
  kind: SlaKind;
  state: string;
  due_at: string;
  target_minutes: number;
  paused_minutes: number;
  elapsed_business_minutes: number | null;
  breached_at: string | null;
  /** Percentual do prazo já consumido, em tempo útil. */
  consumed_pct: number;
}

/** Situação dos relógios de um documento, com o percentual consumido. */
export async function slaStatus(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string,
  now: Date = new Date()
): Promise<SlaStatus[]> {
  const rows = await session.query<{
    id: string;
    kind: SlaKind;
    state: string;
    started_at: string;
    due_at: string;
    target_minutes: number;
    paused_minutes: number;
    elapsed_business_minutes: number | null;
    breached_at: string | null;
    calendar_snapshot: BusinessCalendar;
  }>(
    `SELECT id, kind::text AS kind, state::text AS state, started_at, due_at,
            target_minutes, paused_minutes, elapsed_business_minutes, breached_at, calendar_snapshot
       FROM aurora.sla_clocks
      WHERE document_type = $1 AND document_id = $2
      ORDER BY kind, attempt`,
    [documentType, documentId]
  );

  return rows.map((r) => {
    const uteis =
      r.elapsed_business_minutes ??
      (r.state === 'running' ? businessMinutesBetween(new Date(r.started_at), now, r.calendar_snapshot) : 0);
    const alvo = Number(r.target_minutes);
    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      due_at: r.due_at,
      target_minutes: alvo,
      paused_minutes: Number(r.paused_minutes),
      elapsed_business_minutes:
        r.elapsed_business_minutes === null ? uteis : Number(r.elapsed_business_minutes),
      breached_at: r.breached_at,
      consumed_pct: alvo > 0 ? Math.round((uteis / alvo) * 100) : 0,
    };
  });
}

/**
 * Varredura de relógios que precisam de aviso ou já estouraram.
 *
 * Roda no publicador, não numa requisição: ninguém deve descobrir que o SLA
 * estourou porque abriu a tela. Emite `sla.warning` uma vez, aos 80 %, e
 * `sla.breached` uma vez, no vencimento — `warned_at` e `breached_at` fazem a
 * marcação, e é por isso que a varredura pode rodar de minuto em minuto sem
 * inundar ninguém de notificação repetida.
 */
export async function sweepSlaClocks(
  session: TenantSession,
  now: Date = new Date()
): Promise<{ warned: number; breached: number }> {
  const emAndamento = await session.query<{
    id: string;
    document_type: DocumentType;
    document_id: string;
    kind: SlaKind;
    started_at: string;
    due_at: string;
    target_minutes: number;
    warned_at: string | null;
    calendar_snapshot: BusinessCalendar;
  }>(
    `SELECT id, document_type, document_id, kind::text AS kind, started_at, due_at,
            target_minutes, warned_at, calendar_snapshot
       FROM aurora.sla_clocks
      WHERE state = 'running'
      ORDER BY due_at`
  );

  let warned = 0;
  let breached = 0;

  for (const c of emAndamento) {
    // Estourar o prazo NÃO encerra o relógio: o trabalho continua e o tempo
    // real só se sabe na conclusão. `breached_at` é carimbo, não estado — e é
    // o carimbo que impede a varredura de avisar de novo a cada minuto.
    if (now.getTime() >= new Date(c.due_at).getTime()) {
      const rows = await session.query<{ id: string }>(
        `UPDATE aurora.sla_clocks SET breached_at = $2
           WHERE id = $1 AND breached_at IS NULL RETURNING id`,
        [c.id, now.toISOString()]
      );
      if (rows.length > 0) {
        await emitEvent(session, {
          type: 'sla.breached',
          aggregateId: c.document_id,
          payload: { kind: c.kind, due_at: c.due_at, document_type: c.document_type },
        });
        breached++;
      }
      continue;
    }

    if (c.warned_at) continue;
    const uteis = businessMinutesBetween(new Date(c.started_at), now, c.calendar_snapshot);
    if (uteis >= Number(c.target_minutes) * 0.8) {
      await session.query(`UPDATE aurora.sla_clocks SET warned_at = $2 WHERE id = $1`, [
        c.id,
        now.toISOString(),
      ]);
      await emitEvent(session, {
        type: 'sla.warning',
        aggregateId: c.document_id,
        payload: {
          kind: c.kind,
          due_at: c.due_at,
          consumed_pct: Math.round((uteis / Number(c.target_minutes)) * 100),
        },
      });
      warned++;
    }
  }

  return { warned, breached };
}

/** Política do documento, para exibição — nome congelado, não o atual. */
export async function slaPolicySnapshot(
  session: TenantSession,
  documentType: DocumentType,
  documentId: string
): Promise<string | null> {
  const [row] = await session.query<{ policy_name_snapshot: string }>(
    `SELECT policy_name_snapshot FROM aurora.sla_clocks
      WHERE document_type = $1 AND document_id = $2 ORDER BY created_at LIMIT 1`,
    [documentType, documentId]
  );
  return row?.policy_name_snapshot ?? null;
}

/** Existe? Usado para dar 404 em vez de lista vazia quando o documento não existe. */
export async function assertWorkOrderExists(session: TenantSession, id: string): Promise<void> {
  const [row] = await session.query('SELECT 1 FROM aurora.work_orders WHERE id = $1', [id]);
  if (!row) throw new NotFoundError('Ordem de serviço', id);
}
