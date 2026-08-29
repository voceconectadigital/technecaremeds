/**
 * Aurora — execução contra o banco (SPEC v0.2 §12, §14, ADR-012 · EPIC-011).
 *
 * Critérios de aceite do épico verificados aqui:
 *  · publicar nova versão de checklist NÃO altera respostas anteriores
 *  · item numérico fora da faixa marca reprovado e exige foto quando configurado
 *  · concluir sem cumprir os requisitos devolve a lista do que falta
 *
 * Casos de borda da SPEC: checklist alterado enquanto uma OS o executa; duas
 * pessoas apontando horas ao mesmo tempo; assinatura colhida e OS alterada
 * depois.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import {
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  createNextVersion,
  attachChecklist,
  answerChecklistItem,
  checklistStatus,
  loadChecklistItems,
  startTimer,
  stopTimer,
  logTime,
  attachFile,
  signWorkOrder,
  verifySignatures,
  completionCheck,
  setCompletionRequirements,
} from '../execution';
import { createTestDatabase, seedOrganization, seedMember, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const OUTRO_USER = newId(),
  OUTRO_MEM = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'exec',
  permissions: PERMISSION_KEYS,
  clientIp: '203.0.113.9',
  userAgent: 'aurora-test',
});

let t: TestDatabase;
let cliente: string, setor: string, ativo: string, natureza: string;
let template: string, itemPressao: string, itemAterramento: string, itemOnde: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'exec', name: 'Rede', email: 'a@exec.test', userName: 'Técnica' }
  );
  await seedMember(
    t,
    { organizationId: ORG, userId: OUTRO_USER, membershipId: OUTRO_MEM },
    { email: 'b@exec.test', userName: 'Outro técnico' }
  );

  await withTenant(t.db, ctx, async (s) => {
    await provisionWorkOrderStates(s);
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
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });

    template = await createChecklistTemplate(s, {
      key: 'preventiva_ventilador',
      title: 'Preventiva de ventilador pulmonar',
    });
    itemPressao = await addChecklistItem(s, {
      templateId: template,
      kind: 'number',
      label: 'Pressão de teste (cmH₂O)',
      minValue: 20,
      maxValue: 40,
      unit: 'cmH2O',
      requiresPhotoWhen: 'on_fail',
      failAction: 'block_completion',
      position: 0,
    });
    itemAterramento = await addChecklistItem(s, {
      templateId: template,
      kind: 'boolean',
      label: 'Aterramento íntegro',
      expectedBoolean: true,
      position: 1,
    });
    itemOnde = await addChecklistItem(s, {
      templateId: template,
      kind: 'text',
      label: 'Onde foi observado o problema',
      required: true,
      conditionItemId: itemAterramento,
      conditionEquals: 'false',
      position: 2,
    });
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function novaOsEmExecucao(titulo: string) {
  return withTenant(t.db, ctx, async (s) => {
    const os = await createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: titulo,
      locationId: setor,
      assetId: ativo,
    });
    await transitionWorkOrder(s, os.id, 'in_progress');
    return os.id;
  });
}

describe('publicação e versionamento', () => {
  it('não se publica checklist sem item nenhum', async () => {
    await expect(
      withTenant(t.db, ctx, async (s) => {
        const vazio = await createChecklistTemplate(s, { key: 'vazio', title: 'Vazio' });
        await publishChecklist(s, vazio);
      })
    ).rejects.toThrow(/sem nenhum item/);
  });

  it('só se responde checklist publicado', async () => {
    const os = await novaOsEmExecucao('Antes de publicar');
    await expect(withTenant(t.db, ctx, (s) => attachChecklist(s, os, template))).rejects.toThrow(
      /só se responde checklist publicado/
    );
  });

  it('publicar congela a estrutura: nem editar item, nem acrescentar', async () => {
    await withTenant(t.db, ctx, (s) => publishChecklist(s, template));

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.checklist_items SET label = 'Outro rótulo' WHERE id = $1`, [itemPressao])
      )
    ).rejects.toThrow(/checklist publicado não muda/);

    await expect(
      withTenant(t.db, ctx, (s) =>
        addChecklistItem(s, { templateId: template, kind: 'text', label: 'Item tardio' })
      )
    ).rejects.toThrow(/checklist publicado não muda/);

    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.checklist_templates SET title = 'Outro título' WHERE id = $1`, [template])
      )
    ).rejects.toThrow(/publicada e é imutável/);
  });

  it('a próxima versão nasce em rascunho, com a estrutura copiada', async () => {
    const v2 = await withTenant(t.db, ctx, (s) => createNextVersion(s, template));
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ version: number; status: string; supersedes_id: string }>(
        'SELECT version, status::text, supersedes_id FROM aurora.checklist_templates WHERE id = $1',
        [v2]
      )
    );
    expect(row!.version).toBe(2);
    expect(row!.status).toBe('draft');
    expect(row!.supersedes_id).toBe(template);

    const itensV1 = await withTenant(t.db, ctx, (s) => loadChecklistItems(s, template));
    const itensV2 = await withTenant(t.db, ctx, (s) => loadChecklistItems(s, v2));
    expect(itensV2).toHaveLength(itensV1.length);
    expect(itensV2.map((i) => i.label).sort()).toEqual(itensV1.map((i) => i.label).sort());
    // ids diferentes: são itens novos, de outra versão
    expect(itensV2.map((i) => i.id).some((id) => itensV1.map((x) => x.id).includes(id))).toBe(false);
  });

  it('duas versões em rascunho ao mesmo tempo são impossíveis', async () => {
    await expect(withTenant(t.db, ctx, (s) => createNextVersion(s, template))).rejects.toThrow(
      /ct_one_draft_uq|já existe/i
    );
  });
});

describe('respostas e veredito', () => {
  let os = '';
  let resposta = '';

  beforeAll(async () => {
    os = await novaOsEmExecucao('Preventiva com checklist');
    resposta = await withTenant(t.db, ctx, (s) => attachChecklist(s, os, template));
  });

  it('a resposta congela a chave e a versão do template usado', async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ template_key: string; template_version: number }>(
        'SELECT template_key, template_version FROM aurora.checklist_responses WHERE id = $1',
        [resposta]
      )
    );
    expect(row!.template_key).toBe('preventiva_ventilador');
    expect(row!.template_version).toBe(1);
  });

  it('valor dentro da faixa aprova; fora reprova — o veredito é calculado, não enviado', async () => {
    const dentro = await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(s, resposta, itemPressao, { number: 30 })
    );
    expect(dentro.verdict).toBe('pass');

    const fora = await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(s, resposta, itemPressao, { number: 55 })
    );
    expect(fora.verdict).toBe('fail');
  });

  it('reprovado sem foto trava a completude; com foto, o bloqueio permanece', async () => {
    const semFoto = await withTenant(t.db, ctx, (s) => checklistStatus(s, resposta));
    expect(semFoto.missingPhotos.map((m) => m.itemId)).toContain(itemPressao);

    await withTenant(t.db, ctx, (s) =>
      answerChecklistItem(s, resposta, itemPressao, { number: 55, photoCount: 1 })
    );
    const comFoto = await withTenant(t.db, ctx, (s) => checklistStatus(s, resposta));
    expect(comFoto.missingPhotos).toEqual([]);
    expect(comFoto.blocking.map((b) => b.itemId)).toContain(itemPressao);
  });

  it('o item condicional só é exigido quando a condição vale', async () => {
    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, itemAterramento, { boolean: true }));
    const ok = await withTenant(t.db, ctx, (s) => checklistStatus(s, resposta));
    expect(ok.pending.map((p) => p.itemId)).not.toContain(itemOnde);

    await withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, itemAterramento, { boolean: false }));
    const agora = await withTenant(t.db, ctx, (s) => checklistStatus(s, resposta));
    expect(agora.pending.map((p) => p.itemId)).toContain(itemOnde);
  });

  it('responder duas vezes atualiza, não duplica', async () => {
    const [c] = await withTenant(t.db, ctx, (s) =>
      s.query<{ c: number }>(
        'SELECT count(*)::int c FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2',
        [resposta, itemPressao]
      )
    );
    expect(c!.c).toBe(1);
  });

  it('item de outro checklist é recusado', async () => {
    const outro = await withTenant(t.db, ctx, async (s) => {
      const tpl = await createChecklistTemplate(s, { key: 'outro', title: 'Outro' });
      const it = await addChecklistItem(s, { templateId: tpl, kind: 'text', label: 'Item alheio' });
      await publishChecklist(s, tpl);
      return it;
    });
    await expect(
      withTenant(t.db, ctx, (s) => answerChecklistItem(s, resposta, outro, { text: 'x' }))
    ).rejects.toThrow(/pertence a outro checklist/);
  });
});

describe('a versão nova não altera as respostas antigas — critério de aceite', () => {
  it('publicar a v2 deixa a resposta da v1 exatamente como estava', async () => {
    const os = await novaOsEmExecucao('Respondida na v1');
    const resp = await withTenant(t.db, ctx, async (s) => {
      const r = await attachChecklist(s, os, template);
      await answerChecklistItem(s, r, itemPressao, { number: 25 });
      return r;
    });

    const antes = await withTenant(t.db, ctx, (s) =>
      s.query<{ value_number: string; verdict: string }>(
        'SELECT value_number, verdict::text FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2',
        [resp, itemPressao]
      )
    );

    // A v2 muda a faixa: o que era aprovado passaria a reprovar, se a resposta
    // antiga apontasse para a estrutura nova.
    const [v2] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(
        `SELECT id FROM aurora.checklist_templates WHERE key = 'preventiva_ventilador' AND version = 2`
      )
    );
    await withTenant(t.db, ctx, async (s) => {
      const [itemV2] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.checklist_items WHERE template_id = $1 AND label LIKE 'Pressão%'`,
        [v2!.id]
      );
      await s.query(`UPDATE aurora.checklist_items SET min_value = 30 WHERE id = $1`, [itemV2!.id]);
      await publishChecklist(s, v2!.id);
    });

    const depois = await withTenant(t.db, ctx, (s) =>
      s.query<{ value_number: string; verdict: string }>(
        'SELECT value_number, verdict::text FROM aurora.checklist_answers WHERE response_id = $1 AND item_id = $2',
        [resp, itemPressao]
      )
    );
    expect(depois).toEqual(antes);
    expect(depois[0]!.verdict).toBe('pass');

    // e a resposta continua declarando a versão que de fato usou
    const [r] = await withTenant(t.db, ctx, (s) =>
      s.query<{ template_version: number }>(
        'SELECT template_version FROM aurora.checklist_responses WHERE id = $1',
        [resp]
      )
    );
    expect(r!.template_version).toBe(1);
  });
});

describe('apontamento de horas', () => {
  it('um cronômetro aberto por pessoa', async () => {
    const os1 = await novaOsEmExecucao('Primeira em execução');
    const os2 = await novaOsEmExecucao('Segunda em execução');
    await withTenant(t.db, ctx, (s) => startTimer(s, os1));
    await expect(withTenant(t.db, ctx, (s) => startTimer(s, os2))).rejects.toThrow(
      /te_one_open_per_person|já existe/i
    );
  });

  it('parar o cronômetro devolve os minutos', async () => {
    const [aberto] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.time_entries WHERE ended_at IS NULL LIMIT 1`)
    );
    const minutos = await withTenant(t.db, ctx, (s) => stopTimer(s, aberto!.id, 'ajuste concluído'));
    expect(minutos).toBeGreaterThanOrEqual(0);
  });

  it('parar duas vezes é recusado', async () => {
    const [fechado] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.time_entries WHERE ended_at IS NOT NULL LIMIT 1`)
    );
    await expect(withTenant(t.db, ctx, (s) => stopTimer(s, fechado!.id))).rejects.toThrow(
      /não há cronômetro aberto/
    );
  });

  it('apontamentos da mesma pessoa não se sobrepõem', async () => {
    const os = await novaOsEmExecucao('Apontamento manual');
    await withTenant(t.db, ctx, (s) =>
      logTime(s, {
        workOrderId: os,
        startedAt: new Date('2026-08-20T08:00:00Z'),
        endedAt: new Date('2026-08-20T10:00:00Z'),
        hourlyCost: 80,
      })
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        logTime(s, {
          workOrderId: os,
          startedAt: new Date('2026-08-20T09:00:00Z'),
          endedAt: new Date('2026-08-20T11:00:00Z'),
        })
      )
    ).rejects.toThrow(/já existe apontamento desta pessoa/);
  });

  it('mas outra pessoa pode apontar o mesmo intervalo na mesma OS', async () => {
    const [os] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.work_orders WHERE title = 'Apontamento manual'`)
    );
    const id = await withTenant(t.db, ctx, (s) =>
      logTime(s, {
        workOrderId: os!.id,
        membershipId: OUTRO_MEM,
        startedAt: new Date('2026-08-20T09:00:00Z'),
        endedAt: new Date('2026-08-20T11:00:00Z'),
      })
    );
    expect(id).toBeTruthy();
  });

  it('o custo/hora fica congelado no apontamento', async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ hourly_cost: string }>(
        `SELECT hourly_cost FROM aurora.time_entries WHERE hourly_cost IS NOT NULL LIMIT 1`
      )
    );
    expect(Number(row!.hourly_cost)).toBe(80);
  });

  it('não se aponta hora em OS fechada', async () => {
    const os = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Vai fechar',
        locationId: setor,
      });
      await transitionWorkOrder(s, w.id, 'in_progress');
      await transitionWorkOrder(s, w.id, 'completed', { resolution: 'concluída para o teste' });
      await transitionWorkOrder(s, w.id, 'validated');
      await transitionWorkOrder(s, w.id, 'closed');
      return w.id;
    });
    await expect(
      withTenant(t.db, ctx, (s) =>
        logTime(s, {
          workOrderId: os,
          startedAt: new Date('2026-09-01T08:00:00Z'),
          endedAt: new Date('2026-09-01T09:00:00Z'),
        })
      )
    ).rejects.toThrow(/não se aponta hora/);
  });
});

describe('anexos e assinatura', () => {
  let os = '';

  beforeAll(async () => {
    os = await novaOsEmExecucao('Com assinatura');
    await withTenant(t.db, ctx, async (s) => {
      await transitionWorkOrder(s, os, 'completed', { resolution: 'Manutenção preventiva executada' });
    });
  });

  it('anexo tem finalidade, e a finalidade é consultável', async () => {
    await withTenant(t.db, ctx, async (s) => {
      await attachFile(s, {
        workOrderId: os,
        purpose: 'before',
        fileName: 'antes.jpg',
        contentType: 'image/jpeg',
        byteSize: 12_345,
      });
      await attachFile(s, {
        workOrderId: os,
        purpose: 'after',
        fileName: 'depois.jpg',
        contentType: 'image/jpeg',
        byteSize: 23_456,
      });
    });
    const [c] = await withTenant(t.db, ctx, (s) =>
      s.query<{ c: number }>(
        `SELECT count(*)::int c FROM aurora.attachments WHERE work_order_id = $1 AND purpose = 'after'`,
        [os]
      )
    );
    expect(c!.c).toBe(1);
  });

  it('anexo sem dono é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        attachFile(s, {
          purpose: 'other',
          fileName: 'solto.pdf',
          contentType: 'application/pdf',
          byteSize: 1,
        })
      )
      // Recusado pelo DOMÍNIO agora, antes de chegar ao banco: sem dono não
      // há como gerar a chave de armazenamento, que é namespaceada por
      // entidade.
    ).rejects.toThrow(/precisa pertencer|att_has_owner/i);
  });

  it('assinatura por código exige e-mail; desenhada exige a imagem', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        signWorkOrder(s, os, { signerRole: 'customer', signerName: 'Maria Silva', method: 'email_code' })
      )
    ).rejects.toThrow(/sig_evidence_present|regra/i);

    const r = await withTenant(t.db, ctx, (s) =>
      signWorkOrder(s, os, {
        signerRole: 'customer',
        signerName: 'Maria Silva',
        method: 'email_code',
        signerEmail: 'maria@cliente.test',
      })
    );
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a assinatura guarda IP e agente, para a trilha ficar completa', async () => {
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ client_ip: string; user_agent: string }>(
        `SELECT client_ip, user_agent FROM aurora.signatures WHERE work_order_id = $1`,
        [os]
      )
    );
    expect(row!.client_ip).toBe('203.0.113.9');
    expect(row!.user_agent).toBe('aurora-test');
  });

  /**
   * Caso de borda da SPEC: assinatura coletada e OS alterada em seguida.
   * O produto não impede a alteração — impede fingir que a assinatura ainda
   * cobre o texto novo.
   */
  it('alterar a OS depois de assinada invalida a assinatura, e isso fica visível', async () => {
    const antes = await withTenant(t.db, ctx, (s) => verifySignatures(s, os));
    expect(antes[0]!.still_valid).toBe(true);

    await withTenant(t.db, ctx, (s) =>
      s.query(
        `UPDATE aurora.work_orders SET resolution = 'Texto trocado depois da assinatura' WHERE id = $1`,
        [os]
      )
    );

    const depois = await withTenant(t.db, ctx, (s) => verifySignatures(s, os));
    expect(depois[0]!.still_valid).toBe(false);
    expect(depois[0]!.signer_name).toBe('Maria Silva');
  });

  it('assinatura não se edita nem se apaga', async () => {
    const [sig] = await withTenant(t.db, ctx, (s) =>
      s.query<{ id: string }>('SELECT id FROM aurora.signatures LIMIT 1')
    );
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(`UPDATE aurora.signatures SET signer_name = 'Outro' WHERE id = $1`, [sig!.id])
      )
    ).rejects.toThrow(/permission denied|permissão/i);
    await expect(
      withTenant(t.db, ctx, (s) => s.query('DELETE FROM aurora.signatures WHERE id = $1', [sig!.id]))
    ).rejects.toThrow(/permission denied|permissão/i);
  });
});

