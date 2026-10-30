/**
 * Aurora — SLA contra o banco (SPEC v0.2 §11 · EPIC-010).
 *
 * O que esta suíte prova, e que nenhuma outra prova: que a decisão do ADR-004
 * — falta de peça NÃO pausa o relógio, espera pelo cliente pausa — vale de
 * ponta a ponta, do motivo cadastrado até o prazo recalculado.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { createServiceRequest, transitionRequest } from '../service-requests';
import {
  createSlaPolicy,
  setSlaTarget,
  slaStatus,
  sweepSlaClocks,
  slaPolicySnapshot,
  loadCalendar,
} from '../sla';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'sla',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, setor: string, ativo: string, natureza: string;
let politica: string, politicaVip: string;
let motivos: Map<string, string>;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'sla', name: 'Rede', email: 'a@sla.test', userName: 'A' }
  );

  await withTenant(t.db, ctx, async (s) => {
    const estados = await provisionWorkOrderStates(s);
    motivos = estados.waitReasons;

    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
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
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });

    // Sem calendário: 24×7, que é o padrão de quem não configurou nada.
    politica = await createSlaPolicy(s, { name: 'Padrão', isDefault: true });
    await setSlaTarget(s, politica, 'urgent', 'response', 30, false);
    await setSlaTarget(s, politica, 'urgent', 'onsite', 120, false);
    await setSlaTarget(s, politica, 'urgent', 'resolution', 240, false);
    await setSlaTarget(s, politica, 'none', 'resolution', 10_080, false);

    politicaVip = await createSlaPolicy(s, { name: 'Equipamento crítico' });
    await setSlaTarget(s, politicaVip, 'urgent', 'resolution', 60, false);

    await s.query(`UPDATE aurora.organizations SET default_sla_policy_id = $1 WHERE id = $2`, [
      politica,
      ORG,
    ]);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOs(prioridade = 'urgent', over: Record<string, unknown> = {}) {
  return withTenant(t.db, ctx, (s) =>
    createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'OS com SLA',
      locationId: setor,
      assetId: ativo,
      priority: prioridade as never,
      ...over,
    })
  );
}

describe('cascata de resolução da política', () => {
  it('sem política no ativo nem no cliente, vale a da organização', async () => {
    const os = await novaOs();
    const nome = await withTenant(t.db, ctx, (s) => slaPolicySnapshot(s, 'work_order', os.id));
    expect(nome).toBe('Padrão');
  });

  it('a política do cliente vence a da organização', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.customers SET default_sla_policy_id = $1 WHERE id = $2`, [politicaVip, cliente])
    );
    const os = await novaOs();
    const nome = await withTenant(t.db, ctx, (s) => slaPolicySnapshot(s, 'work_order', os.id));
    expect(nome).toBe('Equipamento crítico');
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.customers SET default_sla_policy_id = NULL WHERE id = $1`, [cliente])
    );
  });

  it('a política do ativo vence a do cliente', async () => {
    await withTenant(t.db, ctx, async (s) => {
      await s.query(`UPDATE aurora.customers SET default_sla_policy_id = $1 WHERE id = $2`, [
        politica,
        cliente,
      ]);
      await s.query(`UPDATE aurora.assets SET sla_policy_id = $1 WHERE id = $2`, [politicaVip, ativo]);
    });
    const os = await novaOs();
    const nome = await withTenant(t.db, ctx, (s) => slaPolicySnapshot(s, 'work_order', os.id));
    expect(nome).toBe('Equipamento crítico');
    await withTenant(t.db, ctx, async (s) => {
      await s.query(`UPDATE aurora.assets SET sla_policy_id = NULL WHERE id = $1`, [ativo]);
      await s.query(`UPDATE aurora.customers SET default_sla_policy_id = NULL WHERE id = $1`, [cliente]);
    });
  });

  /*
   * ATV-15 (pedido do cliente, 19/10/2026 · 0085): o SLA de cada equipamento liga e desliga.
   * Desligado, a cascata devolve nula — e sem política nenhum relógio abre, nem de OS nem de
   * chamado, mesmo com política no próprio equipamento, no cliente e na organização.
   */
  it('SLA DESABILITADO no equipamento: OS e chamado dele não abrem relógio', async () => {
    await withTenant(t.db, ctx, async (s) => {
      await s.query(`UPDATE aurora.customers SET default_sla_policy_id = $1 WHERE id = $2`, [
        politica,
        cliente,
      ]);
      await s.query(`UPDATE aurora.assets SET sla_enabled = false, sla_policy_id = $1 WHERE id = $2`, [
        politicaVip,
        ativo,
      ]);
    });
    try {
      const [resolvida] = await withTenant(t.db, ctx, (s) =>
        s.query<{ id: string | null }>(`SELECT aurora.resolve_sla_policy($1, $2) AS id`, [ativo, cliente])
      );
      expect(resolvida!.id).toBeNull();

      const os = await novaOs();
      expect(await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id))).toEqual([]);

      const pedido = await withTenant(t.db, ctx, (s) =>
        createServiceRequest(s, {
          customerId: cliente,
          summary: 'Chamado de equipamento sem SLA',
          locationId: setor,
          assetId: ativo,
          requestedPriority: 'urgent',
        })
      );
      expect(await withTenant(t.db, ctx, (s) => slaStatus(s, 'service_request', pedido.id))).toEqual([]);

      // O desligamento é do EQUIPAMENTO: OS sem equipamento, do mesmo cliente, segue com relógio.
      const semAtivo = await novaOs('urgent', { assetId: null });
      const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', semAtivo.id));
      expect(relogios.map((r) => r.kind).sort()).toEqual(['onsite', 'resolution']);
    } finally {
      await withTenant(t.db, ctx, async (s) => {
        await s.query(`UPDATE aurora.assets SET sla_enabled = true, sla_policy_id = NULL WHERE id = $1`, [
          ativo,
        ]);
        await s.query(`UPDATE aurora.customers SET default_sla_policy_id = NULL WHERE id = $1`, [cliente]);
      });
    }
  });

  it('SLA HABILITADO no equipamento: a política própria dele vale e o relógio abre', async () => {
    await withTenant(t.db, ctx, (s) =>
      s.query(`UPDATE aurora.assets SET sla_enabled = true, sla_policy_id = $1 WHERE id = $2`, [
        politicaVip,
        ativo,
      ])
    );
    try {
      const os = await novaOs();
      expect(await withTenant(t.db, ctx, (s) => slaPolicySnapshot(s, 'work_order', os.id))).toBe(
        'Equipamento crítico'
      );
      const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
      expect(relogios.map((r) => r.kind)).toEqual(['resolution']);
      expect(relogios[0]!.state).toBe('running');
    } finally {
      await withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.assets SET sla_policy_id = NULL WHERE id = $1`, [ativo])
      );
    }
  });

  it('prioridade sem alvo declarado não cria relógio — e isso é legítimo', async () => {
    const os = await novaOs('low');
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios).toEqual([]);
  });
});

describe('os três relógios', () => {
  it('a OS publicada nasce com atendimento e resolução; resposta não é dela', async () => {
    const os = await novaOs();
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios.map((r) => r.kind).sort()).toEqual(['onsite', 'resolution']);
    expect(relogios.every((r) => r.state === 'running')).toBe(true);
  });

  it('a solicitação nasce com o relógio de resposta, e ele encerra na triagem', async () => {
    const pedido = await withTenant(t.db, ctx, (s) =>
      createServiceRequest(s, {
        customerId: cliente,
        summary: 'Chamado urgente',
        locationId: setor,
        assetId: ativo,
        requestedPriority: 'urgent',
      })
    );
    const antes = await withTenant(t.db, ctx, (s) => slaStatus(s, 'service_request', pedido.id));
    expect(antes.map((r) => r.kind)).toEqual(['response']);
    expect(antes[0]!.state).toBe('running');

    await withTenant(t.db, ctx, (s) => transitionRequest(s, pedido.id, 'triage'));
    const depois = await withTenant(t.db, ctx, (s) => slaStatus(s, 'service_request', pedido.id));
    expect(depois[0]!.state).toBe('met');
    expect(depois[0]!.elapsed_business_minutes).toBeGreaterThanOrEqual(0);
  });

  it('iniciar a execução encerra o relógio de atendimento, não o de resolução', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, (s) => transitionWorkOrder(s, os.id, 'in_progress'));
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    const porTipo = new Map(relogios.map((r) => [r.kind, r]));
    expect(porTipo.get('onsite')!.state).toBe('met');
    expect(porTipo.get('resolution')!.state).toBe('running');
  });

  it('concluir encerra o relógio de resolução', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'completed', { resolution: 'Trocada a placa e testado' });
    });
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios.find((r) => r.kind === 'resolution')!.state).toBe('met');
  });
});

describe('ADR-004 no relógio: o motivo decide se o tempo conta', () => {
  it('falta de peça NÃO pausa — o atraso é da organização', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('parts')! });
    });
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios.find((r) => r.kind === 'resolution')!.state).toBe('running');

    const [pausas] = await withTenant(t.db, ctx, (s) =>
      s.query<{ c: number }>(
        `SELECT count(*)::int c FROM aurora.sla_pauses p
           JOIN aurora.sla_clocks k ON k.id = p.clock_id
          WHERE k.document_id = $1`,
        [os.id]
      )
    );
    expect(pausas!.c).toBe(0);
  });

  it('aguardar aprovação de orçamento PAUSA', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('quote_approval')! });
    });
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios.find((r) => r.kind === 'resolution')!.state).toBe('paused');
  });

  it('desbloquear retoma e empurra o prazo pelo tempo perdido', async () => {
    const [os] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT k.document_id AS id FROM aurora.sla_clocks k
          WHERE k.state = 'paused' AND k.document_type = 'work_order' LIMIT 1`
      )
    );
    const [antes] = await withTenant(t.db, ctx, (s) =>
      s.query<{ due_at: string }>(
        `SELECT due_at FROM aurora.sla_clocks WHERE document_id = $1 AND kind = 'resolution'`,
        [os!.id]
      )
    );

    await withTenant(t.db, ctx, (s) => transitionWorkOrder(s, os!.id, 'in_progress'));

    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ due_at: string; state: string; paused_minutes: number }>(
        `SELECT due_at, state::text, paused_minutes FROM aurora.sla_clocks
          WHERE document_id = $1 AND kind = 'resolution'`,
        [os!.id]
      )
    );
    expect(depois!.state).toBe('running');
    expect(new Date(depois!.due_at).getTime()).toBeGreaterThanOrEqual(new Date(antes!.due_at).getTime());

    const [pausa] = await withTenant(t.db, ctx, (s) =>
      s.query<{ resumed_at: string | null; minutes: number }>(
        `SELECT p.resumed_at, p.minutes FROM aurora.sla_pauses p
           JOIN aurora.sla_clocks k ON k.id = p.clock_id
          WHERE k.document_id = $1`,
        [os!.id]
      )
    );
    expect(pausa!.resumed_at).not.toBeNull();
  });

  it('pausar duas vezes o mesmo relógio é impossível', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'waiting', { waitReasonId: motivos.get('customer_response')! });
    });
    const [clock] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.sla_clocks WHERE document_id = $1 AND kind = 'resolution'`,
        [os.id]
      )
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.sla_pauses (id, organization_id, clock_id, paused_at)
           VALUES ($1, $2, $3, now())`,
          [newId(), ORG, clock!.id]
        )
      )
    ).rejects.toThrow(/sla_pauses_one_open_uq|já existe/i);
  });
});

