/**
 * Aurora — documentos técnicos (SPEC v0.2 §18 · EPIC-018).
 *
 * A PERGUNTA DA OPERAÇÃO É "O QUE VENCE ESTE MÊS?".
 *
 * Havia rota por ativo e por identificador, e nenhuma lista. Sem o recorte de
 * vencimento, o vencimento só é descoberto pela varredura — que avisa quando
 * já é tarde para providenciar laudo, calibração ou renovação.
 *
 * DOCUMENTO SEM VALIDADE NÃO VENCE, e por isso fica de fora do recorte de
 * vencimento — mas continua na lista sem recorte. "Sem validade" é diferente
 * de "não existe", e colapsar os dois faria sumir da tela metade do acervo.
 *
 * VERSÃO NÃO SOBRESCREVE. Um documento emitido é imutável: corrigir gera uma
 * versão nova que aponta para a anterior. O que foi entregue ao cliente
 * continua existindo exatamente como foi entregue — que é a única forma de
 * responder "o que exatamente foi assinado?" numa auditoria.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const DOCUMENT_STATUSES = [
  'draft',
  'under_review',
  'issued',
  'released',
  'cancelled',
  'superseded',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DocumentRow = z.object({
  id: Uuid,
  number: z.string().nullable(),
  version: z.number().int(),
  status: z.string(),
  title: z.string().nullable(),
  /**
   * O parecer técnico: conforme, não conforme, conforme com restrição.
   *
   * Nulo enquanto o documento é rascunho — e nulo é diferente de "conforme",
   * que é o erro de leitura que um valor padrão produziria.
   */
  verdict: z.string().nullable(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  work_order_id: Uuid.nullable(),
  customer_id: Uuid.nullable(),
  type_key: z.string(),
  type_name: z.string(),
  issued_at: Timestamp.nullable(),
  /** Data, sem hora: validade é do dia, e não do instante. */
  valid_until: z.string().nullable(),
  released_to_customer_at: Timestamp.nullable(),
  cancelled_at: Timestamp.nullable(),
  /** Preenchido quando ESTE documento substitui outro. */
  supersedes_id: Uuid.nullable(),
});
export type DocumentRow = z.infer<typeof DocumentRow>;

export const documentsList = defineOperation({
  operationId: 'documents.list',
  method: 'GET',
  path: '/documents',
  summary: 'Documentos, com o recorte de vencimento',
  description:
    '`expiring_within_days` filtra por `valid_until`. Documento sem validade não vence e fica ' +
    'fora desse recorte — mas continua na lista sem recorte, porque "sem validade" é diferente ' +
    'de "não existe".',
  permissions: ['document.read'],
  query: z.object({
    status: z.string().optional(),
    asset: Uuid.optional(),
    expiring_within_days: z.coerce.number().int().min(0).max(3650).optional(),
  }),
  response: z.object({ items: z.array(DocumentRow) }),
});

export const documentsByAsset = defineOperation({
  operationId: 'documents.byAsset',
  method: 'GET',
  path: '/documents/by-asset',
  summary: 'Documentos de um equipamento',
  permissions: ['document.read'],
  query: z.object({ assetId: Uuid }),
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});

export const documentTypes = defineOperation({
  operationId: 'documents.types',
  method: 'GET',
  path: '/documents/types',
  summary: 'Os tipos de documento desta organização',
  permissions: ['document.read'],
  response: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
});

/* -------------------------------------------------------------------------- */
/* a partir da sessão de medição, e PDF (gap V2 P2.6–P2.8)                     */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_TYPE_KEYS = [
  'work_order_report',
  'calibration_certificate',
  'electrical_safety_test',
  'standard_certificate',
  'obsolescence_report',
  'thermal_qualification',
  'acceptance_report',
] as const;

export const documentsFromSession = defineOperation({
  operationId: 'documents.fromSession',
  method: 'POST',
  path: '/documents/from-session/:sessionId',
  summary: 'Cria o RASCUNHO de documento técnico a partir de uma sessão de medição encerrada',
  description:
    'O conteúdo é CÓPIA da sessão (protocolo, instrumento, certificado, pontos, leituras, dado ' +
    'bruto) — sem média, incerteza, correção ou veredito por ponto. O tipo precisa combinar com o ' +
    'procedimento do protocolo. Daí em diante vale o motor de sempre: revisão, assinatura, emissão.',
  permissions: ['document.create'],
  params: z.object({ sessionId: Uuid }),
  body: z
    .object({
      document_type_key: z.enum(DOCUMENT_TYPE_KEYS).optional(),
      title: z.string().trim().min(1).max(300).optional(),
      technical_manager_id: Uuid.optional(),
    })
    .strict(),
  response: z.object({ id: Uuid, document_type_key: z.enum(DOCUMENT_TYPE_KEYS) }),
  errors: ['not_found', 'conflict'],
});

export const documentsPdf = defineOperation({
  operationId: 'documents.pdf',
  method: 'GET',
  path: '/documents/:id/pdf',
  summary: 'O documento em PDF',
  description:
    'Gerado na hora, determinístico (mesmo conteúdo, mesmos bytes). Documento não emitido sai com ' +
    'faixa "NÃO EMITIDO" e sem número. O cabeçalho `x-aurora-content-hash` traz o hash do ' +
    'conteúdo: é ele, e não o arquivo, que a assinatura cobre.',
  permissions: ['document.read'],
  params: z.object({ id: Uuid }),
  response: z.string().describe('Arquivo PDF'),
  produces: 'application/pdf',
  errors: ['not_found'],
});
