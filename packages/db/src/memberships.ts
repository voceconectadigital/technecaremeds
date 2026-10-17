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
import {
  newId,
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isKnownPermission,
  isValidCpf,
  normalizeCpf,
  isKnownRegistrationKind,
  isKnownUf,
  isValidRegistrationNumber,
  normalizeRegistrationNumber,
  profileOf,
  canChangeAccessState,
  type AccessState,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';
import { assertCanGrantRoles } from './roles';

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

/** Registro profissional: PAR (tipo, número), 0..N por pessoa. */
export interface RegistrationInput {
  kind: string;
  number: string;
  region?: string | null;
}

/** Dados de cadastro do vínculo (reunião 16/10/2026). Profissão NÃO concede permissão. */
export interface PersonDetailsInput {
  cpf?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  registrations?: readonly RegistrationInput[];
}

export interface InviteInput extends PersonDetailsInput {
  email: string;
  name: string;
  /**
   * Perfil de acesso de negócio (OPERADOR, SOLICITANTE, GESTOR). Quando vem,
   * decide o papel e o assento — e prevalece sobre `seatType`/`roleKeys`
   * informados à parte, para o formulário não conseguir combinar "Solicitante"
   * com assento de equipe.
   */
  profileKey?: string;
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

  let seatType: SeatType = input.seatType ?? 'staff';
  let roleKeys: readonly string[] = input.roleKeys ?? [];
  if (input.profileKey !== undefined) {
    const perfil = profileOf(input.profileKey);
    if (!perfil) throw new ValidationError('perfil de acesso desconhecido', { field: 'profile' });
    seatType = perfil.seatType;
    roleKeys = [perfil.roleKey];
  }
  const dados = normalizarDados(input);

  const org = session.context.organizationId;

  /*
   * ANTES de gravar qualquer coisa: quem convida só concede o que já tem —
   * papel (inclusive o que o perfil escolhe) e escopo (pente-fino 17/10).
   */
  const papeis: string[] = [];
  for (const chave of roleKeys) {
    const [papel] = await session.query<{ id: string }>(
      `SELECT id FROM aurora.roles WHERE key = $1 AND deleted_at IS NULL`,
      [chave]
    );
    if (!papel) {
      throw new NotFoundError(`papel "${chave}" não existe nesta organização`);
    }
    papeis.push(papel.id);
  }
  await assertCanGrantRoles(session, papeis);
  await conferirEscopoConcedido(session, {
    customerScope: escopo.customerScope ?? 'all',
    customerIds: escopo.customerIds ?? [],
    locationScope: escopo.locationScope ?? 'all',
    locationIds: escopo.locationIds ?? [],
  });

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
  await session
    .query(
      `INSERT INTO aurora.memberships
       (id, organization_id, user_id, status, seat_type, is_owner, daily_hours, invited_at,
        cpf, phone, company_name, job_title)
     VALUES ($1, $2, $3, 'active', $4::aurora.seat_type, false, $5, now(), $6, $7, $8, $9)`,
      [
        membershipId,
        org,
        userId,
        seatType,
        seatType === 'staff' ? (input.dailyHours ?? null) : null,
        dados.cpf ?? null,
        dados.phone ?? null,
        dados.companyName ?? null,
        dados.jobTitle ?? null,
      ]
    )
    .catch((e: unknown) => traduzirCpfDuplicado(e));

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

  for (const papelId of papeis) {
    await session.query(
      `INSERT INTO aurora.membership_roles (membership_id, role_id, organization_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [membershipId, papelId, org]
    );
  }

  if (dados.registrations) await gravarRegistros(session, membershipId, dados.registrations);

  await emitEvent(session, {
    type: 'member.invited',
    aggregateId: membershipId,
    payload: { email, name: input.name.trim(), seatType, reusedUser },
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

  // O próprio escopo não se ajusta: quem administra pessoas com escopo de um
  // setor alargaria o dele para a organização inteira (pente-fino 17/10).
  if (membershipId === session.context.membershipId) {
    throw new ForbiddenError(
      'organization.manage_members — o próprio escopo é ajustado por outra pessoa com acesso à organização'
    );
  }

  const [atual] = await session.query<{
    customer_scope: ScopeMode;
    customer_ids: string[];
    location_scope: ScopeMode;
    location_ids: string[];
  }>(
    `SELECT customer_scope::text AS customer_scope, customer_ids,
            location_scope::text AS location_scope, location_ids
       FROM aurora.membership_scopes WHERE membership_id = $1`,
    [membershipId]
  );
  if (!atual) {
    throw new NotFoundError('vínculo não encontrado nesta organização');
  }
  // O escopo que RESULTA (o pedido sobre o que já existe) é o que precisa caber
  // no de quem ajusta — trocar só o local de quem enxerga todos os clientes não
  // pode ser o atalho para manter o "todos".
  await conferirEscopoConcedido(session, {
    customerScope: scope.customerScope ?? atual.customer_scope,
    customerIds: scope.customerIds ?? atual.customer_ids ?? [],
    locationScope: scope.locationScope ?? atual.location_scope,
    locationIds: scope.locationIds ?? atual.location_ids ?? [],
  });

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
 * O escopo concedido cabe no de quem concede? (pente-fino 17/10)
 *
 * Quem enxerga tudo concede qualquer escopo. Quem é restrito só concede dentro
 * do que alcança: nunca "todos" no eixo em que ele mesmo não é "todos", e os
 * clientes e locais listados precisam estar entre os acessíveis a ele — as
 * mesmas funções (`accessible_*_ids`, 0010) que recortam as telas dele.
 * Cliente ou local fora do alcance é 404, como em qualquer rota: dizer 403
 * confirmaria que o id existe.
 *
 * Sem vínculo (provisionamento da organização, contexto de sistema) não há de
 * quem herdar borda — e é o caminho que cria o primeiro administrador.
 */
async function conferirEscopoConcedido(
  session: TenantSession,
  pedido: {
    customerScope: ScopeMode;
    customerIds: readonly string[];
    locationScope: ScopeMode;
    locationIds: readonly string[];
  }
): Promise<void> {
  const eu = session.context.membershipId;
  if (!eu) return;
  const [meu] = await session.query<{ customer_scope: ScopeMode; location_scope: ScopeMode }>(
    `SELECT customer_scope::text AS customer_scope, location_scope::text AS location_scope
       FROM aurora.membership_scopes WHERE membership_id = $1`,
    [eu]
  );
  if (meu && meu.customer_scope === 'all' && meu.location_scope === 'all') return;

  const restritoEmCliente = !meu || meu.customer_scope !== 'all';
  const restritoEmLocal = !meu || meu.location_scope !== 'all';
  if (
    (restritoEmCliente && pedido.customerScope === 'all') ||
    (restritoEmLocal && pedido.locationScope === 'all')
  ) {
    throw new ForbiddenError(
      'organization.manage_members — não é possível conceder um escopo maior que o seu (todos os clientes ou todos os locais)'
    );
  }

  if (pedido.customerScope === 'listed' && pedido.customerIds.length > 0) {
    const [fora] = await session.query<{ id: string }>(
      `SELECT x AS id FROM unnest($2::uuid[]) AS x
        WHERE x NOT IN (SELECT customer_id FROM aurora.accessible_customer_ids($1))
        LIMIT 1`,
      [eu, pedido.customerIds]
    );
    if (fora) throw new NotFoundError('cliente', fora.id);
  }
  if (pedido.locationScope === 'listed' && pedido.locationIds.length > 0) {
    const [fora] = await session.query<{ id: string }>(
      `SELECT x AS id FROM unnest($2::uuid[]) AS x
        WHERE x NOT IN (SELECT location_id FROM aurora.accessible_location_ids($1))
        LIMIT 1`,
      [eu, pedido.locationIds]
    );
    if (fora) throw new NotFoundError('local', fora.id);
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
  await setMembershipStatus(session, membershipId, 'suspended', reason);
}

/**
 * Muda a situação de acesso: ativo, suspenso ou bloqueado (reunião 16/10/2026).
 *
 * Nenhuma das três apaga o vínculo. A recusa de acesso não depende de a tela
 * obedecer: `find_memberships_for_email` (0005) só resolve vínculo ativo, então
 * a próxima requisição de quem foi suspenso ou bloqueado recebe 403, com
 * qualquer token que tenha guardado. O motivo vai para o vínculo e para o
 * evento — "por que essa pessoa perdeu (ou recuperou) o acesso?" tem resposta.
 *
 * Não existe suspensão automática por contrato: só uma pessoa com
 * `organization.manage_members` muda a situação, e sempre com motivo.
 */
export async function setMembershipStatus(
  session: TenantSession,
  membershipId: string,
  status: AccessState,
  reason: string
): Promise<void> {
  if (reason.trim().length < 5) {
    throw new ValidationError('informe o motivo (ao menos 5 caracteres)', { field: 'reason' });
  }

  const [alvo] = await session.query<{ is_owner: boolean; status: string }>(
    `SELECT is_owner, status::text AS status FROM aurora.memberships WHERE id = $1 AND deleted_at IS NULL`,
    [membershipId]
  );
  if (!alvo) throw new NotFoundError('vínculo não encontrado');
  if (!canChangeAccessState(alvo.status, status)) {
    throw new ConflictError(`o vínculo já está em "${alvo.status}" e não pode ir para "${status}"`);
  }
  if (alvo.is_owner && status !== 'active') {
    const [outros] = await session.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM aurora.memberships
        WHERE is_owner AND status = 'active' AND id <> $1`,
      [membershipId]
    );
    // Uma organização sem proprietário ativo é uma organização que ninguém
    // consegue administrar — e o caminho de volta exige suporte.
    if (Number(outros!.total) === 0) {
      throw new ConflictError(
        'este é o último proprietário ativo: transfira a titularidade antes de suspender ou bloquear o vínculo'
      );
    }
  }

  if (membershipId === session.context.membershipId && status !== 'active') {
    throw new ConflictError('você não pode suspender nem bloquear o próprio acesso');
  }

  await session.query(
    `UPDATE aurora.memberships
        SET status = $2::aurora.membership_status,
            status_reason = $3,
            status_changed_at = now(),
            status_changed_by = $4
      WHERE id = $1`,
    [membershipId, status, reason.trim(), session.context.actorId]
  );

  const tipo =
    status === 'active' ? 'member.reactivated' : status === 'blocked' ? 'member.blocked' : 'member.suspended';
  await emitEvent(session, {
    type: tipo,
    aggregateId: membershipId,
    payload: { reason: reason.trim(), from: alvo.status },
  });
}

/** Atualiza os dados de cadastro (não o e-mail, que é a identidade de entrada). */
export async function updateMemberDetails(
  session: TenantSession,
  membershipId: string,
  input: PersonDetailsInput
): Promise<void> {
  const dados = normalizarDados(input);
  const linhas = await session
    .query(
      `UPDATE aurora.memberships
          SET cpf          = CASE WHEN $2::boolean THEN $3 ELSE cpf END,
              phone        = CASE WHEN $4::boolean THEN $5 ELSE phone END,
              company_name = CASE WHEN $6::boolean THEN $7 ELSE company_name END,
              job_title    = CASE WHEN $8::boolean THEN $9 ELSE job_title END
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [
        membershipId,
        input.cpf !== undefined,
        dados.cpf ?? null,
        input.phone !== undefined,
        dados.phone ?? null,
        input.companyName !== undefined,
        dados.companyName ?? null,
        input.jobTitle !== undefined,
        dados.jobTitle ?? null,
      ]
    )
    .catch((e: unknown) => traduzirCpfDuplicado(e));
  if (linhas.length === 0) throw new NotFoundError('vínculo não encontrado nesta organização');

  if (dados.registrations) {
    await session.query(`DELETE FROM aurora.membership_registrations WHERE membership_id = $1`, [
      membershipId,
    ]);
    await gravarRegistros(session, membershipId, dados.registrations);
  }
  await emitEvent(session, {
    type: 'member.updated',
    aggregateId: membershipId,
    payload: { fields: Object.keys(input) },
  });
}

export interface MemberDetail extends MemberRow {
  cpf: string | null;
  phone: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  customer_ids: string[];
  location_ids: string[];
  registrations: { kind: string; number: string; region: string | null }[];
}

export async function getMember(session: TenantSession, membershipId: string): Promise<MemberDetail> {
  const [row] = await session.query<MemberDetail>(
    `SELECT m.id AS membership_id, u.id AS user_id, u.name, u.email,
            m.status::text AS status, m.seat_type::text AS seat_type, m.is_owner,
            COALESCE((SELECT array_agg(r.key ORDER BY r.key)
                        FROM aurora.membership_roles mr JOIN aurora.roles r ON r.id = mr.role_id
                       WHERE mr.membership_id = m.id), '{}') AS roles,
            s.customer_scope::text AS customer_scope, s.location_scope::text AS location_scope,
            COALESCE(s.customer_ids, '{}') AS customer_ids, COALESCE(s.location_ids, '{}') AS location_ids,
            m.job_title, m.company_name, (m.cpf IS NOT NULL) AS has_cpf,
            m.cpf, m.phone, m.status_reason, m.status_changed_at::text AS status_changed_at,
            COALESCE((SELECT json_agg(json_build_object('kind', g.kind, 'number', g.number, 'region', g.region)
                                      ORDER BY g.kind, g.number)
                        FROM aurora.membership_registrations g WHERE g.membership_id = m.id), '[]'::json)
              AS registrations
       FROM aurora.memberships m
       JOIN aurora.users u ON u.id = m.user_id
       LEFT JOIN aurora.membership_scopes s ON s.membership_id = m.id
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [membershipId]
  );
  if (!row) throw new NotFoundError('vínculo não encontrado nesta organização');
  return row;
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
  job_title: string | null;
  company_name: string | null;
  has_cpf: boolean;
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
            s.location_scope::text AS location_scope,
            m.job_title, m.company_name, (m.cpf IS NOT NULL) AS has_cpf
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

/* -------------------------------------------------------------------------- */

interface DadosNormalizados {
  cpf?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  registrations?: { kind: string; number: string; region: string | null }[];
}

function vazioViraNulo(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function normalizarDados(input: PersonDetailsInput): DadosNormalizados {
  const out: DadosNormalizados = {};
  const cpf = vazioViraNulo(input.cpf);
  if (cpf !== undefined) {
    if (cpf !== null && !isValidCpf(cpf)) throw new ValidationError('CPF inválido', { field: 'cpf' });
    out.cpf = cpf === null ? null : normalizeCpf(cpf);
  }
  const phone = vazioViraNulo(input.phone);
  if (phone !== undefined) {
    if (phone !== null && !/^[+()\d\s-]{8,32}$/.test(phone)) {
      throw new ValidationError('telefone inválido', { field: 'phone' });
    }
    out.phone = phone;
  }
  const empresa = vazioViraNulo(input.companyName);
  if (empresa !== undefined) {
    if (empresa !== null && empresa.length > 160) {
      throw new ValidationError('empresa: até 160 caracteres', { field: 'company_name' });
    }
    out.companyName = empresa;
  }
  const profissao = vazioViraNulo(input.jobTitle);
  if (profissao !== undefined) {
    if (profissao !== null && profissao.length > 80) {
      throw new ValidationError('profissão: até 80 caracteres', { field: 'job_title' });
    }
    out.jobTitle = profissao;
  }
  if (input.registrations !== undefined) {
    if (input.registrations.length > 10) {
      throw new ValidationError('no máximo 10 registros profissionais', { field: 'registrations' });
    }
    const vistos = new Set<string>();
    out.registrations = input.registrations.map((r) => {
      const kind = r.kind.trim().toUpperCase();
      const number = normalizeRegistrationNumber(r.number);
      const region = r.region ? r.region.trim().toUpperCase() : null;
      if (!isKnownRegistrationKind(kind)) {
        throw new ValidationError('tipo de registro profissional desconhecido', { field: 'registrations' });
      }
      if (!isValidRegistrationNumber(number)) {
        throw new ValidationError('número de registro profissional inválido', { field: 'registrations' });
      }
      if (region !== null && !isKnownUf(region)) {
        throw new ValidationError('UF do registro inválida', { field: 'registrations' });
      }
      const chave = `${kind}|${number}`;
      if (vistos.has(chave))
        throw new ValidationError('registro profissional repetido', { field: 'registrations' });
      vistos.add(chave);
      return { kind, number, region };
    });
  }
  return out;
}

async function gravarRegistros(
  session: TenantSession,
  membershipId: string,
  registros: readonly { kind: string; number: string; region: string | null }[]
): Promise<void> {
  for (const r of registros) {
    await session.query(
      `INSERT INTO aurora.membership_registrations
         (id, organization_id, membership_id, kind, number, region, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        session.context.organizationId,
        membershipId,
        r.kind,
        r.number,
        r.region,
        session.context.actorId,
      ]
    );
  }
}

function traduzirCpfDuplicado(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('memberships_org_cpf_uq')) {
    throw new ConflictError('já existe uma pessoa com este CPF nesta organização');
  }
  throw e;
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
