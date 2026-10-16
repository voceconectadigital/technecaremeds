/**
 * Aurora — ativos pela HTTP (SPEC v0.2 §07 · EPIC-005).
 *
 * Duas escolhas de superfície que valem explicação.
 *
 * Não existe `PATCH /assets/:id` que aceite `location_id`. Transferir é
 * `POST /assets/:id/transfer`, com motivo obrigatório — e não é só convenção de
 * rota: o banco recusa a edição direta (migration 0015). A API não poderia
 * oferecer o atalho nem se quisesse.
 *
 * A listagem devolve o ativo já com o rótulo que a organização usa
 * (`asset_label`, ADR-006). Quem consome não precisa saber que internamente
 * tudo é `asset`; quem opera num hospital lê "Equipamento".
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createAsset,
  transferAsset,
  decommissionAsset,
  importAssets,
  curationQueue,
  assetTimeline,
  type TenantSession,
  type Database,
} from '@aurora/db';
import { assetsCreate, assetsTimeline, assetsUpdate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import {
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  effectiveSpecs,
  overriddenSpecKeys,
  isUnderWarranty,
  assetAgeYears,
  type AssetImportRow,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function requiredText(value: unknown, field: string, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new ValidationError(
      min > 1 ? `${field} precisa de ao menos ${min} caracteres` : `${field} é obrigatório`,
      { field }
    );
  }
  return value.trim();
}

/**
 * Cliente → Setor → Equipamento, conferido no SERVIDOR.
 *
 * O banco já recusa local de outro cliente (gatilho da 0015) e de outra
 * organização (FK composta + RLS). Esta conferência vem antes para três
 * coisas que o banco não diz: o escopo de quem cadastra (vínculo restrito a um
 * hospital não cadastra em outro), o tipo de local que aceita equipamento, e
 * uma recusa com o CAMPO nomeado — que é o que o formulário precisa.
 */
async function conferirClienteESetor(
  s: TenantSession,
  membershipId: string,
  customerId: string,
  locationId: string
): Promise<void> {
  const [cliente] = await s.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
    [membershipId, customerId]
  );
  if (!cliente) throw new NotFoundError('cliente', customerId);

  const [local] = await s.query<{ customer_id: string; allows_assets: boolean; acessivel: boolean }>(
    `SELECT l.customer_id, t.allows_assets,
            EXISTS (SELECT 1 FROM aurora.accessible_location_ids($1) a WHERE a.location_id = l.id) AS acessivel
       FROM aurora.locations l
       JOIN aurora.location_types t ON t.id = l.location_type_id
      WHERE l.id = $2 AND l.deleted_at IS NULL`,
    [membershipId, locationId]
  );
  if (!local || !local.acessivel) {
    throw new ValidationError('setor não encontrado', { field: 'location_id' });
  }
  if (local.customer_id !== customerId) {
    throw new ValidationError('o setor escolhido pertence a outro cliente', { field: 'location_id' });
  }
  if (!local.allows_assets) {
    throw new ValidationError('este tipo de local não recebe equipamento — escolha um setor ou sala', {
      field: 'location_id',
    });
  }
}

/**
 * Chip geolocalizador / etiqueta de localização: tipo e identificador andam
 * juntos. Só cadastro — nenhuma leitura de hardware acontece aqui.
 */
function conferirRastreador(
  kind: string | null | undefined,
  tag: string | null | undefined
): { kind: string; tag: string } | null {
  const k = kind ?? null;
  const t = tag ? tag.trim() : null;
  if (!k && !t) return null;
  if (!k || !t) {
    throw new ValidationError('informe o tipo e o identificador do chip juntos (ou nenhum dos dois)', {
      field: k ? 'tracker_tag' : 'tracker_kind',
    });
  }
  return { kind: k, tag: t };
}

function rastreadorDuplicado(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('assets_tracker_tag_uq')) {
    throw new ConflictError('este chip/etiqueta de localização já está vinculado a outro equipamento');
  }
  throw e;
}

