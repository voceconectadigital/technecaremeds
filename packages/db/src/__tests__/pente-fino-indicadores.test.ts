/**
 * Aurora — pendências de indicadores do pente-fino de 17/10/2026 (banco).
 *
 *   · PF-50 — vínculo restrito a UM cliente, sem escolher cliente: a meta é a
 *     desse cliente (sem ela, a da organização);
 *   · PF-51 — dia da meta no fuso da organização (`organizations.timezone`);
 *   · PF-52 — relatório agendado do mês civil anterior;
 *   · PF-53 — filtro de categoria nas quatro consultas que o ignoravam;
 *   · PF-55 — metas resolvidas para o Painel;
 *   · PF-56 — e-mail de automação passa pelas preferências de notificação.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { createPlan, addPlanTask, generateCycle } from '../maintenance-plans';
import { provisionFactoryRoles, assignRole } from '../rbac';
import { membershipScope, parkSnapshot, openWorkOrdersSnapshot, workOrderSeries } from '../painel';
import { planBoard } from '../plan-board';
import { createIndicatorTarget, organizationTimezone } from '../indicator-targets';
import { buildReport, panelTargets, targetReferenceDay } from '../relatorios';
import { createRule, runScheduledRuleNow } from '../automations';
import { pendingDeliveries } from '../notifications';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const MEM_A = newId(),
  MEM_B = newId(),
  MEM_AB = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'pf-ind',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let clienteA: string, clienteB: string;
let catVent: string, catMon: string;
let ventA: string, monA: string;

const PERIODO = { from: new Date('2026-01-01T03:00:00Z'), to: new Date('2027-01-31T03:00:00Z') };
const sessao = <T>(fn: (s: TenantSession) => Promise<T>): Promise<T> => withTenant(t.db, ctx, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pf-ind', name: 'Prestadora', email: 'gestora@pf-ind.test', userName: 'Gestora' }
  );
  await sessao(async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, MEM, papeis.get('admin')!);
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    clienteA = await createCustomer(s, { name: 'Hospital A' });
    clienteB = await createCustomer(s, { name: 'Hospital B' });
    const sede = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede A',
    });
    const uti = await createLocation(s, {
      customerId: clienteA,
      parentId: sede,
      locationTypeId: lt.get('setor')!,
      name: 'UTI',
    });
    catVent = await createAssetCategory(s, { name: 'Ventilador' });
    catMon = await createAssetCategory(s, { name: 'Monitor' });
    ventA = await createAsset(s, {
      name: 'Ventilador A',
      customerId: clienteA,
      assetCategoryId: catVent,
      locationId: uti,
    });
    monA = await createAsset(s, {
      name: 'Monitor A',
      customerId: clienteA,
      assetCategoryId: catMon,
      locationId: uti,
    });
    const corretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    const preventiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    // Duas OS no ventilador, uma no monitor — todas abertas.
    for (const ativo of [ventA, ventA, monA]) {
      await createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: corretiva,
        assetId: ativo,
        title: 'Falha',
      });
    }
    const plano = await createPlan(s, {
      name: 'Preventiva UTI',
      customerId: clienteA,
      autoGenerate: false,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    });
    const tarefa = await addPlanTask(s, {
      planId: plano,
      name: 'Inspeção',
      targetKind: 'location_subtree',
      targetLocationId: uti,
      workOrderTypeId: preventiva,
      frequencyUnit: 'quarter',
      leadTimeDays: 3650,
      toleranceDays: 5,
    });
    await generateCycle(s, tarefa);

    // Metas do SLA: organização 90; Hospital A 95. Hospital B não tem.
    const tudo = { customerIds: null, locationPaths: null };
    for (const [customerId, value] of [
      [null, 90],
      [clienteA, 95],
    ] as const) {
      await createIndicatorTarget(s, tudo, {
        indicatorKey: 'sla_compliance',
        customerId,
        validFrom: '2020-01-01',
        value,
        direction: 'HIGHER_IS_BETTER',
      });
    }
  });
  for (const [mem, clientes, email] of [
    [MEM_A, [clienteA], 'a@pf-ind.test'],
    [MEM_B, [clienteB], 'b@pf-ind.test'],
    [MEM_AB, [clienteA, clienteB], 'ab@pf-ind.test'],
  ] as const) {
    await seedMember(
      t,
      { organizationId: ORG, userId: newId(), membershipId: mem },
      {
        email,
        userName: email,
        customerIds: clientes,
      }
    );
  }
  await sessao(async (s) => {
    const papeis = await provisionFactoryRoles(s);
    for (const m of [MEM_A, MEM_B, MEM_AB]) await assignRole(s, m, papeis.get('manager')!);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('PF-53 — categoria do equipamento nas quatro consultas', () => {
  it('parque, OS em aberto, evolução e quadro de planos recortam pela categoria', async () => {
    await sessao(async (s) => {
      const tudo = await membershipScope(s, null);
      const vent = { assetCategoryId: catVent };
      expect((await parkSnapshot(s, {})).total).toBe(2);
      expect((await parkSnapshot(s, vent)).total).toBe(1);
      expect((await parkSnapshot(s, { assetCategoryId: catMon })).byStatus).toEqual({ active: 1 });

      const soma = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
      expect(soma((await openWorkOrdersSnapshot(s, {})).byStatus)).toBe(3);
      expect(soma((await openWorkOrdersSnapshot(s, vent)).byStatus)).toBe(2);

      const p = { from: new Date(Date.now() - 2 * 86_400_000), to: new Date(Date.now() + 86_400_000) };
      const abertas = async (f: object) =>
        (await workOrderSeries(s, p, 'day', f)).reduce((a, x) => a + x.opened, 0);
      expect(await abertas({})).toBe(3);
      expect(await abertas(vent)).toBe(2);
      expect(await abertas({ assetCategoryId: catMon })).toBe(1);

      const quadro = await planBoard(s, { from: PERIODO.from, to: PERIODO.to }, tudo);
      const soVent = await planBoard(s, { ...PERIODO, assetCategoryId: catVent }, tudo);
      const [porAtivo] = await s.query<{ vent: string }>(
        `SELECT count(*) FILTER (WHERE asset_id = $1)::text AS vent FROM aurora.plan_cycle_items`,
        [ventA]
      );
      expect(quadro.totals.scheduled).toBeGreaterThan(soVent.totals.scheduled);
      expect(soVent.totals.scheduled).toBe(Number(porAtivo!.vent));
    });
  });

  it('o relatório passa a categoria ao quadro (conformidades)', async () => {
    const r = await sessao((s) =>
      buildReport(s, MEM, {
        tier: 'basic',
        indicators: ['compliance_preventive', 'park_availability_snapshot'],
        from: PERIODO.from.toISOString(),
        to: new Date('2027-01-30T03:00:00Z').toISOString(),
        asset_category_id: catVent,
      })
    );
    const parque = r.sections.find((x) => x.key === 'park_availability_snapshot')!;
    expect(parque.samples).toBe(1);
    const prev = r.sections.find((x) => x.key === 'compliance_preventive')!;
    const [n] = await sessao((s) =>
      s.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM aurora.plan_cycle_items WHERE asset_id = $1`,
        [ventA]
      )
    );
    expect(prev.samples).toBe(Number(n!.total));
  });
});

describe('PF-50 — meta do vínculo restrito a um cliente', () => {
  const sla = async (mem: string, extra: Record<string, string> = {}) => {
    const r = await sessao((s) =>
      buildReport(s, mem, {
        tier: 'advanced',
        indicators: ['sla_compliance'],
        from: '2026-09-01T03:00:00.000Z',
        to: '2026-10-01T03:00:00.000Z',
        ...extra,
      })
    );
    return r.sections[0]!.target;
  };

  it('restrito só ao A, sem escolher cliente → meta de A', async () => {
    expect(await sla(MEM_A)).toMatchObject({ scope: 'customer', value: 95 });
  });

  it('restrito só ao B (sem meta própria) → cai na da organização', async () => {
    expect(await sla(MEM_B)).toMatchObject({ scope: 'organization', value: 90 });
  });

  it('restrito a A e B, ou sem restrição → organização; escolhendo A → A', async () => {
    expect(await sla(MEM_AB)).toMatchObject({ scope: 'organization', value: 90 });
    expect(await sla(MEM)).toMatchObject({ scope: 'organization', value: 90 });
    expect(await sla(MEM, { customer_id: clienteA })).toMatchObject({ scope: 'customer', value: 95 });
  });

  it('o Painel resolve as mesmas metas (PF-55); sem meta → nulo', async () => {
    const r = await sessao(async (s) =>
      panelTargets(s, await membershipScope(s, MEM_A), { customerId: null, to: new Date() })
    );
    expect(r.items.sla_compliance).toMatchObject({ scope: 'customer', value: 95 });
    expect(r.items.park_availability_snapshot).toBeNull();
    const geral = await sessao(async (s) =>
      panelTargets(s, await membershipScope(s, MEM), { customerId: null, to: new Date() })
    );
    expect(geral.items.sla_compliance).toMatchObject({ scope: 'organization', value: 90 });
  });
});

describe('PF-51 — dia da meta no fuso da organização', () => {
  it('31/10 21h30 em Brasília é 31/10; em UTC seria 01/11', () => {
    const fim = new Date('2026-11-01T02:59:59.999Z');
    const agora = new Date('2026-11-01T00:30:00Z');
    expect(targetReferenceDay(fim, agora)).toBe('2026-10-31');
    expect(targetReferenceDay(fim, agora, 'UTC')).toBe('2026-11-01');
  });

  it('o fuso é o da organização; inválido cai no padrão; o relatório o registra', async () => {
    await sessao(async (s) => {
      expect(await organizationTimezone(s)).toBe('America/Sao_Paulo');
      await s.query(`UPDATE aurora.organizations SET timezone = 'Asia/Tokyo' WHERE id = $1`, [ORG]);
      expect(await organizationTimezone(s)).toBe('Asia/Tokyo');
      const r = await buildReport(
        s,
        MEM,
        {
          tier: 'advanced',
          indicators: ['sla_compliance'],
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T16:00:00.000Z',
        },
        new Date('2026-12-01T00:00:00Z')
      );
      // 31/10 15:59:59 UTC = 01/11 00:59 em Tóquio
      expect(r.filters.target_day).toBe('2026-11-01');
      expect(r.filters.timezone).toBe('Asia/Tokyo');
      await s.query(`UPDATE aurora.organizations SET timezone = 'Lua/Mar' WHERE id = $1`, [ORG]);
      expect(await organizationTimezone(s)).toBe('America/Sao_Paulo');
      await s.query(`UPDATE aurora.organizations SET timezone = 'America/Sao_Paulo' WHERE id = $1`, [ORG]);
    });
  });
});

describe('PF-52 e PF-56 — relatório agendado do mês anterior; e-mail pelas preferências', () => {
  let regra: string;

  it('a passada de 01/11 08:00 gera outubro inteiro e a meta de 31/10', async () => {
    regra = await sessao((s) =>
      createRule(s, {
        name: 'Mensal',
        triggerKind: 'schedule',
        triggerCron: '0 8 1 * *',
        triggerTimezone: 'America/Sao_Paulo',
        actions: [
          {
            kind: 'send_report',
            params: { recipients: [MEM, MEM_A], tier: 'advanced', periodo: 'mes_anterior' },
          },
        ],
      })
    );
    // MEM com e-mail verificado; MEM_A não.
    await t.raw(`UPDATE aurora.users SET email_verified_at = now() WHERE id = $1`, [USER]);
    const r = await sessao((s) => runScheduledRuleNow(s, regra, new Date('2026-11-01T11:00:00Z')));
    expect(r?.outcome, JSON.stringify(r)).toBe('matched');
    expect(String(r!.actionsRun[0]!.detail)).toMatch(/1 e-mail\(s\) suprimido/);

    const saidas = await sessao((s) =>
      s.query<{ recipient_membership_id: string; filters: Record<string, string>; email_state: string }>(
        `SELECT recipient_membership_id, filters, email_state FROM aurora.automation_report_outputs
          WHERE rule_id = $1`,
        [regra]
      )
    );
    expect(saidas).toHaveLength(2);
    for (const o of saidas) {
      expect(o.filters.from).toBe('2026-10-01T03:00:00.000Z');
      expect(o.filters.to).toBe('2026-11-01T02:59:59.999Z');
      expect(o.filters.target_day).toBe('2026-10-31');
    }
    const estado = (m: string) => saidas.find((x) => x.recipient_membership_id === m)!.email_state;
    expect(estado(MEM)).toBe('queued_no_transport');
    expect(estado(MEM_A)).toBe('suppressed');
  });

  it('suprimido tem motivo; a caixa de entrada recebe mesmo assim', async () => {
    const entregas = await sessao((s) =>
      s.query<{ membership_id: string; channel: string; state: string; reason: string | null }>(
        `SELECT n.membership_id, d.channel::text AS channel, d.state::text AS state, d.reason
           FROM aurora.notification_deliveries d JOIN aurora.notifications n ON n.id = d.notification_id
          WHERE n.type_key = 'automation.scheduled_report'`
      )
    );
    const de = (m: string, c: string) => entregas.find((e) => e.membership_id === m && e.channel === c);
    expect(de(MEM, 'email')).toMatchObject({ state: 'pending', reason: 'awaiting_email_transport' });
    expect(de(MEM_A, 'email')).toMatchObject({ state: 'suppressed', reason: 'unverified_email' });
    expect(de(MEM_A, 'in_app')).toMatchObject({ state: 'sent' });
  });

  it('canal de e-mail desligado pela pessoa → suprimido (channel_disabled)', async () => {
    await sessao((s) =>
      s.query(
        `INSERT INTO aurora.notification_preferences
           (organization_id, membership_id, type_key, channel, enabled, digest)
         VALUES ($1, $2, 'automation.scheduled_report', 'email', false, 'immediate')`,
        [ORG, MEM]
      )
    );
    await sessao((s) => runScheduledRuleNow(s, regra, new Date('2026-12-01T11:00:00Z')));
    const [d] = await sessao((s) =>
      s.query<{ state: string; reason: string }>(
        `SELECT d.state::text AS state, d.reason
           FROM aurora.notification_deliveries d JOIN aurora.notifications n ON n.id = d.notification_id
          WHERE n.membership_id = $1 AND d.channel = 'email' AND n.type_key = 'automation.scheduled_report'
          ORDER BY d.created_at DESC LIMIT 1`,
        [MEM]
      )
    );
    expect(d).toMatchObject({ state: 'suppressed', reason: 'channel_disabled' });
  });

  it('a fila de saída não entrega a quem teve o e-mail bloqueado depois', async () => {
    const antes = await sessao((s) => pendingDeliveries(s, 'email'));
    expect(antes.some((x) => x.membership_id === MEM)).toBe(true);
    await t.raw(
      `UPDATE aurora.users SET email_blocked_at = now(), email_blocked_reason = 'bounce' WHERE id = $1`,
      [USER]
    );
    const depois = await sessao((s) => pendingDeliveries(s, 'email'));
    expect(depois.some((x) => x.membership_id === MEM)).toBe(false);
  });
});
