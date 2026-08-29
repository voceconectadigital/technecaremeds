/**
 * Aurora — execução: checklists, horas, anexos e assinaturas (EPIC-011).
 */
import { createHash } from 'node:crypto';
import {
  newId,
  computeVerdict,
  evaluateChecklist,
  validateAnswer,
  checkCompletion,
  ValidationError,
  NotFoundError,
  ConflictError,
  type ChecklistItem,
  type AnswerValue,
  type CompletionRequirement,
  type CompletionFacts,
} from '@aurora/domain';
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface ChecklistTemplateInput {
  key: string;
  title: string;
  description?: string;
}

/** Cria a versão 1 em rascunho. */
export async function createChecklistTemplate(
  session: TenantSession,
  input: ChecklistTemplateInput
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_templates (id, organization_id, key, version, title, description, created_by)
     VALUES ($1, $2, $3, 1, $4, $5, $6)`,
    [
      id,
      session.context.organizationId,
      input.key,
      input.title,
      input.description ?? '',
      session.context.actorId,
    ]
  );
  return id;
}

export interface ChecklistItemInput {
  templateId: string;
  kind: ChecklistItem['kind'];
  label: string;
  required?: boolean;
  position?: number;
  options?: readonly string[];
  failingOptions?: readonly string[];
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string | null;
  expectedBoolean?: boolean | null;
  minPhotos?: number | null;
  requiresPhotoWhen?: ChecklistItem['requiresPhotoWhen'];
  failAction?: ChecklistItem['failAction'];
  conditionItemId?: string | null;
  conditionEquals?: string | null;
}

export async function addChecklistItem(session: TenantSession, input: ChecklistItemInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_items
       (id, organization_id, template_id, kind, label, required, position, options, failing_options,
        min_value, max_value, unit, expected_boolean, min_photos, requires_photo_when, fail_action,
        condition_item_id, condition_equals)
     VALUES ($1, $2, $3, $4::aurora.checklist_item_kind, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15::aurora.photo_requirement, $16::aurora.fail_action, $17, $18)`,
    [
      id,
      session.context.organizationId,
      input.templateId,
      input.kind,
      input.label,
      input.required ?? true,
      input.position ?? 0,
      input.options ?? [],
      input.failingOptions ?? [],
      input.minValue ?? null,
      input.maxValue ?? null,
      input.unit ?? null,
      input.expectedBoolean ?? null,
      input.minPhotos ?? null,
      input.requiresPhotoWhen ?? 'never',
      input.failAction ?? 'none',
      input.conditionItemId ?? null,
      input.conditionEquals ?? null,
    ]
  );
  return id;
}

/**
 * Publica a versão em rascunho.
 *
 * A partir daqui a estrutura é imutável (gatilho da 0024). Publicar um checklist
 * sem item nenhum seria publicar um documento em branco que depois apareceria
 * como "checklist completo" em toda OS — recusado.
 */
export async function publishChecklist(session: TenantSession, templateId: string): Promise<void> {
  const [t] = await session.query<{ status: string; key: string }>(
    `SELECT status::text, key FROM aurora.checklist_templates WHERE id = $1`,
    [templateId]
  );
  if (!t) throw new NotFoundError('Checklist', templateId);
  if (t.status !== 'draft') {
    throw new ConflictError(
      `o checklist "${t.key}" já está ${t.status === 'published' ? 'publicado' : 'arquivado'}`
    );
  }
  const [c] = await session.query<{ c: number }>(
    `SELECT count(*)::int c FROM aurora.checklist_items WHERE template_id = $1`,
    [templateId]
  );
  if ((c?.c ?? 0) === 0) {
    throw new ValidationError('não se publica checklist sem nenhum item', { template: t.key });
  }

  await session.query(
    `UPDATE aurora.checklist_templates
        SET status = 'published', published_at = now(), published_by = $2, updated_by = $2
      WHERE id = $1`,
    [templateId, session.context.actorId]
  );
}

