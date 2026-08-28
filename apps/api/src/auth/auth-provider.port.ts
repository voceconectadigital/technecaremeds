/**
 * Aurora — porta de autenticação (SPEC v0.2 §36).
 *
 * O domínio trabalha com identidade, nunca com o SDK de um fornecedor. Trocar
 * Supabase Auth por OIDC, Keycloak ou qualquer outro provedor deve ser
 * implementar esta interface — nada além.
 *
 * Note o que a porta NÃO expõe: nada de token, sessão, refresh, cookie ou
 * qualquer conceito do fornecedor. Só "quem é este portador".
 */

export interface AuthenticatedIdentity {
  /** Identificador do usuário no provedor (`auth_subject` em `aurora.users`). */
  readonly subject: string;
  readonly provider: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name?: string;
}

export interface AuthProvider {
  readonly name: string;
  /**
   * Resolve a identidade a partir do material de autenticação da requisição.
   * Retorna `null` quando não há credencial válida — nunca lança por
   * credencial ausente, apenas por falha de infraestrutura.
   */
  verify(bearerToken: string): Promise<AuthenticatedIdentity | null>;
}

/**
 * Provedor local para desenvolvimento e teste.
 *
 * Aceita tokens no formato `local:<subject>:<email>`. Deliberadamente inútil
 * fora de desenvolvimento: o boot recusa este provedor em produção.
 */
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';

  constructor(private readonly allowed: boolean) {}

  async verify(bearerToken: string): Promise<AuthenticatedIdentity | null> {
    if (!this.allowed) {
      throw new Error('LocalAuthProvider não pode ser usado fora de desenvolvimento ou teste');
    }
    if (!bearerToken?.startsWith('local:')) return null;
    const [, subject, email] = bearerToken.split(':');
    if (!subject || !email) return null;
    return { subject, provider: 'local', email, emailVerified: true, name: email.split('@')[0] };
  }
}
