/**
 * Aurora — convite e vínculo (SPEC v0.2 §05 · §21 · EPIC-002).
 *
 * O vínculo é a unidade de acesso: a mesma pessoa pode existir em duas
 * organizações com papéis e escopos diferentes, e é o vínculo — não o usuário —
 * que carrega isso.
 *
 * A REGRA QUE ESTE MÓDULO EXISTE PARA CUMPRIR
 *   Vínculo e escopo nascem juntos, na mesma transação. Um vínculo sem escopo
 *   não enxerga nada, e a pessoa convidada entra numa tela vazia sem conseguir
 *   distinguir "não tenho permissão" de "meu cadastro ficou pela metade".
 *
 *   A garantia não está aqui: está na migration 0039, num gatilho de restrição
 *   diferido que verifica no COMMIT. Este módulo é o caminho conveniente; o
 *   gatilho é o que impede o caminho inconveniente de existir.
 */
import { newId, ValidationError, ConflictError, NotFoundError, isKnownPermission } from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

// Os valores do tipo `aurora.seat_type` (0000): `customer` não existe no banco.
export const SEAT_TYPES = ['staff', 'portal'] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

export const SCOPE_MODES = ['all', 'listed'] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

export interface MembershipScopeInput {
  /** `all` enxerga todos os clientes; `listed` só os informados. */
  customerScope?: ScopeMode;
  customerIds?: readonly string[];
  locationScope?: ScopeMode;
  locationIds?: readonly string[];
}

export interface InviteInput {
  email: string;
  name: string;
  seatType?: SeatType;
  /** Chaves de papel de fábrica, ou identificadores de papel próprio. */
  roleKeys?: readonly string[];
  scope?: MembershipScopeInput;
  dailyHours?: number | null;
  timezone?: string | null;
}

