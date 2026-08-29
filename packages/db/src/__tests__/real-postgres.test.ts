/**
 * Aurora — o que só um PostgreSQL de verdade prova.
 *
 * O PGlite (ADR-022) roda as migrations e o comportamento inteiro, e é MAIS
 * severo que um servidor para uma coisa só: como tem uma conexão persistente,
 * qualquer variável que sobrevivesse ao `COMMIT` apareceria na transação
 * seguinte. Mas ele tem uma conexão só — e por isso não prova nada sobre:
 *
 *   · REUSO DE POOL: a conexão física de um tenant voltando para outro;
 *   · CONCORRÊNCIA REAL: duas transações disputando a mesma linha;
 *   · `SKIP LOCKED` e travas de aconselhamento sob disputa;
 *   · RLS avaliada sob um usuário que NÃO é dono das tabelas.
 *
 * Esta suíte só roda quando `AURORA_TEST_PG_URL` aponta para um PostgreSQL
 * real. Sem a variável ela é pulada — e o `describe.skipIf` diz isso em vez de
 * passar em silêncio, que seria o pior dos dois mundos: cobertura aparente.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { pgPoolAdapter } from '../adapters';
import { withTenant } from '../client';
import { migrate } from '../migrator';
import { syncPermissionCatalog } from '../rbac';
import { syncCatalogDefinitions } from '../catalogs';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { createWarehouse, createItem, recordMovement, reserve, balances } from '../inventory';
import { createServiceRequest } from '../service-requests';
import { inviteMember } from '../memberships';
import type { Database } from '../client';

const URL = process.env.AURORA_TEST_PG_URL;
const rodar = Boolean(URL);

/** Um esquema por execução: a suíte não pode depender de banco limpo. */
const ORG_A = newId();
const ORG_B = newId();
const USER_A = newId(),
  MEM_A = newId();
const USER_B = newId(),
  MEM_B = newId();

const ctxA = buildContext({
  organizationId: ORG_A,
  actorId: USER_A,
  membershipId: MEM_A,
  requestId: 'pg-a',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'pg-b',
  permissions: PERMISSION_KEYS,
});

let admin: Pool;
let appPool: Pool;
let db: Database;
let adminDb: Database;

let clienteA: string, localA: string, ativoA: string, naturezaA: string;
let armazem: string, item: string;

