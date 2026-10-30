/**
 * Aurora — registros de qualidade: o lugar dos certificados (conversa com o cliente, 21/10/2026).
 *
 * "Tópico de Qualidade, com o lugar para os certificados de calibração, teste de segurança
 * elétrica, qualificação e treinamento." Cada registro é UM certificado, com quem emitiu, a data,
 * a validade e — opcionalmente — o arquivo. A vigência (vigente, vencendo, vencido) é calculada na
 * consulta, nunca gravada: um "vigente" gravado ontem pode ter vencido hoje.
 *
 * O arquivo mora no armazenamento de objetos (a porta de `apps/api/src/common/arquivos`); aqui
 * ficam a chave e os metadados.
 */
import { NotFoundError, ValidationError, newId } from '@aurora/domain';
import type { TenantSession } from './client';

export const QUALITY_KINDS = ['calibration', 'electrical_safety', 'qualification', 'training'] as const;
export type QualityKind = (typeof QUALITY_KINDS)[number];
export const QUALITY_STATUSES = ['valid', 'expiring', 'expired', 'no_validity'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** Quantos dias antes do vencimento um certificado passa a "vencendo". */
export const EXPIRING_DAYS = 30;

export interface QualityRecordInput {
  kind: QualityKind;
  title: string;
  customerId?: string | null;
  assetId?: string | null;
  /** QUA-04 · 0089: a versão do procedimento/checklist a que o certificado se refere (opcional). */
  procedureTemplateId?: string | null;
  personName?: string | null;
  certificateNumber?: string | null;
  issuer?: string | null;
  issuedAt: string;
  validUntil?: string | null;
  note?: string | null;
}

export interface QualityRecordRow {
  id: string;
  kind: QualityKind;
  title: string;
  customer_id: string | null;
  customer_name: string | null;
  asset_id: string | null;
  asset_name: string | null;
  procedure_template_id: string | null;
  procedure_title: string | null;
  procedure_version: number | null;
  person_name: string | null;
  certificate_number: string | null;
  issuer: string | null;
  issued_at: string;
  valid_until: string | null;
  note: string | null;
  status: QualityStatus;
  file_name: string | null;
  file_size: number | null;
  created_at: Date;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function createQualityRecord(
  session: TenantSession,
  input: QualityRecordInput
): Promise<string> {
  if (!(QUALITY_KINDS as readonly string[]).includes(input.kind)) {
    throw new ValidationError('tipo de certificado desconhecido', { field: 'kind' });
  }
  const titulo = input.title.trim();
  if (titulo.length < 2) throw new ValidationError('dê um título ao certificado', { field: 'title' });
  if (!DATA.test(input.issuedAt)) {
    throw new ValidationError('a data de emissão precisa ser AAAA-MM-DD', { field: 'issued_at' });
  }
  if (input.validUntil && !DATA.test(input.validUntil)) {
    throw new ValidationError('a validade precisa ser AAAA-MM-DD', { field: 'valid_until' });
  }
  if (input.validUntil && input.validUntil < input.issuedAt) {
    throw new ValidationError('a validade não pode ser anterior à emissão', { field: 'valid_until' });
  }
  // Treinamento é de PESSOA; os demais, de equipamento ou de cliente. Pedir o que falta evita um
  // certificado que ninguém sabe de quem é.
  if (input.kind === 'training' && !input.personName?.trim()) {
    throw new ValidationError('informe quem foi treinado', { field: 'person_name' });
  }
  if (input.kind !== 'training' && !input.assetId && !input.customerId) {
    throw new ValidationError('informe o equipamento ou o cliente a que o certificado se refere', {
      field: 'asset_id',
    });
  }

  // O cliente do equipamento é o do certificado: dois valores independentes divergiriam.
  let customerId = input.customerId ?? null;
  if (input.assetId) {
    const [a] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
      [input.assetId]
    );
    if (!a) throw new NotFoundError('Equipamento', input.assetId);
    if (customerId && customerId !== a.customer_id) {
      throw new ValidationError('o equipamento não é deste cliente', { field: 'asset_id' });
    }
    customerId = a.customer_id;
  }

  // O procedimento (QUA-04): uma versão que existe nesta organização — a RLS esconde a de outra,
  // e o "não existe" é o mesmo nos dois casos. Rascunho não serve: certificado não se refere a
  // procedimento que ainda pode mudar.
  if (input.procedureTemplateId) {
    const [t] = await session.query<{ status: string }>(
      `SELECT status::text AS status FROM aurora.checklist_templates WHERE id = $1`,
      [input.procedureTemplateId]
    );
    if (!t) {
      throw new ValidationError('procedimento não encontrado', { field: 'procedure_template_id' });
    }
    if (t.status === 'draft') {
      throw new ValidationError('o procedimento ainda é rascunho: publique-o antes de referenciá-lo', {
        field: 'procedure_template_id',
      });
    }
  }

  const id = newId();
  await session.query(
    `INSERT INTO aurora.quality_records
       (id, organization_id, kind, title, customer_id, asset_id, person_name, certificate_number,
        issuer, issued_at, valid_until, note, created_by, procedure_template_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14)`,
    [
      id,
      session.context.organizationId,
      input.kind,
      titulo,
      customerId,
      input.assetId ?? null,
      input.personName?.trim() || null,
      input.certificateNumber?.trim() || null,
      input.issuer?.trim() || null,
      input.issuedAt,
      input.validUntil || null,
      input.note?.trim() || null,
      session.context.actorId,
      input.procedureTemplateId ?? null,
    ]
  );
  return id;
}

export interface QualityFilters {
  kind?: QualityKind | null;
  customerId?: string | null;
  assetId?: string | null;
  status?: QualityStatus | null;
  /** O ESCOPO de quem pergunta: registros sem cliente (da organização) valem para todos. */
  scopeMembershipId?: string | null;
}

const STATUS_SQL = `CASE
    WHEN q.valid_until IS NULL THEN 'no_validity'
    WHEN q.valid_until < current_date THEN 'expired'
    WHEN q.valid_until <= current_date + ${EXPIRING_DAYS} THEN 'expiring'
    ELSE 'valid' END`;

export async function listQualityRecords(
  session: TenantSession,
  filters: QualityFilters = {},
  limit = 300
): Promise<QualityRecordRow[]> {
  return session.query<QualityRecordRow>(
    `SELECT * FROM (
       SELECT q.id, q.kind, q.title, q.customer_id, c.name AS customer_name, q.asset_id, a.name AS asset_name,
              q.procedure_template_id, ct.title AS procedure_title, ct.version AS procedure_version,
              q.person_name, q.certificate_number, q.issuer, q.issued_at::text AS issued_at,
              q.valid_until::text AS valid_until, q.note, ${STATUS_SQL} AS status,
              q.file_name, q.file_size, q.created_at
         FROM aurora.quality_records q
         LEFT JOIN aurora.customers c ON c.id = q.customer_id
         LEFT JOIN aurora.assets a ON a.id = q.asset_id
         LEFT JOIN aurora.checklist_templates ct ON ct.id = q.procedure_template_id
        WHERE q.deleted_at IS NULL
          AND ($1::text IS NULL OR q.kind = $1)
          AND ($2::uuid IS NULL OR q.customer_id = $2)
          AND ($3::uuid IS NULL OR q.asset_id = $3)
          AND ($4::uuid IS NULL
               OR q.customer_id IS NULL
               OR q.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($4)))
     ) x
     WHERE ($5::text IS NULL OR x.status = $5)
     ORDER BY CASE x.status WHEN 'expired' THEN 0 WHEN 'expiring' THEN 1 ELSE 2 END, x.valid_until NULLS LAST, x.title
     LIMIT $6`,
    [
      filters.kind ?? null,
      filters.customerId ?? null,
      filters.assetId ?? null,
      filters.scopeMembershipId ?? null,
      filters.status ?? null,
      limit,
    ]
  );
}

/** Tira o registro de cena (a linha fica, para a trilha de auditoria). */
export async function deleteQualityRecord(session: TenantSession, id: string): Promise<void> {
  const r = await session.query<{ id: string }>(
    `UPDATE aurora.quality_records SET deleted_at = now(), updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, session.context.actorId]
  );
  if (r.length === 0) throw new NotFoundError('Registro de qualidade', id);
}

export interface QualityFileMeta {
  file_key: string;
  file_name: string;
  file_content_type: string | null;
  file_size: number;
}

/** Visível a quem pergunta? Devolve o registro ou 404 — sem distinguir "não existe" de "não é seu". */
export async function getQualityFile(
  session: TenantSession,
  id: string,
  scopeMembershipId: string | null
): Promise<QualityFileMeta | null> {
  const [q] = await session.query<{
    file_key: string | null;
    file_name: string | null;
    file_content_type: string | null;
    file_size: number | null;
  }>(
    `SELECT file_key, file_name, file_content_type, file_size
       FROM aurora.quality_records q
      WHERE q.id = $1 AND q.deleted_at IS NULL
        AND ($2::uuid IS NULL
             OR q.customer_id IS NULL
             OR q.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2)))`,
    [id, scopeMembershipId]
  );
  if (!q) throw new NotFoundError('Registro de qualidade', id);
  if (!q.file_key || !q.file_name || q.file_size === null) return null;
  return {
    file_key: q.file_key,
    file_name: q.file_name,
    file_content_type: q.file_content_type,
    file_size: q.file_size,
  };
}

/** Grava os metadados do arquivo (os bytes já foram para o armazenamento). */
export async function setQualityFile(
  session: TenantSession,
  id: string,
  meta: QualityFileMeta & { sha256: string },
  scopeMembershipId: string | null
): Promise<void> {
  const r = await session.query<{ id: string }>(
    `UPDATE aurora.quality_records q
        SET file_key = $2, file_name = $3, file_content_type = $4, file_size = $5, file_sha256 = $6,
            updated_by = $7
      WHERE q.id = $1 AND q.deleted_at IS NULL
        AND ($8::uuid IS NULL
             OR q.customer_id IS NULL
             OR q.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($8)))
      RETURNING q.id`,
    [
      id,
      meta.file_key,
      meta.file_name,
      meta.file_content_type,
      meta.file_size,
      meta.sha256,
      session.context.actorId,
      scopeMembershipId,
    ]
  );
  if (r.length === 0) throw new NotFoundError('Registro de qualidade', id);
}