describe('cancelar descarta o prazo, não o estoura', () => {
  it('OS cancelada tem os relógios cancelados', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, os.id, 'cancelled', { cancellationReason: 'cliente desistiu do serviço' })
    );
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', os.id));
    expect(relogios.every((r) => r.state === 'cancelled')).toBe(true);
  });

  it('solicitação recusada também descarta o relógio de resposta', async () => {
    const { pedido, motivo } = await withTenant(t.db, ctx, async (s) => {
      const motivo = await createCatalogItem(s, {
        catalogKey: 'rejection_reason',
        key: 'fora_escopo',
        label: 'Fora de escopo',
      });
      const r = await createServiceRequest(s, {
        customerId: cliente,
        summary: 'Vai ser recusada',
        requestedPriority: 'urgent',
      });
      await transitionRequest(s, r.id, 'triage');
      return { pedido: r.id, motivo };
    });
    await withTenant(t.db, ctx, (s) =>
      transitionRequest(s, pedido, 'rejected', { rejectionReasonId: motivo })
    );
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'service_request', pedido));
    // o de resposta já tinha encerrado na triagem; nada fica correndo
    expect(relogios.every((r) => r.state !== 'running' && r.state !== 'paused')).toBe(true);
  });
});

describe('reabrir cria relógio novo — é assim que reincidência se mede', () => {
  it('a OS reaberta tem dois relógios de resolução, com tentativas diferentes', async () => {
    const os = await novaOs();
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      await transitionWorkOrder(s, os.id, 'completed', { resolution: 'Ajuste executado' });
      await transitionWorkOrder(s, os.id, 'validated');
      await transitionWorkOrder(s, os.id, 'closed');
      await transitionWorkOrder(s, os.id, 'in_progress', { reopenReason: 'o problema voltou em dois dias' });
    });

    const relogios = await withTenant(t.db, ctx, (s) =>
      s.query<{ kind: string; attempt: number; state: string }>(
        `SELECT kind::text, attempt, state::text FROM aurora.sla_clocks
          WHERE document_id = $1 AND kind = 'resolution' ORDER BY attempt`,
        [os.id]
      )
    );
    expect(relogios).toHaveLength(2);
    expect(relogios[0]!.attempt).toBe(1);
    expect(relogios[0]!.state).toBe('met');
    expect(relogios[1]!.attempt).toBe(2);
    expect(relogios[1]!.state).toBe('running');
  });
});

