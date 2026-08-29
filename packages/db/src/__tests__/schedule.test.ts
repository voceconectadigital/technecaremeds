/**
 * Aurora — agenda contra o banco (SPEC v0.2 §13 · EPIC-012).
 *
 * A referência tem 2.950 serviços não agendados. O que esta suíte prova é que
 * programar aqui custa menos: a conferência acontece antes de soltar o cartão,
 * o aviso vem com o motivo escrito, e quem entra de férias arrasta consigo as
 * OS que estavam marcadas — em vez de deixá-las marcadas para ninguém.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import {
  createAvailabilityBlock,
  checkSchedule,
  scheduleWorkOrder,
  unscheduleWorkOrder,
  agenda,
  resourceBoard,
  buckets,
} from '../schedule';
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
  requestId: 'ag',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, setor: string, ativo: string, natureza: string;

/** Uma segunda-feira estável, para o calendário não depender do dia do teste. */
const SEG = '2025-03-10';
const em = (hora: string) => new Date(`${SEG}T${hora}:00Z`);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'ag', name: 'Prestadora', email: 'coord@ag.test', userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: TEC_USER, membershipId: TEC_MEM },
    { email: 'tec@ag.test', userName: 'Técnico' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await s.query(`UPDATE aurora.memberships SET daily_hours = 8 WHERE id = $1`, [TEC_MEM]);

    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOs(titulo: string, assignee: string | null = TEC_MEM) {
  return withTenant(t.db, ctx, async (s) => {
    const w = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: titulo,
      locationId: setor,
      assetId: ativo,
      assigneeMembershipId: assignee,
    });
    return w.id;
  });
}

/* -------------------------------------------------------------------------- */