/**
 * Cria a próxima versão a partir de uma publicada, copiando a estrutura.
 *
 * É o único caminho para mudar um checklist em uso. A cópia é feita no banco,
 * numa instrução por tabela: trazer os itens para a aplicação e reinseri-los um
 * a um seria mais lento e daria margem a copiar pela metade.
 */
export async function createNextVersion(session: TenantSession, templateId: string): Promise<string> {
  const [atual] = await session.query<{ key: string; version: number; title: string; description: string }>(
    `SELECT key, version, title, description FROM aurora.checklist_templates WHERE id = $1`,
    [templateId]
  );
  if (!atual) throw new NotFoundError('Checklist', templateId);

  const [maior] = await session.query<{ v: number }>(
    `SELECT max(version) AS v FROM aurora.checklist_templates WHERE key = $1`,
    [atual.key]
  );
  const novaVersao = Number(maior?.v ?? atual.version) + 1;

  const novoId = newId();
  await session.query(
    `INSERT INTO aurora.checklist_templates
       (id, organization_id, key, version, title, description, status, supersedes_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)`,
    [
      novoId,
      session.context.organizationId,
      atual.key,
      novaVersao,
      atual.title,
      atual.description,
      templateId,
      session.context.actorId,
    ]
  );

  // A cópia mantém a ordem e as regras; a condição entre itens é reapontada
  // para o item correspondente da nova versão, casando pela posição.
  await session.query(
    `INSERT INTO aurora.checklist_items
       (id, organization_id, template_id, kind, label, help_text, required, position, options,
        failing_options, min_value, max_value, unit, expected_boolean, min_selections, max_selections,
        min_photos, requires_photo_when, fail_action)
     SELECT gen_random_uuid(), organization_id, $2, kind, label, help_text, required, position, options,
            failing_options, min_value, max_value, unit, expected_boolean, min_selections, max_selections,
            min_photos, requires_photo_when, fail_action
       FROM aurora.checklist_items WHERE template_id = $1`,
    [templateId, novoId]
  );

  return novoId;
}

export async function loadChecklistItems(
  session: TenantSession,
  templateId: string
): Promise<ChecklistItem[]> {
  const rows = await session.query<Record<string, unknown>>(
    `SELECT id, kind::text AS kind, label, required, options, failing_options,
            min_value, max_value, unit, expected_boolean, min_selections, max_selections, min_photos,
            requires_photo_when::text AS requires_photo_when, fail_action::text AS fail_action,
            condition_item_id, condition_equals
       FROM aurora.checklist_items WHERE template_id = $1 ORDER BY position, label`,
    [templateId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as ChecklistItem['kind'],
    label: r.label as string,
    required: r.required as boolean,
    options: r.options as string[],
    failingOptions: r.failing_options as string[],
    // `numeric` volta como string do driver: converter aqui evita comparar
    // string com número e concluir que 9 está fora da faixa [10, 20].
    minValue: r.min_value === null ? null : Number(r.min_value),
    maxValue: r.max_value === null ? null : Number(r.max_value),
    unit: r.unit as string | null,
    expectedBoolean: r.expected_boolean as boolean | null,
    minSelections: r.min_selections === null ? null : Number(r.min_selections),
    maxSelections: r.max_selections === null ? null : Number(r.max_selections),
    minPhotos: r.min_photos === null ? null : Number(r.min_photos),
    requiresPhotoWhen: r.requires_photo_when as ChecklistItem['requiresPhotoWhen'],
    failAction: r.fail_action as ChecklistItem['failAction'],
    conditionItemId: r.condition_item_id as string | null,
    conditionEquals: r.condition_equals as string | null,
  }));
}

/* -------------------------------------------------------------------------- */
/* respostas                                                                   */
/* -------------------------------------------------------------------------- */

