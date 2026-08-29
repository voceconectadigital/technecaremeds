/**
 * Aurora — o que a ficha da ordem de serviço precisa ler (SPEC v0.2 §09, §12 · EPIC-009).
 *
 * POR QUE ISTO É UM ARQUIVO SEPARADO
 *
 * `execution.ts` é a camada que ESCREVE: apontar hora, responder checklist,
 * anexar foto, assinar. Quase nada dela lê de volta — o backend foi construído
 * pela borda de escrita, e a ficha nunca existiu para cobrar a leitura. O
 * resultado media-se em rota: havia `POST /work-orders/:id/attachments` e
 * nenhum `GET`; havia uma tabela `work_order_comments` inteira, com a separação
 * entre nota interna e comentário do cliente feita em COLUNA, e nenhuma rota
 * que a lesse ou escrevesse.
 *
 * NOTA INTERNA É DECISÃO DE SEGURANÇA, NÃO DE APRESENTAÇÃO
 *
 * A separação existe desde a migration 0021, e a razão está escrita lá: na
 * referência auditada as duas coisas moravam no mesmo campo, e a única
 * proteção era lembrar de não escrever a coisa errada. Aqui a nota interna é
 * filtrada NA CONSULTA, por permissão — não escondida na tela. Esconder por
 * CSS significa que o dado viajou até o navegador e está no painel de rede.
 */
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* Comentários e notas internas                                               */
/* -------------------------------------------------------------------------- */

export interface CommentRow {
  id: string;
  body: string;
  visibility: 'internal' | 'customer';
  author_membership_id: string | null;
  author_name: string | null;
  created_at: Date;
  edited_at: Date | null;
}

/**
 * Comentários de uma OS, já filtrados pelo que quem pergunta pode ver.
 *
 * Quem não tem `work_order.read_internal_notes` não recebe nota interna — e
 * não recebe nem a contagem delas. Dizer "há 3 notas internas" a quem não pode
 * lê-las já vaza a informação sensível: "há três notas internas sobre a sua
 * garantia" diz demais mesmo sem o texto.
 */
export async function listComments(
  session: TenantSession,
  workOrderId: string
): Promise<CommentRow[]> {
  const podeVerInterna = session.context.permissions.has('work_order.read_internal_notes');

  return session.query<CommentRow>(
    `SELECT c.id, c.body, c.visibility, c.author_membership_id,
            u.name AS author_name, c.created_at, c.edited_at
       FROM aurora.work_order_comments c
       LEFT JOIN aurora.memberships m ON m.id = c.author_membership_id
       LEFT JOIN aurora.users u       ON u.id = m.user_id
      WHERE c.work_order_id = $1
        AND ($2::boolean OR c.visibility = 'customer')
      ORDER BY c.created_at`,
    [workOrderId, podeVerInterna]
  );
}

export interface NewComment {
  workOrderId: string;
  body: string;
  visibility: 'internal' | 'customer';
}

/**
 * Escreve um comentário.
 *
 * A visibilidade é EXIGIDA, sem valor padrão nesta camada — mesmo a coluna
 * tendo `DEFAULT 'internal'`. Um padrão aqui seria a armadilha da referência
 * com o sinal trocado: quem quisesse falar com o cliente e esquecesse o
 * parâmetro escreveria uma nota que o cliente nunca lê, e ficaria esperando
 * resposta de uma mensagem que não foi entregue.
 */
