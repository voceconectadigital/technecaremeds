/**
 * Aurora — idempotência das operações vindas de campo (SPEC v0.2 §20 · EPIC-014).
 *
 * O PROBLEMA, EM UMA CENA
 *
 * O técnico conclui a OS no subsolo do hospital. O aparelho manda o comando; a
 * resposta não volta porque o elevador fechou. O aparelho tenta de novo no
 * andar de cima. Sem nada aqui, a OS é concluída duas vezes: dois lançamentos
 * de hora, duas baixas de peça, dois eventos de domínio.
 *
 * A saída não é o cliente "tentar adivinhar se deu certo" — ele não tem como
 * saber a diferença entre "não chegou" e "chegou e a resposta se perdeu". A
 * saída é o servidor reconhecer a operação e devolver o mesmo desfecho.
 *
 * POR QUE ISTO NÃO É UM INTERCEPTOR
 *
 * Um interceptor rodaria FORA da transação do trabalho. Entre reservar a
 * operação e executá-la haveria uma janela: o processo cai no meio, a reserva
 * fica gravada, e a retentativa recebe "já fiz isso" por um trabalho que nunca
 * aconteceu. Isso é perda silenciosa de trabalho — o defeito que a SPEC chama
 * de o pior possível neste produto.
 *
 * Por isso a reserva acontece DENTRO da mesma transação do trabalho, e o
 * controller opta explicitamente por ela. Não há mágica escondida no pipeline:
 * a rota que é idempotente diz que é, no próprio código.
 */
import { createHash } from 'node:crypto';
import type { RequestContext } from '@aurora/domain';
import { ConflictError } from '@aurora/domain';
import { withTenant } from './client';
import type { Database, TenantSession } from './client';

/** O que o servidor decidiu sobre uma operação — para sempre. */
export interface ClientOperationRecord {
  clientOperationId: string;
  membershipId: string;
  route: string;
  state: 'in_progress' | 'succeeded' | 'conflicted';
  responseStatus: number | null;
  responseBody: unknown;
  requestBody: unknown;
  conflictCode: string | null;
  conflictMessage: string | null;
  receivedAt: string;
  resolvedAt: string | null;
}

/**
 * A impressão digital do corpo da requisição.
 *
 * As chaves saem ORDENADAS: dois envios do mesmo comando podem serializar os
 * campos em ordens diferentes — o cliente monta o objeto de outro jeito depois
 * de uma atualização —, e sem a ordenação a retentativa legítima seria acusada
 * de ser outra operação.
 */
export function digestOfBody(body: unknown): string {
  return createHash('sha256').update(canonico(body)).digest('hex');
}

function canonico(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  const o = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonico(o[k]))
      .join(',') +
    '}'
  );
}

export interface ClientOperation {
  id: string;
  /** 'POST /work-orders/:id/start' — o que a tela de atenção mostra. */
  route: string;
  body: unknown;
}

export type ClientOperationResult<T> =
  | { replayed: false; value: T }
  /** Já tinha sido feita: o desfecho guardado, sem executar nada de novo. */
  | { replayed: true; status: number; body: unknown };

/**
 * O mesmo identificador com outro corpo.
 *
 * NÃO devolvemos a resposta guardada. O cliente pediu uma coisa e receberia a
 * confirmação de outra — e seguiria achando que a operação nova foi aplicada. É
 * perda silenciosa de trabalho com aparência de sucesso, que é a pior forma
 * dela. Recusar alto é a única saída honesta.
 */
export class ClientOperationMismatchError extends ConflictError {
  constructor(clientOperationId: string, route: string) {
    super(
      'Esta operação já foi enviada com outro conteúdo. Gere um identificador novo para a ' +
        'operação nova — reaproveitar o anterior faria o mesmo identificador ter dois desfechos.',
      { client_operation_id: clientOperationId, route, reason: 'digest_mismatch' }
    );
  }
}

