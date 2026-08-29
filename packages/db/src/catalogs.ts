/**
 * Aurora — catálogos e campos personalizados na camada de dados (EPIC-004).
 */
import {
  newId,
  CATALOGS,
  CATALOG_KEYS,
  catalogByKey,
  validateDefinition,
  validateCustomValues,
  ValidationError,
  NotFoundError,
  ConflictError,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@aurora/domain';
import type { Database, TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* definições de catálogo (espelho do código)                                  */
/* -------------------------------------------------------------------------- */

/** Espelha `CATALOGS` no banco. Idempotente; roda com o banco administrativo. */
export async function syncCatalogDefinitions(
  adminDb: Database
): Promise<{ inserted: number; updated: number; orphaned: string[] }> {
  if (adminDb.appRole) {
    throw new Error('syncCatalogDefinitions exige o banco administrativo (appRole = null)');
  }
  return adminDb.transaction(async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const c of CATALOGS) {
      const rows = await tx.query<{ inserted: boolean }>(
        `INSERT INTO aurora.catalog_definitions (key, name, description, is_hierarchical)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                is_hierarchical = EXCLUDED.is_hierarchical
         RETURNING (xmax = 0) AS inserted`,
        [c.key, c.name, c.description, c.isHierarchical]
      );
      if (rows[0]?.inserted) inserted++;
      else updated++;
    }
    const orphans = await tx.query<{ key: string }>(
      `SELECT key FROM aurora.catalog_definitions WHERE key <> ALL($1::text[]) ORDER BY key`,
      [[...CATALOG_KEYS]]
    );
    return { inserted, updated, orphaned: orphans.map((o) => o.key) };
  });
}

/* -------------------------------------------------------------------------- */
/* itens                                                                       */
/* -------------------------------------------------------------------------- */

export interface CatalogItemInput {
  catalogKey: string;
  key: string;
  label: string;
  systemKey?: string | null;
  description?: string;
  color?: string | null;
  position?: number;
  parentId?: string | null;
  isSystem?: boolean;
}

export interface CatalogItemRow {
  id: string;
  catalog_key: string;
  key: string;
  system_key: string | null;
  label: string;
  normalized_label: string;
  parent_id: string | null;
  position: number;
  archived_at: string | null;
  merged_into_id: string | null;
}

