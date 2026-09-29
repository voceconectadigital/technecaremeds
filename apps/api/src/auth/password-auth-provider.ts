/**
 * Aurora — o provedor de identidade REAL da plataforma (SPEC v0.2 §36).
 *
 * É um adaptador da porta `AuthProvider`, exatamente como o `LocalAuthProvider`
 * e como o adaptador do Supabase Auth será quando houver acesso ao projeto
 * (ADR-025, OQ-16). A aplicação não sabe qual está em uso: o que ela recebe é
 * "quem é este portador", e nada mais.
 *
 * O QUE ELE VERIFICA: um token opaco emitido por `POST /v1/auth/login`, cujo
 * resumo mora em `aurora.user_sessions`. A senha não passa por aqui — ela é
 * conferida uma vez, no login, e o que circula depois é a sessão.
 *
 * POR QUE A VERIFICAÇÃO VAI AO BANCO EM TODA REQUISIÇÃO, e por que isso está
 * certo: é o que faz `revoked_at` valer no instante seguinte. Um JWT evitaria a
 * consulta e, em troca, continuaria válido depois de revogado até expirar —
 * e a saída para isso seria uma lista de revogados, consultada no banco, em toda
 * requisição. O custo é o mesmo e a garantia é pior.
 *
 * A consulta é uma chamada de função com índice único em `token_sha256`, na
 * mesma transação que a resolução de contexto já abriria.
 */
import { identidadePorToken, type Database } from '@aurora/db';
import type { AuthProvider, AuthenticatedIdentity } from './auth-provider.port';

export class PasswordAuthProvider implements AuthProvider {
  readonly name = 'password';

  constructor(private readonly db: Database) {}

  async verify(bearerToken: string): Promise<AuthenticatedIdentity | null> {
    const identidade = await identidadePorToken(this.db, bearerToken);
    if (!identidade) return null;

    return {
      subject: identidade.userId,
      provider: this.name,
      email: identidade.email,
      /*
       * `true`, e é uma afirmação sobre o que o sistema sabe — não um valor de
       * conveniência.
       *
       * A conta nasce por comando administrativo, com o endereço digitado por
       * quem administra, e a senha é definida no mesmo ato. Não existe
       * autocadastro, então não existe endereço que ninguém conferiu.
       *
       * No dia em que houver autocadastro, ESTA LINHA é a que muda, e a
       * verificação de e-mail passa a ser uma coluna em `users`. Deixá-la aqui,
       * explicada, é o que faz essa mudança ser encontrada.
       */
      emailVerified: true,
      name: identidade.name,
    };
  }
}
