/**
 * Avaliação e assinatura da OS pelo solicitante (conversa com o cliente, 21/10/2026).
 *
 * O que se persegue: quem avalia (só quem pediu), quando (só concluída), quantas vezes (uma),
 * que a nota e a assinatura nascem juntas, e a trava de "obrigar" a avaliar antes de pedir de novo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionFactoryRoles } from '../rbac';
import { provisionWorkOrderStates, createWorkOrder } from '../work-orders';
import { createServiceRequest } from '../service-requests';
import { workOrderRating } from '../metrics';
import {
  pendingEvaluations,
  evaluateWorkOrder,
  getWorkOrderEvaluation,
  assertSemAvaliacaoPendente,
} from '../avaliacao-os';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId();
const USER_COORD = newId(),
  MEM_COORD = newId();
const USER_SOL = newId(),
  MEM_SOL = newId();
const USER_OUTRA = newId(),
  MEM_OUTRA = newId();

const ctxDe = (membershipId: string, actorId: string, requestId: string) =>
  buildContext({
    organizationId: ORG,
    actorId,
    membershipId,
    requestId,
    permissions: PERMISSION_KEYS,
  });
const ctxCoord = ctxDe(MEM_COORD, USER_COORD, 'avaliacao-coord');
const ctxSol = ctxDe(MEM_SOL, USER_SOL, 'avaliacao-sol');
const ctxOutra = ctxDe(MEM_OUTRA, USER_OUTRA, 'avaliacao-outra');

let t: TestDatabase;
let cliente: string, local: string, ativo: string, natureza: string;
let osConcluida: string, osEmAndamento: string;

/** Marca a OS como concluída sem atravessar o fluxo de execução (que não é o assunto aqui). */
async function concluir(osId: string): Promise<void> {
  await t.admin.transaction(async (tx) => {
    await tx.query(`SET LOCAL session_replication_role = replica`);
    await tx.query(
      `UPDATE aurora.work_orders SET status_category = 'done', completed_at = now(), resolution = 'Trocado o sensor.'
        WHERE id = $1`,
      [osId]
    );
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER_COORD, membershipId: MEM_COORD },
    { slug: 'aval', name: 'Prestadora', email: 'coord@aval.test', userName: 'Coordenadora' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: USER_SOL, membershipId: MEM_SOL },
    { email: 'sol@aval.test', userName: 'Sônia Solicitante', seatType: 'portal' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: USER_OUTRA, membershipId: MEM_OUTRA },
    { email: 'outra@aval.test', userName: 'Outra Pessoa', seatType: 'portal' }
  );

  await withTenant(t.db, ctxCoord, async (s) => {
    await provisionFactoryRoles(s);
    await provisionWorkOrderStates(s);
    const lt = await provisionStarterLocationTypes(s);
    cliente = await createCustomer(s, { name: 'Hospital' });
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
  });

  // Duas solicitações da Sônia, cada uma com uma OS: uma concluída, outra ainda em andamento.
  await withTenant(t.db, ctxSol, async (s) => {
    const sr1 = await createServiceRequest(s, {
      customerId: cliente,
      summary: 'Ventilador alarmando',
      submit: true,
    });
    const sr2 = await createServiceRequest(s, {
      customerId: cliente,
      summary: 'Ventilador sem tela',
      submit: true,
    });
    osConcluida = (
      await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Reparo do alarme',
        locationId: local,
        assetId: ativo,
        serviceRequestId: sr1.id,
        publish: true,
      })
    ).id;
    osEmAndamento = (
      await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Reparo da tela',
        locationId: local,
        assetId: ativo,
        serviceRequestId: sr2.id,
        publish: true,
      })
    ).id;
  });
  await concluir(osConcluida);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('pendências de avaliação', () => {
  it('lista só a OS concluída que a pessoa pediu — a que ainda anda, não', async () => {
    const p = await withTenant(t.db, ctxSol, (s) => pendingEvaluations(s, MEM_SOL));
    expect(p.map((x) => x.work_order_id)).toEqual([osConcluida]);
    expect(p[0]!.title).toBe('Reparo do alarme');
    expect(p[0]!.customer_name).toBe('Hospital');
  });

  it('quem não pediu nada não tem pendência', async () => {
    expect(await withTenant(t.db, ctxOutra, (s) => pendingEvaluations(s, MEM_OUTRA))).toEqual([]);
  });
});

