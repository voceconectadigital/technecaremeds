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
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  createLocation,
  moveLocation,
  ancestors,
  archiveLocation,
  type Database,
  type TenantSession,
} from '@aurora/db';
import { ForbiddenError, NotFoundError, ValidationError, type RequestContext } from '@aurora/domain';
import { locationsCreate, locationsUpdate } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { optionalUuid, uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import { escopoRestrito } from '../common/scope-sql';
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

/**
 * Onde o local vai parar — criado ou movido — cabe no escopo de quem pede?
 * (pente-fino 17/10)
 *
 * As rotas por id (`/locations/:id/...`) já passam pelo ScopeGuard; o que
 * faltava era o DESTINO: o cliente e o pai vêm no corpo. Fora do escopo é 404,
 * como em qualquer rota. Quem tem escopo por local não cria (nem promove) raiz:
 * a raiz nova ficaria fora do próprio escopo no instante seguinte.
 */
async function destinoNoEscopo(
  s: TenantSession,
  ctx: RequestContext,
  permissao: string,
  customerId: string | null,
  parentId: string | null
): Promise<void> {
  if (!escopoRestrito(ctx)) return;
  if (customerId) {
    const [ok] = await s.query(`SELECT 1 FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`, [
      ctx.membershipId,
      customerId,
    ]);
    if (!ok) throw new NotFoundError('cliente', customerId);
  }
  if (parentId) {
    const [ok] = await s.query(`SELECT 1 FROM aurora.accessible_location_ids($1) WHERE location_id = $2`, [
      ctx.membershipId,
      parentId,
    ]);
    if (!ok) throw new NotFoundError('local', parentId);
  } else if (ctx.scope.locationScope !== 'all') {
    throw new ForbiddenError(
      `${permissao} — com escopo por local, o local fica dentro de um local do seu escopo`
    );
  }
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
                t.name AS location_type_name, t.key AS location_type_key
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
    const id = await withTenant(this.db, ctx, async (s) => {
      await destinoNoEscopo(s, ctx, 'location.create', b.customer_id, b.parent_id ?? null);
      return createLocation(s, {
        customerId: b.customer_id,
        parentId: b.parent_id ?? null,
        locationTypeId: b.location_type_id,
        name: b.name,
        code: b.code || null,
        isMobile: b.is_mobile === true,
      });
    });
    return { id };
  }

  /**
   * Renomeia o local — o setor "UTI 2" que virou "UTI Pediátrica".
   *
   * Só nome e código: mudar de pai é `move` (outra permissão), e mudar de
   * cliente não existe. O caminho materializado é feito de ids, então
   * renomear não reescreve nada abaixo. Fora do escopo de quem edita: 404.
   */
  @Patch(':id')
  @RequirePermissions('location.update')
  async update(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const membershipId = requireMembership(ctx.membershipId);
    const locationId = uuidParam(id, 'id');
    const b = parseWith(locationsUpdate.body, body);
    if (b.name === undefined && b.code === undefined) {
      throw new ValidationError('nada para alterar', { field: 'name' });
    }
    await withTenant(this.db, ctx, async (s) => {
      const [visivel] = await s.query<{ ok: boolean }>(
        `SELECT true AS ok FROM aurora.accessible_location_ids($1) WHERE location_id = $2`,
        [membershipId, locationId]
      );
      if (!visivel) throw new NotFoundError('local', locationId);
      await s.query(
        `UPDATE aurora.locations
            SET name = COALESCE($2, name),
                code = CASE WHEN $3::boolean THEN $4 ELSE code END,
                updated_at = now(), updated_by = $5
          WHERE id = $1 AND deleted_at IS NULL`,
        [locationId, b.name ?? null, b.code !== undefined, b.code || null, ctx.actorId]
      );
    });
    return { ok: true };
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
    const novoPai = optionalUuid(body.parent_id, 'parent_id');
    const moved = await withTenant(this.db, ctx, async (s) => {
      await destinoNoEscopo(s, ctx, 'location.move', null, novoPai);
      return moveLocation(s, uuidParam(id, 'id'), novoPai);
    });
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
