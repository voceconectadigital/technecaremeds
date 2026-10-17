/**
 * Aurora — execução guiada da OS: check-in/out, relatório e peça do cliente
 * (reunião 16/10/2026, Fase 5).
 *
 * O "▶ Executar" da ficha é um assistente sobre estas funções e as que já
 * existiam (transição, checklist, peças de estoque, anexos, assinatura). Nada
 * aqui substitui motor nenhum: o cronômetro é o de `execution.ts`, a peça de
 * estoque é o razão de `inventory.ts`.
 */
import { newId, ConflictError, NotFoundError, ValidationError } from '@aurora/domain';
import type { TenantSession } from './client';
import { startTimer, stopTimer } from './execution';
import { emitEvent } from './outbox';

/** Onde o aparelho disse que estava — ou por que não disse. */
export interface PontoDeVisita {
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  /** Obrigatória (10+ letras) quando não há posição: recusada, indisponível… */
  justification?: string | null;
}

const ENCERRADAS = new Set(['done', 'closed', 'cancelled']);

/** Precisão máxima aceita para a posição do aparelho, em metros. */
const ACCURACY_MAX_M = 100_000;

async function osDaVisita(
  session: TenantSession,
  workOrderId: string
): Promise<{ customer_id: string; location_id: string | null; category: string }> {
  const [os] = await session.query<{ customer_id: string; location_id: string | null; category: string }>(
    `SELECT customer_id, location_id, status_category::text AS category
       FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('Ordem de serviço', workOrderId);
  return os;
}

function posicao(p: PontoDeVisita): {
  source: 'device' | 'manual';
  lat: number | null;
  lng: number | null;
  acc: number | null;
  justification: string | null;
} {
  const temPosicao =
    p.latitude !== undefined && p.latitude !== null && p.longitude !== undefined && p.longitude !== null;
  const justificativa = p.justification?.trim() || null;
  if (temPosicao) {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new ValidationError('latitude fora de -90..90', { field: 'latitude' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new ValidationError('longitude fora de -180..180', { field: 'longitude' });
    }
    const acc = p.accuracyM === undefined || p.accuracyM === null ? null : Number(p.accuracyM);
    // Teto de 100 km: acima disso a "posição" não diz nem a cidade, e a coluna
    // (numeric(10,2)) recusaria com erro de banco valores ainda maiores.
    if (acc !== null && (!Number.isFinite(acc) || acc < 0 || acc > ACCURACY_MAX_M)) {
      throw new ValidationError(`precisão inválida (0 a ${ACCURACY_MAX_M} m)`, { field: 'accuracy_m' });
    }
    return { source: 'device', lat, lng, acc, justification: justificativa };
  }
  if (!justificativa || justificativa.length < 10) {
    throw new ValidationError(
      'sem a localização do aparelho, explique o motivo (ao menos 10 caracteres) — fica registrado',
      { field: 'justification' }
    );
  }
  return { source: 'manual', lat: null, lng: null, acc: null, justification: justificativa };
}

async function ultimaVisita(
  session: TenantSession,
  workOrderId: string,
  membershipId: string
): Promise<{ id: string; kind: string; time_entry_id: string | null } | undefined> {
  const [v] = await session.query<{ id: string; kind: string; time_entry_id: string | null }>(
    `SELECT id, kind, time_entry_id FROM aurora.work_order_visits
      WHERE work_order_id = $1 AND membership_id = $2
      ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
    [workOrderId, membershipId]
  );
  return v;
}

/**
 * CHECK-IN: registra a chegada e abre o cronômetro. Recusa um segundo check-in
 * da mesma pessoa na mesma OS sem check-out — dois relógios correndo juntos
 * dobrariam as horas. E recusa o check-in em OUTRA OS enquanto houver
 * cronômetro aberto (conferido em `startTimer`, com o número da OS onde ele
 * está): a pessoa está num lugar só.
 */
