/**
 * Aurora — roteador de notificações contra o banco (SPEC v0.2 §23 · EPIC-019).
 *
 * O que esta suíte prova é o combate ao excesso: duplicata silenciada, silêncio
 * respeitado no fuso do destinatário, e-mail não verificado suprimido — e o
 * aviso que fura o silêncio porque exige ação agora.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionFactoryRoles, assignRole } from '../rbac';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import {
  routeEvent,
  inbox,
  unreadCount,
  markRead,
  markAllRead,
  setPreference,
  setQuietHours,
  markEmailVerified,
  blockEmail,
  pendingDeliveries,
  markDeliverySent,
} from '../notifications';
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
  requestId: 'notif',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, local: string, ativo: string, natureza: string;
let os: string;

const MEIO_DIA = new Date('2025-03-12T15:00:00Z'); // 12 h em São Paulo
const MADRUGADA = new Date('2025-03-12T06:00:00Z'); // 3 h em São Paulo

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'notif', name: 'Prestadora', email: 'coord@notif.test', userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: 'joao.silva@notif.test', userName: 'João Silva' }
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
      title: 'Reparo do ventilador',
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

function evento(type: string, payload: Record<string, unknown> = {}) {
  return { type, aggregateType: 'work_order', aggregateId: os, payload };
}

/* -------------------------------------------------------------------------- */

describe('roteamento', () => {
  it('evento sem tipo de notificação não gera nada', async () => {
    const r = await withTenant(t.db, ctx, (s) => routeEvent(s, evento('work_order.opened')));
    expect(r).toEqual([]);
  });

  it('a OS reagendada avisa o executor, no aplicativo e por e-mail', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(s, evento('work_order.rescheduled', { number: 'WO-2025-00001' }), MEIO_DIA)
    );

    const paraTecnico = r.find((x) => x.membershipId === TEC_MEM);
    expect(paraTecnico).toBeDefined();
    expect(paraTecnico!.deliveries.map((d) => d.channel).sort()).toEqual(['email', 'in_app']);
    expect(paraTecnico!.deliveries.every((d) => d.state === 'pending')).toBe(true);
  });

  it('a caixa de entrada mostra o aviso, com o caminho de volta', async () => {
    const itens = await withTenant(t.db, ctx, (s) => inbox(s, TEC_MEM));
    expect(itens).toHaveLength(1);
    expect(itens[0]!.title).toBe('OS reagendada');
    expect(itens[0]!.body).toBe('Referência WO-2025-00001');
    expect(itens[0]!.link).toContain(os);
  });

  it('o segundo aviso igual dentro da janela é silenciado', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(s, evento('work_order.rescheduled', { number: 'WO-2025-00001' }), MEIO_DIA)
    );
    expect(r.find((x) => x.membershipId === TEC_MEM)).toBeUndefined();
    expect(await withTenant(t.db, ctx, (s) => inbox(s, TEC_MEM))).toHaveLength(1);
  });

  it('passada a janela, o aviso volta a sair', async () => {
    const depois = new Date(MEIO_DIA.getTime() + 61 * 60_000);
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(s, evento('work_order.rescheduled', { number: 'WO-2025-00001' }), depois)
    );
    expect(r.find((x) => x.membershipId === TEC_MEM)).toBeDefined();
  });

  it('o SLA violado alcança executor, coordenação e gestão', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(s, evento('sla.breached', { number: 'WO-2025-00001' }), MEIO_DIA)
    );
    const destinos = new Set(r.map((x) => x.membershipId));
    expect(destinos.has(TEC_MEM)).toBe(true);
    expect(destinos.has(MEM)).toBe(true);
  });
});

describe('menções', () => {
  it('quem foi citado pelo identificador do e-mail recebe', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { ...evento('work_order.commented'), payload: { body: 'confere isso @joao.silva' } },
        MEIO_DIA
      )
    );
    expect(r.map((x) => x.membershipId)).toEqual([TEC_MEM]);
  });

  it('um endereço de e-mail no texto não vira menção', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { ...evento('work_order.commented'), payload: { body: 'responder para joao.silva@notif.test' } },
        MEIO_DIA
      )
    );
    expect(r).toEqual([]);
  });
});

