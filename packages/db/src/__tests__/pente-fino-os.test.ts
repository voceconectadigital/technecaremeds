/**
 * Aurora — pente-fino 17/10/2026: integridade da ordem de serviço contra o banco.
 *
 *   · a OS não mistura clientes: ativo ou local de outro cliente é recusado, na
 *     criação manual e nos alvos do aceite (0072 + mensagem do aceite);
 *   · solicitação: o segundo aceite é recusado; aceita com OS ativa não se
 *     cancela; sem `service_request.accept` não se move depois do aceite;
 *   · cronômetro: um aberto por pessoa, com mensagem que diz onde; OS
 *     cancelada fecha o cronômetro e o check-out continua possível; o
 *     cronômetro órfão em OS encerrada pode ser fechado (guarda da 0072);
 *     parar o cronômetro de outra pessoa exige permissão;
 *   · checklist de OS fechada não muda — salvo `work_order.edit_closed`, e aí
 *     com motivo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import {
  provisionWorkOrderStates,
  createWorkOrder,
  transitionWorkOrder,
  acceptServiceRequest,
} from '../work-orders';
import { createServiceRequest, transitionRequest } from '../service-requests';
import {
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  answerChecklistItem,
  startTimer,
  stopTimer,
} from '../execution';
import { checkIn, checkOut } from '../execucao-guiada';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const OUTRO_USER = newId(),
  OUTRO_MEM = newId();

const contexto = (actorId: string, membershipId: string, sem: string[] = []) =>
  buildContext({
    organizationId: ORG,
    actorId,
    membershipId,
    requestId: 'pente-fino-os',
    permissions: PERMISSION_KEYS.filter((k) => !sem.includes(k)),
  });

/** Gestora: todas as permissões. */
const ctx = contexto(USER, MEM);
/** Outra pessoa da equipe, também com tudo. */
const ctxOutro = contexto(OUTRO_USER, OUTRO_MEM);
/** A mesma pessoa da gestora, mas como técnica: sem aprovar hora, sem editar OS fechada, sem aceitar. */
const ctxTecnica = contexto(USER, MEM, [
  'time_entry.approve',
  'time_entry.create_for_others',
  'work_order.edit_closed',
  'service_request.accept',
]);

const JUST = 'GPS do tablet desligado pela TI do hospital';