export async function checkIn(
  session: TenantSession,
  workOrderId: string,
  ponto: PontoDeVisita
): Promise<{ visitId: string; timeEntryId: string; occurredAt: string }> {
  const membershipId = session.context.membershipId;
  if (!membershipId)
    throw new ValidationError('check-in exige um vínculo com a organização', { field: 'membership' });
  const os = await osDaVisita(session, workOrderId);
  if (ENCERRADAS.has(os.category) || os.category === 'draft' || os.category === 'review') {
    throw new ConflictError('esta OS não está em atendimento: não há check-in a fazer');
  }
  const ultima = await ultimaVisita(session, workOrderId, membershipId);
  if (ultima?.kind === 'check_in') {
    throw new ConflictError('você já fez check-in nesta OS — faça o check-out antes de um novo check-in');
  }
  const p = posicao(ponto);
  const timeEntryId = await startTimer(session, workOrderId);
  const id = newId();
  const [r] = await session.query<{ occurred_at: string }>(
    `INSERT INTO aurora.work_order_visits
       (id, organization_id, work_order_id, membership_id, kind, latitude, longitude, accuracy_m,
        position_source, justification, customer_id, location_id, time_entry_id)
     VALUES ($1, $2, $3, $4, 'check_in', $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING occurred_at::text`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      membershipId,
      p.lat,
      p.lng,
      p.acc,
      p.source,
      p.justification,
      os.customer_id,
      os.location_id,
      timeEntryId,
    ]
  );
  await emitEvent(session, {
    type: 'work_order.checked_in',
    aggregateId: workOrderId,
    payload: { visit_id: id, position_source: p.source },
  });
  return { visitId: id, timeEntryId, occurredAt: r!.occurred_at };
}

/** CHECK-OUT: fecha o cronômetro aberto pelo check-in. */
export async function checkOut(
  session: TenantSession,
  workOrderId: string,
  ponto: PontoDeVisita
): Promise<{ visitId: string; minutes: number | null; occurredAt: string }> {
  const membershipId = session.context.membershipId;
  if (!membershipId)
    throw new ValidationError('check-out exige um vínculo com a organização', { field: 'membership' });
  const os = await osDaVisita(session, workOrderId);
  const ultima = await ultimaVisita(session, workOrderId, membershipId);
  if (ultima?.kind !== 'check_in') {
    throw new ConflictError('não há check-in aberto seu nesta OS');
  }
  const p = posicao(ponto);
  let minutes: number | null = null;
  if (ultima.time_entry_id) {
    const [aberto] = await session.query(
      `SELECT 1 FROM aurora.time_entries WHERE id = $1 AND ended_at IS NULL`,
      [ultima.time_entry_id]
    );
    if (aberto) minutes = await stopTimer(session, ultima.time_entry_id, 'check-out');
  }
  const id = newId();
  const [r] = await session.query<{ occurred_at: string }>(
    `INSERT INTO aurora.work_order_visits
       (id, organization_id, work_order_id, membership_id, kind, latitude, longitude, accuracy_m,
        position_source, justification, customer_id, location_id, time_entry_id)
     VALUES ($1, $2, $3, $4, 'check_out', $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING occurred_at::text`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      membershipId,
      p.lat,
      p.lng,
      p.acc,
      p.source,
      p.justification,
      os.customer_id,
      os.location_id,
      ultima.time_entry_id,
    ]
  );
  await emitEvent(session, {
    type: 'work_order.checked_out',
    aggregateId: workOrderId,
    payload: { visit_id: id, minutes },
  });
  return { visitId: id, minutes, occurredAt: r!.occurred_at };
}

export interface VisitRow {
  id: string;
  kind: 'check_in' | 'check_out';
  occurred_at: string;
  membership_id: string;
  person_name: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  position_source: 'device' | 'manual';
  justification: string | null;
  /** A visita é de quem pergunta — é assim que a tela sabe se há check-in SEU aberto. */
  mine: boolean;
}