/** O mesmo identificador vindo de outra pessoa. */
export class ClientOperationOwnershipError extends ConflictError {
  constructor(clientOperationId: string) {
    super(
      'Esta operação foi registrada por outro vínculo. Devolver a resposta dela aqui seria ' +
        'entregar o resultado do trabalho de outra pessoa.',
      { client_operation_id: clientOperationId, reason: 'membership_mismatch' }
    );
  }
}

interface LinhaExistente {
  membership_id: string;
  request_digest: string;
  state: 'in_progress' | 'succeeded' | 'conflicted';
  response_status: number | null;
  response_body: unknown;
  conflict_code: string | null;
  conflict_message: string | null;
}

/**
 * Executa `fn` no máximo uma vez para um `client_operation_id`.
 *
 * A reserva e o trabalho vivem na MESMA transação. As três coisas que isso
 * garante, e que nenhuma outra montagem garante ao mesmo tempo:
 *
 *  · o processo caindo no meio não deixa reserva de trabalho não feito;
 *  · duas retentativas simultâneas não executam as duas — a segunda ESPERA no
 *    índice único até a primeira decidir, e depois lê o desfecho dela;
 *  · o desfecho gravado e o efeito no banco aparecem juntos, ou não aparecem.
 */
export async function withClientOperation<T>(
  db: Database,
  ctx: RequestContext,
  op: ClientOperation,
  fn: (session: TenantSession) => Promise<T>
): Promise<ClientOperationResult<T>> {
  const digest = digestOfBody(op.body);
  const membershipId = ctx.membershipId;
  if (!membershipId) {
    throw new ConflictError('Operação de campo exige um vínculo — ela é registrada em nome de alguém.', {
      client_operation_id: op.id,
    });
  }

  return withTenant(db, ctx, async (s) => {
    /*
     * `ON CONFLICT DO NOTHING` faz duas coisas de uma vez: reserva, se for a
     * primeira; e ESPERA, se outra transação está com a mesma chave em aberto.
     * A espera é o que impede a execução dupla — e termina sozinha quando a
     * outra transação decide, para um lado ou para o outro.
     */
    const reservou = await s.query<{ ok: number }>(
      `INSERT INTO aurora.client_operations
         (organization_id, client_operation_id, membership_id, route, request_digest, state)
       VALUES (aurora.current_organization_id(), $1, $2, $3, $4, 'in_progress')
       ON CONFLICT (organization_id, client_operation_id) DO NOTHING
       RETURNING 1 AS ok`,
      [op.id, membershipId, op.route, digest]
    );

    if (reservou.length === 0) {
      const [ja] = await s.query<LinhaExistente>(
        `SELECT membership_id, request_digest, state::text AS state, response_status,
                response_body, conflict_code, conflict_message
           FROM aurora.client_operations
          WHERE client_operation_id = $1`,
        [op.id]
      );

      /*
       * A linha SEMPRE existe aqui. Se o INSERT não inseriu, foi porque a chave
       * já estava lá — e a leitura acontece depois de a outra transação ter
       * decidido. Um vazio aqui significaria que alguém apagou a linha entre
       * uma coisa e outra, e a migration 0043 não concede DELETE a ninguém
       * justamente para que isso não seja possível.
       */
      if (!ja) {
        throw new ConflictError(
          'A operação foi registrada e desapareceu entre a reserva e a leitura — reenvie.',
          { client_operation_id: op.id }
        );
      }

      if (ja.membership_id !== membershipId) throw new ClientOperationOwnershipError(op.id);
      if (ja.request_digest !== digest) throw new ClientOperationMismatchError(op.id, op.route);

      return {
        replayed: true as const,
        status: ja.response_status ?? 200,
        body:
          ja.state === 'conflicted'
            ? { code: ja.conflict_code, message: ja.conflict_message }
            : ja.response_body,
      };
    }

    const valor = await fn(s);

    /*
     * O UPDATE é a última coisa da transação, e é ele que faz a linha deixar de
     * ser 'in_progress'. Se `fn` tivesse lançado, nada disto aconteceria — e a
     * reserva sumiria junto, deixando a retentativa livre para tentar de novo.
     */
    await s.query(
      `UPDATE aurora.client_operations
          SET state = 'succeeded', response_status = 200, response_body = $2::jsonb
        WHERE client_operation_id = $1`,
      [op.id, JSON.stringify(valor ?? null)]
    );

    return { replayed: false as const, value: valor };
  });
}

