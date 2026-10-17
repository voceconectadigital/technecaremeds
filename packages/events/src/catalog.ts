/**
 * Aurora — catálogo de eventos de domínio (SPEC v0.2 §31).
 *
 * O catálogo é parte do contrato público: adicionar evento é mudança menor,
 * remover é quebra. O nome segue `agregado.fato_no_passado` — evento representa
 * fato consumado, nunca intenção.
 *
 * Este pacote é puro: não conhece banco, HTTP nem fila.
 */

export const EVENT_TYPES = [
  // --- platform -----------------------------------------------------------
  'organization.created',
  'organization.updated',
  'organization.archived',
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.scope_changed',
  'member.suspended',
  'member.blocked',
  'member.reactivated',
  'member.updated',
  'member.removed',
  'support_access.granted',
  'support_access.expired',
  'api_key.created',
  'api_key.revoked',
  'export.completed',

  // --- directory (EPIC-003) ----------------------------------------------
  'customer.created',
  'customer.archived',
  'location.created',
  'location.moved',
  'location.archived',
  'supplier.created',
  'team.member_added',
  'team.member_removed',

  // --- assets (EPIC-005) --------------------------------------------------
  'asset.created',
  'asset.updated',
  'asset.transferred',
  'asset.status_changed',
  'asset.decommissioned',
  'asset.warranty_expiring',
  'asset.qr_generated',
  'meter.reading_recorded',

  // --- service requests (EPIC-007) ---------------------------------------
  'service_request.created',
  'service_request.triaged',
  'service_request.info_requested',
  'service_request.accepted',
  'service_request.rejected',
  'service_request.merged',
  'service_request.cancelled',
  'service_request.fulfilled',
  'service_request.rated',

  // --- work orders (EPIC-008/009) ----------------------------------------
  'work_order.checked_in',
  'work_order.checked_out',
  'work_order.report_updated',
  'work_order.customer_part_added',
  'work_order.opened',
  'work_order.assigned',
  'work_order.scheduled',
  'work_order.rescheduled',
  'work_order.started',
  'work_order.status_changed',
  'work_order.blocked',
  'work_order.unblocked',
  'work_order.completed',
  'work_order.rework_requested',
  'work_order.validated',
  'work_order.closed',
  'work_order.reopened',
  'work_order.cancelled',
  'work_order.commented',
  'work_order.signed',
  'work_order.part_requested',
  'work_order.part_consumed',
  'work_order.part_returned',
  'time_entry.recorded',
  'time_entry.approved',

  // --- sla (EPIC-010) -----------------------------------------------------
  'sla.started',
  'sla.paused',
  'sla.resumed',
  'sla.warning',
  'sla.breached',
  'sla.met',

  // --- planning (EPIC-013 · planos) ------------------------------------------------
  'plan.activated',
  'plan.cycle_started',
  'plan.cycle_closed',
  'plan.item_generated',
  'plan.item_skipped',
  'plan.item_overdue',
  'plan.finished',
  'checklist.completed',
  'checklist.item_failed',
  'procedure.published',

  // --- inventory (EPIC-015) -----------------------------------------------
  'stock.received',
  'stock.reserved',
  'stock.consumed',
  'stock.returned',
  'stock.adjusted',
  'stock.transferred',
  'stock.below_minimum',
  'stock.negative_balance',
  'stock.count_closed',

  // --- commerce (EPIC-016/017) --------------------------------------------
  'quote.created',
  'quote.sent',
  'quote.viewed',
  'quote.approved',
  'quote.rejected',
  'quote.expired',
  'quote.revised',
  'quote.invoiced',
  // --- oportunidade (gap V2 P1.7) -----------------------------------------
  'opportunity.created',
  'opportunity.authorized',
  'opportunity.declined',
  'opportunity.converted',
  'opportunity.cancelled',
  'contract.activated',
  // "vai vencer" e "venceu" são fatos diferentes: quem assina notificação
  // precisa distinguir o aviso da consequência.
  'contract.expiring',
  'contract.expired',
  'contract.terminated',
  'contract.period_closed',

  // --- documents (EPIC-018) -----------------------------------------------
  'document.issued',
  'document.signed',
  'document.released',
  'document.expiring',
  'document.expired',
  'document.cancelled',
  'document.superseded',
  'document.printed',

  // --- automation (EPIC-024) ----------------------------------------------
  'automation.rule_fired',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value);
}

/** Agregado ao qual o evento pertence, derivado do prefixo do tipo. */
export function aggregateTypeOf(type: EventType): string {
  return type.split('.')[0]!;
}

/** Profundidade máxima de cadeia causal — trava contra automação em laço (§24). */
export const MAX_CAUSATION_DEPTH = 3;