describe('bloco de conclusão com fatos reais — critério de aceite', () => {
  it('devolve a lista do que falta, item a item, com o detalhe', async () => {
    const os = await novaOsEmExecucao('Vai faltar quase tudo');
    const r = await withTenant(t.db, ctx, (s) =>
      completionCheck(s, os, [
        'checklist_complete',
        'hours_logged',
        'resolution_filled',
        'photo_before_after',
        'customer_signature',
      ])
    );
    expect(r.ok).toBe(false);
    const porRequisito = new Map(r.missing.map((m) => [m.requirement, m.detail]));
    expect(porRequisito.get('hours_logged')).toMatch(/nenhuma hora/);
    expect(porRequisito.get('resolution_filled')).toMatch(/10 caracteres/);
    expect(porRequisito.get('photo_before_after')).toMatch(/nenhuma foto/);
    expect(porRequisito.get('customer_signature')).toMatch(/assinatura do cliente/);
  });

  it('com tudo cumprido, libera', async () => {
    const os = await novaOsEmExecucao('Vai passar');
    await withTenant(t.db, ctx, async (s) => {
      await logTime(s, {
        workOrderId: os,
        startedAt: new Date('2026-08-21T08:00:00Z'),
        endedAt: new Date('2026-08-21T09:00:00Z'),
      });
      await attachFile(s, {
        workOrderId: os,
        purpose: 'before',
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
      });
      await attachFile(s, {
        workOrderId: os,
        purpose: 'after',
        fileName: 'b.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
      });
      await s.query(`UPDATE aurora.work_orders SET resolution = $2 WHERE id = $1`, [
        os,
        'Substituída a válvula de exalação e testado o conjunto',
      ]);
      await signWorkOrder(s, os, {
        signerRole: 'customer',
        signerName: 'João Cliente',
        method: 'email_code',
        signerEmail: 'joao@cliente.test',
      });
    });

    const r = await withTenant(t.db, ctx, (s) =>
      completionCheck(s, os, [
        'hours_logged',
        'resolution_filled',
        'photo_before_after',
        'customer_signature',
      ])
    );
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('item reprovado com ação de bloqueio impede a conclusão, mesmo com o resto pronto', async () => {
    const os = await novaOsEmExecucao('Reprovada com bloqueio');
    await withTenant(t.db, ctx, async (s) => {
      const resp = await attachChecklist(s, os, template);
      await answerChecklistItem(s, resp, itemPressao, { number: 90, photoCount: 1 });
      await answerChecklistItem(s, resp, itemAterramento, { boolean: true });
      await s.query(`UPDATE aurora.work_orders SET resolution = $2 WHERE id = $1`, [
        os,
        'Ajustes executados conforme procedimento',
      ]);
    });

    const r = await withTenant(t.db, ctx, (s) => completionCheck(s, os, ['resolution_filled']));
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => m.detail.includes('ação de bloqueio'))).toBe(true);
  });
});