let t: TestDatabase;
let clienteA: string, clienteB: string;
let setorA: string, setorB: string;
let ativoA: string, ativoB: string;
let natureza: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'pente-os', name: 'Prestadora', email: 'g@pente-os.test', userName: 'Gestora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: OUTRO_USER, membershipId: OUTRO_MEM },
    { email: 'o@pente-os.test', userName: 'Outro técnico' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    clienteA = await createCustomer(s, { name: 'Hospital A', isInternal: true });
    clienteB = await createCustomer(s, { name: 'Clínica B' });
    setorA = await createLocation(s, {
      customerId: clienteA,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade A',
    });
    setorB = await createLocation(s, {
      customerId: clienteB,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade B',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    ativoA = await createAsset(s, {
      name: 'Vent A',
      customerId: clienteA,
      assetCategoryId: cat,
      locationId: setorA,
    });
    ativoB = await createAsset(s, {
      name: 'Vent B',
      customerId: clienteB,
      assetCategoryId: cat,
      locationId: setorB,
    });
    natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const novaOs = (titulo: string, extra: { assetId?: string; locationId?: string } = {}) =>
  withTenant(t.db, ctx, (s) =>
    createWorkOrder(s, {
      customerId: clienteA,
      workOrderTypeId: natureza,
      title: titulo,
      locationId: extra.locationId ?? setorA,
      assetId: extra.assetId ?? null,
    })
  );

describe('a OS não mistura clientes', () => {
  it('ativo de outro cliente é recusado na criação', async () => {
    await expect(novaOs('Ativo trocado', { assetId: ativoB })).rejects.toThrow(
      /ativo informado pertence a outro cliente/
    );
  });

  it('local de outro cliente é recusado na criação', async () => {
    await expect(novaOs('Local trocado', { locationId: setorB })).rejects.toThrow(
      /local informado pertence a outro cliente/
    );
  });

  it('ativo e local do próprio cliente passam', async () => {
    const os = await novaOs('Tudo certo', { assetId: ativoA });
    expect(os.number).toMatch(/^WO-/);
  });

  it('o banco recusa trocar o ativo da OS por um de outro cliente', async () => {
    const os = await novaOs('Troca posterior');
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.work_orders SET asset_id = $2 WHERE id = $1`, [os.id, ativoB])
      )
    ).rejects.toThrow(/ativo informado pertence a outro cliente/);
  });
});

describe('aceite da solicitação', () => {
  let pedido = '';

  beforeAll(async () => {
    pedido = await withTenant(t.db, ctx, async (s) => {
      const r = await createServiceRequest(s, {
        customerId: clienteA,
        summary: 'Ventilador alarmando',
        locationId: setorA,
      });
      await transitionRequest(s, r.id, 'triage');
      return r.id;
    });
  });

  const estado = async () =>
    (
      await withTenant(t.db, ctx, (s) =>
        s.query<{ status: string }>(`SELECT status::text FROM aurora.service_requests WHERE id = $1`, [
          pedido,
        ])
      )
    )[0]!.status;

  it('alvo com ativo de outro cliente é recusado, e nada muda', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        acceptServiceRequest(s, pedido, [{ assetId: ativoB, workOrderTypeId: natureza }])
      )
    ).rejects.toThrow(/targets\[0\]\.asset_id: o equipamento pertence a outro cliente/);
    expect(await estado()).toBe('triage');
  });

  it('alvo com local de outro cliente é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        acceptServiceRequest(s, pedido, [{ locationId: setorB, workOrderTypeId: natureza }])
      )
    ).rejects.toThrow(/targets\[0\]\.location_id: o local pertence a outro cliente/);
    expect(await estado()).toBe('triage');
  });

  it('o aceite válido gera a OS; o segundo aceite é recusado', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      acceptServiceRequest(s, pedido, [{ assetId: ativoA, workOrderTypeId: natureza }])
    );
    expect(r.workOrders).toHaveLength(1);
    await expect(
      withTenant(t.db, ctx, (s) => acceptServiceRequest(s, pedido, [{ workOrderTypeId: natureza }]))
    ).rejects.toThrow(/accepted/);
    const [n] = await withTenant(t.db, ctx, (s) =>
      s.query<{ n: number }>(`SELECT count(*)::int n FROM aurora.work_orders WHERE service_request_id = $1`, [
        pedido,
      ])
    );
    expect(n!.n).toBe(1);
  });

  it('sem service_request.accept, ninguém força em atendimento/cancelada', async () => {
    await expect(
      withTenant(t.db, ctxTecnica, (s) => transitionRequest(s, pedido, 'in_service'))
    ).rejects.toThrow(/in_service/);
    await expect(
      withTenant(t.db, ctxTecnica, (s) =>
        transitionRequest(s, pedido, 'cancelled', { cancellationReason: 'desisti' })
      )
    ).rejects.toThrow(/cancelled/);
  });

  it('aceita com OS ativa não se cancela; com as OS canceladas, sim', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        transitionRequest(s, pedido, 'cancelled', { cancellationReason: 'desisti' })
      )
    ).rejects.toThrow(/ordem\(ns\) de serviço ativa/);

    await withTenant(t.db, ctx, async (s) => {
      const [os] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.work_orders WHERE service_request_id = $1`,
        [pedido]
      );
      await transitionWorkOrder(s, os!.id, 'cancelled', { cancellationReason: 'cliente desistiu' });
    });
    const r = await withTenant(t.db, ctx, (s) =>
      transitionRequest(s, pedido, 'cancelled', { cancellationReason: 'desisti' })
    );
    expect(r.status).toBe('cancelled');
  });
});

