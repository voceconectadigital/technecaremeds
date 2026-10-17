/**
 * Aurora — "Novo Negócio": tenants (reunião 16/10/2026, Fase 11).
 *
 * Nenhuma rota aqui usa permissão de TENANT: ser admin de uma organização não
 * dá poder sobre as outras. A condição é ser admin GLOBAL de plataforma,
 * conferida no banco a cada chamada (`aurora.is_platform_admin`), e concedida
 * só por ato de DBA — não existe rota que conceda.
 */
import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { isPlatformAdmin, listTenants, provisionTenant, type Database } from '@aurora/db';
import { platformTenantsCreate } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('platform')
export class PlatformTenantsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('me')
  async me(@Req() req: AuroraRequest): Promise<{ platform_admin: boolean }> {
    return { platform_admin: await isPlatformAdmin(this.db, req.auroraContext!.actorId) };
  }

  @Get('tenants')
  async list(@Req() req: AuroraRequest): Promise<unknown> {
    return { items: await listTenants(this.db, req.auroraContext!.actorId) };
  }

  @Post('tenants')
  async create(@Req() req: AuroraRequest, @Body() body: unknown): Promise<unknown> {
    const ctx = req.auroraContext!;
    const b = parseWith(platformTenantsCreate.body, body);
    const r = await provisionTenant(
      this.db,
      {
        slug: b.slug,
        name: b.name,
        taxId: b.tax_id ?? null,
        branding: b.branding ?? {},
        domain: b.domain ?? null,
        admin: b.admin,
      },
      { userId: ctx.actorId, requestId: ctx.requestId }
    );
    return {
      organization_id: r.organizationId,
      admin_membership_id: r.adminMembershipId,
      reused_user: r.reusedUser,
    };
  }
}