describe('silêncio no fuso do destinatário', () => {
  beforeAll(async () => {
    await withTenant(t.db, ctx, (s) =>
      setQuietHours(s, TEC_MEM, { startMinute: 20 * 60, endMinute: 7 * 60 })
    );
  });

  it('de madrugada, o aviso comum vira resumo em vez de sumir', async () => {
    const r = await withTenant(t.db, ctx, (s) => routeEvent(s, evento('work_order.assigned'), MADRUGADA));
    const entrega = r.find((x) => x.membershipId === TEC_MEM)!.deliveries.find((d) => d.channel === 'in_app');
    expect(entrega!.state).toBe('digested');
    expect(entrega!.reason).toBe('quiet_hours');
  });

  it('o SLA violado fura o silêncio — exige ação agora', async () => {
    const outraOs = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Outra',
        locationId: local,
        assetId: ativo,
        assigneeMembershipId: TEC_MEM,
      });
      return w.id;
    });

    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { type: 'sla.breached', aggregateType: 'work_order', aggregateId: outraOs, payload: {} },
        MADRUGADA
      )
    );
    const entregas = r.find((x) => x.membershipId === TEC_MEM)!.deliveries;
    expect(entregas.find((d) => d.channel === 'in_app')!.state).toBe('pending');
  });
});

describe('preferências', () => {
  it('canal desligado não entrega', async () => {
    await withTenant(t.db, ctx, (s) =>
      setPreference(s, TEC_MEM, { typeKey: 'work_order_rescheduled', channel: 'email', enabled: false })
    );

    const nova = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Terceira',
        locationId: local,
        assetId: ativo,
        assigneeMembershipId: TEC_MEM,
      });
      return w.id;
    });

    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { type: 'work_order.rescheduled', aggregateType: 'work_order', aggregateId: nova, payload: {} },
        MEIO_DIA
      )
    );
    const entregas = r.find((x) => x.membershipId === TEC_MEM)!.deliveries;
    expect(entregas.find((d) => d.channel === 'email')!.state).toBe('suppressed');
    expect(entregas.find((d) => d.channel === 'in_app')!.state).toBe('pending');
  });

  it('preferência em canal que o tipo não usa é recusada, listando os possíveis', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => setPreference(s, TEC_MEM, { typeKey: 'sla_warning', channel: 'email' }))
    ).rejects.toThrow(/canais possíveis: in_app, push/);
  });

  it('tipo desconhecido é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => setPreference(s, TEC_MEM, { typeKey: 'nao_existe', channel: 'email' }))
    ).rejects.toThrow(/desconhecido/);
  });

  it('silêncio pela metade é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => setQuietHours(s, TEC_MEM, { startMinute: 600, endMinute: null }))
    ).rejects.toThrow(/início e fim/);
  });
});

describe('e-mail não verificado', () => {
  it('não entrega, e nem guarda para depois', async () => {
    const NOVO_USER = newId(),
      NOVO_MEM = newId();
    await seedMember(
      t,
      { organizationId: ORG, userId: NOVO_USER, membershipId: NOVO_MEM },
      { email: 'nao.verificado@notif.test', userName: 'Sem verificação' }
    );

    const nova = await withTenant(t.db, ctx, async (s) => {
      const papeis = await provisionFactoryRoles(s);
      await assignRole(s, NOVO_MEM, papeis.get('technician')!);
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Para quem não verificou',
        locationId: local,
        assetId: ativo,
        assigneeMembershipId: NOVO_MEM,
      });
      return w.id;
    });

    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { type: 'work_order.rescheduled', aggregateType: 'work_order', aggregateId: nova, payload: {} },
        MEIO_DIA
      )
    );
    const entregas = r.find((x) => x.membershipId === NOVO_MEM)!.deliveries;
    const email = entregas.find((d) => d.channel === 'email')!;
    expect(email.state).toBe('suppressed');
    expect(email.reason).toBe('unverified_email');
    // O aplicativo continua funcionando: só o canal de e-mail é suprimido.
    expect(entregas.find((d) => d.channel === 'in_app')!.state).toBe('pending');
  });

  it('endereço bloqueado conta como não verificado', async () => {
    await withTenant(t.db, ctx, (s) => blockEmail(s, TEC_USER, 'retorno permanente do servidor'));

    const nova = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Depois do bloqueio',
        locationId: local,
        assetId: ativo,
        assigneeMembershipId: TEC_MEM,
      });
      return w.id;
    });

    const r = await withTenant(t.db, ctx, (s) =>
      routeEvent(
        s,
        { type: 'sla.breached', aggregateType: 'work_order', aggregateId: nova, payload: {} },
        MEIO_DIA
      )
    );
    const email = r.find((x) => x.membershipId === TEC_MEM)!.deliveries.find((d) => d.channel === 'email')!;
    expect(email.reason).toBe('unverified_email');

    await withTenant(t.db, ctx, (s) => markEmailVerified(s, TEC_USER));
  });
});

