/**
 * Aurora — equipes e fornecedores (SPEC v0.2 §32 · EPIC-003).
 *
 * Duas listagens de leitura. A escrita de equipe e de fornecedor entra junto
 * com as telas que a usam: expor um POST agora criaria superfície pública sem
 * ninguém do outro lado, e superfície sem uso é superfície sem teste de uso.
 */
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { withTenant, type Database } from '@aurora/db';
import { RequirePermissions } from '../common/permissions.guard';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller()
export class TeamsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Equipes com quem está dentro e quem está indisponível agora.
   *
   * A disponibilidade vem junto de propósito. A auditoria registrou que, na
   * referência, férias e afastamento não apareciam na hora de atribuir — a
   * pessoa era designada e a descoberta vinha depois, pelo chamado atrasado.
   */
  @Get('teams')
  @RequirePermissions('team.read')
  async teams(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT t.id, t.name, t.code, t.status::text, t.calendar_id, t.lead_membership_id,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                            'membership_id', tm.membership_id,
                            'name',          u.name,
                            'role_in_team',  tm.role_in_team,
                            'skills',        tm.skills,
                            'unavailable_now', EXISTS (
                               SELECT 1 FROM aurora.availability_blocks ab
                                WHERE ab.membership_id = tm.membership_id
                                  AND ab.starts_at <= now() AND ab.ends_at > now()
                            ))
                          ORDER BY u.name)
                     FROM aurora.team_members tm
                     JOIN aurora.memberships m ON m.id = tm.membership_id
                     JOIN aurora.users u       ON u.id = m.user_id
                    WHERE tm.team_id = t.id),
                  '[]'::json
                ) AS members
           FROM aurora.teams t
          WHERE t.deleted_at IS NULL
          ORDER BY t.name`
      )
    );
    return { items };
  }

  @Get('suppliers')
  @RequirePermissions('supplier.read')
  async suppliers(@Req() req: AuroraRequest): Promise<{ items: unknown[] }> {
    const ctx = req.auroraContext!;
    const items = await withTenant(this.db, ctx, (s) =>
      s.query(
        `SELECT id, name, trade_name, tax_id, categories, is_authorized_service,
                email, phone, rating, status::text
           FROM aurora.suppliers
          WHERE deleted_at IS NULL
          ORDER BY name`
      )
    );
    return { items };
  }
}
