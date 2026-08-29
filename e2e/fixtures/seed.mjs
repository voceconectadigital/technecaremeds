#!/usr/bin/env node
/**
 * Aurora — massa determinística para os testes de ponta a ponta.
 *
 * DETERMINÍSTICA, e não aleatória: um teste que falha precisa falhar de novo.
 * Os identificadores são fixos e legíveis, de modo que um erro no console
 * aponte para algo que dá para procurar no banco.
 *
 * DUAS ORGANIZAÇÕES, SEMPRE. É o que faz um vazamento cross-tenant aparecer no
 * teste em vez de aparecer no cliente — e é por isso que existe o E2E-WEB-003.
 *
 * Uso: DATABASE_URL=... node e2e/fixtures/seed.mjs [--reset]
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TSX_TSCONFIG_PATH ??= join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tsconfig.base.json'
);
require('tsx/cjs');

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

/**
 * Identificadores fixos.
 *
 * UUID v7 válidos, escritos à mão: prefixo de tempo legível (2026-08-30),
 * versão 7 e variante corretas. Um teste que quebra cita um destes, e dá para
 * procurar direto no banco.
 */
export const E2E = {
  orgA: '0193d900-0000-7000-8000-00000000000a',
  orgB: '0193d900-0000-7000-8000-00000000000b',

  userCoordA: '0193d900-0001-7000-8000-00000000000a',
  userTecA: '0193d900-0001-7000-8000-00000000001a',
  userCoordB: '0193d900-0001-7000-8000-00000000000b',
  // Uma pessoa, dois vínculos: é ela que torna o seletor de organização
  // testável de verdade, e é o caso que a §05 existe para proteger.
  userConsultora: '0193d900-0001-7000-8000-00000000000c',
  // A auditora existe para provar o NEGATIVO: ela enxerga a ordem de serviço
  // e NÃO enxerga nota interna nem custo. Sem alguém assim na massa, todo
  // teste de vazamento é feito com quem pode ver tudo — e prova metade.
  userAuditora: '0193d900-0001-7000-8000-00000000000d',

  memCoordA: '0193d900-0002-7000-8000-00000000000a',
  memTecA: '0193d900-0002-7000-8000-00000000001a',
  memCoordB: '0193d900-0002-7000-8000-00000000000b',
  memConsultoraA: '0193d900-0002-7000-8000-00000000001c',
  memConsultoraB: '0193d900-0002-7000-8000-00000000002c',
  memAuditoraA: '0193d900-0002-7000-8000-00000000001d',

  clienteA: '0193d900-0003-7000-8000-00000000000a',
  clienteB: '0193d900-0003-7000-8000-00000000000b',

  emailCoordA: 'coord.a@e2e.test',
  emailTecA: 'tec.a@e2e.test',
  emailCoordB: 'coord.b@e2e.test',
  emailConsultora: 'consultora@e2e.test',
  emailAuditora: 'auditora@e2e.test',
};

const pool = new Pool({ connectionString: url, max: 4 });

async function q(sql, params) {
  return (await pool.query(sql, params)).rows;
}

