/**
 * Aurora — tradução de erro do PostgreSQL para erro de domínio.
 *
 * DEFEITO QUE ISTO CORRIGE
 *
 * Encontrado por teste do EPIC-003: criar um local com aninhamento inválido
 * respondia **500**. A regra estava certa e o gatilho recusava corretamente,
 * mas a recusa chegava à borda como erro desconhecido — e a pessoa via "erro
 * interno" no lugar de "o tipo Unidade só pode ficar sob: ...".
 *
 * Isso importa além da estética. Um 500 diz "o servidor quebrou, tente de novo";
 * um 422 diz "o pedido está errado, corrija assim". Trocar um pelo outro faz o
 * cliente repetir requisição que nunca vai passar e esconde, no meio do ruído,
 * os 500 que são bug de verdade.
 *
 * ONDE A LINHA É TRAÇADA
 *
 * Só os SQLSTATE da classe 23 (violação de integridade) viram erro do cliente.
 * Eles significam, sem ambiguidade, que o dado enviado não é aceitável. Tudo o
 * mais — sintaxe, permissão negada, conexão, deadlock — continua sendo 500,
 * porque é problema nosso e precisa aparecer como problema nosso.
 *
 * E a mensagem só é repassada quando ela foi escrita por nós. Uma exceção
 * levantada por `RAISE` em função nossa não traz `constraint`; uma violação
 * detectada pelo próprio PostgreSQL traz. No segundo caso a mensagem original
 * vai para os detalhes, e o cliente recebe o nome da regra, não o texto interno.
 */
import { ConflictError, ValidationError, type DomainError } from '@aurora/domain';

interface PostgresError {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
}

function asPostgresError(err: unknown): PostgresError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as PostgresError;
  return typeof e.code === 'string' ? e : null;
}

/**
 * Devolve o erro de domínio correspondente, ou `null` quando o erro não é uma
 * violação de integridade — e nesse caso quem chamou deve deixá-lo subir.
 */
export function translatePostgresError(err: unknown): DomainError | null {
  const pg = asPostgresError(err);
  if (!pg?.code) return null;

  const nossoRaise = !pg.constraint;
  const detalhes: Record<string, unknown> = {
    sqlstate: pg.code,
    ...(pg.constraint ? { constraint: pg.constraint } : {}),
    ...(pg.table ? { table: pg.table } : {}),
  };

  switch (pg.code) {
    // unique_violation e exclusion_violation: o estado pedido conflita com algo
    // que já existe. 409, porque repetir sem mudar nada não vai resolver.
    case '23505':
    case '23P01': {
      const msg = nossoRaise
        ? (pg.message ?? 'conflito com registro existente')
        : `já existe um registro com estes dados (${pg.constraint})`;
      return new ConflictError(msg, { ...detalhes, ...(nossoRaise ? {} : { pg_message: pg.message }) });
    }

    // check_violation, foreign_key_violation, not_null_violation: o dado enviado
    // não satisfaz uma regra. 422, e a mensagem precisa dizer qual.
    case '23514':
    case '23503':
    case '23502': {
      const msg = nossoRaise
        ? (pg.message ?? 'dados inválidos')
        : pg.code === '23503'
          ? `o registro referenciado não existe ou está fora do seu acesso (${pg.constraint})`
          : pg.code === '23502'
            ? `campo obrigatório não informado${pg.column ? `: ${pg.column}` : ''}`
            : `os dados não satisfazem a regra "${pg.constraint}"`;
      return new ValidationError(msg, { ...detalhes, ...(nossoRaise ? {} : { pg_message: pg.message }) });
    }

    default:
      return null;
  }
}

/**
 * Executa e converte violação de integridade em erro de domínio.
 * Erro que não seja da classe 23 sobe intacto, com a pilha original.
 */
export async function withTranslatedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const traduzido = translatePostgresError(err);
    if (traduzido) {
      (traduzido as { cause?: unknown }).cause = err;
      throw traduzido;
    }
    throw err;
  }
}
