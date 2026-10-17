/**
 * Aurora — operações do diretório (SPEC v0.2 §05, §32 · EPIC-003).
 *
 * Regra que organiza este arquivo: a aplicação escreve intenção, o banco mantém
 * a estrutura. Criar um local é dizer quem é o pai; mover é dizer quem passa a
 * ser o pai. `path` e `depth` nunca aparecem em um INSERT ou UPDATE daqui —
 * quem os calcula é o gatilho da migration 0009, e é por isso que a árvore
 * continua íntegra mesmo por um caminho de escrita que ainda não existe.
 */
import { newId, ConflictError, NotFoundError, subtreePrefix } from '@aurora/domain';
import type { TenantSession } from './client';

/* -------------------------------------------------------------------------- */
/* clientes                                                                    */
/* -------------------------------------------------------------------------- */

export interface CustomerInput {
  name: string;
  tradeName?: string | null;
  code?: string | null;
  taxId?: string | null;
  isInternal?: boolean;
  segment?: string | null;
  /** EAS ou empresa corporativa (0062). Padrão: EAS. */
  kind?: 'eas' | 'corporate';
  subtype?: string | null;
}

export async function createCustomer(session: TenantSession, input: CustomerInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.customers
       (id, organization_id, name, trade_name, code, tax_id, is_internal, segment, created_by, kind, subtype)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.tradeName ?? null,
      input.code ?? null,
      input.taxId ?? null,
      input.isInternal ?? false,
      input.segment ?? null,
      session.context.actorId,
      input.kind ?? 'eas',
      input.subtype ?? null,
    ]
  );
  return id;
}

/**
 * Edita o cadastro de um cliente. Só os campos presentes mudam; `null` limpa.
 * Devolve falso quando o cliente não existe (ou é de outra organização).
 */
