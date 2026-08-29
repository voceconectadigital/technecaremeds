/**
 * Aurora — contratos contra o banco (SPEC v0.2 §17 · EPIC-017).
 *
 * O que esta suíte prova, na ordem em que importa:
 *
 *   1. a cobertura é expressão — o ativo que chegar amanhã entra sozinho;
 *   2. dois contratos não podem reivindicar o mesmo ativo na mesma data, e
 *      quando o conflito nasce depois a resolução é determinística;
 *   3. o degrau do contrato entrou na cascata de SLA sem desarrumar os outros;
 *   4. a medição sai dos fatos, e o período fechado não se recalcula.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { createSlaPolicy, setSlaTarget } from '../sla';
import {
  createContract,
  addCoverage,
  addService,
  setSlaOverride,
  activateContract,
  terminateContract,
  contractForAsset,
  coveredAssets,
  serviceCoverage,
  measurePeriod,
  saveMeasurement,
  closePeriod,
  sweepContractAlerts,
} from '../contracts';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'ct',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let hospital: string, clinica: string;
let uti: string, cc: string;
let catVentilador: string, catMonitor: string;
let ventilador: string, monitor: string;
let natCorretiva: string, natPreventiva: string;
let politicaPadrao: string, politicaContrato: string, politicaCritico: string;

const HOJE = new Date().toISOString().slice(0, 10);
const ANO = new Date().getUTCFullYear();
const COMPETENCIA = new Date().toISOString().slice(0, 7);

/** Uma data ISO deslocada em dias a partir de hoje. */
function dia(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'ct', name: 'Prestadora', email: 'a@ct.test', userName: 'A' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);

    hospital = await createCustomer(s, { name: 'Hospital Central' });
    clinica = await createCustomer(s, { name: 'Clínica Norte' });

    const unidade = await createLocation(s, {
      customerId: hospital,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    uti = await createLocation(s, {
      customerId: hospital,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    cc = await createLocation(s, {
      customerId: hospital,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Centro Cirúrgico',
    });

    catVentilador = await createAssetCategory(s, { name: 'Ventilador' });
    catMonitor = await createAssetCategory(s, { name: 'Monitor' });

    ventilador = await createAsset(s, {
      name: 'Ventilador UTI 01',
      customerId: hospital,
      assetCategoryId: catVentilador,
      locationId: uti,
    });
    monitor = await createAsset(s, {
      name: 'Monitor CC 01',
      customerId: hospital,
      assetCategoryId: catMonitor,
      locationId: cc,
    });

    natCorretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    natPreventiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });

    politicaPadrao = await createSlaPolicy(s, { name: 'Padrão da organização', isDefault: true });
    await setSlaTarget(s, politicaPadrao, 'none', 'resolution', 10_080, false);
    await setSlaTarget(s, politicaPadrao, 'none', 'onsite', 2_880, false);

    politicaContrato = await createSlaPolicy(s, { name: 'Contrato full service' });
    await setSlaTarget(s, politicaContrato, 'none', 'resolution', 480, false);
    await setSlaTarget(s, politicaContrato, 'none', 'onsite', 240, false);

    politicaCritico = await createSlaPolicy(s, { name: 'Criticidade alta' });
    await setSlaTarget(s, politicaCritico, 'none', 'resolution', 120, false);
    await setSlaTarget(s, politicaCritico, 'none', 'onsite', 60, false);

    await s.query(`UPDATE aurora.organizations SET default_sla_policy_id = $1 WHERE id = $2`, [
      politicaPadrao,
      ORG,
    ]);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('cobertura é expressão, não lista', () => {
  let contrato: string;

  it('cobre uma subárvore e alcança quem está nela', async () => {
    contrato = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: hospital,
        kind: 'full_service',
        startsOn: dia(-30),
        endsOn: dia(300),
        slaPolicyId: politicaContrato,
      });
      await addCoverage(s, { contractId: id, kind: 'location_subtree', locationId: uti });
      await activateContract(s, id);
      return id;
    });

    const cobertos = await withTenant(t.db, ctx, (s) => coveredAssets(s, contrato));
    expect(cobertos).toEqual([ventilador]);
  });

  it('o ativo que chega depois entra sozinho — é a razão de a cobertura ser expressão', async () => {
    const novo = await withTenant(t.db, ctx, (s) =>
      createAsset(s, {
        name: 'Ventilador UTI 02',
        customerId: hospital,
        assetCategoryId: catVentilador,
        locationId: uti,
      })
    );

    const cobertos = await withTenant(t.db, ctx, (s) => coveredAssets(s, contrato));
    expect(cobertos).toContain(novo);
    expect(cobertos).toHaveLength(2);
  });

  it('contrato sem cobertura não se ativa: diria "vigente" cobrindo nada', async () => {
    await expect(
      withTenant(t.db, ctx, async (s) => {
        const id = await createContract(s, {
          customerId: clinica,
          kind: 'on_demand',
          startsOn: HOJE,
        });
        await activateContract(s, id);
      })
    ).rejects.toThrow(/sem cobertura/);
  });

  it('a numeração é série própria e sequencial', async () => {
    const numeros = await withTenant(t.db, ctx, (s) =>
      s.query<{ number: string }>(`SELECT number FROM aurora.contracts ORDER BY created_at, number`)
    );
    expect(numeros[0]!.number).toBe(`CT-${ANO}-00001`);
    expect(numeros.every((n) => n.number.startsWith(`CT-${ANO}-`))).toBe(true);
  });
});

