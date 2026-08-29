/**
 * Aurora — identidade do portador da credencial.
 *
 * Existe por um motivo concreto encontrado na auto-auditoria: um usuário com
 * vínculo em mais de uma organização recebia 403 `organization.selection_required`
 * e não tinha nenhuma forma de descobrir *quais* organizações escolher. O
 * seletor de organização da interface (§05: "trocar de organização é uma ação
 * explícita, nunca implícita por URL") precisa desta rota.
 *
 * Esta é a única rota que responde antes de haver uma organização no contexto,
 * e por isso resolve a identidade por conta própria.
 */
import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import { withPlatformSession, type Database } from '@aurora/db';
import { DATABASE, AUTH_PROVIDER } from '../common/tokens';
import type { AuthProvider } from '../auth/auth-provider.port';
import type { AuroraRequest } from '../common/context.middleware';

interface OrganizationOption {
  organization_id: string;
  slug: string;
  name: string;
  seat_type: string;
  is_owner: boolean;
}

@Controller('me')
export class MeController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider
  ) {}

  /** Organizações em que o portador da credencial tem vínculo ativo. */
  @Get('organizations')
  async organizations(@Req() req: AuroraRequest): Promise<{ items: OrganizationOption[] }> {
    const authorization = req.header('authorization') ?? '';
    const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
    if (!bearer) throw new UnauthorizedException('Credencial ausente');

    const identity = await this.auth.verify(bearer);
    if (!identity) throw new UnauthorizedException('Credencial inválida');

    const items = await withPlatformSession(this.db, (c) =>
      c.query<OrganizationOption>(
        `SELECT organization_id, organization_slug AS slug, organization_name AS name,
                seat_type, is_owner
           FROM aurora.find_memberships_for_email($1)`,
        [identity.email]
      )
    );
    return { items };
  }
}
