/**
 * Aurora — automações contra o banco (SPEC v0.2 §24 · EPIC-024).
 *
 * As salvaguardas são o produto, e são elas que esta suíte prova: simulação
 * obrigatória antes de ativar, quarentena com motivo escrito, ausência de
 * recursão, e log que impede a caixa-preta.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionFactoryRoles, assignRole } from '../rbac';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { markEmailVerified } from '../notifications';
import {
  createRule,
  simulateRule,
  activateRule,
  pauseRule,
  runAutomations,
  ruleRuns,
  listRules,
} from '../automations';
import { emitEvent } from '../outbox';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const TEC_USER = newId(),
  TEC_MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'auto',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, local: string, ativo: string, natureza: string;
let os: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'auto', name: 'Prestadora', email: 'coord@auto.test', userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: 'tec@auto.test', userName: 'Técnico' }
  );

  await withTenant(t.db, ctx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, MEM, papeis.get('coordinator')!);
    await assignRole(s, TEC_MEM, papeis.get('technician')!);

    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    local = await createLocation(s, {
      customerId: cliente,
      locationTypeId: lt.get('unidade')!,
      name: 'Sede',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: local,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Reparo',
      locationId: local,
      assetId: ativo,
      assigneeMembershipId: TEC_MEM,
    });
    os = w.id;

    await markEmailVerified(s, TEC_USER);
    await markEmailVerified(s, USER);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

function evento(over: Record<string, unknown> = {}) {
  return {
    type: 'sla.breached',
    aggregateType: 'work_order',
    aggregateId: os,
    payload: { number: 'WO-2025-00001', priority: 'emergency' },
    ...over,
  };
}

/* -------------------------------------------------------------------------- */

describe('cadastro', () => {
  it('a regra nasce em rascunho — ativar sem simular seria a exigência decorativa', async () => {
    const id = await withTenant(t.db, ctx, (s) =>
      createRule(s, {
        name: 'Comentar quando o SLA estourar',
        triggerEvent: 'sla.breached',
        actions: [{ kind: 'add_comment', params: { text: 'SLA estourado — priorizar' } }],
      })
    );

    const [r] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string }>(`SELECT state FROM aurora.automation_rules WHERE id = $1`, [id])
    );
    expect(r!.state).toBe('draft');
  });

  it('regra sem ação é recusada', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        createRule(s, { name: 'Vazia', triggerEvent: 'sla.breached', actions: [] })
      )
    ).rejects.toThrow(/ao menos uma ação/);
  });

  it('ação desconhecida é recusada listando as disponíveis', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        createRule(s, {
          name: 'Foguete',
          triggerEvent: 'sla.breached',
          actions: [{ kind: 'lancar_foguete' as never, params: {} }],
        })
      )
    ).rejects.toThrow(/disponíveis: notify/);
  });

  it('condição torta é recusada com o caminho exato', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        createRule(s, {
          name: 'Condição torta',
          triggerEvent: 'sla.breached',
          conditions: { all: [{ field: 'x', op: 'in', value: 'nao_e_lista' } as never] },
          actions: [{ kind: 'add_comment', params: { text: 'oi' } }],
        })
      )
    ).rejects.toThrow(/conditions\.all\[0\].*exige uma lista/s);
  });

  it('gatilho de evento sem tipo de evento é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        createRule(s, {
          name: 'Sem gatilho',
          actions: [{ kind: 'add_comment', params: { text: 'oi' } }],
        })
      )
    ).rejects.toThrow(/exige o tipo de evento/);
  });
});