describe('um ativo, um contrato, numa dada data', () => {
  it('recusa a cobertura que colocaria o ativo em dois contratos, dizendo quais', async () => {
    await expect(
      withTenant(t.db, ctx, async (s) => {
        const id = await createContract(s, {
          customerId: hospital,
          kind: 'preventive_only',
          startsOn: dia(-10),
          endsOn: dia(100),
        });
        await addCoverage(s, { contractId: id, kind: 'asset_category', assetCategoryId: catVentilador });
      })
    ).rejects.toThrow(/dois contratos ao mesmo tempo.*Ventilador UTI/s);
  });

  it('a mesma cobertura é aceita quando as vigências não se tocam', async () => {
    const sucessor = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: hospital,
        kind: 'full_service',
        startsOn: dia(400),
        endsOn: dia(700),
      });
      await addCoverage(s, { contractId: id, kind: 'location_subtree', locationId: uti });
      return id;
    });
    expect(sucessor).toBeTruthy();
  });

  it('cobrir outro setor do mesmo cliente não conflita', async () => {
    const outro = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: hospital,
        kind: 'preventive_only',
        startsOn: dia(-5),
        endsOn: dia(200),
      });
      await addCoverage(s, { contractId: id, kind: 'location_subtree', locationId: cc });
      await activateContract(s, id);
      return id;
    });

    const doMonitor = await withTenant(t.db, ctx, (s) => contractForAsset(s, monitor, HOJE));
    expect(doMonitor).toBe(outro);
  });

  it('quando duas expressões alcançam o mesmo ativo, vence quem nomeia mais de perto', async () => {
    // Este é o conflito que a validação de escrita não pega: o contrato do
    // cliente inteiro já existia, e o ativo novo casa com os dois. Sem
    // desempate, a política de SLA dependeria da ordem de leitura do banco.
    const amplo = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'on_demand',
        startsOn: dia(-20),
        endsOn: dia(300),
      });
      await addCoverage(s, { contractId: id, kind: 'customer' });
      await activateContract(s, id);
      return id;
    });

    const ativoClinica = await withTenant(t.db, ctx, (s) =>
      createAsset(s, {
        name: 'Autoclave',
        customerId: clinica,
        assetCategoryId: catMonitor,
      })
    );
    expect(await withTenant(t.db, ctx, (s) => contractForAsset(s, ativoClinica, HOJE))).toBe(amplo);

    // Agora um contrato que nomeia o ativo. A validação de escrita recusaria —
    // então a disputa é criada como o mundo real a cria: pela expressão ampla
    // que passa a alcançar um ativo já nomeado por outro contrato.
    const especifico = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'rental',
        startsOn: dia(-1),
        endsOn: dia(90),
      });
      await s.query(
        `INSERT INTO aurora.contract_coverages
           (id, organization_id, contract_id, kind, asset_id, specificity)
         VALUES ($1, $2, $3, 'asset', $4, 1000)`,
        [newId(), ORG, id, ativoClinica]
      );
      await s.query(`UPDATE aurora.contracts SET status = 'active' WHERE id = $1`, [id]);
      return id;
    });

    expect(await withTenant(t.db, ctx, (s) => contractForAsset(s, ativoClinica, HOJE))).toBe(especifico);
  });

  it('fora da vigência, nenhum contrato responde', async () => {
    expect(await withTenant(t.db, ctx, (s) => contractForAsset(s, ventilador, dia(-90)))).toBeNull();
  });
});