/**
 * Grava o conflito, EM TRANSAÇÃO PRÓPRIA, depois de a do trabalho ter sumido.
 *
 * Precisa ser separada por construção: a transação que conflitou foi revertida
 * inteira, e qualquer coisa escrita dentro dela sumiu junto. Se a preservação do
 * trabalho do técnico morresse com a transação que falhou, ela não preservaria
 * nada — que é a diferença entre cumprir a SPEC e parecer cumprir.
 */
export async function recordClientConflict(
  db: Database,
  ctx: RequestContext,
  op: ClientOperation,
  conflito: { code: string; message: string; status: number }
): Promise<void> {
  const membershipId = ctx.membershipId;
  if (!membershipId) return;

  await withTenant(db, ctx, async (s) => {
    await s.query(
      `INSERT INTO aurora.client_operations
         (organization_id, client_operation_id, membership_id, route, request_digest,
          state, response_status, request_body, conflict_code, conflict_message)
       VALUES (aurora.current_organization_id(), $1, $2, $3, $4,
               'conflicted', $5, $6::jsonb, $7, $8)
       ON CONFLICT (organization_id, client_operation_id) DO NOTHING`,
      [
        op.id,
        membershipId,
        op.route,
        digestOfBody(op.body),
        conflito.status,
        JSON.stringify(op.body ?? null),
        conflito.code,
        conflito.message,
      ]
    );
  });
}

/** Os conflitos por tratar desta pessoa — a tela "Precisa da sua atenção". */
export async function pendingConflicts(
  s: TenantSession,
  membershipId: string
): Promise<ClientOperationRecord[]> {
  const linhas = await s.query<Record<string, unknown>>(
    `SELECT client_operation_id, membership_id, route, state::text AS state,
            response_status, response_body, request_body,
            conflict_code, conflict_message, received_at, resolved_at
       FROM aurora.client_operations
      WHERE membership_id = $1
        AND state = 'conflicted'
        AND resolved_at IS NULL
      ORDER BY received_at DESC
      LIMIT 200`,
    [membershipId]
  );

  return linhas.map((l) => ({
    clientOperationId: l.client_operation_id as string,
    membershipId: l.membership_id as string,
    route: l.route as string,
    state: l.state as ClientOperationRecord['state'],
    responseStatus: (l.response_status as number | null) ?? null,
    responseBody: l.response_body ?? null,
    requestBody: l.request_body ?? null,
    conflictCode: (l.conflict_code as string | null) ?? null,
    conflictMessage: (l.conflict_message as string | null) ?? null,
    receivedAt: new Date(l.received_at as string).toISOString(),
    resolvedAt: l.resolved_at ? new Date(l.resolved_at as string).toISOString() : null,
  }));
}

/**
 * Marca um conflito como tratado.
 *
 * `supersededBy` liga o conflito à operação NOVA que o técnico enviou depois de
 * decidir o que fazer. É o que permite responder, seis meses depois, "o que
 * aconteceu com aquele trabalho?" — sem essa ligação, a tela de atenção esvazia
 * e o rastro some junto.
 */
export async function resolveClientConflict(
  s: TenantSession,
  params: { clientOperationId: string; membershipId: string; supersededBy?: string }
): Promise<boolean> {
  const linhas = await s.query<{ ok: number }>(
    `UPDATE aurora.client_operations
        SET resolved_at = now(), resolved_by = $2, superseded_by = $3
      WHERE client_operation_id = $1
        AND state = 'conflicted'
        AND resolved_at IS NULL
      RETURNING 1 AS ok`,
    [params.clientOperationId, params.membershipId, params.supersededBy ?? null]
  );
  return linhas.length > 0;
}