describe('simulação obrigatória', () => {
  let regra: string;

  beforeAll(async () => {
    regra = await withTenant(t.db, ctx, (s) =>
      createRule(s, {
        name: 'Emergência estourada',
        triggerEvent: 'sla.breached',
        conditions: { all: [{ field: 'priority', op: 'eq', value: 'emergency' }] },
        actions: [{ kind: 'add_comment', params: { text: 'Emergência com SLA estourado' } }],
      })
    );
  });

  it('ativar sem simular é recusado', async () => {
    await expect(withTenant(t.db, ctx, (s) => activateRule(s, regra))).rejects.toThrow(
      /simule a regra antes de ativar/
    );
  });

  it('a simulação não executa ação nenhuma, e devolve a frase', async () => {
    await withTenant(t.db, ctx, async (s) => {
      for (let i = 0; i < 3; i++) {
        await emitEvent(s, {
          type: 'sla.breached',
          aggregateId: os,
          payload: { priority: 'emergency' },
        });
      }
      await emitEvent(s, { type: 'sla.breached', aggregateId: os, payload: { priority: 'low' } });
    });

    const r = await withTenant(t.db, ctx, (s) => simulateRule(s, regra));
    expect(r.matched).toBe(3);
    expect(r.evaluated).toBe(4);
    expect(r.summary).toMatch(/teria disparado 3 vez\(es\)/);

    // Nenhum comentário foi criado: simular é olhar, não agir.
    const [c] = await withTenant(t.db, ctx, (s) =>
      s.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM aurora.work_order_comments WHERE work_order_id = $1`,
        [os]
      )
    );
    expect(Number(c!.total)).toBe(0);
  });

  it('depois de simular, ativa', async () => {
    await withTenant(t.db, ctx, (s) => activateRule(s, regra));
    const [r] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string }>(`SELECT state FROM aurora.automation_rules WHERE id = $1`, [regra])
    );
    expect(r!.state).toBe('active');
  });

  it('a regra ativa executa a ação e registra a corrida', async () => {
    const execucoes = await withTenant(t.db, ctx, (s) => runAutomations(s, evento()));
    const minha = execucoes.find((e) => e.ruleId === regra)!;
    expect(minha.outcome).toBe('matched');
    expect(minha.actionsRun[0]!.ok).toBe(true);

    const [c] = await withTenant(t.db, ctx, (s) =>
      s.query<{ body: string }>(`SELECT body FROM aurora.work_order_comments WHERE work_order_id = $1`, [os])
    );
    expect(c!.body).toMatch(/Emergência com SLA estourado/);

    const corridas = (await withTenant(t.db, ctx, (s) => ruleRuns(s, regra))) as {
      outcome: string;
      duration_ms: number;
    }[];
    expect(corridas[0]!.outcome).toBe('matched');
    expect(corridas[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('condição que não casa registra a corrida como pulada — não some', async () => {
    await withTenant(t.db, ctx, (s) => runAutomations(s, evento({ payload: { priority: 'low' } })));

    const corridas = (await withTenant(t.db, ctx, (s) => ruleRuns(s, regra))) as {
      outcome: string;
    }[];
    expect(corridas[0]!.outcome).toBe('skipped_conditions');
  });
});

describe('sem recursão', () => {
  it('a regra não reage ao evento que ela mesma causou', async () => {
    const [regra] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.automation_rules WHERE state = 'active' LIMIT 1`)
    );

    const execucoes = await withTenant(t.db, ctx, (s) =>
      runAutomations(s, { ...evento(), causedByRuleId: regra!.id, causationDepth: 1 })
    );
    expect(execucoes.find((e) => e.ruleId === regra!.id)!.outcome).toBe('skipped_recursion');
  });

  it('cadeia funda demais é cortada', async () => {
    const execucoes = await withTenant(t.db, ctx, (s) =>
      runAutomations(s, { ...evento(), causationDepth: 3 })
    );
    expect(execucoes.every((e) => e.outcome === 'skipped_recursion')).toBe(true);
  });
});

