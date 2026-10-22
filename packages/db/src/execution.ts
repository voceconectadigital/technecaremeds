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
  ForbiddenError,
  type ChecklistItem,
  type AnswerValue,
  type CompletionRequirement,
  type CompletionFacts,
  validateAttachment,
  buildStorageKey,
  MAX_ATTACHMENTS_PER_ENTITY,
  type AttachmentPurpose,
  type MeasurementSource,
  PURPOSES_REQUIRING_SHA256,
  executionRestrictedToAssignment,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { pendingPartsCount } from './inventory';

/* -------------------------------------------------------------------------- */
/* templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface ChecklistTemplateInput {
  key: string;
  title: string;
  description?: string;
  /**
   * Tipo de procedimento metrológico (0052). Nulo para o checklist operacional
   * de sempre — que continua sendo o caso comum.
   */
  procedureKind?: 'calibration' | 'electrical_safety' | 'qualification' | 'acceptance' | null;
  /** Responsável técnico pelo protocolo (vínculo da organização). */
  technicalManagerId?: string | null;
}

/** Cria a versão 1 em rascunho. */
export async function createChecklistTemplate(
  session: TenantSession,
  input: ChecklistTemplateInput
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_templates
       (id, organization_id, key, version, title, description, created_by, procedure_kind, technical_manager_id)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7::aurora.procedure_kind, $8)`,
    [
      id,
      session.context.organizationId,
      input.key,
      input.title,
      input.description ?? '',
      session.context.actorId,
      input.procedureKind ?? null,
      input.technicalManagerId ?? null,
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
  /** Ponto de medição (0052): tudo DADO declarado pelo procedimento, nada calculado. */
  nominalValue?: number | null;
  toleranceMinus?: number | null;
  tolerancePlus?: number | null;
  toleranceMode?: 'absolute' | 'percent' | null;
  readingsRequired?: number | null;
}

export async function addChecklistItem(session: TenantSession, input: ChecklistItemInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_items
       (id, organization_id, template_id, kind, label, required, position, options, failing_options,
        min_value, max_value, unit, expected_boolean, min_photos, requires_photo_when, fail_action,
        condition_item_id, condition_equals,
        nominal_value, tolerance_minus, tolerance_plus, tolerance_mode, readings_required)
     VALUES ($1, $2, $3, $4::aurora.checklist_item_kind, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15::aurora.photo_requirement, $16::aurora.fail_action, $17, $18,
             $19, $20, $21, $22, $23)`,
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
      input.nominalValue ?? null,
      input.toleranceMinus ?? null,
      input.tolerancePlus ?? null,
      input.toleranceMode ?? null,
      input.kind === 'measurement' ? (input.readingsRequired ?? 1) : (input.readingsRequired ?? null),
    ]
  );
  return id;
}

