/**
 * Aurora — registros de qualidade: o lugar dos certificados (conversa com o cliente, 21/10/2026).
 *
 * Quatro tipos de certificado — calibração, teste de segurança elétrica, qualificação e treinamento —,
 * cada registro com quem emitiu, a data, a validade e, opcionalmente, o arquivo. Quem lê usa
 * `document.read`; quem cadastra, `document.create`. O arquivo sobe e desce por rotas de corpo cru
 * (`PUT/GET /quality-records/:id/file`), que ficam fora deste contrato JSON.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const QUALITY_KINDS = ['calibration', 'electrical_safety', 'qualification', 'training'] as const;
export const QUALITY_KIND_LABELS: Record<(typeof QUALITY_KINDS)[number], string> = {
  calibration: 'Calibração',
  electrical_safety: 'Segurança elétrica',
  qualification: 'Qualificação',
  training: 'Treinamento',
};
export const QUALITY_STATUSES = ['valid', 'expiring', 'expired', 'no_validity'] as const;

export const QualityRecordRow = z.object({
  id: Uuid,
  kind: z.enum(QUALITY_KINDS),
  title: z.string(),
  customer_id: Uuid.nullable(),
  customer_name: z.string().nullable(),
  asset_id: Uuid.nullable(),
  asset_name: z.string().nullable(),
  person_name: z.string().nullable(),
  certificate_number: z.string().nullable(),
  issuer: z.string().nullable(),
  issued_at: z.string(),
  valid_until: z.string().nullable(),
  note: z.string().nullable(),
  /** Calculado na consulta: vigente, vencendo (30 dias), vencido ou sem validade. */
  status: z.enum(QUALITY_STATUSES),
  file_name: z.string().nullable(),
  file_size: z.number().int().nullable(),
  created_at: Timestamp,
});
export type QualityRecordRow = z.infer<typeof QualityRecordRow>;

export const qualityList = defineOperation({
  operationId: 'quality.list',
  method: 'GET',
  path: '/quality-records',
  summary: 'Os certificados de qualidade, vencidos e vencendo primeiro',
  permissions: ['document.read'],
  query: z.object({
    kind: z.enum(QUALITY_KINDS).optional(),
    customer: Uuid.optional(),
    asset: Uuid.optional(),
    status: z.enum(QUALITY_STATUSES).optional(),
  }),
  response: z.object({ items: z.array(QualityRecordRow) }),
});

export const qualityCreate = defineOperation({
  operationId: 'quality.create',
  method: 'POST',
  path: '/quality-records',
  summary: 'Cadastra um certificado (o arquivo sobe depois, em `PUT /quality-records/:id/file`)',
  description:
    'Treinamento é de pessoa (`person_name` obrigatório); os demais, de equipamento ou de cliente. ' +
    'A validade não pode ser anterior à emissão.',
  permissions: ['document.create'],
  body: z
    .object({
      kind: z.enum(QUALITY_KINDS),
      title: z.string().trim().min(2).max(200),
      customer_id: Uuid.nullable().optional(),
      asset_id: Uuid.nullable().optional(),
      person_name: z.string().trim().max(200).nullable().optional(),
      certificate_number: z.string().trim().max(80).nullable().optional(),
      issuer: z.string().trim().max(200).nullable().optional(),
      issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD'),
      valid_until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
        .nullable()
        .optional(),
      note: z.string().trim().max(2000).nullable().optional(),
    })
    .strict(),
  response: z.object({ id: Uuid }),
  status: 201,
  errors: ['validation_failed', 'not_found'],
});

export const qualityDelete = defineOperation({
  operationId: 'quality.delete',
  method: 'DELETE',
  path: '/quality-records/:id',
  summary: 'Tira o certificado de cena (a trilha de auditoria guarda o registro)',
  permissions: ['document.create'],
  params: z.object({ id: Uuid }),
  response: z.object({ ok: z.literal(true) }),
  errors: ['not_found'],
});
