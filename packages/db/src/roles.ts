/**
 * Aurora — papéis, permissões e exceções (SPEC v0.2 §04, §05 · EPIC-002).
 *
 * POR QUE ISTO PRECISOU EXISTIR
 *
 * O modelo de papéis está no banco desde a migration 0005 — `roles`,
 * `role_permissions`, `membership_roles`, `membership_permission_overrides` — e
 * a função `effective_permissions` resolve a conta inteira. O que não existia
 * era como PERGUNTAR: nenhuma rota listava papéis, dizia o que um papel
 * concede, ou mostrava por que uma pessoa consegue fazer algo.
 *
 * A consequência prática é a que a auditoria do sistema de referência
 * registrou: quando ninguém consegue ver a conta, a resposta a "por que o
 * Rafael não consegue fechar a OS?" vira tentativa e erro, e o desfecho
 * habitual é alguém receber um papel a mais "para destravar" — que é como uma
 * organização acorda com sete pessoas tendo permissão de apagar contrato.
 *
 * A EXPLICAÇÃO É O PRODUTO
 *
 * `explainPermissions` devolve, para cada permissão, DE ONDE ela veio: qual
 * papel a concedeu, ou qual exceção a concedeu ou negou. Uma lista de
 * permissões sem procedência não responde à pergunta que se faz olhando para
 * ela — e é a procedência que permite corrigir no lugar certo, em vez de
 * empilhar mais uma exceção por cima.
 */
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* Papéis                                                                     */
/* -------------------------------------------------------------------------- */

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  seat_type: string;
  /**
   * Papel de fábrica.
   *
   * Não pode ser apagado nem ter a chave trocada: relatórios, automações e a
   * própria semente referenciam a chave. Quem precisa de algo diferente COPIA
   * — e a cópia guarda de quem copiou, em `copied_from_key`, porque saber que
   * "Coordenador Noturno" nasceu de "Coordenador" é o que permite comparar as
   * duas quando o de fábrica muda.
   */
  is_system: boolean;
  copied_from_key: string | null;
  permission_count: number;
  /** Quantas pessoas têm este papel hoje. */
  member_count: number;
}

export async function listRoles(session: TenantSession): Promise<RoleRow[]> {
  return session.query<RoleRow>(
    `SELECT r.id, r.key, r.name, r.description, r.seat_type::text AS seat_type,
            r.is_system, r.copied_from_key,
            (SELECT count(*)::int FROM aurora.role_permissions rp WHERE rp.role_id = r.id)
              AS permission_count,
            (SELECT count(*)::int
               FROM aurora.membership_roles mr
               JOIN aurora.memberships m ON m.id = mr.membership_id
              WHERE mr.role_id = r.id AND m.deleted_at IS NULL)
              AS member_count
       FROM aurora.roles r
      WHERE r.deleted_at IS NULL
      ORDER BY r.is_system DESC, r.name`
  );
}

/** As permissões que um papel concede, em ordem de chave. */
export async function rolePermissions(session: TenantSession, roleId: string): Promise<string[]> {
  const rows = await session.query<{ permission_key: string }>(
    `SELECT permission_key FROM aurora.role_permissions
      WHERE role_id = $1 ORDER BY permission_key`,
    [roleId]
  );
  return rows.map((r) => r.permission_key);
}

/* -------------------------------------------------------------------------- */
/* A explicação                                                               */
/* -------------------------------------------------------------------------- */

export interface PermissionOrigin {
  permission_key: string;
  /**
   * `grant` significa que a pessoa PODE. `deny` aparece porque uma exceção
   * negou algo que um papel concedia — e é a linha mais importante da lista,
   * já que sem ela a pessoa parece ter a permissão do papel.
   *
   * A palavra é `grant` e não `allow` porque é o que a coluna guarda desde a
   * migration 0005, com `CHECK` no banco. Traduzir na fronteira criaria dois
   * vocabulários para a mesma coisa, e o dia em que alguém consultasse a
   * tabela direto encontraria a palavra que a API não usa.
   */
  effect: 'grant' | 'deny';
  /** `role` quando veio de um papel; `override` quando veio de uma exceção. */
  source: 'role' | 'override';
  /** O papel de origem, quando `source` é `role`. */
  role_key: string | null;
  role_name: string | null;
  /** A justificativa da exceção — exigida ao criá-la. */
  reason: string | null;
  expires_at: Date | null;
}