describe('conferir antes de soltar o cartão', () => {
  let os: string;

  beforeAll(async () => {
    os = await novaOs('Preventiva do ventilador');
  });

  it('agenda livre não devolve conflito nenhum', async () => {
    const c = await withTenant(t.db, ctx, (s) =>
      checkSchedule(s, { workOrderId: os, startsAt: em('09:00'), endsAt: em('11:00') })
    );
    expect(c).toEqual([]);
  });

  it('agendar grava a janela e emite o evento de programação', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, { workOrderId: os, startsAt: em('09:00'), endsAt: em('11:00') })
    );
    expect(r.rescheduleCount).toBe(0);

    const [ev] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.domain_events WHERE type = 'work_order.scheduled' AND aggregate_id = $1`,
        [os]
      )
    );
    expect(ev).toBeTruthy();
  });

  it('a segunda OS no mesmo horário avisa, não bloqueia', async () => {
    const outra = await novaOs('Outra na mesma hora');
    const c = await withTenant(t.db, ctx, (s) =>
      checkSchedule(s, { workOrderId: outra, startsAt: em('10:00'), endsAt: em('12:00') })
    );
    expect(c.map((x) => x.kind)).toContain('overlap');
    expect(c.every((x) => x.severity === 'warn')).toBe(true);

    const r = await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, { workOrderId: outra, startsAt: em('10:00'), endsAt: em('12:00') })
    );
    expect(r.conflicts.map((x) => x.kind)).toContain('overlap');
  });

  it('a janela invertida é recusada antes de qualquer consulta', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        scheduleWorkOrder(s, { workOrderId: os, startsAt: em('11:00'), endsAt: em('09:00') })
      )
    ).rejects.toThrow(/precisa ser depois do início/);
  });
});

describe('capacidade', () => {
  it('avisa quando o dia estoura a jornada de oito horas', async () => {
    const longa = await novaOs('Serviço longo');
    const c = await withTenant(t.db, ctx, (s) =>
      checkSchedule(s, { workOrderId: longa, startsAt: em('13:00'), endsAt: em('21:00') })
    );
    const carga = c.find((x) => x.kind === 'over_capacity');
    expect(carga?.severity).toBe('warn');
    expect(carga?.detail).toMatch(/% da jornada/);
  });

  it('a lente de recursos mostra ocupação e a marca de ausência', async () => {
    const lista = await withTenant(t.db, ctx, (s) => resourceBoard(s, em('09:00')));
    const tecnico = lista.find((r) => r.membershipId === TEC_MEM);
    expect(tecnico?.load.capacityMinutes).toBe(480);
    expect(tecnico!.load.bookedMinutes).toBeGreaterThan(0);
    expect(tecnico?.absent).toBe(false);

    const coord = lista.find((r) => r.membershipId === MEM);
    // A coordenadora não tem jornada cadastrada: ocupação desconhecida, e não
    // "dia livre" — é a diferença que impede empilhar trabalho em quem o
    // sistema conhece menos.
    expect(coord?.load.percent).toBeNull();
  });
});

describe('férias bloqueiam, e arrastam consigo o que estava marcado', () => {
  let osMarcada: string;

  beforeAll(async () => {
    osMarcada = await novaOs('Marcada antes das férias');
    await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, {
        workOrderId: osMarcada,
        startsAt: new Date('2025-04-08T09:00:00Z'),
        endsAt: new Date('2025-04-08T11:00:00Z'),
      })
    );
  });

  it('a ausência criada depois joga a OS no balde "Reagendar", com o motivo', async () => {
    await withTenant(t.db, ctx, (s) =>
      createAvailabilityBlock(s, {
        membershipId: TEC_MEM,
        kind: 'vacation',
        startsAt: new Date('2025-04-07T00:00:00Z'),
        endsAt: new Date('2025-04-20T00:00:00Z'),
      })
    );

    const [w] = await withTenant(t.db, ctx, (s) =>
      s.query<{ window_invalidated_at: Date | null; window_invalidated_reason: string | null }>(
        `SELECT window_invalidated_at, window_invalidated_reason FROM aurora.work_orders WHERE id = $1`,
        [osMarcada]
      )
    );
    expect(w!.window_invalidated_at).not.toBeNull();
    expect(w!.window_invalidated_reason).toMatch(/férias de 07\/04 a 20\/04/);

    const baldes = await withTenant(t.db, ctx, (s) => buckets(s, new Date('2025-04-01T12:00:00Z')));
    expect(baldes.find((b) => b.work_order_id === osMarcada)?.bucket).toBe('to_reschedule');
  });

  it('a janela NÃO é apagada — é ela que o coordenador usa para remarcar perto', async () => {
    const [w] = await withTenant(t.db, ctx, (s) =>
      s.query<{ scheduled_start: Date | null }>(
        `SELECT scheduled_start FROM aurora.work_orders WHERE id = $1`,
        [osMarcada]
      )
    );
    expect(w!.scheduled_start).not.toBeNull();
  });

  it('agendar dentro das férias é recusado, dizendo por quê', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        scheduleWorkOrder(s, {
          workOrderId: osMarcada,
          startsAt: new Date('2025-04-10T09:00:00Z'),
          endsAt: new Date('2025-04-10T11:00:00Z'),
        })
      )
    ).rejects.toThrow(/em férias/);
  });

  it('remarcar para fora das férias limpa a pendência e conta o reagendamento', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, {
        workOrderId: osMarcada,
        startsAt: new Date('2025-04-22T09:00:00Z'),
        endsAt: new Date('2025-04-22T11:00:00Z'),
      })
    );
    expect(r.rescheduleCount).toBe(1);
    expect(r.notifiedRequester).toBe(true);

    const [w] = await withTenant(t.db, ctx, (s) =>
      s.query<{ window_invalidated_at: Date | null }>(
        `SELECT window_invalidated_at FROM aurora.work_orders WHERE id = $1`,
        [osMarcada]
      )
    );
    expect(w!.window_invalidated_at).toBeNull();
  });

  it('treinamento avisa mas deixa agendar', async () => {
    await withTenant(t.db, ctx, (s) =>
      createAvailabilityBlock(s, {
        membershipId: TEC_MEM,
        kind: 'training',
        startsAt: new Date('2025-05-05T08:00:00Z'),
        endsAt: new Date('2025-05-05T12:00:00Z'),
        note: 'NR-10',
      })
    );

    const os = await novaOs('Durante o treinamento');
    const r = await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, {
        workOrderId: os,
        startsAt: new Date('2025-05-05T09:00:00Z'),
        endsAt: new Date('2025-05-05T10:00:00Z'),
      })
    );
    expect(r.conflicts.find((c) => c.kind === 'commitment')?.detail).toMatch(/NR-10/);
  });
});

describe('reagendar em série vira sinal operacional', () => {
  it('mais de três mudanças acende o sinal', async () => {
    const os = await novaOs('Empurrada várias vezes');
    let ultimo = { rescheduleCount: 0, signal: false };
    for (let i = 0; i < 5; i++) {
      ultimo = await withTenant(t.db, ctx, (s) =>
        scheduleWorkOrder(s, {
          workOrderId: os,
          startsAt: new Date(`2025-06-0${i + 1}T09:00:00Z`),
          endsAt: new Date(`2025-06-0${i + 1}T10:00:00Z`),
        })
      );
    }
    expect(ultimo.rescheduleCount).toBe(4);
    expect(ultimo.signal).toBe(true);
  });

  it('a primeira marcação não conta como reagendamento', async () => {
    const os = await novaOs('Marcada uma vez só');
    const r = await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, {
        workOrderId: os,
        startsAt: new Date('2025-07-01T09:00:00Z'),
        endsAt: new Date('2025-07-01T10:00:00Z'),
      })
    );
    expect(r.rescheduleCount).toBe(0);
  });
});

describe('as três lentes', () => {
  it('o calendário traz só o que cruza o intervalo pedido', async () => {
    const entradas = await withTenant(t.db, ctx, (s) =>
      agenda(s, { from: em('00:00'), to: new Date(`${SEG}T23:59:00Z`) })
    );
    expect(entradas.length).toBeGreaterThanOrEqual(2);
    expect(entradas.every((e) => e.scheduled_start !== null)).toBe(true);
    // Vem com nome de cliente, local e responsável: a tela do coordenador não
    // deve precisar de uma consulta por cartão para saber o que mostrar.
    expect(entradas[0]!.customer_name).toBe('Hospital');
    expect(entradas[0]!.location_name).toBe('UTI');
  });

  it('a lista separa não agendadas de atrasadas', async () => {
    const semJanela = await novaOs('Nunca programada');
    const baldes = await withTenant(t.db, ctx, (s) => buckets(s, new Date('2025-08-01T12:00:00Z')));

    expect(baldes.find((b) => b.work_order_id === semJanela)?.bucket).toBe('unscheduled');
    expect(baldes.some((b) => b.bucket === 'late')).toBe(true);
  });

  it('OS iniciada sai dos baldes — deixou de ser problema de programação', async () => {
    const os = await novaOs('Já começou');
    await withTenant(t.db, ctx, async (s) => {
      await scheduleWorkOrder(s, {
        workOrderId: os,
        startsAt: new Date('2025-02-01T09:00:00Z'),
        endsAt: new Date('2025-02-01T10:00:00Z'),
      });
      await transitionWorkOrder(s, os, 'in_progress');
    });

    const baldes = await withTenant(t.db, ctx, (s) => buckets(s, new Date('2025-08-01T12:00:00Z')));
    expect(baldes.find((b) => b.work_order_id === os)).toBeUndefined();
  });
});

describe('desagendar', () => {
  it('arrastar de volta limpa a janela', async () => {
    const os = await novaOs('Vai e volta');
    await withTenant(t.db, ctx, (s) =>
      scheduleWorkOrder(s, {
        workOrderId: os,
        startsAt: new Date('2025-09-01T09:00:00Z'),
        endsAt: new Date('2025-09-01T10:00:00Z'),
      })
    );
    await withTenant(t.db, ctx, (s) => unscheduleWorkOrder(s, os));

    const baldes = await withTenant(t.db, ctx, (s) => buckets(s, new Date('2025-09-02T12:00:00Z')));
    expect(baldes.find((b) => b.work_order_id === os)?.bucket).toBe('unscheduled');
  });

  it('OS encerrada não se agenda', async () => {
    const os = await novaOs('Encerrada');
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os, 'cancelled', {
        cancellationReason: 'aberta em duplicidade pelo mesmo solicitante',
      });
    });

    await expect(
      withTenant(t.db, ctx, (s) =>
        scheduleWorkOrder(s, {
          workOrderId: os,
          startsAt: new Date('2025-10-01T09:00:00Z'),
          endsAt: new Date('2025-10-01T10:00:00Z'),
        })
      )
    ).rejects.toThrow(/encerrada/);
  });
});
