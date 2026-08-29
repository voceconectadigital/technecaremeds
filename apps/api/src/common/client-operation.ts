/**
 * Aurora — a borda HTTP da sincronização de campo (SPEC v0.2 §20 · EPIC-014).
 *
 * A ROTA É A MESMA, ONLINE E OFFLINE.
 *
 * Não existe um `/sync` paralelo com uma segunda cópia das regras. O aparelho
 * do técnico chama exatamente `POST /work-orders/:id/timer/start`, como a tela
 * do computador chama — e acrescenta um cabeçalho dizendo qual operação é
 * aquela. Duas superfícies para a mesma ação divergiriam, e a que divergiria é
 * sempre a menos usada: a de campo, que ninguém consegue reproduzir da mesa.
 *
 * O cabeçalho é OPCIONAL de propósito. Quem está online não precisa dele — não
 * há fila, não há retentativa cega, e exigir o identificador de todo mundo só
 * transformaria a garantia numa burocracia.
 */
import {
  withClientOperation,
  recordClientConflict,
  type ClientOperation,
  type Database,
  type TenantSession,
} from '@aurora/db';
import { withTenant } from '@aurora/db';
import { ConflictError, ValidationError, isDomainError } from '@aurora/domain';
import type { AuroraRequest } from './context.middleware';

/** O cabeçalho que carrega o identificador gerado no aparelho. */
export const CLIENT_OPERATION_HEADER = 'x-aurora-client-operation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Os desfechos que significam "o servidor mudou debaixo de você".
 *
 * São os que a tela "Precisa da sua atenção" existe para mostrar: a OS foi
 * cancelada, o estado não permite a transição, a peça acabou. Todos têm em
 * comum que o comando estava CERTO quando o técnico o deu, e ficou errado
 * depois.
 *
 * Um 422 não entra nesta lista: comando malformado é defeito de programa, e
 * guardá-lo como "trabalho a recuperar" encheria a tela do técnico de coisas
 * sobre as quais ele não pode decidir nada.
 */
function ehConflitoDeEstado(e: unknown): boolean {
  return isDomainError(e) && (e.httpStatus === 409 || e.httpStatus === 412);
}

/**
 * Executa a operação de campo com a garantia de "no máximo uma vez".
 *
 * Sem o cabeçalho, é o caminho de sempre — uma transação, nada gravado. Com
 * ele, três coisas passam a valer:
 *
 *  1. reenviar devolve o desfecho da primeira vez, sem reexecutar;
 *  2. um conflito de estado é GRAVADO com o corpo da requisição, para o
 *     trabalho do técnico continuar existindo depois de a transação sumir;
 *  3. e o conflito volta para o cliente como erro, e não como sucesso — o
 *     aparelho não pode apagar da fila o que não foi aplicado.
 */
export async function runFieldOperation<T>(
  db: Database,
  req: AuroraRequest,
  route: string,
  body: unknown,
  fn: (session: TenantSession) => Promise<T>
): Promise<T> {
  const ctx = req.auroraContext!;
  const op = clientOperationOf(req, route, body);

  if (!op) return withTenant(db, ctx, fn);

  try {
    const r = await withClientOperation(db, ctx, op, fn);
    if (!r.replayed) return r.value;

    /*
     * O REENVIO DE UMA OPERAÇÃO QUE CONFLITOU VOLTA A CONFLITAR.
     *
     * Devolvê-lo como sucesso porque "já foi processado" faria o aparelho
     * apagar da fila um trabalho que o servidor recusou. O desfecho guardado é
     * uma recusa, e é como recusa que ele volta — hoje e daqui a um mês.
     */
    if (r.status >= 400) {
      const guardado = r.body as { code?: string; message?: string } | null;
      throw new ConflictError(guardado?.message ?? 'Esta operação foi recusada quando chegou.', {
        client_operation_id: op.id,
        conflict_code: guardado?.code ?? 'conflict',
        replayed: true,
      });
    }
    return r.body as T;
  } catch (e) {
    if (ehConflitoDeEstado(e) && isDomainError(e)) {
      /*
       * A GRAVAÇÃO ACONTECE DEPOIS DA FALHA, EM TRANSAÇÃO PRÓPRIA.
       *
       * A transação do trabalho já foi revertida — é o que "conflito"
       * significa. Escrever a preservação dentro dela teria feito ela sumir
       * junto, e a tela de atenção nasceria vazia justamente nos casos que
       * existe para mostrar.
       *
       * `details.replayed` marca o erro que JÁ veio da tabela: regravá-lo
       * seria inofensivo (o `ON CONFLICT DO NOTHING` cuida disso), mas o
       * `if` deixa a intenção legível.
       */
      if (!(e.details as { replayed?: boolean }).replayed) {
        await recordClientConflict(db, ctx, op, {
          code: e.code,
          message: e.message,
          status: e.httpStatus,
        });
      }
    }
    throw e;
  }
}

/**
 * Lê o cabeçalho, ou devolve `null` quando não há operação declarada.
 *
 * Um identificador malformado é RECUSADO em vez de ignorado. Ignorar faria a
 * requisição seguir sem nenhuma garantia de unicidade, e o cliente continuaria
 * acreditando que tem — que é o pior dos dois mundos: nenhuma proteção, com a
 * confiança de quem acha que está protegido.
 */
export function clientOperationOf(req: AuroraRequest, route: string, body: unknown): ClientOperation | null {
  // `header()` e não `headers[...]`: é o que a interface de requisição deste
  // projeto expõe, e é insensível a maiúsculas — o cliente pode mandar
  // `X-Aurora-Client-Operation` sem que a leitura dependa disso.
  const valor = req.header(CLIENT_OPERATION_HEADER);
  if (!valor) return null;

  if (!UUID.test(valor)) {
    throw new ValidationError(
      `O cabeçalho ${CLIENT_OPERATION_HEADER} precisa ser um UUID gerado no aparelho antes da primeira tentativa.`,
      { header: CLIENT_OPERATION_HEADER, received: valor }
    );
  }

  return { id: valor.toLowerCase(), route, body: body ?? null };
}