export async function createCatalogItem(session: TenantSession, input: CatalogItemInput): Promise<string> {
  const definicao = catalogByKey(input.catalogKey);
  if (!definicao) {
    throw new ValidationError(`catálogo desconhecido: ${input.catalogKey}`, { catalog: input.catalogKey });
  }
  if (input.parentId && !definicao.isHierarchical) {
    throw new ValidationError(`o catálogo "${definicao.name}" não aceita subitens`, {
      catalog: input.catalogKey,
    });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.catalog_items
       (id, organization_id, catalog_key, key, system_key, label, description, color, position, parent_id, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      session.context.organizationId,
      input.catalogKey,
      input.key,
      input.systemKey ?? null,
      input.label,
      input.description ?? '',
      input.color ?? null,
      input.position ?? 0,
      input.parentId ?? null,
      input.isSystem ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

/** Itens vivos de um catálogo, na ordem de exibição. */
export async function listCatalog(
  session: TenantSession,
  catalogKey: string,
  opts: { includeArchived?: boolean } = {}
): Promise<CatalogItemRow[]> {
  return session.query<CatalogItemRow>(
    `SELECT id, catalog_key, key, system_key, label, normalized_label, parent_id, position,
            archived_at, merged_into_id
       FROM aurora.catalog_items
      WHERE catalog_key = $1
        AND ($2::boolean OR archived_at IS NULL)
      ORDER BY position, label`,
    [catalogKey, opts.includeArchived ?? false]
  );
}

/**
 * Arquiva um item.
 *
 * Recusa arquivar item com subitens vivos, pela mesma razão de `archiveLocation`
 * na 0008: sumir com estrutura que alguém ainda usa, sem aviso, é pior que
 * pedir uma decisão explícita.
 */
export async function archiveCatalogItem(session: TenantSession, itemId: string): Promise<void> {
  const [item] = await session.query<{ label: string; is_system: boolean }>(
    `SELECT label, is_system FROM aurora.catalog_items WHERE id = $1`,
    [itemId]
  );
  if (!item) throw new NotFoundError('Item de catálogo', itemId);
  if (item.is_system) {
    throw new ConflictError(`"${item.label}" é item de sistema e não pode ser arquivado`);
  }

  const filhos = await session.query<{ label: string }>(
    `SELECT label FROM aurora.catalog_items WHERE parent_id = $1 AND archived_at IS NULL ORDER BY label`,
    [itemId]
  );
  if (filhos.length > 0) {
    throw new ConflictError(
      `"${item.label}" tem ${filhos.length} subitem(ns) ativo(s): ${filhos.map((f) => f.label).join(', ')}. ` +
        `Arquive ou mescle antes.`
    );
  }

  await session.query(
    `UPDATE aurora.catalog_items SET archived_at = now(), updated_by = $2 WHERE id = $1 AND archived_at IS NULL`,
    [itemId, session.context.actorId]
  );
}

/**
 * Mescla dois itens: a origem some da lista e aponta para o destino.
 *
 * Devolve quantas referências foram reapontadas. A conta vem do banco, que
 * percorre o registro `catalog_references` — a aplicação não sabe, e não
 * deveria saber, quais tabelas referenciam o quê.
 */
export async function mergeCatalogItems(
  session: TenantSession,
  sourceId: string,
  targetId: string
): Promise<number> {
  const [row] = await session.query<{ repointed: number }>(
    `SELECT aurora.merge_catalog_item($1, $2) AS repointed`,
    [sourceId, targetId]
  );
  return row?.repointed ?? 0;
}

/** Segue a cadeia de mesclagem até o item que de fato vale hoje. */
export async function resolveCatalogItem(session: TenantSession, itemId: string): Promise<CatalogItemRow> {
  const [row] = await session.query<CatalogItemRow>(
    `WITH RECURSIVE chain AS (
       SELECT c.*, 0 AS hop FROM aurora.catalog_items c WHERE c.id = $1
       UNION ALL
       SELECT n.*, chain.hop + 1 FROM aurora.catalog_items n
         JOIN chain ON n.id = chain.merged_into_id
        WHERE chain.hop < 10
     )
     SELECT id, catalog_key, key, system_key, label, normalized_label, parent_id, position,
            archived_at, merged_into_id
       FROM chain ORDER BY hop DESC LIMIT 1`,
    [itemId]
  );
  if (!row) throw new NotFoundError('Item de catálogo', itemId);
  return row;
}

/* -------------------------------------------------------------------------- */
/* campos personalizados                                                       */
/* -------------------------------------------------------------------------- */

interface DefinitionRow {
  key: string;
  label: string;
  kind: CustomFieldDefinition['kind'];
  required: boolean;
  options: string[];
  min_value: string | number | null;
  max_value: string | number | null;
  regex: string | null;
  unit: string | null;
  default_value: unknown;
  applies_when: Record<string, unknown> | null;
}

function toDefinition(r: DefinitionRow): CustomFieldDefinition {
  return {
    key: r.key,
    label: r.label,
    kind: r.kind,
    required: r.required,
    options: r.options,
    // `numeric` volta como string do driver: converter aqui evita comparar
    // string com número lá na validação e concluir que 9 > 10.
    min: r.min_value === null ? null : Number(r.min_value),
    max: r.max_value === null ? null : Number(r.max_value),
    regex: r.regex,
    unit: r.unit,
    defaultValue: r.default_value,
    appliesWhen: r.applies_when,
  };
}

export async function loadCustomFieldDefinitions(
  session: TenantSession,
  entity: CustomFieldEntity
): Promise<CustomFieldDefinition[]> {
  const rows = await session.query<DefinitionRow>(
    `SELECT key, label, kind::text AS kind, required, options, min_value, max_value,
            regex, unit, default_value, applies_when
       FROM aurora.custom_field_definitions
      WHERE entity_type = $1 AND archived_at IS NULL
      ORDER BY position, label`,
    [entity]
  );
  return rows.map(toDefinition);
}

export interface CustomFieldInput extends CustomFieldDefinition {
  entityType: CustomFieldEntity;
  helpText?: string;
  group?: string | null;
  position?: number;
  searchable?: boolean;
  reportable?: boolean;
  visibleToPortal?: boolean;
}

/**
 * Cria uma definição, recusando definição incoerente antes de gravá-la.
 *
 * A validação roda no domínio e o banco tem as suas próprias restrições. Não é
 * redundância inútil: a do domínio dá a mensagem que a pessoa entende, a do
 * banco vale para todo caminho de escrita, inclusive os que ainda não existem.
 */
export async function createCustomFieldDefinition(
  session: TenantSession,
  input: CustomFieldInput
): Promise<string> {
  const problemas = validateDefinition(input);
  if (problemas.length > 0) {
    throw new ValidationError(problemas.map((p) => p.message).join('; '), { issues: problemas });
  }
  const id = newId();
  await session.query(
    `INSERT INTO aurora.custom_field_definitions
       (id, organization_id, entity_type, key, label, help_text, field_group, position, kind,
        options, min_value, max_value, regex, unit, required, default_value, applies_when,
        searchable, reportable, visible_to_portal, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::aurora.custom_field_kind,
             $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      id,
      session.context.organizationId,
      input.entityType,
      input.key,
      input.label,
      input.helpText ?? '',
      input.group ?? null,
      input.position ?? 0,
      input.kind,
      input.options ?? [],
      input.min ?? null,
      input.max ?? null,
      input.regex ?? null,
      input.unit ?? null,
      input.required ?? false,
      input.defaultValue === undefined ? null : JSON.stringify(input.defaultValue),
      input.appliesWhen === undefined || input.appliesWhen === null
        ? null
        : JSON.stringify(input.appliesWhen),
      input.searchable ?? false,
      input.reportable ?? true,
      input.visibleToPortal ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Valida e grava os valores personalizados de um registro.
 *
 * Único caminho de escrita da coluna `custom`. Escrever `custom` direto com
 * `UPDATE ... SET custom = $1` pularia a validação — por isso a validação não
 * vive só aqui: as definições dizem o que é aceitável e esta função é o
 * caminho conveniente, não a única barreira que existe.
 */
export async function saveCustomValues(
  session: TenantSession,
  entity: CustomFieldEntity,
  table: 'customers' | 'locations' | 'suppliers',
  recordId: string,
  input: Readonly<Record<string, unknown>>,
  record: Readonly<Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  const defs = await loadCustomFieldDefinitions(session, entity);
  const { issues, values } = validateCustomValues(defs, input, record);
  if (issues.length > 0) {
    throw new ValidationError(issues.map((i) => i.message).join('; '), { issues });
  }
  const sql =
    table === 'customers'
      ? `UPDATE aurora.customers SET custom = $2, updated_by = $3 WHERE id = $1`
      : table === 'locations'
        ? `UPDATE aurora.locations SET custom = $2, updated_by = $3 WHERE id = $1`
        : `UPDATE aurora.suppliers SET custom = $2, updated_by = $3 WHERE id = $1`;
  await session.query(sql, [recordId, JSON.stringify(values), session.context.actorId]);
  return values;
}
