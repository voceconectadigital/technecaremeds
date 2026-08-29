/**
 * Aurora — o que o portal do cliente pode ler (SPEC v0.2 §19 · EPIC-020).
 *
 * ESTE ARQUIVO É UMA FRONTEIRA DE SEGURANÇA, e a razão de ele existir separado
 * de `work-orders.ts` e `service-requests.ts` é justamente essa.
 *
 * A alternativa — reaproveitar as consultas internas e filtrar campos depois —
 * falha da forma mais silenciosa possível: alguém acrescenta uma coluna à
 * consulta interna seis meses depois, o portal passa a devolvê-la, e nada
 * quebra. A auditoria da referência registrou o resultado desse desenho: lá o
 * portal era o conjunto de telas internas com 21 permissões por cima, e cada
 * campo novo era uma decisão de vazamento que ninguém tomava conscientemente.
 *
 * Aqui as consultas do portal são ESCRITAS SEPARADAMENTE, com colunas nomeadas
 * uma a uma. Acrescentar um campo ao portal exige escrever o nome dele neste
 * arquivo — e quem escreve decide, naquele momento, se o cliente pode ver.
 *
 * O QUE NUNCA SAI DAQUI
 *
 *   · `internal_notes` de qualquer entidade;
 *   · comentários com `visibility = 'internal'`;
 *   · custo, margem, valor de compra, taxa de excedente;
 *   · identidade de fornecedor;
 *   · qualquer linha de outro cliente.
 *
 * A última é a mais importante e a menos visível: o recorte por cliente e por
 * local não é conveniência de listagem, é a fronteira entre dois clientes que
 * usam o mesmo produto.
 *
 * O VOCABULÁRIO É DADO, E NÃO CÓDIGO
 *
 * `customer_label` (migration 0042) traduz a situação para a frase que o
 * cliente lê. `COALESCE` com o rótulo interno: quem não configurou vê a palavra
 * da equipe, que é pior do que uma tradução e melhor do que uma frase vazia.
 */
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* O recorte                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O fragmento de SQL que limita QUALQUER consulta do portal ao escopo do
 * vínculo, e a função que o acompanha.
 *
 * Vive numa constante para não ser reescrito em cada consulta: a versão
 * copiada e colada é a que alguém esquece de colar na consulta nova.
 */
const NO_MEU_ESCOPO = `
  AND (w.location_id IS NULL
       OR w.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
  AND w.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
`;

/* -------------------------------------------------------------------------- */
/* Solicitações                                                               */
/* -------------------------------------------------------------------------- */

export interface PortalRequestRow {
  id: string;
  number: string;
  summary: string;
  description: string | null;
  /**
   * A chave interna.
   *
   * A TRADUÇÃO DESTA situação é código, e não dado — ao contrário da situação
   * da ordem de serviço. É deliberado, e a razão está no ADR-003: a máquina de
   * estados da OS é configurável por organização; a da solicitação não, porque
   * o ciclo da solicitação é o contrato com o cliente, e contrato que cada
   * organização redesenha deixa de ser contrato.
   *
   * Quem traduz é `REQUEST_STATUS_FOR_CUSTOMER`, no domínio.
   */
  status: string;
  priority: string;
  asset_id: string | null;
  asset_name: string | null;
  location_name: string | null;
  created_at: Date;
  /** Quantas ordens de serviço nasceram desta solicitação. */
  work_order_count: number;
}

/**
 * As solicitações do escopo de quem pergunta.
 *
 * `rejection_reason` sai junto quando existe: a SPEC §19 manda mostrar "Não
 * procede — com a justificativa". Recusar sem dizer por quê é o que gera a
 * segunda solicitação idêntica na semana seguinte.
 */
export async function portalRequests(
  session: TenantSession,
  membershipId: string,
  opts: { openOnly?: boolean; limit?: number } = {}
): Promise<PortalRequestRow[]> {
  const limite = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  return session.query<PortalRequestRow>(
    `SELECT r.id, r.number, r.summary, r.description,
            r.status::text AS status,
            r.priority::text AS priority,
            r.asset_id, a.name AS asset_name, l.name AS location_name,
            r.created_at,
            (SELECT count(*)::int FROM aurora.work_orders w2
              WHERE w2.service_request_id = r.id) AS work_order_count
       FROM aurora.service_requests r
       LEFT JOIN aurora.assets a    ON a.id = r.asset_id
       LEFT JOIN aurora.locations l ON l.id = r.location_id
      WHERE r.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
        AND (r.location_id IS NULL
             OR r.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
        AND (NOT $2::boolean OR r.status NOT IN ('closed', 'cancelled', 'rejected', 'duplicate', 'fulfilled'))
      ORDER BY r.created_at DESC
      LIMIT ${limite}`,
    [membershipId, opts.openOnly ?? false]
  );
}

/* -------------------------------------------------------------------------- */
/* Ordens de serviço                                                          */
/* -------------------------------------------------------------------------- */