async function seedOrg(org: string, userId: string, membershipId: string, slug: string) {
  await admin.query(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [
    org,
    slug,
    slug,
  ]);
  await admin.query(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
    userId,
    `${slug}@pg.test`,
    slug,
  ]);
  // Vínculo e escopo na mesma transação: aqui, num servidor de verdade, o
  // gatilho diferido da 0039 dispara no COMMIT de UMA conexão física — o que o
  // PGlite não consegue distinguir de autocommit.
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
       VALUES ($1, $2, $3, 'active', 'staff', true)`,
      [membershipId, org, userId]
    );
    await c.query(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
      membershipId,
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

beforeAll(async () => {
  if (!rodar) return;

  admin = new Pool({ connectionString: URL, max: 4 });
  adminDb = pgPoolAdapter(admin, null);

  await migrate(adminDb);
  await syncPermissionCatalog(adminDb);
  await syncCatalogDefinitions(adminDb);

  /*
   * O papel `aurora_app` é NOLOGIN, como deve ser. Para exercitar a RLS com os
   * privilégios REAIS de produção, o pool conecta com o superusuário e o
   * adaptador faz `SET LOCAL ROLE aurora_app` em toda transação — que é
   * exatamente o que o runtime faz. O que importa aqui é que as consultas
   * sejam avaliadas sob um papel que não é dono das tabelas.
   */
  appPool = new Pool({ connectionString: URL, max: 3 });
  db = pgPoolAdapter(appPool, 'aurora_app');

  await seedOrg(ORG_A, USER_A, MEM_A, `pga${Date.now().toString(36)}`);
  await seedOrg(ORG_B, USER_B, MEM_B, `pgb${Date.now().toString(36)}`);

  await withTenant(db, ctxA, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    clienteA = await createCustomer(s, { name: 'Hospital A', isInternal: true });
    localA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede A',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativoA = await createAsset(s, {
      name: 'Ventilador A1',
      customerId: clienteA,
      assetCategoryId: cat,
      locationId: localA,
    });
    naturezaA = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    armazem = await createWarehouse(s, { name: 'Central A', kind: 'central' });
    item = await createItem(s, { sku: `FLT-${Date.now()}`, name: 'Filtro' });
    await recordMovement(s, {
      itemId: item,
      warehouseId: armazem,
      kind: 'receipt',
      qty: 1,
      unitCost: 100,
    });
  });

  await withTenant(db, ctxB, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    const c = await createCustomer(s, { name: 'Hospital B', isInternal: true });
    await createLocation(s, {
      customerId: c,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede B',
    });
  });
}, 300_000);

afterAll(async () => {
  await appPool?.end();
  await admin?.end();
});

/* -------------------------------------------------------------------------- */

describe.skipIf(!rodar)('reuso de conexão do pool', () => {
  it('o contexto do tenant A não sobrevive na conexão que atende o tenant B', async () => {
    /*
     * O pool tem 3 conexões e a suíte usa uma de cada vez, então a conexão que
     * atendeu A é reaproveitada por B com altíssima probabilidade. O que
     * garante o isolamento não é a sorte: é `is_local => true` no `set_config`,
     * que faz o contexto morrer no `COMMIT`.
     */
    const doA = await withTenant(db, ctxA, (s) =>
      s.query<{ org: string }>(`SELECT aurora.current_organization_id()::text AS org`)
    );
    expect(doA[0]!.org).toBe(ORG_A);

    for (let i = 0; i < 20; i++) {
      const doB = await withTenant(db, ctxB, (s) =>
        s.query<{ org: string }>(`SELECT aurora.current_organization_id()::text AS org`)
      );
      expect(doB[0]!.org).toBe(ORG_B);
    }
  });

  it('fora de transação, a conexão devolvida ao pool não tem contexto nenhum', async () => {
    await withTenant(db, ctxA, (s) => s.query('SELECT 1'));

    // Consulta direta pelo pool, sem `withTenant`: pega a conexão que acabou de
    // voltar. Se algo tivesse escapado, apareceria aqui.
    const r = await appPool.query<{ org: string | null }>(
      `SELECT current_setting('aurora.organization_id', true) AS org`
    );
    expect(r.rows[0]!.org === null || r.rows[0]!.org === '').toBe(true);
  });

  it('sem contexto, a RLS fecha: nenhuma linha, e não todas', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE aurora_app');
      const r = await client.query('SELECT count(*)::int AS total FROM aurora.customers');
      // Falha fechada: `organization_id = NULL` é falso para toda linha.
      expect(r.rows[0].total).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('vinte alternâncias A/B nunca vazam uma linha do outro tenant', async () => {
    for (let i = 0; i < 20; i++) {
      const ctx = i % 2 === 0 ? ctxA : ctxB;
      const esperado = i % 2 === 0 ? ORG_A : ORG_B;
      const linhas = await withTenant(db, ctx, (s) =>
        s.query<{ organization_id: string }>(`SELECT organization_id FROM aurora.customers`)
      );
      expect(linhas.length).toBeGreaterThan(0);
      expect(linhas.every((l) => l.organization_id === esperado)).toBe(true);
    }
  });
});

describe.skipIf(!rodar)('RLS sob o papel de aplicação real', () => {
  it('aurora_app não é dono das tabelas e não tem BYPASSRLS', async () => {
    const r = await admin.query<{ bypass: boolean; owner: string }>(
      `SELECT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'aurora_app') AS bypass,
              (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'customers') AS owner`
    );
    expect(r.rows[0]!.bypass).toBe(false);
    expect(r.rows[0]!.owner).toBe('aurora_owner');
  });

  it('FORCE RLS vale também para o dono — e é isso que o PGlite não distingue', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE aurora_owner');
      // Sem contexto, o DONO da tabela também não enxerga nada. Sem `FORCE`,
      // este número seria o total do banco.
      const r = await client.query('SELECT count(*)::int AS total FROM aurora.customers');
      expect(r.rows[0].total).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('a trilha de auditoria é append-only para aurora_app, verificado no catálogo', async () => {
    const r = await admin.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('aurora_app', 'aurora.audit_logs', 'UPDATE') AS upd,
              has_table_privilege('aurora_app', 'aurora.audit_logs', 'DELETE') AS del`
    );
    expect(r.rows[0]!.upd).toBe(false);
    expect(r.rows[0]!.del).toBe(false);
  });
});

