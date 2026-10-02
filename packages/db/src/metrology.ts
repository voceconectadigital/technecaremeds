/**
 * Aurora — engenharia clínica / metrologia N0 na camada de dados
 * (0051–0053 · gap V2 P2.1–P2.5 · PLAT §5, §6.1, §6.2).
 *
 * TUDO AQUI É REGISTRO E PROVENIÊNCIA.
 *
 * Instrumento, certificado externo, sessão de medição, leituras e dado bruto
 * são gravados e ligados entre si. O que o sistema DECIDE sozinho é só a
 * aritmética de calendário já validada (`metrologia.ts`): o certificado cobria
 * o dia da medição? A cadeia está preenchida? Incerteza, correção, critério de
 * aceitação, limites de TSE e arredondamento continuam fora — e nenhuma função
 * deste arquivo os aproxima.
 */
import {
  newId,
  certificadoCobreAMedicao,
  ValidationError,
  NotFoundError,
  ConflictError,
  type EnvelopeDeMedicao,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { answerChecklistItem, attachFile, loadChecklistItems } from './execution';

const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function dataCivil(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !DATA_CIVIL.test(valor)) {
    throw new ValidationError(`${campo} precisa ser uma data civil AAAA-MM-DD`, { field: campo });
  }
  return valor;
}

/** `date` volta como Date no `pg` e como texto no PGlite: aqui vira sempre texto civil. */
function textoDeData(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function instante(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/* -------------------------------------------------------------------------- */
/* instrumentos                                                                */
/* -------------------------------------------------------------------------- */

export const INSTRUMENT_STATUSES = ['active', 'in_calibration', 'out_of_service', 'retired'] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number];

export interface InstrumentInput {
  assetId: string;
  status?: InstrumentStatus;
  ownership?: 'own' | 'third_party';
  interface?: string | null;
  protocol?: string | null;
  firmwareVersion?: string | null;
  adapter?: string | null;
  lastValidatedOn?: string | null;
  knownLimitations?: string;
  notes?: string;
}

/**
 * Marca um ativo como instrumento de medição.
 *
 * O ativo já existe — com fabricante, modelo, série, local e ciclo de vida. O
 * instrumento é o PAPEL, com o que só instrumento tem.
 */
export async function registerInstrument(session: TenantSession, input: InstrumentInput): Promise<string> {
  const [ativo] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
    [input.assetId]
  );
  // Ativo de outra organização simplesmente não aparece (RLS): "não existe".
  if (!ativo) throw new NotFoundError('Ativo', input.assetId);

  const [ja] = await session.query(`SELECT 1 FROM aurora.instruments WHERE asset_id = $1`, [input.assetId]);
  if (ja) throw new ConflictError('este ativo já está cadastrado como instrumento');

  await session.query(
    `INSERT INTO aurora.instruments
       (asset_id, organization_id, status, ownership, interface, protocol, firmware_version, adapter,
        last_validated_on, known_limitations, notes, created_by)
     VALUES ($1, $2, $3::aurora.instrument_status, $4::aurora.instrument_ownership, $5, $6, $7, $8,
             $9, $10, $11, $12)`,
    [
      input.assetId,
      session.context.organizationId,
      input.status ?? 'active',
      input.ownership ?? 'own',
      input.interface ?? null,
      input.protocol ?? null,
      input.firmwareVersion ?? null,
      input.adapter ?? null,
      input.lastValidatedOn ? dataCivil(input.lastValidatedOn, 'last_validated_on') : null,
      input.knownLimitations ?? '',
      input.notes ?? '',
      session.context.actorId,
    ]
  );
  return input.assetId;
}

