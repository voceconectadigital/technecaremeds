/**
 * Aurora — execução guiada da OS (reunião 16/10/2026, Fase 5).
 *
 * Check-in/check-out pontuais (com posição do aparelho ou justificativa),
 * "Preencher Ordem de Serviço" (relatório, resultado operacional, parecer) e
 * peça fornecida pelo cliente. O assistente "▶ Executar" da ficha usa estas
 * rotas junto com as que já existiam (transição, checklist, peças de estoque,
 * anexos).
 */
import { defineOperation } from '../registry';
import { z, Uuid, Ok } from '../primitives';

const Ponto = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy_m: z.number().min(0).nullable().optional(),
  /** Obrigatória (10+ letras) quando não há posição do aparelho. */
  justification: z.string().trim().max(500).nullable().optional(),
});

export const WorkOrderVisit = z.object({
  id: Uuid,
  kind: z.enum(['check_in', 'check_out']),
  occurred_at: z.string(),
  membership_id: Uuid,
  person_name: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracy_m: z.number().nullable(),
  position_source: z.enum(['device', 'manual']),
  justification: z.string().nullable(),
  mine: z.boolean(),
});
export type WorkOrderVisit = z.infer<typeof WorkOrderVisit>;

export const workOrderCheckIn = defineOperation({
  operationId: 'workOrders.checkIn',
  method: 'POST',
  path: '/work-orders/:id/check-in',
  summary: 'Check-in: registra a chegada (posição pontual ou justificativa) e abre o cronômetro',
  description:
    'Sem rastreamento contínuo: só este instante. Sem posição do aparelho (recusada ou ' +
    'indisponível), a justificativa é obrigatória e fica auditada. Dois check-ins seguidos da ' +
    'mesma pessoa na mesma OS → 409.',
  permissions: ['work_order.read'], // guard; execute ou execute_any conferidos no handler
  params: z.object({ id: Uuid }),
  body: Ponto,
  response: z.object({ visit_id: Uuid, time_entry_id: Uuid, occurred_at: z.string() }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const workOrderCheckOut = defineOperation({
  operationId: 'workOrders.checkOut',
  method: 'POST',
  path: '/work-orders/:id/check-out',
  summary: 'Check-out: registra a saída e fecha o cronômetro aberto pelo check-in',
  permissions: ['work_order.read'], // guard; execute ou execute_any conferidos no handler
  params: z.object({ id: Uuid }),
  body: Ponto,
  response: z.object({ visit_id: Uuid, minutes: z.number().nullable(), occurred_at: z.string() }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const workOrderVisits = defineOperation({
  operationId: 'workOrders.visits',
  method: 'GET',
  path: '/work-orders/:id/visits',
  summary: 'Check-ins e check-outs da OS',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(WorkOrderVisit) }),
  errors: ['not_found'],
});

export const workOrderServiceReport = defineOperation({
  operationId: 'workOrders.serviceReport',
  method: 'PATCH',
  path: '/work-orders/:id/service-report',
  summary: 'Preencher Ordem de Serviço: descrição, observações, resultado operacional e parecer',
  description:
    'Salva aos poucos (cada passo do assistente grava o que tem). Resultado operacional é a ' +
    'situação de USO do equipamento após o serviço — liberado ou parado —, não veredito ' +
    'metrológico. OS validada, fechada ou cancelada → 409.',
  permissions: ['work_order.read'], // guard; execute ou execute_any conferidos no handler
  params: z.object({ id: Uuid }),
  body: z
    .object({
      service_description: z.string().max(5000).nullable().optional(),
      service_observations: z.string().max(5000).nullable().optional(),
      operational_result: z.enum(['released', 'stopped']).nullable().optional(),
      final_opinion: z.string().max(5000).nullable().optional(),
    })
    .strict(),
  response: Ok,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const WorkOrderCustomerPart = z.object({
  id: Uuid,
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type WorkOrderCustomerPart = z.infer<typeof WorkOrderCustomerPart>;

export const workOrderCustomerPartsAdd = defineOperation({
  operationId: 'workOrders.addCustomerPart',
  method: 'POST',
  path: '/work-orders/:id/customer-parts',
  summary: 'Registra peça FORNECIDA PELO CLIENTE (descrição manual, auditada)',
  description:
    'Peça de estoque continua por `POST /inventory/work-orders/:id/parts`, que baixa do razão ' +
    'vinculado à OS. Esta rota não movimenta estoque nenhum: só registra o que o cliente forneceu.',
  permissions: ['work_order.read'], // guard; execute ou execute_any conferidos no handler
  params: z.object({ id: Uuid }),
  body: z
    .object({
      description: z.string().trim().min(3).max(300),
      quantity: z.number().positive(),
      unit: z.string().trim().max(20).nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const workOrderCustomerParts = defineOperation({
  operationId: 'workOrders.customerParts',
  method: 'GET',
  path: '/work-orders/:id/customer-parts',
  summary: 'Peças fornecidas pelo cliente nesta OS',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(WorkOrderCustomerPart) }),
  errors: ['not_found'],
});

/* -------------------------------------------------------------------------- */
/* Contratos das rotas de execução que já existiam e não tinham contrato —    */
/* o assistente da web passa a usá-las.                                       */
/* -------------------------------------------------------------------------- */

const ItemDeChecklist = z
  .object({
    id: Uuid,
    kind: z.string(),
    label: z.string(),
    required: z.boolean(),
    options: z.array(z.string()).nullable().optional(),
    unit: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
  })
  .passthrough();

export const WorkOrderChecklist = z.object({
  id: Uuid,
  template_id: Uuid,
  template_key: z.string(),
  template_version: z.number().int(),
  items: z.array(ItemDeChecklist),
  status: z.record(z.string(), z.unknown()),
  answers: z.array(
    z.object({
      item_id: Uuid,
      value_text: z.string().nullable(),
      value_number: z.number().nullable(),
      value_boolean: z.boolean().nullable(),
      value_options: z.array(z.string()).nullable(),
      value_date: z.string().nullable(),
      photo_count: z.number().nullable(),
      verdict: z.string().nullable(),
    })
  ),
});
export type WorkOrderChecklist = z.infer<typeof WorkOrderChecklist>;

export const workOrderChecklists = defineOperation({
  operationId: 'workOrders.checklists',
  method: 'GET',
  path: '/work-orders/:id/checklists',
  summary: 'Procedimentos/checklists da OS, com itens, situação e respostas já dadas',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ items: z.array(WorkOrderChecklist) }),
  errors: ['not_found'],
});

export const workOrderChecklistAttach = defineOperation({
  operationId: 'workOrders.attachChecklist',
  method: 'POST',
  path: '/work-orders/:id/checklists',
  summary: 'Anexa um procedimento/checklist publicado à OS (congela a versão)',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  body: z.object({ template_id: Uuid, response_id: Uuid.optional() }),
  response: z.object({ response_id: Uuid }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const checklistAnswer = defineOperation({
  operationId: 'checklistResponses.answer',
  method: 'POST',
  path: '/checklist-responses/:responseId/answers',
  summary: 'Responde um item do procedimento (o veredito é do servidor)',
  description:
    'Cada resposta é gravada na hora: não existe "salvar rascunho". Corrigir uma resposta exige ' +
    'motivo (`correction_reason`) e fica no histórico. Medição (`readings`) segue a ' +
    'sessão de medição; o veredito metrológico continua bloqueado (sem critério validado).',
  permissions: ['work_order.execute'],
  params: z.object({ responseId: Uuid }),
  body: z.object({
    item_id: Uuid,
    text: z.string().nullable().optional(),
    number: z.number().nullable().optional(),
    boolean: z.boolean().nullable().optional(),
    options: z.array(z.string()).nullable().optional(),
    date: z.string().nullable().optional(),
    photo_count: z.number().int().min(0).optional(),
    correction_reason: z.string().nullable().optional(),
  }),
  response: z.object({
    verdict: z.string(),
    answer_id: Uuid,
    revision: z.number().int(),
    status: z.unknown(),
  }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const workOrderCompletion = defineOperation({
  operationId: 'workOrders.completion',
  method: 'GET',
  path: '/work-orders/:id/completion',
  summary: 'O que falta para concluir, sem tentar concluir',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z
    .object({ required: z.array(z.unknown()), ok: z.boolean(), missing: z.array(z.unknown()) })
    .passthrough(),
  errors: ['not_found'],
});

export const workOrderAttachmentCreate = defineOperation({
  operationId: 'workOrders.createAttachment',
  method: 'POST',
  path: '/work-orders/:id/attachments',
  summary: 'Registra um anexo (foto antes/depois…); os bytes vão por PUT /field/attachments/:id/bytes',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  body: z.object({
    purpose: z.enum(['before', 'after', 'evidence', 'document', 'signature', 'other']),
    file_name: z.string().min(1).max(200),
    content_type: z.string().min(3).max(120),
    byte_size: z.number().int().positive(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
  response: z.object({ attachment_id: Uuid, storage_key: z.string() }),
  status: 201,
  errors: ['not_found', 'validation_failed'],
});

export const inventoryConsumePart = defineOperation({
  operationId: 'inventory.consumeWorkOrderPart',
  method: 'POST',
  path: '/inventory/work-orders/:id/parts',
  summary: 'Usa peça de ESTOQUE na OS: reserva e baixa do razão, vinculadas à OS',
  description: 'Nenhuma baixa silenciosa: o movimento fica com `ref_type = work_order` e a OS.',
  permissions: ['inventory.move'],
  params: z.object({ id: Uuid }),
  body: z.object({ item_id: Uuid, warehouse_id: Uuid, qty: z.number().positive() }),
  response: z.object({ movement_id: Uuid, reservation_id: Uuid }),
  status: 201,
  errors: ['not_found', 'conflict', 'validation_failed'],
});
