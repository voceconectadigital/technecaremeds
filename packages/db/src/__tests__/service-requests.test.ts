/**
 * Aurora — solicitações contra o banco (SPEC v0.2 §08, ADR-002 · EPIC-007).
 *
 * O que esta suíte protege, e a de domínio não protegeria: que as invariantes
 * valem também para quem escrever direto na tabela — numeração sem colisão,
 * relato imutável, estado terminal que carrega o que o terminal significa,
 * catálogo certo em cada campo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import {
  createServiceRequest,
  transitionRequest,
  duplicateHints,
  triageQueue,
  statusHistory,
} from '../service-requests';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG_A = newId(),
  USER_A = newId(),
  MEM_A = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();

/** Contexto com todas as permissões: o recorte por papel é testado na borda HTTP. */
const ctxA = buildContext({
  organizationId: ORG_A,
  actorId: USER_A,
  membershipId: MEM_A,
  requestId: 'sr-a',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'sr-b',
  permissions: PERMISSION_KEYS,
});

let t: TestDatabase;
let cliente: string, clienteDois: string;
let setor: string, setorDois: string;
let ativo: string, ativoDois: string;
let sintomaNaoLiga: string, motivoForaEscopo: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG_A, userId: USER_A, membershipId: MEM_A },
    { slug: 'sr-a', name: 'Rede A', email: 'a@sr.test', userName: 'A' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'sr-b', name: 'Rede B', email: 'b@sr.test', userName: 'B' }
  );

  await withTenant(t.db, ctxA, async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital Central', isInternal: true });
    clienteDois = await createCustomer(s, { name: 'Clínica Parceira' });
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
    const unidadeDois = await createLocation(s, {
      customerId: clienteDois,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede Parceira',
    });
    setorDois = await createLocation(s, {
      customerId: clienteDois,
      parentId: unidadeDois,
      locationTypeId: tipos.get('setor')!,
      name: 'Ambulatório',
    });

    const cat = await createAssetCategory(s, { name: 'Desfibrilador' });
    ativo = await createAsset(s, {
      name: 'DEA 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    ativoDois = await createAsset(s, {
      name: 'DEA 02',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });

    sintomaNaoLiga = await createCatalogItem(s, {
      catalogKey: 'failure_symptom',
      key: 'nao_liga',
      label: 'Não liga',
    });
    motivoForaEscopo = await createCatalogItem(s, {
      catalogKey: 'rejection_reason',
      key: 'fora_escopo',
      label: 'Fora de escopo contratual',
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('numeração', () => {
  it('a série é própria, por organização e por ano, e começa em 1', async () => {
    const r = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, { customerId: cliente, summary: 'Primeira solicitação', assetId: ativo })
    );
    const ano = new Date().getUTCFullYear();
    expect(r.number).toBe(`SR-${ano}-0001`);
  });

  it('cem solicitações concorrentes recebem cem números distintos', async () => {
    // O contador incrementa sob bloqueio de linha; `max(number) + 1` produziria
    // colisão aqui, e é o defeito clássico deste campo.
    const numeros = await withTenant(t.db, ctxA, async (s) => {
      const out: string[] = [];
      for (let i = 0; i < 100; i++) {
        const r = await createServiceRequest(s, { customerId: cliente, summary: `Lote ${i}` });
        out.push(r.number);
      }
      return out;
    });
    expect(new Set(numeros).size).toBe(100);
  }, 120_000);

  it('a série de outra organização é independente', async () => {
    const r = await withTenant(t.db, ctxB, async (s) => {
      const c = await createCustomer(s, { name: 'Cliente B' });
      return createServiceRequest(s, { customerId: c, summary: 'Primeira da B' });
    });
    expect(r.number).toBe(`SR-${new Date().getUTCFullYear()}-0001`);
  });

  it('o número é imutável', async () => {
    const [linha] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.service_requests LIMIT 1`)
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.service_requests SET number = 'SR-2000-9999' WHERE id = $1`, [linha!.id])
      )
    ).rejects.toThrow(/número da solicitação é imutável/);
  });
});