export async function updateInstrument(
  session: TenantSession,
  assetId: string,
  patch: Partial<Omit<InstrumentInput, 'assetId'>>
): Promise<void> {
  const rows = await session.query<{ asset_id: string }>(
    `UPDATE aurora.instruments
        SET status = COALESCE($2::aurora.instrument_status, status),
            ownership = COALESCE($3::aurora.instrument_ownership, ownership),
            interface = CASE WHEN $4::boolean THEN $5 ELSE interface END,
            protocol = CASE WHEN $6::boolean THEN $7 ELSE protocol END,
            firmware_version = CASE WHEN $8::boolean THEN $9 ELSE firmware_version END,
            adapter = CASE WHEN $10::boolean THEN $11 ELSE adapter END,
            last_validated_on = CASE WHEN $12::boolean THEN $13::date ELSE last_validated_on END,
            known_limitations = COALESCE($14, known_limitations),
            notes = COALESCE($15, notes),
            updated_by = $16
      WHERE asset_id = $1
      RETURNING asset_id`,
    [
      assetId,
      patch.status ?? null,
      patch.ownership ?? null,
      patch.interface !== undefined,
      patch.interface ?? null,
      patch.protocol !== undefined,
      patch.protocol ?? null,
      patch.firmwareVersion !== undefined,
      patch.firmwareVersion ?? null,
      patch.adapter !== undefined,
      patch.adapter ?? null,
      patch.lastValidatedOn !== undefined,
      patch.lastValidatedOn ? dataCivil(patch.lastValidatedOn, 'last_validated_on') : null,
      patch.knownLimitations ?? null,
      patch.notes ?? null,
      session.context.actorId,
    ]
  );
  if (rows.length === 0) throw new NotFoundError('Instrumento', assetId);
}

export interface InstrumentRow {
  asset_id: string;
  name: string;
  tag: string | null;
  serial_number: string | null;
  manufacturer_name: string | null;
  model_name: string | null;
  category_name: string | null;
  status: InstrumentStatus;
  ownership: 'own' | 'third_party';
  interface: string | null;
  protocol: string | null;
  firmware_version: string | null;
  adapter: string | null;
  last_validated_on: string | null;
  known_limitations: string;
  notes: string;
  /** O certificado não revogado que vence por último — o "vigente" do cadastro. */
  current_certificate: {
    id: string;
    certificate_number: string;
    laboratory: string;
    issued_on: string;
    valid_until: string;
  } | null;
}

