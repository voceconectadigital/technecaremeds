/**
 * Aurora — oportunidade, o núcleo (gap V2 P1.7 · PLAT §4 e §5).
 *
 * Necessidade, origem, ativo, prazo, prioridade, fornecedor opcional e o ATO
 * de autorização comercial. Catálogo, cotação avançada e mercado são futuro.
 *
 * O grafo mora aqui, com a permissão de cada aresta — a mesma ideia de
 * documentos e orçamentos: uma rota de transição, a permissão saindo do grafo.
 * O banco repete o grafo (0057) para nenhum caminho futuro escapar.
 */
export const OPPORTUNITY_STATUSES = [
  'identified',
  'qualified',
  'authorized',
  'declined',
  'converted',
  'cancelled',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const OPPORTUNITY_ORIGINS = [
  'work_order',
  'service_request',
  'inspection',
  'obsolescence',
  'customer_request',
  'other',
] as const;
export type OpportunityOrigin = (typeof OPPORTUNITY_ORIGINS)[number];

export interface OpportunityTransition {
  readonly from: OpportunityStatus;
  readonly to: OpportunityStatus;
  readonly permission: string;
  readonly label: string;
  /** Exige motivo escrito (≥ 10 caracteres). */
  readonly needsReason?: boolean;
  /** Exige o orçamento em que a oportunidade virou proposta. */
  readonly needsQuote?: boolean;
}

/**
 * AUTORIZAR e RECUSAR são da mesma permissão (`opportunity.authorize`): são as
 * duas faces da decisão comercial. Qualificar, cancelar antes da decisão e
 * converter são trabalho de encaminhamento (`opportunity.update`).
 */
export const OPPORTUNITY_TRANSITIONS: readonly OpportunityTransition[] = Object.freeze([
  { from: 'identified', to: 'qualified', permission: 'opportunity.update', label: 'qualificar' },
  {
    from: 'identified',
    to: 'cancelled',
    permission: 'opportunity.update',
    label: 'descartar',
    needsReason: true,
  },
  { from: 'qualified', to: 'authorized', permission: 'opportunity.authorize', label: 'autorizar' },
  {
    from: 'qualified',
    to: 'declined',
    permission: 'opportunity.authorize',
    label: 'recusar',
    needsReason: true,
  },
  {
    from: 'qualified',
    to: 'cancelled',
    permission: 'opportunity.update',
    label: 'descartar',
    needsReason: true,
  },
  {
    from: 'authorized',
    to: 'converted',
    permission: 'opportunity.update',
    label: 'converter em orçamento',
    needsQuote: true,
  },
  {
    from: 'authorized',
    to: 'cancelled',
    permission: 'opportunity.authorize',
    label: 'cancelar',
    needsReason: true,
  },
]);

export function opportunityTransition(
  from: OpportunityStatus,
  to: OpportunityStatus
): OpportunityTransition | null {
  return OPPORTUNITY_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

export function allowedOpportunityTransitions(from: OpportunityStatus): readonly OpportunityTransition[] {
  return OPPORTUNITY_TRANSITIONS.filter((t) => t.from === from);
}
