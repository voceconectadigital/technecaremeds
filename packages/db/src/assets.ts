/**
 * Aurora — ativos na camada de dados (SPEC v0.2 §07 · EPIC-005).
 */
import { randomBytes } from 'node:crypto';
import {
  newId,
  generateQrToken,
  validateImportRow,
  normalizeLabel,
  normalizeIdentifier,
  ValidationError,
  NotFoundError,
  ConflictError,
  type AssetImportRow,
  type ImportIssue,
  type AssetStatus,
} from '@aurora/domain';
import type { TenantSession } from './client';

const qrToken = () => generateQrToken((n) => new Uint8Array(randomBytes(n)));

/* -------------------------------------------------------------------------- */
/* classificação                                                               */
/* -------------------------------------------------------------------------- */

export async function createAssetCategory(
  session: TenantSession,
  input: {
    name: string;
    parentId?: string | null;
    requiresCalibration?: boolean;
    requiresElectricalTest?: boolean;
  }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.asset_categories
       (id, organization_id, name, parent_id, requires_calibration, requires_electrical_test, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.parentId ?? null,
      input.requiresCalibration ?? false,
      input.requiresElectricalTest ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

export async function createCriticality(
  session: TenantSession,
  input: { name: string; score: number; slaMultiplier?: number; color?: string | null }
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.criticality_levels (id, organization_id, name, score, sla_multiplier, color, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.score,
      input.slaMultiplier ?? 1,
      input.color ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Fabricante, criando sob demanda.
 *
 * `verified` fica falso quando o nome chega pela importação: a planilha de
 * origem traz "Lider", "LIDER" e "Líder", e as três precisam entrar para a
 * migração não parar. As duas primeiras colidem na normalização e viram uma só;
 * a terceira também — o acento cai. O que sobra para a curadoria são os casos
 * que a normalização não resolve.
 */
export async function findOrCreateManufacturer(
  session: TenantSession,
  name: string,
  opts: { verified?: boolean } = {}
): Promise<{ id: string; created: boolean }> {
  const existing = await session.query<{ id: string }>(
    `SELECT id FROM aurora.manufacturers
      WHERE normalized_name = aurora.normalize_label($1) AND archived_at IS NULL`,
    [name]
  );
  if (existing[0]) return { id: existing[0].id, created: false };

  const id = newId();
  await session.query(
    `INSERT INTO aurora.manufacturers (id, organization_id, name, verified, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, session.context.organizationId, name, opts.verified ?? false, session.context.actorId]
  );
  return { id, created: true };
}

export async function findOrCreateAssetModel(
  session: TenantSession,
  input: { manufacturerId: string; categoryId: string; name: string; verified?: boolean }
): Promise<{ id: string; created: boolean }> {
  const existing = await session.query<{ id: string }>(
    `SELECT id FROM aurora.asset_models
      WHERE manufacturer_id = $1 AND normalized_name = aurora.normalize_label($2) AND archived_at IS NULL`,
    [input.manufacturerId, input.name]
  );
  if (existing[0]) return { id: existing[0].id, created: false };

  const id = newId();
  await session.query(
    `INSERT INTO aurora.asset_models
       (id, organization_id, manufacturer_id, asset_category_id, name, verified, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      session.context.organizationId,
      input.manufacturerId,
      input.categoryId,
      input.name,
      input.verified ?? false,
      session.context.actorId,
    ]
  );
  return { id, created: true };
}

/** Fila de curadoria: o que a importação criou e ninguém conferiu ainda. */
export async function curationQueue(session: TenantSession): Promise<{
  manufacturers: Array<{ id: string; name: string; models: number }>;
  models: Array<{ id: string; name: string; manufacturer: string; assets: number }>;
}> {
  const manufacturers = await session.query<{ id: string; name: string; models: number }>(
    `SELECT m.id, m.name,
            (SELECT count(*) FROM aurora.asset_models am
              WHERE am.manufacturer_id = m.id AND am.archived_at IS NULL)::int AS models
       FROM aurora.manufacturers m
      WHERE NOT m.verified AND m.archived_at IS NULL
      ORDER BY m.name`
  );
  const models = await session.query<{ id: string; name: string; manufacturer: string; assets: number }>(
    `SELECT am.id, am.name, m.name AS manufacturer,
            (SELECT count(*) FROM aurora.assets a
              WHERE a.asset_model_id = am.id AND a.deleted_at IS NULL)::int AS assets
       FROM aurora.asset_models am
       JOIN aurora.manufacturers m ON m.id = am.manufacturer_id
      WHERE NOT am.verified AND am.archived_at IS NULL
      ORDER BY m.name, am.name`
  );
  return { manufacturers, models };
}

export async function mergeManufacturers(
  session: TenantSession,
  sourceId: string,
  targetId: string
): Promise<number> {
  const [row] = await session.query<{ moved: number }>(`SELECT aurora.merge_manufacturers($1, $2) AS moved`, [
    sourceId,
    targetId,
  ]);
  return row?.moved ?? 0;
}

/* -------------------------------------------------------------------------- */
/* ativos                                                                      */
/* -------------------------------------------------------------------------- */

export interface AssetInput {
  name: string;
  customerId: string;
  assetCategoryId: string;
  locationId?: string | null;
  assetModelId?: string | null;
  criticalityId?: string | null;
  parentAssetId?: string | null;
  tag?: string | null;
  serialNumber?: string | null;
  assetNumber?: string | null;
  status?: AssetStatus;
  acquiredAt?: string | null;
  purchaseValue?: number | null;
  replacementValue?: number | null;
  specs?: Record<string, unknown>;
}

export async function createAsset(session: TenantSession, input: AssetInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.assets
       (id, organization_id, name, customer_id, asset_category_id, location_id, asset_model_id,
        criticality_id, parent_asset_id, tag, serial_number, asset_number, qr_token, status,
        acquired_at, purchase_value, replacement_value, specs, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::aurora.asset_status,
             $15, $16, $17, $18, $19)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.customerId,
      input.assetCategoryId,
      input.locationId ?? null,
      input.assetModelId ?? null,
      input.criticalityId ?? null,
      input.parentAssetId ?? null,
      input.tag ?? null,
      input.serialNumber ?? null,
      input.assetNumber ?? null,
      qrToken(),
      input.status ?? 'active',
      input.acquiredAt ?? null,
      input.purchaseValue ?? null,
      input.replacementValue ?? null,
      JSON.stringify(input.specs ?? {}),
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Transfere o ativo. Único caminho: o gatilho da 0015 recusa edição direta de
 * `location_id` ou `customer_id`.
 */
export async function transferAsset(
  session: TenantSession,
  assetId: string,
  toLocationId: string,
  reason: string,
  opts: { kind?: 'transfer' | 'loan' | 'return'; dueBackAt?: Date | null } = {}
): Promise<string> {
  const [row] = await session.query<{ id: string }>(
    `SELECT aurora.transfer_asset($1, $2, $3, $4::aurora.transfer_kind, $5) AS id`,
    [assetId, toLocationId, reason, opts.kind ?? 'transfer', opts.dueBackAt?.toISOString() ?? null]
  );
  return row!.id;
}

/**
 * Descomissiona.
 *
 * A justificativa é exigida pelo banco (10 caracteres). O documento de
 * obsolescência que a SPEC também aceita entra no EPIC-018; até lá, o caminho é
 * a justificativa — e isso está dito, não escondido atrás de um campo opcional.
 */
export async function decommissionAsset(
  session: TenantSession,
  assetId: string,
  reason: string
): Promise<void> {
  if (reason.trim().length < 10) {
    throw new ValidationError('descomissionar exige justificativa de ao menos 10 caracteres', {
      field: 'reason',
    });
  }
  const componentes = await session.query<{ name: string }>(
    `SELECT name FROM aurora.assets
      WHERE parent_asset_id = $1 AND deleted_at IS NULL AND status NOT IN ('decommissioned', 'disposed')
      ORDER BY name LIMIT 20`,
    [assetId]
  );
  if (componentes.length > 0) {
    throw new ConflictError(
      `este ativo ainda tem ${componentes.length} componente(s) em operação: ` +
        `${componentes.map((c) => c.name).join(', ')}. Descomissione ou desvincule antes.`
    );
  }
  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.assets
        SET status = 'decommissioned', decommissioned_at = now(), decommission_reason = $2, updated_by = $3
      WHERE id = $1 AND deleted_at IS NULL AND decommissioned_at IS NULL
      RETURNING id`,
    [assetId, reason.trim(), session.context.actorId]
  );
  if (rows.length === 0) throw new NotFoundError('Ativo', assetId);
}

/** Ativos de uma subárvore de locais, por prefixo de caminho — indexado. */
export async function assetsUnderLocation(
  session: TenantSession,
  locationId: string
): Promise<Array<{ id: string; name: string; location_path: string; status: string }>> {
  const [root] = await session.query<{ path: string }>(
    `SELECT path FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
    [locationId]
  );
  if (!root) throw new NotFoundError('Local', locationId);
  return session.query(
    `SELECT id, name, location_path, status::text
       FROM aurora.assets
      WHERE location_path LIKE $1 AND deleted_at IS NULL
      ORDER BY location_path, name`,
    [`${root.path}%`]
  );
}

/* -------------------------------------------------------------------------- */
/* importação                                                                  */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  imported: number;
  failed: number;
  issues: ImportIssue[];
  createdManufacturers: number;
  createdModels: number;
  elapsedMs: number;
}

/**
 * Importa ativos de uma planilha já convertida em linhas.
 *
 * A decisão que molda esta função: **cada linha falha sozinha**.
 *
 * O critério de aceite do épico é importar 27 mil ativos com relatório de erros
 * por linha. Uma transação única daria atomicidade bonita e um resultado
 * inútil: trinta linhas ruins abortariam 26.970 boas, e quem importou receberia
 * "erro" sem saber onde. Aqui cada linha vai num SAVEPOINT: a que falha volta
 * atrás sozinha, entra no relatório com número de linha e motivo, e as demais
 * seguem.
 *
 * A troca é explícita: abrimos mão de "tudo ou nada" em favor de "tudo que dá,
 * e a lista exata do que não deu". Para migração de dado legado essa é a
 * escolha certa — a planilha SEMPRE tem linha ruim, e o trabalho é justamente
 * descobrir quais.
 */
export async function importAssets(
  session: TenantSession,
  rows: readonly AssetImportRow[],
  defaults: { customerId: string }
): Promise<ImportResult> {
  const inicio = Date.now();
  const issues: ImportIssue[] = [];
  let imported = 0;
  let createdManufacturers = 0;
  let createdModels = 0;

  // Caches por execução. Sem eles, uma planilha de 27 mil linhas com 40
  // fabricantes faria 27 mil consultas para descobrir 40 respostas.
  const categorias = new Map<string, string>();
  const fabricantes = new Map<string, string>();
  const modelos = new Map<string, string>();
  const locais = new Map<string, string | null>();

  const catRows = await session.query<{ id: string; normalized_name: string }>(
    `SELECT id, normalized_name FROM aurora.asset_categories WHERE archived_at IS NULL`
  );
  for (const c of catRows) categorias.set(c.normalized_name, c.id);

  for (const row of rows) {
    const formais = validateImportRow(row);
    if (formais.length > 0) {
      issues.push(...formais);
      continue;
    }

    // O nome do savepoint entra por interpolação — não há placeholder para
    // identificador. O número de linha vem de arquivo externo, então é
    // validado como inteiro antes de virar SQL.
    if (!Number.isSafeInteger(row.line) || row.line < 0) {
      issues.push({ line: 0, field: null, message: `número de linha inválido: ${String(row.line)}` });
      continue;
    }
    const savepoint = `imp_${row.line}`;
    await session.query(`SAVEPOINT ${savepoint}`);
    try {
      // A chave tem de ser a MESMA forma que o banco guarda em
      // `normalized_name`: normalize_label, com espaços. normalizeIdentifier,
      // que compacta, serve para série e patrimônio, não para nome.
      const catId = categorias.get(normalizeLabel(row.category!));
      if (!catId) {
        throw new ValidationError(`categoria "${row.category}" não existe`, { field: 'category' });
      }

      let modelId: string | null = null;
      if (row.manufacturer?.trim()) {
        const fabKey = normalizeIdentifier(row.manufacturer);
        let fabId = fabricantes.get(fabKey);
        if (!fabId) {
          const r = await findOrCreateManufacturer(session, row.manufacturer.trim());
          fabId = r.id;
          if (r.created) createdManufacturers++;
          fabricantes.set(fabKey, fabId);
        }
        if (row.model?.trim()) {
          const modKey = `${fabId}::${normalizeIdentifier(row.model)}`;
          modelId = modelos.get(modKey) ?? null;
          if (!modelId) {
            const r = await findOrCreateAssetModel(session, {
              manufacturerId: fabId,
              categoryId: catId,
              name: row.model.trim(),
            });
            modelId = r.id;
            if (r.created) createdModels++;
            modelos.set(modKey, modelId);
          }
        }
      }

      let locationId: string | null = null;
      if (row.location_code?.trim()) {
        const codigo = row.location_code.trim();
        if (locais.has(codigo)) {
          locationId = locais.get(codigo)!;
        } else {
          const [loc] = await session.query<{ id: string }>(
            `SELECT id FROM aurora.locations
              WHERE code = $1 AND customer_id = $2 AND deleted_at IS NULL`,
            [codigo, defaults.customerId]
          );
          locationId = loc?.id ?? null;
          locais.set(codigo, locationId);
        }
        if (!locationId) {
          throw new ValidationError(`local de código "${codigo}" não existe para este cliente`, {
            field: 'location_code',
          });
        }
      }

      await createAsset(session, {
        name: row.name!.trim(),
        customerId: defaults.customerId,
        assetCategoryId: catId,
        assetModelId: modelId,
        locationId,
        tag: row.tag ?? null,
        serialNumber: row.serial_number ?? null,
        assetNumber: row.asset_number ?? null,
        acquiredAt: row.acquired_at ?? null,
        purchaseValue:
          row.purchase_value === undefined || row.purchase_value === null || row.purchase_value === ''
            ? null
            : Number(row.purchase_value),
      });

      await session.query(`RELEASE SAVEPOINT ${savepoint}`);
      imported++;
    } catch (err) {
      await session.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await session.query(`RELEASE SAVEPOINT ${savepoint}`);
      issues.push({
        line: row.line,
        field: (err as { details?: { field?: string } })?.details?.field ?? null,
        message: (err as Error).message,
      });
    }
  }

  return {
    imported,
    failed: rows.length - imported,
    issues,
    createdManufacturers,
    createdModels,
    elapsedMs: Date.now() - inicio,
  };
}
