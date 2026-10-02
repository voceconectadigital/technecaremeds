/**
 * Aurora — oportunidade na camada de dados (0057 · gap V2 P1.7).
 */
import {
  newId,
  opportunityTransition,
  allowedOpportunityTransitions,
  NotFoundError,
  ConflictError,
  ValidationError,
  OPPORTUNITY_ORIGINS,
  type OpportunityOrigin,
  type OpportunityStatus,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

export interface OpportunityInput {
  customerId: string;
  origin: OpportunityOrigin;
  title: string;
  need: string;
  priority?: 'emergency' | 'very_urgent' | 'urgent' | 'low' | 'none';
  dueOn?: string | null;
  assetId?: string | null;
  workOrderId?: string | null;
  serviceRequestId?: string | null;
  supplierId?: string | null;
}

/**
 * Registra a necessidade.
 *
 * O ativo, a OS e a solicitação de origem precisam ser DO MESMO CLIENTE da
 * oportunidade — senão a oportunidade do Hospital A carregaria o equipamento
 * do Hospital B, e a autorização comercial seria pedida a quem não é dono.
 */
export async function createOpportunity(session: TenantSession, input: OpportunityInput): Promise<string> {
  if (!(OPPORTUNITY_ORIGINS as readonly string[]).includes(input.origin)) {
    throw new ValidationError('origem desconhecida', { field: 'origin', allowed: OPPORTUNITY_ORIGINS });
  }
  if (input.dueOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
    throw new ValidationError('prazo precisa ser data AAAA-MM-DD', { field: 'due_on' });
  }

  const [cliente] = await session.query(`SELECT 1 FROM aurora.customers WHERE id = $1`, [input.customerId]);
  if (!cliente) throw new NotFoundError('Cliente', input.customerId);

  const vinculos: Array<[string, string | null | undefined, string]> = [
    ['aurora.assets', input.assetId, 'asset_id'],
    ['aurora.work_orders', input.workOrderId, 'work_order_id'],
    ['aurora.service_requests', input.serviceRequestId, 'service_request_id'],
  ];
  for (const [tabela, id, campo] of vinculos) {
    if (!id) continue;
    const [linha] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM ${tabela} WHERE id = $1`,
      [id]
    );
    if (!linha) throw new NotFoundError(campo, id);
    if (linha.customer_id !== input.customerId) {
      throw new ValidationError(`${campo} é de outro cliente`, { field: campo });
    }
  }

  const id = newId();
  await session.query(
    `INSERT INTO aurora.opportunities
       (id, organization_id, customer_id, asset_id, work_order_id, service_request_id, supplier_id,
        origin, title, need, priority, due_on, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::aurora.opportunity_origin, $9, $10,
             $11::aurora.request_priority, $12::date, $13)`,
    [
      id,
      session.context.organizationId,
      input.customerId,
      input.assetId ?? null,
      input.workOrderId ?? null,
      input.serviceRequestId ?? null,
      input.supplierId ?? null,
      input.origin,
      input.title.trim(),
      input.need.trim(),
      input.priority ?? 'none',
      input.dueOn ?? null,
      session.context.actorId,
    ]
  );
  await emitEvent(session, {
    type: 'opportunity.created',
    aggregateId: id,
    payload: { origin: input.origin, customer_id: input.customerId },
  });
  return id;
}

export interface OpportunityRow {
  id: string;
  customer_id: string;
  customer_name: string;
  asset_id: string | null;
  asset_name: string | null;
  work_order_id: string | null;
  service_request_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quote_id: string | null;
  origin: OpportunityOrigin;
  title: string;
  need: string;
  priority: string;
  due_on: string | null;
  status: OpportunityStatus;
  authorized_at: string | null;
  authorization_note: string | null;
  closed_reason: string | null;
  created_at: string;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function linha(r: Record<string, unknown>): OpportunityRow {
  return {
    id: r.id as string,
    customer_id: r.customer_id as string,
    customer_name: r.customer_name as string,
    asset_id: (r.asset_id as string | null) ?? null,
    asset_name: (r.asset_name as string | null) ?? null,
    work_order_id: (r.work_order_id as string | null) ?? null,
    service_request_id: (r.service_request_id as string | null) ?? null,
    supplier_id: (r.supplier_id as string | null) ?? null,
    supplier_name: (r.supplier_name as string | null) ?? null,
    quote_id: (r.quote_id as string | null) ?? null,
    origin: r.origin as OpportunityOrigin,
    title: r.title as string,
    need: r.need as string,
    priority: r.priority as string,
    due_on: (r.due_on as string | null) ?? null,
    status: r.status as OpportunityStatus,
    authorized_at: iso(r.authorized_at),
    authorization_note: (r.authorization_note as string | null) ?? null,
    closed_reason: (r.closed_reason as string | null) ?? null,
    created_at: iso(r.created_at)!,
  };
}

const SELECAO = `SELECT o.id, o.customer_id, c.name AS customer_name, o.asset_id, a.name AS asset_name,
            o.work_order_id, o.service_request_id, o.supplier_id, s.name AS supplier_name, o.quote_id,
            o.origin::text AS origin, o.title, o.need, o.priority::text AS priority,
            o.due_on::text AS due_on, o.status::text AS status, o.authorized_at, o.authorization_note,
            o.closed_reason, o.created_at
       FROM aurora.opportunities o
       JOIN aurora.customers c ON c.id = o.customer_id
       LEFT JOIN aurora.assets a ON a.id = o.asset_id
       LEFT JOIN aurora.suppliers s ON s.id = o.supplier_id`;

export async function listOpportunities(
  session: TenantSession,
  filtro: { status?: OpportunityStatus; customerId?: string; assetId?: string } = {}
): Promise<OpportunityRow[]> {
  const rows = await session.query<Record<string, unknown>>(
    `${SELECAO}
      WHERE ($1::text IS NULL OR o.status::text = $1)
        AND ($2::uuid IS NULL OR o.customer_id = $2)
        AND ($3::uuid IS NULL OR o.asset_id = $3)
      ORDER BY o.due_on NULLS LAST, o.created_at DESC
      LIMIT 500`,
    [filtro.status ?? null, filtro.customerId ?? null, filtro.assetId ?? null]
  );
  return rows.map(linha);
}

export async function opportunityDetail(session: TenantSession, id: string) {
  const [r] = await session.query<Record<string, unknown>>(`${SELECAO} WHERE o.id = $1`, [id]);
  if (!r) throw new NotFoundError('Oportunidade', id);
  const o = linha(r);
  const historico = await session.query<Record<string, unknown>>(
    `SELECT from_status::text AS from_status, to_status::text AS to_status, note, changed_by, changed_at
       FROM aurora.opportunity_status_history WHERE opportunity_id = $1 ORDER BY changed_at`,
    [id]
  );
  return {
    opportunity: o,
    history: historico.map((h) => ({
      from_status: (h.from_status as string | null) ?? null,
      to_status: h.to_status as string,
      note: (h.note as string | null) ?? null,
      changed_by: (h.changed_by as string | null) ?? null,
      changed_at: iso(h.changed_at)!,
    })),
    transitions: allowedOpportunityTransitions(o.status).map((t) => ({
      to: t.to,
      label: t.label,
      permission: t.permission,
    })),
  };
}

/**
 * Move a oportunidade no grafo. A permissão da aresta é conferida por quem
 * chama (o controller), contra `opportunityTransition` — aqui ficam as regras
 * de conteúdo: motivo onde o grafo exige, orçamento do mesmo cliente na
 * conversão, carimbo de quem autorizou.
 */
export async function transitionOpportunity(
  session: TenantSession,
  id: string,
  to: OpportunityStatus,
  opts: { note?: string | null; reason?: string | null; quoteId?: string | null } = {}
): Promise<void> {
  const [atual] = await session.query<{ status: OpportunityStatus; customer_id: string }>(
    `SELECT status::text AS status, customer_id FROM aurora.opportunities WHERE id = $1`,
    [id]
  );
  if (!atual) throw new NotFoundError('Oportunidade', id);

  const aresta = opportunityTransition(atual.status, to);
  if (!aresta) {
    const possiveis = allowedOpportunityTransitions(atual.status)
      .map((t) => `${t.to} (${t.label})`)
      .join(', ');
    throw new ConflictError(
      `oportunidade em "${atual.status}" não vai para "${to}". Possíveis: ${possiveis || 'nenhuma — encerrada'}`
    );
  }

  const motivo = opts.reason?.trim() ?? '';
  if (aresta.needsReason && motivo.length < 10) {
    throw new ValidationError(`${aresta.label} exige motivo de ao menos 10 caracteres`, { field: 'reason' });
  }

  if (aresta.needsQuote) {
    if (!opts.quoteId) throw new ValidationError('converter exige o orçamento gerado', { field: 'quote_id' });
    const [q] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.quotes WHERE id = $1`,
      [opts.quoteId]
    );
    if (!q) throw new NotFoundError('Orçamento', opts.quoteId);
    if (q.customer_id !== atual.customer_id) {
      throw new ValidationError('o orçamento é de outro cliente', { field: 'quote_id' });
    }
  }

  // A nota da transição vai para o histórico pelo gatilho, sem coluna nova.
  await session.query(`SELECT set_config('aurora.transition_note', $1, true)`, [opts.note?.trim() ?? '']);

  await session.query(
    `UPDATE aurora.opportunities
        SET status = $2::aurora.opportunity_status,
            authorized_at = CASE WHEN $2 = 'authorized' THEN now() ELSE authorized_at END,
            authorized_by = CASE WHEN $2 = 'authorized' THEN $3::uuid ELSE authorized_by END,
            authorization_note = CASE WHEN $2 = 'authorized' THEN $4 ELSE authorization_note END,
            closed_reason = CASE WHEN $2 IN ('declined', 'cancelled') THEN $5 ELSE closed_reason END,
            quote_id = CASE WHEN $2 = 'converted' THEN $6::uuid ELSE quote_id END,
            updated_by = $7
      WHERE id = $1`,
    [
      id,
      to,
      session.context.membershipId ?? null,
      opts.note?.trim() || null,
      motivo || null,
      opts.quoteId ?? null,
      session.context.actorId,
    ]
  );
  await session.query(`SELECT set_config('aurora.transition_note', '', true)`);

  const evento = {
    authorized: 'opportunity.authorized',
    declined: 'opportunity.declined',
    converted: 'opportunity.converted',
    cancelled: 'opportunity.cancelled',
  } as const;
  if (to in evento) {
    await emitEvent(session, {
      type: evento[to as keyof typeof evento],
      aggregateId: id,
      payload: { from: atual.status },
    });
  }
}
