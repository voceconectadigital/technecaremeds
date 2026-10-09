/**
 * Aurora — checklists e procedimentos pela borda (NS-003/NS-004, parcial).
 *
 * O MOTOR É O DA 0024 + 0052, E SÓ ELE.
 *
 * Versão nasce rascunho, publicada é imutável (gatilho), mudar uma publicada é
 * criar a versão seguinte. Estas funções só juntam, numa transação, o que a
 * tela precisa fazer de uma vez: criar o modelo COM os itens e, se pedido,
 * publicar — sem nenhum tipo de item, regra ou veredito novos.
 *
 * Tolerância e valor nominal do ponto de medição são DADO declarado pelo
 * procedimento. O veredito do ponto continua `na` (AURORA-METROLOGIA-FRONTEIRA):
 * nada aqui decide conformidade.
 */
import { ConflictError, NotFoundError, ValidationError, newId } from '@aurora/domain';
import type { TenantSession } from './client';
import {
  addChecklistItem,
  createChecklistTemplate,
  publishChecklist,
  type ChecklistItemInput,
} from './execution';

export type ProcedureKind = 'calibration' | 'electrical_safety' | 'qualification' | 'acceptance';

export type TemplateItemInput = Omit<ChecklistItemInput, 'templateId' | 'position'>;

export interface TemplateRow {
  id: string;
  key: string;
  version: number;
  title: string;
  description: string;
  status: string;
  procedure_kind: ProcedureKind | null;
  item_count: number;
  published_version: number | null;
  updated_at: string;
}

/**
 * Os modelos: a versão MAIS RECENTE de cada chave, com a última publicada ao
 * lado. É o que a pessoa procura — "o checklist de desfibrilador" — e não a
 * pilha de versões dele.
 */
export async function listTemplates(
  session: TenantSession,
  filtro: { procedureKind?: ProcedureKind | 'none' | null } = {}
): Promise<TemplateRow[]> {
  const rows = await session.query<TemplateRow>(
    `SELECT DISTINCT ON (t.key)
            t.id, t.key, t.version, t.title, t.description, t.status::text AS status,
            t.procedure_kind::text AS procedure_kind,
            (SELECT count(*)::int FROM aurora.checklist_items i WHERE i.template_id = t.id) AS item_count,
            (SELECT max(p.version) FROM aurora.checklist_templates p
              WHERE p.key = t.key AND p.status = 'published') AS published_version,
            t.updated_at
       FROM aurora.checklist_templates t
      WHERE t.status <> 'archived'
        AND ($1::text IS NULL
             OR ($1 = 'none' AND t.procedure_kind IS NULL)
             OR t.procedure_kind::text = $1)
      ORDER BY t.key, t.version DESC`,
    [filtro.procedureKind ?? null]
  );
  return rows.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

export async function templateDetail(session: TenantSession, id: string) {
  const [t] = await session.query<
    TemplateRow & { supersedes_id: string | null; published_at: string | null }
  >(
    `SELECT t.id, t.key, t.version, t.title, t.description, t.status::text AS status,
            t.procedure_kind::text AS procedure_kind, t.supersedes_id, t.published_at, t.updated_at,
            (SELECT count(*)::int FROM aurora.checklist_items i WHERE i.template_id = t.id) AS item_count,
            (SELECT max(p.version) FROM aurora.checklist_templates p
              WHERE p.key = t.key AND p.status = 'published') AS published_version
       FROM aurora.checklist_templates t WHERE t.id = $1`,
    [id]
  );
  if (!t) throw new NotFoundError('Checklist', id);
  const items = await session.query(
    `SELECT id, kind::text AS kind, label, required, position, options, failing_options,
            min_value::float8 AS min_value, max_value::float8 AS max_value, unit, expected_boolean,
            nominal_value::float8 AS nominal_value, tolerance_minus::float8 AS tolerance_minus,
            tolerance_plus::float8 AS tolerance_plus, tolerance_mode, readings_required
       FROM aurora.checklist_items WHERE template_id = $1 ORDER BY position, label`,
    [id]
  );
  const versions = await session.query<{ id: string; version: number; status: string }>(
    `SELECT id, version, status::text AS status FROM aurora.checklist_templates
      WHERE key = $1 ORDER BY version DESC`,
    [t.key]
  );
  return { template: t, items, versions };
}

/** Chave estável a partir do título: minúsculas, sem acento, com sufixo curto. */
export function templateKeyFrom(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48);
  const sufixo = newId().replace(/-/g, '').slice(-6);
  return `${base || 'checklist'}_${sufixo}`.replace(/^([^a-z])/, 'c$1');
}

async function inserirItens(session: TenantSession, templateId: string, items: readonly TemplateItemInput[]) {
  if (items.length === 0) {
    throw new ValidationError('o checklist precisa de ao menos um item', { field: 'items' });
  }
  for (const [i, item] of items.entries()) {
    await addChecklistItem(session, { ...item, templateId, position: i + 1 });
  }
}

export async function createTemplateWithItems(
  session: TenantSession,
  input: {
    title: string;
    description?: string;
    procedureKind: ProcedureKind | null;
    items: readonly TemplateItemInput[];
    publish: boolean;
  }
): Promise<{ id: string; key: string }> {
  const key = templateKeyFrom(input.title);
  const id = await createChecklistTemplate(session, {
    key,
    title: input.title,
    description: input.description ?? '',
    procedureKind: input.procedureKind,
  });
  await inserirItens(session, id, input.items);
  if (input.publish) await publishChecklist(session, id);
  return { id, key };
}

/**
 * Nova revisão de um modelo: versão seguinte, com os itens informados.
 *
 * O tipo de procedimento NÃO muda entre versões — um protocolo de calibração
 * que vira preventiva é outro procedimento, com outra chave. A versão anterior
 * continua valendo para as OS que já a usaram (a resposta congela a versão).
 */
export async function reviseTemplate(
  session: TenantSession,
  baseId: string,
  input: { title: string; description?: string; items: readonly TemplateItemInput[]; publish: boolean }
): Promise<{ id: string; key: string; version: number }> {
  const [base] = await session.query<{
    key: string;
    procedure_kind: string | null;
    technical_manager_id: string | null;
  }>(
    `SELECT key, procedure_kind::text AS procedure_kind, technical_manager_id
       FROM aurora.checklist_templates WHERE id = $1`,
    [baseId]
  );
  if (!base) throw new NotFoundError('Checklist', baseId);
  const [rascunho] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.checklist_templates WHERE key = $1 AND status = 'draft'`,
    [base.key]
  );
  if (rascunho) {
    throw new ConflictError('este checklist já tem uma revisão em rascunho — publique ou descarte antes', {
      field: 'items',
    });
  }
  const [maior] = await session.query<{ v: number }>(
    `SELECT max(version)::int AS v FROM aurora.checklist_templates WHERE key = $1`,
    [base.key]
  );
  const versao = Number(maior?.v ?? 0) + 1;
  const id = newId();
  await session.query(
    `INSERT INTO aurora.checklist_templates
       (id, organization_id, key, version, title, description, status, supersedes_id, created_by,
        procedure_kind, technical_manager_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9::aurora.procedure_kind, $10)`,
    [
      id,
      session.context.organizationId,
      base.key,
      versao,
      input.title,
      input.description ?? '',
      baseId,
      session.context.actorId,
      base.procedure_kind,
      base.technical_manager_id,
    ]
  );
  await inserirItens(session, id, input.items);
  if (input.publish) await publishChecklist(session, id);
  return { id, key: base.key, version: versao };
}