/** Instrumentos da organização, com fabricante/modelo/série vindos do ATIVO. */
export async function listInstruments(
  session: TenantSession,
  filtro: { status?: InstrumentStatus; assetId?: string } = {}
): Promise<InstrumentRow[]> {
  const rows = await session.query<Record<string, unknown>>(
    `SELECT i.asset_id, a.name, a.tag, a.serial_number,
            mf.name AS manufacturer_name, am.name AS model_name, ac.name AS category_name,
            i.status::text AS status, i.ownership::text AS ownership, i.interface, i.protocol,
            i.firmware_version, i.adapter, i.last_validated_on::text AS last_validated_on, i.known_limitations, i.notes,
            c.id AS cert_id, c.certificate_number, c.laboratory, c.issued_on, c.valid_until
       FROM aurora.instruments i
       JOIN aurora.assets a ON a.id = i.asset_id
       LEFT JOIN aurora.asset_models am ON am.id = a.asset_model_id
       LEFT JOIN aurora.manufacturers mf ON mf.id = am.manufacturer_id
       LEFT JOIN aurora.asset_categories ac ON ac.id = a.asset_category_id
       LEFT JOIN LATERAL (
         SELECT id, certificate_number, laboratory, issued_on::text AS issued_on, valid_until::text AS valid_until
           FROM aurora.instrument_certificates
          WHERE instrument_id = i.asset_id AND revoked_at IS NULL
          ORDER BY valid_until DESC, issued_on DESC
          LIMIT 1
       ) c ON true
      WHERE ($1::text IS NULL OR i.status::text = $1)
        AND ($2::uuid IS NULL OR i.asset_id = $2)
      ORDER BY a.name`,
    [filtro.status ?? null, filtro.assetId ?? null]
  );
  return rows.map((r) => ({
    asset_id: r.asset_id as string,
    name: r.name as string,
    tag: (r.tag as string | null) ?? null,
    serial_number: (r.serial_number as string | null) ?? null,
    manufacturer_name: (r.manufacturer_name as string | null) ?? null,
    model_name: (r.model_name as string | null) ?? null,
    category_name: (r.category_name as string | null) ?? null,
    status: r.status as InstrumentStatus,
    ownership: r.ownership as 'own' | 'third_party',
    interface: (r.interface as string | null) ?? null,
    protocol: (r.protocol as string | null) ?? null,
    firmware_version: (r.firmware_version as string | null) ?? null,
    adapter: (r.adapter as string | null) ?? null,
    last_validated_on: textoDeData(r.last_validated_on),
    known_limitations: (r.known_limitations as string) ?? '',
    notes: (r.notes as string) ?? '',
    current_certificate: r.cert_id
      ? {
          id: r.cert_id as string,
          certificate_number: r.certificate_number as string,
          laboratory: r.laboratory as string,
          issued_on: textoDeData(r.issued_on)!,
          valid_until: textoDeData(r.valid_until)!,
        }
      : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* certificados externos                                                       */
/* -------------------------------------------------------------------------- */

export interface CertificateInput {
  instrumentId: string;
  certificateNumber: string;
  laboratory: string;
  issuedOn: string;
  validUntil: string;
  scope?: string;
  traceabilityStatement?: string;
  traceableToId?: string | null;
}

/**
 * Registra o certificado que um LABORATÓRIO emitiu para o instrumento.
 *
 * Não é documento nosso: não queima número, não passa por revisão, não é
 * assinado aqui. O arquivo entra como anexo `certificate` (com SHA-256), pela
 * mesma rota de envio retomável de sempre.
 */
export async function registerInstrumentCertificate(
  session: TenantSession,
  input: CertificateInput
): Promise<string> {
  const emitido = dataCivil(input.issuedOn, 'issued_on');
  const vence = dataCivil(input.validUntil, 'valid_until');
  if (vence < emitido) {
    throw new ValidationError('a validade não pode ser anterior à emissão', { field: 'valid_until' });
  }
  if (!input.certificateNumber?.trim()) {
    throw new ValidationError('informe o número do certificado', { field: 'certificate_number' });
  }
  if (!input.laboratory?.trim()) {
    throw new ValidationError('informe o laboratório que emitiu o certificado', { field: 'laboratory' });
  }

  const [inst] = await session.query(`SELECT 1 FROM aurora.instruments WHERE asset_id = $1`, [
    input.instrumentId,
  ]);
  if (!inst) throw new NotFoundError('Instrumento', input.instrumentId);

  if (input.traceableToId) {
    const [elo] = await session.query(
      `SELECT 1 FROM aurora.instrument_certificates WHERE id = $1 AND revoked_at IS NULL`,
      [input.traceableToId]
    );
    if (!elo) {
      throw new ValidationError('o certificado de rastreabilidade informado não existe ou foi revogado', {
        field: 'traceable_to_id',
      });
    }
  }

  const [ja] = await session.query(
    `SELECT 1 FROM aurora.instrument_certificates WHERE instrument_id = $1 AND certificate_number = $2`,
    [input.instrumentId, input.certificateNumber.trim()]
  );
  if (ja) throw new ConflictError('este número de certificado já está registrado para este instrumento');

  const id = newId();
  await session.query(
    `INSERT INTO aurora.instrument_certificates
       (id, organization_id, instrument_id, certificate_number, laboratory, issued_on, valid_until,
        scope, traceability_statement, traceable_to_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11)`,
    [
      id,
      session.context.organizationId,
      input.instrumentId,
      input.certificateNumber.trim(),
      input.laboratory.trim(),
      emitido,
      vence,
      input.scope ?? '',
      input.traceabilityStatement ?? '',
      input.traceableToId ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/** Revoga um certificado registrado errado. Não apaga: a sessão que o usou continua apontando. */
export async function revokeInstrumentCertificate(
  session: TenantSession,
  id: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim().length < 10) {
    throw new ValidationError('revogar exige motivo de ao menos 10 caracteres', { field: 'reason' });
  }
  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.instrument_certificates
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [id, reason.trim()]
  );
  if (rows.length === 0) {
    const [existe] = await session.query(`SELECT 1 FROM aurora.instrument_certificates WHERE id = $1`, [id]);
    if (!existe) throw new NotFoundError('Certificado', id);
    throw new ConflictError('este certificado já foi revogado');
  }
}

export interface CertificateRow {
  id: string;
  instrument_id: string;
  certificate_number: string;
  laboratory: string;
  issued_on: string;
  valid_until: string;
  scope: string;
  traceability_statement: string;
  traceable_to_id: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  files: Array<{ id: string; file_name: string; sha256: string | null; upload_completed: boolean }>;
}

export async function listInstrumentCertificates(
  session: TenantSession,
  instrumentId: string
): Promise<CertificateRow[]> {
  const [inst] = await session.query(`SELECT 1 FROM aurora.instruments WHERE asset_id = $1`, [instrumentId]);
  if (!inst) throw new NotFoundError('Instrumento', instrumentId);

  const rows = await session.query<Record<string, unknown>>(
    `SELECT c.id, c.instrument_id, c.certificate_number, c.laboratory, c.issued_on::text AS issued_on, c.valid_until::text AS valid_until,
            c.scope, c.traceability_statement, c.traceable_to_id, c.revoked_at, c.revoked_reason,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', at.id, 'file_name', at.file_name, 'sha256', at.sha256,
                        'upload_completed', at.upload_completed_at IS NOT NULL)
                      ORDER BY at.uploaded_at)
                 FROM aurora.attachments at WHERE at.instrument_certificate_id = c.id),
              '[]'::json) AS files
       FROM aurora.instrument_certificates c
      WHERE c.instrument_id = $1
      ORDER BY c.valid_until DESC, c.issued_on DESC`,
    [instrumentId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    instrument_id: r.instrument_id as string,
    certificate_number: r.certificate_number as string,
    laboratory: r.laboratory as string,
    issued_on: textoDeData(r.issued_on)!,
    valid_until: textoDeData(r.valid_until)!,
    scope: r.scope as string,
    traceability_statement: r.traceability_statement as string,
    traceable_to_id: (r.traceable_to_id as string | null) ?? null,
    revoked_at: instante(r.revoked_at),
    revoked_reason: (r.revoked_reason as string | null) ?? null,
    files: (typeof r.files === 'string' ? JSON.parse(r.files) : r.files) as CertificateRow['files'],
  }));
}

/** Registra o ARQUIVO do certificado (PDF/imagem), com resumo obrigatório. */
export async function attachCertificateFile(
  session: TenantSession,
  certificateId: string,
  file: { fileName: string; contentType: string; byteSize: number; sha256: string }
): Promise<{ id: string; storageKey: string }> {
  const [c] = await session.query(`SELECT 1 FROM aurora.instrument_certificates WHERE id = $1`, [
    certificateId,
  ]);
  if (!c) throw new NotFoundError('Certificado', certificateId);
  return attachFile(session, { instrumentCertificateId: certificateId, purpose: 'certificate', ...file });
}

/* -------------------------------------------------------------------------- */
/* sessão de medição                                                           */
/* -------------------------------------------------------------------------- */

export interface OpenSessionInput {
  responseId: string;
  /** Pode vir do aparelho, como o identificador da resposta: viabiliza o offline. */
  id?: string;
  instrumentId?: string | null;
  instrumentCertificateId?: string | null;
  technicianMembershipId?: string | null;
  measuredOn: string;
  ambient?: Record<string, unknown>;
  notes?: string;
}

/**
 * Abre a sessão de medição de uma resposta de checklist.
 *
 * Confere a PROVENIÊNCIA antes de gravar:
 *  · o instrumento existe nesta organização e está em operação;
 *  · se o protocolo exige instrumento por categoria, ele é de uma delas — e
 *    não pode faltar;
 *  · o certificado é do instrumento, não está revogado e COBRIA O DIA DA
 *    MEDIÇÃO (`certificadoCobreAMedicao`, a regra de calendário validada).
 *
 * Nada aqui compara leitura com tolerância.
 */
export async function openMeasurementSession(
  session: TenantSession,
  input: OpenSessionInput
): Promise<string> {
  const dia = dataCivil(input.measuredOn, 'measured_on');
  if (input.ambient !== undefined && (typeof input.ambient !== 'object' || Array.isArray(input.ambient))) {
    throw new ValidationError('as condições ambientais vão como um objeto chave → valor', {
      field: 'ambient',
    });
  }

  const [resp] = await session.query<{ template_id: string }>(
    `SELECT template_id FROM aurora.checklist_responses WHERE id = $1`,
    [input.responseId]
  );
  if (!resp) throw new NotFoundError('Resposta de checklist', input.responseId);

  const [ja] = await session.query(`SELECT 1 FROM aurora.measurement_sessions WHERE response_id = $1`, [
    input.responseId,
  ]);
  if (ja) throw new ConflictError('esta resposta já tem sessão de medição');

  const exigidas = await session.query<{ asset_category_id: string }>(
    `SELECT asset_category_id FROM aurora.checklist_template_instruments WHERE template_id = $1`,
    [resp.template_id]
  );

  if (input.instrumentId) {
    const [inst] = await session.query<{ status: string; asset_category_id: string }>(
      `SELECT i.status::text AS status, a.asset_category_id
         FROM aurora.instruments i JOIN aurora.assets a ON a.id = i.asset_id
        WHERE i.asset_id = $1`,
      [input.instrumentId]
    );
    if (!inst) throw new NotFoundError('Instrumento', input.instrumentId);
    if (inst.status !== 'active') {
      throw new ConflictError(`o instrumento está "${inst.status}" e não pode medir`);
    }
    if (exigidas.length > 0 && !exigidas.some((e) => e.asset_category_id === inst.asset_category_id)) {
      throw new ValidationError('o protocolo exige instrumento de outra categoria', {
        field: 'instrument_id',
      });
    }
  } else if (exigidas.length > 0) {
    throw new ValidationError('este protocolo exige instrumento: informe qual foi usado', {
      field: 'instrument_id',
    });
  }

  if (input.instrumentCertificateId) {
    if (!input.instrumentId) {
      throw new ValidationError('certificado sem instrumento não prova nada sobre a medição', {
        field: 'instrument_certificate_id',
      });
    }
    const [cert] = await session.query<{
      instrument_id: string;
      certificate_number: string;
      issued_on: unknown;
      valid_until: unknown;
      revoked_at: unknown;
    }>(
      `SELECT instrument_id, certificate_number, issued_on::text AS issued_on, valid_until::text AS valid_until, revoked_at
         FROM aurora.instrument_certificates WHERE id = $1`,
      [input.instrumentCertificateId]
    );
    if (!cert) throw new NotFoundError('Certificado', input.instrumentCertificateId);
    if (cert.instrument_id !== input.instrumentId) {
      throw new ValidationError('o certificado informado não é deste instrumento', {
        field: 'instrument_certificate_id',
      });
    }
    const cobre = certificadoCobreAMedicao(
      {
        nome: cert.certificate_number,
        emitidoEm: textoDeData(cert.issued_on)!,
        venceEm: textoDeData(cert.valid_until)!,
        revogado: cert.revoked_at !== null && cert.revoked_at !== undefined,
      },
      dia
    );
    if (!cobre) {
      throw new ConflictError(
        `o certificado ${cert.certificate_number} não cobria o dia ${dia} ` +
          `(vigência ${textoDeData(cert.issued_on)} a ${textoDeData(cert.valid_until)}${cert.revoked_at ? ', revogado' : ''})`
      );
    }
  }

  const id = input.id ?? newId();
  await session.query(
    `INSERT INTO aurora.measurement_sessions
       (id, organization_id, response_id, work_order_id, instrument_id, instrument_certificate_id,
        technician_membership_id, source, measured_on, ambient, notes, created_by)
     -- a OS (4ª coluna) é preenchida pelo gatilho a partir da resposta; o valor
     -- passado aqui é descartado de propósito — quem diz de quem é a medição é o banco.
     VALUES ($1, $2, $3, $3, $4, $5, $6, 'manual', $7::date, $8::jsonb, $9, $10)`,
    [
      id,
      session.context.organizationId,
      input.responseId,
      input.instrumentId ?? null,
      input.instrumentCertificateId ?? null,
      input.technicianMembershipId ?? session.context.membershipId ?? null,
      dia,
      JSON.stringify(input.ambient ?? {}),
      input.notes ?? '',
      session.context.actorId,
    ]
  );
  return id;
}

/** Encerra a sessão. Depois disso, leitura nova não entra. */
export async function finishMeasurementSession(session: TenantSession, id: string): Promise<void> {
  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.measurement_sessions SET finished_at = now()
      WHERE id = $1 AND finished_at IS NULL RETURNING id`,
    [id]
  );
  if (rows.length === 0) {
    const [existe] = await session.query(`SELECT 1 FROM aurora.measurement_sessions WHERE id = $1`, [id]);
    if (!existe) throw new NotFoundError('Sessão de medição', id);
    throw new ConflictError('a sessão de medição já foi encerrada');
  }
}

/**
 * Grava um ENVELOPE de medição — venha de que fonte vier.
 *
 * É o núcleo que o critério 4 do cliente pede: manual hoje, arquivo/gateway/
 * SDK amanhã, todos por aqui. O histórico (0047), a auditoria e a
 * idempotência de campo valem igual para qualquer origem.
 */
export async function registerMeasurement(
  session: TenantSession,
  envelope: EnvelopeDeMedicao
): Promise<{ verdict: string; answerId: string; revision: number }> {
  return answerChecklistItem(
    session,
    envelope.respostaId,
    envelope.itemId,
    { readings: envelope.leituras },
    {
      correctionReason: envelope.motivoDaCorrecao,
      provenance: {
        unit: envelope.unidade,
        source: envelope.origem,
        instrumentId: envelope.instrumentoId,
        deviceMeasuredAt: envelope.medidoEmNoAparelho,
      },
    }
  );
}

/** Dado bruto da sessão (CSV, JSON, PDF do aparelho…), com SHA-256 obrigatório. */
export async function attachRawData(
  session: TenantSession,
  sessionId: string,
  file: { fileName: string; contentType: string; byteSize: number; sha256: string }
): Promise<{ id: string; storageKey: string }> {
  const [s] = await session.query(`SELECT 1 FROM aurora.measurement_sessions WHERE id = $1`, [sessionId]);
  if (!s) throw new NotFoundError('Sessão de medição', sessionId);
  return attachFile(session, { measurementSessionId: sessionId, purpose: 'raw_data', ...file });
}

export interface MeasurementSessionDetail {
  id: string;
  response_id: string;
  work_order_id: string;
  work_order_number: string | null;
  asset_id: string | null;
  asset_name: string | null;
  source: string;
  measured_on: string;
  started_at: string;
  finished_at: string | null;
  ambient: Record<string, unknown>;
  notes: string;
  technician: { membership_id: string; name: string | null } | null;
  protocol: {
    template_id: string;
    key: string;
    version: number;
    title: string;
    procedure_kind: string | null;
    technical_manager_id: string | null;
    technical_manager_name: string | null;
    required_instrument_categories: Array<{ id: string; name: string }>;
  };
  instrument: {
    asset_id: string;
    name: string;
    tag: string | null;
    serial_number: string | null;
    manufacturer_name: string | null;
    model_name: string | null;
  } | null;
  certificate: {
    id: string;
    certificate_number: string;
    laboratory: string;
    issued_on: string;
    valid_until: string;
    traceability_statement: string;
    revoked: boolean;
  } | null;
  points: Array<{
    item_id: string;
    label: string;
    unit: string | null;
    nominal_value: number | null;
    tolerance_minus: number | null;
    tolerance_plus: number | null;
    tolerance_mode: string | null;
    readings_required: number | null;
    readings: number[] | null;
    answer_unit: string | null;
    source: string | null;
    instrument_id: string | null;
    revision: number | null;
    measured_at: string | null;
    device_measured_at: string | null;
    /** Sempre `na` para ponto de medição: não há critério validado (fronteira). */
    verdict: string | null;
  }>;
  raw_data: Array<{
    id: string;
    file_name: string;
    content_type: string;
    sha256: string | null;
    upload_completed: boolean;
  }>;
}

export async function measurementSessionDetail(
  session: TenantSession,
  id: string
): Promise<MeasurementSessionDetail> {
  const [s] = await session.query<Record<string, unknown>>(
    `SELECT ms.*, ms.source::text AS source_text, ms.measured_on::text AS measured_on_text,
            w.number AS work_order_number, a.name AS asset_name,
            u.name AS technician_name,
            r.template_id, t.key, t.version, t.title, t.procedure_kind::text AS procedure_kind,
            t.technical_manager_id, ru.name AS technical_manager_name
       FROM aurora.measurement_sessions ms
       JOIN aurora.checklist_responses r ON r.id = ms.response_id
       JOIN aurora.checklist_templates t ON t.id = r.template_id
       JOIN aurora.work_orders w ON w.id = ms.work_order_id
       LEFT JOIN aurora.assets a ON a.id = ms.asset_id
       LEFT JOIN aurora.memberships m ON m.id = ms.technician_membership_id
       LEFT JOIN aurora.users u ON u.id = m.user_id
       LEFT JOIN aurora.memberships rm ON rm.id = t.technical_manager_id
       LEFT JOIN aurora.users ru ON ru.id = rm.user_id
      WHERE ms.id = $1`,
    [id]
  );
  if (!s) throw new NotFoundError('Sessão de medição', id);

  const categorias = await session.query<{ id: string; name: string }>(
    `SELECT ac.id, ac.name FROM aurora.checklist_template_instruments ti
       JOIN aurora.asset_categories ac ON ac.id = ti.asset_category_id
      WHERE ti.template_id = $1 ORDER BY ac.name`,
    [s.template_id]
  );

  let instrument: MeasurementSessionDetail['instrument'] = null;
  if (s.instrument_id) {
    const [i] = await listInstruments(session, { assetId: s.instrument_id as string });
    if (i) {
      instrument = {
        asset_id: i.asset_id,
        name: i.name,
        tag: i.tag,
        serial_number: i.serial_number,
        manufacturer_name: i.manufacturer_name,
        model_name: i.model_name,
      };
    }
  }

  let certificate: MeasurementSessionDetail['certificate'] = null;
  if (s.instrument_certificate_id) {
    const [c] = await session.query<Record<string, unknown>>(
      `SELECT id, certificate_number, laboratory, issued_on::text AS issued_on, valid_until::text AS valid_until, traceability_statement, revoked_at
         FROM aurora.instrument_certificates WHERE id = $1`,
      [s.instrument_certificate_id]
    );
    if (c) {
      certificate = {
        id: c.id as string,
        certificate_number: c.certificate_number as string,
        laboratory: c.laboratory as string,
        issued_on: textoDeData(c.issued_on)!,
        valid_until: textoDeData(c.valid_until)!,
        traceability_statement: c.traceability_statement as string,
        revoked: c.revoked_at !== null && c.revoked_at !== undefined,
      };
    }
  }

  const itens = await loadChecklistItems(session, s.template_id as string);
  const respostas = await session.query<Record<string, unknown>>(
    `SELECT item_id, value_readings, unit, source::text AS source, instrument_id, revision,
            measured_at, device_measured_at, verdict::text AS verdict
       FROM aurora.checklist_answers WHERE response_id = $1`,
    [s.response_id]
  );
  const porItem = new Map(respostas.map((r) => [r.item_id as string, r]));

  const brutos = await session.query<Record<string, unknown>>(
    `SELECT id, file_name, content_type, sha256, upload_completed_at
       FROM aurora.attachments WHERE measurement_session_id = $1 ORDER BY uploaded_at`,
    [id]
  );

  return {
    id: s.id as string,
    response_id: s.response_id as string,
    work_order_id: s.work_order_id as string,
    work_order_number: (s.work_order_number as string | null) ?? null,
    asset_id: (s.asset_id as string | null) ?? null,
    asset_name: (s.asset_name as string | null) ?? null,
    source: s.source_text as string,
    measured_on: s.measured_on_text as string,
    started_at: instante(s.started_at)!,
    finished_at: instante(s.finished_at),
    ambient: (typeof s.ambient === 'string' ? JSON.parse(s.ambient) : s.ambient) as Record<string, unknown>,
    notes: (s.notes as string) ?? '',
    technician: s.technician_membership_id
      ? {
          membership_id: s.technician_membership_id as string,
          name: (s.technician_name as string | null) ?? null,
        }
      : null,
    protocol: {
      template_id: s.template_id as string,
      key: s.key as string,
      version: Number(s.version),
      title: s.title as string,
      procedure_kind: (s.procedure_kind as string | null) ?? null,
      technical_manager_id: (s.technical_manager_id as string | null) ?? null,
      technical_manager_name: (s.technical_manager_name as string | null) ?? null,
      required_instrument_categories: categorias,
    },
    instrument,
    certificate,
    points: itens
      .filter((i) => i.kind === 'measurement')
      .map((i) => {
        const r = porItem.get(i.id);
        const leituras = r?.value_readings as unknown[] | null | undefined;
        return {
          item_id: i.id,
          label: i.label,
          unit: i.unit ?? null,
          nominal_value: i.nominalValue ?? null,
          tolerance_minus: i.toleranceMinus ?? null,
          tolerance_plus: i.tolerancePlus ?? null,
          tolerance_mode: i.toleranceMode ?? null,
          readings_required: i.readingsRequired ?? null,
          // `numeric[]` volta como texto no `pg`: normalizado aqui, sem arredondar.
          readings: leituras ? leituras.map((v) => Number(v)) : null,
          answer_unit: (r?.unit as string | null) ?? null,
          source: (r?.source as string | null) ?? null,
          instrument_id: (r?.instrument_id as string | null) ?? null,
          revision: r ? Number(r.revision) : null,
          measured_at: r ? instante(r.measured_at) : null,
          device_measured_at: r ? instante(r.device_measured_at) : null,
          verdict: (r?.verdict as string | null) ?? null,
        };
      }),
    raw_data: brutos.map((b) => ({
      id: b.id as string,
      file_name: b.file_name as string,
      content_type: b.content_type as string,
      sha256: (b.sha256 as string | null) ?? null,
      upload_completed: b.upload_completed_at !== null && b.upload_completed_at !== undefined,
    })),
  };
}

/** As sessões de uma OS — a ficha da OS e o relatório perguntam isto. */
export async function measurementSessionsForWorkOrder(
  session: TenantSession,
  workOrderId: string
): Promise<Array<{ id: string; response_id: string; measured_on: string; finished_at: string | null }>> {
  const rows = await session.query<Record<string, unknown>>(
    `SELECT id, response_id, measured_on::text AS measured_on, finished_at FROM aurora.measurement_sessions
      WHERE work_order_id = $1 ORDER BY started_at`,
    [workOrderId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    response_id: r.response_id as string,
    measured_on: textoDeData(r.measured_on)!,
    finished_at: instante(r.finished_at),
  }));
}