export async function updateCustomer(
  session: TenantSession,
  id: string,
  patch: Partial<Pick<CustomerInput, 'name' | 'tradeName' | 'code' | 'taxId' | 'kind' | 'subtype'>>
): Promise<boolean> {
  const campos: [string, unknown][] = [];
  if (patch.name !== undefined) campos.push(['name', patch.name]);
  if (patch.tradeName !== undefined) campos.push(['trade_name', patch.tradeName]);
  if (patch.code !== undefined) campos.push(['code', patch.code]);
  if (patch.taxId !== undefined) campos.push(['tax_id', patch.taxId]);
  if (patch.kind !== undefined) campos.push(['kind', patch.kind]);
  if (patch.subtype !== undefined) campos.push(['subtype', patch.subtype]);
  if (campos.length === 0) {
    const [r] = await session.query(`SELECT 1 FROM aurora.customers WHERE id = $1 AND deleted_at IS NULL`, [
      id,
    ]);
    return Boolean(r);
  }
  // Nomes de coluna vêm da lista fechada acima, nunca do cliente.
  const sets = campos.map(([c], i) => `${c} = $${i + 2}`).join(', ');
  const linhas = await session.query(
    `UPDATE aurora.customers SET ${sets}, updated_by = $${campos.length + 2}
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, ...campos.map(([, v]) => v), session.context.actorId]
  );
  return linhas.length > 0;
}

/* -------------------------------------------------------------------------- */
/* tipos de local                                                              */
/* -------------------------------------------------------------------------- */

export interface LocationTypeInput {
  key: string;
  name: string;
  canBeRoot?: boolean;
  allowedParentTypeIds?: readonly string[];
  allowsAssets?: boolean;
  position?: number;
}

export async function createLocationType(session: TenantSession, input: LocationTypeInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.location_types
       (id, organization_id, key, name, can_be_root, allowed_parent_type_ids, allows_assets, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      input.key,
      input.name,
      input.canBeRoot ?? false,
      input.allowedParentTypeIds ?? [],
      input.allowsAssets ?? true,
      input.position ?? 0,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Escada inicial de tipos de local.
 *
 * Não é regra do produto: é ponto de partida, e a organização edita. A escada
 * reproduz a estrutura que a auditoria observou sendo espremida dentro de um
 * único campo de texto na referência ("HJXXIII - AMBULATÓRIO - SALA 05"), agora
 * como níveis de verdade. `allows_assets` só nos dois últimos porque ativo em
 * "prédio" é o começo de um inventário que ninguém consegue localizar depois.
 */
export async function provisionStarterLocationTypes(session: TenantSession): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const ladder: Array<{ key: string; name: string; allowsAssets: boolean }> = [
    { key: 'unidade', name: 'Unidade', allowsAssets: false },
    { key: 'predio', name: 'Prédio', allowsAssets: false },
    { key: 'andar', name: 'Andar', allowsAssets: false },
    { key: 'setor', name: 'Setor', allowsAssets: true },
    { key: 'sala', name: 'Sala', allowsAssets: true },
  ];

  for (const [index, level] of ladder.entries()) {
    const existing = await session.query<{ id: string }>(
      `SELECT id FROM aurora.location_types WHERE key = $1 AND deleted_at IS NULL`,
      [level.key]
    );
    let id = existing[0]?.id;
    if (!id) {
      // Cada nível aceita o anterior como pai. Um setor pode ficar direto sob a
      // unidade em clínica pequena, então os níveis intermediários também são
      // aceitos — a escada é uma sugestão de ordem, não uma obrigação de passar
      // por todos os degraus.
      const allowed = [...ids.values()];
      id = await createLocationType(session, {
        key: level.key,
        name: level.name,
        canBeRoot: index === 0,
        allowedParentTypeIds: allowed,
        allowsAssets: level.allowsAssets,
        position: index,
      });
    }
    ids.set(level.key, id);
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* locais                                                                      */
/* -------------------------------------------------------------------------- */

export interface LocationInput {
  customerId: string;
  parentId?: string | null;
  locationTypeId: string;
  name: string;
  code?: string | null;
  isMobile?: boolean;
}

export interface LocationRow {
  id: string;
  parent_id: string | null;
  customer_id: string;
  location_type_id: string;
  name: string;
  path: string;
  depth: number;
  status: string;
}

/** Cria um local. `path` e `depth` saem do gatilho, não daqui. */
export async function createLocation(session: TenantSession, input: LocationInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.locations
       (id, organization_id, customer_id, parent_id, location_type_id, name, code, is_mobile, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      input.customerId,
      input.parentId ?? null,
      input.locationTypeId,
      input.name,
      input.code ?? null,
      input.isMobile ?? false,
      session.context.actorId,
    ]
  );
  return id;
}

/**
 * Move uma subárvore inteira.
 *
 * É um UPDATE de uma coluna. O recálculo de caminho e profundidade de todos os
 * descendentes, a recusa de ciclo, o limite de oito níveis e a regra de
 * aninhamento acontecem dentro da mesma transação, no banco. Devolve quantos
 * locais mudaram de lugar, incluindo o próprio.
 */
export async function moveLocation(
  session: TenantSession,
  locationId: string,
  newParentId: string | null
): Promise<number> {
  const [before] = await session.query<{ path: string }>(
    `SELECT path FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
    [locationId]
  );
  if (!before) throw new NotFoundError('Local', locationId);

  const affected = await session.query<{ id: string }>(
    `SELECT id FROM aurora.locations WHERE path LIKE $1 AND deleted_at IS NULL`,
    [subtreePrefix(before.path)]
  );

  await session.query(`UPDATE aurora.locations SET parent_id = $2, updated_by = $3 WHERE id = $1`, [
    locationId,
    newParentId,
    session.context.actorId,
  ]);
  return affected.length;
}

