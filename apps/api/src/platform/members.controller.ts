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
 *
 * A VALIDAÇÃO VEM DO CONTRATO
 *
 * O corpo é conferido pelo mesmo esquema que gera o OpenAPI e tipa o cliente do
 * frontend (`@aurora/contracts`). Escrever aqui uma segunda leitura do corpo —
 * `typeof body.email !== 'string'` e companhia — criaria duas descrições do
 * mesmo formulário, e a segunda erra primeiro no campo opcional.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  withTenant,
  inviteMember,
  setMembershipScope,
  suspendMembership,
  listMembers,
  type Database,
} from '@aurora/db';
import { membersInvite, membersSetScope, membersSuspend } from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/** O escopo tem o mesmo formato no convite e no ajuste — uma leitura só. */
function escopoDoCorpo(body: {
  customer_scope?: 'all' | 'listed';
  customer_ids?: string[];
  location_scope?: 'all' | 'listed';
  location_ids?: string[];
}) {
  return {
    customerScope: body.customer_scope,
    customerIds: body.customer_ids,
    locationScope: body.location_scope,
    locationIds: body.location_ids,
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
   * permissão. O padrão — enxergar tudo — é explícito, e o banco recusa o
   * vínculo sem escopo de qualquer forma (migration 0039).
   */
  @Post()
  @RequirePermissions('organization.manage_members')
  async invite(
    @Req() req: AuroraRequest,
    @Body() body: unknown
  ): Promise<{ membership_id: string; user_id: string; reused_user: boolean }> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(membersInvite.body, body);

    const r = await withTenant(this.db, ctx, (s) =>
      inviteMember(s, {
        email: entrada.email,
        name: entrada.name,
        seatType: entrada.seat_type,
        roleKeys: entrada.role_keys,
        scope: escopoDoCorpo(entrada),
        dailyHours: entrada.daily_hours ?? null,
      })
    );

    return { membership_id: r.membershipId, user_id: r.userId, reused_user: r.reusedUser };
  }

  @Patch(':id([0-9a-fA-F-]{36})/scope')
  @RequirePermissions('organization.manage_members')
  async scope(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(membersSetScope.body, body);
    await withTenant(this.db, ctx, (s) => setMembershipScope(s, id, escopoDoCorpo(entrada)));
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
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const { reason } = parseWith(membersSuspend.body, body);
    await withTenant(this.db, ctx, (s) => suspendMembership(s, id, reason));
    return { ok: true };
  }
}
