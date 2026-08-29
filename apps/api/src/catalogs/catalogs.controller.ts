/**
 * Aurora — catálogos e campos personalizados pela HTTP (EPIC-004).
 *
 * A rota de sugestão de mesclagem existe porque "mesclagem assistida" só é
 * assistida se o sistema fizer a parte que é dele: achar os candidatos. Pedir
 * que alguém encontre "Fechada" e "fechada" no meio de 651 itens, por conta
 * própria, é o mesmo que não oferecer mesclagem.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  listCatalog,
  createCatalogItem,
  archiveCatalogItem,
  mergeCatalogItems,
  loadCustomFieldDefinitions,
  createCustomFieldDefinition,
  type Database,
} from '@aurora/db';
import {
  CATALOGS,
  catalogByKey,
  suggestMergeGroups,
  ValidationError,
  CUSTOM_FIELD_ENTITIES,
  type CustomFieldEntity,
  type CustomFieldKind,
} from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function knownCatalog(key: string): string {
  if (!catalogByKey(key)) {
    throw new ValidationError(`catálogo desconhecido: ${key}`, {
      field: 'catalog',
      known: CATALOGS.map((c) => c.key),
    });
  }
  return key;
}

@Controller()
export class CatalogsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Os catálogos que existem, e o que cada um significa. */
  @Get('catalogs')
  @RequirePermissions('organization.read')
  catalogs(): { items: unknown[] } {
    return {
      items: CATALOGS.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        is_hierarchical: c.isHierarchical,
        system_keys: c.systemKeys ?? [],
      })),
    };
  }

  @Get('catalogs/:catalog/items')
  @RequirePermissions('organization.read')
  async items(
    @Req() req: AuroraRequest,
    @Param('catalog') catalog: string,
    @Query('include_archived') includeArchived?: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      listCatalog(s, knownCatalog(catalog), { includeArchived: includeArchived === 'true' })
    );
    return { items };
  }

  /**
   * Candidatos a mesclagem, com a decisão deixada para uma pessoa.
   *
   * Deliberadamente não mescla nada sozinha, e cada par vem com o motivo à
   * vista. "Empréstimo" e "Empréstimo de equipamento" são provavelmente a mesma
   * coisa — mas "provavelmente" não autoriza um sistema a unir o histórico de
   * duas listas sem perguntar, e a única pessoa que sabe a resposta trabalha na
   * manutenção, não aqui.
   */
  @Get('catalogs/:catalog/merge-suggestions')
  @RequirePermissions('organization.manage_catalogs')
  async mergeSuggestions(
    @Req() req: AuroraRequest,
    @Param('catalog') catalog: string
  ): Promise<{ suggestions: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      listCatalog(s, knownCatalog(catalog), { includeArchived: false })
    );
    return { suggestions: suggestMergeGroups(items) };
  }

  @Post('catalogs/:catalog/items')
  @RequirePermissions('organization.manage_catalogs')
  async create(
    @Req() req: AuroraRequest,
    @Param('catalog') catalog: string,
    @Body() body: { key?: unknown; label?: unknown; parent_id?: unknown; position?: unknown }
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (typeof body.key !== 'string' || typeof body.label !== 'string') {
      throw new ValidationError('key e label são obrigatórios', { fields: ['key', 'label'] });
    }
    const id = await withTenant(this.db, ctx, (s) =>
      createCatalogItem(s, {
        catalogKey: knownCatalog(catalog),
        key: body.key as string,
        label: body.label as string,
        parentId: body.parent_id === undefined ? null : uuidParam(body.parent_id, 'parent_id'),
        position: typeof body.position === 'number' ? body.position : 0,
      })
    );
    return { id };
  }

  @Post('catalog-items/:id/archive')
  @RequirePermissions('organization.manage_catalogs')
  async archive(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ archived: string }> {
    const ctx = req.auroraContext!;
    const itemId = uuidParam(id, 'id');
    await withTenant(this.db, ctx, (s) => archiveCatalogItem(s, itemId));
    return { archived: itemId };
  }

  @Post('catalog-items/:id/merge')
  @RequirePermissions('organization.manage_catalogs')
  async merge(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: { into?: unknown }
  ): Promise<{ repointed: number }> {
    const ctx = req.auroraContext!;
    const repointed = await withTenant(this.db, ctx, (s) =>
      mergeCatalogItems(s, uuidParam(id, 'id'), uuidParam(body.into, 'into'))
    );
    return { repointed };
  }

  @Get('custom-fields/:entity')
  @RequirePermissions('organization.read')
  async customFields(
    @Req() req: AuroraRequest,
    @Param('entity') entity: string
  ): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => loadCustomFieldDefinitions(s, knownEntity(entity)));
    return { items };
  }

  @Post('custom-fields/:entity')
  @RequirePermissions('organization.manage_custom_fields')
  async createCustomField(
    @Req() req: AuroraRequest,
    @Param('entity') entity: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    if (typeof body.key !== 'string' || typeof body.label !== 'string' || typeof body.kind !== 'string') {
      throw new ValidationError('key, label e kind são obrigatórios', {
        fields: ['key', 'label', 'kind'],
      });
    }
    const id = await withTenant(this.db, ctx, (s) =>
      createCustomFieldDefinition(s, {
        entityType: knownEntity(entity),
        key: body.key as string,
        label: body.label as string,
        kind: body.kind as CustomFieldKind,
        required: body.required === true,
        options: Array.isArray(body.options) ? (body.options as string[]) : [],
        min: typeof body.min === 'number' ? body.min : null,
        max: typeof body.max === 'number' ? body.max : null,
        regex: typeof body.regex === 'string' ? body.regex : null,
        unit: typeof body.unit === 'string' ? body.unit : null,
        defaultValue: body.default_value,
        appliesWhen:
          body.applies_when && typeof body.applies_when === 'object' && !Array.isArray(body.applies_when)
            ? (body.applies_when as Record<string, unknown>)
            : null,
      })
    );
    return { id };
  }
}

function knownEntity(entity: string): CustomFieldEntity {
  if (!(CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entity)) {
    throw new ValidationError(`entidade desconhecida: ${entity}`, {
      field: 'entity',
      known: CUSTOM_FIELD_ENTITIES,
    });
  }
  return entity as CustomFieldEntity;
}
