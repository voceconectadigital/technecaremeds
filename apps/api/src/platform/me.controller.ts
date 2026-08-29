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
import { withPlatformSession, withTenant, type Database } from '@aurora/db';
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

  /**
   * A sessão atual: quem sou, onde estou, e o que posso.
   *
   * POR QUE ESTA ROTA PRECISA EXISTIR
   *
   * A navegação da interface é ciente de permissão (§40): um item de menu que
   * leva a um 403 é pior do que um item ausente — a pessoa clica, recebe uma
   * negativa e não entende se errou ou se o sistema quebrou. Para esconder o
   * item, o frontend precisa saber o que ESTA pessoa pode, e a única fonte
   * disso é o servidor: uma lista deduzida no cliente a partir do papel
   * divergiria da verdade na primeira revogação individual.
   *
   * O que ela devolve é o contexto JÁ RESOLVIDO — o mesmo que o guard usa.
   * Não há segunda avaliação de permissão, e por isso não há como as duas
   * discordarem.
   *
   * Isto NÃO é autorização. Esconder o botão é conveniência; quem nega é o
   * servidor, em toda rota. A lista aqui existe para a tela ser honesta, não
   * para ser a defesa.
   */
  @Get('session')
  async session(@Req() req: AuroraRequest): Promise<SessionView> {
    const ctx = req.auroraContext!;

    const [pessoa] = await withTenant(this.db, ctx, (s) =>
      s.query<{ name: string; email: string; timezone: string; locale: string }>(
        `SELECT u.name, u.email, u.timezone, u.locale
           FROM aurora.users u WHERE u.id = $1`,
        [ctx.actorId]
      )
    );

    const [org] = await withTenant(this.db, ctx, (s) =>
      s.query<{ id: string; slug: string; name: string; asset_label: string }>(
        `SELECT id, slug, name, asset_label FROM aurora.organizations WHERE deleted_at IS NULL`
      )
    );

    const [vinculo] = await withTenant(this.db, ctx, (s) =>
      s.query<{ seat_type: string }>(
        `SELECT seat_type::text AS seat_type FROM aurora.memberships WHERE id = $1`,
        [ctx.membershipId]
      )
    );

    const papeis = await withTenant(this.db, ctx, (s) =>
      s.query<{ key: string }>(
        `SELECT r.key FROM aurora.membership_roles mr
           JOIN aurora.roles r ON r.id = mr.role_id
          WHERE mr.membership_id = $1 AND r.deleted_at IS NULL
          ORDER BY r.key`,
        [ctx.membershipId]
      )
    );

    return {
      user: {
        id: ctx.actorId!,
        name: pessoa?.name ?? '',
        email: pessoa?.email ?? '',
        timezone: pessoa?.timezone ?? 'America/Sao_Paulo',
        locale: pessoa?.locale ?? 'pt-BR',
      },
      organization: {
        id: org?.id ?? ctx.organizationId,
        slug: org?.slug ?? '',
        name: org?.name ?? '',
        asset_label: org?.asset_label ?? 'Ativo',
      },
      membership: {
        id: ctx.membershipId!,
        seat_type: vinculo?.seat_type ?? 'staff',
        roles: papeis.map((r) => r.key),
      },
      // Ordenada para que a resposta seja estável entre chamadas: uma lista
      // que muda de ordem sem mudar de conteúdo estraga qualquer cache.
      permissions: [...ctx.permissions].sort(),
    };
  }
}

interface SessionView {
  user: { id: string; name: string; email: string; timezone: string; locale: string };
  organization: { id: string; slug: string; name: string; asset_label: string };
  membership: { id: string; seat_type: string; roles: string[] };
  permissions: string[];
}
