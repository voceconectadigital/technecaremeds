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
  mttr,
  mtbf,
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
  straightLineDepreciation,
  isQrToken,
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
/**
 * Valor do bem e nº da NF são dado financeiro: a API os devolve só a quem tem
 * `asset.read_financials`, e só essa pessoa os informa. Quem não tem a permissão e
 * manda o campo recebe 403, em vez de ver o valor ser gravado e sumir da resposta.
 */
function conferirPermissaoFinanceira(
  ctx: { permissions: ReadonlySet<string> },
  b: { purchase_value?: unknown; acquisition_invoice?: unknown }
): void {
  const mexeEmFinanceiro = b.purchase_value !== undefined || b.acquisition_invoice !== undefined;
  if (mexeEmFinanceiro && !ctx.permissions.has('asset.read_financials')) {
    throw new ForbiddenError('valor do bem e nota fiscal exigem a permissão asset.read_financials');
  }
}

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
    @Query('tracker') tracker?: string,
    @Query('qr') qr?: string
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
            -- Etiqueta lida pela câmera (/q/:token): o token e SÓ ele, dentro do escopo de quem lê.
            AND ($12::text IS NULL OR a.qr_token = $12)
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
          qr ? (isQrToken(qr) ? qr : 'etiqueta-invalida') : null,
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
                CASE WHEN $3::boolean THEN a.acquisition_invoice END AS acquisition_invoice,
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
        // Depreciação em linha reta: o percentual e os anos saem para quem vê o ativo; os
        // valores só existem quando o valor de compra saiu da consulta (asset.read_financials).
        depreciation: straightLineDepreciation({
          acquiredAt: row.acquired_at as string | null,
          usefulLifeYears: row.useful_life_years as number | null,
          purchaseValue:
            row.purchase_value === null || row.purchase_value === undefined
              ? null
              : Number(row.purchase_value),
          residualValue:
            row.residual_value === null || row.residual_value === undefined
              ? null
              : Number(row.residual_value),
          now: new Date(),
        }),
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
    conferirPermissaoFinanceira(ctx, b);
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
        acquiredAt: b.acquired_at ?? null,
        purchaseValue: b.purchase_value ?? null,
        anvisaRegistration: b.anvisa_registration || null,
        usefulLifeYears: b.useful_life_years ?? null,
        acquisitionInvoice: b.acquisition_invoice || null,
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
      anvisa_registration: 'anvisa_registration',
      acquired_at: 'acquired_at',
      useful_life_years: 'useful_life_years',
      purchase_value: 'purchase_value',
      acquisition_invoice: 'acquisition_invoice',
    };
    conferirPermissaoFinanceira(ctx, b);
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

  /**
   * Indicadores PONTUAIS do equipamento (conversa com o cliente, 21/10/2026): a ficha de
   * vida mostra, só para este ativo, o que o painel mostra para o parque.
   *
   * Reaproveita as métricas do painel com o filtro de ativo — a mesma definição de MTTR e
   * MTBF, e a mesma cobertura: ativo com uma única corretiva não tem MTBF, e a resposta
   * diz isso (`null`), em vez de inventar um número.
   */
  @Get(':id/indicators')
  @RequirePermissions('asset.read')
  async indicators(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Query('days') days?: string
  ): Promise<Record<string, unknown>> {
    const ctx = req.auroraContext!;
    if (!ctx.membershipId) throw new ForbiddenError('esta rota exige um vínculo com a organização');
    const membershipId = ctx.membershipId;
    const assetId = uuidParam(id, 'id');
    const dias = Math.min(Math.max(Number.parseInt(days ?? '365', 10) || 365, 7), 1825);
    const to = new Date();
    const from = new Date(to.getTime() - dias * 24 * 60 * 60 * 1000);

    return withTenant(this.db, ctx, async (s) => {
      const [visivel] = await s.query<{ ok: boolean }>(
        `SELECT true AS ok FROM aurora.assets a
          WHERE a.id = $1 AND a.deleted_at IS NULL
            AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($2))
            AND (a.location_id IS NULL
                 OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2)))`,
        [assetId, membershipId]
      );
      if (!visivel) throw new NotFoundError('Ativo', assetId);

      const periodo = { from, to };
      const filtro = { assetId };
      const tempoDeReparo = await mttr(s, periodo, filtro);
      const entreFalhas = await mtbf(s, periodo, filtro);
      const [conta] = await s.query<{
        total: string;
        corretivas: string;
        preventivas: string;
        abertas: string;
        ultima_corretiva: Date | null;
        minutos_parado: string;
      }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE f.work_order_type_key = 'corrective')::text AS corretivas,
                count(*) FILTER (WHERE f.work_order_type_key = 'preventive')::text AS preventivas,
                count(*) FILTER (WHERE f.completed_at IS NULL)::text AS abertas,
                max(f.opened_at) FILTER (WHERE f.work_order_type_key = 'corrective') AS ultima_corretiva,
                COALESCE(sum(f.resolution_minutes) FILTER (WHERE f.work_order_type_key = 'corrective'), 0)::text AS minutos_parado
           FROM aurora.fact_work_order f
          WHERE f.asset_id = $1 AND NOT f.cancelled
            AND f.opened_at >= $2 AND f.opened_at < $3`,
        [assetId, from, to]
      );

      return {
        period: { from: from.toISOString(), to: to.toISOString(), days: dias },
        work_orders: {
          total: Number(conta!.total),
          corrective: Number(conta!.corretivas),
          preventive: Number(conta!.preventivas),
          open: Number(conta!.abertas),
        },
        // `null` = sem amostra suficiente. Zero diria "reparo instantâneo", e isso seria falso.
        mttr_minutes: tempoDeReparo.data.value,
        mttr_samples: tempoDeReparo.data.samples,
        mtbf_minutes: entreFalhas.data.value,
        mtbf_samples: entreFalhas.data.samples,
        downtime_minutes: Number(conta!.minutos_parado),
        last_corrective_at: conta!.ultima_corretiva,
      };
    });
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
