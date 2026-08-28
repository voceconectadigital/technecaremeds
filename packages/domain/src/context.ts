/**
 * Aurora — contexto de requisição (SPEC v0.2 §05, §37).
 *
 * Regra inegociável: `organizationId` é resolvido NO SERVIDOR a partir do
 * membership do usuário autenticado. Nunca é aceito do cliente como
 * autorização. Um cabeçalho ou corpo de requisição pode *sugerir* qual
 * organização o usuário quer usar; o servidor confirma que existe membership
 * ativo antes de montar o contexto.
 *
 * Este pacote é puro: não conhece HTTP, NestJS, banco nem provedor de auth.
 */

export type ActorKind = 'user' | 'system' | 'automation' | 'api' | 'support' | 'import';

export type RequestSource = 'web' | 'portal' | 'pwa' | 'api' | 'job' | 'import' | 'unknown';

export type ScopeMode = 'all' | 'listed';
export type AssignmentScope = 'all' | 'team' | 'own';

/** Escopo de dados em três eixos, avaliados em conjunção (§05). */
export interface DataScope {
  readonly customerScope: ScopeMode;
  readonly customerIds: readonly string[];
  readonly locationScope: ScopeMode;
  readonly locationIds: readonly string[];
  readonly assignmentScope: AssignmentScope;
  readonly warehouseIds: readonly string[];
}

export const FULL_SCOPE: DataScope = Object.freeze({
  customerScope: 'all',
  customerIds: Object.freeze([]),
  locationScope: 'all',
  locationIds: Object.freeze([]),
  assignmentScope: 'all',
  warehouseIds: Object.freeze([]),
});

/**
 * Contexto completo de uma unidade de trabalho.
 * Imutável por construção — nenhum serviço pode reescrever o tenant no meio
 * do caminho.
 */
export interface RequestContext {
  readonly organizationId: string;
  readonly membershipId: string | null;
  readonly actorId: string | null;
  readonly actorKind: ActorKind;
  readonly permissions: ReadonlySet<string>;
  readonly scope: DataScope;
  readonly requestId: string;
  readonly source: RequestSource;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
}

export interface BuildContextInput {
  organizationId: string;
  membershipId?: string | null;
  actorId?: string | null;
  actorKind?: ActorKind;
  permissions?: Iterable<string>;
  scope?: DataScope;
  requestId: string;
  source?: RequestSource;
  clientIp?: string | null;
  userAgent?: string | null;
}

export function buildContext(input: BuildContextInput): RequestContext {
  if (!input.organizationId) {
    throw new TypeError('RequestContext exige organizationId resolvido pelo servidor');
  }
  if (!input.requestId) {
    throw new TypeError('RequestContext exige requestId para correlação de logs e auditoria');
  }
  return Object.freeze({
    organizationId: input.organizationId,
    membershipId: input.membershipId ?? null,
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? 'system',
    permissions: Object.freeze(new Set(input.permissions ?? [])) as ReadonlySet<string>,
    scope: input.scope ?? FULL_SCOPE,
    requestId: input.requestId,
    source: input.source ?? 'unknown',
    clientIp: input.clientIp ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Contexto de sistema, para jobs e automações.
 * Carrega organização explícita — não existe job "de todas as organizações"
 * escrevendo em tabela tenant-scoped (§37, camada 8).
 */
export function systemContext(
  organizationId: string,
  requestId: string,
  kind: ActorKind = 'system'
): RequestContext {
  return buildContext({
    organizationId,
    actorKind: kind,
    requestId,
    source: 'job',
  });
}

export function hasPermission(ctx: RequestContext, permission: string): boolean {
  return ctx.permissions.has(permission);
}

/** Verificação em lote: exige TODAS as permissões informadas. */
export function hasAllPermissions(ctx: RequestContext, permissions: readonly string[]): boolean {
  return permissions.every((p) => ctx.permissions.has(p));
}