describe('cronômetro e check-in', () => {
  let os1 = '',
    os2 = '';

  beforeAll(async () => {
    os1 = (await novaOs('Check-in 1')).id;
    os2 = (await novaOs('Check-in 2')).id;
  });

  const abertos = async (membershipId: string) =>
    (
      await withTenant(t.db, ctx, (s) =>
        s.query<{ n: number }>(
          `SELECT count(*)::int n FROM aurora.time_entries WHERE membership_id = $1 AND ended_at IS NULL`,
          [membershipId]
        )
      )
    )[0]!.n;

  it('check-in em duas OS ao mesmo tempo é recusado, dizendo onde está o cronômetro', async () => {
    await withTenant(t.db, ctx, (s) => checkIn(s, os1, { justification: JUST }));
    const [w1] = await withTenant(t.db, ctx, (s) =>
      s.query<{ number: string }>(`SELECT number FROM aurora.work_orders WHERE id = $1`, [os1])
    );
    await expect(withTenant(t.db, ctx, (s) => checkIn(s, os2, { justification: JUST }))).rejects.toThrow(
      new RegExp(`cronômetro aberto seu na OS ${w1!.number}`)
    );
    await expect(withTenant(t.db, ctx, (s) => startTimer(s, os2))).rejects.toThrow(/cronômetro aberto seu/);
    expect(await abertos(MEM)).toBe(1);
  });

  it('cancelar a OS fecha o cronômetro, e o check-out depois continua possível', async () => {
    await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, os1, 'cancelled', { cancellationReason: 'cliente desistiu' })
    );
    expect(await abertos(MEM)).toBe(0);
    const saida = await withTenant(t.db, ctx, (s) => checkOut(s, os1, { justification: JUST }));
    expect(saida.visitId).toBeTruthy();
    // E a pessoa volta a poder trabalhar em outra OS.
    const r = await withTenant(t.db, ctx, (s) => checkIn(s, os2, { justification: JUST }));
    expect(r.timeEntryId).toBeTruthy();
    await withTenant(t.db, ctx, (s) => checkOut(s, os2, { justification: JUST }));
  });

  it('cronômetro órfão em OS encerrada pode ser fechado — e só fechado', async () => {
    const os = (await novaOs('Órfã')).id;
    const entrada = await withTenant(t.db, ctxOutro, (s) => startTimer(s, os));
    // Simula o legado: a OS foi cancelada antes da 0072, com o cronômetro aberto.
    await t.raw(`SET session_replication_role = replica`);
    try {
      await t.raw(
        `UPDATE aurora.work_orders
            SET status_category = 'cancelled',
                cancellation_reason = 'cancelada antes da 0072',
                status_id = (SELECT id FROM aurora.work_order_statuses WHERE key = 'cancelled' AND organization_id = $2)
          WHERE id = $1`,
        [os, ORG]
      );
    } finally {
      await t.raw(`SET session_replication_role = origin`);
    }

    await expect(
      withTenant(t.db, ctxOutro, (s) =>
        s.query(`UPDATE aurora.time_entries SET started_at = started_at - interval '1 hour' WHERE id = $1`, [
          entrada,
        ])
      )
    ).rejects.toThrow(/não se aponta hora/);

    const minutos = await withTenant(t.db, ctxOutro, (s) => stopTimer(s, entrada, 'fechando o órfão'));
    expect(minutos).toBeGreaterThanOrEqual(0);
    expect(await abertos(OUTRO_MEM)).toBe(0);
  });

  it('parar o cronômetro de outra pessoa exige permissão de aprovar horas', async () => {
    const os = (await novaOs('Cronômetro alheio')).id;
    const entrada = await withTenant(t.db, ctxOutro, (s) => startTimer(s, os));
    await expect(withTenant(t.db, ctxTecnica, (s) => stopTimer(s, entrada))).rejects.toThrow(
      /time_entry\.approve/
    );
    const minutos = await withTenant(t.db, ctx, (s) => stopTimer(s, entrada));
    expect(minutos).toBeGreaterThanOrEqual(0);
  });
});

describe('checklist de OS fechada', () => {
  let resposta = '',
    item = '';

  beforeAll(async () => {
    await withTenant(t.db, ctx, async (s) => {
      const template = await createChecklistTemplate(s, { key: 'pente_fino', title: 'Pente-fino' });
      item = await addChecklistItem(s, {
        templateId: template,
        kind: 'boolean',
        label: 'Aterramento íntegro',
        expectedBoolean: true,
      });
      await publishChecklist(s, template);
      const os = await createWorkOrder(s, {
        customerId: clienteA,
        workOrderTypeId: natureza,
        title: 'Vai fechar com checklist',
        locationId: setorA,
      });
      resposta = await attachChecklist(s, os.id, template);
      await transitionWorkOrder(s, os.id, 'in_progress');
      await answerChecklistItem(s, resposta, item, { boolean: true });
      await transitionWorkOrder(s, os.id, 'completed', { resolution: 'concluída para o teste' });
      await transitionWorkOrder(s, os.id, 'validated');
      await transitionWorkOrder(s, os.id, 'closed');
    });
  });

  it('sem work_order.edit_closed, a resposta não muda', async () => {
    await expect(
      withTenant(t.db, ctxTecnica, (s) => answerChecklistItem(s, resposta, item, { boolean: false }))
    ).rejects.toThrow(/não mudam mais/);
  });

  it('com work_order.edit_closed, corrige — mas só com motivo', async () => {
    await expect(
      withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, item, { boolean: false }))
    ).rejects.toThrow(/exige o motivo/);
    const r = await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(
        s,
        resposta,
        item,
        { boolean: false },
        { correctionReason: 'valor transcrito errado do formulário' }
      )
    );
    expect(r.revision).toBe(2);
  });
});
