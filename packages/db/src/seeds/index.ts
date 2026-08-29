/**
 * Aurora — seeds determinísticos (EPIC-001).
 *
 * Determinístico de propósito: os mesmos identificadores em toda execução e em
 * todo ambiente. Isso permite escrever teste e documentação que referenciam um
 * registro específico, e torna trivial comparar dois ambientes.
 *
 * Duas organizações desde o início, sempre. É o que faz um vazamento
 * cross-tenant aparecer no desenvolvimento em vez de aparecer no cliente.
 *
 * Os UUIDs são v7 válidos, fixados à mão: prefixo de timestamp legível
 * (2026-01-01) + versão 7 + variante correta.
 */
import type { Database } from '../client';
import { unsafeCrossTenant, withTenant } from '../client';
import { buildContext } from '@aurora/domain';
import { provisionFactoryRoles, assignRole } from '../rbac';

/** Identificadores estáveis — referenciáveis em testes e documentação. */
export const SEED_IDS = {
  orgAcme: '0193c8a0-0000-7000-8000-000000000001',
  orgNorte: '0193c8a0-0000-7000-8000-000000000002',

  userAdmin: '0193c8a0-0001-7000-8000-000000000001',
  userGestor: '0193c8a0-0001-7000-8000-000000000002',
  userTecnico: '0193c8a0-0001-7000-8000-000000000003',
  userSolicitante: '0193c8a0-0001-7000-8000-000000000004',
  userNorte: '0193c8a0-0001-7000-8000-000000000005',
  /** Pertence às DUAS organizações: exercita o seletor de organização. */
  userConsultor: '0193c8a0-0001-7000-8000-000000000006',

  memAdmin: '0193c8a0-0002-7000-8000-000000000001',
  memGestor: '0193c8a0-0002-7000-8000-000000000002',
  memTecnico: '0193c8a0-0002-7000-8000-000000000003',
  memSolicitante: '0193c8a0-0002-7000-8000-000000000004',
  memNorte: '0193c8a0-0002-7000-8000-000000000005',
  memConsultorAcme: '0193c8a0-0002-7000-8000-000000000006',
  memConsultorNorte: '0193c8a0-0002-7000-8000-000000000007',
} as const;

export interface SeedResult {
  organizations: number;
  users: number;
  memberships: number;
}

/**
 * Aplica os seeds. Idempotente: pode rodar quantas vezes quiser.
 *
 * IMPORTANTE: recebe o banco **administrativo** (sem papel de aplicação), o
 * mesmo usado pelas migrations. Semear é operação de plataforma: cria mais de
 * uma organização e, por definição, não tem contexto de tenant. Rodando sob
 * `aurora_app`, a RLS negaria tudo — e é bom que negue.
 */
