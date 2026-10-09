/**
 * Aurora — checklists e procedimentos pela HTTP (NS-003/NS-004, parcial).
 *
 * As permissões `procedure.*` existiam desde a 0006 sem nenhuma rota: o motor
 * versionado (0024) e o protocolo com `procedure_kind` (0052) só ganhavam
 * modelos por seed. Estas rotas expõem ESSE motor — criar com itens, revisar
 * (versão seguinte), publicar — e nada além dele.
 *
 * Não há tipo de item novo, regra nova nem veredito novo. Ponto de medição
 * guarda nominal e tolerâncias como dado; o veredito continua `na`
 * (AURORA-METROLOGIA-FRONTEIRA).
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  listTemplates,
  templateDetail,
  createTemplateWithItems,
  reviseTemplate,
  publishChecklist,
  type TemplateItemInput,
  type Database,
} from '@aurora/db';
import {
  checklistTemplatesCreate,
  checklistTemplatesList,
  checklistTemplatesRevise,
  type TemplateItem,
} from '@aurora/contracts';
import { ForbiddenError } from '@aurora/domain';
import { parseWith } from '../common/contract-validation';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/** Do formato do contrato para o do motor — campo a campo, sem default inventado. */
function paraItem(i: TemplateItem): TemplateItemInput {
  return {
    kind: i.kind,
    label: i.label,
    required: i.required,
    options: i.options ?? [],
    failingOptions: i.failing_options ?? [],
    unit: i.unit ?? null,
    nominalValue: i.nominal_value ?? null,
    toleranceMinus: i.tolerance_minus ?? null,
    tolerancePlus: i.tolerance_plus ?? null,
    toleranceMode: i.tolerance_mode ?? null,
    readingsRequired: i.kind === 'measurement' ? (i.readings_required ?? 1) : null,
  };
}

@Controller('checklist-templates')
export class ProceduresController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('procedure.read')
  async list(@Req() req: AuroraRequest, @Query() query: unknown): Promise<{ items: unknown[] }> {
    const q = parseWith(checklistTemplatesList.query, query);
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      listTemplates(s, { procedureKind: q.kind ?? null })
    );
    return { items };
  }

  @Get(':id')
  @RequirePermissions('procedure.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const templateId = uuidParam(id, 'id');
    return withTenant(this.db, req.auroraContext!, (s) => templateDetail(s, templateId));
  }

  @Post()
  @RequirePermissions('procedure.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string; key: string }> {
    const ctx = req.auroraContext!;
    const b = parseWith(checklistTemplatesCreate.body, body);
    // Publicar na mesma operação exige a permissão de publicar — criar não a implica.
    if (b.publish) assertPode(ctx.permissions, 'procedure.publish');
    return withTenant(this.db, ctx, (s) =>
      createTemplateWithItems(s, {
        title: b.title,
        description: b.description,
        procedureKind: b.procedure_kind ?? null,
        items: b.items.map(paraItem),
        publish: b.publish,
      })
    );
  }

  @Post(':id/revisions')
  @RequirePermissions('procedure.update')
  async revise(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string; key: string; version: number }> {
    const ctx = req.auroraContext!;
    const baseId = uuidParam(id, 'id');
    const b = parseWith(checklistTemplatesRevise.body, body);
    if (b.publish) assertPode(ctx.permissions, 'procedure.publish');
    return withTenant(this.db, ctx, (s) =>
      reviseTemplate(s, baseId, {
        title: b.title,
        description: b.description,
        items: b.items.map(paraItem),
        publish: b.publish,
      })
    );
  }

  @Post(':id/publish')
  @RequirePermissions('procedure.publish')
  async publish(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ ok: true }> {
    const templateId = uuidParam(id, 'id');
    await withTenant(this.db, req.auroraContext!, (s) => publishChecklist(s, templateId));
    return { ok: true };
  }
}

function assertPode(perms: ReadonlySet<string>, perm: string): void {
  if (!perms.has(perm)) {
    // Mesma forma da recusa do guard: 403 com a permissão que falta.
    throw new ForbiddenError(`publicar exige a permissão ${perm}`);
  }
}