describe('o bloco de conclusão agora bloqueia a transição de verdade', () => {
  let naturezaExigente = '';

  beforeAll(async () => {
    await withTenant(t.db, ctx, async (s) => {
      naturezaExigente = await createCatalogItem(s, {
        catalogKey: 'work_order_type',
        key: 'preventiva_rigorosa',
        label: 'Preventiva rigorosa',
      });
      await setCompletionRequirements(s, naturezaExigente, [
        'hours_logged',
        'resolution_filled',
        'photo_before_after',
      ]);
    });
  });

  it('concluir sem cumprir devolve 412 com a lista do que falta', async () => {
    const os = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: naturezaExigente,
        title: 'Preventiva rigorosa',
        locationId: setor,
      });
      await transitionWorkOrder(s, w.id, 'in_progress');
      return w.id;
    });

    const erro = await withTenant(t.db, ctx, async (s) => {
      try {
        await transitionWorkOrder(s, os, 'completed', { resolution: 'Executada conforme procedimento' });
        return null;
      } catch (e) {
        return e as Error & { details?: { missing?: Array<{ requirement: string }> } };
      }
    });
    expect(erro).not.toBeNull();
    expect(erro!.message).toMatch(/faltam requisitos para concluir/);
    const faltando = (erro!.details?.missing ?? []).map((m) => m.requirement);
    expect(faltando).toContain('hours_logged');
    expect(faltando).toContain('photo_before_after');
    // a resolução veio na própria chamada e por isso NÃO consta como pendência
    expect(faltando).not.toContain('resolution_filled');

    // e a OS continua onde estava
    const [row] = await withTenant(t.db, ctx, (s) =>
      s.query<{ status_category: string }>(
        'SELECT status_category::text FROM aurora.work_orders WHERE id = $1',
        [os]
      )
    );
    expect(row!.status_category).toBe('in_progress');
  });

  it('cumpridos os requisitos, a conclusão passa', async () => {
    const os = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: naturezaExigente,
        title: 'Preventiva rigorosa completa',
        locationId: setor,
      });
      await transitionWorkOrder(s, w.id, 'in_progress');
      await logTime(s, {
        workOrderId: w.id,
        startedAt: new Date('2026-08-22T08:00:00Z'),
        endedAt: new Date('2026-08-22T09:00:00Z'),
      });
      for (const purpose of ['before', 'after'] as const) {
        await attachFile(s, {
          workOrderId: w.id,
          purpose,
          fileName: `${purpose}.jpg`,
          contentType: 'image/jpeg',
          byteSize: 10,
        });
      }
      return w.id;
    });

    const r = await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, os, 'completed', {
        resolution: 'Substituídos os filtros e testado o conjunto',
      })
    );
    expect(r.category).toBe('review');
  });

  it('natureza sem requisitos configurados não impõe burocracia nenhuma', async () => {
    const os = await withTenant(t.db, ctx, async (s) => {
      const w = await createWorkOrder(s, {
        customerId: cliente,
        workOrderTypeId: natureza,
        title: 'Sem exigências',
        locationId: setor,
      });
      await transitionWorkOrder(s, w.id, 'in_progress');
      return w.id;
    });
    const r = await withTenant(t.db, ctx, (s) =>
      transitionWorkOrder(s, os, 'completed', { resolution: 'Resolvido em campo' })
    );
    expect(r.category).toBe('review');
  });

  it('requisito desconhecido é recusado na configuração, não na conclusão', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        s.query(
          `INSERT INTO aurora.work_order_type_settings (organization_id, work_order_type_id, completion_requirements)
           VALUES ($1, $2, ARRAY['telepatia_do_tecnico'])`,
          [ORG, natureza]
        )
      )
    ).rejects.toThrow(/requisito de conclusão desconhecido: telepatia_do_tecnico/);
  });
});

