/**
 * Aurora — oportunidade, o núcleo (gap V2 P1.7 · PLAT §4 e §5).
 *
 * Necessidade, origem, ativo, prazo, prioridade, fornecedor e a autorização
 * comercial com trilha. Sem valor monetário (preço é do orçamento) e sem
 * catálogo, cotação avançada ou mercado — esses são futuro.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const OPPORTUNITY_STATUSES = [
  'identified',
  'qualified',
  'authorized',
  'declined',
  'converted',
  'cancelled',
] as const;
export const OPPORTUNITY_ORIGINS = [
  'work_order',
  'service_request',
  'inspection',
  'obsolescence',
  'customer_request',
  'other',
] as const;
const PRIORIDADES = ['emergency', 'very_urgent', 'urgent', 'low', 'none'] as const;

export const OpportunityRow = z.object({
  id: Uuid,
  customer_id: Uuid,
  customer_name: z.string(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  work_order_id: Uuid.nullable(),
  service_request_id: Uuid.nullable(),
  supplier_id: Uuid.nullable(),
  supplier_name: z.string().nullable(),
  quote_id: Uuid.nullable(),
  origin: z.enum(OPPORTUNITY_ORIGINS),
  title: z.string(),
  need: z.string(),
  priority: z.enum(PRIORIDADES),
  due_on: z.string().nullable(),
  status: z.enum(OPPORTUNITY_STATUSES),
  authorized_at: Timestamp.nullable(),
  authorization_note: z.string().nullable(),
  closed_reason: z.string().nullable(),
  created_at: Timestamp,
});
export type OpportunityRow = z.infer<typeof OpportunityRow>;

export const opportunitiesList = defineOperation({
  operationId: 'opportunities.list',
  method: 'GET',
  path: '/opportunities',
  summary: 'Oportunidades, pelo prazo',
  permissions: ['opportunity.read'],
  query: z.object({
    status: z.enum(OPPORTUNITY_STATUSES).optional(),
    customer: Uuid.optional(),
    asset: Uuid.optional(),
  }),
  response: z.object({ items: z.array(OpportunityRow) }),
});

export const opportunitiesCreate = defineOperation({
  operationId: 'opportunities.create',
  method: 'POST',
  path: '/opportunities',
  summary: 'Registra uma necessidade como oportunidade',
  description:
    'Ativo, OS e solicitação de origem precisam ser do mesmo cliente. Nasce "identificada"; a ' +
    'autorização comercial é uma transição à parte, com permissão própria.',
  permissions: ['opportunity.create'],
  body: z
    .object({
      customer_id: Uuid,
      origin: z.enum(OPPORTUNITY_ORIGINS),
      title: z.string().trim().min(3).max(200),
      need: z.string().trim().min(5).max(4000),
      priority: z.enum(PRIORIDADES).optional(),
      due_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      asset_id: Uuid.optional(),
      work_order_id: Uuid.optional(),
      service_request_id: Uuid.optional(),
      supplier_id: Uuid.optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  errors: ['not_found'],
});

export const opportunitiesDetail = defineOperation({
  operationId: 'opportunities.detail',
  method: 'GET',
  path: '/opportunities/:id',
  summary: 'Uma oportunidade, a trilha e as transições possíveis',
  permissions: ['opportunity.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    opportunity: OpportunityRow,
    history: z.array(
      z.object({
        from_status: z.string().nullable(),
        to_status: z.string(),
        note: z.string().nullable(),
        changed_by: Uuid.nullable(),
        changed_at: Timestamp,
      })
    ),
    transitions: z.array(z.object({ to: z.string(), label: z.string(), permission: z.string() })),
  }),
  errors: ['not_found'],
});

export const opportunitiesTransition = defineOperation({
  operationId: 'opportunities.transition',
  method: 'POST',
  path: '/opportunities/:id/transitions',
  summary: 'Move a oportunidade: qualificar, autorizar, recusar, converter, cancelar',
  description:
    'A permissão sai da aresta: autorizar e recusar pedem `opportunity.authorize`; qualificar, ' +
    'descartar antes da decisão e converter pedem `opportunity.update`. Recusar e cancelar exigem ' +
    'motivo; converter exige o orçamento do mesmo cliente.',
  permissions: ['opportunity.read'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      to: z.enum(OPPORTUNITY_STATUSES),
      note: z.string().trim().max(2000).optional(),
      reason: z.string().trim().max(2000).optional(),
      quote_id: Uuid.optional(),
    })
    .strict(),
  response: OpportunityRow,
  status: 200,
  errors: ['not_found', 'conflict'],
});