@Controller('assets')
export class AssetsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Inventário, recortado pelo escopo de quem pergunta.
   *
   * O filtro por local usa o caminho materializado do ativo (`location_path`),
   * não uma junção com a árvore: uma condição de prefixo indexada responde
   * "tudo abaixo da Unidade Norte" sem percorrer nível por nível.
   */
  @Get()
  @RequirePermissions('asset.read')
  async list(
    @Req() req: AuroraRequest,
    @Query('location') location?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('customer') customer?: string,
    @Query('family') family?: string,
    @Query('category') category?: string,
    @Query('model') model?: string,
    @Query('manufacturer') manufacturer?: string,
    @Query('criticality') criticality?: string,
    @Query('tracker') tracker?: string
  ): Promise<{ items: unknown[]; asset_label: string }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const locationId = location === undefined ? null : uuidParam(location, 'location');
    const customerId = customer === undefined ? null : uuidParam(customer, 'customer');
    const max = Math.min(Number.parseInt(limit ?? '100', 10) || 100, 500);

    return withTenant(this.db, ctx, async (s) => {
      const [org] = await s.query<{ asset_label: string }>(
        `SELECT asset_label FROM aurora.organizations WHERE deleted_at IS NULL`
      );
      const items = await s.query(
        `SELECT a.id, a.name, a.tag, a.serial_number, a.asset_number, a.qr_token,
                a.status::text, a.location_id, a.location_path, a.customer_id,
                a.asset_category_id, a.asset_model_id, a.warranty_until,
                c.name AS category_name,
                l.name AS location_name,
                m.name AS model_name,
                f.name AS manufacturer_name,
                fam.family_key, fam.name AS family_name,
                a.criticality_id, cr.name AS criticality_name,
                a.tracker_kind, a.tracker_tag
           FROM aurora.assets a
           JOIN aurora.asset_categories c ON c.id = a.asset_category_id
           LEFT JOIN aurora.asset_categories fam
                  ON fam.id = CASE WHEN c.family_key IS NOT NULL THEN c.id ELSE c.parent_id END
                 AND fam.family_key IS NOT NULL
           LEFT JOIN aurora.criticality_levels cr ON cr.id = a.criticality_id
           LEFT JOIN aurora.locations l    ON l.id = a.location_id
           LEFT JOIN aurora.asset_models m ON m.id = a.asset_model_id
           LEFT JOIN aurora.manufacturers f ON f.id = m.manufacturer_id
          WHERE a.deleted_at IS NULL
            AND (a.location_id IS NULL
                 OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
            AND ($2::uuid IS NULL OR a.location_path LIKE (
                  SELECT r.path || '%' FROM aurora.locations r WHERE r.id = $2
                ))
            AND ($3::text IS NULL OR a.status::text = $3)
            AND ($5::uuid IS NULL OR a.customer_id = $5)
            AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
            AND ($6::text IS NULL OR fam.family_key = $6)
            AND ($7::uuid IS NULL OR a.asset_category_id = $7)
            AND ($8::uuid IS NULL OR a.asset_model_id = $8)
            AND ($9::text IS NULL OR f.name = $9)
            AND ($10::uuid IS NULL OR a.criticality_id = $10)
            AND ($11::text IS NULL
                 OR ($11 = 'yes' AND a.tracker_tag IS NOT NULL)
                 OR ($11 = 'no' AND a.tracker_tag IS NULL))
          ORDER BY a.name
          LIMIT $4`,
        [
          membershipId,
          locationId,
          status ?? null,
          max,
          customerId,
          family ?? null,
          category === undefined ? null : uuidParam(category, 'category'),
          model === undefined ? null : uuidParam(model, 'model'),
          manufacturer ?? null,
          criticality === undefined ? null : uuidParam(criticality, 'criticality'),
          tracker === 'yes' || tracker === 'no' ? tracker : null,
        ]
      );
      return { items, asset_label: org?.asset_label ?? 'Ativo' };
    });
  }

  /**
   * Os catálogos que o cadastro de equipamento usa: categoria, modelo,
   * criticidade. Cliente e setor vêm de `/customers` — já recortados pelo escopo.
   */
  @Get('form-options')
  @RequirePermissions('asset.read')
  async formOptions(@Req() req: AuroraRequest): Promise<unknown> {
    return withTenant(this.db, req.auroraContext!, async (s) => ({
      categories: await s.query(
        `SELECT id, name, parent_id, family_key FROM aurora.asset_categories
          WHERE archived_at IS NULL ORDER BY position, name`
      ),
      models: await s.query(
        `SELECT m.id, m.name, f.name AS manufacturer_name, m.asset_category_id
           FROM aurora.asset_models m LEFT JOIN aurora.manufacturers f ON f.id = m.manufacturer_id
          WHERE m.archived_at IS NULL ORDER BY f.name NULLS LAST, m.name`
      ),
      criticalities: await s.query(
        `SELECT id, name, score::float8 AS score FROM aurora.criticality_levels
          WHERE archived_at IS NULL ORDER BY score DESC`
      ),
    }));
  }

  /**
   * Ficha do ativo.
   *
   * Traz as specs já resolvidas — as do modelo com as do ativo por cima — e diz
   * quais foram sobrescritas, para a tela poder marcar. Deixar a interface
   * fazer essa combinação significaria que cada tela a faria de um jeito.
   */
  @Get(':id')
  @RequirePermissions('asset.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    const ctx = req.auroraContext!;
    const assetId = uuidParam(id, 'id');
    return withTenant(this.db, ctx, async (s) => {
      const [row] = await s.query<Record<string, unknown>>(
        // COLUNAS NOMEADAS, e dois campos que SAEM da consulta por permissão.
        //
        // Era `a.*`. A tabela tem `internal_notes` e três valores financeiros
        // — compra, residual e reposição — e ambos existem justamente porque
        // nem todo mundo deve vê-los: há `asset.read_financials` no catálogo
        // de permissões desde o começo, sem nenhum lugar que a aplicasse.
        //
        // O filtro é na CONSULTA. Esconder na tela significa que o valor de
        // compra do parque inteiro trafegou até o navegador de quem não pode
        // vê-lo, e está no painel de rede.
        `SELECT a.id, a.name, a.tag, a.serial_number, a.asset_number, a.barcode,
                a.qr_token, a.status::text AS status, a.ownership::text AS ownership,
                a.asset_category_id, a.asset_model_id, a.customer_id,
                a.location_id, a.location_path, a.parent_asset_id,
                a.criticality_id, a.operational_risk, a.default_priority, a.risk_class,
                a.anvisa_registration, a.inmetro_ordinance,
                a.requires_calibration, a.requires_electrical_test,
                a.manufactured_at, a.acquired_at, a.installed_at, a.warranty_until,
                a.useful_life_years, a.decommissioned_at, a.decommission_reason,
                a.replaced_by_asset_id,
                (SELECT p.id FROM aurora.assets p WHERE p.replaced_by_asset_id = a.id) AS replaces_asset_id,
                a.owner_supplier_id, a.specs, a.custom, a.show_on_work_order,
                a.notes, a.sla_policy_id, a.created_at, a.updated_at,
                CASE WHEN $2::boolean THEN a.internal_notes END AS internal_notes,
                CASE WHEN $3::boolean THEN a.purchase_value::text END AS purchase_value,
                CASE WHEN $3::boolean THEN a.residual_value::text END AS residual_value,
                CASE WHEN $3::boolean THEN a.replacement_value::text END AS replacement_value,
                CASE WHEN $3::boolean THEN a.currency END AS currency,
                c.name AS category_name, l.name AS location_name,
                m.name AS model_name, m.specs AS model_specs,
                f.name AS manufacturer_name, cu.name AS customer_name,
                fam.family_key, fam.name AS family_name, a.tracker_kind, a.tracker_tag
           FROM aurora.assets a
           JOIN aurora.asset_categories c ON c.id = a.asset_category_id
           LEFT JOIN aurora.asset_categories fam
                  ON fam.id = CASE WHEN c.family_key IS NOT NULL THEN c.id ELSE c.parent_id END
                 AND fam.family_key IS NOT NULL
           JOIN aurora.customers cu ON cu.id = a.customer_id
           LEFT JOIN aurora.locations l    ON l.id = a.location_id
           LEFT JOIN aurora.asset_models m ON m.id = a.asset_model_id
           LEFT JOIN aurora.manufacturers f ON f.id = m.manufacturer_id
          WHERE a.id = $1 AND a.deleted_at IS NULL`,
        [
          assetId,
          ctx.permissions.has('asset.read_internal_notes'),
          ctx.permissions.has('asset.read_financials'),
        ]
      );
      if (!row) throw new NotFoundError('Ativo', assetId);

      const modelSpecs = (row.model_specs ?? {}) as Record<string, unknown>;
      const assetSpecs = (row.specs ?? {}) as Record<string, unknown>;
      const transfers = await s.query(
        `SELECT id, kind::text, from_location_id, to_location_id, reason, occurred_at, due_back_at, returned_at
           FROM aurora.asset_transfers WHERE asset_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
        [assetId]
      );

      // `model_specs` é insumo do cálculo abaixo, e não campo da resposta:
      // devolvê-lo faria a tela ter duas fontes para a mesma especificação e
      // escolher a errada na metade dos casos.
      delete row.model_specs;

      return {
        ...row,
        specs: effectiveSpecs(modelSpecs, assetSpecs),
        specs_overridden: overriddenSpecKeys(modelSpecs, assetSpecs),
        under_warranty: isUnderWarranty(row.warranty_until as string | null, new Date()),
        age_years: assetAgeYears(
          {
            installedAt: row.installed_at as string | null,
            acquiredAt: row.acquired_at as string | null,
            manufacturedAt: row.manufactured_at as string | null,
          },
          new Date()
        ),
        transfers,
      };
    });
  }

  /**
   * Cadastra o equipamento: cliente E setor obrigatórios, conferidos aqui.
   *
   * Ativo sem local continua legítimo no banco (importação, comodato em
   * trânsito) — por isso a coluna segue anulável. Quem entra pela tela de
   * cadastro, porém, informa onde o equipamento está.
   */
  @Post()
  @RequirePermissions('asset.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const b = parseWith(assetsCreate.body, body);
    const rastreador = conferirRastreador(b.tracker_kind, b.tracker_tag);
    const id = await withTenant(this.db, ctx, async (s) => {
      await conferirClienteESetor(s, membershipId, b.customer_id, b.location_id);
      const novo = await createAsset(s, {
        name: requiredText(b.name, 'name'),
        customerId: b.customer_id,
        assetCategoryId: b.asset_category_id,
        locationId: b.location_id,
        assetModelId: b.asset_model_id ?? null,
        criticalityId: b.criticality_id ?? null,
        tag: b.tag || null,
        serialNumber: b.serial_number || null,
        assetNumber: b.asset_number || null,
      });
      if (rastreador) {
        await s
          .query(`UPDATE aurora.assets SET tracker_kind = $2, tracker_tag = $3 WHERE id = $1`, [
            novo,
            rastreador.kind,
            rastreador.tag,
          ])
          .catch(rastreadorDuplicado);
      }
      return novo;
    });
    return { id };
  }

  /**
   * Edita os dados cadastrais. Cliente e setor NÃO mudam aqui: é
   * transferência, com motivo — e o banco recusa a edição direta (0015).
   */
  @Patch(':id')
  @RequirePermissions('asset.update')
  async update(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const assetId = uuidParam(id, 'id');
    const b = parseWith(assetsUpdate.body, body);

    const colunas: Record<string, string> = {
      name: 'name',
      asset_category_id: 'asset_category_id',
      asset_model_id: 'asset_model_id',
      criticality_id: 'criticality_id',
      tag: 'tag',
      serial_number: 'serial_number',
      asset_number: 'asset_number',
      tracker_kind: 'tracker_kind',
      tracker_tag: 'tracker_tag',
    };
    if (b.tracker_kind !== undefined || b.tracker_tag !== undefined) {
      // O par vai junto: tipo sem identificador (ou o contrário) não localiza nada.
      conferirRastreador(b.tracker_kind ?? null, b.tracker_tag ?? null);
    }
    const sets: string[] = [];
    const valores: unknown[] = [assetId];
    for (const [campo, coluna] of Object.entries(colunas)) {
      const v = (b as Record<string, unknown>)[campo];
      if (v === undefined) continue;
      valores.push(typeof v === 'string' && v.trim() === '' && campo !== 'name' ? null : v);
      sets.push(`${coluna} = $${valores.length}`);
    }
    if (sets.length === 0) throw new ValidationError('nada para alterar', { field: 'body' });

    await withTenant(this.db, ctx, async (s) => {
      const [visivel] = await s.query<{ ok: boolean }>(
        `SELECT true AS ok FROM aurora.assets a
          WHERE a.id = $1 AND a.deleted_at IS NULL
            AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
            AND (a.location_id IS NULL
                 OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))`,
        [assetId, membershipId]
      );
      if (!visivel) throw new NotFoundError('Ativo', assetId);
      valores.push(ctx.actorId);
      await s
        .query(
          `UPDATE aurora.assets SET ${sets.join(', ')}, updated_at = now(), updated_by = $${valores.length}
          WHERE id = $1`,
          valores
        )
        .catch(rastreadorDuplicado);
    });
    return { ok: true };
  }

  /** Transferência: motivo obrigatório, porque movimentação sem motivo não explica nada depois. */
  @Post(':id/transfer')
  @RequirePermissions('asset.transfer')
  async transfer(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { to_location_id?: unknown; reason?: unknown; kind?: unknown; due_back_at?: unknown }
  ): Promise<{ transfer_id: string }> {
    const ctx = req.auroraContext!;
    const kind = body.kind === 'loan' || body.kind === 'return' ? body.kind : 'transfer';
    if (kind === 'loan' && typeof body.due_back_at !== 'string') {
      throw new ValidationError('empréstimo exige data prevista de devolução', { field: 'due_back_at' });
    }
    const transferId = await withTenant(this.db, ctx, (s) =>
      transferAsset(
        s,
        uuidParam(id, 'id'),
        uuidParam(body.to_location_id, 'to_location_id'),
        requiredText(body.reason, 'reason', 5),
        { kind, dueBackAt: typeof body.due_back_at === 'string' ? new Date(body.due_back_at) : null }
      )
    );
    return { transfer_id: transferId };
  }

  /**
   * A vida do equipamento numa lista (gap V2 P1.3 · critério 3).
   *
   * As permissões de OS e de documento são conferidas AQUI, item a item: quem
   * só vê ativo não passa a ver OS por esta porta.
   */
  @Get(':id/timeline')
  @RequirePermissions('asset.read')
  async timeline(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Query() query: unknown
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const q = parseWith(assetsTimeline.query, query);
    const items = await withTenant(this.db, ctx, (s) =>
      assetTimeline(s, uuidParam(id, 'id'), {
        canReadWorkOrders: ctx.permissions.has('work_order.read'),
        canReadDocuments: ctx.permissions.has('document.read'),
        limit: q.limit,
      })
    );
    return { items };
  }

  @Post(':id/decommission')
  @RequirePermissions('asset.decommission')
  async decommission(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { reason?: unknown; replaced_by_asset_id?: unknown }
  ): Promise<{ decommissioned: string }> {
    const ctx = req.auroraContext!;
    const assetId = uuidParam(id, 'id');
    await withTenant(this.db, ctx, (s) =>
      decommissionAsset(s, assetId, requiredText(body.reason, 'reason', 10), {
        replacedByAssetId: optionalUuid(body.replaced_by_asset_id, 'replaced_by_asset_id'),
      })
    );
    return { decommissioned: assetId };
  }

  /**
   * Importação em massa.
   *
   * Devolve o relatório por linha e responde 200 mesmo com linhas recusadas —
   * porque "importou 26.970 de 27.000, aqui estão as 30" é sucesso parcial, não
   * erro. Responder 4xx faria clientes tratarem como falha total e reenviarem a
   * planilha inteira.
   */
  @Post('import')
  @RequirePermissions('asset.import')
  async importar(
    @Req() req: AuroraRequest,
    @Body() body: { customer_id?: unknown; rows?: unknown }
  ): Promise<unknown> {
    const ctx = req.auroraContext!;
    if (!Array.isArray(body.rows)) {
      throw new ValidationError('rows deve ser uma lista de linhas', { field: 'rows' });
    }
    if (body.rows.length > 50_000) {
      throw new ValidationError('lote acima de 50 mil linhas; divida o arquivo', {
        field: 'rows',
        max: 50_000,
      });
    }
    const customerId = uuidParam(body.customer_id, 'customer_id');
    const rows = body.rows.map((r, i) => ({ line: i + 1, ...(r as object) })) as AssetImportRow[];
    return withTenant(this.db, ctx, (s) => importAssets(s, rows, { customerId }));
  }

  /** O que a importação criou e ninguém conferiu ainda. */
  @Get('curation/queue')
  @RequirePermissions('organization.manage_catalogs')
  async curation(@Req() req: AuroraRequest): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => curationQueue(s));
  }
}
