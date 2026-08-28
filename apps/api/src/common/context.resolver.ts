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
import { unsafeCrossTenant, type Database } from '@aurora/db';
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

    return buildContext({
      organizationId: membership.organization_id,
      membershipId: membership.membership_id,
      actorId: membership.user_id,
      actorKind: 'user',
      // permissões entram no EPIC-002; até lá, o contexto carrega conjunto vazio
      permissions: [],
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
      clientIp: req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
  }

  /**
   * Consulta de plataforma: precisa atravessar organizações para descobrir a
   * quais o usuário pertence — é justamente o que ainda não pode ser
   * tenant-scoped, porque o tenant é o resultado desta consulta.
   *
   * Só lê `memberships`/`users`/`membership_scopes` e só devolve linhas do
   * próprio portador da credencial.
   */
  private async findMembership(
    identity: AuthenticatedIdentity,
    requestedOrganizationId: string | null
  ): Promise<MembershipRow> {
    const rows = await unsafeCrossTenant(
      this.db,
      'resolução de identidade: descobrir a quais organizações o portador da credencial pertence',
      (c) =>
        c.query<MembershipRow>(
          `SELECT m.id AS membership_id, m.organization_id, m.user_id, m.status::text, m.seat_type::text,
                  s.customer_scope::text, s.customer_ids, s.location_scope::text, s.location_ids,
                  s.assignment_scope::text, s.warehouse_ids
             FROM aurora.memberships m
             JOIN aurora.users u ON u.id = m.user_id
             LEFT JOIN aurora.membership_scopes s ON s.membership_id = m.id
             JOIN aurora.organizations o ON o.id = m.organization_id
            WHERE lower(u.email) = lower($1)
              AND u.deleted_at IS NULL AND u.status = 'active'
              AND m.deleted_at IS NULL AND m.status = 'active'
              AND o.deleted_at IS NULL AND o.status = 'active'
            ORDER BY m.created_at`,
          [identity.email]
        )
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
