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
  /*
   * A enfermeira do CLIENTE, com assento de portal.
   *
   * Escopo de um cliente e de um local: é a persona que a §19 descreve — "a
   * enfermeira da UTI II vê a UTI II". Sem escopo restrito, um teste de
   * vazamento do portal não prova nada.
   */
  userPortalA: '0193d900-0001-7000-8000-00000000000e',

  memCoordA: '0193d900-0002-7000-8000-00000000000a',
  memTecA: '0193d900-0002-7000-8000-00000000001a',
  memCoordB: '0193d900-0002-7000-8000-00000000000b',
  memConsultoraA: '0193d900-0002-7000-8000-00000000001c',
  memConsultoraB: '0193d900-0002-7000-8000-00000000002c',
  memAuditoraA: '0193d900-0002-7000-8000-00000000001d',
  memPortalA: '0193d900-0002-7000-8000-00000000001e',

  clienteA: '0193d900-0003-7000-8000-00000000000a',
  clienteB: '0193d900-0003-7000-8000-00000000000b',

  emailCoordA: 'coord.a@e2e.test',
  emailTecA: 'tec.a@e2e.test',
  emailCoordB: 'coord.b@e2e.test',
  emailConsultora: 'consultora@e2e.test',
  emailAuditora: 'auditora@e2e.test',
  emailPortalA: 'enfermeira@e2e.test',
};

const pool = new Pool({ connectionString: url, max: 4 });

async function q(sql, params) {
  return (await pool.query(sql, params)).rows;
}

