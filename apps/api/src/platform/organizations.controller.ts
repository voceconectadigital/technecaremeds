/**
 * Aurora — organização corrente (EPIC-001).
 *
 * Controller fino, como manda a SPEC (§36): resolve contexto, delega, devolve.
 * Nenhuma regra de negócio aqui.
 *
 * Repare que não existe rota `GET /organizations/:id`. Não é esquecimento: a
 * organização corrente é determinada pelo membership, não escolhida por
 * parâmetro. Uma rota por id convidaria a tratar o id como autorização — o
 * antipadrão que §37 existe para impedir.
 */
import { Body, Controller, Get, Inject, Patch, Req } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.guard';
import {
  withTenant,
  loadOrganizationConfiguration,
  updateOrganizationConfiguration,
  type Database,
  type OrganizationConfiguration,
} from '@aurora/db';
import { NotFoundError } from '@aurora/domain';
import { organizationsUpdateConfiguration } from '@aurora/contracts';
import { parseWith } from '../common/contract-validation';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

interface OrganizationView extends OrganizationConfiguration {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  asset_label: string;
  plan: string;
  seat_limit: number;
  seats_used: number;
  status: string;
}

@Controller('organizations')
export class OrganizationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Organização do contexto — nunca recebe id por parâmetro. */
  @Get('current')
  @RequirePermissions('organization.read')
  async current(@Req() req: AuroraRequest): Promise<OrganizationView> {
    const ctx = req.auroraContext!;
    return withTenant(this.db, ctx, async (s) => {
      const rows = await s.query<
        Omit<OrganizationView, 'seats_used' | keyof OrganizationConfiguration> & {
          settings: { branding?: Record<string, unknown>; domain?: { host: string; status: string } } | null;
        }
      >(
        `SELECT id, slug, name, locale, timezone, asset_label, plan, seat_limit, status::text, settings
           FROM aurora.organizations
          WHERE deleted_at IS NULL`
      );
      const linha = rows[0];
      if (!linha) throw new NotFoundError('Organização');
      const { settings, ...base } = linha;
      const org = {
        ...base,
        branding: { display_name: base.name, ...(settings?.branding ?? {}) },
        domain: settings?.domain ?? null,
      };

      const [seats] = await s.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM aurora.memberships
          WHERE seat_type = 'staff' AND status = 'active' AND deleted_at IS NULL`
      );
      return { ...org, seats_used: seats?.used ?? 0, ...(await loadOrganizationConfiguration(s)) };
    });
  }

  /**
   * Modo de uso e recursos habilitados (gap V2 P0.4).
   *
   * Recurso habilitado não é permissão: diz o que a organização USA, e quem
   * pode o quê continua no RBAC. Por isso a rota pede `organization.update`, e
   * não uma permissão por módulo.
   */
  @Patch('current/configuration')
  @RequirePermissions('organization.update')
  async configure(@Req() req: AuroraRequest, @Body() body: unknown): Promise<OrganizationConfiguration> {
    const ctx = req.auroraContext!;
    const entrada = parseWith(organizationsUpdateConfiguration.body, body);
    return withTenant(this.db, ctx, (s) =>
      updateOrganizationConfiguration(s, {
        usageMode: entrada.usage_mode,
        enabledFeatures: entrada.enabled_features,
        requireOperationalResult: entrada.require_operational_result,
      })
    );
  }
}