async function main() {
  if (process.argv.includes('--reset')) {
    // A cascata leva o resto: se apagar a organização deixasse órfão em alguma
    // tabela, este comando falharia — e falhar aqui é melhor do que descobrir
    // o órfão num cliente.
    await q(`DELETE FROM aurora.organizations WHERE slug LIKE 'e2e-%'`);
    await q(`DELETE FROM aurora.users WHERE email LIKE '%@e2e.test'`);
  }

  const [{ existe }] = await q(
    `SELECT count(*)::int AS existe FROM aurora.organizations WHERE slug LIKE 'e2e-%'`
  );
  if (existe > 0) {
    console.log('massa e2e já existe');
    return;
  }

  /* ------------------------------------------------------- organizações */

  for (const [id, slug, nome] of [
    [E2E.orgA, 'e2e-alfa', 'Clínica Alfa'],
    [E2E.orgB, 'e2e-beta', 'Hospital Beta'],
  ]) {
    await q(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [id, slug, nome]);
  }

  /* ------------------------------------------------------------ pessoas */

  for (const [id, email, nome] of [
    [E2E.userCoordA, E2E.emailCoordA, 'Carla Coordenadora'],
    [E2E.userTecA, E2E.emailTecA, 'Rafael Técnico'],
    [E2E.userCoordB, E2E.emailCoordB, 'Bruno do Beta'],
    [E2E.userConsultora, E2E.emailConsultora, 'Carla Consultora'],
    [E2E.userAuditora, E2E.emailAuditora, 'Denise Auditora'],
  ]) {
    await q(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [id, email, nome]);
  }

  /* ------------------------------------------------------------ vínculos */

  for (const [mem, org, user, dono] of [
    [E2E.memCoordA, E2E.orgA, E2E.userCoordA, true],
    [E2E.memTecA, E2E.orgA, E2E.userTecA, false],
    [E2E.memCoordB, E2E.orgB, E2E.userCoordB, true],
    [E2E.memConsultoraA, E2E.orgA, E2E.userConsultora, false],
    [E2E.memConsultoraB, E2E.orgB, E2E.userConsultora, false],
    [E2E.memAuditoraA, E2E.orgA, E2E.userAuditora, false],
  ]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', 'staff', $4)`,
        [mem, org, user, dono]
      );
      // Vínculo e escopo na MESMA transação: o gatilho da 0039 recusa o
      // vínculo cego no COMMIT.
      await c.query(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
        mem,
        org,
      ]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /* --------------------------------- papéis, catálogos, estados, clientes */

  const {
    provisionFactoryRoles,
    assignRole,
    provisionWorkOrderStates,
    provisionStarterLocationTypes,
    createCustomer,
    createLocation,
    createCatalogItem,
    createAssetCategory,
    createAsset,
    withTenant,
  } = require('../../packages/db/src/index.ts');
  const { pgPoolAdapter } = require('../../packages/db/src/adapters.ts');
  const { buildContext, PERMISSION_KEYS } = require('../../packages/domain/src/index.ts');

  /*
   * O catálogo de permissões é espelho do código (§21) e não vem por
   * migration: sem sincronizar, o papel de fábrica referencia uma chave que o
   * banco não conhece e a chave estrangeira recusa.
   */
  const { syncPermissionCatalog, syncCatalogDefinitions } = require('../../packages/db/src/index.ts');
  const admin = pgPoolAdapter(pool, null);
  await syncPermissionCatalog(admin);
  await syncCatalogDefinitions(admin);

  const db = pgPoolAdapter(pool, 'aurora_app');

  for (const [org, mem, papel, clienteId, nomeCliente] of [
    [E2E.orgA, E2E.memCoordA, 'admin', E2E.clienteA, 'Unidade Central Alfa'],
    [E2E.orgB, E2E.memCoordB, 'admin', E2E.clienteB, 'Unidade Central Beta'],
  ]) {
    const ctx = buildContext({
      organizationId: org,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'e2e-seed',
      permissions: PERMISSION_KEYS,
    });

    await withTenant(db, ctx, async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, mem, papeis.get(papel));
      if (org === E2E.orgA) {
        await assignRole(s, E2E.memTecA, papeis.get('technician'));
        await assignRole(s, E2E.memAuditoraA, papeis.get('auditor'));
      }
      // A consultora é coordenadora nas duas: mesmo papel, organizações
      // diferentes.
      await assignRole(
        s,
        org === E2E.orgA ? E2E.memConsultoraA : E2E.memConsultoraB,
        papeis.get('coordinator')
      );

      await provisionWorkOrderStates(s);
      const tipos = await provisionStarterLocationTypes(s);

      await s.query(
        `INSERT INTO aurora.customers (id, organization_id, name, is_internal) VALUES ($1, $2, $3, true)`,
        [clienteId, org, nomeCliente]
      );
      const local = await createLocation(s, {
        customerId: clienteId,
        locationTypeId: tipos.get('unidade'),
        name: org === E2E.orgA ? 'UTI Alfa' : 'UTI Beta',
      });

      await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'corretiva',
        label: 'Corretiva',
        systemKey: 'corrective',
      });

      const categoria = await createAssetCategory(s, { name: 'Ventilador pulmonar' });
      await createAsset(s, {
        name: org === E2E.orgA ? 'Ventilador Alfa-1' : 'Ventilador Beta-1',
        customerId: clienteId,
        assetCategoryId: categoria,
        locationId: local,
        assetNumber: org === E2E.orgA ? 'PAT-ALFA-001' : 'PAT-BETA-001',
      });
    });
  }

  // Os números são contados, e não escritos à mão: a linha anterior dizia
  // "3 pessoas" depois de a quarta ter entrado, e um resumo que mente sobre a
  // própria massa é pior do que resumo nenhum.
  const [{ pessoas }] = await q(`SELECT count(*)::int AS pessoas FROM aurora.users`);
  const [{ vinculos }] = await q(`SELECT count(*)::int AS vinculos FROM aurora.memberships`);
  console.log(
    `massa e2e criada: 2 organizações, ${pessoas} pessoas em ${vinculos} vínculos, 2 clientes, 2 ativos`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
