/**
 * Aurora — roteador de notificações (SPEC v0.2 §23 · EPIC-019).
 *
 * O caminho é sempre o mesmo: evento → destinatários → preferências → entrega.
 * A parte difícil não é nenhuma das quatro isoladamente; é não deixar o
 * destinatário receber a mesma coisa cinco vezes, e não deixar de contar o que
 * importava porque era madrugada.
 */
import {
  newId,
  notificationTypesFor,
  notificationType,
  decideDelivery,
  dedupeKey,
  extractMentions,
  ValidationError,
  NotFoundError,
  type NotificationChannel,
  type NotificationTypeDefinition,
  type DigestMode,
  type Audience,
  type Preference,
  type QuietHours,
} from '@aurora/domain';
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* destinatários                                                               */
/* -------------------------------------------------------------------------- */

interface RoutableEvent {
  id?: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Quem recebe, por público.
 *
 * Cada público é uma consulta própria porque cada um se descobre de um jeito
 * diferente — o executor está na OS, os coordenadores estão no papel, os
 * mencionados estão no texto do comentário. Uma tabela genérica de "regras de
 * destinatário" pareceria mais elegante e esconderia essas diferenças atrás de
 * um `jsonb` que ninguém consegue depurar.
 *
 * Devolve VÍNCULOS, não usuários: a mesma pessoa pode ter vínculo em duas
 * organizações, e a preferência de notificação é de um deles.
 */
async function resolveAudience(
  session: TenantSession,
  audience: Audience,
  event: RoutableEvent
): Promise<string[]> {
  switch (audience) {
    case 'assignee': {
      const rows = await session.query<{ id: string }>(
        `SELECT assignee_membership_id AS id FROM aurora.work_orders
          WHERE id = $1 AND assignee_membership_id IS NOT NULL`,
        [event.aggregateId]
      );
      return rows.map((r) => r.id);
    }

    case 'requester': {
      // O solicitante pode estar na OS (via solicitação de origem) ou na
      // própria solicitação, conforme o agregado do evento.
      const rows = await session.query<{ id: string }>(
        `SELECT r.requester_membership_id AS id
           FROM aurora.service_requests r
          WHERE r.requester_membership_id IS NOT NULL
            AND (r.id = $1 OR r.id = (SELECT service_request_id FROM aurora.work_orders WHERE id = $1))`,
        [event.aggregateId]
      );
      return rows.map((r) => r.id);
    }

    case 'coordinators':
    case 'managers':
    case 'storekeepers':
    case 'finance': {
      const papeis: Record<string, string[]> = {
        coordinators: ['coordinator'],
        managers: ['maintenance_manager', 'admin', 'owner'],
        storekeepers: ['storekeeper'],
        finance: ['finance'],
      };
      const rows = await session.query<{ id: string }>(
        `SELECT DISTINCT m.id
           FROM aurora.memberships m
           JOIN aurora.membership_roles mr ON mr.membership_id = m.id
           JOIN aurora.roles r ON r.id = mr.role_id
          WHERE m.status = 'active' AND r.key = ANY($1::text[])`,
        [papeis[audience]!]
      );
      return rows.map((r) => r.id);
    }

    case 'covering_team': {
      const rows = await session.query<{ id: string }>(
        `SELECT DISTINCT tm.membership_id AS id
           FROM aurora.service_requests r
           JOIN aurora.team_members tm ON tm.team_id = r.team_id
          WHERE r.id = $1 AND r.team_id IS NOT NULL`,
        [event.aggregateId]
      );
      return rows.map((r) => r.id);
    }

    case 'mentioned': {
      const texto = typeof event.payload.body === 'string' ? event.payload.body : '';
      const mencoes = extractMentions(texto);
      if (mencoes.length === 0) return [];

      // O identificador de menção é a parte local do e-mail, que é o que as
      // pessoas digitam. Casar pelo nome exibido daria empate na primeira
      // homonímia, e notificar a pessoa errada é pior que não notificar.
      const rows = await session.query<{ id: string }>(
        `SELECT m.id FROM aurora.memberships m
           JOIN aurora.users u ON u.id = m.user_id
          WHERE m.status = 'active'
            AND lower(split_part(u.email, '@', 1)) = ANY($1::text[])`,
        [mencoes]
      );
      return rows.map((r) => r.id);
    }

    case 'customer_contacts':
      // Contatos de cliente não são vínculos: são pessoas do lado de fora, e a
      // entrega para elas é por e-mail, sem caixa no aplicativo. Entra com o
      // portal (EPIC-020), que é onde essas pessoas ganham identidade.
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* preferências                                                                */
/* -------------------------------------------------------------------------- */

interface RecipientFacts {
  membershipId: string;
  timezone: string;
  emailVerified: boolean;
  quiet: QuietHours | null;
  preferences: Map<string, Preference>;
}

async function loadRecipient(
  session: TenantSession,
  membershipId: string,
  typeKey: string
): Promise<RecipientFacts | null> {
  const [row] = await session.query<{
    id: string;
    timezone: string;
    email_verified_at: Date | null;
    email_blocked_at: Date | null;
    quiet_start_minute: number | null;
    quiet_end_minute: number | null;
    quiet_full_days: number[];
  }>(
    `SELECT m.id, u.timezone, u.email_verified_at, u.email_blocked_at,
            m.quiet_start_minute, m.quiet_end_minute, m.quiet_full_days
       FROM aurora.memberships m
       JOIN aurora.users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.status = 'active'`,
    [membershipId]
  );
  if (!row) return null;

  const prefs = await session.query<{ channel: NotificationChannel; enabled: boolean; digest: DigestMode }>(
    `SELECT channel::text AS channel, enabled, digest::text AS digest
       FROM aurora.notification_preferences
      WHERE membership_id = $1 AND type_key = $2`,
    [membershipId, typeKey]
  );

  return {
    membershipId: row.id,
    timezone: row.timezone,
    // Endereço bloqueado conta como não verificado: as duas situações têm a
    // mesma consequência — não mandar — e tratá-las separado só multiplicaria
    // os caminhos sem mudar o resultado.
    emailVerified: row.email_verified_at !== null && row.email_blocked_at === null,
    quiet:
      row.quiet_start_minute === null || row.quiet_end_minute === null
        ? row.quiet_full_days.length > 0
          ? { startMinute: 0, endMinute: 0, fullDays: row.quiet_full_days }
          : null
        : {
            startMinute: Number(row.quiet_start_minute),
            endMinute: Number(row.quiet_end_minute),
            fullDays: row.quiet_full_days,
          },
    preferences: new Map(prefs.map((p) => [p.channel, p])),
  };
}

/**
 * Hora e dia no fuso do destinatário.
 *
 * O silêncio é do usuário, e o usuário está em Manaus enquanto o servidor está
 * em UTC. Calcular no fuso do servidor faria "não me acorde depois das 22 h"
 * valer a partir das 19 h locais — e a pessoa concluiria que o silêncio não
 * funciona.
 */
function localClock(now: Date, timezone: string): { minuteOfDay: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const partes = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minuteOfDay: Number(partes.hour) * 60 + Number(partes.minute),
    weekday: dias[partes.weekday ?? 'Mon'] ?? 1,
  };
}

/* -------------------------------------------------------------------------- */
/* roteamento                                                                  */
/* -------------------------------------------------------------------------- */

export interface RoutedNotification {
  notificationId: string;
  membershipId: string;
  typeKey: string;
  deliveries: Array<{ channel: NotificationChannel; state: string; reason: string }>;
}

/**
 * Roteia um evento: descobre quem, aplica preferências, grava.
 *
 * A de-duplicação é verificada aqui E garantida pela restrição do banco. As
 * duas existem pela mesma razão de sempre: a leitura dá a mensagem certa ao
 * operador, a restrição impede o caso concorrente que a leitura não vê.
 */
export async function routeEvent(
  session: TenantSession,
  event: RoutableEvent,
  now: Date = new Date()
): Promise<RoutedNotification[]> {
  const tipos = notificationTypesFor(event.type);
  if (tipos.length === 0) return [];

  const resultado: RoutedNotification[] = [];

  for (const tipo of tipos) {
    const destinatarios = new Set<string>();
    for (const publico of tipo.audiences) {
      for (const id of await resolveAudience(session, publico, event)) {
        destinatarios.add(id);
      }
    }

    for (const membershipId of destinatarios) {
      const rota = await deliverTo(session, tipo, event, membershipId, now);
      if (rota) resultado.push(rota);
    }
  }

  return resultado;
}

async function deliverTo(
  session: TenantSession,
  tipo: NotificationTypeDefinition,
  event: RoutableEvent,
  membershipId: string,
  now: Date
): Promise<RoutedNotification | null> {
  const destinatario = await loadRecipient(session, membershipId, tipo.key);
  if (!destinatario) return null;

  const chave = dedupeKey(tipo.key, membershipId, event.aggregateId);

  if (tipo.dedupeMinutes > 0) {
    const [recente] = await session.query<{ id: string }>(
      `SELECT id FROM aurora.notifications
        WHERE dedupe_key = $1 AND created_at > $2::timestamptz - ($3 || ' minutes')::interval
        LIMIT 1`,
      [chave, now, tipo.dedupeMinutes]
    );
    if (recente) return null;
  }

  const relogio = localClock(now, destinatario.timezone);
  const id = newId();

  await session.query(
    // O instante gravado é o que o roteador RECEBEU, não `now()` do banco.
    // Um roteador que aceita "agora" como parâmetro e depois carimba outro
    // instante é um roteador que se contradiz — e a janela de de-duplicação,
    // que compara os dois, nunca fecharia.
    `INSERT INTO aurora.notifications
       (id, organization_id, membership_id, type_key, event_id, aggregate_type, aggregate_id,
        title, body, link, dedupe_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      session.context.organizationId,
      membershipId,
      tipo.key,
      event.id ?? null,
      event.aggregateType,
      event.aggregateId,
      tipo.label,
      typeof event.payload.number === 'string' ? `Referência ${event.payload.number}` : null,
      `/${event.aggregateType}s/${event.aggregateId}`,
      chave,
      now,
    ]
  );

  const entregas: RoutedNotification['deliveries'] = [];

  for (const canal of tipo.channels) {
    const decisao = decideDelivery({
      type: tipo,
      channel: canal,
      preference: destinatario.preferences.get(canal) ?? null,
      quiet: destinatario.quiet,
      minuteOfDay: relogio.minuteOfDay,
      weekday: relogio.weekday,
      emailVerified: destinatario.emailVerified,
      duplicateWithinWindow: false,
    });

    const estado = decisao.deliver
      ? 'pending'
      : decisao.reason === 'unverified_email' || decisao.reason === 'channel_disabled'
        ? 'suppressed'
        : 'digested';

    await session.query(
      `INSERT INTO aurora.notification_deliveries
         (id, organization_id, notification_id, channel, state, reason, digest)
       VALUES ($1, $2, $3, $4::aurora.notification_channel, $5::aurora.delivery_state, $6,
               $7::aurora.digest_mode)`,
      [newId(), session.context.organizationId, id, canal, estado, decisao.reason, decisao.digest ?? null]
    );

    entregas.push({ channel: canal, state: estado, reason: decisao.reason });
  }

  return { notificationId: id, membershipId, typeKey: tipo.key, deliveries: entregas };
}

/* -------------------------------------------------------------------------- */
/* caixa de entrada                                                            */
/* -------------------------------------------------------------------------- */

export interface InboxItem {
  id: string;
  type_key: string;
  title: string;
  body: string | null;
  link: string | null;
  aggregate_type: string;
  aggregate_id: string;
  created_at: Date;
  read_at: Date | null;
}

export async function inbox(
  session: TenantSession,
  membershipId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<InboxItem[]> {
  const limite = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return session.query<InboxItem>(
    `SELECT id, type_key, title, body, link, aggregate_type, aggregate_id, created_at, read_at
       FROM aurora.notifications
      WHERE membership_id = $1
        AND (NOT $2::boolean OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT ${limite}`,
    [membershipId, opts.unreadOnly ?? false]
  );
}

export async function unreadCount(session: TenantSession, membershipId: string): Promise<number> {
  const [row] = await session.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM aurora.notifications
      WHERE membership_id = $1 AND read_at IS NULL`,
    [membershipId]
  );
  return Number(row!.total);
}

/**
 * Marca como lida.
 *
 * Idempotente e sem reabertura: `read_at` só é escrito uma vez. Deixar marcar
 * como não lida de novo pareceria uma gentileza e faria a contagem de não lidas
 * deixar de significar "o que chegou desde a última vez que olhei".
 */
export async function markRead(
  session: TenantSession,
  membershipId: string,
  ids: readonly string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await session.query(
    `UPDATE aurora.notifications SET read_at = now()
      WHERE membership_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL
      RETURNING id`,
    [membershipId, ids]
  );
  return rows.length;
}

export async function markAllRead(session: TenantSession, membershipId: string): Promise<number> {
  const rows = await session.query(
    `UPDATE aurora.notifications SET read_at = now()
      WHERE membership_id = $1 AND read_at IS NULL RETURNING id`,
    [membershipId]
  );
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* preferências                                                                */
/* -------------------------------------------------------------------------- */

export async function setPreference(
  session: TenantSession,
  membershipId: string,
  input: { typeKey: string; channel: NotificationChannel; enabled?: boolean; digest?: DigestMode }
): Promise<void> {
  const tipo = notificationType(input.typeKey);
  if (!tipo) {
    throw new ValidationError(`tipo de notificação desconhecido: ${input.typeKey}`, {
      field: 'typeKey',
    });
  }
  if (!tipo.channels.includes(input.channel)) {
    throw new ValidationError(
      `"${tipo.label}" não é enviado por ${input.channel}; canais possíveis: ${tipo.channels.join(', ')}`,
      { field: 'channel' }
    );
  }

  await session.query(
    `INSERT INTO aurora.notification_preferences
       (organization_id, membership_id, type_key, channel, enabled, digest)
     VALUES ($1, $2, $3, $4::aurora.notification_channel, $5, $6::aurora.digest_mode)
     ON CONFLICT (membership_id, type_key, channel) DO UPDATE
        SET enabled = EXCLUDED.enabled, digest = EXCLUDED.digest, updated_at = now()`,
    [
      session.context.organizationId,
      membershipId,
      input.typeKey,
      input.channel,
      input.enabled ?? true,
      input.digest ?? 'immediate',
    ]
  );
}

export async function setQuietHours(
  session: TenantSession,
  membershipId: string,
  quiet: { startMinute: number | null; endMinute: number | null; fullDays?: number[] }
): Promise<void> {
  if ((quiet.startMinute === null) !== (quiet.endMinute === null)) {
    throw new ValidationError('informe início e fim do silêncio, ou nenhum dos dois');
  }
  const rows = await session.query(
    `UPDATE aurora.memberships
        SET quiet_start_minute = $2, quiet_end_minute = $3, quiet_full_days = $4::int[]
      WHERE id = $1 RETURNING id`,
    [membershipId, quiet.startMinute, quiet.endMinute, quiet.fullDays ?? []]
  );
  if (rows.length === 0) throw new NotFoundError('vínculo não encontrado');
}

/**
 * Marca o e-mail como verificado.
 *
 * Fica aqui, e não no módulo de identidade, porque a consequência é toda deste
 * épico: enquanto não verificado, o canal de e-mail é suprimido. O fluxo de
 * envio e conferência do código é do EPIC-002 estendido — o que existe agora é
 * o efeito, para o roteador poder respeitá-lo.
 */
export async function markEmailVerified(session: TenantSession, userId: string): Promise<void> {
  await session.query(
    `UPDATE aurora.users SET email_verified_at = now(), email_blocked_at = NULL,
                             email_blocked_reason = NULL
      WHERE id = $1`,
    [userId]
  );
}

export async function blockEmail(session: TenantSession, userId: string, reason: string): Promise<void> {
  await session.query(
    `UPDATE aurora.users SET email_blocked_at = now(), email_blocked_reason = $2 WHERE id = $1`,
    [userId, reason]
  );
}

/* -------------------------------------------------------------------------- */
/* fila de saída                                                               */
/* -------------------------------------------------------------------------- */

export interface PendingDelivery {
  id: string;
  channel: NotificationChannel;
  title: string;
  body: string | null;
  link: string | null;
  membership_id: string;
  email: string | null;
}

/**
 * O que está esperando para sair.
 *
 * O transporte de fato — mandar o e-mail, empurrar o push — NÃO está aqui e não
 * está fingido em lugar nenhum: a entrega fica `pending` até que um adaptador
 * real a marque. Um envio simulado que grava "sent" seria a pior forma de
 * mentira num sistema de notificação, porque some sem deixar rastro.
 */
export async function pendingDeliveries(
  session: TenantSession,
  channel: NotificationChannel,
  limit = 100
): Promise<PendingDelivery[]> {
  const n = Math.min(Math.max(limit, 1), 500);
  return session.query<PendingDelivery>(
    `SELECT d.id, d.channel::text AS channel, n.title, n.body, n.link, n.membership_id, u.email
       FROM aurora.notification_deliveries d
       JOIN aurora.notifications n ON n.id = d.notification_id
       JOIN aurora.memberships m ON m.id = n.membership_id
       JOIN aurora.users u ON u.id = m.user_id
      WHERE d.state = 'pending' AND d.channel = $1::aurora.notification_channel
      ORDER BY d.created_at
      LIMIT ${n}`,
    [channel]
  );
}

export async function markDeliverySent(session: TenantSession, deliveryId: string): Promise<void> {
  await session.query(
    `UPDATE aurora.notification_deliveries
        SET state = 'sent', sent_at = now(), attempts = attempts + 1
      WHERE id = $1 AND state = 'pending'`,
    [deliveryId]
  );
}

export async function markDeliveryFailed(
  session: TenantSession,
  deliveryId: string,
  error: string
): Promise<void> {
  await session.query(
    `UPDATE aurora.notification_deliveries
        SET state = 'failed', attempts = attempts + 1, last_error = $2
      WHERE id = $1`,
    [deliveryId, error.slice(0, 500)]
  );
}