/** Anexa um checklist publicado a uma OS. */
export async function attachChecklist(
  session: TenantSession,
  workOrderId: string,
  templateId: string
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_responses
       (id, organization_id, work_order_id, template_id, template_key, template_version)
     VALUES ($1, $2, $3, $4, '', 0)`,
    [id, session.context.organizationId, workOrderId, templateId]
  );
  return id;
}

/**
 * Registra a resposta de um item, com veredito calculado.
 *
 * O veredito vem do domínio e não de quem chamou: deixar o cliente enviar
 * `verdict` permitiria marcar como aprovado um valor fora da faixa, que é
 * exatamente o que o motor existe para impedir.
 */
export async function answerChecklistItem(
  session: TenantSession,
  responseId: string,
  itemId: string,
  value: AnswerValue
): Promise<{ verdict: string }> {
  const [item] = await session.query<Record<string, unknown>>(
    `SELECT id, kind::text AS kind, label, required, options, failing_options,
            min_value, max_value, expected_boolean, min_selections, max_selections, min_photos,
            requires_photo_when::text AS requires_photo_when, fail_action::text AS fail_action
       FROM aurora.checklist_items WHERE id = $1`,
    [itemId]
  );
  if (!item) throw new NotFoundError('Item de checklist', itemId);

  const definicao: ChecklistItem = {
    id: item.id as string,
    kind: item.kind as ChecklistItem['kind'],
    label: item.label as string,
    required: item.required as boolean,
    options: item.options as string[],
    failingOptions: item.failing_options as string[],
    minValue: item.min_value === null ? null : Number(item.min_value),
    maxValue: item.max_value === null ? null : Number(item.max_value),
    expectedBoolean: item.expected_boolean as boolean | null,
    minSelections: item.min_selections === null ? null : Number(item.min_selections),
    maxSelections: item.max_selections === null ? null : Number(item.max_selections),
    minPhotos: item.min_photos === null ? null : Number(item.min_photos),
    requiresPhotoWhen: item.requires_photo_when as ChecklistItem['requiresPhotoWhen'],
    failAction: item.fail_action as ChecklistItem['failAction'],
  };

  const problemas = validateAnswer(definicao, value);
  if (problemas.length > 0) {
    throw new ValidationError(problemas.map((p) => `${p.label}: ${p.message}`).join('; '), {
      issues: problemas,
    });
  }

  const verdict = computeVerdict(definicao, value);
  await session.query(
    `INSERT INTO aurora.checklist_answers
       (id, organization_id, response_id, item_id, value_text, value_number, value_boolean,
        value_options, value_date, verdict, photo_count, measured_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::aurora.checklist_verdict, $11, $12)
     ON CONFLICT (response_id, item_id) DO UPDATE
        SET value_text = EXCLUDED.value_text,
            value_number = EXCLUDED.value_number,
            value_boolean = EXCLUDED.value_boolean,
            value_options = EXCLUDED.value_options,
            value_date = EXCLUDED.value_date,
            verdict = EXCLUDED.verdict,
            photo_count = EXCLUDED.photo_count,
            measured_by = EXCLUDED.measured_by,
            measured_at = now()`,
    [
      newId(),
      session.context.organizationId,
      responseId,
      itemId,
      value.text ?? null,
      value.number ?? null,
      value.boolean ?? null,
      value.options ?? null,
      value.date ?? null,
      verdict,
      value.photoCount ?? 0,
      session.context.actorId,
    ]
  );
  return { verdict };
}

/** Estado do checklist de uma OS: completude e consequências. */
export async function checklistStatus(session: TenantSession, responseId: string) {
  const [resp] = await session.query<{ template_id: string }>(
    `SELECT template_id FROM aurora.checklist_responses WHERE id = $1`,
    [responseId]
  );
  if (!resp) throw new NotFoundError('Resposta de checklist', responseId);

  const items = await loadChecklistItems(session, resp.template_id);
  const rows = await session.query<Record<string, unknown>>(
    `SELECT item_id, value_text, value_number, value_boolean, value_options, value_date, photo_count
       FROM aurora.checklist_answers WHERE response_id = $1`,
    [responseId]
  );
  const answers: Record<string, AnswerValue> = {};
  for (const r of rows) {
    answers[r.item_id as string] = {
      text: r.value_text as string | null,
      number: r.value_number === null ? null : Number(r.value_number),
      boolean: r.value_boolean as boolean | null,
      options: r.value_options as string[] | null,
      date: r.value_date as string | null,
      photoCount: Number(r.photo_count ?? 0),
    };
  }
  return evaluateChecklist(items, answers);
}

/* -------------------------------------------------------------------------- */
/* horas                                                                       */
/* -------------------------------------------------------------------------- */

export async function startTimer(
  session: TenantSession,
  workOrderId: string,
  opts: { hourlyCost?: number | null } = {}
): Promise<string> {
  if (!session.context.membershipId) {
    throw new ValidationError('apontar hora exige um vínculo com a organização', { field: 'membership' });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.time_entries
       (id, organization_id, work_order_id, membership_id, started_at, source, hourly_cost, created_by)
     VALUES ($1, $2, $3, $4, now(), 'timer', $5, $6)`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      session.context.membershipId,
      opts.hourlyCost ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

export async function stopTimer(session: TenantSession, entryId: string, note?: string): Promise<number> {
  const rows = await session.query<{ minutes: number }>(
    `UPDATE aurora.time_entries
        SET ended_at = now(), note = coalesce($2, note)
      WHERE id = $1 AND ended_at IS NULL
      RETURNING (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::int AS minutes`,
    [entryId, note ?? null]
  );
  if (rows.length === 0) {
    throw new ConflictError('não há cronômetro aberto com este identificador');
  }
  return rows[0]!.minutes;
}

export async function logTime(
  session: TenantSession,
  input: {
    workOrderId: string;
    membershipId?: string;
    startedAt: Date;
    endedAt: Date;
    note?: string;
    hourlyCost?: number | null;
  }
): Promise<string> {
  const membership = input.membershipId ?? session.context.membershipId;
  if (!membership) {
    throw new ValidationError('apontar hora exige identificar a pessoa', { field: 'membership_id' });
  }
  if (input.endedAt <= input.startedAt) {
    throw new ValidationError('o fim do apontamento precisa ser depois do início', { field: 'ended_at' });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.time_entries
       (id, organization_id, work_order_id, membership_id, started_at, ended_at, source, note, hourly_cost, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      input.workOrderId,
      membership,
      input.startedAt.toISOString(),
      input.endedAt.toISOString(),
      input.note ?? null,
      input.hourlyCost ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/* -------------------------------------------------------------------------- */
/* anexos e assinatura                                                         */
/* -------------------------------------------------------------------------- */

export async function attachFile(
  session: TenantSession,
  input: {
    workOrderId?: string | null;
    checklistAnswerId?: string | null;
    purpose: 'before' | 'after' | 'evidence' | 'document' | 'signature' | 'other';
    storageKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    sha256?: string | null;
  }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.attachments
       (id, organization_id, work_order_id, checklist_answer_id, purpose, storage_key,
        file_name, content_type, byte_size, sha256, uploaded_by)
     VALUES ($1, $2, $3, $4, $5::aurora.attachment_purpose, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      session.context.organizationId,
      input.workOrderId ?? null,
      input.checklistAnswerId ?? null,
      input.purpose,
      input.storageKey,
      input.fileName,
      input.contentType,
      input.byteSize,
      input.sha256 ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Resumo criptográfico do que está sendo assinado.
 *
 * Campos escolhidos e ordenados de forma estável: o que o cliente vê e assina —
 * número, título, resolução, quem executou, quando. Incluir o registro inteiro
 * faria qualquer alteração de campo irrelevante invalidar a assinatura; incluir
 * de menos faria a assinatura não provar nada.
 */
export function signatureDigest(input: {
  number: string | null;
  title: string;
  resolution: string | null;
  completedAt: string | null;
  assetName: string | null;
  locationName: string | null;
}): string {
  const canonico = [
    input.number ?? '',
    input.title,
    input.resolution ?? '',
    input.completedAt ?? '',
    input.assetName ?? '',
    input.locationName ?? '',
  ].join('');
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

export async function signWorkOrder(
  session: TenantSession,
  workOrderId: string,
  input: {
    signerRole: 'technician' | 'customer' | 'supervisor';
    signerName: string;
    method: 'drawn' | 'email_code';
    signerEmail?: string | null;
    signerDocument?: string | null;
    attachmentId?: string | null;
  }
): Promise<{ id: string; digest: string }> {
  const [os] = await session.query<{
    number: string | null;
    title: string;
    resolution: string | null;
    completed_at: string | null;
    asset_name_snapshot: string | null;
    location_name_snapshot: string | null;
  }>(
    `SELECT number, title, resolution, completed_at, asset_name_snapshot, location_name_snapshot
       FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('Ordem de serviço', workOrderId);

  const digest = signatureDigest({
    number: os.number,
    title: os.title,
    resolution: os.resolution,
    completedAt: os.completed_at,
    assetName: os.asset_name_snapshot,
    locationName: os.location_name_snapshot,
  });

  const id = newId();
  await session.query(
    `INSERT INTO aurora.signatures
       (id, organization_id, work_order_id, signer_role, signer_name, signer_document, signer_email,
        method, signed_content_sha256, attachment_id, client_ip, user_agent)
     VALUES ($1, $2, $3, $4::aurora.signer_role, $5, $6, $7, $8::aurora.signature_method, $9, $10, $11, $12)`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      input.signerRole,
      input.signerName,
      input.signerDocument ?? null,
      input.signerEmail ?? null,
      input.method,
      digest,
      input.attachmentId ?? null,
      session.context.clientIp,
      session.context.userAgent,
    ]
  );
  return { id, digest };
}

/**
 * A assinatura ainda corresponde ao que está registrado?
 *
 * Devolve `false` quando a OS mudou depois de assinada. Não impede a mudança —
 * impedir seria congelar a OS na primeira assinatura, e há motivos legítimos
 * para editar depois. O que o produto deve fazer é **saber e mostrar** que a
 * assinatura já não cobre o texto atual.
 */
export async function verifySignatures(
  session: TenantSession,
  workOrderId: string
): Promise<Array<{ id: string; signer_name: string; signed_at: string; still_valid: boolean }>> {
  const [os] = await session.query<{
    number: string | null;
    title: string;
    resolution: string | null;
    completed_at: string | null;
    asset_name_snapshot: string | null;
    location_name_snapshot: string | null;
  }>(
    `SELECT number, title, resolution, completed_at, asset_name_snapshot, location_name_snapshot
       FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('Ordem de serviço', workOrderId);

  const atual = signatureDigest({
    number: os.number,
    title: os.title,
    resolution: os.resolution,
    completedAt: os.completed_at,
    assetName: os.asset_name_snapshot,
    locationName: os.location_name_snapshot,
  });

  const assinaturas = await session.query<{
    id: string;
    signer_name: string;
    signed_at: string;
    signed_content_sha256: string;
  }>(
    `SELECT id, signer_name, signed_at, signed_content_sha256
       FROM aurora.signatures WHERE work_order_id = $1 ORDER BY signed_at`,
    [workOrderId]
  );

  return assinaturas.map((a) => ({
    id: a.id,
    signer_name: a.signer_name,
    signed_at: a.signed_at,
    still_valid: a.signed_content_sha256 === atual,
  }));
}

/* -------------------------------------------------------------------------- */
/* bloco de conclusão                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Verifica os requisitos de conclusão contra os fatos reais da OS.
 *
 * Aqui o motor do EPIC-008 (`checkCompletion`) finalmente recebe fatos de
 * verdade: checklist respondido, horas apontadas, fotos anexadas, assinatura
 * colhida. Até o EPIC-011 ele existia testado e sem fonte de dados.
 */
export async function completionCheck(
  session: TenantSession,
  workOrderId: string,
  required: readonly CompletionRequirement[],
  /**
   * Valores que estão sendo informados NESTA operação e ainda não gravados.
   * Sem isso, concluir enviando a resolução junto seria recusado por falta da
   * resolução que a própria chamada trazia.
   */
  pending: { resolution?: string | null } = {}
) {
  const [fatos] = await session.query<Record<string, unknown>>(
    `SELECT * FROM aurora.work_order_completion_facts($1)`,
    [workOrderId]
  );
  if (!fatos) throw new NotFoundError('Ordem de serviço', workOrderId);

  const [os] = await session.query<{ resolution: string | null; cause_failure_code_id: string | null }>(
    `SELECT resolution, cause_failure_code_id FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );

  const facts: CompletionFacts = {
    checklistTotal: Number(fatos.checklist_total ?? 0),
    checklistAnswered: Number(fatos.checklist_answered ?? 0),
    failedItemsWithoutPhoto: Number(fatos.failed_items_without_photo ?? 0),
    loggedMinutes: Number(fatos.logged_minutes ?? 0),
    resolution: pending.resolution ?? os?.resolution ?? null,
    causeFailureCodeId: os?.cause_failure_code_id ?? null,
    photosBefore: Number(fatos.photos_before ?? 0),
    photosAfter: Number(fatos.photos_after ?? 0),
    hasCustomerSignature: Boolean(fatos.has_customer_signature),
    // Peças entram no EPIC-015; até lá não há pendência de consumo a verificar.
    partsPending: 0,
  };

  const resultado = checkCompletion(required, facts);
  const bloqueios = Number(fatos.blocking_failures ?? 0);
  if (bloqueios > 0) {
    return {
      ok: false,
      missing: [
        ...resultado.missing,
        {
          requirement: 'checklist_complete' as CompletionRequirement,
          label: 'item reprovado que bloqueia a conclusão',
          detail: `${bloqueios} item(ns) reprovado(s) com ação de bloqueio`,
        },
      ],
    };
  }
  return resultado;
}

/**
 * Requisitos de conclusão configurados para a natureza desta OS.
 *
 * Sem configuração, a lista é vazia e o bloco não exige nada — o produto não
 * impõe burocracia a quem não a pediu. Ligar um requisito é uma decisão da
 * organização, e ela a toma na tela de naturezas.
 */
export async function completionRequirementsFor(
  session: TenantSession,
  workOrderId: string
): Promise<CompletionRequirement[]> {
  const rows = await session.query<{ completion_requirements: string[] }>(
    `SELECT s.completion_requirements
       FROM aurora.work_orders w
       JOIN aurora.work_order_type_settings s ON s.work_order_type_id = w.work_order_type_id
      WHERE w.id = $1`,
    [workOrderId]
  );
  return (rows[0]?.completion_requirements ?? []) as CompletionRequirement[];
}

/** Configura os requisitos de uma natureza de OS. */
export async function setCompletionRequirements(
  session: TenantSession,
  workOrderTypeId: string,
  requirements: readonly CompletionRequirement[],
  opts: { requiresAsset?: boolean; causesAssetDowntime?: boolean } = {}
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.work_order_type_settings
       (organization_id, work_order_type_id, completion_requirements, requires_asset, causes_asset_downtime)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (work_order_type_id) DO UPDATE
        SET completion_requirements = EXCLUDED.completion_requirements,
            requires_asset = EXCLUDED.requires_asset,
            causes_asset_downtime = EXCLUDED.causes_asset_downtime`,
    [
      session.context.organizationId,
      workOrderTypeId,
      requirements,
      opts.requiresAsset ?? false,
      opts.causesAssetDowntime ?? true,
    ]
  );
}
