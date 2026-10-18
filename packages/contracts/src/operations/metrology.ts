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

/* -------------------------------------------------------------------------- */
/* instrumentos (0051)                                                         */
/* -------------------------------------------------------------------------- */

export const INSTRUMENT_STATUSES = ['active', 'in_calibration', 'out_of_service', 'retired'] as const;
export const INSTRUMENT_OWNERSHIPS = ['own', 'third_party'] as const;
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data civil AAAA-MM-DD');

export const CurrentCertificate = z.object({
  id: Uuid,
  certificate_number: z.string(),
  laboratory: z.string(),
  issued_on: z.string(),
  valid_until: z.string(),
});

export const InstrumentRow = z.object({
  /** O instrumento É o ativo: a chave é a mesma. */
  asset_id: Uuid,
  name: z.string(),
  tag: z.string().nullable(),
  serial_number: z.string().nullable(),
  manufacturer_name: z.string().nullable(),
  model_name: z.string().nullable(),
  category_name: z.string().nullable(),
  status: z.enum(INSTRUMENT_STATUSES),
  ownership: z.enum(INSTRUMENT_OWNERSHIPS),
  interface: z.string().nullable(),
  protocol: z.string().nullable(),
  firmware_version: z.string().nullable(),
  adapter: z.string().nullable(),
  last_validated_on: z.string().nullable(),
  known_limitations: z.string(),
  notes: z.string(),
  /** O certificado não revogado que vence por último. Nulo quando não há nenhum. */
  current_certificate: CurrentCertificate.nullable(),
});
export type InstrumentRow = z.infer<typeof InstrumentRow>;

export const CertificateRow = z.object({
  id: Uuid,
  instrument_id: Uuid,
  certificate_number: z.string(),
  laboratory: z.string(),
  issued_on: z.string(),
  valid_until: z.string(),
  scope: z.string(),
  traceability_statement: z.string(),
  traceable_to_id: Uuid.nullable(),
  revoked_at: Timestamp.nullable(),
  revoked_reason: z.string().nullable(),
  files: z.array(
    z.object({
      id: Uuid,
      file_name: z.string(),
      sha256: z.string().nullable(),
      upload_completed: z.boolean(),
    })
  ),
});
export type CertificateRow = z.infer<typeof CertificateRow>;

export const instrumentsList = defineOperation({
  operationId: 'instruments.list',
  method: 'GET',
  path: '/instruments',
  summary: 'Instrumentos de medição da organização',
  description:
    'Fabricante, modelo e série vêm do ATIVO — o instrumento é papel de ativo, não segunda ' +
    'hierarquia. `current_certificate` é o não revogado que vence por último.',
  permissions: ['instrument.read'],
  query: z.object({ status: z.enum(INSTRUMENT_STATUSES).optional() }),
  response: z.object({ items: z.array(InstrumentRow) }),
});

const InstrumentFields = {
  status: z.enum(INSTRUMENT_STATUSES).optional(),
  ownership: z.enum(INSTRUMENT_OWNERSHIPS).optional(),
  interface: z.string().trim().max(120).nullable().optional(),
  protocol: z.string().trim().max(120).nullable().optional(),
  firmware_version: z.string().trim().max(120).nullable().optional(),
  adapter: z.string().trim().max(120).nullable().optional(),
  last_validated_on: DataCivil.nullable().optional(),
  known_limitations: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
};

export const instrumentsRegister = defineOperation({
  operationId: 'instruments.register',
  method: 'POST',
  path: '/instruments',
  summary: 'Marca um ativo existente como instrumento de medição',
  description: 'Só cadastro (N0). Nenhum driver, nenhuma comunicação física.',
  permissions: ['instrument.manage'],
  body: z.object({ asset_id: Uuid, ...InstrumentFields }).strict(),
  response: z.object({ asset_id: Uuid }),
  errors: ['not_found', 'conflict'],
});

export const instrumentsDetail = defineOperation({
  operationId: 'instruments.detail',
  method: 'GET',
  path: '/instruments/:id',
  summary: 'Um instrumento e todos os seus certificados, inclusive revogados',
  permissions: ['instrument.read'],
  params: z.object({ id: Uuid }),
  response: z.object({ instrument: InstrumentRow, certificates: z.array(CertificateRow) }),
  errors: ['not_found'],
});

export const instrumentsUpdate = defineOperation({
  operationId: 'instruments.update',
  method: 'PATCH',
  path: '/instruments/:id',
  summary: 'Edita os dados próprios de instrumento',
  permissions: ['instrument.manage'],
  params: z.object({ id: Uuid }),
  body: z.object(InstrumentFields).strict(),
  response: InstrumentRow,
  status: 200,
  errors: ['not_found'],
});

