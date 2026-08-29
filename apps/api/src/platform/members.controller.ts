/**
 * Aurora — membros da organização pela HTTP (SPEC v0.2 §05 · EPIC-002).
 *
 * Quatro rotas, e nenhuma delas aceita `organization_id`: a organização vem do
 * contexto resolvido pelo vínculo de quem chama. Aceitar o identificador no
 * corpo transformaria um campo de formulário em autorização, que é o antipadrão
 * que a §37 existe para impedir.
 *
 * Não existe `DELETE /members/:id`. Vínculo se suspende, não se apaga: a trilha
 * de auditoria precisa continuar tendo dono, e uma OS executada por alguém que
 * deixou a empresa não pode passar a ter sido executada por ninguém.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  withTenant,
  inviteMember,
  setMembershipScope,
  suspendMembership,
  listMembers,
  SEAT_TYPES,
  SCOPE_MODES,
  type Database,
  type SeatType,
  type ScopeMode,
} from '@aurora/db';
import { isUuid, ValidationError } from '@aurora/domain';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

function texto(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} é obrigatório`, { field });
  }
  return value.trim();
}

function listaDeUuids(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} deve ser uma lista de identificadores`, { field });
  }
  for (const v of value) {
    if (typeof v !== 'string' || !isUuid(v)) {
      throw new ValidationError(`${field} contém um identificador inválido`, { field });
    }
  }
  return value as string[];
}

function modo(value: unknown, field: string): ScopeMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !(SCOPE_MODES as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} inválido`, { field, allowed: SCOPE_MODES });
  }
  return value as ScopeMode;
}

/** O escopo vem do mesmo formato no convite e no ajuste — uma leitura só. */
function escopoDoCorpo(body: Record<string, unknown>) {
  return {
    customerScope: modo(body.customer_scope, 'customer_scope'),
    customerIds: listaDeUuids(body.customer_ids, 'customer_ids'),
    locationScope: modo(body.location_scope, 'location_scope'),
    locationIds: listaDeUuids(body.location_ids, 'location_ids'),
  };
}

@Controller('organizations/current/members')
export class MembersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('organization.manage_members')
  async list(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) => listMembers(s));
    return { items };
  }

  /**
   * Convida uma pessoa.
   *
   * O escopo é parte do convite, não um segundo passo: a pessoa que entra sem
   * escopo vê uma tela vazia e não tem como distinguir isso de falta de
   * permissão. O padrão — enxergar tudo — é explícito no corpo do módulo, e o
   * banco recusa o vínculo sem escopo de qualquer forma (migration 0039).
   */
  @Post()
  @RequirePermissions('organization.manage_members')
  async invite(
    @Req() req: AuroraRequest,
    @Body() body: Record<string, unknown>
  ): Promise<{ membership_id: string; user_id: string; reused_user: boolean }> {
    const ctx = req.auroraContext!;

    const seat = body.seat_type;
    if (seat !== undefined && (typeof seat !== 'string' || !(SEAT_TYPES as readonly string[]).includes(seat))) {
      throw new ValidationError('seat_type inválido', { field: 'seat_type', allowed: SEAT_TYPES });
    }

    const papeis = body.role_keys;
    if (papeis !== undefined && (!Array.isArray(papeis) || papeis.some((r) => typeof r !== 'string'))) {
      throw new ValidationError('role_keys deve ser uma lista de chaves de papel', {
        field: 'role_keys',
      });
    }

    const r = await withTenant(this.db, ctx, (s) =>
      inviteMember(s, {
        email: texto(body.email, 'email'),
        name: texto(body.name, 'name'),
        seatType: seat as SeatType | undefined,
        roleKeys: papeis as string[] | undefined,
        scope: escopoDoCorpo(body),
        dailyHours: typeof body.daily_hours === 'number' ? body.daily_hours : null,
      })
    );

    return { membership_id: r.membershipId, user_id: r.userId, reused_user: r.reusedUser };
  }

  @Patch(':id([0-9a-fA-F-]{36})/scope')
  @RequirePermissions('organization.manage_members')
  async scope(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => setMembershipScope(s, id, escopoDoCorpo(body)));
    return { ok: true };
  }

  /**
   * Suspende o vínculo. O motivo é obrigatório e vai para o evento: seis meses
   * depois, "por que essa pessoa perdeu o acesso?" precisa ter resposta.
   */
  @Post(':id([0-9a-fA-F-]{36})/suspension')
  @RequirePermissions('organization.manage_members')
  async suspend(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    await withTenant(this.db, ctx, (s) => suspendMembership(s, id, texto(body.reason, 'reason')));
    return { ok: true };
  }
}