describe('a trava de "obrigar"', () => {
  it('com pendência, não se abre chamado novo: a mensagem diz quantas faltam', async () => {
    await expect(withTenant(t.db, ctxSol, (s) => assertSemAvaliacaoPendente(s, MEM_SOL))).rejects.toThrow(
      /1 ordem de serviço concluída para avaliar e assinar/
    );
  });

  it('sem pendência, passa', async () => {
    await expect(
      withTenant(t.db, ctxOutra, (s) => assertSemAvaliacaoPendente(s, MEM_OUTRA))
    ).resolves.toBeUndefined();
  });

  it('a organização pode desligar a trava (settings.evaluationRequired = false)', async () => {
    await t.admin.query(
      `UPDATE aurora.organizations SET settings = settings || '{"evaluationRequired": false}'::jsonb WHERE id = $1`,
      [ORG]
    );
    await expect(
      withTenant(t.db, ctxSol, (s) => assertSemAvaliacaoPendente(s, MEM_SOL))
    ).resolves.toBeUndefined();
    await t.admin.query(
      `UPDATE aurora.organizations SET settings = settings - 'evaluationRequired' WHERE id = $1`,
      [ORG]
    );
  });
});

describe('avaliar e assinar', () => {
  it('recusa nota fora de 1 a 5', async () => {
    for (const nota of [0, 6, 3.5]) {
      await expect(
        withTenant(t.db, ctxSol, (s) => evaluateWorkOrder(s, MEM_SOL, osConcluida, { rating: nota }))
      ).rejects.toThrow(/1 a 5/);
    }
  });

  it('quem não pediu a OS recebe "não existe" — e não descobre que ela existe', async () => {
    await expect(
      withTenant(t.db, ctxOutra, (s) => evaluateWorkOrder(s, MEM_OUTRA, osConcluida, { rating: 5 }))
    ).rejects.toThrow(/não encontrad|nao encontrad|Ordem de serviço/i);
  });

  it('OS que ainda não terminou não se avalia', async () => {
    await expect(
      withTenant(t.db, ctxSol, (s) => evaluateWorkOrder(s, MEM_SOL, osEmAndamento, { rating: 5 }))
    ).rejects.toThrow(/quando a ordem de serviço é concluída/);
  });

  it('avalia e assina no mesmo ato: nota, comentário e uma assinatura pela sessão com o e-mail', async () => {
    const r = await withTenant(t.db, ctxSol, (s) =>
      evaluateWorkOrder(s, MEM_SOL, osConcluida, { rating: 4, comment: '  Atendimento rápido.  ' })
    );
    const ev = await withTenant(t.db, ctxSol, (s) => getWorkOrderEvaluation(s, osConcluida));
    expect(ev).toMatchObject({
      id: r.id,
      rating: 4,
      comment: 'Atendimento rápido.',
      evaluator_name: 'Sônia Solicitante',
    });

    const [ass] = await t.admin.query<{
      method: string;
      signer_role: string;
      signer_email: string;
      signed_content_sha256: string;
    }>(
      `SELECT method::text, signer_role::text, signer_email, signed_content_sha256 FROM aurora.signatures WHERE id = $1`,
      [r.signatureId]
    );
    expect(ass).toMatchObject({ method: 'session', signer_role: 'customer', signer_email: 'sol@aval.test' });
    expect(ass!.signed_content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é uma vez só: reavaliar até a nota melhorar não vale', async () => {
    await expect(
      withTenant(t.db, ctxSol, (s) => evaluateWorkOrder(s, MEM_SOL, osConcluida, { rating: 5 }))
    ).rejects.toThrow(/já foi avaliada/);
  });

  it('depois de avaliar, a pendência some e a trava solta', async () => {
    expect(await withTenant(t.db, ctxSol, (s) => pendingEvaluations(s, MEM_SOL))).toEqual([]);
    await expect(
      withTenant(t.db, ctxSol, (s) => assertSemAvaliacaoPendente(s, MEM_SOL))
    ).resolves.toBeUndefined();
  });
});

describe('indicador: avaliação das ordens de serviço', () => {
  it('média, quantidade e distribuição saem das OS avaliadas e assinadas; fora do período é nulo, e não zero', async () => {
    const agora = Date.now();
    const noPeriodo = { from: new Date(agora - 86_400_000), to: new Date(agora + 86_400_000) };
    const r = await withTenant(t.db, ctxCoord, (s) => workOrderRating(s, noPeriodo));
    expect(r.metric).toBe('work_order_rating');
    expect(r.data).toEqual({
      average: 4,
      count: 1,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 },
    });

    const antes = { from: new Date(agora - 10 * 86_400_000), to: new Date(agora - 5 * 86_400_000) };
    const vazio = await withTenant(t.db, ctxCoord, (s) => workOrderRating(s, antes));
    expect(vazio.data.average).toBeNull();
    expect(vazio.data.count).toBe(0);
  });
});