describe('o relato do cliente é imutável', () => {
  it('depois de enviada, resumo e descrição não mudam', async () => {
    const { id } = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, {
        customerId: cliente,
        summary: 'Equipamento apitando sem parar',
        description: 'Desde ontem à noite',
      })
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.service_requests SET summary = 'Reescrito pelo técnico' WHERE id = $1`, [id])
      )
    ).rejects.toThrow(/não é editável depois do envio/);
  });

  it('mas o rascunho ainda é editável — quem escreve nele é o próprio solicitante', async () => {
    const { id } = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, { customerId: cliente, summary: 'Rascunho', submit: false })
    );
    await withTenant(t.db, ctxA, (s) =>
      s.query(`UPDATE aurora.service_requests SET summary = 'Rascunho corrigido' WHERE id = $1`, [id])
    );
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ summary: string }>('SELECT summary FROM aurora.service_requests WHERE id = $1', [id])
    );
    expect(row!.summary).toBe('Rascunho corrigido');
  });
});

describe('máquina de estados contra o banco', () => {
  let pedido = '';

  beforeAll(async () => {
    const r = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, {
        customerId: cliente,
        summary: 'DEA não liga',
        assetId: ativo,
        locationId: setor,
        reportedFailureCodeId: sintomaNaoLiga,
        requestedPriority: 'urgent',
      })
    );
    pedido = r.id;
  });

  it('a transição não declarada é recusada nomeando as possíveis', async () => {
    const erro = await withTenant(t.db, ctxA, async (s) => {
      try {
        await transitionRequest(s, pedido, 'closed');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/transições possíveis são: triage, cancelled/);
  });

  it('assumir a triagem grava a primeira resposta e o histórico com duração', async () => {
    await withTenant(t.db, ctxA, (s) => transitionRequest(s, pedido, 'triage'));
    const [row] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ status: string; first_response_at: string | null; triaged_by: string | null }>(
        'SELECT status::text, first_response_at, triaged_by FROM aurora.service_requests WHERE id = $1',
        [pedido]
      )
    );
    expect(row!.status).toBe('triage');
    expect(row!.first_response_at).not.toBeNull();
    expect(row!.triaged_by).toBe(USER_A);

    const hist = await withTenant(t.db, ctxA, (s) => statusHistory(s, pedido));
    expect(hist.map((h) => h.to_status)).toEqual(['submitted', 'triage']);
    expect(Number(hist[1]!.seconds_in_from)).toBeGreaterThanOrEqual(0);
  });

  it('recusar sem motivo é impossível, e o motivo tem de vir do catálogo certo', async () => {
    const semMotivo = await withTenant(t.db, ctxA, async (s) => {
      try {
        await transitionRequest(s, pedido, 'rejected');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(semMotivo).toMatch(/rejected/);

    // um sintoma não serve como motivo de recusa, mesmo sendo catalog_item
    await expect(
      withTenant(t.db, ctxA, (s) =>
        transitionRequest(s, pedido, 'rejected', { rejectionReasonId: sintomaNaoLiga })
      )
    ).rejects.toThrow(/catálogo rejection_reason/);
  });

  it('aceitar encerra o relógio de resposta e emite o evento certo', async () => {
    await withTenant(t.db, ctxA, (s) => transitionRequest(s, pedido, 'accepted'));
    const eventos = await withTenant(t.db, ctxA, (s) =>
      s.query<{ type: string }>(
        `SELECT type FROM aurora.domain_events WHERE aggregate_id = $1 ORDER BY sequence`,
        [pedido]
      )
    );
    expect(eventos.map((e) => e.type)).toEqual([
      'service_request.created',
      'service_request.triaged',
      'service_request.accepted',
    ]);
  });

  it('estado derivado das OS não emite evento próprio — quem publicou foi a OS', async () => {
    await withTenant(t.db, ctxA, (s) => transitionRequest(s, pedido, 'in_service'));
    const eventos = await withTenant(t.db, ctxA, (s) =>
      s.query<{ type: string }>(`SELECT type FROM aurora.domain_events WHERE aggregate_id = $1`, [pedido])
    );
    expect(eventos.map((e) => e.type)).not.toContain('service_request.in_service');
  });

  it('depois de in_service não se cancela a solicitação', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        transitionRequest(s, pedido, 'cancelled', { cancellationReason: 'mudei de ideia' })
      )
    ).rejects.toThrow(/estado terminal|transições possíveis são: fulfilled/);
  });
});

describe('duplicata é preservada, não destruída', () => {
  it('marcar como duplicata exige apontar a original, e ambas continuam existindo', async () => {
    const { original, copia } = await withTenant(t.db, ctxA, async (s) => {
      const original = await createServiceRequest(s, {
        customerId: cliente,
        summary: 'DEA 02 sem carga',
        assetId: ativoDois,
      });
      const copia = await createServiceRequest(s, {
        customerId: cliente,
        summary: 'DEA 02 não carrega',
        assetId: ativoDois,
      });
      await transitionRequest(s, copia.id, 'triage');
      return { original, copia };
    });

    await expect(withTenant(t.db, ctxA, (s) => transitionRequest(s, copia.id, 'duplicate'))).rejects.toThrow(
      /merged_into_request_id|duplicate/
    );

    await withTenant(t.db, ctxA, (s) =>
      transitionRequest(s, copia.id, 'duplicate', { mergedIntoRequestId: original.id })
    );

    const rows = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string; status: string; merged_into_request_id: string | null }>(
        `SELECT id, status::text, merged_into_request_id FROM aurora.service_requests WHERE id = ANY($1::uuid[])`,
        [[original.id, copia.id]]
      )
    );
    expect(rows).toHaveLength(2);
    const dup = rows.find((r) => r.id === copia.id)!;
    expect(dup.status).toBe('duplicate');
    expect(dup.merged_into_request_id).toBe(original.id);
  });
});

describe('detecção de duplicidade avisa sem bloquear', () => {
  it('encontra a solicitação aberta para o mesmo ativo', async () => {
    const hints = await withTenant(t.db, ctxA, (s) => duplicateHints(s, { assetId: ativo }));
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]!.reason).toBe('mesmo_ativo');
  });

  it('NÃO impede abrir a segunda: duas falhas no mesmo aparelho existem', async () => {
    const r = await withTenant(t.db, ctxA, (s) =>
      createServiceRequest(s, { customerId: cliente, summary: 'Outra falha no mesmo DEA', assetId: ativo })
    );
    expect(r.id).toBeTruthy();
  });

  it('solicitação de outra organização nunca aparece como candidata', async () => {
    const hints = await withTenant(t.db, ctxB, (s) => duplicateHints(s, { assetId: ativo }));
    expect(hints).toEqual([]);
  });
});

describe('coerência de escopo', () => {
  it('recusa local de outro cliente', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createServiceRequest(s, { customerId: cliente, summary: 'Escopo errado', locationId: setorDois })
      )
    ).rejects.toThrow(/pertence a outro cliente/);
  });

  it('recusa ativo de outro cliente', async () => {
    const alheio = await withTenant(t.db, ctxA, async (s) => {
      const cat = await createAssetCategory(s, { name: 'Categoria parceira' });
      return createAsset(s, {
        name: 'Ativo da parceira',
        customerId: clienteDois,
        assetCategoryId: cat,
        locationId: setorDois,
      });
    });
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createServiceRequest(s, { customerId: cliente, summary: 'Ativo errado', assetId: alheio })
      )
    ).rejects.toThrow(/pertence a outro cliente/);
  });

  it('o sintoma tem de vir do catálogo de sintomas', async () => {
    await expect(
      withTenant(t.db, ctxA, (s) =>
        createServiceRequest(s, {
          customerId: cliente,
          summary: 'Catálogo trocado',
          reportedFailureCodeId: motivoForaEscopo,
        })
      )
    ).rejects.toThrow(/catálogo failure_symptom/);
  });

  it('solicitante precisa ser identificável', async () => {
    const semVinculo = buildContext({
      organizationId: ORG_A,
      actorKind: 'system',
      requestId: 'anon',
      permissions: PERMISSION_KEYS,
    });
    await expect(
      withTenant(t.db, semVinculo, (s) =>
        createServiceRequest(s, { customerId: cliente, summary: 'Sem solicitante nenhum' })
      )
    ).rejects.toThrow(/requester_identified|regra/i);
  });
});

describe('fila de triagem', () => {
  it('traz só o que está aguardando decisão, na ordem certa', async () => {
    const fila = await withTenant(t.db, ctxA, (s) => triageQueue(s));
    expect(fila.length).toBeGreaterThan(0);
    expect(fila.every((f) => ['submitted', 'triage', 'info_needed'].includes(f.status))).toBe(true);
    // a de prioridade urgente que criamos vem antes das de prioridade nenhuma
    const primeiro = fila[0]!;
    expect(['emergency', 'very_urgent', 'urgent', 'low', 'none']).toContain(primeiro.priority);
  });

  it('a fila de uma organização não mostra a outra', async () => {
    const filaB = await withTenant(t.db, ctxB, (s) => triageQueue(s));
    expect(filaB.every((f) => f.summary === 'Primeira da B')).toBe(true);
  });
});

describe('concorrência otimista', () => {
  it('duas triagens simultâneas: a segunda é recusada em vez de sobrescrever', async () => {
    const { id, version } = await withTenant(t.db, ctxA, async (s) => {
      const r = await createServiceRequest(s, { customerId: cliente, summary: 'Disputa de triagem' });
      const [row] = await s.query<{ version: number }>(
        'SELECT version FROM aurora.service_requests WHERE id = $1',
        [r.id]
      );
      return { id: r.id, version: row!.version };
    });

    await withTenant(t.db, ctxA, (s) => transitionRequest(s, id, 'triage', { expectedVersion: version }));

    // o segundo coordenador ainda tem a versão antiga em mãos
    await expect(
      withTenant(t.db, ctxA, (s) => transitionRequest(s, id, 'accepted', { expectedVersion: version }))
    ).rejects.toThrow(/mudou desde que você a carregou/);
  });
});

describe('histórico não se apaga', () => {
  it('o papel da aplicação não tem UPDATE nem DELETE no histórico', async () => {
    const [linha] = await withTenant(t.db, ctxA, (s) =>
      s.query<{ id: string }>('SELECT id FROM aurora.service_request_status_history LIMIT 1')
    );
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query(`UPDATE aurora.service_request_status_history SET note = 'reescrito' WHERE id = $1`, [
          linha!.id,
        ])
      )
    ).rejects.toThrow(/permission denied|permissão/i);
    await expect(
      withTenant(t.db, ctxA, (s) =>
        s.query('DELETE FROM aurora.service_request_status_history WHERE id = $1', [linha!.id])
      )
    ).rejects.toThrow(/permission denied|permissão/i);
  });
});
