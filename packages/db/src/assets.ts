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
  normalizeExternalRef,
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
  /** Registro ANVISA, vida útil (anos) e nº da NF de aquisição (0078). */
  anvisaRegistration?: string | null;
  usefulLifeYears?: number | null;
  acquisitionInvoice?: string | null;
  /** "Não se aplica" ao registro ANVISA e valor residual da depreciação (0089 · ATV-11, ATV-10). */
  anvisaNotApplicable?: boolean;
  residualValue?: number | null;
  specs?: Record<string, unknown>;
  /** Origem e identificador no sistema legado (0048). Opcionais, e sempre juntos. */
  externalSource?: string | null;
  externalId?: string | null;
}

export async function createAsset(session: TenantSession, input: AssetInput): Promise<string> {
  const id = newId();
  const externo = normalizeExternalRef(input.externalSource, input.externalId);
  await session.query(
    `INSERT INTO aurora.assets
       (id, organization_id, name, customer_id, asset_category_id, location_id, asset_model_id,
        criticality_id, parent_asset_id, tag, serial_number, asset_number, qr_token, status,
        acquired_at, purchase_value, replacement_value, specs, created_by,
        external_source, external_id, anvisa_registration, useful_life_years, acquisition_invoice,
        anvisa_not_applicable, residual_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::aurora.asset_status,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
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
      externo?.source ?? null,
      externo?.id ?? null,
      input.anvisaRegistration ?? null,
      input.usefulLifeYears ?? null,
      input.acquisitionInvoice ?? null,
      input.anvisaNotApplicable ?? false,
      input.residualValue ?? null,
    ]
  );
  return id;
}

/* -------------------------------------------------------------------------- */
/* foto do equipamento (ATV-07 · 0085)                                         */
/* -------------------------------------------------------------------------- */

export interface AssetPhotoRecord {
  key: string;
  contentType: string;
  size: number;
  sha256: string;
}

/**
 * Grava (ou troca) os metadados da foto. Os BYTES já foram gravados no
 * armazenamento por quem chama — com a chave gerada pelo servidor. Devolve a
 * chave anterior, para quem chama apagá-la DEPOIS da transação: apagar antes e
 * ver a transação desfeita deixaria o equipamento apontando para o nada.
 *
 * Não confere escopo: quem chama confere que o equipamento é visível a quem envia.
 */
export async function setAssetPhoto(
  session: TenantSession,
  assetId: string,
  foto: AssetPhotoRecord
): Promise<{ previousKey: string | null; uploadedAt: string }> {
  const [antes] = await session.query<{ photo_key: string | null }>(
    `SELECT photo_key FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [assetId]
  );
  if (!antes) throw new NotFoundError('Ativo', assetId);
  const [depois] = await session.query<{ photo_uploaded_at: Date | string }>(
    `UPDATE aurora.assets
        SET photo_key = $2, photo_content_type = $3, photo_size = $4, photo_sha256 = $5,
            photo_uploaded_at = now(), updated_at = now(), updated_by = $6
      WHERE id = $1
      RETURNING photo_uploaded_at`,
    [assetId, foto.key, foto.contentType, foto.size, foto.sha256, session.context.actorId]
  );
  const quando = depois!.photo_uploaded_at;
  return {
    previousKey: antes.photo_key,
    uploadedAt: quando instanceof Date ? quando.toISOString() : String(quando),
  };
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
  reason: string,
  opts: {
    /**
     * O equipamento que fica no lugar (0056). Opcional: nem todo
     * descomissionamento tem sucessor.
     */
    replacedByAssetId?: string | null;
  } = {}
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
  const sucessor = opts.replacedByAssetId ?? null;
  if (sucessor) {
    if (sucessor === assetId) {
      throw new ValidationError('um ativo não substitui a si mesmo', { field: 'replaced_by_asset_id' });
    }
    const [s] = await session.query<{ status: string }>(
      `SELECT status::text AS status FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
      [sucessor]
    );
    // Ativo de outra organização não aparece (RLS): "não existe".
    if (!s) throw new NotFoundError('Ativo sucessor', sucessor);
    if (s.status === 'decommissioned' || s.status === 'disposed') {
      throw new ConflictError('o sucessor indicado também está fora de operação');
    }
    const [ja] = await session.query<{ name: string }>(
      `SELECT name FROM aurora.assets WHERE replaced_by_asset_id = $1`,
      [sucessor]
    );
    if (ja) throw new ConflictError(`o sucessor indicado já substitui "${ja.name}"`);
  }

  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.assets
        SET status = 'decommissioned', decommissioned_at = now(), decommission_reason = $2, updated_by = $3,
            replaced_by_asset_id = $4
      WHERE id = $1 AND deleted_at IS NULL AND decommissioned_at IS NULL
      RETURNING id`,
    [assetId, reason.trim(), session.context.actorId, sucessor]
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
  /** Linha da planilha → ativo criado. É o que o pipeline rastreável (0058) persiste. */
  created: Array<{ line: number; id: string }>;
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
  defaults: { customerId: string; externalSource?: string | null }
): Promise<ImportResult> {
  const inicio = Date.now();
  const issues: ImportIssue[] = [];
  const created: Array<{ line: number; id: string }> = [];
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

      const novoId = await createAsset(session, {
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
        // O identificador do sistema de origem, com a origem do lote (0048).
        externalSource: row.external_id ? (defaults.externalSource ?? null) : null,
        externalId: row.external_id ?? null,
      });

      await session.query(`RELEASE SAVEPOINT ${savepoint}`);
      imported++;
      created.push({ line: row.line, id: novoId });
    } catch (err) {
      await session.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await session.query(`RELEASE SAVEPOINT ${savepoint}`);
      // Tag repetida na organização (índice da 0089): a linha diz qual campo, em português.
      const tagRepetida = String((err as Error)?.message ?? '').includes('assets_org_tag_uq');
      issues.push({
        line: row.line,
        field: tagRepetida ? 'tag' : ((err as { details?: { field?: string } })?.details?.field ?? null),
        message: tagRepetida
          ? `tag "${row.tag ?? ''}" já está em uso por outro equipamento da organização`
          : (err as Error).message,
      });
    }
  }

  return {
    imported,
    created,
    failed: rows.length - imported,
    issues,
    createdManufacturers,
    createdModels,
    elapsedMs: Date.now() - inicio,
  };
}