export const instrumentsRegisterCertificate = defineOperation({
  operationId: 'instruments.registerCertificate',
  method: 'POST',
  path: '/instruments/:id/certificates',
  summary: 'Registra um certificado EXTERNO recebido de laboratório',
  description:
    'Não é documento emitido por nós: não queima número, não passa por revisão. O escopo é texto ' +
    'declarado — faixas e incerteza como dado estruturado dependem de especialista. Registrado, é ' +
    'imutável: errou, revoga com motivo e registra de novo.',
  permissions: ['instrument.manage'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      certificate_number: z.string().trim().min(1).max(120),
      laboratory: z.string().trim().min(1).max(200),
      issued_on: DataCivil,
      valid_until: DataCivil,
      scope: z.string().max(4000).optional(),
      traceability_statement: z.string().max(1000).optional(),
      traceable_to_id: Uuid.nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  errors: ['not_found', 'conflict'],
});

export const instrumentCertificatesRevoke = defineOperation({
  operationId: 'instrumentCertificates.revoke',
  method: 'POST',
  path: '/instrument-certificates/:id/revocation',
  summary: 'Revoga um certificado registrado errado (não apaga)',
  permissions: ['instrument.manage'],
  params: z.object({ id: Uuid }),
  body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'conflict'],
});

const RegistroDeArquivo = z
  .object({
    file_name: z.string().min(1).max(400),
    content_type: z.string().min(1).max(200),
    byte_size: z.number().int().positive(),
    /** Obrigatório: certificado e dado bruto são evidência de integridade. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const ArquivoRegistrado = z.object({
  attachment_id: Uuid,
  /** Para onde o aparelho manda os bytes: `PUT /field/attachments/{attachment_id}/bytes`. */
  storage_key: z.string(),
});

export const instrumentCertificatesAttachFile = defineOperation({
  operationId: 'instrumentCertificates.attachFile',
  method: 'POST',
  path: '/instrument-certificates/:id/files',
  summary: 'Registra o arquivo (PDF/imagem) de um certificado externo',
  description: 'Os bytes seguem pelo envio retomável de sempre, com o SHA-256 conferido no fim.',
  permissions: ['instrument.manage'],
  params: z.object({ id: Uuid }),
  body: RegistroDeArquivo,
  response: ArquivoRegistrado,
  errors: ['not_found'],
});

/* -------------------------------------------------------------------------- */
/* sessão de medição (0053)                                                    */
/* -------------------------------------------------------------------------- */

export const measurementSessionsOpen = defineOperation({
  operationId: 'measurementSessions.open',
  method: 'POST',
  path: '/work-orders/:id/measurement-sessions',
  summary: 'Abre a sessão de medição de um checklist anexado à OS',
  description:
    'Sob a garantia de idempotência de campo (`x-aurora-client-operation`); o identificador ' +
    'pode vir do aparelho. Recusa instrumento fora de operação, instrumento de categoria que o ' +
    'protocolo não aceita e certificado que não cobria o dia da medição. Nada aqui compara ' +
    'leitura com tolerância. Como toda ação de execução, só na OS atribuída à pessoa ou à equipe ' +
    'dela, salvo `work_order.execute_any` (403 com o motivo, PF-14) — e o mesmo vale para ' +
    'leituras, dado bruto e encerramento da sessão.',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      id: Uuid.optional(),
      response_id: Uuid,
      instrument_id: Uuid.nullable().optional(),
      instrument_certificate_id: Uuid.nullable().optional(),
      measured_on: DataCivil,
      ambient: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      notes: z.string().max(4000).optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  errors: ['not_found', 'conflict', 'forbidden'],
});

export const MeasurementPoint = z.object({
  item_id: Uuid,
  label: z.string(),
  unit: z.string().nullable(),
  nominal_value: z.number().nullable(),
  tolerance_minus: z.number().nullable(),
  tolerance_plus: z.number().nullable(),
  /** `absolute` (na unidade do ponto) ou `percent`. Dado declarado: o sistema não converte. */
  tolerance_mode: z.string().nullable(),
  readings_required: z.number().int().nullable(),
  readings: z.array(z.number()).nullable(),
  answer_unit: z.string().nullable(),
  source: z.string().nullable(),
  instrument_id: Uuid.nullable(),
  revision: z.number().int().nullable(),
  measured_at: Timestamp.nullable(),
  device_measured_at: Timestamp.nullable(),
  /** Sempre `na` para ponto de medição: critério de aceitação não validado. */
  verdict: z.string().nullable(),
});