export async function addComment(session: TenantSession, input: NewComment): Promise<string> {
  const corpo = input.body.trim();
  if (corpo.length === 0) {
    throw new Error('comentário vazio');
  }
  if (!session.context.membershipId) {
    throw new Error('comentário exige vínculo: comentário sem autor não pode ser respondido');
  }
  // Escrever nota interna exige poder LER nota interna. Sem isso, alguém
  // escreveria num canal que não consegue conferir depois.
  if (
    input.visibility === 'internal' &&
    !session.context.permissions.has('work_order.read_internal_notes')
  ) {
    throw new Error('sem permissão para nota interna');
  }

  const rows = await session.query<{ id: string }>(
    `INSERT INTO aurora.work_order_comments
       (id, organization_id, work_order_id, body, visibility, author_membership_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [
      session.context.organizationId,
      input.workOrderId,
      corpo,
      input.visibility,
      session.context.membershipId,
    ]
  );
  return rows[0]!.id;
}

/* -------------------------------------------------------------------------- */
/* Horas apontadas                                                            */
/* -------------------------------------------------------------------------- */

export interface TimeEntryRow {
  id: string;
  membership_id: string | null;
  person_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  minutes: number | null;
  source: string;
  note: string | null;
  approved_at: Date | null;
  /** Só para quem tem `work_order.read_costs`; nulo para os demais. */
  cost: string | null;
  currency: string | null;
}

/**
 * As horas apontadas na OS.
 *
 * `minutes` é calculado no banco, e é NULO enquanto a entrada está aberta.
 * Deixar a tela calcular `agora - início` faria o número mudar a cada
 * renderização — inclusive depois de a OS fechar, se a entrada tiver ficado
 * aberta por engano, e aí a ficha passaria a acumular horas sozinha.
 *
 * O CUSTO SAI DA CONSULTA para quem não pode vê-lo: `work_order.read_costs`
 * separa quem executa de quem fatura. O técnico aponta a hora e não precisa
 * saber por quanto ela é cobrada do cliente.
 */
export async function listTimeEntries(
  session: TenantSession,
  workOrderId: string
): Promise<TimeEntryRow[]> {
  const podeVerCusto = session.context.permissions.has('work_order.read_costs');

  return session.query<TimeEntryRow>(
    `SELECT t.id, t.membership_id, u.name AS person_name,
            t.started_at, t.ended_at,
            CASE WHEN t.ended_at IS NULL THEN NULL
                 ELSE (EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60)::int
            END AS minutes,
            t.source::text AS source, t.note, t.approved_at,
            CASE WHEN $2::boolean THEN t.hourly_cost::text ELSE NULL END AS cost,
            CASE WHEN $2::boolean THEN t.currency ELSE NULL END AS currency
       FROM aurora.time_entries t
       LEFT JOIN aurora.memberships m ON m.id = t.membership_id
       LEFT JOIN aurora.users u       ON u.id = m.user_id
      WHERE t.work_order_id = $1
      ORDER BY t.started_at`,
    [workOrderId, podeVerCusto]
  );
}

/* -------------------------------------------------------------------------- */
/* Anexos                                                                     */
/* -------------------------------------------------------------------------- */

export interface AttachmentRow {
  id: string;
  purpose: string;
  file_name: string;
  content_type: string;
  byte_size: string;
  sha256: string;
  taken_at: Date | null;
  uploaded_at: Date;
  uploaded_by_name: string | null;
  /** Preenchido quando o anexo é resposta de um item de checklist. */
  checklist_answer_id: string | null;
}

/**
 * Os anexos da OS.
 *
 * NÃO devolve a chave de armazenamento. A chave é gerada pelo servidor e
 * nomeia o objeto no bucket; entregá-la à tela transformaria um identificador
 * interno em coisa que o navegador conhece, e daí em coisa que alguém tenta
 * adivinhar. A tela pede o arquivo pelo `id` do anexo, e o servidor resolve
 * onde ele mora.
 *
 * `byte_size` viaja como texto porque é `bigint`: acima de 2^53 o JavaScript
 * perde precisão em silêncio, e "em silêncio" é a parte cara.
 */
export async function listAttachments(
  session: TenantSession,
  workOrderId: string
): Promise<AttachmentRow[]> {
  return session.query<AttachmentRow>(
    `SELECT a.id, a.purpose::text AS purpose, a.file_name, a.content_type,
            a.byte_size::text AS byte_size, a.sha256, a.taken_at, a.uploaded_at,
            u.name AS uploaded_by_name, a.checklist_answer_id
       FROM aurora.attachments a
       LEFT JOIN aurora.users u ON u.id = a.uploaded_by
      WHERE a.work_order_id = $1
      ORDER BY a.uploaded_at`,
    [workOrderId]
  );
}

/* -------------------------------------------------------------------------- */
/* Peças consumidas                                                           */
/* -------------------------------------------------------------------------- */

export interface PartRow {
  id: string;
  item_id: string;
  item_name: string | null;
  item_sku: string | null;
  unit: string | null;
  /** `consumption` saiu do estoque para a OS; `return` voltou. */
  kind: 'consumption' | 'return';
  qty: string;
  warehouse_name: string | null;
  occurred_at: Date;
  /** Só para quem tem `work_order.read_costs`. */
  unit_cost: string | null;
}

/**
 * As peças movimentadas nesta OS.
 *
 * Vêm dos MOVIMENTOS de estoque, e não de uma tabela paralela de "peças da
 * OS". Ter as duas coisas seria ter dois números para a mesma pergunta — e o
 * que diverge é sempre o do estoque, que é o que está na prateleira.
 *
 * DEVOLUÇÃO É LINHA, NÃO SUBTRAÇÃO. A peça que saiu e voltou aparece duas
 * vezes, e de propósito: consolidar em "líquido zero" apagaria da ficha o fato
 * de a peça ter sido levada — que é justamente o que explica por que o técnico
 * foi duas vezes, e por que o almoxarifado ficou sem ela naquela tarde.
 */
export async function listParts(session: TenantSession, workOrderId: string): Promise<PartRow[]> {
  const podeVerCusto = session.context.permissions.has('work_order.read_costs');

  return session.query<PartRow>(
    `SELECT m.id, m.item_id, i.name AS item_name, i.sku AS item_sku, i.unit,
            m.kind::text AS kind, m.qty::text AS qty,
            w.name AS warehouse_name, m.occurred_at,
            CASE WHEN $2::boolean THEN m.unit_cost::text ELSE NULL END AS unit_cost
       FROM aurora.stock_movements m
       LEFT JOIN aurora.inventory_items i ON i.id = m.item_id
       LEFT JOIN aurora.warehouses w      ON w.id = m.warehouse_id
      WHERE m.ref_type = 'work_order'
        AND m.ref_id = $1
        AND m.kind IN ('consumption', 'return')
        -- O estorno de um movimento não é peça: é correção de lançamento, e
        -- some do par junto com o movimento que ele desfaz.
        AND m.reverses_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM aurora.stock_movements r WHERE r.reverses_id = m.id
        )
      ORDER BY m.occurred_at`,
    [workOrderId, podeVerCusto]
  );
}