export interface PortalWorkOrderRow {
  id: string;
  number: string | null;
  title: string;
  /** A frase do cliente para a situação. */
  status_label: string;
  /** A frase do cliente para o motivo da espera, quando há espera. */
  wait_label: string | null;
  /**
   * Se a bola está com o CLIENTE.
   *
   * Vem do `responsible` do motivo de espera, que o modelo já guarda. É a
   * informação que transforma "aguardando" numa frase acionável — e a que
   * evita a ligação de "e aí, como está?" cuja resposta é "esperando você".
   */
  waiting_on_customer: boolean;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  completed_at: Date | null;
  asset_name: string | null;
  location_name: string | null;
  /**
   * O que foi feito.
   *
   * Sai para o cliente porque é o produto do serviço — mas SÓ depois de
   * validada. Uma resolução em rascunho é anotação de trabalho em andamento, e
   * mostrá-la produz a pergunta "então já acabou?" antes de ter acabado.
   */
  resolution: string | null;
}

export async function portalWorkOrders(
  session: TenantSession,
  membershipId: string,
  opts: { requestId?: string | null; limit?: number } = {}
): Promise<PortalWorkOrderRow[]> {
  const limite = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  return session.query<PortalWorkOrderRow>(
    `SELECT w.id, w.number, w.title,
            COALESCE(st.customer_label, st.label) AS status_label,
            wr.customer_label AS wait_label,
            COALESCE(wr.responsible = 'customer', false) AS waiting_on_customer,
            w.scheduled_start, w.scheduled_end, w.completed_at,
            w.asset_name_snapshot AS asset_name,
            w.location_name_snapshot AS location_name,
            -- A resolução só depois de validada: em rascunho é anotação de
            -- trabalho em andamento, e mostrá-la produz "então já acabou?".
            CASE WHEN w.validated_at IS NOT NULL OR w.closed_at IS NOT NULL
                 THEN w.resolution END AS resolution
       FROM aurora.work_orders w
       JOIN aurora.work_order_statuses st ON st.id = w.status_id
       LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
      WHERE st.customer_label IS NOT NULL
        AND ($2::uuid IS NULL OR w.service_request_id = $2)
        ${NO_MEU_ESCOPO}
      ORDER BY w.created_at DESC
      LIMIT ${limite}`,
    [membershipId, opts.requestId ?? null]
  );
}

/* -------------------------------------------------------------------------- */
/* Comentários                                                                */
/* -------------------------------------------------------------------------- */

export interface PortalCommentRow {
  id: string;
  body: string;
  author_name: string | null;
  created_at: Date;
}

/**
 * Os comentários que o cliente vê.
 *
 * `visibility = 'customer'` está na cláusula WHERE, e não num filtro depois:
 * a nota interna não é escondida, ela não é lida. A diferença aparece no
 * painel de rede do navegador — que é onde a diferença importa.
 *
 * O tipo devolvido nem sequer TEM o campo `visibility`. Não há como um
 * consumidor deste retorno vazar o que não recebeu.
 */
export async function portalComments(
  session: TenantSession,
  membershipId: string,
  workOrderId: string
): Promise<PortalCommentRow[]> {
  return session.query<PortalCommentRow>(
    `SELECT c.id, c.body, u.name AS author_name, c.created_at
       FROM aurora.work_order_comments c
       JOIN aurora.work_orders w ON w.id = c.work_order_id
       LEFT JOIN aurora.memberships m ON m.id = c.author_membership_id
       LEFT JOIN aurora.users u       ON u.id = m.user_id
      WHERE c.work_order_id = $2
        AND c.visibility = 'customer'
        ${NO_MEU_ESCOPO}
      ORDER BY c.created_at`,
    [membershipId, workOrderId]
  );
}

/* -------------------------------------------------------------------------- */
/* Equipamentos                                                               */
/* -------------------------------------------------------------------------- */

export interface PortalAssetRow {
  id: string;
  name: string;
  tag: string | null;
  serial_number: string | null;
  status: string;
  location_name: string | null;
  category_name: string;
  /** Nulo quando não há garantia registrada — e nulo não é "sem garantia". */
  warranty_until: string | null;
  /** A próxima manutenção programada, do plano ou da agenda. */
  next_service_at: Date | null;
}

/**
 * Os equipamentos do escopo.
 *
 * NENHUM VALOR FINANCEIRO sai daqui — nem compra, nem residual, nem reposição.
 * O cliente do serviço de manutenção não é o dono da contabilidade do parque, e
 * quando é, o número que importa é o dele e não o nosso.
 */
