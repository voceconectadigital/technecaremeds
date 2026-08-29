/**
 * Aurora — leitura da trilha de auditoria (SPEC v0.2 §22 · EPIC-022).
 *
 * A trilha existe desde a migration 0002 e é append-only por permissão de
 * banco. O que faltava é o que este módulo entrega: como LER.
 *
 * Uma trilha que ninguém consegue consultar tem exatamente o mesmo valor
 * prático de trilha nenhuma na hora em que alguém pergunta "quem mexeu nisso?"
 * — e é sempre nessa hora que se descobre.
 *
 * AS DUAS CAMADAS, JUNTAS
 *   `audit_logs` registra a mutação: quem mudou o quê, de qual valor para qual.
 *   `domain_events` registra o fato de negócio: "OS concluída", "SLA violado".
 *
 *   O §22 explica por que as duas existem — um evento não captura a edição de
 *   um campo qualquer; um diff não sabe que "a OS foi concluída" é diferente de
 *   "o campo `status_id` mudou". A linha do tempo daqui MISTURA as duas em
 *   ordem cronológica, porque é assim que a pessoa lê: ela quer a história do
 *   registro, não duas listas para conciliar de cabeça.
 */
import { ValidationError } from '@aurora/domain';
import type { TenantSession } from './client';

export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditFilters {
  entityType?: string | null;
  entityId?: string | null;
  actorUserId?: string | null;
  action?: AuditAction | null;
  from?: Date | null;
  to?: Date | null;
  requestId?: string | null;
}

export interface AuditEntry {
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_kind: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  action: AuditAction;
  changes: Record<string, { from: unknown; to: unknown }>;
  client_ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  source: string;
}

/**
 * A trilha global, filtrável.
 *
 * O nome do ator vem resolvido na consulta e não no cliente: sem ele a tela
 * mostraria um identificador, e "quem mexeu nisso?" respondido com um uuid não
 * é resposta.
 *
 * O período é limitado porque a trilha é a maior tabela do sistema — cada
 * escrita de negócio gera uma linha. Uma consulta sem recorte varreria meses.
 */
