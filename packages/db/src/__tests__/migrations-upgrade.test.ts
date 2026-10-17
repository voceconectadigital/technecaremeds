/**
 * Aurora — migrations aplicadas SOBRE um banco que já tem dado.
 *
 * `migrations.test.ts` prova que o histórico sobe do zero. Isso não prova que
 * ele sobe sobre a produção: uma coluna `NOT NULL` sem `DEFAULT`, um `CHECK`
 * novo que linhas antigas violam ou um índice único que dado legado repete
 * passam no banco vazio e quebram exatamente no deploy.
 *
 * Aqui o banco nasce na 0059 (o estado anterior à rodada de 16/10/2026), recebe
 * dado com o formato daquela época — inclusive valores que as migrations novas
 * precisam traduzir — e só então recebe 0060 em diante.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteAdapter } from '../adapters';
import { migrate, loadMigrations, MIGRATIONS_DIR } from '../migrator';
import { migrateAndSyncCatalogs } from '../schema-sync';
import { withTenant } from '../client';
import { provisionOrganizationBaseline } from '../provisioning';
import { buildContext, newId, PERMISSION_KEYS } from '@aurora/domain';
import { seed, SEED_IDS } from '../seeds';

const ULTIMA_ANTIGA = '0059_situacao_em_analise.sql';

const pastaAntiga = mkdtempSync(join(tmpdir(), 'aurora-migr-0059-'));
const todas = loadMigrations().map((m) => m.name);
const antigas = todas.filter((n) => n <= ULTIMA_ANTIGA);
for (const n of antigas) copyFileSync(join(MIGRATIONS_DIR, n), join(pastaAntiga, n));

afterAll(() => rmSync(pastaAntiga, { recursive: true, force: true }));

const ORG = SEED_IDS.orgAcme;
const OUTRA = SEED_IDS.orgNorte;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('migrations 0060+ sobre banco legado (0059 com dado)', () => {
  it('aplica a rodada nova sem erro e traduz o dado antigo', async () => {
    expect(antigas.at(-1)).toBe(ULTIMA_ANTIGA);
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);

    const r1 = await migrate(db, pastaAntiga);
    expect(r1.applied).toEqual(antigas);
    await seed(db);

    // -- dado no formato da 0059 -------------------------------------------
    await pg.exec(`
      INSERT INTO aurora.customers (id, organization_id, name, segment) VALUES
        ('${id(1)}', '${ORG}', 'Hospital Legado', 'Hospital'),
        ('${id(2)}', '${ORG}', 'Clínica Legada', 'clínica'),
        ('${id(3)}', '${ORG}', 'Segmento livre', 'Rede de farmácias'),
        ('${id(4)}', '${OUTRA}', 'Sem segmento', NULL);

      -- uma família já existia com o nome de fábrica; outra é subcategoria
      INSERT INTO aurora.asset_categories (id, organization_id, name, position) VALUES
        ('${id(10)}', '${ORG}', 'Suporte à vida', 1);
      INSERT INTO aurora.asset_categories (id, organization_id, name, parent_id) VALUES
        ('${id(11)}', '${ORG}', 'Ventiladores', '${id(10)}');

      INSERT INTO aurora.work_order_statuses (id, organization_id, key, label, category, color, position, is_system) VALUES
        ('${id(20)}', '${ORG}', 'draft', 'Rascunho', 'open', '#999999', 0, true),
        ('${id(21)}', '${ORG}', 'open', 'Aberta', 'open', '#1a73e8', 1, true),
        ('${id(22)}', '${ORG}', 'waiting', 'Em espera', 'waiting', '#f9ab00', 2, true),
        ('${id(23)}', '${ORG}', 'done', 'Concluída', 'done', '#188038', 3, true);

      INSERT INTO aurora.automation_rules (id, organization_id, name, state, trigger_kind, trigger_event, updated_at)
      VALUES ('${id(30)}', '${ORG}', 'Regra antiga ativa', 'active', 'event', 'work_order.created', '2026-09-01T12:00:00Z'),
             ('${id(31)}', '${ORG}', 'Regra antiga rascunho', 'draft', 'event', 'work_order.created', '2026-09-01T12:00:00Z');

      INSERT INTO aurora.warehouses (id, organization_id, name) VALUES ('${id(40)}', '${ORG}', 'Central');
      INSERT INTO aurora.inventory_items (id, organization_id, sku, name) VALUES ('${id(41)}', '${ORG}', 'FUS-01', 'Fusível 5A');
      INSERT INTO aurora.stock_balances (organization_id, item_id, warehouse_id, on_hand, min_qty)
      VALUES ('${ORG}', '${id(41)}', '${id(40)}', 12, 5);
    `);

    // -- a rodada nova ------------------------------------------------------
    // Como `npm run db:migrate` faz: definições de catálogo antes, catálogos
    // do código depois. Este banco legado nunca teve as definições semeadas —
    // é o pior caso, e a 0064 semeia tipos de OS que dependem delas.
    const r2 = await migrateAndSyncCatalogs(db);
    expect(r2.applied).toEqual(todas.filter((n) => n > ULTIMA_ANTIGA));

    const clientes = await pg.query<{ name: string; kind: string; subtype: string | null }>(
      `SELECT name, kind, subtype FROM aurora.customers WHERE id IN ($1,$2,$3,$4) ORDER BY name`,
      [id(1), id(2), id(3), id(4)]
    );
    expect(clientes.rows).toEqual([
      { name: 'Clínica Legada', kind: 'eas', subtype: 'clinica' },
      { name: 'Hospital Legado', kind: 'eas', subtype: 'hospital' },
      { name: 'Segmento livre', kind: 'eas', subtype: null },
      { name: 'Sem segmento', kind: 'eas', subtype: null },
    ]);

    // a categoria existente vira a família (não nasce uma duplicata)
    const familias = await pg.query<{ id: string; family_key: string }>(
      `SELECT id, family_key FROM aurora.asset_categories
        WHERE organization_id = $1 AND family_key IS NOT NULL ORDER BY family_key`,
      [ORG]
    );
    expect(familias.rows.map((f) => f.family_key)).toEqual([
      'diagnosis',
      'life_support',
      'support',
      'therapy',
      'treatment',
    ]);
    expect(familias.rows.find((f) => f.family_key === 'life_support')?.id).toBe(id(10));
    const [sub] = (
      await pg.query<{ family_key: string | null; parent_id: string }>(
        `SELECT family_key, parent_id FROM aurora.asset_categories WHERE id = $1`,
        [id(11)]
      )
    ).rows;
    expect(sub).toEqual({ family_key: null, parent_id: id(10) });

    // a situação "Negada" chega só a quem já tinha máquina de estados
    const negadas = await pg.query<{ organization_id: string }>(
      `SELECT organization_id FROM aurora.work_order_statuses WHERE key = 'denied'`
    );
    expect(negadas.rows).toEqual([{ organization_id: ORG }]);
    const transicoes = await pg.query<{ de: string }>(
      `SELECT f.key AS de FROM aurora.work_order_status_transitions x
         JOIN aurora.work_order_statuses f ON f.id = x.from_status_id
         JOIN aurora.work_order_statuses t ON t.id = x.to_status_id
        WHERE t.key = 'denied' ORDER BY f.key`
    );
    expect(transicoes.rows.map((t) => t.de)).toEqual(['open', 'waiting']);
    const [rascunho] = (
      await pg.query<{ visible_on_board: boolean }>(
        `SELECT visible_on_board FROM aurora.work_order_statuses WHERE id = $1`,
        [id(20)]
      )
    ).rows;
    expect(rascunho?.visible_on_board).toBe(false);

    // regra ativa ganha a data de ativação; rascunho não
    const regras = await pg.query<{ name: string; activated_at: Date | null }>(
      `SELECT name, activated_at FROM aurora.automation_rules WHERE id IN ($1,$2) ORDER BY name`,
      [id(30), id(31)]
    );
    expect(regras.rows[0]?.activated_at).toBeInstanceOf(Date);
    expect(regras.rows[1]?.activated_at).toBeNull();

    // estoque antigo segue íntegro, sem máximo e fora da Store
    const [saldo] = (
      await pg.query<{ on_hand: string; max_qty: string | null; store_published: boolean }>(
        `SELECT b.on_hand, b.max_qty, i.store_published
           FROM aurora.stock_balances b JOIN aurora.inventory_items i ON i.id = b.item_id
          WHERE b.item_id = $1`,
        [id(41)]
      )
    ).rows;
    expect(saldo).toEqual({ on_hand: '12.0000', max_qty: null, store_published: false });

    // e rodar de novo não reaplica nada
    const r3 = await migrate(db);
    expect(r3.applied).toEqual([]);
    await pg.close();
  });
});

describe('banco novo preparado só com db:migrate', () => {
  it('provisiona a primeira organização (tipos de OS exigem a definição de catálogo)', async () => {
    const pg = new PGlite();
    const admin = pgliteAdapter(pg, null);
    const r = await migrateAndSyncCatalogs(admin);
    expect(r.applied.length).toBe(todas.length);
    expect(r.catalogs.inserted).toBeGreaterThan(0);

    const org = newId();
    const user = newId();
    const mem = newId();
    await pg.query(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, 'primeira', 'Primeira')`, [
      org,
    ]);
    await pg.query(`INSERT INTO aurora.users (id, email, name) VALUES ($1, 'titular@primeira.test', 'T')`, [
      user,
    ]);
    await pg.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, seat_type, status, is_owner)
         VALUES ($1, $2, $3, 'staff', 'active', true)`,
        [mem, org, user]
      );
      await tx.query(
        `INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`,
        [mem, org]
      );
    });

    const db = pgliteAdapter(pg, 'aurora_app');
    const ctx = buildContext({
      organizationId: org,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'teste-provisionamento',
      permissions: PERMISSION_KEYS,
    });
    const base = await withTenant(db, ctx, (s) => provisionOrganizationBaseline(s));
    expect(base.roles.size).toBeGreaterThan(0);
    const [tipos] = (
      await pg.query<{ c: number }>(
        `SELECT count(*)::int c FROM aurora.catalog_items WHERE organization_id = $1 AND catalog_key = 'work_order_type'`,
        [org]
      )
    ).rows;
    expect(tipos?.c).toBe(7);
    await pg.close();
  });
});

describe('papel sem BYPASSRLS', () => {
  it('é recusado antes da primeira migration pendente (sob a RLS ela não faria nada)', async () => {
    const pg = new PGlite();
    const admin = pgliteAdapter(pg, null);
    await migrate(admin, pastaAntiga);
    await seed(admin);
    // Um papel dono, sem BYPASSRLS — o caso de quem roda migration como
    // `aurora_owner` em vez de superusuário.
    await pg.exec(`CREATE ROLE migrador_sem_bypass NOBYPASSRLS IN ROLE aurora_owner;
                   GRANT USAGE, CREATE ON SCHEMA aurora TO migrador_sem_bypass;
                   GRANT ALL ON ALL TABLES IN SCHEMA aurora TO migrador_sem_bypass;`);
    await pg.exec('SET ROLE migrador_sem_bypass');
    await expect(migrate(admin)).rejects.toThrow(/nem BYPASSRLS/);
    await pg.exec('RESET ROLE');
    // e nada da rodada nova ficou registrado como aplicado sem efeito
    const { rows } = await pg.query<{ c: number }>(
      `SELECT count(*)::int c FROM aurora.schema_migrations WHERE name > $1 AND name <= '0070'`,
      [ULTIMA_ANTIGA]
    );
    expect(rows[0]?.c).toBe(0);
    await pg.close();
  });
});

describe('catálogos de sistema com conflito no banco legado (PF-20)', () => {
  it('tipo de OS com chave arquivada e família com nome ocupado nascem mesmo assim', async () => {
    const { syncCatalogDefinitions } = await import('../catalogs');
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db, pastaAntiga);
    await seed(db);
    await syncCatalogDefinitions(db);
    await pg.exec(`
      -- a chave de fábrica "preventiva" pertence a um item APOSENTADO
      INSERT INTO aurora.catalog_items (id, organization_id, catalog_key, key, label, archived_at)
      VALUES ('${id(50)}', '${ORG}', 'work_order_type', 'preventiva', 'Preventiva antiga', now());
      -- "Terapia" já é o nome de uma SUBcategoria viva
      INSERT INTO aurora.asset_categories (id, organization_id, name) VALUES ('${id(51)}', '${ORG}', 'Equipamentos');
      INSERT INTO aurora.asset_categories (id, organization_id, name, parent_id)
      VALUES ('${id(52)}', '${ORG}', 'Terapia', '${id(51)}');
    `);

    await migrateAndSyncCatalogs(db);

    const tipos = await pg.query<{ system_key: string; key: string }>(
      `SELECT system_key, key FROM aurora.catalog_items
        WHERE organization_id = $1 AND catalog_key = 'work_order_type' AND archived_at IS NULL
          AND system_key IS NOT NULL ORDER BY system_key`,
      [ORG]
    );
    expect(tipos.rows).toHaveLength(7);
    expect(tipos.rows.find((x) => x.system_key === 'preventive')?.key).toBe('preventiva_2');

    const familias = await pg.query<{ family_key: string; name: string }>(
      `SELECT family_key, name FROM aurora.asset_categories
        WHERE organization_id = $1 AND family_key IS NOT NULL AND archived_at IS NULL ORDER BY family_key`,
      [ORG]
    );
    expect(familias.rows).toHaveLength(5);
    expect(familias.rows.find((x) => x.family_key === 'therapy')?.name).toBe('Terapia (família)');
    // a subcategoria continua como estava
    const [sub] = (
      await pg.query<{ family_key: string | null }>(
        `SELECT family_key FROM aurora.asset_categories WHERE id = $1`,
        [id(52)]
      )
    ).rows;
    expect(sub?.family_key).toBeNull();
    await pg.close();
  });
});

describe('provisionamento em runtime com os mesmos conflitos (PF-20)', () => {
  it('não engole o tipo de OS nem falha na família', async () => {
    const pg = new PGlite();
    const admin = pgliteAdapter(pg, null);
    await migrateAndSyncCatalogs(admin);
    const org = newId();
    const user = newId();
    const mem = newId();
    await pg.query(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, 'conflito', 'Conflito')`, [
      org,
    ]);
    await pg.query(`INSERT INTO aurora.users (id, email, name) VALUES ($1, 'c@conflito.test', 'C')`, [user]);
    await pg.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, seat_type, status, is_owner)
         VALUES ($1, $2, $3, 'staff', 'active', true)`,
        [mem, org, user]
      );
      await tx.query(
        `INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`,
        [mem, org]
      );
    });
    const raiz = newId();
    await pg.exec(`
      INSERT INTO aurora.catalog_items (id, organization_id, catalog_key, key, label, archived_at)
      VALUES ('${newId()}', '${org}', 'work_order_type', 'preventiva', 'Preventiva antiga', now());
      INSERT INTO aurora.asset_categories (id, organization_id, name) VALUES ('${raiz}', '${org}', 'Equipamentos');
      INSERT INTO aurora.asset_categories (id, organization_id, name, parent_id)
      VALUES ('${newId()}', '${org}', 'Terapia', '${raiz}');
    `);
    const db = pgliteAdapter(pg, 'aurora_app');
    const ctx = buildContext({
      organizationId: org,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'conflito',
      permissions: PERMISSION_KEYS,
    });
    const base = await withTenant(db, ctx, (s) => provisionOrganizationBaseline(s));
    expect(base.families.size).toBe(5);
    const { rows } = await pg.query<{ c: number }>(
      `SELECT count(*)::int c FROM aurora.catalog_items
        WHERE organization_id = $1 AND catalog_key = 'work_order_type' AND system_key IS NOT NULL AND archived_at IS NULL`,
      [org]
    );
    expect(rows[0]?.c).toBe(7);
    await pg.close();
  });
});
