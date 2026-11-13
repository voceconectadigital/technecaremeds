/**
 * Aurora — contrato no cadastro do cliente e SLA geral × exceção (Anderson, 10/11/2026 — 0090).
 *
 *   1. contrato antigo continua igual: os campos novos nascem nulos ("não informado");
 *   2. modalidade, equipes fixas, base de precificação e pagamento são independentes;
 *   3. o SLA GERAL do contrato vale para o equipamento coberto; a EXCEÇÃO só quando configurada;
 *      a origem informada é a mesma política que abre os relógios (`resolve_sla_policy`);
 *   4. contrato sem SLA, vencido ou encerrado devolve a regra antiga (cliente → organização);
 *   5. a OS recebe UM relógio por tipo, com a política efetiva — nada a mais;
 *   6. outra organização não enxerga nem edita o contrato.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, ValidationError } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { createSlaPolicy, setSlaTarget, effectiveSlaForAsset } from '../sla';
import {
  createContract,
  addCoverage,
  activateContract,
  terminateContract,
  updateContract,
  normalizeFixedTeams,
} from '../contracts';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'ctr-sla',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'ctr-sla-b',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let hospital: string, clinica: string;
let ventilador: string, monitor: string, bomba: string, desfibrilador: string;
let natCorretiva: string;
let politicaPadrao: string, politicaGeral: string, politicaExcecao: string, politicaNova: string;
let contratoHospital: string, contratoClinica: string;

function dia(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

const em = <T>(fn: (s: TenantSession) => Promise<T>) => withTenant(t.db, ctx, fn);

/** A origem, conferida contra a cascata que os relógios usam de verdade. */
async function slaDe(assetId: string, customerId: string) {
  const efetivo = await em((s) => effectiveSlaForAsset(s, assetId));
  const [cascata] = await em((s) =>
    s.query<{ id: string | null }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [assetId, customerId])
  );
  expect(efetivo!.policy_id).toBe(cascata!.id);
  return efetivo!;
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'ctr-sla', name: 'Prestadora', email: 'a@ctr-sla.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'ctr-sla-b', name: 'Outra', email: 'b@ctr-sla.test', userName: 'B' }
  );

  await em(async (s) => {
    await provisionWorkOrderStates(s);
    hospital = await createCustomer(s, { name: 'Hospital Central' });
    clinica = await createCustomer(s, { name: 'Clínica Norte' });
    const cat = await createAssetCategory(s, { name: 'Equipamento médico' });
    ventilador = await createAsset(s, { name: 'Ventilador 01', customerId: hospital, assetCategoryId: cat });
    monitor = await createAsset(s, { name: 'Monitor 01', customerId: hospital, assetCategoryId: cat });
    desfibrilador = await createAsset(s, {
      name: 'Desfibrilador 01',
      customerId: hospital,
      assetCategoryId: cat,
    });
    bomba = await createAsset(s, { name: 'Bomba 01', customerId: clinica, assetCategoryId: cat });
    natCorretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    politicaPadrao = await createSlaPolicy(s, { name: 'Padrão da organização', isDefault: true });
    politicaGeral = await createSlaPolicy(s, { name: 'SLA geral do contrato' });
    politicaExcecao = await createSlaPolicy(s, { name: 'Exceção do equipamento' });
    politicaNova = await createSlaPolicy(s, { name: 'SLA geral renegociado' });
    for (const p of [politicaPadrao, politicaGeral, politicaExcecao, politicaNova]) {
      await setSlaTarget(s, p, 'none', 'onsite', 240, false);
      await setSlaTarget(s, p, 'none', 'resolution', 480, false);
    }
    await s.query(`UPDATE aurora.organizations SET default_sla_policy_id = $1 WHERE id = $2`, [
      politicaPadrao,
      ORG,
    ]);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('cadastro do contrato: três conceitos independentes', () => {
  it('contrato criado como antes fica com os campos novos NULOS (não informado)', async () => {
    const id = await em((s) =>
      createContract(s, { customerId: clinica, kind: 'on_demand', startsOn: dia(-10) })
    );
    contratoClinica = id;
    const [row] = await em((s) =>
      s.query<Record<string, unknown>>(
        `SELECT service_frequency, fixed_team_packages, payment_terms, billing_model::text AS billing_model
           FROM aurora.contracts WHERE id = $1`,
        [id]
      )
    );
    expect(row).toEqual({
      service_frequency: null,
      fixed_team_packages: null,
      payment_terms: null,
      billing_model: 'fixed_monthly',
    });
  });

  it('grava modalidade, equipes (normalizadas), hora técnica e pagamento à vista', async () => {
    contratoHospital = await em(async (s) => {
      const id = await createContract(s, {
        customerId: hospital,
        kind: 'full_service',
        startsOn: dia(-30),
        slaPolicyId: politicaGeral,
        serviceFrequency: 'monthly',
        fixedTeamPackages: [10, 1, 1],
        billingModel: 'per_hour',
        paymentTerms: 'upfront',
      });
      await addCoverage(s, { contractId: id, kind: 'customer' });
      await activateContract(s, id);
      return id;
    });
    const [row] = await em((s) =>
      s.query<Record<string, unknown>>(
        `SELECT service_frequency, fixed_team_packages::int[] AS equipes, payment_terms,
                billing_model::text AS billing_model
           FROM aurora.contracts WHERE id = $1`,
        [contratoHospital]
      )
    );
    expect(row).toEqual({
      service_frequency: 'monthly',
      equipes: [1, 10],
      payment_terms: 'upfront',
      billing_model: 'per_hour',
    });
  });

  it('o banco recusa modalidade, pagamento e equipe fora da lista', async () => {
    for (const sql of [
      `UPDATE aurora.contracts SET service_frequency = 'daily' WHERE id = $1`,
      `UPDATE aurora.contracts SET payment_terms = 'barter' WHERE id = $1`,
      `UPDATE aurora.contracts SET fixed_team_packages = '{11}' WHERE id = $1`,
      `UPDATE aurora.contracts SET fixed_team_packages = '{}' WHERE id = $1`,
    ]) {
      await expect(em((s) => s.query(sql, [contratoHospital]))).rejects.toThrow();
    }
    expect(() => normalizeFixedTeams([0])).toThrow(ValidationError);
    expect(normalizeFixedTeams([])).toBeNull();
  });
});

describe('SLA geral do contrato × exceção do equipamento', () => {
  it('sem exceção, o equipamento coberto segue o SLA GERAL do contrato', async () => {
    const sla = await slaDe(ventilador, hospital);
    expect(sla).toMatchObject({
      source: 'contract',
      policy_id: politicaGeral,
      policy_name: 'SLA geral do contrato',
      contract_id: contratoHospital,
    });
    expect(sla.contract_number).toMatch(/^CT-/);
  });

  it('a exceção configurada no equipamento vence o geral — só nele', async () => {
    await em((s) =>
      s.query(`UPDATE aurora.assets SET sla_policy_id = $1 WHERE id = $2`, [politicaExcecao, monitor])
    );
    expect(await slaDe(monitor, hospital)).toMatchObject({
      source: 'asset',
      policy_id: politicaExcecao,
      contract_id: contratoHospital,
    });
    expect((await slaDe(ventilador, hospital)).source).toBe('contract');
  });

  it('SLA desligado no equipamento: nenhuma política, nenhum relógio', async () => {
    await em((s) => s.query(`UPDATE aurora.assets SET sla_enabled = false WHERE id = $1`, [desfibrilador]));
    expect(await slaDe(desfibrilador, hospital)).toMatchObject({ source: 'disabled', policy_id: null });
    const os = await em((s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Sem SLA',
        assetId: desfibrilador,
      })
    );
    const [c] = await em((s) =>
      s.query<{ n: number }>(`SELECT count(*)::int AS n FROM aurora.sla_clocks WHERE document_id = $1`, [
        os.id,
      ])
    );
    expect(c!.n).toBe(0);
  });

  it('contrato sem SLA preenchido preserva a regra antiga (padrão da organização)', async () => {
    await em(async (s) => {
      await addCoverage(s, { contractId: contratoClinica, kind: 'customer' });
      await activateContract(s, contratoClinica);
    });
    expect(await slaDe(bomba, clinica)).toMatchObject({
      source: 'organization',
      policy_id: politicaPadrao,
      contract_id: contratoClinica,
    });
  });

  it('a OS recebe UM relógio por tipo, com a política efetiva — sem obrigação dobrada', async () => {
    const os = await em((s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Alarme',
        assetId: ventilador,
      })
    );
    const relogios = await em((s) =>
      s.query<{ kind: string; policy_id: string }>(
        `SELECT kind::text AS kind, policy_id FROM aurora.sla_clocks WHERE document_id = $1 ORDER BY kind`,
        [os.id]
      )
    );
    expect(relogios.map((r) => r.kind).sort()).toEqual(['onsite', 'resolution']);
    expect(new Set(relogios.map((r) => r.policy_id))).toEqual(new Set([politicaGeral]));
  });
});