export const MeasurementSessionDetail = z.object({
  id: Uuid,
  response_id: Uuid,
  work_order_id: Uuid,
  work_order_number: z.string().nullable(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  source: z.string(),
  measured_on: z.string(),
  started_at: Timestamp,
  finished_at: Timestamp.nullable(),
  ambient: z.record(z.string(), z.unknown()),
  notes: z.string(),
  technician: z.object({ membership_id: Uuid, name: z.string().nullable() }).nullable(),
  protocol: z.object({
    template_id: Uuid,
    key: z.string(),
    version: z.number().int(),
    title: z.string(),
    procedure_kind: z.string().nullable(),
    technical_manager_id: Uuid.nullable(),
    technical_manager_name: z.string().nullable(),
    required_instrument_categories: z.array(z.object({ id: Uuid, name: z.string() })),
  }),
  instrument: z
    .object({
      asset_id: Uuid,
      name: z.string(),
      tag: z.string().nullable(),
      serial_number: z.string().nullable(),
      manufacturer_name: z.string().nullable(),
      model_name: z.string().nullable(),
    })
    .nullable(),
  certificate: z
    .object({
      id: Uuid,
      certificate_number: z.string(),
      laboratory: z.string(),
      issued_on: z.string(),
      valid_until: z.string(),
      traceability_statement: z.string(),
      revoked: z.boolean(),
    })
    .nullable(),
  points: z.array(MeasurementPoint),
  raw_data: z.array(
    z.object({
      id: Uuid,
      file_name: z.string(),
      content_type: z.string(),
      sha256: z.string().nullable(),
      upload_completed: z.boolean(),
    })
  ),
});
export type MeasurementSessionDetail = z.infer<typeof MeasurementSessionDetail>;

export const measurementSessionsDetail = defineOperation({
  operationId: 'measurementSessions.detail',
  method: 'GET',
  path: '/measurement-sessions/:id',
  summary:
    'Sessão de medição com a proveniência inteira: protocolo, instrumento, certificado, pontos e dado bruto',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: MeasurementSessionDetail,
  errors: ['not_found'],
});

export const measurementSessionsForWorkOrder = defineOperation({
  operationId: 'measurementSessions.forWorkOrder',
  method: 'GET',
  path: '/work-orders/:id/measurement-sessions',
  summary: 'As sessões de medição de uma OS',
  permissions: ['work_order.read'],
  params: z.object({ id: Uuid }),
  response: z.object({
    items: z.array(
      z.object({ id: Uuid, response_id: Uuid, measured_on: z.string(), finished_at: Timestamp.nullable() })
    ),
  }),
});

export const measurementSessionsRecord = defineOperation({
  operationId: 'measurementSessions.record',
  method: 'POST',
  path: '/measurement-sessions/:id/measurements',
  summary: 'Registra as leituras de um ponto pela fonte MANUAL (N0)',
  description:
    'O corpo vira um envelope neutro de medição (`fonteManual`) — o mesmo que arquivo, gateway ' +
    'ou SDK produzirão quando tiverem adaptador. Unidade diferente da do protocolo é recusada: ' +
    'o sistema não converte. Corrigir preserva a leitura anterior no histórico.',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  body: z
    .object({
      item_id: Uuid,
      readings: z.array(z.number()).min(1).max(50),
      unit: z.string().trim().min(1).max(40).optional(),
      instrument_id: Uuid.nullable().optional(),
      measured_at: Timestamp.optional(),
      correction_reason: z.string().max(1000).optional(),
    })
    .strict(),
  response: z.object({ answer_id: Uuid, revision: z.number().int(), verdict: z.string() }),
  errors: ['not_found', 'conflict', 'forbidden'],
});

export const measurementSessionsFinish = defineOperation({
  operationId: 'measurementSessions.finish',
  method: 'POST',
  path: '/measurement-sessions/:id/finish',
  summary: 'Encerra a sessão de medição; leitura nova deixa de entrar',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found', 'conflict', 'forbidden'],
});

export const measurementSessionsAttachRawData = defineOperation({
  operationId: 'measurementSessions.attachRawData',
  method: 'POST',
  path: '/measurement-sessions/:id/raw-data',
  summary: 'Registra um arquivo de DADO BRUTO da sessão (CSV, JSON, XML, PDF, binário)',
  description:
    'Guardado como chegou, com SHA-256 obrigatório. O sistema NÃO lê nem interpreta o conteúdo — ' +
    'importar leituras de arquivo é o adaptador N1, ainda não construído.',
  permissions: ['work_order.execute'],
  params: z.object({ id: Uuid }),
  body: RegistroDeArquivo,
  response: ArquivoRegistrado,
  errors: ['not_found', 'forbidden'],
});