/** Subárvore de um local, incluindo ele mesmo, em ordem de caminho. */
export async function subtree(session: TenantSession, locationId: string): Promise<LocationRow[]> {
  const [root] = await session.query<{ path: string }>(
    `SELECT path FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
    [locationId]
  );
  if (!root) throw new NotFoundError('Local', locationId);
  return session.query<LocationRow>(
    `SELECT id, parent_id, customer_id, location_type_id, name, path, depth, status::text
       FROM aurora.locations
      WHERE path LIKE $1 AND deleted_at IS NULL
      ORDER BY path`,
    [subtreePrefix(root.path)]
  );
}

/** Ancestrais de um local, da raiz até o pai. Serve à trilha de navegação. */
export async function ancestors(session: TenantSession, locationId: string): Promise<LocationRow[]> {
  return session.query<LocationRow>(
    `SELECT a.id, a.parent_id, a.customer_id, a.location_type_id, a.name, a.path, a.depth, a.status::text
       FROM aurora.locations l
       JOIN aurora.locations a ON l.path LIKE a.path || '%' AND a.id <> l.id
      WHERE l.id = $1 AND a.deleted_at IS NULL
      ORDER BY a.depth`,
    [locationId]
  );
}

/**
 * Arquiva um local.
 *
 * Recusa enquanto houver descendente ativo, e a recusa nomeia as pendências —
 * o critério de aceite do EPIC-003. Arquivar em cascata seria mais cômodo e
 * bem pior: some com estrutura que alguém ainda usa, sem que ninguém veja.
 *
 * A verificação de ativos alocados no local entra no EPIC-005, junto com a
 * tabela `assets`; até lá esta função protege a árvore, não o inventário.
 */
export async function archiveLocation(session: TenantSession, locationId: string): Promise<void> {
  const [target] = await session.query<{ path: string; name: string }>(
    `SELECT path, name FROM aurora.locations WHERE id = $1 AND deleted_at IS NULL`,
    [locationId]
  );
  if (!target) throw new NotFoundError('Local', locationId);

  const pending = await session.query<{ name: string }>(
    `SELECT name FROM aurora.locations
      WHERE path LIKE $1 AND id <> $2 AND deleted_at IS NULL AND status <> 'archived'
      ORDER BY path LIMIT 20`,
    [subtreePrefix(target.path), locationId]
  );
  if (pending.length > 0) {
    throw new ConflictError(
      `"${target.name}" tem ${pending.length} local(is) ativo(s) abaixo dele: ` +
        `${pending.map((p) => p.name).join(', ')}. Arquive ou transfira antes.`
    );
  }

  await session.query(`UPDATE aurora.locations SET status = 'archived', updated_by = $2 WHERE id = $1`, [
    locationId,
    session.context.actorId,
  ]);
}

/** Ids dos locais que um vínculo enxerga, já com escopo de cliente aplicado. */
export async function accessibleLocationIds(session: TenantSession, membershipId: string): Promise<string[]> {
  const rows = await session.query<{ location_id: string }>(
    `SELECT location_id FROM aurora.accessible_location_ids($1)`,
    [membershipId]
  );
  return rows.map((r) => r.location_id);
}

/* -------------------------------------------------------------------------- */
/* fornecedores, equipes e disponibilidade                                     */
/* -------------------------------------------------------------------------- */

export interface SupplierInput {
  name: string;
  taxId?: string | null;
  categories?: readonly string[];
  isAuthorizedService?: boolean;
  email?: string | null;
  phone?: string | null;
}

export async function createSupplier(session: TenantSession, input: SupplierInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.suppliers
       (id, organization_id, name, tax_id, categories, is_authorized_service, email, phone, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.taxId ?? null,
      input.categories ?? [],
      input.isAuthorizedService ?? false,
      input.email ?? null,
      input.phone ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

export interface TeamInput {
  name: string;
  code?: string | null;
  calendarId?: string | null;
  leadMembershipId?: string | null;
}

export async function createTeam(session: TenantSession, input: TeamInput): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.teams (id, organization_id, name, code, calendar_id, lead_membership_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      session.context.organizationId,
      input.name,
      input.code ?? null,
      input.calendarId ?? null,
      input.leadMembershipId ?? null,
      session.context.actorId,
    ]
  );
  return id;
}

/** Idempotente: repetir a inclusão atualiza a função e as habilidades. */
export async function addTeamMember(
  session: TenantSession,
  teamId: string,
  membershipId: string,
  opts: { roleInTeam?: string; skills?: readonly string[] } = {}
): Promise<void> {
  await session.query(
    `INSERT INTO aurora.team_members (organization_id, team_id, membership_id, role_in_team, skills, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (team_id, membership_id) DO UPDATE
        SET role_in_team = EXCLUDED.role_in_team, skills = EXCLUDED.skills`,
    [
      session.context.organizationId,
      teamId,
      membershipId,
      opts.roleInTeam ?? 'member',
      opts.skills ?? [],
      session.context.actorId,
    ]
  );
}

/**
 * Está indisponível neste instante?
 *
 * Pergunta que a atribuição de OS precisa fazer antes de designar alguém — e
 * que o sistema de referência não fazia, segundo a auditoria: férias não
 * apareciam em lugar nenhum na hora de atribuir.
 */
export async function isUnavailableAt(
  session: TenantSession,
  membershipId: string,
  instant: Date
): Promise<boolean> {
  const rows = await session.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM aurora.availability_blocks
      WHERE membership_id = $1 AND starts_at <= $2 AND ends_at > $2`,
    [membershipId, instant.toISOString()]
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function blockAvailability(
  session: TenantSession,
  membershipId: string,
  kind: 'vacation' | 'leave' | 'training' | 'other',
  startsAt: Date,
  endsAt: Date,
  note?: string
): Promise<string> {
  const id = newId();
  await session.query(
    `INSERT INTO aurora.availability_blocks
       (id, organization_id, membership_id, kind, starts_at, ends_at, note, created_by)
     VALUES ($1, $2, $3, $4::aurora.availability_block_kind, $5, $6, $7, $8)`,
    [
      id,
      session.context.organizationId,
      membershipId,
      kind,
      startsAt.toISOString(),
      endsAt.toISOString(),
      note ?? null,
      session.context.actorId,
    ]
  );
  return id;
}
