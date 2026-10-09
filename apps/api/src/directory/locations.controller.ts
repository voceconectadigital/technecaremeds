/**
 * Aurora — árvore de locais (SPEC v0.2 §05, §32 · EPIC-003).
 *
 * A rota de mover existe separada da de editar por dois motivos. O primeiro é
 * de permissão: `location.move` é uma capacidade distinta de `location.update`,
 * porque mudar de lugar redesenha escopo de acesso de outras pessoas e um
 * PATCH genérico esconderia isso atrás de "editar local". O segundo é de
 * intenção: `PATCH /locations/:id` com `parent_id` no meio de outros campos
 * torna acidental uma operação que reescreve centenas de linhas.
 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createLocation,
  moveLocation,
  ancestors,
  archiveLocation,
  type Database,
} from '@aurora/db';
import { ForbiddenError } from '@aurora/domain';
import { locationsCreate } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

interface MoveLocationBody {
  parent_id?: unknown;
}

/** Um uuid obrigatório, ou erro que nomeia o campo. */

/**
 * O escopo por local é resolvido a partir do vínculo. Um chamador sem vínculo
 * (contexto de sistema) não tem escopo definido, e "sem escopo" não pode
 * significar "tudo" numa rota que lista dados de tenant.
 */
function requireMembership(membershipId: string | null): string {
  if (!membershipId) {
    throw new ForbiddenError('esta rota exige um vínculo de usuário com a organização');
  }
  return membershipId;
}

@Controller('locations')
export class LocationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Árvore visível ao solicitante.
   *
   * Sem `root`, devolve o que o escopo do vínculo alcança — nunca a árvore
   * inteira da organização "filtrada depois" na interface. Com `root`, devolve
   * aquela subárvore, ainda intersectada com o escopo: pedir um id que está
   * fora do escopo não é um atalho para vê-lo.
   */
  @Get()
  @RequirePermissions('location.read')
  async list(@Req() req: AuroraRequest, @Query('root') root?: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    const rootId = root === undefined ? null : uuidParam(root, 'root');

    // O recorte por escopo fica no banco. Trazer a árvore inteira para filtrar
    // em memória funcionaria com trinta locais e não com trinta mil — e, pior,
    // teria carregado para a aplicação linhas que aquele vínculo não pode ver.
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT l.id, l.parent_id, l.customer_id, l.location_type_id, l.name, l.code,
                l.path, l.depth, l.status::text AS status, l.is_mobile,
                t.name AS location_type_name
           FROM aurora.locations l
           LEFT JOIN aurora.location_types t ON t.id = l.location_type_id
          WHERE l.deleted_at IS NULL
            AND l.id IN (SELECT location_id FROM aurora.accessible_location_ids($1))
            AND ($2::uuid IS NULL OR l.path LIKE (
                  SELECT r.path || '%' FROM aurora.locations r WHERE r.id = $2
                ))
          ORDER BY l.path`,
        [membershipId, rootId]
      )
    );
    return { items };
  }

  /** Trilha de navegação: da raiz até o pai. */
  @Get(':id/ancestors')
  @RequirePermissions('location.read')
  async breadcrumb(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => ancestors(s, uuidParam(id, 'id')));
    return { items };
  }

  @Post()
  @RequirePermissions('location.create')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ id: string }> {
    const ctx = req.auroraContext!;
    // O formato vem do contrato — o mesmo que tipa a tela de clientes. A regra
    // de aninhamento continua no banco: é ela que sabe quais pais o tipo aceita.
    const b = parseWith(locationsCreate.body, body);
    const id = await withTenant(this.db, ctx, (s) =>
      createLocation(s, {
        customerId: b.customer_id,
        parentId: b.parent_id ?? null,
        locationTypeId: b.location_type_id,
        name: b.name,
        code: b.code || null,
        isMobile: b.is_mobile === true,
      })
    );
    return { id };
  }

  /**
   * Move a subárvore. `parent_id: null` promove o local a raiz — desde que o
   * tipo dele aceite ficar na raiz, o que o banco decide, não esta rota.
   */
  @Post(':id/move')
  @RequirePermissions('location.move')
  async move(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: MoveLocationBody
  ): Promise<{ moved: number }> {
    const ctx = req.auroraContext!;
    const moved = await withTenant(this.db, ctx, (s) =>
      moveLocation(s, uuidParam(id, 'id'), optionalUuid(body.parent_id, 'parent_id'))
    );
    return { moved };
  }

  @Post(':id/archive')
  @RequirePermissions('location.update')
  async archive(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ archived: string }> {
    const ctx = req.auroraContext!;
    const locationId = uuidParam(id, 'id');
    await withTenant(this.db, ctx, (s) => archiveLocation(s, locationId));
    return { archived: locationId };
  }
}