describe('serviços incluídos', () => {
  let contrato: string;

  beforeAll(async () => {
    contrato = await withTenant(t.db, ctx, async (s) => {
      const [row] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.contracts WHERE customer_id = $1 AND status = 'active'
          ORDER BY starts_on LIMIT 1`,
        [hospital]
      );
      await addService(s, { contractId: row!.id, workOrderTypeId: natCorretiva });
      await addService(s, {
        contractId: row!.id,
        workOrderTypeId: natPreventiva,
        billedSeparately: true,
      });
      return row!.id;
    });
  });

  it('distingue coberto, coberto e faturado à parte, e fora do escopo', async () => {
    const fora = await withTenant(t.db, ctx, (s) =>
      createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'melhoria',
        label: 'Melhoria',
      })
    );

    await withTenant(t.db, ctx, async (s) => {
      expect(await serviceCoverage(s, contrato, natCorretiva)).toBe('included');
      expect(await serviceCoverage(s, contrato, natPreventiva)).toBe('billed_separately');
      expect(await serviceCoverage(s, contrato, fora)).toBe('out_of_scope');
    });
  });
});

describe('o degrau do contrato na cascata de SLA', () => {
  it('a política do contrato vence a do cliente e a da organização', async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [ventilador, hospital])
    );
    expect(row!.id).toBe(politicaContrato);
  });

  it('a política do ativo ainda vence a do contrato', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.assets SET sla_policy_id = $1 WHERE id = $2`, [politicaCritico, ventilador])
    );
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [ventilador, hospital])
    );
    expect(row!.id).toBe(politicaCritico);

    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.assets SET sla_policy_id = NULL WHERE id = $1`, [ventilador])
    );
  });

  it('a criticidade refina o contrato, dentro do mesmo degrau', async () => {
    const critico = await withTenant(t.db, ctx, async (s) => {
      const id = newId();
      await s.query(
        `INSERT INTO aurora.criticality_levels (id, organization_id, name, score, sla_multiplier)
         VALUES ($1, $2, 'Alta', 90, 1)`,
        [id, ORG]
      );
      await s.query(`UPDATE aurora.assets SET criticality_id = $1 WHERE id = $2`, [id, ventilador]);
      return id;
    });

    const contrato = await withTenant(t.db, ctx, (s) => contractForAsset(s, ventilador, HOJE));
    await withTenant(t.db, ctx, (s) =>
      setSlaOverride(s, {
        contractId: contrato!,
        criticalityLevelId: critico,
        slaPolicyId: politicaCritico,
      })
    );

    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [ventilador, hospital])
    );
    expect(row!.id).toBe(politicaCritico);
  });

  it('sem contrato cobrindo, a cascata continua caindo no padrão da organização', async () => {
    const solto = await withTenant(t.db, ctx, (s) =>
      createAsset(s, { name: 'Bomba sem contrato', customerId: hospital, assetCategoryId: catMonitor })
    );
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [solto, hospital])
    );
    expect(row!.id).toBe(politicaPadrao);
  });

  it('a OS nasce carimbada com o contrato — pelos três caminhos, porque é gatilho', async () => {
    const contrato = await withTenant(t.db, ctx, (s) => contractForAsset(s, ventilador, HOJE));
    const os = await withTenant(t.db, ctx, (s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Alarme intermitente',
        locationId: uti,
        assetId: ventilador,
      })
    );
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ contract_id: string | null }>(`SELECT contract_id FROM aurora.work_orders WHERE id = $1`, [
        os.id,
      ])
    );
    expect(row!.contract_id).toBe(contrato);
  });
});

describe('medição do período', () => {
  let contrato: string;

  beforeAll(async () => {
    contrato = (await withTenant(t.db, ctx, (s) => contractForAsset(s, ventilador, HOJE)))!;
    await withTenant(t.db, ctx, (s) =>
      s.query(
        `UPDATE aurora.contracts
            SET monthly_value = 10000, included_calls = 1, overage_call_rate = 250,
                sla_target_percent = 95, penalty_percent_per_breach = 1, penalty_cap_percent = 10
          WHERE id = $1`,
        [contrato]
      )
    );
  });

  it('conta as OS dos ativos cobertos, não as do cliente inteiro', async () => {
    await withTenant(t.db, ctx, (s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Monitor do CC — está em outro contrato',
        locationId: cc,
        assetId: monitor,
      })
    );

    const m = await withTenant(t.db, ctx, (s) => measurePeriod(s, contrato, COMPETENCIA));
    const cobertos = await withTenant(t.db, ctx, (s) => coveredAssets(s, contrato));
    expect(cobertos).not.toContain(monitor);
    expect(m.workOrders).toBeGreaterThanOrEqual(1);
  });

  it('cobra só o que passou da franquia', async () => {
    const m = await withTenant(t.db, ctx, (s) => measurePeriod(s, contrato, COMPETENCIA));
    expect(m.overageCalls).toBe(Math.max(m.workOrders - 1, 0));
    expect(m.overageAmount).toBe(Number((m.overageCalls * 250).toFixed(2)));
  });

  it('mês sem relógio encerrado não vira 100 % de SLA', async () => {
    const m = await withTenant(t.db, ctx, (s) => measurePeriod(s, contrato, COMPETENCIA));
    expect(m.slaRate).toBeNull();
    expect(m.penaltyAmount).toBe(0);
  });

  it('sem regra de glosa configurada, o valor é nulo — não zero', async () => {
    const semRegra = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'loan',
        startsOn: dia(-3),
        monthlyValue: 5000,
      });
      await s.query(
        `INSERT INTO aurora.contract_coverages (id, organization_id, contract_id, kind, specificity)
         VALUES ($1, $2, $3, 'customer', 100)`,
        [newId(), ORG, id]
      );
      return id;
    });

    const m = await withTenant(t.db, ctx, (s) => measurePeriod(s, semRegra, COMPETENCIA));
    expect(m.penaltyAmount).toBeNull();
  });

  it('a medição salva se recalcula enquanto o período está aberto', async () => {
    const antes = await withTenant(t.db, ctx, (s) => saveMeasurement(s, contrato, COMPETENCIA));

    await withTenant(t.db, ctx, (s) =>
      createWorkOrder(s, {
        customerId: hospital,
        workOrderTypeId: natCorretiva,
        title: 'Mais uma no mesmo mês',
        locationId: uti,
        assetId: ventilador,
      })
    );

    const depois = await withTenant(t.db, ctx, (s) => saveMeasurement(s, contrato, COMPETENCIA));
    expect(depois.workOrders).toBe(antes.workOrders + 1);

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ work_order_count: number }>(
        `SELECT work_order_count FROM aurora.contract_periods WHERE contract_id = $1 AND period = $2`,
        [contrato, COMPETENCIA]
      )
    );
    expect(Number(linha!.work_order_count)).toBe(depois.workOrders);
  });

  it('não se fecha um mês que ainda está acontecendo', async () => {
    await expect(withTenant(t.db, ctx, (s) => closePeriod(s, contrato, COMPETENCIA, HOJE))).rejects.toThrow(
      /só pode ser fechada depois/
    );
  });

  it('fechado, o período não se recalcula — é a fatura que o cliente recebeu', async () => {
    const passado = '2024-01';
    await withTenant(t.db, ctx, (s) => closePeriod(s, contrato, passado, '2024-02-05'));

    await expect(withTenant(t.db, ctx, (s) => saveMeasurement(s, contrato, passado))).rejects.toThrow(
      /já está fechado/
    );

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`DELETE FROM aurora.contract_periods WHERE contract_id = $1 AND period = $2`, [
          contrato,
          passado,
        ])
      )
    ).rejects.toThrow(/já está fechado/);
  });

  it('o fechamento emite evento com os números do mês', async () => {
    const [ev] = await withTenant(t.db, ctx, (s) =>
      s.query<{ payload: { period: string } }>(
        `SELECT payload FROM aurora.domain_events
          WHERE type = 'contract.period_closed' ORDER BY occurred_at DESC LIMIT 1`
      )
    );
    expect(ev!.payload.period).toBe('2024-01');
  });
});

describe('alertas', () => {
  it('avisa o vencimento no marco mais próximo e diz se a janela de aviso fechou', async () => {
    const vencendo = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'rental',
        startsOn: dia(-300),
        endsOn: dia(25),
        autoRenew: true,
        renewalNoticeDays: 60,
      });
      await s.query(
        `INSERT INTO aurora.contract_coverages (id, organization_id, contract_id, kind, specificity)
         VALUES ($1, $2, $3, 'customer', 100)`,
        [newId(), ORG, id]
      );
      await s.query(`UPDATE aurora.contracts SET status = 'active' WHERE id = $1`, [id]);
      return id;
    });

    const alertas = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    const meu = alertas.find((a) => a.contractId === vencendo && a.kind === 'renewal');
    expect(meu?.detail).toMatch(/vence em 25 dia/);
    expect(meu?.detail).toMatch(/aviso prévio já passou/);
  });

  it('a segunda varredura no mesmo marco não repete o aviso', async () => {
    const antes = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    const depois = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    expect(depois.filter((a) => a.kind === 'renewal')).toHaveLength(0);
    expect(antes.length).toBeGreaterThanOrEqual(depois.length);
  });

  it('renovar recomeça a contagem de avisos', async () => {
    const renovado = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'rental',
        startsOn: dia(-300),
        endsOn: dia(20),
      });
      await s.query(
        `INSERT INTO aurora.contract_coverages (id, organization_id, contract_id, kind, specificity)
         VALUES ($1, $2, $3, 'customer', 100)`,
        [newId(), ORG, id]
      );
      await s.query(`UPDATE aurora.contracts SET status = 'active' WHERE id = $1`, [id]);
      return id;
    });

    // Primeiro ciclo: avisa aos 30 e cala.
    const primeiro = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    expect(primeiro.find((x) => x.contractId === renovado && x.kind === 'renewal')).toBeTruthy();
    const segundo = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    expect(segundo.find((x) => x.contractId === renovado && x.kind === 'renewal')).toBeUndefined();

    // Renovado por mais um período: o marco antigo não pode calar a vigência nova.
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.contracts SET ends_on = $2 WHERE id = $1`, [renovado, dia(85)])
    );
    const terceiro = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    const aviso = terceiro.find((x) => x.contractId === renovado && x.kind === 'renewal');
    expect(aviso?.detail).toMatch(/vence em 85 dia/);
  });

  it('o contrato vencido é expirado pela varredura, com evento', async () => {
    const vencido = await withTenant(t.db, ctx, async (s) => {
      const id = await createContract(s, {
        customerId: clinica,
        kind: 'warranty',
        startsOn: dia(-400),
        endsOn: dia(-1),
      });
      await s.query(
        `INSERT INTO aurora.contract_coverages (id, organization_id, contract_id, kind, specificity)
         VALUES ($1, $2, $3, 'customer', 100)`,
        [newId(), ORG, id]
      );
      await s.query(`UPDATE aurora.contracts SET status = 'active' WHERE id = $1`, [id]);
      return id;
    });

    await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));

    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status: string }>(`SELECT status FROM aurora.contracts WHERE id = $1`, [vencido])
    );
    expect(row!.status).toBe('expired');

    const [ev] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.domain_events WHERE type = 'contract.expired' AND aggregate_id = $1`,
        [vencido]
      )
    );
    expect(ev).toBeTruthy();
  });

  it('alerta quando a franquia passa de 80 %', async () => {
    const contrato = (await withTenant(t.db, ctx, (s) => contractForAsset(s, ventilador, HOJE)))!;
    const alertas = await withTenant(t.db, ctx, (s) => sweepContractAlerts(s, HOJE, COMPETENCIA));
    const franquia = alertas.find((a) => a.contractId === contrato && a.kind === 'franchise');
    expect(franquia?.detail).toMatch(/franquia de chamados/);
  });
});

describe('encerramento', () => {
  it('exige justificativa', async () => {
    const contrato = (await withTenant(t.db, ctx, (s) => contractForAsset(s, monitor, HOJE)))!;
    await expect(withTenant(t.db, ctx, (s) => terminateContract(s, contrato, 'acabou'))).rejects.toThrow(
      /justificativa/
    );
  });

  it('encerrado, a vigência não se reescreve', async () => {
    const contrato = (await withTenant(t.db, ctx, (s) => contractForAsset(s, monitor, HOJE)))!;
    await withTenant(t.db, ctx, (s) =>
      terminateContract(s, contrato, 'rescisão amigável solicitada pelo cliente em reunião')
    );

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.contracts SET starts_on = $2 WHERE id = $1`, [contrato, dia(-1000)])
      )
    ).rejects.toThrow(/está encerrado/);
  });

  it('encerrado, deixa de responder pelo ativo', async () => {
    expect(await withTenant(t.db, ctx, (s) => contractForAsset(s, monitor, HOJE))).toBeNull();
  });
});

describe('isolamento', () => {
  it('outra organização não enxerga contrato nenhum', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'ct2', name: 'Outra', email: 'b@ct.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'ct2',
      permissions: PERMISSION_KEYS,
    });

    const linhas = await withTenant(t.db, ctx2, (s) => s.query(`SELECT id FROM aurora.contracts`));
    expect(linhas).toHaveLength(0);
  });
});
