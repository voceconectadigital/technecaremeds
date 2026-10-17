/**
 * Aurora — acesso ao banco e unidade de trabalho (SPEC v0.2 §37).
 *
 * Três invariantes que este arquivo existe para garantir:
 *
 *  1. NENHUMA consulta de negócio roda fora de transação.
 *     Só há um caminho para consultar: `withTenant`. Não existe `db.query`
 *     público que atinja tabela tenant-scoped.
 *
 *  2. O contexto é SEMPRE transaction-local.
 *     `set_config(..., is_local => true)` morre no COMMIT/ROLLBACK. Variável de
 *     sessão sobreviveria e vazaria para o próximo tenant quando a conexão
 *     voltasse ao pool — é a falha que o teste de reuso de pool persegue.
 *
 *  3. A transação roda sob o papel de aplicação, não sob o dono das tabelas.
 *     `SET LOCAL ROLE` garante isso mesmo quando o usuário da conexão for
 *     privilegiado (ambiente de teste, migrations, console administrativo).
 */
import type { RequestContext } from '@aurora/domain';
import { withTranslatedErrors } from './pg-errors';
import { TenantContextMissingError } from '@aurora/domain';

/** Executor mínimo de SQL — implementado por PGlite e por node-postgres. */
export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database extends SqlClient {
  /** Abre uma transação. Reverte automaticamente em caso de erro. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly appRole: string | null;
  /**
   * Tempo-limite por transação de tenant (pente-fino 17/10/2026, PF-75).
   *
   * Aplicado com `set_config(..., true)` — LOCAL à transação. Não vai como
   * parâmetro de inicialização da conexão, que o pooler do Supabase em modo
   * transação recusa, e não vaza para a próxima transação da mesma conexão.
   * Ausente: sem limite (suíte, scripts administrativos).
   */
  readonly limites?: LimitesDeTransacao;
}

export interface LimitesDeTransacao {
  /** `statement_timeout`: uma consulta presa não segura a conexão para sempre. */
  readonly consultaMs: number;
  /** `idle_in_transaction_session_timeout`: transação aberta e esquecida é encerrada. */
  readonly ociosaNaTransacaoMs: number;
}

export interface TenantSession extends SqlClient {
  readonly context: RequestContext;
}

/**
 * Executa uma unidade de trabalho sob o contexto de um tenant.
 *
 * Todo repositório recebe o `TenantSession` e nunca a `Database` crua — é o que
 * torna estruturalmente impossível esquecer o contexto.
 */
export async function withTenant<T>(
  db: Database,
  ctx: RequestContext,
  fn: (session: TenantSession) => Promise<T>
): Promise<T> {
  if (!ctx?.organizationId) {
    throw new TenantContextMissingError('withTenant');
  }

  return withTranslatedErrors(() =>
    db.transaction(async (tx) => {
      // O papel de aplicação primeiro: tudo que vier depois é avaliado sob RLS.
      if (db.appRole) {
        await tx.query(`SET LOCAL ROLE ${quoteIdent(db.appRole)}`);
      }

      // is_local = true em todos: o contexto morre no fim da transação.
      await tx.query(
        `SELECT set_config('aurora.organization_id', $1, true),
              set_config('aurora.actor_id',        $2, true),
              set_config('aurora.actor_kind',      $3, true),
              set_config('aurora.request_id',      $4, true),
              set_config('aurora.client_ip',       $5, true),
              set_config('aurora.user_agent',      $6, true),
              set_config('aurora.source',          $7, true),
              set_config('statement_timeout',      $8, true),
              set_config('idle_in_transaction_session_timeout', $9, true)`,
        [
          ctx.organizationId,
          ctx.actorId ?? '',
          ctx.actorKind,
          ctx.requestId,
          ctx.clientIp ?? '',
          ctx.userAgent ?? '',
          ctx.source,
          // '0' = sem limite, o padrão do PostgreSQL.
          String(db.limites?.consultaMs ?? 0),
          String(db.limites?.ociosaNaTransacaoMs ?? 0),
        ]
      );

      const session: TenantSession = {
        context: ctx,
        query: (sql, params) => tx.query(sql, params),
      };
      return fn(session);
    })
  );
}

/**
 * Sessão de plataforma: transação sob o papel da aplicação, SEM contexto de
 * tenant. Existe para o punhado de operações que legitimamente não pertencem a
 * uma organização — hoje, apenas a resolução de identidade, que só alcança
 * dados através de uma função SECURITY DEFINER de consulta fixa (migration
 * 0004). Não dá acesso a tabela de negócio: sem contexto, a RLS nega tudo.
 */
export async function withPlatformSession<T>(
  db: Database,
  fn: (client: SqlClient) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    if (db.appRole) {
      await tx.query(`SET LOCAL ROLE ${quoteIdent(db.appRole)}`);
    }
    return fn(tx);
  });
}

/**
 * Escotilha administrativa, deliberadamente feia de escrever e fácil de achar.
 *
 * Uso legítimo: migrations, publicador do outbox, rotinas de plataforma que
 * precisam varrer organizações. Proibida em código de domínio pela regra de
 * lint `no-restricted-syntax` — ver eslint.config.mjs.
 */
export async function unsafeCrossTenant<T>(
  db: Database,
  reason: string,
  fn: (client: SqlClient) => Promise<T>
): Promise<T> {
  if (!reason || reason.length < 10) {
    throw new TypeError('unsafeCrossTenant exige uma justificativa explícita com ao menos 10 caracteres');
  }
  return db.transaction(async (tx) => {
    // Fidelidade com produção: em runtime a API SEMPRE está sob o papel de
    // aplicação, inclusive aqui. Sem este SET LOCAL ROLE o ambiente de teste
    // rodaria como superusuário e esconderia falhas que só apareceriam em
    // produção — exatamente o tipo de divergência que este projeto não aceita.
    if (db.appRole) {
      await tx.query(`SET LOCAL ROLE ${quoteIdent(db.appRole)}`);
    }
    return fn(tx);
  });
}

/** Aspas em identificador — só para nomes de papel vindos de configuração. */
function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new TypeError(`nome de papel inválido: ${name}`);
  }
  return `"${name}"`;
}