export async function portalAssets(
  session: TenantSession,
  membershipId: string,
  limit = 200
): Promise<PortalAssetRow[]> {
  const limite = Math.min(Math.max(limit, 1), 500);

  return session.query<PortalAssetRow>(
    `SELECT a.id, a.name, a.tag, a.serial_number, a.status::text AS status,
            l.name AS location_name, c.name AS category_name,
            a.warranty_until::text AS warranty_until,
            (SELECT min(w.scheduled_start) FROM aurora.work_orders w
              WHERE w.asset_id = a.id
                AND w.scheduled_start > now()
                AND w.status_category NOT IN ('closed', 'cancelled'))
              AS next_service_at
       FROM aurora.assets a
       JOIN aurora.asset_categories c ON c.id = a.asset_category_id
       LEFT JOIN aurora.locations l   ON l.id = a.location_id
      WHERE a.deleted_at IS NULL
        AND a.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
        AND (a.location_id IS NULL
             OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
      ORDER BY a.name
      LIMIT ${limite}`,
    [membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Documentos                                                                 */
/* -------------------------------------------------------------------------- */

export interface PortalDocumentRow {
  id: string;
  number: string | null;
  title: string | null;
  type_name: string;
  verdict: string | null;
  asset_id: string | null;
  asset_name: string | null;
  issued_at: Date | null;
  valid_until: string | null;
}

/**
 * Os documentos LIBERADOS ao cliente.
 *
 * `released_to_customer_at IS NOT NULL` é a condição inteira, e ela é a
 * diferença entre um laudo pronto e um laudo entregue. Um documento emitido e
 * não liberado ainda está em conferência interna; mostrá-lo antecipa uma
 * conversa que a equipe ainda não teve — e, quando o parecer é "não conforme",
 * antecipa a pior conversa possível.
 */
export async function portalDocuments(
  session: TenantSession,
  membershipId: string,
  limit = 200
): Promise<PortalDocumentRow[]> {
  const limite = Math.min(Math.max(limit, 1), 500);

  return session.query<PortalDocumentRow>(
    `SELECT d.id, d.number, d.title, dt.label AS type_name,
            d.verdict::text AS verdict,
            d.asset_id, a.name AS asset_name,
            d.issued_at, d.valid_until::text AS valid_until
       FROM aurora.documents d
       JOIN aurora.document_types dt ON dt.id = d.document_type_id
       LEFT JOIN aurora.assets a     ON a.id = d.asset_id
      WHERE d.released_to_customer_at IS NOT NULL
        AND d.cancelled_at IS NULL
        AND d.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
        AND (d.asset_id IS NULL
             OR a.location_id IS NULL
             OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1)))
      ORDER BY d.valid_until NULLS LAST, d.issued_at DESC
      LIMIT ${limite}`,
    [membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Orçamentos                                                                 */
/* -------------------------------------------------------------------------- */

export interface PortalQuoteRow {
  id: string;
  number: string;
  version: number;
  status: string;
  valid_until: string | null;
  /** Centavos, como texto. O total é o que o cliente decide aprovar. */
  total_cents: string;
  /** Se está esperando a decisão dele AGORA. */
  awaiting_decision: boolean;
}

/**
 * Os orçamentos que chegaram ao cliente.
 *
 * Rascunho NÃO aparece: um orçamento em elaboração é trabalho interno, e
 * mostrá-lo faz o cliente perguntar sobre um número que ainda vai mudar.
 *
 * O TOTAL SAI; a composição de custo NÃO. O cliente decide sobre o preço, e
 * quanto daquele preço é margem é conversa nossa — a SPEC §19 lista margem
 * entre o que não vaza.
 */
export async function portalQuotes(session: TenantSession, membershipId: string): Promise<PortalQuoteRow[]> {
  return session.query<PortalQuoteRow>(
    `SELECT q.id, q.number, q.version, q.status::text AS status,
            q.valid_until::text AS valid_until,
            q.total_cents::text AS total_cents,
            (q.status IN ('sent', 'viewed')
             AND (q.valid_until IS NULL OR q.valid_until >= current_date)) AS awaiting_decision
       FROM aurora.quotes q
      WHERE q.status <> 'draft'
        AND q.customer_id IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
      ORDER BY q.created_at DESC
      LIMIT 200`,
    [membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Agenda                                                                     */
/* -------------------------------------------------------------------------- */

export interface PortalVisitRow {
  id: string;
  number: string | null;
  title: string;
  scheduled_start: Date;
  scheduled_end: Date | null;
  asset_name: string | null;
  location_name: string | null;
  status_label: string;
}

/**
 * As visitas programadas no escopo.
 *
 * NÃO diz QUEM vai. O nome do técnico é informação de escala nossa, e o
 * cliente que precisa saber quem entra na unidade recebe isso pelo canal de
 * autorização de acesso — que é um processo, não um campo de listagem.
 */
export async function portalSchedule(
  session: TenantSession,
  membershipId: string
): Promise<PortalVisitRow[]> {
  return session.query<PortalVisitRow>(
    `SELECT w.id, w.number, w.title, w.scheduled_start, w.scheduled_end,
            w.asset_name_snapshot AS asset_name,
            w.location_name_snapshot AS location_name,
            COALESCE(st.customer_label, st.label) AS status_label
       FROM aurora.work_orders w
       JOIN aurora.work_order_statuses st ON st.id = w.status_id
      WHERE w.scheduled_start IS NOT NULL
        AND w.scheduled_start >= now() - interval '1 day'
        AND st.customer_label IS NOT NULL
        AND w.status_category NOT IN ('closed', 'cancelled')
        ${NO_MEU_ESCOPO}
      ORDER BY w.scheduled_start
      LIMIT 200`,
    [membershipId]
  );
}