describe('troca, vencimento e encerramento', () => {
  it('trocar o SLA geral vale para o que nasce depois; o relógio aberto guarda o seu', async () => {
    const antes = await em((s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Antes',
        assetId: ventilador,
      })
    );
    await em((s) =>
      updateContract(s, contratoHospital, { slaPolicyId: politicaNova, serviceFrequency: 'weekly' })
    );
    expect((await slaDe(ventilador, hospital)).policy_id).toBe(politicaNova);
    expect((await slaDe(monitor, hospital)).policy_id).toBe(politicaExcecao);
    const [velho] = await em((s) =>
      s.query<{ policy_id: string }>(
        `SELECT DISTINCT policy_id FROM aurora.sla_clocks WHERE document_id = $1`,
        [antes.id]
      )
    );
    expect(velho!.policy_id).toBe(politicaGeral);
  });

  it('o início só muda em rascunho', async () => {
    await expect(em((s) => updateContract(s, contratoHospital, { startsOn: dia(-40) }))).rejects.toThrow(
      /rascunho/
    );
  });

  it('contrato vencido pela data deixa de valer: volta a regra antiga', async () => {
    await em((s) => updateContract(s, contratoHospital, { endsOn: dia(-1) }));
    expect(await slaDe(ventilador, hospital)).toMatchObject({
      source: 'organization',
      policy_id: politicaPadrao,
      contract_id: null,
    });
    await em((s) => updateContract(s, contratoHospital, { endsOn: null }));
    expect((await slaDe(ventilador, hospital)).source).toBe('contract');
  });

  it('encerrado: a cascata cai na regra antiga e o contrato não se edita mais', async () => {
    await em((s) => terminateContract(s, contratoClinica, 'encerrado a pedido do cliente'));
    expect(await slaDe(bomba, clinica)).toMatchObject({ source: 'organization', contract_id: null });
    await expect(em((s) => updateContract(s, contratoClinica, { notes: 'x' }))).rejects.toThrow(/encerrado/);
  });
});

describe('isolamento entre organizações', () => {
  it('a outra organização não enxerga, não resolve SLA e não edita', async () => {
    const vistos = await withTenant(t.db, ctxB, (s) =>
      s.query(`SELECT id FROM aurora.contracts WHERE id = $1`, [contratoHospital])
    );
    expect(vistos).toHaveLength(0);
    expect(await withTenant(t.db, ctxB, (s) => effectiveSlaForAsset(s, ventilador))).toBeNull();
    await expect(
      withTenant(t.db, ctxB, (s) => updateContract(s, contratoHospital, { serviceFrequency: 'annual' }))
    ).rejects.toThrow(/não encontrado/);
  });
});
