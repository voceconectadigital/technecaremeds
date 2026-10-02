/**
 * Aurora — engenharia clínica / metrologia N0 (auditoria de gap V2 §15–§21).
 *
 * N0 é o "manual estruturado" do PLAT §6.1: o técnico registra os valores e o
 * sistema associa unidade, instrumento, certificado, protocolo e origem. Nada
 * aqui CALCULA ciência — incerteza, correção, critério de aceitação e
 * arredondamento continuam bloqueados (`AURORA-METROLOGIA-FRONTEIRA.md`). O que
 * este contrato descreve é REGISTRO e PROVENIÊNCIA.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

/* -------------------------------------------------------------------------- */
/* histórico de respostas (0047)                                               */
/* -------------------------------------------------------------------------- */

export const AnswerRevision = z.object({
  answer_id: Uuid,
  item_id: Uuid,
  /** 1 é o valor original. Cada correção soma um. */
  revision: z.number().int().min(1),
  value_text: z.string().nullable(),
  value_number: z.number().nullable(),
  value_boolean: z.boolean().nullable(),
  value_options: z.array(z.string()).nullable(),
  value_date: z.string().nullable(),
  verdict: z.string(),
  photo_count: z.number().int(),
  correction_reason: z.string().nullable(),
  measured_by: Uuid.nullable(),
  measured_at: Timestamp,
  /** Quando esta versão deixou de valer. Nulo na vigente. */
  superseded_at: Timestamp.nullable(),
  /** Quem a substituiu. */
  superseded_by: Uuid.nullable(),
  /** `true` só para a versão vigente de cada item. */
  current: z.boolean(),
});
export type AnswerRevision = z.infer<typeof AnswerRevision>;

export const checklistAnswerRevisions = defineOperation({
  operationId: 'execution.answerRevisions',
  method: 'GET',
  path: '/checklist-responses/:responseId/revisions',
  summary: 'Todas as versões das respostas de um checklist, a vigente e as corrigidas',
  description:
    'Responder de novo um item não apaga o valor anterior: ele é arquivado inteiro, com quem e ' +
    'quando o substituiu. Esta rota devolve as duas coisas, ordenadas por item e revisão.',
  permissions: ['work_order.read'],
  params: z.object({ responseId: Uuid }),
  response: z.object({ items: z.array(AnswerRevision) }),
  errors: ['not_found'],
});