export async function listVisits(session: TenantSession, workOrderId: string): Promise<VisitRow[]> {
  return session.query<VisitRow>(
    `SELECT v.id, v.kind, v.occurred_at::text AS occurred_at, v.membership_id, u.name AS person_name,
            v.latitude::float8 AS latitude, v.longitude::float8 AS longitude,
            v.accuracy_m::float8 AS accuracy_m, v.position_source, v.justification,
            (v.membership_id = $2::uuid) IS TRUE AS mine
       FROM aurora.work_order_visits v
       JOIN aurora.memberships m ON m.id = v.membership_id
       JOIN aurora.users u ON u.id = m.user_id
      WHERE v.work_order_id = $1
      ORDER BY v.occurred_at, v.created_at`,
    [workOrderId, session.context.membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Preencher Ordem de Serviço                                                 */
/* -------------------------------------------------------------------------- */

export interface ServiceReportInput {
  serviceDescription?: string | null;
  serviceObservations?: string | null;
  /** Situação de USO do equipamento após o serviço — não é veredito metrológico. */
  operationalResult?: 'released' | 'stopped' | null;
  finalOpinion?: string | null;
}

/**
 * Grava o relatório aos poucos: cada passo do assistente salva o que tem, e uma
 * queda de rede no meio não perde o que já foi escrito. Não existe "rascunho":
 * é o próprio relatório da OS, que continua editável até a OS ser validada.
 */
export async function updateServiceReport(
  session: TenantSession,
  workOrderId: string,
  input: ServiceReportInput
): Promise<void> {
  const os = await osDaVisita(session, workOrderId);
  if (ENCERRADAS.has(os.category)) {
    throw new ConflictError('a OS já foi validada, fechada ou cancelada: o relatório não muda mais por aqui');
  }
  const texto = (v: string | null | undefined, campo: string): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    if (t.length > 5000) throw new ValidationError('texto longo demais (máx. 5000)', { field: campo });
    return t.length ? t : null;
  };
  const campos: [string, unknown][] = [];
  const d = texto(input.serviceDescription, 'service_description');
  if (d !== undefined) campos.push(['service_description', d]);
  const o = texto(input.serviceObservations, 'service_observations');
  if (o !== undefined) campos.push(['service_observations', o]);
  const f = texto(input.finalOpinion, 'final_opinion');
  if (f !== undefined) campos.push(['final_opinion', f]);
  if (input.operationalResult !== undefined) {
    if (input.operationalResult !== null && !['released', 'stopped'].includes(input.operationalResult)) {
      throw new ValidationError('resultado deve ser liberado ou parado', { field: 'operational_result' });
    }
    campos.push(['operational_result', input.operationalResult]);
  }
  if (campos.length === 0) return;
  // Colunas da lista fechada acima, nunca do cliente.
  const sets = campos.map(([c], i) => `${c} = $${i + 2}`).join(', ');
  await session.query(
    `UPDATE aurora.work_orders SET ${sets}, service_report_updated_at = now() WHERE id = $1`,
    [workOrderId, ...campos.map(([, v]) => v)]
  );
  await emitEvent(session, {
    type: 'work_order.report_updated',
    aggregateId: workOrderId,
    payload: { fields: campos.map(([c]) => c) },
  });
}

/* -------------------------------------------------------------------------- */
/* Peça fornecida pelo cliente                                                */
/* -------------------------------------------------------------------------- */

export async function addCustomerPart(
  session: TenantSession,
  workOrderId: string,
  input: { description: string; quantity: number; unit?: string | null; notes?: string | null }
): Promise<string> {
  const os = await osDaVisita(session, workOrderId);
  if (ENCERRADAS.has(os.category)) {
    throw new ConflictError('a OS já foi validada, fechada ou cancelada');
  }
  const descricao = input.description.trim();
  if (descricao.length < 3 || descricao.length > 300) {
    throw new ValidationError('descreva a peça (3 a 300 caracteres)', { field: 'description' });
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new ValidationError('quantidade precisa ser maior que zero', { field: 'quantity' });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.work_order_customer_parts
       (id, organization_id, work_order_id, description, quantity, unit, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      descricao,
      input.quantity,
      input.unit?.trim() || null,
      input.notes?.trim() || null,
      session.context.actorId,
    ]
  );
  await emitEvent(session, {
    type: 'work_order.customer_part_added',
    aggregateId: workOrderId,
    payload: { id, description: descricao, quantity: input.quantity },
  });
  return id;
}

export async function listCustomerParts(
  session: TenantSession,
  workOrderId: string
): Promise<
  {
    id: string;
    description: string;
    quantity: number;
    unit: string | null;
    notes: string | null;
    created_at: string;
  }[]
> {
  return session.query(
    `SELECT id, description, quantity::float8 AS quantity, unit, notes, created_at::text AS created_at
       FROM aurora.work_order_customer_parts WHERE work_order_id = $1 ORDER BY created_at`,
    [workOrderId]
  );
}