/**
 * De onde vem cada permissão desta pessoa.
 *
 * A ordem da conta é a mesma que `aurora.effective_permissions` aplica: os
 * papéis somam, e as exceções decidem por último — `deny` vence `allow`, e
 * exceção vencida por data não conta.
 *
 * Uma permissão pode aparecer por mais de um papel, e as duas linhas ficam: é
 * exatamente essa duplicidade que explica por que remover um papel não tirou o
 * acesso, que é a confusão mais comum de quem administra permissões.
 */
export async function explainPermissions(
  session: TenantSession,
  membershipId: string
): Promise<PermissionOrigin[]> {
  return session.query<PermissionOrigin>(
    `SELECT rp.permission_key,
            'grant'::text AS effect,
            'role'::text  AS source,
            r.key  AS role_key,
            r.name AS role_name,
            NULL::text AS reason,
            NULL::timestamptz AS expires_at
       FROM aurora.membership_roles mr
       JOIN aurora.roles r            ON r.id = mr.role_id AND r.deleted_at IS NULL
       JOIN aurora.role_permissions rp ON rp.role_id = r.id
      WHERE mr.membership_id = $1

      UNION ALL

     SELECT o.permission_key,
            o.effect,
            'override'::text,
            NULL, NULL,
            o.reason,
            o.expires_at
       FROM aurora.membership_permission_overrides o
      WHERE o.membership_id = $1
        -- Exceção vencida não conta, e some da explicação: mantê-la visível
        -- faria alguém "corrigir" removendo uma linha que já não fazia nada.
        AND (o.expires_at IS NULL OR o.expires_at > now())

      ORDER BY 1, 3, 4`,
    [membershipId]
  );
}

/* -------------------------------------------------------------------------- */
/* Exceções pontuais                                                          */
/* -------------------------------------------------------------------------- */

export interface OverrideInput {
  membershipId: string;
  permissionKey: string;
  effect: 'grant' | 'deny';
  /**
   * Exigida, com pelo menos cinco caracteres — o banco recusa menos que isso
   * desde a 0005. Uma exceção sem motivo é indistinguível de um engano, e
   * ninguém consegue decidir seis meses depois se pode removê-la.
   */
  reason: string;
  /**
   * Quando a exceção deixa de valer.
   *
   * Nulo é permanente, e permanente deveria ser raro: a exceção existe para a
   * substituição de duas semanas, para a auditoria de um mês. A exceção
   * permanente é um papel que ninguém teve coragem de criar — e, ao contrário
   * do papel, ela não aparece em nenhuma lista de quem tem o quê.
   */
  expiresAt: Date | null;
}

export async function setPermissionOverride(session: TenantSession, input: OverrideInput): Promise<void> {
  const motivo = input.reason.trim();
  if (motivo.length < 5) {
    throw new Error('exceção de permissão exige motivo com ao menos cinco caracteres');
  }
  await session.query(
    `INSERT INTO aurora.membership_permission_overrides
       (organization_id, membership_id, permission_key, effect, reason, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (membership_id, permission_key)
     DO UPDATE SET effect = EXCLUDED.effect,
                   reason = EXCLUDED.reason,
                   expires_at = EXCLUDED.expires_at`,
    [
      session.context.organizationId,
      input.membershipId,
      input.permissionKey,
      input.effect,
      motivo,
      input.expiresAt,
      session.context.actorId,
    ]
  );
}

export async function clearPermissionOverride(
  session: TenantSession,
  membershipId: string,
  permissionKey: string
): Promise<void> {
  await session.query(
    `DELETE FROM aurora.membership_permission_overrides
      WHERE membership_id = $1 AND permission_key = $2`,
    [membershipId, permissionKey]
  );
}

/* -------------------------------------------------------------------------- */
/* Papéis de uma pessoa                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Troca o conjunto de papéis de um vínculo, de uma vez.
 *
 * De uma vez, e não um a um: entre remover o papel antigo e conceder o novo
 * existe um instante em que a pessoa não tem nenhum — e se a segunda operação
 * falhar, ela fica sem nenhum. Aqui as duas acontecem na mesma transação da
 * sessão, e o estado intermediário não existe para ninguém.
 */
export async function setMemberRoles(
  session: TenantSession,
  membershipId: string,
  roleIds: readonly string[]
): Promise<void> {
  await session.query(`DELETE FROM aurora.membership_roles WHERE membership_id = $1`, [membershipId]);
  for (const roleId of roleIds) {
    await session.query(
      `INSERT INTO aurora.membership_roles (organization_id, membership_id, role_id, created_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [session.context.organizationId, membershipId, roleId, session.context.actorId]
    );
  }
}