describe('relógio encerrado é imutável', () => {
  it('não se corrige um SLA depois do fato', async () => {
    const [encerrado] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.sla_clocks WHERE state = 'met' LIMIT 1`)
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.sla_clocks SET state = 'running' WHERE id = $1`, [encerrado!.id])
      )
    ).rejects.toThrow(/já encerrado.*não se altera/);
  });

  it('o alvo congelado não se altera nem com o relógio correndo', async () => {
    const [correndo] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.sla_clocks WHERE state = 'running' LIMIT 1`)
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.sla_clocks SET target_minutes = 9999 WHERE id = $1`, [correndo!.id])
      )
    ).rejects.toThrow(/congelados na abertura/);
  });

  it('relógio não se apaga', async () => {
    const [algum] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>('SELECT id FROM aurora.sla_clocks LIMIT 1')
    );
    await expect(
      withTenant(t.db, ctx, (s) => s.query('DELETE FROM aurora.sla_clocks WHERE id = $1', [algum!.id]))
    ).rejects.toThrow(/permission denied|permissão/i);
  });
});

describe('varredura de aviso e violação', () => {
  it('avisa aos 80 % e marca violação no vencimento, uma vez cada', async () => {
    const os = await novaOs();
    const [clock] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string; started_at: string }>(
        `SELECT id, started_at FROM aurora.sla_clocks WHERE document_id = $1 AND kind = 'resolution'`,
        [os.id]
      )
    );
    const inicio = new Date(clock!.started_at);

    // 240 minutos de alvo: aos 200 já passou de 80 %
    const aos200 = new Date(inicio.getTime() + 200 * 60_000);
    const primeira = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s, aos200));
    expect(primeira.warned).toBeGreaterThanOrEqual(1);

    // rodar de novo no mesmo instante não avisa outra vez
    const segunda = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s, aos200));
    expect(segunda.warned).toBe(0);

    const aos300 = new Date(inicio.getTime() + 300 * 60_000);
    const terceira = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s, aos300));
    expect(terceira.breached).toBeGreaterThanOrEqual(1);

    /**
     * Estourar o prazo NÃO encerra o relógio: o trabalho continua, e o tempo
     * real só se sabe na conclusão. Se "violado" fosse estado terminal, o
     * relatório perderia a diferença entre "estourou e foi resolvido em três
     * dias" e "estourou".
     */
    const [depois] = await withTenant(t.db, ctx, (s) =>
      s.query<{ state: string; breached_at: string; stopped_at: string | null }>(
        `SELECT state::text, breached_at, stopped_at FROM aurora.sla_clocks WHERE id = $1`,
        [clock!.id]
      )
    );
    expect(depois!.state).toBe('running');
    expect(depois!.breached_at).not.toBeNull();
    expect(depois!.stopped_at).toBeNull();

    // varrer de novo não carimba nem avisa outra vez
    const quarta = await withTenant(t.db, ctx, (s) => sweepSlaClocks(s, aos300));
    expect(quarta.breached).toBe(0);
  });

  it('concluir depois do carimbo registra violação, não cumprimento', async () => {
    const [carimbado] = await withTenant(t.db, ctx, (s) =>
      s.query<{ document_id: string }>(
        `SELECT document_id FROM aurora.sla_clocks
          WHERE breached_at IS NOT NULL AND state = 'running' AND kind = 'resolution' LIMIT 1`
      )
    );
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, carimbado!.document_id, 'in_progress');
      await transitionWorkOrder(s, carimbado!.document_id, 'completed', {
        resolution: 'Resolvido, porém fora do prazo',
      });
    });
    const relogios = await withTenant(t.db, ctx, (s) => slaStatus(s, 'work_order', carimbado!.document_id));
    const resolucao = relogios.find((r) => r.kind === 'resolution')!;
    expect(resolucao.state).toBe('breached');
    expect(resolucao.breached_at).not.toBeNull();
  });

  it('a violação emite evento de domínio', async () => {
    const eventos = await withTenant(t.db, ctx, (s) =>
      s.query<{ type: string }>(`SELECT DISTINCT type FROM aurora.domain_events WHERE type LIKE 'sla.%'`)
    );
    const tipos = eventos.map((e) => e.type);
    expect(tipos).toContain('sla.breached');
    expect(tipos).toContain('sla.met');
    expect(tipos).toContain('sla.warning');
  });
});

describe('calendário do local', () => {
  it('sem calendário configurado, o padrão é 24×7 — SLA que funciona, não que explode', async () => {
    const cal = await withTenant(t.db, ctx, (s) => loadCalendar(s, null, 'America/Sao_Paulo'));
    expect(cal.timeZone).toBe('America/Sao_Paulo');
    expect(cal.windows).toHaveLength(7);
  });

  it('o calendário é congelado no relógio: mudá-lo depois não reescreve o passado', async () => {
    const os = await novaOs();
    const [antes] = await withTenant(t.db, ctx, (s) =>
      s.query<{ calendar_snapshot: { windows: unknown[] } }>(
        `SELECT calendar_snapshot FROM aurora.sla_clocks WHERE document_id = $1 LIMIT 1`,
        [os.id]
      )
    );
    expect(antes!.calendar_snapshot.windows.length).toBeGreaterThan(0);

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.sla_clocks SET calendar_snapshot = '{}'::jsonb WHERE document_id = $1`, [
          os.id,
        ])
      )
    ).rejects.toThrow(/congelados na abertura/);
  });
});
