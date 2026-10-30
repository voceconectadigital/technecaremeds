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
  setMembershipStatus,
  updateMemberDetails,
  getMember,
  listMembers,
  type Database,
} from '@aurora/db';
import {
  membersInvite,
  membersSetScope,
  membersSuspend,
  membersUpdate,
  membersSetStatus,
} from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { uuidParam } from '../common/params';
import { parseWith } from '../common/contract-validation';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

/** Os dados de cadastro têm o mesmo formato no "Adicionar usuário" e na edição. */
function cadastroDoCorpo(body: {
  cpf?: string | null;
  phone?: string | null;
  company_name?: string | null;
  company_tax_id?: string | null;
  job_title?: string | null;
  registrations?: { kind: string; number: string; region?: string | null }[];
}) {
  return {
    cpf: body.cpf,
    phone: body.phone,
    companyName: body.company_name,
    companyTaxId: body.company_tax_id,
    jobTitle: body.job_title,
    registrations: body.registrations,
  };
}

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
        profileKey: entrada.profile,
        ...cadastroDoCorpo(entrada),
        seatType: entrada.seat_type,
        roleKeys: entrada.role_keys,
        scope: escopoDoCorpo(entrada),
        dailyHours: entrada.daily_hours ?? null,
      })
    );

    return { membership_id: r.membershipId, user_id: r.userId, reused_user: r.reusedUser };
  }

  @Get(':id')
  @RequirePermissions('organization.manage_members')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, (s) => getMember(s, uuidParam(id, 'id')));
  }

  @Patch(':id')
  @RequirePermissions('organization.manage_members')
  async update(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(membersUpdate.body, body);
    await withTenant(this.db, ctx, (s) =>
      updateMemberDetails(s, uuidParam(id, 'id'), cadastroDoCorpo(entrada))
    );
    return { ok: true };
  }

  /**
   * Ativa, suspende ou bloqueia. A recusa de acesso de quem foi suspenso ou
   * bloqueado é do servidor (resolução de vínculo), não desta tela.
   */
  @Post(':id/status')
  @RequirePermissions('organization.manage_members')
  async status(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const { status, reason } = parseWith(membersSetStatus.body, body);
    await withTenant(this.db, ctx, (s) => setMembershipStatus(s, uuidParam(id, 'id'), status, reason));
    return { ok: true };
  }

  @Patch(':id/scope')
  @RequirePermissions('organization.manage_members')
  async scope(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(membersSetScope.body, body);
    await withTenant(this.db, ctx, (s) => setMembershipScope(s, uuidParam(id, 'id'), escopoDoCorpo(entrada)));
    return { ok: true };
  }

  /**
   * Suspende o vínculo. O motivo é obrigatório e vai para o evento: seis meses
   * depois, "por que essa pessoa perdeu o acesso?" precisa ter resposta.
   */
  @Post(':id/suspension')
  @RequirePermissions('organization.manage_members')
  async suspend(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const ctx = req.auroraContext!;
    const { reason } = parseWith(membersSuspend.body, body);
    await withTenant(this.db, ctx, (s) => suspendMembership(s, uuidParam(id, 'id'), reason));
    return { ok: true };
  }
}
