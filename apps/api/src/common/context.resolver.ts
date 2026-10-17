/**
 * Aurora — resolução do contexto de requisição (SPEC v0.2 §37, camadas 1 e 2).
 *
 * A regra mais importante do arquivo: **o `organization_id` nunca é aceito do
 * cliente como autorização**. O cabeçalho `x-aurora-organization` apenas
 * *sugere* qual organização o usuário quer usar; quem decide é a consulta de
 * membership feita aqui, no servidor.
 *
 * Consequência prática: um atacante que troque o cabeçalho para a organização
 * de outra empresa recebe 403, porque não existe membership dele lá.
 */
import { newId, buildContext, type RequestContext, type RequestSource } from '@aurora/domain';
import { UnauthenticatedError, ForbiddenError } from '@aurora/domain';
import { withPlatformSession, loadEffectivePermissions, type Database } from '@aurora/db';
import type { AuthProvider, AuthenticatedIdentity } from '../auth/auth-provider.port';

export interface IncomingRequest {
  header(name: string): string | undefined;
  ip?: string | undefined;
  path?: string;
}

interface MembershipRow {
  membership_id: string;
  organization_id: string;
  user_id: string;
  status: string;
  seat_type: string;
  customer_scope: string | null;
  customer_ids: string[] | null;
  location_scope: string | null;
  location_ids: string[] | null;
  assignment_scope: string | null;
  warehouse_ids: string[] | null;
}

export class ContextResolver {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthProvider
  ) {}

  async resolve(req: IncomingRequest): Promise<RequestContext> {
    const requestId = req.header('x-request-id') ?? newId();

    const authorization = req.header('authorization') ?? '';
    const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
    if (!bearer) throw new UnauthenticatedError('Credencial ausente');

    const identity = await this.auth.verify(bearer);
    if (!identity) throw new UnauthenticatedError('Credencial inválida');

    const requested = req.header('x-aurora-organization') ?? null;
    const membership = await this.findMembership(identity, requested);

    // permissões efetivas do vínculo, já com deny aplicado (§21)
    const permissions = await loadEffectivePermissions(this.db, membership.membership_id);

    return buildContext({
      organizationId: membership.organization_id,
      membershipId: membership.membership_id,
      actorId: membership.user_id,
      actorKind: 'user',
      permissions,
      scope: {
        customerScope: (membership.customer_scope as 'all' | 'listed') ?? 'all',
        customerIds: membership.customer_ids ?? [],
        locationScope: (membership.location_scope as 'all' | 'listed') ?? 'all',
        locationIds: membership.location_ids ?? [],
        assignmentScope: (membership.assignment_scope as 'all' | 'team' | 'own') ?? 'all',
        warehouseIds: membership.warehouse_ids ?? [],
      },
      requestId,
      source: this.sourceOf(req),
      // `req.ip` e não `x-forwarded-for` cru: o cabeçalho é escrito por quem
      // chama, e a trilha de auditoria gravava o endereço que o cliente quisesse.
      // `req.ip` já respeita a lista de proxies confiáveis (bootstrap.ts).
      clientIp: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
  }

  /**
   * Único caminho de leitura cross-tenant do sistema (migration 0004).
   *
   * A função é SECURITY DEFINER, pertence a um papel dedicado que a API não
   * pode assumir, tem consulta fixa e filtra sempre pelo e-mail do portador da
   * credencial. Não há como usá-la para varrer dados de terceiros.
   */
  private async findMembership(
    identity: AuthenticatedIdentity,
    requestedOrganizationId: string | null
  ): Promise<MembershipRow> {
    const rows = await withPlatformSession(this.db, (c) =>
      c.query<MembershipRow>('SELECT * FROM aurora.find_memberships_for_email($1)', [identity.email])
    );

    if (rows.length === 0) {
      throw new ForbiddenError('membership.active');
    }

    if (requestedOrganizationId) {
      const match = rows.find((r) => r.organization_id === requestedOrganizationId);
      if (!match) {
        // organização existe ou não — não confirmamos. Só sabemos que o
        // portador não tem vínculo ativo nela.
        throw new ForbiddenError('membership.active');
      }
      return match;
    }

    if (rows.length > 1) {
      // ambiguidade nunca é resolvida por adivinhação
      throw new ForbiddenError('organization.selection_required');
    }
    return rows[0]!;
  }

  private sourceOf(req: IncomingRequest): RequestSource {
    const declared = (req.header('x-aurora-source') ?? '').toLowerCase();
    const known: RequestSource[] = ['web', 'portal', 'pwa', 'api', 'job', 'import'];
    return (known as string[]).includes(declared) ? (declared as RequestSource) : 'api';
  }
}