describe('caixa de entrada', () => {
  it('conta as não lidas e marca como lida uma vez só', async () => {
    const antes = await withTenant(t.db, ctx, (s) => unreadCount(s, TEC_MEM));
    expect(antes).toBeGreaterThan(0);

    const itens = await withTenant(t.db, ctx, (s) => inbox(s, TEC_MEM, { limit: 2 }));
    const marcadas = await withTenant(t.db, ctx, (s) =>
      markRead(
        s,
        TEC_MEM,
        itens.map((i) => i.id)
      )
    );
    expect(marcadas).toBe(itens.length);

    // Marcar de novo não faz nada: `read_at` só é escrito uma vez.
    const denovo = await withTenant(t.db, ctx, (s) =>
      markRead(
        s,
        TEC_MEM,
        itens.map((i) => i.id)
      )
    );
    expect(denovo).toBe(0);
  });

  it('só traz as não lidas quando pedido', async () => {
    const naoLidas = await withTenant(t.db, ctx, (s) => inbox(s, TEC_MEM, { unreadOnly: true }));
    expect(naoLidas.every((i) => i.read_at === null)).toBe(true);
  });

  it('marcar tudo zera a contagem', async () => {
    await withTenant(t.db, ctx, (s) => markAllRead(s, TEC_MEM));
    expect(await withTenant(t.db, ctx, (s) => unreadCount(s, TEC_MEM))).toBe(0);
  });

  it('a caixa de um vínculo não mostra o aviso de outro', async () => {
    const doTecnico = await withTenant(t.db, ctx, (s) => inbox(s, TEC_MEM));
    const daCoordenadora = await withTenant(t.db, ctx, (s) => inbox(s, MEM));
    const ids = new Set(doTecnico.map((i) => i.id));
    expect(daCoordenadora.some((i) => ids.has(i.id))).toBe(false);
  });
});

describe('fila de saída', () => {
  it('lista o que está esperando, com o endereço de destino', async () => {
    const fila = await withTenant(t.db, ctx, (s) => pendingDeliveries(s, 'email'));
    expect(fila.length).toBeGreaterThan(0);
    expect(fila[0]!.email).toContain('@');
  });

  it('marcar como enviado tira da fila, e só funciona uma vez', async () => {
    const [primeira] = await withTenant(t.db, ctx, (s) => pendingDeliveries(s, 'email', 1));
    await withTenant(t.db, ctx, (s) => markDeliverySent(s, primeira!.id));

    const fila = await withTenant(t.db, ctx, (s) => pendingDeliveries(s, 'email'));
    expect(fila.find((d) => d.id === primeira!.id)).toBeUndefined();

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ attempts: number; state: string }>(
        `SELECT attempts, state FROM aurora.notification_deliveries WHERE id = $1`,
        [primeira!.id]
      )
    );
    expect(linha!.state).toBe('sent');
    expect(Number(linha!.attempts)).toBe(1);
  });
});

describe('isolamento', () => {
  it('outra organização não enxerga notificação nenhuma', async () => {
    const OUTRA = newId(),
      U2 = newId(),
      M2 = newId();
    await seedOrganization(
      t,
      { organizationId: OUTRA, userId: U2, membershipId: M2 },
      { slug: 'notif2', name: 'Outra', email: 'b@notif.test', userName: 'B' }
    );
    const ctx2 = buildContext({
      organizationId: OUTRA,
      actorId: U2,
      membershipId: M2,
      requestId: 'notif2',
      permissions: PERMISSION_KEYS,
    });

    const linhas = await withTenant(t.db, ctx2, (s) => s.query(`SELECT id FROM aurora.notifications`));
    expect(linhas).toHaveLength(0);
  });
});