export async function seed(adminDb: Database): Promise<SeedResult> {
  if (adminDb.appRole) {
    throw new Error(
      'seed() exige o banco administrativo (appRole = null). ' +
        'Semear sob o papel de aplicação é negado pela RLS, corretamente.'
    );
  }
  return unsafeCrossTenant(adminDb, 'seed de desenvolvimento: cria múltiplas organizações', async (c) => {
    // -- organizações ---------------------------------------------------------
    await c.query(
      `INSERT INTO aurora.organizations (id, slug, name, tax_id, asset_label, plan, seat_limit)
       VALUES ($1, 'acme-clinica', 'Acme Engenharia Clínica', '12345678000190', 'Equipamento', 'pro', 25),
              ($2, 'norte-manutencao', 'Norte Manutenção Hospitalar', '98765432000110', 'Ativo', 'free', 5)
       ON CONFLICT (id) DO NOTHING`,
      [SEED_IDS.orgAcme, SEED_IDS.orgNorte]
    );

    // -- usuários -------------------------------------------------------------
    await c.query(
      `INSERT INTO aurora.users (id, email, name, auth_provider, auth_subject) VALUES
         ($1, 'ana.admin@acme.test',       'Ana Ribeiro',      'local', 'ana.admin@acme.test'),
         ($2, 'anderson@acme.test',        'Anderson Carvalho','local', 'anderson@acme.test'),
         ($3, 'rafael.tecnico@acme.test',  'Rafael Souza',     'local', 'rafael.tecnico@acme.test'),
         ($4, 'marilia.uti@hospital.test', 'Marília Nunes',    'local', 'marilia.uti@hospital.test'),
         ($5, 'bruno@norte.test',          'Bruno Lima',       'local', 'bruno@norte.test'),
         ($6, 'consultor@parceiro.test',   'Carla Consultora', 'local', 'consultor@parceiro.test')
       ON CONFLICT (id) DO NOTHING`,
      [
        SEED_IDS.userAdmin,
        SEED_IDS.userGestor,
        SEED_IDS.userTecnico,
        SEED_IDS.userSolicitante,
        SEED_IDS.userNorte,
        SEED_IDS.userConsultor,
      ]
    );

    // -- vínculos -------------------------------------------------------------
    const S = SEED_IDS;
    const memberships: Array<
      [string, string, string, string, string, string, number | null, number | null, boolean]
    > = [
      [S.memAdmin, S.orgAcme, S.userAdmin, 'staff', 'active', 'Sócia-diretora', null, null, true],
      [S.memGestor, S.orgAcme, S.userGestor, 'staff', 'active', 'Engenheiro clínico', 180.0, 8.0, false],
      [
        S.memTecnico,
        S.orgAcme,
        S.userTecnico,
        'staff',
        'active',
        'Técnico em equipamentos médicos',
        95.5,
        8.0,
        false,
      ],
      [
        S.memSolicitante,
        S.orgAcme,
        S.userSolicitante,
        'portal',
        'active',
        'Enfermeira coordenadora',
        null,
        null,
        false,
      ],
      [S.memNorte, S.orgNorte, S.userNorte, 'staff', 'active', 'Gestor de manutenção', 150.0, 8.0, true],
      // mesma pessoa em duas organizações: exercita o seletor de organização
      [S.memConsultorAcme, S.orgAcme, S.userConsultor, 'staff', 'active', 'Consultora', 220.0, 6.0, false],
      [S.memConsultorNorte, S.orgNorte, S.userConsultor, 'staff', 'active', 'Consultora', 220.0, 6.0, false],
    ];
    for (const m of memberships) {
      await c.query(
        `INSERT INTO aurora.memberships
           (id, organization_id, user_id, seat_type, status, job_title, hourly_cost, daily_hours, is_owner, joined_at)
         VALUES ($1, $2, $3, $4::aurora.seat_type, $5::aurora.membership_status, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO NOTHING`,
        m
      );
    }

    // -- escopos --------------------------------------------------------------
    // O técnico só enxerga o que está atribuído a ele ou à sua equipe.
    await c.query(
      `INSERT INTO aurora.membership_scopes (membership_id, organization_id, assignment_scope)
       VALUES ($1, $6, 'all'), ($2, $6, 'all'), ($3, $6, 'own'), ($4, $6, 'all'),
              ($5, $7, 'all')
       ON CONFLICT (membership_id) DO NOTHING`,
      [
        SEED_IDS.memAdmin,
        SEED_IDS.memGestor,
        SEED_IDS.memTecnico,
        SEED_IDS.memSolicitante,
        SEED_IDS.memNorte,
        SEED_IDS.orgAcme,
        SEED_IDS.orgNorte,
      ]
    );

    const [orgs] = await c.query<{ c: number }>('SELECT count(*)::int c FROM aurora.organizations');
    const [users] = await c.query<{ c: number }>('SELECT count(*)::int c FROM aurora.users');
    const [mems] = await c.query<{ c: number }>('SELECT count(*)::int c FROM aurora.memberships');
    return { organizations: orgs?.c ?? 0, users: users?.c ?? 0, memberships: mems?.c ?? 0 };
  });
}

/** Atribuição papel -> vínculo usada pelos seeds. */
const SEED_ROLE_ASSIGNMENTS: ReadonlyArray<
  [orgKey: 'orgAcme' | 'orgNorte', membershipKey: keyof typeof SEED_IDS, roleKey: string]
> = [
  ['orgAcme', 'memAdmin', 'owner'],
  ['orgAcme', 'memGestor', 'maintenance_manager'],
  ['orgAcme', 'memTecnico', 'technician'],
  ['orgAcme', 'memSolicitante', 'requester'],
  ['orgAcme', 'memConsultorAcme', 'coordinator'],
  ['orgNorte', 'memNorte', 'owner'],
  ['orgNorte', 'memConsultorNorte', 'technician'],
];

/**
 * Provisiona papéis de fábrica nas duas organizações e atribui aos vínculos.
 * Roda depois de `seed`, já com contexto de tenant — papéis são dado de
 * negócio da organização, não de plataforma.
 */
export async function seedRoles(appDb: Database): Promise<{ rolesPerOrg: number }> {
  let rolesPerOrg = 0;
  for (const orgKey of ['orgAcme', 'orgNorte'] as const) {
    const organizationId = SEED_IDS[orgKey];
    const ctx = buildContext({
      organizationId,
      actorKind: 'system',
      requestId: `seed-roles-${orgKey}`,
      source: 'import',
    });
    await withTenant(appDb, ctx, async (s) => {
      const roleIds = await provisionFactoryRoles(s);
      rolesPerOrg = roleIds.size;
      for (const [org, memKey, roleKey] of SEED_ROLE_ASSIGNMENTS) {
        if (org !== orgKey) continue;
        const roleId = roleIds.get(roleKey);
        if (roleId) await assignRole(s, SEED_IDS[memKey], roleId);
      }
    });
  }
  return { rolesPerOrg };
}
