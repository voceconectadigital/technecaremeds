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
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createAsset,
  transferAsset,
  decommissionAsset,
  importAssets,
  curationQueue,
  assetTimeline,
  type Database,
} from '@aurora/db';
import { assetsTimeline } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import {
  ValidationError,
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
    @Query('limit') limit?: string
  ): Promise<{ items: unknown[]; asset_label: string }> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const locationId = location === undefined ? null : uuidParam(location, 'location');
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
                f.name AS manufacturer_name
           FROM aurora.assets a
           JOIN aurora.asset_categories c ON c.id = a.asset_category_id
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
          ORDER BY a.name
          LIMIT $4`,
        [membershipId, locationId, status ?? null, max]
      );
      return { items, asset_label: org?.asset_label ?? 'Ativo' };
    });
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
                f.name AS manufacturer_name
           FROM aurora.assets a
           JOIN aurora.asset_categories c ON c.id = a.asset_category_id
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

  @Post()
  @RequirePermissions('asset.create')
  async create(@Req() req: AuroraRequest, @Body() body: Record<string, unknown>): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    const id = await withTenant(this.db, ctx, (s) =>
      createAsset(s, {
        name: requiredText(body.name, 'name'),
        customerId: uuidParam(body.customer_id, 'customer_id'),
        assetCategoryId: uuidParam(body.asset_category_id, 'asset_category_id'),
        locationId: body.location_id === undefined ? null : uuidParam(body.location_id, 'location_id'),
        assetModelId:
          body.asset_model_id === undefined ? null : uuidParam(body.asset_model_id, 'asset_model_id'),
        criticalityId:
          body.criticality_id === undefined ? null : uuidParam(body.criticality_id, 'criticality_id'),
        tag: typeof body.tag === 'string' ? body.tag : null,
        serialNumber: typeof body.serial_number === 'string' ? body.serial_number : null,
        assetNumber: typeof body.asset_number === 'string' ? body.asset_number : null,
      })
    );
    return { id };
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
