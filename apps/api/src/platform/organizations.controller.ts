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
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.guard';
import { withTenant, type Database } from '@aurora/db';
import { NotFoundError } from '@aurora/domain';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

interface OrganizationView {
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
      const rows = await s.query<Omit<OrganizationView, 'seats_used'>>(
        `SELECT id, slug, name, locale, timezone, asset_label, plan, seat_limit, status::text
           FROM aurora.organizations
          WHERE deleted_at IS NULL`
      );
      const org = rows[0];
      if (!org) throw new NotFoundError('Organização');

      const [seats] = await s.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM aurora.memberships
          WHERE seat_type = 'staff' AND status = 'active' AND deleted_at IS NULL`
      );
      return { ...org, seats_used: seats?.used ?? 0 };
    });
  }

  /** Membros da organização corrente. */
  @Get('current/members')
  @RequirePermissions('organization.read', 'organization.manage_members')
  async members(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT m.id, m.seat_type::text, m.status::text, m.job_title, m.is_owner,
                u.name, u.email
           FROM aurora.memberships m
           JOIN aurora.users u ON u.id = m.user_id
          WHERE m.deleted_at IS NULL
          ORDER BY u.name`
      )
    );
    return { items };
  }
}