export interface InviteResult {
  userId: string;
  membershipId: string;
  /** O usuário já existia na plataforma e ganhou mais um vínculo. */
  reusedUser: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Convida uma pessoa para a organização.
 *
 * Tudo numa transação só — `withTenant` já a abre, e é por isso que esta função
 * não abre outra. Se qualquer passo falhar, nada fica: nem usuário órfão, nem
 * vínculo cego, nem papel atribuído a ninguém.
 *
 * O usuário é reaproveitado quando o e-mail já existe. A alternativa seria
 * criar um segundo usuário com o mesmo endereço, e aí a mesma pessoa teria duas
 * identidades — o que quebra a resolução de identidade do EPIC-002 e faz o
 * seletor de organização mostrar metade dos vínculos dela.
 */
export async function inviteMember(session: TenantSession, input: InviteInput): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    throw new ValidationError('informe um endereço de e-mail válido', { field: 'email' });
  }
  if (input.name.trim().length < 2) {
    throw new ValidationError('informe o nome de quem está sendo convidado', { field: 'name' });
  }

  const escopo = input.scope ?? {};
  validateScope(escopo);

  const org = session.context.organizationId;

  /*
   * A pessoa pode já existir na plataforma — o consultor que atende duas
   * empresas é o caso normal, não a exceção. A resolução por e-mail devolve só
   * o identificador, através de função estreita (0040), porque a RLS de `users`
   * esconde — corretamente — quem pertence a outra organização.
   */
  const [achado] = await session.query<{ id: string | null }>(
    `SELECT aurora.find_user_id_by_email($1) AS id`,
    [email]
  );

  const reusedUser = Boolean(achado?.id);
  const userId = achado?.id ?? newId();

  if (reusedUser) {
    const [jaVinculado] = await session.query<{ id: string; status: string }>(
      `SELECT id, status FROM aurora.memberships WHERE user_id = $1 AND organization_id = $2`,
      [userId, org]
    );
    if (jaVinculado) {
      throw new ConflictError(
        jaVinculado.status === 'active'
          ? `${email} já faz parte desta organização`
          : `${email} já tem vínculo com esta organização, em situação "${jaVinculado.status}" — reative em vez de convidar de novo`
      );
    }
  }

  /*
   * ORDEM INVERTIDA DE PROPÓSITO: vínculo antes de usuário.
   *
   * A política de `users` só aprova a linha quando existe vínculo dela com a
   * organização corrente. Com a chave estrangeira diferida da 0040, inserir o
   * vínculo primeiro satisfaz a política sem abrir exceção nenhuma — e a
   * integridade continua verificada no COMMIT.
   */
  const membershipId = newId();
  await session.query(
    `INSERT INTO aurora.memberships
       (id, organization_id, user_id, status, seat_type, is_owner, daily_hours, invited_at)
     VALUES ($1, $2, $3, 'active', $4::aurora.seat_type, false, $5, now())`,
    [membershipId, org, userId, input.seatType ?? 'staff', input.dailyHours ?? null]
  );

  if (!reusedUser) {
    await session.query(
      `INSERT INTO aurora.users (id, email, name, timezone)
       VALUES ($1, $2, $3, COALESCE($4, 'America/Sao_Paulo'))`,
      [userId, email, input.name.trim(), input.timezone ?? null]
    );
  }

  // Na MESMA transação: é o escopo que transforma o vínculo em acesso, e o
  // gatilho diferido da 0039 recusa o COMMIT sem ele.
  await session.query(
    `INSERT INTO aurora.membership_scopes
       (membership_id, organization_id, customer_scope, customer_ids, location_scope, location_ids)
     VALUES ($1, $2, $3::aurora.scope_mode, $4::uuid[], $5::aurora.scope_mode, $6::uuid[])`,
    [
      membershipId,
      org,
      escopo.customerScope ?? 'all',
      escopo.customerIds ?? [],
      escopo.locationScope ?? 'all',
      escopo.locationIds ?? [],
    ]
  );

  for (const chave of input.roleKeys ?? []) {
    const [papel] = await session.query<{ id: string }>(
      `SELECT id FROM aurora.roles WHERE key = $1 AND deleted_at IS NULL`,
      [chave]
    );
    if (!papel) {
      throw new NotFoundError(`papel "${chave}" não existe nesta organização`);
    }
    await session.query(
      `INSERT INTO aurora.membership_roles (membership_id, role_id, organization_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [membershipId, papel.id, org]
    );
  }

  await emitEvent(session, {
    type: 'member.invited',
    aggregateId: membershipId,
    payload: { email, name: input.name.trim(), seatType: input.seatType ?? 'staff', reusedUser },
  });

  return { userId, membershipId, reusedUser };
}

/**
 * Ajusta o escopo de um vínculo existente.
 *
 * Sempre `UPDATE`, nunca `DELETE` seguido de `INSERT`: apagar deixaria o
 * vínculo cego pela duração da transação, e um erro no meio o deixaria cego
 * para sempre. O gatilho da 0039 recusaria o `DELETE`, mas a ordem certa não
 * deve depender de o banco reclamar.
 */
export async function setMembershipScope(
  session: TenantSession,
  membershipId: string,
  scope: MembershipScopeInput
): Promise<void> {
  validateScope(scope);

  const linhas = await session.query(
    `UPDATE aurora.membership_scopes
        SET customer_scope = COALESCE($2::aurora.scope_mode, customer_scope),
            customer_ids   = COALESCE($3::uuid[], customer_ids),
            location_scope = COALESCE($4::aurora.scope_mode, location_scope),
            location_ids   = COALESCE($5::uuid[], location_ids)
      WHERE membership_id = $1
      RETURNING membership_id`,
    [
      membershipId,
      scope.customerScope ?? null,
      scope.customerIds ?? null,
      scope.locationScope ?? null,
      scope.locationIds ?? null,
    ]
  );

  if (linhas.length === 0) {
    throw new NotFoundError('vínculo não encontrado nesta organização');
  }
}

/**
 * Suspende um vínculo.
 *
 * O vínculo é suspenso, não apagado: apagar levaria junto a trilha de quem fez
 * o quê, e a pergunta "quem mexeu nisso?" passaria a ter como resposta um
 * identificador sem dono.
 *
 * "suspended" é o rótulo do enum e do evento — a mesma palavra nos três lugares,
 * porque três nomes para o mesmo estado é como um relatório passa a discordar
 * da tela.
 */
export async function suspendMembership(
  session: TenantSession,
  membershipId: string,
  reason: string
): Promise<void> {
  if (reason.trim().length < 5) {
    throw new ValidationError('informe o motivo da suspensão', { field: 'reason' });
  }

  const [alvo] = await session.query<{ is_owner: boolean }>(
    `SELECT is_owner FROM aurora.memberships WHERE id = $1`,
    [membershipId]
  );
  if (!alvo) throw new NotFoundError('vínculo não encontrado');

  if (alvo.is_owner) {
    const [outros] = await session.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM aurora.memberships
        WHERE is_owner AND status = 'active' AND id <> $1`,
      [membershipId]
    );
    // Uma organização sem proprietário ativo é uma organização que ninguém
    // consegue administrar — e o caminho de volta exige suporte.
    if (Number(outros!.total) === 0) {
      throw new ConflictError(
        'este é o último proprietário ativo: transfira a titularidade antes de suspender o vínculo'
      );
    }
  }

  await session.query(`UPDATE aurora.memberships SET status = 'suspended' WHERE id = $1`, [membershipId]);

  await emitEvent(session, {
    type: 'member.suspended',
    aggregateId: membershipId,
    payload: { reason: reason.trim() },
  });
}