describe('limite e quarentena', () => {
  it('a regra que estoura o limite entra em quarentena com o motivo escrito', async () => {
    const regra = await withTenant(t.db, ctx, async (s) => {
      const id = await createRule(s, {
        name: 'Regra apressada',
        triggerEvent: 'work_order.commented',
        rateMax: 2,
        rateWindowMinutes: 60,
        actions: [{ kind: 'add_comment', params: { text: 'eco' } }],
      });
      await simulateRule(s, id);
      await activateRule(s, id);
      return id;
    });

    const ev = { ...evento(), type: 'work_order.commented' };
    for (let i = 0; i < 3; i++) {
      await withTenant(t.db, ctx, (s) => runAutomations(s, ev));
    }

    const [r] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string; quarantine_reason: string | null }>(
        `SELECT state, quarantine_reason FROM aurora.automation_rules WHERE id = $1`,
        [regra]
      )
    );
    expect(r!.state).toBe('quarantined');
    expect(r!.quarantine_reason).toMatch(/acima do limite de 2/);

    // Em quarentena, para de rodar — e a corrida barrada ficou registrada.
    const execucoes = await withTenant(t.db, ctx, (s) => runAutomations(s, ev));
    expect(execucoes.find((e) => e.ruleId === regra)).toBeUndefined();

    const corridas = (await withTenant(t.db, ctx, (s) => ruleRuns(s, regra))) as {
      outcome: string;
    }[];
    expect(corridas[0]!.outcome).toBe('skipped_rate_limit');
  });

  it('reativar tira da quarentena', async () => {
    const [r] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.automation_rules WHERE state = 'quarantined' LIMIT 1`)
    );
    await withTenant(t.db, ctx, (s) => activateRule(s, r!.id));

    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string; quarantine_reason: string | null }>(
        `SELECT state, quarantine_reason FROM aurora.automation_rules WHERE id = $1`,
        [r!.id]
      )
    );
    expect(depois!.state).toBe('active');
    expect(depois!.quarantine_reason).toBeNull();

    await withTenant(t.db, ctx, (s) => pauseRule(s, r!.id));
  });
});

describe('permissão', () => {
  it('a automação não faz o que o ator não pode fazer', async () => {
    const semPoder = buildContext({
      organizationId: ORG,
      actorId: USER,
      membershipId: MEM,
      requestId: 'fraco',
      // Só leitura: a regra pede `work_order.update`, que não está aqui.
      permissions: ['work_order.read'],
    });

    const regra = await withTenant(t.db, ctx, async (s) => {
      const id = await createRule(s, {
        name: 'Comentar sob ator fraco',
        triggerEvent: 'work_order.validated',
        actions: [{ kind: 'add_comment', params: { text: 'não deveria sair' } }],
      });
      await simulateRule(s, id);
      await activateRule(s, id);
      return id;
    });

    const execucoes = await withTenant(t.db, semPoder, (s) =>
      runAutomations(s, { ...evento(), type: 'work_order.validated' })
    );
    const minha = execucoes.find((e) => e.ruleId === regra)!;
    expect(minha.outcome).toBe('failed');
    expect(minha.error).toMatch(/não tem a permissão work_order\.update/);
  });
});

describe('ordem e listagem', () => {
  it('as regras rodam na ordem da prioridade declarada', async () => {
    const ids = await withTenant(t.db, ctx, async (s) => {
      const segunda = await createRule(s, {
        name: 'Segunda a rodar',
        triggerEvent: 'work_order.reopened',
        priority: 200,
        actions: [{ kind: 'add_comment', params: { text: 'segunda' } }],
      });
      const primeira = await createRule(s, {
        name: 'Primeira a rodar',
        triggerEvent: 'work_order.reopened',
        priority: 10,
        actions: [{ kind: 'add_comment', params: { text: 'primeira' } }],
      });
      for (const id of [segunda, primeira]) {
        await simulateRule(s, id);
        await activateRule(s, id);
      }
      return { primeira, segunda };
    });

    const execucoes = await withTenant(t.db, ctx, (s) =>
      runAutomations(s, { ...evento(), type: 'work_order.reopened' })
    );
    expect(execucoes.map((e) => e.ruleId)).toEqual([ids.primeira, ids.segunda]);
  });

  it('a listagem mostra estado, simulação e quantidade de ações', async () => {
    const regras = (await withTenant(t.db, ctx, (s) => listRules(s))) as {
      name: string;
      state: string;
      action_count: string;
    }[];
    expect(regras.length).toBeGreaterThan(3);
    expect(regras.every((r) => Number(r.action_count) >= 1)).toBe(true);
  });
});

describe('isolamento', () => {
  it('outra organização não enxerga regra nenhuma', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'auto2', name: 'Outra', email: 'b@auto.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'auto2',
      permissions: PERMISSION_KEYS,
    });

    expect(await withTenant(t.db, ctx2, (s) => listRules(s))).toHaveLength(0);
  });
});

describe('aviso imediato: OS aguardando peça (reunião de 16/10/2026)', () => {
  let regraPeca: string;

  it('a OS que passa a aguardar peça emite o evento COM o motivo de espera', async () => {
    const { transitionWorkOrder } = await import('../work-orders');
    const motivo = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.wait_reasons WHERE key = 'parts'`)
    );
    expect(motivo).toHaveLength(1);

    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os, 'in_progress');
      await transitionWorkOrder(s, os, 'waiting', { waitReasonId: motivo[0]!.id });
    });

    const [ev] = await withTenant(t.db, ctx, (s) =>
      s.query<{ payload: { to: string; wait_reason_key?: string; number: string } }>(
        `SELECT payload FROM aurora.domain_events
          WHERE aggregate_id = $1 AND type = 'work_order.blocked'
          ORDER BY occurred_at DESC LIMIT 1`,
        [os]
      )
    );
    expect(ev!.payload.to).toBe('waiting');
    expect(ev!.payload.wait_reason_key).toBe('parts');
  });

  it('o lembrete por evento avisa quem foi escolhido, com o número da OS, e só para peça', async () => {
    regraPeca = await withTenant(t.db, ctx, (s) =>
      createRule(s, {
        name: 'Aviso ao compras',
        triggerKind: 'event',
        triggerEvent: 'work_order.blocked',
        conditions: { field: 'wait_reason_key', op: 'eq', value: 'parts' },
        actions: [
          { kind: 'reminder', params: { recipients: [TEC_MEM], title: 'OS {{number}} aguardando peça' } },
        ],
      })
    );
    await withTenant(t.db, ctx, (s) => simulateRule(s, regraPeca));
    await withTenant(t.db, ctx, (s) => activateRule(s, regraPeca));

    const deOutroMotivo = await withTenant(t.db, ctx, (s) =>
      runAutomations(s, {
        id: newId(),
        type: 'work_order.blocked',
        aggregateType: 'work_order',
        aggregateId: os,
        payload: { number: 'WO-9', from: 'in_progress', to: 'waiting', wait_reason_key: 'customer' },
      })
    );
    expect(deOutroMotivo.find((e) => e.ruleId === regraPeca)!.outcome).toBe('skipped_conditions');

    const dePeca = await withTenant(t.db, ctx, (s) =>
      runAutomations(s, {
        id: newId(),
        type: 'work_order.blocked',
        aggregateType: 'work_order',
        aggregateId: os,
        payload: { number: 'WO-9', from: 'in_progress', to: 'waiting', wait_reason_key: 'parts' },
      })
    );
    const minha = dePeca.find((e) => e.ruleId === regraPeca)!;
    expect(minha.outcome).toBe('matched');
    expect(minha.actionsRun[0]!.ok).toBe(true);

    const avisos = await withTenant(t.db, ctx, (s) =>
      s.query<{ title: string }>(
        `SELECT title FROM aurora.notifications
          WHERE membership_id = $1 AND type_key = 'automation.reminder'`,
        [TEC_MEM]
      )
    );
    expect(avisos.map((a) => a.title)).toContain('OS WO-9 aguardando peça');
  });
});