async function main() {
  if (process.argv.includes('--reset')) {
    /*
     * O RAZÃO DE ESTOQUE É IMUTÁVEL, e isso vale contra este script também.
     *
     * A migration 0030 põe um gatilho que RECUSA `UPDATE` e `DELETE` em
     * `stock_movements`: correção de estoque é movimento inverso, nunca
     * apagamento. A cascata do `DELETE` da organização esbarra nele.
     *
     * A saída NÃO é enfraquecer o gatilho. É desligá-lo aqui, explicitamente,
     * pelo tempo do apagamento — este script roda como superusuário, e é uma
     * limpeza de massa de teste, não um caminho da aplicação. Deixar a
     * garantia mais frouxa para o `reset` funcionar seria trocar uma
     * propriedade do produto pela conveniência de um script.
     *
     * O `ENABLE` volta no `finally`: um gatilho desligado por causa de uma
     * falha no meio é pior do que o problema que ele resolve.
     */
    await q(`ALTER TABLE aurora.stock_movements DISABLE TRIGGER stock_movements_immutable`);
    try {
      // A cascata leva o resto: se apagar a organização deixasse órfão em
      // alguma tabela, este comando falharia — e falhar aqui é melhor do que
      // descobrir o órfão num cliente.
      await q(`DELETE FROM aurora.organizations WHERE slug LIKE 'e2e-%'`);
      await q(`DELETE FROM aurora.users WHERE email LIKE '%@e2e.test'`);
    } finally {
      await q(`ALTER TABLE aurora.stock_movements ENABLE TRIGGER stock_movements_immutable`);
    }
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
    [E2E.userPortalA, E2E.emailPortalA, 'Elisa Enfermeira'],
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

  /* ------------------------------------------- o vínculo do PORTAL */

  /*
   * Fora do laço acima de propósito.
   *
   * Este vínculo tem `seat_type = 'portal'` — só `staff` consome assento pago
   * (§05) — e escopo RESTRITO por cliente e por local. O escopo restrito é o
   * que faz o teste de vazamento valer alguma coisa: com `customer_scope =
   * 'all'`, a enfermeira do Alfa enxergaria os chamados do Beta e o teste
   * passaria sem provar nada.
   *
   * O cliente e o local ainda não existem neste ponto — são criados no bloco
   * seguinte —, e por isso o escopo entra em `all` aqui e é APERTADO depois,
   * quando os identificadores existem. É a única ordem possível sem inverter
   * a criação do cliente, que depende do contexto de organização.
   */
  {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', 'portal', false)`,
        [E2E.memPortalA, E2E.orgA, E2E.userPortalA]
      );
      await c.query(
        `INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`,
        [E2E.memPortalA, E2E.orgA]
      );
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
    createWarehouse,
    createPlan,
    addPlanTask,
    generateCycle,
    createContract,
    addCoverage,
    createQuote,
    createItem,
    recordMovement,
    setMinimum,
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
        // `requester` é o papel do solicitante: lê o próprio chamado e abre
        // outro. É tudo o que um usuário de portal precisa.
        await assignRole(s, E2E.memPortalA, papeis.get('requester'));
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
      /*
       * A ÁRVORE PRECISA TER GALHO.
       *
       * Havia um local só, e uma árvore de um nó não é árvore: não prova
       * recuo, não prova expandir e recolher, e não prova que escolher um pai
       * traz o que está nos filhos. Três níveis é o mínimo que exercita as
       * três coisas — unidade, setor e sala.
       */
      const unidade = await createLocation(s, {
        customerId: clienteId,
        locationTypeId: tipos.get('unidade'),
        name: org === E2E.orgA ? 'Unidade Alfa' : 'Unidade Beta',
      });
      const local = await createLocation(s, {
        customerId: clienteId,
        parentId: unidade,
        locationTypeId: tipos.get('setor'),
        name: org === E2E.orgA ? 'UTI Alfa' : 'UTI Beta',
      });
      const sala = await createLocation(s, {
        customerId: clienteId,
        parentId: local,
        locationTypeId: tipos.get('sala') ?? tipos.get('setor'),
        name: org === E2E.orgA ? 'Leito 3 Alfa' : 'Leito 3 Beta',
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
      // Um segundo ativo, um nível ABAIXO: é ele que prova que escolher a UTI
      // na árvore traz também o que está no leito dentro dela. Com um ativo
      // só, "filtrar pela subárvore" e "filtrar pelo local exato" dão o mesmo
      // resultado, e o teste não distingue os dois.
      await createAsset(s, {
        name: org === E2E.orgA ? 'Monitor Alfa-2' : 'Monitor Beta-2',
        customerId: clienteId,
        assetCategoryId: categoria,
        locationId: sala,
        assetNumber: org === E2E.orgA ? 'PAT-ALFA-002' : 'PAT-BETA-002',
      });

      /*
       * ESTOQUE: dois itens, e um deles ABAIXO do mínimo de propósito.
       *
       * A tela de estoque abre na aba "abaixo do mínimo", e uma massa com tudo
       * em ordem faria o teste passar contra uma tela vazia — que é o mesmo
       * erro da spec de console que dava sete telas limpas visitando telas sem
       * dado dentro.
       *
       * O saldo entra por RECEBIMENTO, e não por escrita direta na tabela de
       * saldos: semear por fora produz um estado que a aplicação não sabe
       * criar, e o teste passa a provar um mundo que não existe.
       */
      const deposito = await createWarehouse(s, { name: 'Depósito ' + (org === E2E.orgA ? 'Alfa' : 'Beta') });
      const valvula = await createItem(s, {
        sku: org === E2E.orgA ? 'VAL-ALFA' : 'VAL-BETA',
        name: 'Válvula de exalação',
        unit: 'un',
      });
      const filtro = await createItem(s, {
        sku: org === E2E.orgA ? 'FIL-ALFA' : 'FIL-BETA',
        name: 'Filtro HEPA',
        unit: 'un',
      });
      await recordMovement(s, {
        itemId: valvula,
        warehouseId: deposito,
        kind: 'receipt',
        qty: 20,
        unitCost: 150,
      });
      await recordMovement(s, {
        itemId: filtro,
        warehouseId: deposito,
        kind: 'receipt',
        qty: 3,
        unitCost: 90,
      });
      await setMinimum(s, filtro, deposito, 10);

      /*
       * O ESCOPO DO PORTAL É APERTADO AGORA, com os identificadores que
       * acabaram de nascer: um cliente e um local.
       *
       * É a persona da §19 — "a enfermeira da UTI II vê a UTI II" — e é o que
       * faz o teste de vazamento provar alguma coisa: sem o aperto, ela veria
       * os chamados do Beta e o teste passaria por acidente.
       */
      if (org === E2E.orgA) {
        await s.query(
          `UPDATE aurora.membership_scopes
              SET customer_scope = 'listed', customer_ids = $2,
                  location_scope = 'listed', location_ids = $3
            WHERE membership_id = $1`,
          [E2E.memPortalA, [clienteId], [local]]
        );
      }

      /*
       * COMERCIAL: um contrato cobrindo a UTI, e um orçamento em rascunho.
       *
       * A cobertura é por LOCAL de propósito: é ela que prova que a expressão
       * alcança o que está dentro do local, e não só o que está exatamente
       * nele. Uma cobertura por ativo específico passaria no teste sem provar
       * nada sobre a expressão.
       */
      const contrato = await createContract(s, {
        customerId: clienteId,
        kind: 'full_service',
        title: 'Manutenção integral ' + (org === E2E.orgA ? 'Alfa' : 'Beta'),
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        autoRenew: true,
        billingModel: 'fixed_monthly',
        monthlyValue: 12000,
        includedCalls: 20,
      });
      await addCoverage(s, { contractId: contrato, kind: 'location_subtree', locationId: local });

      await createQuote(s, {
        customerId: clienteId,
        validUntil: '2026-12-31',
      });

      /*
       * PLANO PREVENTIVO com uma tarefa cuja expressão alcança a SUBÁRVORE.
       *
       * O ciclo é gerado aqui de propósito: um plano sem ciclo aberto faria a
       * tela de cumprimento não ter o que mostrar, e o teste passaria contra
       * uma tela vazia — o mesmo erro da spec de console que dava sete telas
       * limpas visitando telas sem dado dentro.
       */
      const plano = await createPlan(s, {
        name: 'Preventiva trimestral ' + (org === E2E.orgA ? 'Alfa' : 'Beta'),
        customerId: clienteId,
        description: 'Inspeção e troca de filtros.',
        autoGenerate: false,
        anchorDate: new Date('2026-01-01T00:00:00Z'),
      });
      const naturezaId = await s.query(
        `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' LIMIT 1`
      );
      const tarefa = await addPlanTask(s, {
        planId: plano,
        name: 'Troca de filtro',
        targetKind: 'location_subtree',
        targetLocationId: local,
        workOrderTypeId: naturezaId[0].id,
        frequencyUnit: 'quarter',
        frequencyInterval: 1,
        leadTimeDays: 3650,
        toleranceDays: 5,
      });
      // Antecedência enorme para o ciclo abrir agora, e não daqui a meses: a
      // massa precisa do ciclo EXISTINDO para a tela ter o que mostrar.
      await generateCycle(s, tarefa);
    });
  }

  // Os números são contados, e não escritos à mão: a linha anterior dizia
  // "3 pessoas" depois de a quarta ter entrado, e um resumo que mente sobre a
  // própria massa é pior do que resumo nenhum.
  const [{ pessoas }] = await q(`SELECT count(*)::int AS pessoas FROM aurora.users`);
  const [{ vinculos }] = await q(`SELECT count(*)::int AS vinculos FROM aurora.memberships`);
  const [{ locais }] = await q(`SELECT count(*)::int AS locais FROM aurora.locations`);
  const [{ ativos }] = await q(`SELECT count(*)::int AS ativos FROM aurora.assets`);
  const [{ saldos }] = await q(`SELECT count(*)::int AS saldos FROM aurora.stock_balances`);
  const [{ contratos }] = await q(`SELECT count(*)::int AS contratos FROM aurora.contracts`);
  const [{ ciclos }] = await q(`SELECT count(*)::int AS ciclos FROM aurora.plan_cycles`);
  console.log(
    `massa e2e criada: 2 organizações, ${pessoas} pessoas em ${vinculos} vínculos, ${locais} locais, ${ativos} ativos, ${saldos} saldos, ${contratos} contratos, ${ciclos} ciclos`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