export interface MemberRow {
  membership_id: string;
  user_id: string;
  name: string;
  email: string;
  status: string;
  seat_type: string;
  is_owner: boolean;
  roles: string[];
  customer_scope: string;
  location_scope: string;
}

export async function listMembers(session: TenantSession): Promise<MemberRow[]> {
  return session.query<MemberRow>(
    `SELECT m.id AS membership_id, u.id AS user_id, u.name, u.email,
            m.status::text AS status, m.seat_type::text AS seat_type, m.is_owner,
            COALESCE(
              (SELECT array_agg(r.key ORDER BY r.key)
                 FROM aurora.membership_roles mr
                 JOIN aurora.roles r ON r.id = mr.role_id
                WHERE mr.membership_id = m.id),
              '{}'
            ) AS roles,
            s.customer_scope::text AS customer_scope,
            s.location_scope::text AS location_scope
       FROM aurora.memberships m
       JOIN aurora.users u ON u.id = m.user_id
       LEFT JOIN aurora.membership_scopes s ON s.membership_id = m.id
      WHERE m.deleted_at IS NULL
      ORDER BY m.status, u.name`
  );
}

/**
 * Vínculos sem escopo.
 *
 * Deve devolver sempre zero desde a 0039. Existe porque uma garantia estrutural
 * só vale enquanto alguém a verifica — e uma migration futura pode remover o
 * gatilho sem que nada mais quebre.
 */
export async function membershipsWithoutScope(session: TenantSession): Promise<string[]> {
  const linhas = await session.query<{ id: string }>(
    `SELECT m.id FROM aurora.memberships m
      WHERE NOT EXISTS (SELECT 1 FROM aurora.membership_scopes s WHERE s.membership_id = m.id)`
  );
  return linhas.map((l) => l.id);
}

function validateScope(scope: MembershipScopeInput): void {
  const erros: string[] = [];

  if (scope.customerScope === 'listed' && (scope.customerIds ?? []).length === 0) {
    // Escopo "listado" com lista vazia não enxerga cliente nenhum. É um estado
    // válido no banco e quase sempre um engano de quem preenche o formulário.
    erros.push('escopo de clientes "listed" exige ao menos um cliente');
  }
  if (scope.locationScope === 'listed' && (scope.locationIds ?? []).length === 0) {
    erros.push('escopo de locais "listed" exige ao menos um local');
  }

  if (erros.length > 0) throw new ValidationError(erros.join('; '));
}

/** Confere que uma chave de permissão citada por integração existe (§21). */
export function assertKnownPermission(key: string): void {
  if (!isKnownPermission(key)) {
    throw new ValidationError(`permissão desconhecida: ${key}`, { field: 'permission' });
  }
}