/* -------------------------------------------------------------------------- */

describe('anexo: as garantias que o servidor dá', () => {
  let alvo: string;

  beforeAll(async () => {
    alvo = await novaOsEmExecucao('OS para anexos');
  }, 60_000);

  it('a chave é gerada pelo servidor, com a organização abrindo o caminho', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      attachFile(s, {
        workOrderId: alvo,
        purpose: 'before',
        fileName: 'antes.jpg',
        contentType: 'image/jpeg',
        byteSize: 12_345,
      })
    );

    expect(r.storageKey).toBe(`org/${ORG}/work-orders/${alvo}/${r.id}.jpg`);
    expect(r.storageKey).not.toContain('..');
  });

  it('o nome do arquivo NUNCA entra no caminho', async () => {
    const r = await withTenant(t.db, ctx, (s) =>
      attachFile(s, {
        workOrderId: alvo,
        purpose: 'before',
        // Travessia no nome: sobrevive como metadado limpo, some do caminho.
        fileName: '../../../etc/passwd.jpg',
        contentType: 'image/jpeg',
        byteSize: 100,
      })
    );

    expect(r.storageKey).not.toContain('passwd');
    expect(r.storageKey).not.toContain('..');

    const [linha] = await withTenant(t.db, ctx, (s) =>
      s.query<{ file_name: string }>(`SELECT file_name FROM aurora.attachments WHERE id = $1`, [r.id])
    );
    // Guardado para exibição, já limpo.
    expect(linha!.file_name).toBe('passwd.jpg');
  });

  it('tipo fora da lista da finalidade é recusado', async () => {
    await expect(
      withTenant(t.db, ctx, (s) =>
        attachFile(s, {
          workOrderId: alvo,
          purpose: 'before',
          fileName: 'pagina.html',
          contentType: 'text/html',
          byteSize: 100,
        })
      )
    ).rejects.toThrow(/não é aceito/);
  });

  it('arquivo acima do teto é recusado antes de gravar', async () => {
    const antes = await contarAnexos(alvo);
    await expect(
      withTenant(t.db, ctx, (s) =>
        attachFile(s, {
          workOrderId: alvo,
          purpose: 'before',
          fileName: 'gigante.jpg',
          contentType: 'image/jpeg',
          byteSize: 500 * 1024 * 1024,
        })
      )
    ).rejects.toThrow(/limite/);
    expect(await contarAnexos(alvo)).toBe(antes);
  });

  it('duas gravações seguidas nunca produzem a mesma chave', async () => {
    const a = await withTenant(t.db, ctx, (s) =>
      attachFile(s, {
        workOrderId: alvo,
        purpose: 'evidence',
        fileName: 'igual.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
      })
    );
    const b = await withTenant(t.db, ctx, (s) =>
      attachFile(s, {
        workOrderId: alvo,
        purpose: 'evidence',
        fileName: 'igual.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
      })
    );
    // Mesmo nome, chaves diferentes: não existe sobrescrita por construção.
    expect(a.storageKey).not.toBe(b.storageKey);
  });
});

async function contarAnexos(workOrderId: string): Promise<number> {
  const [linha] = await withTenant(t.db, ctx, (s) =>
    s.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM aurora.attachments WHERE work_order_id = $1`,
      [workOrderId]
    )
  );
  return Number(linha!.total);
}