/** Instrumento exigido pelo protocolo, por categoria de ativo (0052). */
export async function requireInstrumentCategory(
  session: TenantSession,
  templateId: string,
  assetCategoryId: string,
  note = ''
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_template_instruments (id, organization_id, template_id, asset_category_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, session.context.organizationId, templateId, assetCategoryId, note]
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
  const [atual] = await session.query<{
    key: string;
    version: number;
    title: string;
    description: string;
    procedure_kind: string | null;
    technical_manager_id: string | null;
  }>(
    `SELECT key, version, title, description, procedure_kind::text AS procedure_kind, technical_manager_id
       FROM aurora.checklist_templates WHERE id = $1`,
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
       (id, organization_id, key, version, title, description, status, supersedes_id, created_by,
        procedure_kind, technical_manager_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9::aurora.procedure_kind, $10)`,
    [
      novoId,
      session.context.organizationId,
      atual.key,
      novaVersao,
      atual.title,
      atual.description,
      templateId,
      session.context.actorId,
      atual.procedure_kind,
      atual.technical_manager_id,
    ]
  );

  // A cópia mantém a ordem e as regras; a condição entre itens é reapontada
  // para o item correspondente da nova versão, casando pela posição.
  await session.query(
    `INSERT INTO aurora.checklist_items
       (id, organization_id, template_id, kind, label, help_text, required, position, options,
        failing_options, min_value, max_value, unit, expected_boolean, min_selections, max_selections,
        min_photos, requires_photo_when, fail_action,
        nominal_value, tolerance_minus, tolerance_plus, tolerance_mode, readings_required)
     SELECT gen_random_uuid(), organization_id, $2, kind, label, help_text, required, position, options,
            failing_options, min_value, max_value, unit, expected_boolean, min_selections, max_selections,
            min_photos, requires_photo_when, fail_action,
            nominal_value, tolerance_minus, tolerance_plus, tolerance_mode, readings_required
       FROM aurora.checklist_items WHERE template_id = $1`,
    [templateId, novoId]
  );

  // Os instrumentos exigidos são estrutura do protocolo: vão junto para a versão nova.
  await session.query(
    `INSERT INTO aurora.checklist_template_instruments (id, organization_id, template_id, asset_category_id, note)
     SELECT gen_random_uuid(), organization_id, $2, asset_category_id, note
       FROM aurora.checklist_template_instruments WHERE template_id = $1`,
    [templateId, novoId]
  );

  return novoId;
}

export async function loadChecklistItems(
  session: TenantSession,
  templateId: string
): Promise<ChecklistItem[]> {
  const rows = await session.query<Record<string, unknown>>(
    `SELECT ${COLUNAS_DO_ITEM}
       FROM aurora.checklist_items WHERE template_id = $1 ORDER BY position, label`,
    [templateId]
  );
  return rows.map(linhaParaItem);
}

/** As colunas que descrevem um item — uma lista só, para leitura e resposta não divergirem. */
const COLUNAS_DO_ITEM = `id, kind::text AS kind, label, required, options, failing_options,
            min_value, max_value, unit, expected_boolean, min_selections, max_selections, min_photos,
            requires_photo_when::text AS requires_photo_when, fail_action::text AS fail_action,
            condition_item_id, condition_equals,
            nominal_value, tolerance_minus, tolerance_plus, tolerance_mode, readings_required`;

const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function linhaParaItem(r: Record<string, unknown>): ChecklistItem {
  return {
    id: r.id as string,
    kind: r.kind as ChecklistItem['kind'],
    label: r.label as string,
    required: r.required as boolean,
    options: r.options as string[],
    failingOptions: r.failing_options as string[],
    // `numeric` volta como string do driver: converter aqui evita comparar
    // string com número e concluir que 9 está fora da faixa [10, 20].
    minValue: numeroOuNulo(r.min_value),
    maxValue: numeroOuNulo(r.max_value),
    unit: r.unit as string | null,
    expectedBoolean: r.expected_boolean as boolean | null,
    minSelections: numeroOuNulo(r.min_selections),
    maxSelections: numeroOuNulo(r.max_selections),
    minPhotos: numeroOuNulo(r.min_photos),
    requiresPhotoWhen: r.requires_photo_when as ChecklistItem['requiresPhotoWhen'],
    failAction: r.fail_action as ChecklistItem['failAction'],
    conditionItemId: r.condition_item_id as string | null,
    conditionEquals: r.condition_equals as string | null,
    nominalValue: numeroOuNulo(r.nominal_value),
    toleranceMinus: numeroOuNulo(r.tolerance_minus),
    tolerancePlus: numeroOuNulo(r.tolerance_plus),
    toleranceMode: (r.tolerance_mode as ChecklistItem['toleranceMode']) ?? null,
    readingsRequired: numeroOuNulo(r.readings_required),
  };
}

/* -------------------------------------------------------------------------- */
/* respostas                                                                   */
/* -------------------------------------------------------------------------- */

/** Anexa um checklist publicado a uma OS. */
/**
 * Anexa um checklist a uma OS.
 *
 * O IDENTIFICADOR PODE VIR DO APARELHO, e essa possibilidade é o que torna o
 * checklist offline viável.
 *
 * Responder um item exige o identificador da resposta. Se ele nascesse só aqui,
 * o técnico teria de estar online para ANEXAR antes de poder responder — e
 * anexar é a primeira coisa que ele faz ao chegar no equipamento, que é
 * exatamente onde não há rede.
 *
 * Com o identificador vindo do aparelho, as respostas entram na fila junto com
 * o anexo, na ordem certa, e sobem juntas quando o sinal voltar. Não é o cliente
 * "inventando" dado: é o mesmo desenho do `client_operation_id` — um UUID
 * gerado na origem, cuja unicidade o banco garante.
 *
 * A NUMERAÇÃO CONTINUA SENDO DO SERVIDOR (§20). Isto aqui é chave técnica, e
 * não número que alguém lê.
 */
export async function attachChecklist(
  session: TenantSession,
  workOrderId: string,
  templateId: string,
  responseId?: string
): Promise<string> {
  const id = responseId ?? newId();
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
  value: AnswerValue,
  opts: {
    correctionReason?: string | null;
    /** Proveniência do ponto de medição — só para itens `measurement` (0053). */
    provenance?: MeasurementProvenance;
  } = {}
): Promise<{ verdict: string; answerId: string; revision: number }> {
  /*
   * OS VALIDADA, FECHADA OU CANCELADA NÃO TEM CHECKLIST REABERTO POR AQUI.
   *
   * A resposta é a evidência do que foi feito; mudá-la depois da validação
   * reescreveria o que o gestor aprovou (e o laudo que saiu dele). Quem tem
   * `work_order.edit_closed` ainda corrige — e, nesse caso, o motivo da
   * correção deixa de ser opcional: correção depois do fechamento sem motivo é
   * exatamente o rastro que a 0047 existe para não perder.
   */
  const [osDaResposta] = await session.query<{ category: string }>(
    `SELECT w.status_category::text AS category
       FROM aurora.checklist_responses r
       JOIN aurora.work_orders w ON w.id = r.work_order_id
      WHERE r.id = $1`,
    [responseId]
  );
  if (osDaResposta && ['done', 'closed', 'cancelled'].includes(osDaResposta.category)) {
    if (!session.context.permissions.has('work_order.edit_closed')) {
      throw new ConflictError(
        'a OS já foi validada, fechada ou cancelada: as respostas do checklist não mudam mais',
        { category: osDaResposta.category }
      );
    }
    if (!opts.correctionReason?.trim()) {
      throw new ValidationError('corrigir checklist de OS validada, fechada ou cancelada exige o motivo', {
        field: 'correction_reason',
      });
    }
  }

  const [item] = await session.query<Record<string, unknown>>(
    `SELECT ${COLUNAS_DO_ITEM} FROM aurora.checklist_items WHERE id = $1`,
    [itemId]
  );
  if (!item) throw new NotFoundError('Item de checklist', itemId);
  const definicao = linhaParaItem(item);

  const medicao = await provenienciaDoPonto(session, responseId, definicao, value, opts.provenance);

  const problemas = validateAnswer(definicao, value);
  if (problemas.length > 0) {
    throw new ValidationError(problemas.map((p) => `${p.label}: ${p.message}`).join('; '), {
      issues: problemas,
    });
  }

  const verdict = computeVerdict(definicao, value);

  /*
   * RESPONDER DE NOVO É CORRIGIR, E CORRIGIR NÃO APAGA (0047).
   *
   * O `DO UPDATE` continua aqui por compatibilidade com o fluxo de campo — a
   * fila reenvia, o técnico corrige —, mas deixou de ser sobrescrita: o
   * gatilho `checklist_answers_revision` arquiva a versão anterior inteira no
   * histórico, na mesma instrução, e conta a revisão. O `WHERE` evita o
   * trabalho quando o valor reenviado é o mesmo: eco não é correção.
   */
  const [linha] = await session.query<{ id: string; revision: number }>(
    `INSERT INTO aurora.checklist_answers
       (id, organization_id, response_id, item_id, value_text, value_number, value_boolean,
        value_options, value_date, verdict, photo_count, measured_by, correction_reason,
        value_readings, unit, source, instrument_id, device_measured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::aurora.checklist_verdict, $11, $12, NULL,
             $14::numeric[], $15, $16::aurora.measurement_source, $17, $18)
     ON CONFLICT (response_id, item_id) DO UPDATE
        SET value_text = EXCLUDED.value_text,
            value_number = EXCLUDED.value_number,
            value_boolean = EXCLUDED.value_boolean,
            value_options = EXCLUDED.value_options,
            value_date = EXCLUDED.value_date,
            value_readings = EXCLUDED.value_readings,
            unit = EXCLUDED.unit,
            source = EXCLUDED.source,
            instrument_id = EXCLUDED.instrument_id,
            device_measured_at = EXCLUDED.device_measured_at,
            verdict = EXCLUDED.verdict,
            photo_count = EXCLUDED.photo_count,
            measured_by = EXCLUDED.measured_by,
            measured_at = now(),
            correction_reason = $13
      WHERE (aurora.checklist_answers.value_text, aurora.checklist_answers.value_number,
             aurora.checklist_answers.value_boolean, aurora.checklist_answers.value_options,
             aurora.checklist_answers.value_date, aurora.checklist_answers.photo_count,
             aurora.checklist_answers.value_readings, aurora.checklist_answers.instrument_id,
             aurora.checklist_answers.unit, aurora.checklist_answers.source)
            IS DISTINCT FROM
            (EXCLUDED.value_text, EXCLUDED.value_number, EXCLUDED.value_boolean,
             EXCLUDED.value_options, EXCLUDED.value_date, EXCLUDED.photo_count,
             EXCLUDED.value_readings, EXCLUDED.instrument_id, EXCLUDED.unit, EXCLUDED.source)
     RETURNING id, revision`,
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
      opts.correctionReason?.trim() || null,
      medicao?.readings ?? null,
      medicao?.unit ?? null,
      medicao?.source ?? null,
      medicao?.instrumentId ?? null,
      medicao?.deviceMeasuredAt ?? null,
    ]
  );

  // Valor idêntico ao vigente: nada foi gravado, e a resposta vigente é a que vale.
  const vigente =
    linha ??
    (
      await session.query<{ id: string; revision: number }>(
        `SELECT id, revision FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2`,
        [responseId, itemId]
      )
    )[0]!;
  return { verdict, answerId: vigente.id, revision: Number(vigente.revision) };
}

export interface MeasurementProvenance {
  /** A unidade em que a fonte entregou as leituras. Precisa ser a do protocolo. */
  unit?: string | null;
  source?: MeasurementSource;
  /** O instrumento do PONTO, quando não é o da sessão. */
  instrumentId?: string | null;
  deviceMeasuredAt?: string | null;
}

/**
 * O que um ponto `measurement` precisa ter antes de ser gravado — e o que um
 * item comum NÃO pode ter.
 *
 * Tudo aqui é conferência de PROVENIÊNCIA, não de ciência: existe sessão aberta
 * para a resposta? A unidade é a do protocolo? O instrumento está em operação?
 * Nenhuma leitura é comparada com tolerância (fronteira metrológica).
 */
async function provenienciaDoPonto(
  session: TenantSession,
  responseId: string,
  item: ChecklistItem,
  value: AnswerValue,
  prov: MeasurementProvenance | undefined
): Promise<{
  readings: number[];
  unit: string;
  source: MeasurementSource;
  instrumentId: string | null;
  deviceMeasuredAt: string | null;
} | null> {
  if (item.kind !== 'measurement') {
    if (value.readings != null) {
      throw new ValidationError(`${item.label}: leituras só se registram em ponto de medição`, {
        field: 'readings',
      });
    }
    return null;
  }

  if (value.readings == null || value.readings.length === 0) {
    throw new ValidationError(`${item.label}: informe as leituras do ponto`, { field: 'readings' });
  }

  const [sessao] = await session.query<{ id: string; instrument_id: string | null; finished_at: unknown }>(
    `SELECT id, instrument_id, finished_at FROM aurora.measurement_sessions WHERE response_id = $1`,
    [responseId]
  );
  if (!sessao) {
    throw new ConflictError(
      'abra a sessão de medição desta resposta antes de registrar leituras: sem ela não há instrumento, certificado nem origem'
    );
  }
  if (sessao.finished_at) {
    throw new ConflictError(
      'a sessão de medição já foi encerrada; leituras novas não entram numa sessão fechada'
    );
  }

  const unidadeDoProtocolo = item.unit ?? '';
  if (prov?.unit != null && prov.unit.trim() !== unidadeDoProtocolo) {
    // Converter seria aritmética com consequência metrológica. Recusar é o
    // único comportamento que não inventa nada.
    throw new ValidationError(
      `${item.label}: o protocolo mede em "${unidadeDoProtocolo}" e as leituras vieram em "${prov.unit}"; o sistema não converte unidades`,
      { field: 'unit' }
    );
  }

  const instrumentId = prov?.instrumentId ?? null;
  if (instrumentId) {
    const [inst] = await session.query<{ status: string }>(
      `SELECT status::text AS status FROM aurora.instruments WHERE asset_id = $1`,
      [instrumentId]
    );
    if (!inst) throw new NotFoundError('Instrumento', instrumentId);
    if (inst.status !== 'active') {
      throw new ConflictError(`o instrumento informado está "${inst.status}" e não pode medir`);
    }
  }

  return {
    readings: [...value.readings],
    unit: unidadeDoProtocolo,
    source: prov?.source ?? 'manual',
    instrumentId,
    deviceMeasuredAt: prov?.deviceMeasuredAt ?? null,
  };
}

export interface AnswerRevisionRow {
  answer_id: string;
  item_id: string;
  revision: number;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_options: string[] | null;
  value_date: string | null;
  verdict: string;
  photo_count: number;
  correction_reason: string | null;
  measured_by: string | null;
  measured_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  current: boolean;
}

/**
 * Todas as versões das respostas de um checklist, da mais antiga à vigente.
 *
 * É a pergunta "o que foi medido, e o que foi corrigido depois?" — e ela só
 * tem resposta porque a 0047 parou de sobrescrever.
 */
export async function answerRevisions(
  session: TenantSession,
  responseId: string
): Promise<AnswerRevisionRow[]> {
  const [resp] = await session.query(`SELECT 1 FROM aurora.checklist_responses WHERE id = $1`, [responseId]);
  if (!resp) throw new NotFoundError('Resposta de checklist', responseId);

  const rows = await session.query<Record<string, unknown>>(
    `SELECT answer_id, item_id, revision, value_text, value_number, value_boolean, value_options,
            value_date::text AS value_date, verdict::text AS verdict, photo_count, correction_reason,
            measured_by, measured_at, superseded_at, superseded_by, false AS current
       FROM aurora.checklist_answer_revisions WHERE response_id = $1
     UNION ALL
     SELECT id, item_id, revision, value_text, value_number, value_boolean, value_options,
            value_date::text, verdict::text, photo_count, correction_reason,
            measured_by, measured_at, NULL, NULL, true
       FROM aurora.checklist_answers WHERE response_id = $1
     ORDER BY 2, 3`,
    [responseId]
  );
  return rows.map((r) => ({
    answer_id: r.answer_id as string,
    item_id: r.item_id as string,
    revision: Number(r.revision),
    value_text: (r.value_text as string | null) ?? null,
    // `numeric` volta texto no `pg` e número no PGlite: normalizado aqui.
    value_number: r.value_number === null ? null : Number(r.value_number),
    value_boolean: (r.value_boolean as boolean | null) ?? null,
    value_options: (r.value_options as string[] | null) ?? null,
    value_date: (r.value_date as string | null) ?? null,
    verdict: r.verdict as string,
    photo_count: Number(r.photo_count ?? 0),
    correction_reason: (r.correction_reason as string | null) ?? null,
    measured_by: (r.measured_by as string | null) ?? null,
    measured_at: String(r.measured_at instanceof Date ? r.measured_at.toISOString() : r.measured_at),
    superseded_at:
      r.superseded_at === null
        ? null
        : String(r.superseded_at instanceof Date ? r.superseded_at.toISOString() : r.superseded_at),
    superseded_by: (r.superseded_by as string | null) ?? null,
    current: Boolean(r.current),
  }));
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

/**
 * Recusa a execução de quem só pode executar a PRÓPRIA OS (pente-fino PF-14).
 *
 * Uma regra, num lugar só, chamada por toda ação de execução: check-in,
 * cronômetro e apontamento, checklist, assinatura, anexo, envio dos bytes,
 * transições de execução e a conclusão. Quem tem `work_order.execute` sem
 * `work_order.execute_any` executa só a OS de que é responsável ou cuja equipe
 * integra (`work_orders.team_id` → `team_members`). Ver
 * `executionRestrictedToAssignment` para quem a regra não alcança.
 *
 * 403, E NÃO 404. Quem chega aqui já LÊ a OS (tem `work_order.read` e ela está
 * no escopo — fora dele o `ScopeGuard` já respondeu 404). Esconder a existência
 * de algo que a pessoa vê na lista não protege nada; dizer POR QUE foi recusado
 * é o que permite ao técnico pedir a atribuição — e é o texto que a tela de
 * atenção do campo mostra.
 *
 * `checkScope` é para a rota que chega à OS por um caminho que o `ScopeGuard`
 * não conhece (a dos bytes de um anexo): ali a OS fora do escopo é 404, a
 * mesma resposta de "não existe".
 */
export async function assertCanExecuteWorkOrder(
  session: TenantSession,
  workOrderId: string,
  opts: { checkScope?: boolean } = {}
): Promise<void> {
  const ctx = session.context;
  const restrito = executionRestrictedToAssignment(ctx.permissions);
  const conferirEscopo =
    opts.checkScope === true &&
    ctx.membershipId !== null &&
    (ctx.scope.customerScope !== 'all' || ctx.scope.locationScope !== 'all');
  if (!restrito && !conferirEscopo) return;

  const [os] = await session.query<{ atribuida: boolean; no_escopo: boolean }>(
    `SELECT COALESCE(w.assignee_membership_id = $2, false)
              OR EXISTS (SELECT 1
                           FROM aurora.team_members tm
                           JOIN aurora.teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
                          WHERE tm.team_id = w.team_id AND tm.membership_id = $2) AS atribuida,
            (NOT $3::boolean
              OR (w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
                  AND (w.location_id IS NULL
                       OR w.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2))))
            ) AS no_escopo
       FROM aurora.work_orders w
      WHERE w.id = $1`,
    [workOrderId, ctx.membershipId, conferirEscopo]
  );
  if (!os || !os.no_escopo) throw new NotFoundError('Ordem de serviço', workOrderId);
  if (restrito && !os.atribuida) {
    // Um `ForbiddenError` comum (mesmo código e título de toda recusa de
    // permissão), com o motivo dito por extenso.
    const recusa = new ForbiddenError('work_order.execute_any');
    recusa.message =
      'esta OS não está atribuída a você nem à sua equipe — executá-la exige ser o responsável, ' +
      'ser da equipe dela ou ter a permissão work_order.execute_any';
    throw recusa;
  }
}

/** A OS a que uma resposta de checklist pertence. `null` quando não existe. */
export async function workOrderOfChecklistResponse(
  session: TenantSession,
  responseId: string
): Promise<string | null> {
  const [r] = await session.query<{ work_order_id: string }>(
    `SELECT work_order_id FROM aurora.checklist_responses WHERE id = $1`,
    [responseId]
  );
  return r?.work_order_id ?? null;
}

export async function startTimer(
  session: TenantSession,
  workOrderId: string,
  opts: {
    hourlyCost?: number | null;
    /**
     * O identificador gerado no APARELHO (PF-65). Com ele, o "parar" pode ser
     * enfileirado logo atrás do "iniciar", offline, sabendo o que vai parar.
     */
    id?: string;
    /** A hora do aparelho, já validada (`deviceInstant`). Ausente → agora. */
    startedAt?: Date | null;
  } = {}
): Promise<string> {
  if (!session.context.membershipId) {
    throw new ValidationError('apontar hora exige um vínculo com a organização', { field: 'membership' });
  }

  /*
   * O MESMO IDENTIFICADOR DE NOVO É O MESMO CRONÔMETRO.
   *
   * O registro de operação (`x-aurora-client-operation`) já devolve o desfecho
   * da primeira vez; isto cobre o reenvio que chega sem ele (ou com outro). Do
   * mesmo dono e na mesma OS, é o mesmo apontamento — devolver o id é a
   * resposta certa. De outro dono ou de outra OS, é colisão, e não é aceito.
   */
  if (opts.id) {
    const [existente] = await session.query<{ work_order_id: string; membership_id: string }>(
      `SELECT work_order_id, membership_id FROM aurora.time_entries WHERE id = $1`,
      [opts.id]
    );
    if (existente) {
      if (
        existente.work_order_id === workOrderId &&
        existente.membership_id === session.context.membershipId
      ) {
        return opts.id;
      }
      throw new ConflictError('este identificador de apontamento já está em uso', { field: 'id' });
    }
  }

  // UM CRONÔMETRO ABERTO POR PESSOA (índice `te_one_open_per_person`, 0025).
  // Conferido aqui para a recusa dizer ONDE está o cronômetro aberto, em vez de
  // devolver o nome do índice.
  const [aberto] = await session.query<{ id: string; work_order_id: string; number: string | null }>(
    `SELECT te.id, te.work_order_id, w.number
       FROM aurora.time_entries te
       LEFT JOIN aurora.work_orders w ON w.id = te.work_order_id
      WHERE te.membership_id = $1 AND te.ended_at IS NULL
      LIMIT 1`,
    [session.context.membershipId]
  );
  if (aberto) {
    const onde =
      aberto.work_order_id === workOrderId ? 'nesta OS' : `na OS ${aberto.number ?? aberto.work_order_id}`;
    throw new ConflictError(
      `já existe um cronômetro aberto seu ${onde} — faça o check-out (ou pare o cronômetro) antes de abrir outro`,
      { open_time_entry_id: aberto.id, work_order_id: aberto.work_order_id }
    );
  }
  const id = opts.id ?? newId();
  await session.query(
    `INSERT INTO aurora.time_entries
       (id, organization_id, work_order_id, membership_id, started_at, source, hourly_cost, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($7::timestamptz, now()), 'timer', $5, $6)`,
    [
      id,
      session.context.organizationId,
      workOrderId,
      session.context.membershipId,
      opts.hourlyCost ?? null,
      session.context.actorId,
      opts.startedAt?.toISOString() ?? null,
    ]
  );
  return id;
}

export async function stopTimer(
  session: TenantSession,
  entryId: string,
  note?: string,
  /** A hora do aparelho, já validada (`deviceInstant`). Ausente → agora. */
  endedAt?: Date | null
): Promise<number> {
  // O cronômetro é de quem o abriu. Parar o de outra pessoa — que encerraria as
  // horas dela — fica com quem aprova ou aponta horas para os outros.
  //
  // PARAR O PRÓPRIO NÃO PASSA PELA REGRA DE ATRIBUIÇÃO (PF-14). Se a OS mudou
  // de responsável com o cronômetro correndo, recusar o "parar" deixaria a
  // pessoa com um cronômetro aberto — e o índice de um aberto por pessoa a
  // travaria em TODAS as outras OS.
  const [dono] = await session.query<{ membership_id: string; started_at: Date | string }>(
    `SELECT membership_id, started_at FROM aurora.time_entries WHERE id = $1`,
    [entryId]
  );
  const perms = session.context.permissions;
  if (
    dono &&
    dono.membership_id !== session.context.membershipId &&
    !perms.has('time_entry.approve') &&
    !perms.has('time_entry.create_for_others')
  ) {
    throw new ForbiddenError('time_entry.approve');
  }
  if (dono && endedAt && endedAt.getTime() < new Date(dono.started_at).getTime()) {
    throw new ValidationError('o fim do cronômetro não pode ser antes do início', { field: 'ended_at' });
  }
  /*
   * `greatest(..., started_at + 1 µs)`: o início pode ter vindo do aparelho
   * até 5 minutos adiantado, e parar com a hora do servidor logo depois daria
   * fim antes do início — que o banco recusa (`te_order`) com um erro que
   * ninguém entenderia. Fim igual ao início vira o menor intervalo possível.
   */
  const rows = await session.query<{ minutes: number }>(
    `UPDATE aurora.time_entries
        SET ended_at = greatest(COALESCE($3::timestamptz, now()), started_at + interval '1 microsecond'),
            note = coalesce($2, note)
      WHERE id = $1 AND ended_at IS NULL
      RETURNING (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::int AS minutes`,
    [entryId, note ?? null, endedAt?.toISOString() ?? null]
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

/**
 * Registra um anexo.
 *
 * A CHAVE DE ARMAZENAMENTO É GERADA AQUI, e não recebida.
 *
 * A versão anterior aceitava a `storageKey` do cliente sem validar nada —
 * quem chamasse a rota podia apontar o registro para o objeto de outro tenant,
 * ou para um caminho com `..`. E o registro é justamente o que a interface usa
 * depois para pedir a URL de leitura: apontar para o objeto errado é vazar o
 * objeto errado.
 *
 * Agora nada do cliente entra no caminho. Sem entrada do cliente, não há
 * travessia de diretório para impedir: ela não tem por onde entrar.
 */
export async function attachFile(
  session: TenantSession,
  input: {
    workOrderId?: string | null;
    checklistAnswerId?: string | null;
    /** Dado bruto de uma sessão de medição (0053). */
    measurementSessionId?: string | null;
    /** Arquivo do certificado externo de um instrumento (0053). */
    instrumentCertificateId?: string | null;
    /** Arquivo original de um lote de importação (0058). */
    importBatchId?: string | null;
    purpose: AttachmentPurpose;
    fileName: string;
    contentType: string;
    byteSize: number;
    sha256?: string | null;
  }
): Promise<{ id: string; storageKey: string }> {
  const conferido = validateAttachment({
    purpose: input.purpose,
    fileName: input.fileName,
    contentType: input.contentType,
    byteSize: input.byteSize,
  });

  /*
   * UM DONO, E A FINALIDADE COMBINA COM ELE.
   *
   * O banco confere o mesmo (`att_has_owner`, `att_purpose_matches_owner`);
   * aqui a recusa chega com o nome do campo, antes de virar código de
   * restrição. Dado bruto pendurado na OS perderia o ponto medido; certificado
   * pendurado na OS perderia o instrumento.
   */
  const donos = [
    ['work_order_id', 'work-orders', input.workOrderId],
    ['checklist_answer_id', 'checklist-answers', input.checklistAnswerId],
    ['measurement_session_id', 'measurement-sessions', input.measurementSessionId],
    ['instrument_certificate_id', 'instrument-certificates', input.instrumentCertificateId],
    ['import_batch_id', 'import-batches', input.importBatchId],
  ] as const;
  const informados = donos.filter(([, , v]) => Boolean(v));
  if (informados.length === 0) {
    throw new ValidationError('o anexo precisa pertencer a uma ordem de serviço ou a uma resposta', {
      field: 'work_order_id',
    });
  }
  const [coluna, entidade, entityIdBruto] = informados[0]!;
  const entityId = entityIdBruto as string;
  const exigeDono: Partial<Record<AttachmentPurpose, string>> = {
    raw_data: 'measurement_session_id',
    certificate: 'instrument_certificate_id',
    import_source: 'import_batch_id',
  };
  const donoExigido = exigeDono[conferido.purpose];
  if (
    donoExigido
      ? coluna !== donoExigido || informados.length > 1
      : informados.some(([c]) => Object.values(exigeDono).includes(c))
  ) {
    throw new ValidationError(`a finalidade "${conferido.purpose}" não combina com este dono de anexo`, {
      field: 'purpose',
    });
  }
  if (PURPOSES_REQUIRING_SHA256.includes(conferido.purpose) && !input.sha256) {
    throw new ValidationError(
      `"${conferido.purpose}" é evidência: o resumo SHA-256 do arquivo é obrigatório`,
      {
        field: 'sha256',
      }
    );
  }
  if (input.sha256 != null && !/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new ValidationError('sha256 precisa ser o resumo em hexadecimal minúsculo (64 caracteres)', {
      field: 'sha256',
    });
  }

  /*
   * Teto por entidade.
   *
   * Sem ele, uma fila offline com defeito enche o armazenamento de uma
   * organização e ninguém percebe até a fatura. O teto é conferido DENTRO da
   * transação: duas gravações simultâneas na mesma OS veriam a mesma contagem
   * fora dela.
   */
  const [quantos] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.attachments WHERE ${coluna} = $1`,
    [entityId]
  );
  if (Number(quantos!.total) >= MAX_ATTACHMENTS_PER_ENTITY) {
    throw new ConflictError(`este registro já tem ${MAX_ATTACHMENTS_PER_ENTITY} anexos, que é o limite`);
  }

  // As colunas de dono novas (0053/0058) entram só quando usadas: o nome vem da
  // lista fechada `donos`, nunca do chamador.
  const donoNovo = coluna === 'work_order_id' || coluna === 'checklist_answer_id' ? null : coluna;

  const id = newId();
  const storageKey = buildStorageKey({
    organizationId: session.context.organizationId,
    entity: entidade,
    entityId,
    attachmentId: id,
    extension: conferido.extension,
  });

  await session.query(
    `INSERT INTO aurora.attachments
       (id, organization_id, work_order_id, checklist_answer_id, purpose, storage_key,
        file_name, content_type, byte_size, sha256, uploaded_by${donoNovo ? `, ${donoNovo}` : ''})
     VALUES ($1, $2, $3, $4, $5::aurora.attachment_purpose, $6, $7, $8, $9, $10, $11${donoNovo ? ', $12' : ''})`,
    [
      id,
      session.context.organizationId,
      input.workOrderId ?? null,
      input.checklistAnswerId ?? null,
      conferido.purpose,
      storageKey,
      // O nome original fica como METADADO — é o que a pessoa reconhece na
      // tela —, nunca como caminho.
      conferido.fileName,
      conferido.contentType,
      conferido.byteSize,
      input.sha256 ?? null,
      session.context.actorId,
      ...(donoNovo ? [entityId] : []),
    ]
  );
  return { id, storageKey };
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
    method: 'drawn' | 'email_code' | 'session';
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
    partsPending: await pendingPartsCount(session, workOrderId),
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
