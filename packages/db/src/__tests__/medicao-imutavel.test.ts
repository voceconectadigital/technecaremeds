/**
 * Aurora — a medição deixa de ser sobrescrita sem rastro (0047 · gap V2 P0.1).
 *
 * O que estas provas garantem, na ordem em que o defeito antigo os violava:
 *
 *  · CORRIGIR PRESERVA O ORIGINAL — o valor anterior vai inteiro para o
 *    histórico, com quem e quando o substituiu;
 *  · ECO NÃO É CORREÇÃO — reenviar o mesmo valor não cria revisão;
 *  · A APLICAÇÃO NÃO APAGA NEM FORJA — `aurora_app` não apaga resposta e não
 *    escreve no histórico; só o gatilho escreve;
 *  · A TRILHA EXISTE — `audit_logs` passa a registrar as respostas;
 *  · O HISTÓRICO NÃO VAZA — outra organização não enxerga uma linha dele.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS, NotFoundError } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import {
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  answerChecklistItem,
  answerRevisions,
} from '../execution';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const CORRETOR = newId(),
  CORRETOR_MEM = newId();
const OUTRA_ORG = newId(),
  OUTRO_USER = newId(),
  OUTRO_MEM = newId();

const ctxDe = (org: string, user: string, mem: string) =>
  buildContext({
    organizationId: org,
    actorId: user,
    membershipId: mem,
    requestId: 'medicao',
    permissions: PERMISSION_KEYS,
  });
const ctx = ctxDe(ORG, USER, MEM);
const ctxCorretor = ctxDe(ORG, CORRETOR, CORRETOR_MEM);
const ctxOutra = ctxDe(OUTRA_ORG, OUTRO_USER, OUTRO_MEM);

let t: TestDatabase;
let resposta = '';
let itemPressao = '';
let itemObs = '';

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'medicao', name: 'Prestadora', email: 'tec@medicao.test', userName: 'Técnica' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: CORRETOR, membershipId: CORRETOR_MEM },
    { email: 'rt@medicao.test', userName: 'Responsável técnico' }
  );
  await seedOrganization(
    t,
    { organizationId: OUTRA_ORG, userId: OUTRO_USER, membershipId: OUTRO_MEM },
    { slug: 'outra-medicao', name: 'Outra', email: 'x@outra-medicao.test', userName: 'Alheio' }
  );

  resposta = await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Hospital', isInternal: true });
    const setor = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'UTI',
    });
    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    const ativo = await createAsset(s, {
      name: 'Ventilador 01',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    const tpl = await createChecklistTemplate(s, { key: 'pressao', title: 'Teste de pressão' });
    itemPressao = await addChecklistItem(s, {
      templateId: tpl,
      kind: 'number',
      label: 'Pressão (cmH₂O)',
      minValue: 20,
      maxValue: 40,
      unit: 'cmH2O',
    });
    itemObs = await addChecklistItem(s, { templateId: tpl, kind: 'text', label: 'Observação', position: 1 });
    await publishChecklist(s, tpl);

    const os = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Medição',
      locationId: setor,
      assetId: ativo,
    });
    await transitionWorkOrder(s, os.id, 'in_progress');
    return attachChecklist(s, os.id, tpl);
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('corrigir preserva o original', () => {
  it('a primeira resposta é a revisão 1', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(s, resposta, itemPressao, { number: 18 })
    );
    expect(r.revision).toBe(1);
    expect(r.verdict).toBe('fail');
  });

  it('a correção vira revisão 2, e o 18 continua existindo — com quem e quando corrigiu', async () => {
    const r = await withTenant(t.db, ctxCorretor, (s) =>
      answerChecklistItem(
        s,
        resposta,
        itemPressao,
        { number: 25 },
        { correctionReason: 'transcrição errada do display' }
      )
    );
    expect(r.revision).toBe(2);
    expect(r.verdict).toBe('pass');

    const historico = await withTenant(t.db, ctx, (s) => answerRevisions(s, resposta));
    const pressao = historico.filter((h) => h.item_id === itemPressao);
    expect(pressao.map((h) => [h.revision, h.value_number, h.current])).toEqual([
      [1, 18, false],
      [2, 25, true],
    ]);

    const original = pressao[0]!;
    expect(original.verdict).toBe('fail');
    expect(original.measured_by).toBe(USER);
    expect(original.superseded_by).toBe(CORRETOR);
    expect(original.superseded_at).not.toBeNull();

    const vigente = pressao[1]!;
    expect(vigente.measured_by).toBe(CORRETOR);
    expect(vigente.correction_reason).toBe('transcrição errada do display');
  });

  it('reenviar o MESMO valor não cria revisão — eco não é correção', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(s, resposta, itemPressao, { number: 25 })
    );
    expect(r.revision).toBe(2);

    const [c] = await t.raw(
      `SELECT count(*)::int AS c FROM aurora.checklist_answer_revisions WHERE response_id = $1`,
      [resposta]
    );
    expect(c!.c).toBe(1);
  });

  it('a terceira correção arquiva a segunda, sem perder a primeira', async () => {
    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, itemPressao, { number: 26 }));
    const historico = await withTenant(t.db, ctx, (s) => answerRevisions(s, resposta));
    expect(historico.filter((h) => h.item_id === itemPressao).map((h) => h.value_number)).toEqual([
      18, 25, 26,
    ]);
  });

  it('continua havendo UMA resposta vigente por item — nenhum leitor antigo conta dobrado', async () => {
    const [c] = await t.raw(
      `SELECT count(*)::int AS c FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2`,
      [resposta, itemPressao]
    );
    expect(c!.c).toBe(1);
  });
});

describe('a aplicação não apaga nem forja', () => {
  it('aurora_app não apaga uma resposta', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`DELETE FROM aurora.checklist_answers WHERE response_id = $1`, [resposta])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('aurora_app não escreve no histórico — nem insere, nem altera, nem apaga', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.checklist_answer_revisions SET value_number = 30 WHERE response_id = $1`, [
          resposta,
        ])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`DELETE FROM aurora.checklist_answer_revisions WHERE response_id = $1`, [resposta])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('nem o dono reescreve o histórico', async () => {
    await expect(
      t.raw(`UPDATE aurora.checklist_answer_revisions SET value_number = 30 WHERE response_id = $1`, [
        resposta,
      ])
    ).rejects.toThrow(/não se altera/);
  });

  it('a identidade da resposta é imutável — mover para outro item é recusado', async () => {
    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, itemObs, { text: 'ok' }));
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.checklist_answers SET item_id = $2 WHERE response_id = $1 AND item_id = $3`, [
          resposta,
          itemPressao,
          itemObs,
        ])
      )
    ).rejects.toThrow(/imutável|pertence a outro|duplicate|ca_response_item_uq/i);
  });
});

describe('a trilha de auditoria cobre as respostas', () => {
  it('criação e correção aparecem em audit_logs, com o valor anterior no diff', async () => {
    const linhas = await t.raw(
      `SELECT action::text AS action, changes, actor_user_id
         FROM aurora.audit_logs
        WHERE entity_type = 'checklist_answers' AND organization_id = $1
        ORDER BY id`,
      [ORG]
    );
    expect(linhas.some((l) => l.action === 'create')).toBe(true);
    const correcao = linhas.find(
      (l) =>
        l.action === 'update' &&
        (l.changes as Record<string, { from: unknown; to: unknown }>).value_number?.to === 25
    );
    expect(correcao).toBeTruthy();
    expect((correcao!.changes as Record<string, { from: unknown }>).value_number!.from).toBe(18);
    expect(correcao!.actor_user_id).toBe(CORRETOR);
  });
});

describe('o histórico não vaza entre organizações', () => {
  it('outra organização não enxerga nenhuma revisão', async () => {
    const linhas = await withTenant(t.db, ctxOutra, (s) =>
      s.query(`SELECT * FROM aurora.checklist_answer_revisions`)
    );
    expect(linhas).toEqual([]);
  });

  it('pedir o histórico de uma resposta alheia é "não existe", não "proibido"', async () => {
    await expect(withTenant(t.db, ctxOutra, (s) => answerRevisions(s, resposta))).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('outra organização não corrige uma resposta alheia', async () => {
    const r = await withTenant(t.db, ctxOutra, (s) =>
      s.query(`UPDATE aurora.checklist_answers SET value_number = 99 WHERE response_id = $1 RETURNING id`, [
        resposta,
      ])
    );
    expect(r).toEqual([]);
    const [vigente] = await t.raw(
      `SELECT value_number::float AS v FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2`,
      [resposta, itemPressao]
    );
    expect(vigente!.v).toBe(26);
  });
});
