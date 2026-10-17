/**
 * Aurora — motor de documentos na camada de dados (SPEC v0.2 §18 · EPIC-018).
 */
import {
  newId,
  DOCUMENT_TYPES,
  canTransitionDocument,
  allowedDocumentTransitions,
  formatDocumentNumber,
  contentHash,
  signatureBlockers,
  checkIssue,
  validUntilFor,
  expiryThreshold,
  ValidationError,
  NotFoundError,
  ConflictError,
  type DocumentStatus,
  type DocumentVerdict,
  type DocumentTypeDefinition,
  type SignatureMethod,
  type CustomFieldDefinition,
  padroesQueImpedemEmissao,
  furosNaRastreabilidade,
  instantaneoIntegro,
  SESSION_SNAPSHOT_KEY,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

/* -------------------------------------------------------------------------- */
/* provisionamento                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cria os tipos de documento de fábrica e a série de cada um.
 *
 * Todos os seis são provisionados, não só o do MVP: a tabela é configuração, e
 * ter o tipo cadastrado sem uso custa uma linha — enquanto descobrir na Fase 2
 * que o motor não comporta o tipo custaria o épico inteiro de novo. O que NÃO é
 * provisionado é o payload especializado de cada um, que depende de norma que a
 * auditoria não confirmou.
 */
export async function provisionDocumentTypes(session: TenantSession): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const tipo of DOCUMENT_TYPES) {
    const [existente] = await session.query<{ id: string }>(
      `SELECT id FROM aurora.document_types WHERE key = $1`,
      [tipo.key]
    );

    let id = existente?.id;
    if (!id) {
      id = newId();
      await session.query(
        `INSERT INTO aurora.document_types
           (id, organization_id, key, label, series, default_validity_days,
            requires_technical_manager, requires_signature, payload_fields, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          id,
          session.context.organizationId,
          tipo.key,
          tipo.label,
          tipo.series,
          tipo.defaultValidityDays,
          tipo.requiresTechnicalManager,
          tipo.requiresSignature,
          JSON.stringify(tipo.payloadFields),
          session.context.actorId,
        ]
      );

      await session.query(
        `INSERT INTO aurora.number_series
           (id, organization_id, document_type_id, prefix, digits, include_year, reset_yearly)
         VALUES ($1, $2, $3, $4, 6, true, true)`,
        [newId(), session.context.organizationId, id, tipo.series]
      );
    }

    ids.set(tipo.key, id);
  }

  return ids;
}

interface TypeRow {
  id: string;
  key: string;
  label: string;
  series: string;
  default_validity_days: number | null;
  requires_technical_manager: boolean;
  requires_signature: boolean;
  payload_fields: CustomFieldDefinition[];
}

async function loadType(session: TenantSession, id: string): Promise<TypeRow> {
  const [row] = await session.query<TypeRow>(
    `SELECT id, key, label, series, default_validity_days,
            requires_technical_manager, requires_signature, payload_fields
       FROM aurora.document_types WHERE id = $1`,
    [id]
  );
  if (!row) throw new NotFoundError('tipo de documento não encontrado');
  return row;
}

function asDefinition(row: TypeRow): DocumentTypeDefinition {
  return {
    key: row.key as DocumentTypeDefinition['key'],
    label: row.label,
    series: row.series,
    defaultValidityDays: row.default_validity_days,
    requiresTechnicalManager: row.requires_technical_manager,
    requiresSignature: row.requires_signature,
    payloadFields: row.payload_fields ?? [],
    phase: 'MVP',
  };
}

/* -------------------------------------------------------------------------- */
/* documento                                                                   */
/* -------------------------------------------------------------------------- */

export interface DocumentInput {
  documentTypeId: string;
  title?: string | null;
  assetId?: string | null;
  workOrderId?: string | null;
  customerId?: string | null;
  technicalManagerId?: string | null;
  payload?: Record<string, unknown>;
  verdict?: DocumentVerdict | null;
  /** A sessão de medição de onde o conteúdo foi copiado (0054). */
  measurementSessionId?: string | null;
}

export async function createDocument(session: TenantSession, input: DocumentInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.documents
       (id, organization_id, document_type_id, title, asset_id, work_order_id, customer_id,
        technical_manager_id, payload, verdict, created_by, measurement_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::aurora.document_verdict, $11, $12)`,
    [
      id,
      session.context.organizationId,
      input.documentTypeId,
      input.title ?? null,
      input.assetId ?? null,
      input.workOrderId ?? null,
      input.customerId ?? null,
      input.technicalManagerId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.verdict ?? null,
      session.context.actorId,
      input.measurementSessionId ?? null,
    ]
  );
  return id;
}

export interface DocumentRow {
  id: string;
  document_type_id: string;
  number: string | null;
  version: number;
  status: DocumentStatus;
  payload: Record<string, unknown>;
  verdict: DocumentVerdict | null;
  content_hash: string | null;
  technical_manager_id: string | null;
  asset_id: string | null;
  work_order_id: string | null;
  customer_id: string | null;
  valid_until: Date | null;
  issued_at: Date | null;
  measurement_session_id: string | null;
}

export async function loadDocument(session: TenantSession, id: string): Promise<DocumentRow> {
  const [row] = await session.query<DocumentRow>(
    `SELECT id, document_type_id, number, version, status, payload, verdict, content_hash,
            technical_manager_id, asset_id, work_order_id, customer_id, valid_until, issued_at,
            measurement_session_id
       FROM aurora.documents WHERE id = $1`,
    [id]
  );
  if (!row) throw new NotFoundError('documento não encontrado');
  return row;
}

/**
 * Atualiza o conteúdo do rascunho.
 *
 * O guarda do banco recusa a alteração de documento já assinado. Aqui a recusa
 * acontece antes, com mensagem que diz o caminho — mas as duas existem: a da
 * aplicação é para o operador entender, e a do banco é para nenhum caminho
 * futuro escapar.
 */
export async function updateDocumentContent(
  session: TenantSession,
  id: string,
  patch: { payload?: Record<string, unknown>; verdict?: DocumentVerdict | null; title?: string | null }
): Promise<void> {
  const doc = await loadDocument(session, id);
  if (doc.status !== 'draft' && doc.status !== 'under_review') {
    throw new ConflictError(
      `documento ${doc.number ?? doc.id} está em "${doc.status}": o conteúdo não se altera, emita uma versão nova`
    );
  }

  await session.query(
    `UPDATE aurora.documents
        SET payload = COALESCE($2::jsonb, payload),
            verdict = COALESCE($3::aurora.document_verdict, verdict),
            title = COALESCE($4, title),
            updated_by = $5
      WHERE id = $1`,
    [
      id,
      patch.payload === undefined ? null : JSON.stringify(patch.payload),
      patch.verdict ?? null,
      patch.title ?? null,
      session.context.actorId,
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* consolidação                                                                */
/* -------------------------------------------------------------------------- */

/**
 * O resumo do conteúdo de um documento.
 *
 * Cobre a IDENTIDADE além do conteúdo — o `id`, a versão e o tipo entram no
 * resumo junto com o payload. Sem isso, dois documentos com o mesmo conteúdo
 * teriam o mesmo hash, e a assinatura de um serviria para o outro.
 *
 * O NÚMERO não entra, e isso é deliberado: o número só existe na emissão,
 * enquanto o conteúdo é assinado ANTES dela. Incluí-lo obrigaria a recalcular o
 * hash ao emitir, o que invalidaria toda assinatura já coletada. O `id` já
 * identifica o documento de forma única e é estável desde a criação.
 */
function hashOf(doc: DocumentRow, typeKey: string): string {
  return contentHash({
    id: doc.id,
    version: doc.version,
    type: typeKey,
    verdict: doc.verdict,
    payload: doc.payload,
    assetId: doc.asset_id,
    workOrderId: doc.work_order_id,
  });
}

/**
 * Congela o conteúdo ao entrar em revisão.
 *
 * O hash nasce AQUI, e não na emissão, porque um tipo que exige assinatura
 * precisa ser assinado antes de emitir — e assinar exige um conteúdo
 * consolidado para prometer. Calcular o hash só na emissão criava um impasse:
 * o certificado de calibração jamais poderia ser emitido, porque não podia ser
 * assinado antes e não podia ser assinado depois.
 *
 * "Em revisão" passa a significar exatamente isto: candidato congelado. Voltar
 * para rascunho desfaz o congelamento — e só é permitido enquanto ninguém tiver
 * assinado.
 */
async function consolidateContent(session: TenantSession, id: string): Promise<string> {
  const doc = await loadDocument(session, id);
  const tipo = await loadType(session, doc.document_type_id);
  const hash = hashOf(doc, tipo.key);

  await session.query(`UPDATE aurora.documents SET content_hash = $2 WHERE id = $1`, [id, hash]);
  return hash;
}

/* -------------------------------------------------------------------------- */
/* emissão                                                                     */
/* -------------------------------------------------------------------------- */

export interface IssueCheck {
  ok: boolean;
  blockers: string[];
}

/** O que falta para emitir — a pergunta que a tela faz antes de tentar. */
export async function documentIssueCheck(session: TenantSession, id: string): Promise<IssueCheck> {
  const doc = await loadDocument(session, id);
  const tipo = await loadType(session, doc.document_type_id);

  const [assinaturas] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.document_signatures WHERE document_id = $1`,
    [id]
  );

  // O instantâneo da sessão é proveniência COPIADA, não campo do tipo: a
  // validação de `payload_fields` olha só o resto (0054).
  const camposDoTipo = doc.measurement_session_id ? semInstantaneo(doc.payload) : doc.payload;

  const r = checkIssue({
    type: asDefinition(tipo),
    payload: camposDoTipo,
    technicalManagerId: doc.technical_manager_id,
    verdict: doc.verdict,
    signatureCount: Number(assinaturas!.total),
  });

  const daSessao = doc.measurement_session_id
    ? await bloqueiosDaSessao(session, doc.measurement_session_id, tipo.key, doc.payload)
    : [];

  return {
    ok: r.ok && daSessao.length === 0,
    blockers: [...r.blockers, ...r.payloadIssues.map((i) => `${i.key}: ${i.message}`), ...daSessao],
  };
}

function semInstantaneo(payload: Record<string, unknown>): Record<string, unknown> {
  const { [SESSION_SNAPSHOT_KEY]: _instantaneo, ...resto } = payload;
  return resto;
}

/**
 * O que a SESSÃO de onde o documento saiu impede (0054).
 *
 * Só a fronteira de calendário já validada (US-DOC-002) e conferências de
 * preenchimento — nenhuma regra científica:
 *  · o certificado do instrumento cobria o dia da medição? (padrão vencido
 *    antes da medição impede; vencido DEPOIS, não);
 *  · certificado de calibração sem padrão declarado quebra a rastreabilidade;
 *  · o conteúdo ainda diz de qual sessão veio;
 *  · a sessão foi encerrada (documento de sessão aberta copiaria metade).
 */
async function bloqueiosDaSessao(
  session: TenantSession,
  sessionId: string,
  typeKey: string,
  payload: Record<string, unknown>
): Promise<string[]> {
  const [s] = await session.query<{
    measured_on: unknown;
    finished_at: unknown;
    certificate_number: string | null;
    laboratory: string | null;
    valid_until: unknown;
    instrument_name: string | null;
  }>(
    `SELECT ms.measured_on::text AS measured_on, ms.finished_at, c.certificate_number, c.laboratory,
            c.valid_until::text AS valid_until,
            a.name AS instrument_name
       FROM aurora.measurement_sessions ms
       LEFT JOIN aurora.instrument_certificates c ON c.id = ms.instrument_certificate_id
       LEFT JOIN aurora.assets a ON a.id = ms.instrument_id
      WHERE ms.id = $1`,
    [sessionId]
  );
  if (!s) return ['a sessão de medição de origem não está acessível'];

  const civil = (v: unknown): string => {
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    return String(v).slice(0, 10);
  };

  const faltas: string[] = [];
  if (!s.finished_at) faltas.push('a sessão de medição de origem ainda não foi encerrada');
  if (!instantaneoIntegro(payload, sessionId)) {
    faltas.push('o conteúdo perdeu o vínculo com a sessão de medição de onde foi copiado');
  }

  const padroes = s.certificate_number
    ? [
        {
          nome: s.instrument_name ?? 'instrumento da sessão',
          numeroDoCertificado: s.certificate_number,
          laboratorio: s.laboratory ?? '',
          venceEm: civil(s.valid_until),
        },
      ]
    : [];
  for (const p of padroesQueImpedemEmissao(padroes, civil(s.measured_on))) faltas.push(p.motivo);
  if (typeKey === 'calibration_certificate') faltas.push(...furosNaRastreabilidade(padroes));
  return faltas;
}

/**
 * Aloca o número da série do tipo — com a trava do banco.
 *
 * A série por cliente vence a da organização quando existe: um contrato que
 * exige numeração própria a exige para todo documento daquele cliente, e
 * escolher a série "mais específica" é a mesma regra de especificidade usada na
 * cobertura de contrato.
 */
async function allocateNumber(
  session: TenantSession,
  documentTypeId: string,
  customerId: string | null,
  year: number
): Promise<string> {
  const [serie] = await session.query<{
    id: string;
    prefix: string;
    suffix: string | null;
    digits: number;
    include_year: boolean;
  }>(
    `SELECT id, prefix, suffix, digits, include_year
       FROM aurora.number_series
      WHERE document_type_id = $1 AND active
        AND (customer_id = $2 OR customer_id IS NULL)
      ORDER BY customer_id NULLS LAST
      LIMIT 1`,
    [documentTypeId, customerId]
  );
  if (!serie) throw new ConflictError('não há série de numeração ativa para este tipo');

  const [row] = await session.query<{ seq: string }>(
    `SELECT aurora.allocate_document_number($1, $2)::text AS seq`,
    [serie.id, year]
  );

  return formatDocumentNumber(
    {
      prefix: serie.prefix,
      suffix: serie.suffix ?? undefined,
      digits: Number(serie.digits),
      includeYear: serie.include_year,
    },
    Number(row!.seq),
    year
  );
}

/**
 * Emite o documento: queima o número, congela o conteúdo e calcula o hash.
 *
 * A ordem importa. O hash é calculado sobre o payload NO INSTANTE da emissão e
 * gravado junto; a partir daí o guarda do banco impede que o conteúdo mude
 * enquanto houver assinatura. Calcular o hash depois, na hora de assinar,
 * deixaria uma janela em que o documento emitido ainda podia ser editado — e
 * "emitido" perderia o sentido.
 */
export async function issueDocument(session: TenantSession, id: string): Promise<string> {
  const doc = await loadDocument(session, id);
  if (doc.status !== 'under_review') {
    throw new ConflictError(`só se emite documento em revisão; este está em "${doc.status}"`);
  }

  const check = await documentIssueCheck(session, id);
  if (!check.ok) {
    throw new ValidationError(`não é possível emitir: ${check.blockers.join('; ')}`);
  }

  const tipo = await loadType(session, doc.document_type_id);

  // O hash NÃO é recalculado aqui: ele foi congelado na entrada em revisão e
  // pode já ter sido assinado. O que se faz é CONFERIR que o conteúdo de hoje
  // ainda é o congelado — se algum caminho o alterou, emitir seria carimbar um
  // documento diferente do que foi revisado e assinado.
  if (doc.content_hash === null) {
    throw new ConflictError('documento sem conteúdo consolidado: envie para revisão antes de emitir');
  }
  if (hashOf(doc, tipo.key) !== doc.content_hash) {
    throw new ConflictError('o conteúdo mudou depois da revisão: devolva para ajuste e revise de novo');
  }

  const agora = new Date();
  const numero = await allocateNumber(session, doc.document_type_id, doc.customer_id, agora.getUTCFullYear());

  await session.query(
    `UPDATE aurora.documents
        SET status = 'issued', number = $2, issued_at = $3, issued_by = $4,
            valid_until = $5, updated_by = $4
      WHERE id = $1`,
    [id, numero, agora, session.context.actorId, validUntilFor(asDefinition(tipo), agora)]
  );

  await emitEvent(session, {
    type: 'document.issued',
    aggregateId: id,
    payload: { number: numero, documentType: tipo.key, verdict: doc.verdict },
  });

  return numero;
}

/* -------------------------------------------------------------------------- */
/* transições                                                                  */
/* -------------------------------------------------------------------------- */

export interface DocumentTransitionOptions {
  reason?: string;
  supersededById?: string;
}

export async function transitionDocument(
  session: TenantSession,
  id: string,
  to: DocumentStatus,
  options: DocumentTransitionOptions = {}
): Promise<void> {
  const doc = await loadDocument(session, id);

  if (to === 'issued') {
    await issueDocument(session, id);
    return;
  }

  const transicao = canTransitionDocument(doc.status, to);
  if (!transicao) {
    const possiveis = allowedDocumentTransitions(doc.status);
    const lista =
      possiveis.length === 0
        ? 'nenhuma — esta é uma situação final'
        : possiveis.map((t) => `${t.to} (${t.label})`).join(', ');
    throw new ConflictError(
      `documento ${doc.number ?? doc.id} está em "${doc.status}" e não pode ir para "${to}". Possíveis: ${lista}`
    );
  }

  if (to === 'under_review') {
    await consolidateContent(session, id);
  }

  if (to === 'draft') {
    const [assinaturas] = await session.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM aurora.document_signatures WHERE document_id = $1`,
      [id]
    );
    if (Number(assinaturas!.total) > 0) {
      throw new ConflictError('documento já assinado não volta para rascunho: o caminho é uma versão nova');
    }
    await session.query(`UPDATE aurora.documents SET content_hash = NULL WHERE id = $1`, [id]);
  }

  if (to === 'cancelled') {
    if (!options.reason || options.reason.trim().length < 10) {
      throw new ValidationError(
        'cancelar documento exige motivo de ao menos 10 caracteres: o número fica queimado e alguém vai perguntar por quê',
        { field: 'reason' }
      );
    }
  }

  await session.query(
    `UPDATE aurora.documents
        SET status = $2::aurora.document_status,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
            cancellation_reason = COALESCE($3, cancellation_reason),
            released_to_customer_at = CASE WHEN $2 = 'released' THEN now() ELSE released_to_customer_at END,
            released_by = CASE WHEN $2 = 'released' THEN $4 ELSE released_by END,
            updated_by = $4
      WHERE id = $1`,
    [id, to, options.reason?.trim() ?? null, session.context.actorId]
  );

  const eventos: Partial<
    Record<
      DocumentStatus,
      'document.released' | 'document.cancelled' | 'document.superseded' | 'document.expired'
    >
  > = {
    released: 'document.released',
    cancelled: 'document.cancelled',
    superseded: 'document.superseded',
    expired: 'document.expired',
  };
  const tipo = eventos[to];
  if (tipo) {
    await emitEvent(session, {
      type: tipo,
      aggregateId: id,
      payload: { number: doc.number, reason: options.reason?.trim() ?? null },
    });
  }
}

/**
 * Cria a versão seguinte e supera a anterior.
 *
 * O número NOVO é alocado na emissão da nova versão, e o antigo permanece com o
 * documento antigo: o §18 pede que o superado continue acessível, e mantê-lo
 * com o número que circulou é o que permite alguém procurar pelo papel que tem
 * em mãos e encontrar o que de fato recebeu.
 */
export async function superseDocument(session: TenantSession, id: string): Promise<string> {
  const doc = await loadDocument(session, id);
  if (doc.status === 'superseded') {
    throw new ConflictError('este documento já foi substituído');
  }
  if (doc.status === 'draft' || doc.status === 'under_review') {
    throw new ConflictError('documento ainda não emitido se edita, não se substitui');
  }

  const novo = newId();
  await session.query(
    `INSERT INTO aurora.documents
       (id, organization_id, document_type_id, version, supersedes_id, title,
        asset_id, work_order_id, customer_id, technical_manager_id, payload, verdict, created_by,
        measurement_session_id)
     SELECT $1, organization_id, document_type_id, version + 1, id, title,
            asset_id, work_order_id, customer_id, technical_manager_id, payload, verdict, $2,
            measurement_session_id
       FROM aurora.documents WHERE id = $3`,
    [novo, session.context.actorId, id]
  );

  await transitionDocument(session, id, 'superseded');
  return novo;
}

/* -------------------------------------------------------------------------- */
/* assinatura                                                                  */
/* -------------------------------------------------------------------------- */

export interface SignInput {
  documentId: string;
  signerName: string;
  signerRole: string;
  method: SignatureMethod;
  signerDocument?: string | null;
  signerEmail?: string | null;
  attachmentId?: string | null;
  portalUserId?: string | null;
  certificateSubject?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

/**
 * Registra a assinatura.
 *
 * O hash NÃO vem daqui: o gatilho do banco o copia do documento. Aceitar o
 * resumo de quem assina permitiria assinar um conteúdo e gravar o resumo de
 * outro, que é exatamente a fraude que o hash existe para impedir.
 */
export async function signDocument(session: TenantSession, input: SignInput): Promise<string> {
  const faltas = signatureBlockers({
    method: input.method,
    signerName: input.signerName,
    signerDocument: input.signerDocument,
    signerEmail: input.signerEmail,
    attachmentId: input.attachmentId,
    portalUserId: input.portalUserId,
    certificateSubject: input.certificateSubject,
  });
  if (faltas.length > 0) {
    throw new ValidationError(`não é possível assinar: ${faltas.join('; ')}`);
  }

  const id = newId();
  await session.query(
    `INSERT INTO aurora.document_signatures
       (id, organization_id, document_id, signer_name, signer_role, signer_document, signer_email,
        method, signed_content_hash, attachment_id, portal_user_id, certificate_subject,
        client_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::aurora.document_signature_method,
             repeat('0', 64), $9, $10, $11, $12, $13)`,
    [
      id,
      session.context.organizationId,
      input.documentId,
      input.signerName.trim(),
      input.signerRole,
      input.signerDocument ?? null,
      input.signerEmail ?? null,
      input.method,
      input.attachmentId ?? null,
      input.portalUserId ?? null,
      input.certificateSubject ?? null,
      input.clientIp ?? null,
      input.userAgent ?? null,
    ]
  );

  await emitEvent(session, {
    type: 'document.signed',
    aggregateId: input.documentId,
    payload: { signerName: input.signerName.trim(), method: input.method },
  });

  return id;
}

export interface SignatureCheck {
  signatureId: string;
  signerName: string;
  signedAt: Date;
  method: SignatureMethod;
  /** O conteúdo de hoje ainda é o que foi assinado? */
  valid: boolean;
}

/**
 * Confere as assinaturas contra o conteúdo atual.
 *
 * Existe apesar de o banco impedir a edição de documento assinado — porque o
 * impedimento vale para o futuro, e esta verificação vale para o presente: se
 * algum dia um caminho escapar, é aqui que aparece, em vez de nunca.
 */
export async function verifyDocumentSignatures(
  session: TenantSession,
  documentId: string
): Promise<SignatureCheck[]> {
  const doc = await loadDocument(session, documentId);
  const assinaturas = await session.query<{
    id: string;
    signer_name: string;
    signed_at: Date;
    method: SignatureMethod;
    signed_content_hash: string;
  }>(
    `SELECT id, signer_name, signed_at, method::text AS method, signed_content_hash
       FROM aurora.document_signatures WHERE document_id = $1 ORDER BY signed_at`,
    [documentId]
  );

  return assinaturas.map((a) => ({
    signatureId: a.id,
    signerName: a.signer_name,
    signedAt: new Date(a.signed_at),
    method: a.method,
    valid: doc.content_hash !== null && a.signed_content_hash === doc.content_hash,
  }));
}

/* -------------------------------------------------------------------------- */
/* varredura de vencimento                                                     */
/* -------------------------------------------------------------------------- */

export interface ExpiryAlert {
  documentId: string;
  number: string | null;
  threshold: number | null;
  expired: boolean;
}

/**
 * Avisa os que estão para vencer e carimba os vencidos.
 *
 * O marco avisado fica gravado no documento, e não deduzido do histórico de
 * eventos: um documento é lido muitas vezes e avisado poucas, e uma consulta ao
 * outbox por documento em toda varredura custaria caro para responder sempre a
 * mesma coisa.
 */
export async function sweepDocumentExpiry(
  session: TenantSession,
  now: Date = new Date()
): Promise<ExpiryAlert[]> {
  const docs = await session.query<{
    id: string;
    number: string | null;
    valid_until: Date;
    expiry_notified_threshold: number | null;
  }>(
    `SELECT id, number, valid_until, expiry_notified_threshold
       FROM aurora.documents
      WHERE status IN ('issued', 'released') AND valid_until IS NOT NULL`
  );

  const alertas: ExpiryAlert[] = [];

  for (const d of docs) {
    const validade = new Date(d.valid_until);

    if (validade.getTime() < now.getTime()) {
      await session.query(`UPDATE aurora.documents SET status = 'expired' WHERE id = $1`, [d.id]);
      await emitEvent(session, {
        type: 'document.expired',
        aggregateId: d.id,
        payload: { number: d.number },
      });
      alertas.push({ documentId: d.id, number: d.number, threshold: null, expired: true });
      continue;
    }

    const marco = expiryThreshold(validade, now);
    if (marco === null) continue;
    if (d.expiry_notified_threshold !== null && marco >= d.expiry_notified_threshold) continue;

    await session.query(`UPDATE aurora.documents SET expiry_notified_threshold = $2 WHERE id = $1`, [
      d.id,
      marco,
    ]);
    await emitEvent(session, {
      type: 'document.expiring',
      aggregateId: d.id,
      payload: { number: d.number, threshold: marco },
    });
    alertas.push({ documentId: d.id, number: d.number, threshold: marco, expired: false });
  }

  return alertas;
}

/* -------------------------------------------------------------------------- */
/* leitura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Os documentos de um ativo — a pergunta que a ficha do ativo faz (§07).
 *
 * `escopoDe` é o vínculo RESTRITO de quem pergunta (nulo para quem enxerga
 * tudo): o ativo e o documento precisam estar no cliente e no local dele —
 * sem cliente no documento, não passa (pente-fino 17/10, regra do ScopeGuard).
 */
export async function documentsForAsset(
  session: TenantSession,
  assetId: string,
  escopoDe: string | null = null
): Promise<unknown[]> {
  return session.query(
    `SELECT d.id, d.number, d.version, d.status, d.verdict, d.issued_at, d.valid_until,
            t.key AS type_key, t.label AS type_label
       FROM aurora.documents d
       JOIN aurora.document_types t ON t.id = d.document_type_id
       LEFT JOIN aurora.assets a ON a.id = d.asset_id
      WHERE d.asset_id = $1
        AND ($2::uuid IS NULL OR (
              d.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
          AND (a.location_id IS NULL
               OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))))
      ORDER BY d.issued_at DESC NULLS LAST, d.created_at DESC`,
    [assetId, escopoDe]
  );
}

/* -------------------------------------------------------------------------- */
/* PDF (gap V2 P2.8)                                                           */
/* -------------------------------------------------------------------------- */

export interface DocumentPdfRow {
  id: string;
  organization_name: string;
  type_label: string;
  number: string | null;
  version: number;
  status: string;
  title: string | null;
  verdict: string | null;
  issued_at: string | null;
  valid_until: string | null;
  asset_name: string | null;
  work_order_number: string | null;
  technical_manager_name: string | null;
  content_hash: string | null;
  payload: Record<string, unknown>;
  signatures: Array<{ signer_name: string; method: string; signed_at: string; valid: boolean }>;
}

const isoOuNulo = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * Tudo o que o PDF imprime, numa leitura — sob a RLS do contexto.
 *
 * `portalMembershipId` restringe ao que o PORTAL pode ver: liberado ao cliente,
 * não cancelado, do cliente e dos locais do escopo daquele vínculo. Fora disso
 * a resposta é "não existe", igual à lista do portal.
 */
export async function documentForPdf(
  session: TenantSession,
  id: string,
  opts: { portalMembershipId?: string } = {}
): Promise<DocumentPdfRow> {
  const portal = opts.portalMembershipId ?? null;
  const [d] = await session.query<Record<string, unknown>>(
    `SELECT d.id, o.name AS organization_name, dt.label AS type_label, d.number, d.version,
            d.status::text AS status, d.title, d.verdict::text AS verdict, d.issued_at, d.valid_until,
            a.name AS asset_name, w.number AS work_order_number, u.name AS technical_manager_name,
            d.content_hash, d.payload
       FROM aurora.documents d
       JOIN aurora.organizations o ON o.id = d.organization_id
       JOIN aurora.document_types dt ON dt.id = d.document_type_id
       LEFT JOIN aurora.assets a ON a.id = d.asset_id
       LEFT JOIN aurora.work_orders w ON w.id = d.work_order_id
       LEFT JOIN aurora.memberships m ON m.id = d.technical_manager_id
       LEFT JOIN aurora.users u ON u.id = m.user_id
      WHERE d.id = $1
        AND ($2::uuid IS NULL OR (
              d.released_to_customer_at IS NOT NULL
          AND d.cancelled_at IS NULL
          AND d.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
          AND (d.asset_id IS NULL OR a.location_id IS NULL
               OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))))`,
    [id, portal]
  );
  if (!d) throw new NotFoundError('documento não encontrado');

  const assinaturas = await verifyDocumentSignatures(session, id);
  return {
    id: d.id as string,
    organization_name: d.organization_name as string,
    type_label: d.type_label as string,
    number: (d.number as string | null) ?? null,
    version: Number(d.version),
    status: d.status as string,
    title: (d.title as string | null) ?? null,
    verdict: (d.verdict as string | null) ?? null,
    issued_at: isoOuNulo(d.issued_at),
    valid_until: isoOuNulo(d.valid_until),
    asset_name: (d.asset_name as string | null) ?? null,
    work_order_number: (d.work_order_number as string | null) ?? null,
    technical_manager_name: (d.technical_manager_name as string | null) ?? null,
    content_hash: (d.content_hash as string | null) ?? null,
    payload: (typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload) as Record<string, unknown>,
    signatures: assinaturas.map((s) => ({
      signer_name: s.signerName,
      method: s.method,
      signed_at: s.signedAt.toISOString(),
      valid: s.valid,
    })),
  };
}
