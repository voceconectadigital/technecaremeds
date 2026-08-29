/**
 * Aurora — ordens de serviço contra o banco (SPEC v0.2 §09, §10 · EPIC-008).
 *
 * Critérios de aceite verificados aqui:
 *  · transição não declarada é recusada, com mensagem que nomeia as possíveis
 *  · ir para "Aguardando" sem motivo é impossível — no domínio E por constraint
 *  · toda transição grava histórico com duração no estado anterior e emite evento
 *  · uma solicitação com 3 ativos gera 3 OS vinculadas em uma operação (EPIC-007)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset, transferAsset } from '../assets';
import { createServiceRequest, transitionRequest } from '../service-requests';
import {
  provisionWorkOrderStates,
  loadStatuses,
  loadTransitionGraph,
  createWorkOrder,
  transitionWorkOrder,
  acceptServiceRequest,
  workOrderHistory,
  waitTimeByReason,
} from '../work-orders';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctxA = buildContext({
  organizationId: ORG_A,
  actorId: USER_A,
  membershipId: MEM_A,
  requestId: 'wo-a',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'wo-b',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, setor: string, setorDestino: string;
let ativo1: string, ativo2: string, ativo3: string;
let naturezaCorretiva: string, sintoma: string, causa: string;
let motivos: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'wo-a', name: 'Rede A', email: 'a@wo.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'wo-b', name: 'Rede B', email: 'b@wo.test', userName: 'B' }
  );

  await withTenant(t.db, ctxA, async (s) => {
    const provisionado = await provisionWorkOrderStates(s);
    motivos = provisionado.waitReasons;

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Central', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade Norte',
    });
    setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    setorDestino = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'Centro Cirúrgico',
    });

    const cat = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
    ativo1 = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
      serialNumber: 'VENT-001',
    });
    ativo2 = await createAsset(s, {
      name: 'Ventilador 02',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    ativo3 = await createAsset(s, {
      name: 'Ventilador 03',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });

    naturezaCorretiva = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    sintoma = await createCatalogItem(s, {
      catalogKey: 'failure_symptom',
      key: 'nao_liga',
      label: 'Não liga',
    });
    causa = await createCatalogItem(s, {
      catalogKey: 'failure_cause',
      key: 'fonte',
      label: 'Fonte de alimentação',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOs(over: Record<string, unknown> = {}) {
  return withTenant(t.db, ctxA, (s) =>
    createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: naturezaCorretiva,
      title: 'Ventilador não liga',
      locationId: setor,
      assetId: ativo1,
      reportedFailureCodeId: sintoma,
      ...over,
    })
  );
}

describe('provisionamento das situações', () => {
  it('cria as dez situações, os catorze motivos e o grafo', async () => {
    const statuses = await withTenant(t.db, ctxA, (s) => loadStatuses(s));
    expect(statuses).toHaveLength(10);
    const graph = await withTenant(t.db, ctxA, (s) => loadTransitionGraph(s));
    expect(graph.length).toBeGreaterThanOrEqual(20);
    const [c] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ c: number }>('SELECT count(*)::int c FROM aurora.wait_reasons')
    );
    expect(c!.c).toBe(14);
  });

  it('é idempotente', async () => {
    const r = await withTenant(t.db, ctxA, (s) => provisionWorkOrderStates(s));
    expect(r.transitions).toBe(0);
    const statuses = await withTenant(t.db, ctxA, (s) => loadStatuses(s));
    expect(statuses).toHaveLength(10);
  });

  it('situação de sistema não muda de categoria nem é arquivada', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(
          `UPDATE aurora.work_order_statuses SET category = 'done'::aurora.status_category WHERE key = 'completed'`
        )
      )
    ).rejects.toThrow(/categoria de uma situação de sistema é imutável/);

    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_order_statuses SET archived_at = now() WHERE key = 'waiting'`)
      )
    ).rejects.toThrow(/não é arquivável/);
  });

  it('mas o rótulo é livre — é o vocabulário do cliente', async () => {
    await withTenant(t.db, ctxA, (s) =>
      s.query(`UPDATE aurora.work_order_statuses SET label = 'Em atendimento' WHERE key = 'in_progress'`)
    );
    const statuses = await withTenant(t.db, ctxA, (s) => loadStatuses(s));
    expect(statuses.find((x) => x.key === 'in_progress')!.label).toBe('Em atendimento');
    await withTenant(t.db, ctxA, (s) =>
      s.query(`UPDATE aurora.work_order_statuses SET label = 'Em execução' WHERE key = 'in_progress'`)
    );
  });

  it('exigir motivo fora da categoria waiting é recusado', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_order_statuses SET requires_wait_reason = true WHERE key = 'open'`)
      )
    ).rejects.toThrow(/wos_reason_only_in_waiting|regra/i);
  });
});

describe('criação e numeração', () => {
  it('a OS publicada recebe número na série própria', async () => {
    const r = await novaOs();
    expect(r.number).toMatch(/^WO-\d{4}-\d{4}$/);
  });

  it('rascunho NÃO gasta número da série', async () => {
    const r = await novaOs({ publish: false });
    expect(r.number).toBeNull();
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ number: string | null; status_category: string }>(
        'SELECT number, status_category::text FROM aurora.work_orders WHERE id = $1',
        [r.id]
      )
    );
    expect(row!.number).toBeNull();
    expect(row!.status_category).toBe('draft');
  });

  it('a natureza precisa vir do catálogo work_order_type', async () => {
    await expect(novaOs({ workOrderTypeId: sintoma })).rejects.toThrow(/catálogo work_order_type/);
  });
});

describe('snapshot: transferir o ativo não reescreve o passado', () => {
  it('a OS guarda onde o equipamento estava quando o serviço aconteceu', async () => {
    const os = await novaOs({ title: 'Serviço na UTI' });
    const [antes] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ asset_name_snapshot: string; location_name_snapshot: string; asset_serial_snapshot: string }>(
        'SELECT asset_name_snapshot, location_name_snapshot, asset_serial_snapshot FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(antes!.asset_name_snapshot).toBe('Ventilador 01');
    expect(antes!.location_name_snapshot).toBe('UTI');
    expect(antes!.asset_serial_snapshot).toBe('VENT-001');

    await withTenant(t.db, ctxA, (s) =>
      transferAsset(s, ativo1, setorDestino, 'realocação para o centro cirúrgico')
    );

    const [depois] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ location_name_snapshot: string }>(
        'SELECT location_name_snapshot FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(depois!.location_name_snapshot).toBe('UTI');
  });

  it('o retrato não é editável', async () => {
    const os = await novaOs();
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_orders SET asset_name_snapshot = 'Outro' WHERE id = $1`, [os.id])
      )
    ).rejects.toThrow(/retrato do ativo e do local/);
  });
});

describe('máquina de estados', () => {
  it('a transição não declarada é recusada nomeando as possíveis', async () => {
    const os = await novaOs();
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await transitionWorkOrder(s, os.id, 'closed');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/Não é possível ir de "Aberta" para "Fechada"/);
    expect(erro).toMatch(/transições possíveis/);
  });

  it('ir para Aguardando sem motivo é recusado', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctxA, (s) => transitionWorkOrder(s, os.id, 'in_progress'));
    await expect(withTenant(t.db, ctxA, (s) => transitionWorkOrder(s, os.id, 'waiting'))).rejects.toThrow(
      /wait_reason_id|Aguardando/
    );
  });

  it('com motivo, bloqueia — e sair de Aguardando limpa o motivo', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctxA, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('parts')! });
    });
    const [bloqueada] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ wait_reason_id: string | null; status_category: string }>(
        'SELECT wait_reason_id, status_category::text FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(bloqueada!.wait_reason_id).toBe(motivos.get('parts'));
    expect(bloqueada!.status_category).toBe('waiting');

    await withTenant(t.db, ctxA, (s) => transitionWorkOrder(s, os.id, 'in_progress'));
    const [solta] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ wait_reason_id: string | null }>(
        'SELECT wait_reason_id FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(solta!.wait_reason_id).toBeNull();
  });

  it('pausar não exige motivo', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctxA, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'paused');
    });
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status_category: string; wait_reason_id: string | null }>(
        'SELECT status_category::text, wait_reason_id FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(row!.status_category).toBe('waiting');
    expect(row!.wait_reason_id).toBeNull();
  });

  it('o banco recusa a transição mesmo se alguém pular o motor de domínio', async () => {
    const os = await novaOs();
    const statuses = await withTenant(t.db, ctxA, (s) => loadStatuses(s));
    const fechada = statuses.find((x) => x.key === 'closed')!;
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_orders SET status_id = $2 WHERE id = $1`, [os.id, fechada.id])
      )
    ).rejects.toThrow(/não está declarada/);
  });

  it('o caminho completo até fechada percorre todas as etapas', async () => {
    const os = await novaOs({ title: 'Ciclo completo' });
    await withTenant(t.db, ctxA, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'completed', {
        resolution: 'Trocada a fonte e testado em bancada',
        causeFailureCodeId: causa,
      });
      await transitionWorkOrder(s, os.id, 'validated');
      await transitionWorkOrder(s, os.id, 'closed');
    });
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status_category: string; started_at: string; completed_at: string; closed_at: string }>(
        'SELECT status_category::text, started_at, completed_at, closed_at FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(row!.status_category).toBe('closed');
    expect(row!.started_at).not.toBeNull();
    expect(row!.completed_at).not.toBeNull();
    expect(row!.closed_at).not.toBeNull();
  });

  it('OS fechada é somente leitura', async () => {
    const [fechada] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.work_orders WHERE status_category = 'closed' LIMIT 1`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_orders SET title = 'Reescrito' WHERE id = $1`, [fechada!.id])
      )
    ).rejects.toThrow(/somente leitura/);
  });

  it('cancelar exige motivo', async () => {
    const os = await novaOs();
    await expect(withTenant(t.db, ctxA, (s) => transitionWorkOrder(s, os.id, 'cancelled'))).rejects.toThrow(
      /cancellation_reason|Cancelada/
    );
    await withTenant(t.db, ctxA, (s) =>
      transitionWorkOrder(s, os.id, 'cancelled', { cancellationReason: 'aberta em duplicidade' })
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status_category: string }>(
        'SELECT status_category::text FROM aurora.work_orders WHERE id = $1',
        [os.id]
      )
    );
    expect(row!.status_category).toBe('cancelled');
  });

  it('concorrência otimista: a segunda escrita é recusada', async () => {
    const os = await novaOs();
    const [{ version }] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ version: number }>('SELECT version FROM aurora.work_orders WHERE id = $1', [os.id])
    );
    await withTenant(t.db, ctxA, (s) =>
      transitionWorkOrder(s, os.id, 'in_progress', { expectedVersion: version })
    );
    await expect(
      withTenant(t.db, ctxA, (s) => transitionWorkOrder(s, os.id, 'paused', { expectedVersion: version }))
    ).rejects.toThrow(/mudou desde que você a carregou/);
  });
});

describe('histórico e eventos', () => {
  it('toda transição grava duração no estado anterior', async () => {
    const os = await novaOs({ title: 'Histórico' });
    await withTenant(t.db, ctxA, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('quote_approval')! });
      await transitionWorkOrder(s, os.id, 'in_progress');
    });
    const hist = await withTenant(t.db, ctxA, (s) => workOrderHistory(s, os.id));
    expect(hist).toHaveLength(4);
    for (const h of hist) expect(Number(h.seconds_in_from)).toBeGreaterThanOrEqual(0);

    // A linha que ENCERRA o estado de espera é a que carrega o motivo: é assim
    // que "tempo aguardando orçamento" fica somável.
    const desbloqueio = hist[3]!;
    expect(desbloqueio.from_category).toBe('waiting');
    expect(desbloqueio.wait_reason_label).toBe('Aguardando aprovação de orçamento');
  });

  it('o evento depende de onde se vem, não só de para onde se vai', async () => {
    const os = await novaOs({ title: 'Eventos' });
    await withTenant(t.db, ctxA, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('parts')! });
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'paused');
    });
    const eventos = await withTenant(t.db, ctxA, (s) =>
      s.query<{ type: string }>(
        `SELECT type FROM aurora.domain_events WHERE aggregate_id = $1 ORDER BY sequence`,
        [os.id]
      )
    );
    expect(eventos.map((e) => e.type)).toEqual([
      'work_order.opened',
      'work_order.started',
      'work_order.blocked',
      'work_order.unblocked',
      // pausar não vira notícia
    ]);
  });

  it('o histórico não se apaga nem se edita', async () => {
    const [linha] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>('SELECT id FROM aurora.work_order_status_history LIMIT 1')
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.work_order_status_history SET note = 'x' WHERE id = $1`, [linha!.id])
      )
    ).rejects.toThrow(/permission denied|permissão/i);
  });
});

describe('tempo perdido por motivo — a pergunta que o ADR-004 destravou', () => {
  it('soma o tempo por motivo, dizendo quais pausam o SLA', async () => {
    const linhas = await withTenant(t.db, ctxA, (s) =>
      waitTimeByReason(s, new Date('2000-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z'))
    );
    const porChave = new Map(linhas.map((l) => [l.wait_reason_key, l]));
    expect(porChave.has('parts')).toBe(true);
    expect(porChave.get('parts')!.pauses_sla).toBe(false);
    expect(porChave.get('quote_approval')!.pauses_sla).toBe(true);
  });
});

describe('aceite da solicitação gera 1..N ordens — critério do EPIC-007', () => {
  it('uma solicitação com 3 ativos gera 3 OS vinculadas, numa operação', async () => {
    const pedido = await withTenant(t.db, ctxA, async (s) => {
      const r = await createServiceRequest(s, {
        customerId: cliente,
        summary: 'Três ventiladores da UTI com o mesmo defeito',
        locationId: setor,
        reportedFailureCodeId: sintoma,
        requestedPriority: 'urgent',
      });
      await transitionRequest(s, r.id, 'triage');
      return r.id;
    });

    const { workOrders } = await withTenant(t.db, ctxA, (s) =>
      acceptServiceRequest(s, pedido, [
        { assetId: ativo1, workOrderTypeId: naturezaCorretiva },
        { assetId: ativo2, workOrderTypeId: naturezaCorretiva },
        { assetId: ativo3, workOrderTypeId: naturezaCorretiva },
      ])
    );

    expect(workOrders).toHaveLength(3);
    expect(new Set(workOrders.map((w) => w.number)).size).toBe(3);

    const vinculadas = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; asset_id: string; source: string; priority: string; title: string }>(
        `SELECT id, asset_id, source::text, priority::text, title
           FROM aurora.work_orders WHERE service_request_id = $1 ORDER BY title`,
        [pedido]
      )
    );
    expect(vinculadas).toHaveLength(3);
    expect(new Set(vinculadas.map((w) => w.asset_id))).toEqual(new Set([ativo1, ativo2, ativo3]));
    // herdam a origem, a prioridade e o relato
    expect(vinculadas.every((w) => w.source === 'request')).toBe(true);
    expect(vinculadas.every((w) => w.priority === 'urgent')).toBe(true);
    expect(vinculadas[0]!.title).toMatch(/\(1\/3\)/);

    const [sr] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status: string }>('SELECT status::text FROM aurora.service_requests WHERE id = $1', [pedido])
    );
    expect(sr!.status).toBe('accepted');
  });

  it('se a transição da solicitação não vale, nenhuma OS é criada', async () => {
    const pedido = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, { customerId: cliente, summary: 'Ainda não triada' })
    );
    // sem passar por triage, o aceite é inválido
    await expect(
      withTenant(t.db, ctxA, (s) =>
        acceptServiceRequest(s, pedido.id, [{ assetId: ativo1, workOrderTypeId: naturezaCorretiva }])
      )
    ).rejects.toThrow();

    const criadas = await withTenant(t.db, ctxA, (s) =>
      s.query('SELECT id FROM aurora.work_orders WHERE service_request_id = $1', [pedido.id])
    );
    expect(criadas).toEqual([]);
  });

  it('aceitar sem alvo nenhum é recusado', async () => {
    const pedido = await withTenant(t.db, ctxA, async (s) => {
      const r = await createServiceRequest(s, { customerId: cliente, summary: 'Sem alvo' });
      await transitionRequest(s, r.id, 'triage');
      return r.id;
    });
    await expect(withTenant(t.db, ctxA, (s) => acceptServiceRequest(s, pedido, []))).rejects.toThrow(
      /ao menos uma ordem/
    );
  });
});

describe('isolamento entre organizações', () => {
  it('B não enxerga OS de A', async () => {
    const vistas = await withTenant(t.db, ctxB, (s) => s.query('SELECT id FROM aurora.work_orders'));
    expect(vistas).toEqual([]);
  });

  it('B tem a própria série de numeração', async () => {
    const r = await withTenant(t.db, ctxB, async (s) => {
      await provisionWorkOrderStates(s);
      const c = await createCustomer(s, { name: 'Cliente B' });
      const nat = await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'corretiva',
        label: 'Corretiva',
      });
      return createWorkOrder(s, { customerId: c, workOrderTypeId: nat, title: 'Primeira da B' });
    });
    expect(r.number).toBe(`WO-${new Date().getUTCFullYear()}-0001`);
  });
});