export async function auditTrail(
  session: TenantSession,
  filters: AuditFilters = {},
  limit = 100
): Promise<AuditEntry[]> {
  if (filters.from && filters.to && filters.to.getTime() < filters.from.getTime()) {
    throw new ValidationError('o fim do período precisa ser depois do início', { field: 'to' });
  }

  const n = Math.min(Math.max(limit, 1), 500);
  return session.query<AuditEntry>(
    `SELECT a.id::text AS id, a.occurred_at, a.actor_user_id, u.name AS actor_name,
            a.actor_kind::text AS actor_kind, a.entity_type, a.entity_id, a.entity_label,
            a.action::text AS action, a.changes, a.client_ip, a.user_agent, a.request_id, a.source
       FROM aurora.audit_logs a
       LEFT JOIN aurora.users u ON u.id = a.actor_user_id
      WHERE ($1::text IS NULL OR a.entity_type = $1)
        AND ($2::text IS NULL OR a.entity_id = $2)
        AND ($3::uuid IS NULL OR a.actor_user_id = $3)
        AND ($4::text IS NULL OR a.action::text = $4)
        AND ($5::timestamptz IS NULL OR a.occurred_at >= $5)
        AND ($6::timestamptz IS NULL OR a.occurred_at < $6)
        AND ($7::text IS NULL OR a.request_id = $7)
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT ${n}`,
    [
      filters.entityType ?? null,
      filters.entityId ?? null,
      filters.actorUserId ?? null,
      filters.action ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.requestId ?? null,
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* linha do tempo                                                              */
/* -------------------------------------------------------------------------- */

export type TimelineKind = 'change' | 'event';

export interface TimelineEntry {
  kind: TimelineKind;
  at: Date;
  actorName: string | null;
  actorKind: string;
  /** Para mudança: a ação. Para evento: o tipo do evento. */
  label: string;
  /** Campos alterados, quando é mudança. */
  changes: Record<string, { from: unknown; to: unknown }> | null;
  /** Conteúdo do fato, quando é evento. */
  payload: Record<string, unknown> | null;
  /** A regra de automação que causou, quando houve uma. */
  causedByRuleId: string | null;
}

/**
 * A história de um registro, com as duas camadas em ordem.
 *
 * As duas consultas são separadas e a fusão acontece aqui, em memória. Um
 * `UNION` no banco obrigaria as colunas a se alinharem — `changes` e `payload`
 * são `jsonb` mas significam coisas diferentes, e forçá-las na mesma coluna
 * produziria uma linha do tempo em que ninguém distingue o diff do fato.
 *
 * O limite é aplicado DEPOIS da fusão e da ordenação: cortar antes traria as
 * cem mudanças mais recentes e nenhum evento, ou o contrário, dependendo de
 * qual lado teve mais movimento — e a história ficaria com um buraco que não se
 * anuncia.
 */
export async function recordTimeline(
  session: TenantSession,
  entityType: string,
  entityId: string,
  limit = 100
): Promise<TimelineEntry[]> {
  const n = Math.min(Math.max(limit, 1), 300);
  const teto = n * 2;

  const mudancas = await session.query<{
    occurred_at: Date;
    actor_name: string | null;
    actor_kind: string;
    action: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }>(
    `SELECT a.occurred_at, u.name AS actor_name, a.actor_kind::text AS actor_kind,
            a.action::text AS action, a.changes
       FROM aurora.audit_logs a
       LEFT JOIN aurora.users u ON u.id = a.actor_user_id
      WHERE a.entity_type = $1 AND a.entity_id = $2
      ORDER BY a.occurred_at DESC
      LIMIT ${teto}`,
    [entityType, entityId]
  );

  const eventos = await session.query<{
    occurred_at: Date;
    actor_name: string | null;
    actor_kind: string;
    type: string;
    payload: Record<string, unknown>;
    caused_by_rule_id: string | null;
  }>(
    `SELECT e.occurred_at, u.name AS actor_name, e.actor_kind::text AS actor_kind,
            e.type, e.payload, e.caused_by_rule_id
       FROM aurora.domain_events e
       LEFT JOIN aurora.users u ON u.id = e.actor_user_id
      WHERE e.aggregate_id = $1::uuid
      ORDER BY e.occurred_at DESC
      LIMIT ${teto}`,
    [entityId]
  );

  const linha: TimelineEntry[] = [
    ...mudancas.map((m) => ({
      kind: 'change' as const,
      at: new Date(m.occurred_at),
      actorName: m.actor_name,
      actorKind: m.actor_kind,
      label: m.action,
      changes: m.changes,
      payload: null,
      causedByRuleId: null,
    })),
    ...eventos.map((e) => ({
      kind: 'event' as const,
      at: new Date(e.occurred_at),
      actorName: e.actor_name,
      actorKind: e.actor_kind,
      label: e.type,
      changes: null,
      payload: e.payload,
      causedByRuleId: e.caused_by_rule_id,
    })),
  ];

  return linha.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, n);
}

/* -------------------------------------------------------------------------- */
/* quem mexeu numa requisição                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tudo o que uma única requisição mudou.
 *
 * O `request_id` atravessa a aplicação e chega à trilha pela variável de sessão
 * do PostgreSQL (§22). Esta consulta é a que responde "o que essa chamada fez",
 * e é o que transforma um incidente relatado — "salvei e sumiram três campos" —
 * numa lista concreta em vez de uma investigação.
 */
export async function auditByRequest(session: TenantSession, requestId: string): Promise<AuditEntry[]> {
  return auditTrail(session, { requestId }, 500);
}

/* -------------------------------------------------------------------------- */
/* imutabilidade, verificada                                                   */
/* -------------------------------------------------------------------------- */

export interface AppendOnlyCheck {
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * Confere que a trilha continua append-only para o usuário da aplicação.
 *
 * Existe porque a garantia é de PERMISSÃO de banco, e permissão se perde numa
 * migration distraída sem que nada mais quebre — a aplicação continua
 * funcionando, e só um perito descobriria, anos depois, que a trilha podia ter
 * sido editada. Aqui a suíte pergunta ao banco, em vez de confiar.
 */
export async function appendOnlyCheck(session: TenantSession): Promise<AppendOnlyCheck> {
  const [row] = await session.query<{ upd: boolean; del: boolean }>(
    `SELECT has_table_privilege(current_user, 'aurora.audit_logs', 'UPDATE') AS upd,
            has_table_privilege(current_user, 'aurora.audit_logs', 'DELETE') AS del`
  );
  return { canUpdate: row!.upd, canDelete: row!.del };
}
