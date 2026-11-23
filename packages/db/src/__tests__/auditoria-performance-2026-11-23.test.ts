/**
 * Aurora — regressão da auditoria de performance de 23/11/2026
 * (docs/auditoria/RELATORIO_SEGURANCA_PERFORMANCE.md).
 *
 *   · PERF-02  "setor do equipamento" pelos ancestrais do PRÓPRIO caminho (`s.id = ANY(...)`,
 *              chave primária) em vez de `a.location_path LIKE s.path || '%'` (laço ativos ×
 *              locais sem índice possível). A troca só vale se o resultado for IDÊNTICO — é o
 *              que este teste prova, em árvore com vários níveis, local apagado e ativo sem local;
 *   · PERF-01/10/11  os três índices da 0091 existem e a lista de OS sem filtro os usa;
 *   · PERF-05  a varredura de SLA não toca relógio já estourado e continua estourando/avisando.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createAssetCategory, createAsset } from '../assets';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';
import { sweepSlaClocks } from '../sla';

const ORG = newId();
let t: TestDatabase;
const ctx = buildContext({
  organizationId: ORG,
  actorKind: 'system',
  requestId: 'perf-1123',
  permissions: PERMISSION_KEYS,
});

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: newId(), membershipId: newId() },
    { slug: 'perf-1123', name: 'Perf', email: 'perf@perf-1123.test', userName: 'Perf' }
  );
  await withTenant(t.db, ctx, async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    const cat = await createAssetCategory(s, { name: 'Monitor' });
    for (let c = 0; c < 2; c++) {
      const cliente = await createCustomer(s, { name: `Hospital ${c}` });
      for (let u = 0; u < 2; u++) {
        const unidade = await createLocation(s, {
          customerId: cliente,
          locationTypeId: tipos.get('unidade')!,
          name: `U${u}`,
        });
        for (let k = 0; k < 3; k++) {
          const setor = await createLocation(s, {
            customerId: cliente,
            parentId: unidade,
            locationTypeId: tipos.get('setor')!,
            name: `Setor ${c}.${u}.${k}`,
          });
          const sala = await createLocation(s, {
            customerId: cliente,
            parentId: setor,
            locationTypeId: tipos.get('sala')!,
            name: `Sala ${k}`,
          });
          // ativo direto no setor, na sala abaixo dele e direto na unidade (sem setor)
          for (const local of [setor, sala, unidade]) {
            await createAsset(s, {
              name: `A ${c}.${u}.${k}`,
              customerId: cliente,
              assetCategoryId: cat,
              locationId: local,
            });
          }
        }
      }
      // ativo sem local
      await createAsset(s, { name: `Sem local ${c}`, customerId: cliente, assetCategoryId: cat });
    }
  });
  // Um setor apagado: nem o LIKE nem o ANY podem contá-lo.
  await t.raw(
    `UPDATE aurora.locations SET deleted_at = now()
      WHERE id = (SELECT id FROM aurora.locations WHERE organization_id = $1 AND name = 'Setor 0.0.0')`,
    [ORG]
  );
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('PERF-02 · setor pelos ancestrais do caminho', () => {
  it('mesmo resultado que o LIKE de prefixo, ativo por ativo (inclusive sem local e setor apagado)', async () => {
    const consulta = (cond: string) =>
      withTenant(t.db, ctx, (s) =>
        s.query<{ id: string; setores: string }>(
          `SELECT a.id,
                  coalesce((SELECT string_agg(s.id::text, ',' ORDER BY s.id)
                              FROM aurora.locations s
                              JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
                             WHERE ${cond} AND s.deleted_at IS NULL), '') AS setores
             FROM aurora.assets a ORDER BY a.id`
        )
      );
    const antes = await consulta(`a.location_path LIKE s.path || '%'`);
    const depois = await consulta(`s.id = ANY (string_to_array(btrim(a.location_path, '/'), '/')::uuid[])`);
    expect(antes.length).toBeGreaterThan(30);
    expect(depois).toEqual(antes);
    // a massa cobre os três casos: com setor, sem setor (unidade/sem local) e o setor apagado
    expect(antes.some((r) => r.setores === '')).toBe(true);
    expect(antes.some((r) => r.setores !== '')).toBe(true);
  });

  it('agregado do Painel por setor: unnest dos ancestrais conta o mesmo que o LIKE', async () => {
    const porSetor = (juncao: string) =>
      withTenant(t.db, ctx, (s) =>
        s.query<{ id: string; n: string }>(
          `SELECT s.id, count(a.id)::text AS n
             FROM aurora.assets a
             ${juncao}
             JOIN aurora.location_types lt ON lt.id = s.location_type_id AND lt.key = 'setor'
            WHERE a.deleted_at IS NULL
            GROUP BY s.id ORDER BY s.id`
        )
      );
    const antes = await porSetor(
      `JOIN aurora.locations s ON a.location_path LIKE s.path || '%' AND s.deleted_at IS NULL`
    );
    const depois = await porSetor(
      `CROSS JOIN LATERAL unnest(string_to_array(btrim(a.location_path, '/'), '/')::uuid[]) AS ancestral(id)
       JOIN aurora.locations s ON s.id = ancestral.id AND s.deleted_at IS NULL`
    );
    expect(antes.length).toBeGreaterThan(5);
    expect(depois).toEqual(antes);
  });
});

describe('PERF-01/10/11 · índices da 0091', () => {
  it('existem e a lista de OS sem filtro usa o índice por data de criação', async () => {
    const nomes = (await t.raw(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'aurora'
          AND indexname IN ('wo_org_created_idx', 'sla_clocks_stopped_idx', 'wosh_org_changed_idx')`
    )) as { indexname: string }[];
    expect(nomes.map((n) => n.indexname).sort()).toEqual([
      'sla_clocks_stopped_idx',
      'wo_org_created_idx',
      'wosh_org_changed_idx',
    ]);
    const plano = await withTenant(t.db, ctx, async (s) => {
      await s.query('SET LOCAL enable_seqscan = off');
      return s.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT w.id FROM aurora.work_orders w ORDER BY w.created_at DESC LIMIT 100`
      );
    });
    expect(plano.map((l) => l['QUERY PLAN']).join(' ')).toContain('wo_org_created_idx');
  });
});

describe('PERF-05 · varredura de SLA', () => {
  it('estoura e avisa como antes; relógio já estourado não volta à varredura nem emite de novo', async () => {
    const wo = newId();
    await t.raw(
      `INSERT INTO aurora.sla_clocks
         (id, organization_id, document_type, document_id, kind, state, policy_name_snapshot, target_minutes,
          business_hours_only, calendar_snapshot, priority_snapshot, started_at, due_at)
       VALUES ($1, $2, 'work_order', $3, 'resolution', 'running', 'P', 60, false, '{}'::jsonb, 'none',
               now() - interval '2 hours', now() - interval '1 hour')`,
      [newId(), ORG, wo]
    );
    const primeira = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s));
    expect(primeira.breached).toBe(1);
    const segunda = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s));
    expect(segunda.breached).toBe(0);
    const [{ n }] = (await t.raw(
      `SELECT count(*)::int AS n FROM aurora.domain_events WHERE type = 'sla.breached' AND aggregate_id = $1`,
      [wo]
    )) as { n: number }[];
    expect(n).toBe(1);
  });
});
