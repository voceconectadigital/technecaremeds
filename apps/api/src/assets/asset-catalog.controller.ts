/**
 * Aurora — catálogo de equipamento pela HTTP: tipos e modelos (reunião 16/10/2026, Fase 3).
 *
 * As famílias (Suporte à vida, Diagnóstico, Terapia, Tratamento, Equipamentos
 * de apoio) vêm do provisionamento e da 0063; aqui se cadastra o TIPO dentro
 * de uma família e o MODELO de um tipo. Antes destas rotas, uma organização
 * nova não tinha como cadastrar o primeiro equipamento sem script.
 *
 * Permissão: `organization.manage_catalogs` — curar taxonomia é de quem
 * responde por ela, e evita o catálogo virar texto livre com outro nome.
 */
import { Body, Controller, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  withTenant,
  createAssetCategory,
  findOrCreateAssetModel,
  findOrCreateManufacturer,
  type Database,
  type TenantSession,
} from '@aurora/db';
import { ConflictError, NotFoundError, ValidationError } from '@aurora/domain';
import { assetCategoriesCreate, assetCategoriesSetFamily, assetModelsCreate } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

async function exigirFamilia(s: TenantSession, familyId: string): Promise<void> {
  const [f] = await s.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.asset_categories
      WHERE id = $1 AND family_key IS NOT NULL AND archived_at IS NULL`,
    [familyId]
  );
  if (!f) throw new ValidationError('escolha uma das famílias de equipamento', { field: 'family_id' });
}

function nomeRepetido(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('asset_categories_name_uq')) {
    throw new ConflictError('já existe um tipo ou família com esse nome');
  }
  throw e;
}

@Controller()
export class AssetCatalogController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post('asset-categories')
  @RequirePermissions('organization.manage_catalogs')
  async createType(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    const b = parseWith(assetCategoriesCreate.body, body);
    const id = await withTenant(this.db, req.auroraContext!, async (s) => {
      await exigirFamilia(s, b.family_id);
      return createAssetCategory(s, {
        name: b.name,
        parentId: b.family_id,
        requiresCalibration: b.requires_calibration,
        requiresElectricalTest: b.requires_electrical_test,
      }).catch(nomeRepetido);
    });
    return { id };
  }

  @Patch('asset-categories/:id')
  @RequirePermissions('organization.manage_catalogs')
  async setFamily(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const categoryId = uuidParam(id, 'id');
    const b = parseWith(assetCategoriesSetFamily.body, body);
    await withTenant(this.db, req.auroraContext!, async (s) => {
      const [c] = await s.query<{ family_key: string | null }>(
        `SELECT family_key FROM aurora.asset_categories WHERE id = $1 AND archived_at IS NULL`,
        [categoryId]
      );
      if (!c) throw new NotFoundError('tipo de equipamento', categoryId);
      if (c.family_key) throw new ValidationError('uma família não fica dentro de outra', { field: 'id' });
      await exigirFamilia(s, b.family_id);
      await s.query(`UPDATE aurora.asset_categories SET parent_id = $2 WHERE id = $1`, [
        categoryId,
        b.family_id,
      ]);
    });
    return { ok: true };
  }

  @Post('asset-models')
  @RequirePermissions('organization.manage_catalogs')
  async createModel(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    const b = parseWith(assetModelsCreate.body, body);
    const id = await withTenant(this.db, req.auroraContext!, async (s) => {
      const [c] = await s.query<{ ok: boolean }>(
        `SELECT true AS ok FROM aurora.asset_categories WHERE id = $1 AND archived_at IS NULL`,
        [b.asset_category_id]
      );
      if (!c) throw new ValidationError('tipo de equipamento não encontrado', { field: 'asset_category_id' });
      const fab = await findOrCreateManufacturer(s, b.manufacturer, { verified: true });
      const m = await findOrCreateAssetModel(s, {
        manufacturerId: fab.id,
        categoryId: b.asset_category_id,
        name: b.name,
        verified: true,
      });
      return m.id;
    });
    return { id };
  }
}
