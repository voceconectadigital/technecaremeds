/**
 * Aurora — avaliação e assinatura da ordem de serviço pelo solicitante.
 *
 * Conversa com o cliente, 21/10/2026: "obrigar o usuário a avaliar e assinar", "sempre
 * avaliar antes e depois assinar automático" e "avisar em um campo específico de pendências
 * todas as ordens de serviço de qualquer tipo para avaliar/assinar".
 *
 * A regra em três frases:
 *   · quem avalia é quem PEDIU o atendimento (o solicitante da solicitação que originou a OS);
 *   · a nota (1 a 5) e a assinatura nascem no MESMO ato — não há nota sem assinatura;
 *   · uma vez só: reavaliar até a nota melhorar é o que transforma indicador em negociação.
 *
 * "Obrigar" é a trava de `assertSemAvaliacaoPendente`: com avaliação pendente, o solicitante
 * não abre um chamado novo. Dá para desligar por organização (`settings.evaluationRequired =
 * false`); o padrão é ligado, porque foi o que o cliente pediu.
 */
import { ConflictError, NotFoundError, ValidationError, newId } from '@aurora/domain';
import type { TenantSession } from './client';
import { signWorkOrder } from './execution';

/** A OS já foi executada: aguarda validação, está validada ou encerrada. */
const CATEGORIAS_AVALIAVEIS = ['review', 'done', 'closed'] as const;

export interface PendingEvaluation {
  work_order_id: string;
  number: string | null;
  title: string;
  type_label: string | null;
  completed_at: Date | null;
  asset_name: string | null;
  customer_name: string;
}

/** As OS concluídas, pedidas por esta pessoa, que ela ainda não avaliou. */
export async function pendingEvaluations(
  session: TenantSession,
  membershipId: string,
  limit = 100
): Promise<PendingEvaluation[]> {
  return session.query<PendingEvaluation>(
    `SELECT w.id AS work_order_id, w.number, w.title, t.label AS type_label,
            w.completed_at, w.asset_name_snapshot AS asset_name, c.name AS customer_name
       FROM aurora.work_orders w
       JOIN aurora.service_requests sr ON sr.id = w.service_request_id
       JOIN aurora.customers c ON c.id = w.customer_id
       LEFT JOIN aurora.catalog_items t ON t.id = w.work_order_type_id
      WHERE sr.requester_membership_id = $1
        AND w.status_category::text = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM aurora.work_order_evaluations e WHERE e.work_order_id = w.id)
      ORDER BY w.completed_at NULLS LAST, w.number
      LIMIT $3`,
    [membershipId, [...CATEGORIAS_AVALIAVEIS], limit]
  );
}

export interface WorkOrderEvaluation {
  id: string;
  work_order_id: string;
  rating: number;
  comment: string | null;
  evaluated_at: Date;
  evaluator_name: string;
  signature_id: string;
}

/** A avaliação de uma OS, com quem avaliou. `null` se ainda não foi avaliada. */
export async function getWorkOrderEvaluation(
  session: TenantSession,
  workOrderId: string
): Promise<WorkOrderEvaluation | null> {
  const [e] = await session.query<WorkOrderEvaluation>(
    `SELECT e.id, e.work_order_id, e.rating::int AS rating, e.comment, e.evaluated_at,
            u.name AS evaluator_name, e.signature_id
       FROM aurora.work_order_evaluations e
       JOIN aurora.memberships m ON m.id = e.evaluator_membership_id
       JOIN aurora.users u ON u.id = m.user_id
      WHERE e.work_order_id = $1`,
    [workOrderId]
  );
  return e ?? null;
}

/**
 * Avalia e assina, no mesmo ato.
 *
 * A assinatura é pela SESSÃO autenticada (migration 0079): o resumo do que foi assinado
 * (número, título, resolução, quando concluiu), o e-mail, o IP e o agente de quem assinou.
 * Ela prova quem avaliou e o que viu; não é ICP-Brasil e não afirma validade jurídica.
 */
export async function evaluateWorkOrder(
  session: TenantSession,
  membershipId: string,
  workOrderId: string,
  input: { rating: number; comment?: string | null }
): Promise<{ id: string; signatureId: string }> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ValidationError('a avaliação vai de 1 a 5', { field: 'rating' });
  }
  const comentario = input.comment?.trim() || null;
  if (comentario && comentario.length > 2000) {
    throw new ValidationError('o comentário vai até 2000 caracteres', { field: 'comment' });
  }

  const [os] = await session.query<{
    status_category: string;
    requester_membership_id: string | null;
  }>(
    `SELECT w.status_category::text AS status_category, sr.requester_membership_id
       FROM aurora.work_orders w
       LEFT JOIN aurora.service_requests sr ON sr.id = w.service_request_id
      WHERE w.id = $1`,
    [workOrderId]
  );
  if (!os) throw new NotFoundError('Ordem de serviço', workOrderId);
  // Quem não pediu esta OS não a avalia — e a resposta é a mesma de "não existe": ninguém
  // deve descobrir por aqui quais OS são de outras pessoas.
  if (os.requester_membership_id !== membershipId) throw new NotFoundError('Ordem de serviço', workOrderId);
  if (!(CATEGORIAS_AVALIAVEIS as readonly string[]).includes(os.status_category)) {
    throw new ConflictError('a avaliação abre quando a ordem de serviço é concluída');
  }
  if (await getWorkOrderEvaluation(session, workOrderId)) {
    throw new ConflictError('esta ordem de serviço já foi avaliada');
  }

  const [quem] = await session.query<{ name: string; email: string }>(
    `SELECT u.name, u.email FROM aurora.memberships m JOIN aurora.users u ON u.id = m.user_id
      WHERE m.id = $1`,
    [membershipId]
  );
  if (!quem) throw new NotFoundError('Usuário', membershipId);

  const assinatura = await signWorkOrder(session, workOrderId, {
    signerRole: 'customer',
    signerName: quem.name,
    method: 'session',
    signerEmail: quem.email,
  });

  const id = newId();
  await session.query(
    `INSERT INTO aurora.work_order_evaluations
       (id, organization_id, work_order_id, rating, comment, evaluator_membership_id, signature_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, session.context.organizationId, workOrderId, input.rating, comentario, membershipId, assinatura.id]
  );
  return { id, signatureId: assinatura.id };
}

/**
 * A trava do "obrigar": com avaliação pendente, não se abre chamado novo.
 *
 * Desligada por organização com `settings.evaluationRequired = false`. A mensagem diz o
 * que fazer e quantas faltam — "erro" sem caminho é o que o solicitante não resolve sozinho.
 */
export async function assertSemAvaliacaoPendente(
  session: TenantSession,
  membershipId: string
): Promise<void> {
  const [org] = await session.query<{ obrigatoria: boolean }>(
    `SELECT coalesce((settings->>'evaluationRequired')::boolean, true) AS obrigatoria
       FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  if (org && !org.obrigatoria) return;
  const pendentes = await pendingEvaluations(session, membershipId, 50);
  if (pendentes.length === 0) return;
  throw new ConflictError(
    pendentes.length === 1
      ? 'Há 1 ordem de serviço concluída para avaliar e assinar. Faça isso antes de abrir um novo chamado.'
      : `Há ${pendentes.length} ordens de serviço concluídas para avaliar e assinar. Faça isso antes de abrir um novo chamado.`,
    { pending: pendentes.length }
  );
}