describe.skipIf(!rodar)('concorrência real', () => {
  it('duas OS criadas ao mesmo tempo recebem números diferentes', async () => {
    /*
     * `aurora.next_number` incrementa sob bloqueio de linha. Com uma conexão só,
     * as duas chamadas seriam serializadas pelo próprio adaptador e o teste não
     * provaria nada. Aqui elas correm em conexões físicas distintas.
     */
    const [a, b] = await Promise.all([
      withTenant(db, ctxA, (s) =>
        createWorkOrder(s, {
          customerId: clienteA,
          workOrderTypeId: naturezaA,
          title: 'Concorrente 1',
          locationId: localA,
          assetId: ativoA,
        })
      ),
      withTenant(db, ctxA, (s) =>
        createWorkOrder(s, {
          customerId: clienteA,
          workOrderTypeId: naturezaA,
          title: 'Concorrente 2',
          locationId: localA,
          assetId: ativoA,
        })
      ),
    ]);

    expect(a.number).not.toBe(b.number);
    expect(a.number).toBeTruthy();
    expect(b.number).toBeTruthy();
  });

  it('dez OS simultâneas produzem dez números distintos', async () => {
    const criadas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withTenant(db, ctxA, (s) =>
          createWorkOrder(s, {
            customerId: clienteA,
            workOrderTypeId: naturezaA,
            title: `Lote ${i}`,
            locationId: localA,
            assetId: ativoA,
          })
        )
      )
    );
    const numeros = criadas.map((c) => c.number);
    expect(new Set(numeros).size).toBe(10);
  });

  it('duas reservas simultâneas da última peça: uma passa, a outra é recusada', async () => {
    /*
     * Este é o caso que o EPIC-015 existe para resolver, e o único jeito de
     * prová-lo é com concorrência de verdade. O saldo é 1. Duas reservas de 1
     * unidade partem juntas; a restrição `reserved <= GREATEST(on_hand, 0)` é
     * quem decide — não uma leitura prévia, que as duas passariam.
     */
    const os1 = await withTenant(db, ctxA, (s) =>
      createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: naturezaA,
        title: 'Disputa peça 1',
        locationId: localA,
        assetId: ativoA,
      })
    );
    const os2 = await withTenant(db, ctxA, (s) =>
      createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: naturezaA,
        title: 'Disputa peça 2',
        locationId: localA,
        assetId: ativoA,
      })
    );

    const resultados = await Promise.allSettled([
      withTenant(db, ctxA, (s) => reserve(s, os1.id, item, armazem, 1)),
      withTenant(db, ctxA, (s) => reserve(s, os2.id, item, armazem, 1)),
    ]);

    const ok = resultados.filter((r) => r.status === 'fulfilled').length;
    const falhou = resultados.filter((r) => r.status === 'rejected').length;

    expect(ok).toBe(1);
    expect(falhou).toBe(1);

    const saldo = await withTenant(db, ctxA, (s) => balances(s, { warehouseId: armazem }));
    expect(Number(saldo[0]!.reserved)).toBe(1);
    expect(Number(saldo[0]!.on_hand)).toBe(1);
  });

  it('duas transições simultâneas da mesma OS: uma vence, a outra não corrompe', async () => {
    const os = await withTenant(db, ctxA, (s) =>
      createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: naturezaA,
        title: 'Dois coordenadores',
        locationId: localA,
        assetId: ativoA,
      })
    );

    const resultados = await Promise.allSettled([
      withTenant(db, ctxA, (s) => transitionWorkOrder(s, os.id, 'in_progress')),
      withTenant(db, ctxA, (s) =>
        transitionWorkOrder(s, os.id, 'cancelled', {
          cancellationReason: 'aberta em duplicidade pelo mesmo solicitante',
        })
      ),
    ]);

    const aceitas = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(aceitas).toBeGreaterThanOrEqual(1);

    // Qualquer que seja a vencedora, a OS termina num estado declarado e o
    // histórico registra exatamente as transições que de fato aconteceram.
    const [linha] = await withTenant(db, ctxA, (s) =>
      s.query<{ status_category: string }>(
        `SELECT status_category::text FROM aurora.work_orders WHERE id = $1`,
        [os.id]
      )
    );
    expect(['in_progress', 'cancelled', 'open']).toContain(linha!.status_category);

    const historico = await withTenant(db, ctxA, (s) =>
      s.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM aurora.work_order_status_history WHERE work_order_id = $1`,
        [os.id]
      )
    );
    expect(Number(historico[0]!.total)).toBeGreaterThanOrEqual(1);
  });

  it('duas movimentações simultâneas mantêm o saldo somável', async () => {
    const item2 = await withTenant(db, ctxA, (s) =>
      createItem(s, { sku: `MOV-${Date.now()}`, name: 'Peça de teste' })
    );

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withTenant(db, ctxA, (s) =>
          recordMovement(s, {
            itemId: item2,
            warehouseId: armazem,
            kind: 'receipt',
            qty: 5,
            unitCost: 10,
          })
        )
      )
    );

    const [linha] = await withTenant(db, ctxA, (s) =>
      s.query<{ on_hand: string }>(
        `SELECT on_hand FROM aurora.stock_balances WHERE item_id = $1 AND warehouse_id = $2`,
        [item2, armazem]
      )
    );
    // Oito entradas de 5: nenhuma pode se perder num "read-modify-write".
    expect(Number(linha!.on_hand)).toBe(40);
  });

  it('criação concorrente sujeita a índice único: exatamente uma passa', async () => {
    const nome = `Cliente disputado ${Date.now()}`;
    const resultados = await Promise.allSettled([
      withTenant(db, ctxA, (s) => createCustomer(s, { name: nome })),
      withTenant(db, ctxA, (s) => createCustomer(s, { name: nome })),
      withTenant(db, ctxA, (s) => createCustomer(s, { name: nome })),
    ]);

    const ok = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
  });
});

describe.skipIf(!rodar)('trava de aconselhamento e SKIP LOCKED', () => {
  it('a alocação de número de documento serializa a MESMA série', async () => {
    const [serie] = await withTenant(db, ctxA, async (s) => {
      const tipo = newId();
      await s.query(
        `INSERT INTO aurora.document_types (id, organization_id, key, label, series)
         VALUES ($1, $2, 'teste_conc', 'Teste de concorrência', 'TC')`,
        [tipo, ORG_A]
      );
      const id = newId();
      await s.query(
        `INSERT INTO aurora.number_series (id, organization_id, document_type_id, prefix)
         VALUES ($1, $2, $3, 'TC')`,
        [id, ORG_A, tipo]
      );
      return [{ id }];
    });

    const ano = new Date().getUTCFullYear();
    const numeros = await Promise.all(
      Array.from({ length: 12 }, () =>
        withTenant(db, ctxA, (s) =>
          s
            .query<{ seq: string }>(`SELECT aurora.allocate_document_number($1, $2)::text AS seq`, [
              serie!.id,
              ano,
            ])
            .then((r) => Number(r[0]!.seq))
        )
      )
    );

    // Doze alocações concorrentes, doze números distintos e sem buraco: é o que
    // `pg_advisory_xact_lock` garante e uma leitura prévia não garantiria.
    expect(new Set(numeros).size).toBe(12);
    expect(Math.min(...numeros)).toBe(1);
    expect(Math.max(...numeros)).toBe(12);
  });

  it('SKIP LOCKED: dois publicadores nunca pegam o mesmo evento', async () => {
    /*
     * O padrão do publicador de outbox. Sem `SKIP LOCKED`, o segundo esperaria o
     * primeiro e entregaria o mesmo evento duas vezes ou travaria; com ele, cada
     * um pega um lote diferente e ninguém espera.
     */
    await withTenant(db, ctxA, async (s) => {
      for (let i = 0; i < 20; i++) {
        await s.query(
          `INSERT INTO aurora.domain_events
             (id, organization_id, type, aggregate_type, aggregate_id, payload, actor_kind, request_id)
           VALUES ($1, $2, 'work_order.opened', 'work_order', $3, '{}'::jsonb, 'system', 'skip-locked')`,
          [newId(), ORG_A, ativoA]
        );
      }
    });

    async function pega(): Promise<string[]> {
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query<{ id: string }>(
          `SELECT id FROM aurora.domain_events
            WHERE request_id = 'skip-locked' AND published_at IS NULL
            ORDER BY occurred_at
            LIMIT 5 FOR UPDATE SKIP LOCKED`
        );
        // Segura o lote antes de liberar, para o outro publicador ter de pular.
        await new Promise((r2) => setTimeout(r2, 120));
        await client.query('COMMIT');
        return r.rows.map((x) => x.id);
      } finally {
        client.release();
      }
    }

    const [um, dois] = await Promise.all([pega(), pega()]);
    const interseccao = um.filter((id) => dois.includes(id));

    expect(um.length).toBeGreaterThan(0);
    expect(dois.length).toBeGreaterThan(0);
    expect(interseccao).toEqual([]);
  });
});

describe.skipIf(!rodar)('isolamento adversarial com conexões físicas distintas', () => {
  it('o tenant B não alcança a OS do tenant A nem sabendo o identificador', async () => {
    const os = await withTenant(db, ctxA, (s) =>
      createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: naturezaA,
        title: 'Só de A',
        locationId: localA,
        assetId: ativoA,
      })
    );

    const vistoPorB = await withTenant(db, ctxB, (s) =>
      s.query(`SELECT id FROM aurora.work_orders WHERE id = $1`, [os.id])
    );
    expect(vistoPorB).toEqual([]);
  });

  it('o tenant B não consegue ESCREVER uma linha com o organization_id de A', async () => {
    await expect(
      withTenant(db, ctxB, (s) =>
        s.query(`INSERT INTO aurora.customers (id, organization_id, name) VALUES ($1, $2, 'invasor')`, [
          newId(),
          ORG_A,
        ])
      )
    ).rejects.toThrow();
  });

  it('a solicitação de A não aparece na fila de B', async () => {
    await withTenant(db, ctxA, (s) =>
      createServiceRequest(s, {
        customerId: clienteA,
        summary: 'Equipamento com ruído',
        locationId: localA,
        assetId: ativoA,
      })
    );

    const deB = await withTenant(db, ctxB, (s) => s.query(`SELECT id FROM aurora.service_requests`));
    expect(deB).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe.skipIf(!rodar)('convite sob o papel de aplicação real', () => {
  /*
   * Este bloco existe porque o convite era, até a 0040, uma operação que só
   * funcionava em teste. A RLS de `users` exige vínculo prévio; o vínculo exige
   * usuário. Com uma conexão só, o PGlite mostra o mesmo erro — mas é aqui, com
   * `SET LOCAL ROLE aurora_app` num servidor de verdade, que se prova que o
   * caminho novo passa pelos privilégios de produção e não por um atalho.
   */

  it('convida alguém que ainda não existe na plataforma', async () => {
    const email = `novato-${Date.now()}@pg.test`;
    const r = await withTenant(db, ctxA, (s) => inviteMember(s, { email, name: 'Novato da Silva' }));

    expect(r.reusedUser).toBe(false);

    const [linha] = await admin
      .query(
        `SELECT u.email, m.status::text AS status, s.customer_scope::text AS escopo
         FROM aurora.memberships m
         JOIN aurora.users u ON u.id = m.user_id
         JOIN aurora.membership_scopes s ON s.membership_id = m.id
        WHERE m.id = $1`,
        [r.membershipId]
      )
      .then((x) => x.rows);

    expect(linha).toMatchObject({ email, status: 'active', escopo: 'all' });
  });

  it('a mesma pessoa entra na segunda organização sem virar dois cadastros', async () => {
    const email = `consultor-${Date.now()}@pg.test`;

    const naA = await withTenant(db, ctxA, (s) => inviteMember(s, { email, name: 'Carla Consultora' }));
    const naB = await withTenant(db, ctxB, (s) => inviteMember(s, { email, name: 'Carla Consultora' }));

    expect(naA.reusedUser).toBe(false);
    expect(naB.reusedUser).toBe(true);
    expect(naB.userId).toBe(naA.userId);

    const { rows } = await admin.query(
      `SELECT count(*)::int AS total FROM aurora.users WHERE lower(email) = $1`,
      [email]
    );
    expect(rows[0].total).toBe(1);
  });

  it('B não enxerga a pessoa convidada por A, mesmo depois de ela existir', async () => {
    const email = `sodea-${Date.now()}@pg.test`;
    await withTenant(db, ctxA, (s) => inviteMember(s, { email, name: 'Só de A' }));

    const visto = await withTenant(db, ctxB, (s) =>
      s.query(`SELECT id FROM aurora.users WHERE lower(email) = $1`, [email])
    );
    // A resolução por e-mail (0040) diria que o endereço existe — é o que
    // permite o convite cruzado. Ler a LINHA continua proibido.
    expect(visto).toEqual([]);
  });

  it('a chave estrangeira diferida ainda pega vínculo para usuário inexistente', async () => {
    await expect(
      withTenant(db, ctxA, async (s) => {
        const mem = newId();
        await s.query(
          `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
           VALUES ($1, $2, $3, 'active', 'staff', false)`,
          [mem, ORG_A, newId()]
        );
        await s.query(
          `INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`,
          [mem, ORG_A]
        );
      })
      // Diferida não é ausente: o erro chega no COMMIT, e chega.
    ).rejects.toThrow(/memberships_user_id_fkey/);
  });

  it('dois convites simultâneos do mesmo e-mail: um entra, o outro é recusado', async () => {
    const email = `corrida-${Date.now()}@pg.test`;

    const [um, dois] = await Promise.allSettled([
      withTenant(db, ctxA, (s) => inviteMember(s, { email, name: 'Corrida Um' })),
      withTenant(db, ctxA, (s) => inviteMember(s, { email, name: 'Corrida Dois' })),
    ]);

    const ok = [um, dois].filter((r) => r.status === 'fulfilled');
    const falhou = [um, dois].filter((r) => r.status === 'rejected');

    /*
     * As duas transações leem "não existe" antes de qualquer uma escrever: a
     * verificação em SQL não protege nada sozinha. Quem protege é o índice
     * único de e-mail — e é ele que precisa estar lá, não a checagem prévia.
     */
    expect(ok).toHaveLength(1);
    expect(falhou).toHaveLength(1);

    const { rows } = await admin.query(
      `SELECT count(*)::int AS total FROM aurora.memberships m
         JOIN aurora.users u ON u.id = m.user_id
        WHERE lower(u.email) = $1`,
      [email]
    );
    expect(rows[0].total).toBe(1);
  });

  it('vínculo sem escopo é recusado no COMMIT, sob o papel de aplicação', async () => {
    const { rows } = await admin.query(`SELECT id FROM aurora.users WHERE id = $1`, [USER_A]);
    expect(rows).toHaveLength(1);

    await expect(
      withTenant(db, ctxA, (s) =>
        s.query(
          `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
           VALUES ($1, $2, $3, 'active', 'staff', false)`,
          [newId(), ORG_A, USER_A]
        )
      )
    ).rejects.toThrow();
  });
});
