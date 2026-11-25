/**
 * Aurora — respostas do Anderson de 24/11/2026 e o vídeo do assistente de planos (13/11/2026).
 *
 *   D-4  contrato vencido, suspenso ou bloqueado: tudo para, só consulta — na camada de dados;
 *   D-7  vigência e renovação automática (renova só sem retenção; sem duplicar; histórico);
 *   D-3  hora de início e de término obrigatórias na conclusão; horas por natureza, auditáveis;
 *   PLN  um procedimento POR EQUIPAMENTO; educação continuada com data por equipamento; data
 *        retroativa recusada; ciclo aberto na criação; edição, inclusão, retirada e histórico.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { withTenant, type TenantSession } from '../client';
import { createCustomer, createLocation, provisionStarterLocationTypes } from '../directory';
import { createCatalogItem } from '../catalogs';
import { createAssetCategory, createAsset } from '../assets';
import { provisionWorkOrderStates, createWorkOrder, transitionWorkOrder } from '../work-orders';
import { createServiceRequest, transitionRequest } from '../service-requests';
import {
  assertCanExecuteWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
} from '../execution';
import { addCustomerPart, checkIn, updateServiceReport } from '../execucao-guiada';
import { addComment, listComments } from '../work-order-detail';
import { attachChecklist, answerChecklistItem, attachFile, logTime } from '../execution';
import { signWorkOrder, startTimer, stopTimer } from '../execution';
import { openMeasurementSession } from '../metrology';
import {
  createDocument,
  provisionDocumentTypes,
  transitionDocument,
  updateDocumentContent,
} from '../documents';
import { createQualityRecord, deleteQualityRecord } from '../qualidade';
import { addQuoteItem, createQuote, reviseQuote, setQuoteDiscount, transitionQuote } from '../quotes';
import { portalRateRequest } from '../portal';
import { activateRule, createRule, runAutomations, simulateRule } from '../automations';
import { scheduleWorkOrder, unscheduleWorkOrder } from '../schedule';
import { consumeForWorkOrder } from '../inventory';
import {
  createContract,
  addCoverage,
  activateContract,
  terminateContract,
  updateContract,
  sweepContractAlerts,
} from '../contracts';
import {
  holdContractService,
  releaseContractService,
  renewContract,
  contractRenewals,
  sweepContractRenewals,
  serviceBlockFor,
  technicalHours,
  organizationToday,
} from '../contract-service';
import { generateCycle, materializeCycle, restoreHeldCycleItems } from '../maintenance-plans';
import {
  createGuidedPlan,
  executePlanItem,
  updatePlan,
  updatePlanTask,
  addGuidedPlanItems,
  removePlanTask,
  planHistory,
} from '../plan-board';
import { createTestDatabase, seedOrganization, type TestDatabase } from '../testing/harness';

const ORG = newId(),
  USER = newId(),
  MEM = newId();
const ORG_B = newId(),
  USER_B = newId(),
  MEM_B = newId();
const ctx = buildContext({
  organizationId: ORG,
  actorId: USER,
  membershipId: MEM,
  requestId: 'and-2411',
  permissions: PERMISSION_KEYS,
});
const ctxB = buildContext({
  organizationId: ORG_B,
  actorId: USER_B,
  membershipId: MEM_B,
  requestId: 'and-2411-b',
  permissions: PERMISSION_KEYS,
});
const TUDO = { customerIds: null, locationPaths: null };
const HORAS = () => ({
  serviceStartedAt: new Date(Date.now() - 2 * 3_600_000),
  serviceEndedAt: new Date(Date.now() - 30 * 60_000),
});

let t: TestDatabase;
let hoje: string;
let natPrev: string, natCorr: string, natTreino: string;
let catVent: string, catMon: string;

const em = <T>(fn: (s: TenantSession) => Promise<T>) => withTenant(t.db, ctx, fn);

function dia(offset: number): string {
  const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + offset)).toISOString().slice(0, 10);
}

/** Um cliente com um setor e dois equipamentos (ventilador e monitor). */
async function novoCliente(nome: string) {
  return em(async (s) => {
    const tipos = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: nome });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: `${nome} — Unidade`,
    });
    const setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI Adulto',
    });
    const vent = await createAsset(s, {
      name: `Ventilador ${nome}`,
      customerId: cliente,
      assetCategoryId: catVent,
      locationId: setor,
    });
    const mon = await createAsset(s, {
      name: `Monitor ${nome}`,
      customerId: cliente,
      assetCategoryId: catMon,
      locationId: setor,
    });
    return { cliente, setor, vent, mon };
  });
}

/** Contrato vigente cobrindo todo o cliente. */
async function contratoVigente(
  cliente: string,
  opts: { inicio?: string; fim?: string | null; auto?: boolean } = {}
) {
  return em(async (s) => {
    const id = await createContract(s, {
      customerId: cliente,
      kind: 'full_service',
      startsOn: opts.inicio ?? dia(-30),
      endsOn: opts.fim === undefined ? dia(300) : opts.fim,
      autoRenew: opts.auto ?? false,
    });
    await addCoverage(s, { contractId: id, kind: 'customer' });
    await activateContract(s, id);
    return id;
  });
}

const abrirOs = (cliente: string, ativo: string | null, natureza = natCorr) =>
  em((s) =>
    createWorkOrder(s, {
      customerId: cliente,
      workOrderTypeId: natureza,
      title: 'Atendimento',
      assetId: ativo,
    })
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: USER, membershipId: MEM },
    { slug: 'and-2411', name: 'Prestadora', email: 'a@and-2411.test', userName: 'Ana' }
  );
  await seedOrganization(
    t,
    { organizationId: ORG_B, userId: USER_B, membershipId: MEM_B },
    { slug: 'and-2411-b', name: 'Outra', email: 'b@and-2411.test', userName: 'Bia' }
  );
  await em(async (s) => {
    hoje = await organizationToday(s);
    await provisionWorkOrderStates(s);
    catVent = await createAssetCategory(s, { name: 'Ventilador pulmonar' });
    catMon = await createAssetCategory(s, { name: 'Monitor multiparamétrico' });
    natPrev = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });
    natCorr = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    natTreino = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'treinamento',
      label: 'Treinamento',
      systemKey: 'training',
    });
    for (const [key, title] of [
      ['prev_ventilador', 'Preventiva de ventilador pulmonar'],
      ['prev_monitor', 'Preventiva de monitor'],
    ] as const) {
      const tpl = await createChecklistTemplate(s, { key, title });
      await addChecklistItem(s, { templateId: tpl, kind: 'boolean', label: 'Funciona?' });
      await publishChecklist(s, tpl);
    }
    const tse = await createChecklistTemplate(s, {
      key: 'tse_geral',
      title: 'TSE geral',
      procedureKind: 'electrical_safety',
    });
    await addChecklistItem(s, { templateId: tse, kind: 'number', label: 'Fuga', unit: 'µA' });
    await publishChecklist(s, tse);
  });
  await withTenant(t.db, ctxB, (s) => provisionWorkOrderStates(s));
}, 180_000);

afterAll(async () => {
  await t?.close();
});

/* ========================================================================== */
/* D-4 — contrato vencido, suspenso ou bloqueado                               */
/* ========================================================================== */

describe('D-4 · tudo para e fica somente consulta', () => {
  it('suspenso: ninguém abre OS nem chamado; a OS aberta não executa nem conclui; consulta segue', async () => {
    const c = await novoCliente('Suspenso');
    const contrato = await contratoVigente(c.cliente);
    const os = await abrirOs(c.cliente, c.vent); // aberta ANTES da suspensão
    await em((s) => transitionWorkOrder(s, os.id, 'in_progress'));

    expect(
      (await em((s) => holdContractService(s, contrato, 'suspended', 'Inadimplência de outubro'))).changed
    ).toBe(true);

    await expect(abrirOs(c.cliente, c.vent)).rejects.toThrow(/suspenso.*somente consulta/s);
    await expect(abrirOs(c.cliente, null)).rejects.toThrow(/Atendimento parado/);
    await expect(
      em((s) => createServiceRequest(s, { customerId: c.cliente, summary: 'Alarme', assetId: c.mon }))
    ).rejects.toThrow(/somente consulta/);
    await expect(
      em((s) =>
        transitionWorkOrder(s, os.id, 'completed', {
          ...HORAS(),
          resolution: 'feito',
          operationalResult: 'released',
        })
      )
    ).rejects.toThrow(/Inadimplência de outubro/);
    await expect(
      em((s) => transitionWorkOrder(s, os.id, 'cancelled', { cancellationReason: 'x'.repeat(12) }))
    ).rejects.toThrow(/somente consulta/);
    await expect(em((s) => assertCanExecuteWorkOrder(s, os.id))).rejects.toThrow(/somente consulta/);

    // consulta continua: a OS está lá, com a situação de antes
    const [linha] = await em((s) =>
      s.query<{ status_category: string }>(
        `SELECT status_category::text FROM aurora.work_orders WHERE id = $1`,
        [os.id]
      )
    );
    expect(linha!.status_category).toBe('in_progress');

    // quem administra regulariza: edita o contrato e reativa
    await expect(
      em((s) => updateContract(s, contrato, { title: 'Contrato regularizado' }))
    ).resolves.toBeUndefined();
    expect((await em((s) => releaseContractService(s, contrato, 'Pago'))).changed).toBe(true);
    await expect(
      em((s) =>
        transitionWorkOrder(s, os.id, 'completed', {
          ...HORAS(),
          resolution: 'feito',
          operationalResult: 'released',
        })
      )
    ).resolves.toMatchObject({ category: 'review' });
  });

  it('suspenso: agenda, peça, "Executar" do plano também param — cada um diz o motivo', async () => {
    const c = await novoCliente('OutrosCaminhos');
    const contrato = await contratoVigente(c.cliente);
    const os = await abrirOs(c.cliente, c.vent);
    const plano = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Plano dos outros caminhos',
          customerId: c.cliente,
          sectorId: c.setor,
          assetIds: [],
          items: [{ assetId: c.vent, checklistTemplateKey: 'prev_ventilador' }],
          kind: 'preventive',
          checklistTemplateKey: null,
          frequencyUnit: 'semester',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 0,
          toleranceDays: 5,
          autoGenerate: false,
        },
        TUDO
      )
    );
    const [item] = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_cycle_items WHERE task_id = $1`, [plano.taskIds[0]])
    );
    await em((s) => holdContractService(s, contrato, 'suspended', 'Suspensão dos outros caminhos'));
    const motivo = /Suspensão dos outros caminhos/;
    const janela = { startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) };
    await expect(
      em((s) => scheduleWorkOrder(s, { workOrderId: os.id, assigneeMembershipId: MEM, ...janela } as never))
    ).rejects.toThrow(motivo);
    await expect(em((s) => unscheduleWorkOrder(s, os.id))).rejects.toThrow(motivo);
    await expect(em((s) => consumeForWorkOrder(s, os.id, newId(), newId(), 1))).rejects.toThrow(motivo);
    await expect(em((s) => executePlanItem(s, item!.id, TUDO))).rejects.toThrow(motivo);
    const [pendente] = await em((s) =>
      s.query<{ status: string }>(`SELECT status::text FROM aurora.plan_cycle_items WHERE id = $1`, [
        item!.id,
      ])
    );
    expect(pendente!.status).toBe('pending');
    // reativado, o Executar volta a gerar a OS
    await em((s) => releaseContractService(s, contrato, null));
    expect((await em((s) => executePlanItem(s, item!.id, TUDO))).created).toBe(true);
  });

  it('suspenso: comentário, hora, checklist, assinatura, medição, laudo, qualidade e orçamento da OS param', async () => {
    const c = await novoCliente('Escritas');
    const contrato = await contratoVigente(c.cliente);
    const os = await abrirOs(c.cliente, c.vent);
    const { modelo, resposta, tipoDoc, doc, orcamento, emAberto, registro } = await em(async (s) => {
      await transitionWorkOrder(s, os.id, 'in_progress');
      const [m] = await s.query<{ id: string }>(
        `SELECT id FROM aurora.checklist_templates WHERE key = 'prev_ventilador' AND status = 'published'`
      );
      const aberta = await attachChecklist(s, os.id, m!.id);
      const tipo = [...(await provisionDocumentTypes(s)).values()][0]!;
      return {
        modelo: m!.id,
        resposta: aberta,
        tipoDoc: tipo,
        doc: await createDocument(s, { documentTypeId: tipo, title: 'Laudo', workOrderId: os.id }),
        orcamento: await createQuote(s, { customerId: c.cliente, workOrderId: os.id }),
        emAberto: await startTimer(s, os.id),
        registro: await createQualityRecord(s, {
          kind: 'calibration',
          title: 'Certificado',
          assetId: c.vent,
          issuedAt: hoje,
        }),
      };
    });
    const [item] = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.checklist_items WHERE template_id = $1 LIMIT 1`, [
        modelo,
      ])
    );
    await em((s) => holdContractService(s, contrato, 'blocked', 'Bloqueio das escritas da OS'));
    const motivo = /Bloqueio das escritas da OS/;
    const recusa = (f: (s: TenantSession) => Promise<unknown>) => expect(em(f)).rejects.toThrow(motivo);

    await recusa((s) => addComment(s, { workOrderId: os.id, body: 'oi', visibility: 'internal' }));
    await recusa((s) => attachChecklist(s, os.id, modelo));
    await recusa((s) => answerChecklistItem(s, resposta, item!.id, { boolean: true } as never));
    await recusa((s) =>
      logTime(s, { workOrderId: os.id, startedAt: new Date(Date.now() - 3_600_000), endedAt: new Date() })
    );
    await recusa((s) =>
      signWorkOrder(s, os.id, {
        signerRole: 'customer',
        signerName: 'Ana',
        method: 'session',
        signerEmail: 'a@a.test',
      })
    );
    await recusa((s) =>
      attachFile(s, {
        workOrderId: os.id,
        purpose: 'before',
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
      })
    );
    await recusa((s) => checkIn(s, os.id, { justification: 'sem posição no subsolo' }));
    await recusa((s) => addCustomerPart(s, os.id, { description: 'Filtro', quantity: 1 }));
    await recusa((s) => updateServiceReport(s, os.id, { serviceDescription: 'x' }));
    await recusa((s) => openMeasurementSession(s, { responseId: resposta, measuredOn: hoje }));
    await recusa((s) => createDocument(s, { documentTypeId: tipoDoc, title: 'Novo', workOrderId: os.id }));
    await recusa((s) => createDocument(s, { documentTypeId: tipoDoc, title: 'Do ativo', assetId: c.vent }));
    await recusa((s) => updateDocumentContent(s, doc, { title: 'Outro' }));
    await recusa((s) => transitionDocument(s, doc, 'under_review'));
    await recusa((s) =>
      createQualityRecord(s, { kind: 'calibration', title: 'Outro', assetId: c.vent, issuedAt: hoje })
    );
    await recusa((s) => deleteQualityRecord(s, registro));
    await recusa((s) => createQuote(s, { customerId: c.cliente, workOrderId: os.id }));
    await recusa((s) =>
      addQuoteItem(s, {
        quoteId: orcamento,
        kind: 'labor',
        description: 'Hora',
        quantity: 1,
        unitPriceCents: 100,
      } as never)
    );
    await recusa((s) => setQuoteDiscount(s, orcamento, { percent: 5 }));
    await recusa((s) => reviseQuote(s, orcamento));

    // O que continua: ENCERRAR o que já corria, consultar, e a proposta avulsa (sem OS) que regulariza.
    await em((s) => stopTimer(s, emAberto));
    await em((s) => transitionQuote(s, orcamento, 'cancelled'));
    await em((s) => createQuote(s, { customerId: c.cliente }));
    expect(await em((s) => listComments(s, os.id))).toEqual([]);

    // Outro cliente e registro sem cliente (treinamento da equipe) não são afetados.
    const livre = await novoCliente('EscritasLivre');
    const osLivre = await abrirOs(livre.cliente, livre.vent);
    await em((s) => addComment(s, { workOrderId: osLivre.id, body: 'segue', visibility: 'internal' }));
    await em((s) =>
      createQualityRecord(s, { kind: 'training', title: 'NR-10', personName: 'João', issuedAt: hoje })
    );
  });

  it('suspenso: a nota do portal é recusada, e liberada depois de reativar', async () => {
    const c = await novoCliente('Nota');
    const contrato = await contratoVigente(c.cliente);
    const sr = await em(async (s) => {
      const nova = await createServiceRequest(s, {
        customerId: c.cliente,
        summary: 'Alarme',
        assetId: c.vent,
      });
      for (const passo of ['triage', 'accepted', 'in_service', 'fulfilled'] as const) {
        await transitionRequest(s, nova.id, passo);
      }
      return nova;
    });
    await em((s) => holdContractService(s, contrato, 'suspended', 'Suspensão da avaliação'));
    await expect(em((s) => portalRateRequest(s, MEM, sr.id, 5))).rejects.toThrow(/Suspensão da avaliação/);
    await em((s) => releaseContractService(s, contrato, null));
    await em((s) => portalRateRequest(s, MEM, sr.id, 5));
  });

  it('suspenso: atribuição e comentário por AUTOMAÇÃO falham com o motivo, e voltam ao reativar', async () => {
    const c = await novoCliente('Automacao');
    const contrato = await contratoVigente(c.cliente);
    const os = await abrirOs(c.cliente, c.vent);
    const regras = await em(async (s) => {
      const ids: string[] = [];
      for (const acao of [
        { kind: 'assign', params: { membershipId: MEM } },
        { kind: 'add_comment', params: { text: 'Automático' } },
      ]) {
        const id = await createRule(s, {
          name: `Contrato parado ${acao.kind}`,
          triggerEvent: 'sla.breached',
          conditions: { all: [{ field: 'alvo', op: 'eq', value: 'contrato-parado' }] },
          actions: [acao],
        } as never);
        await simulateRule(s, id);
        await activateRule(s, id);
        ids.push(id);
      }
      return ids;
    });
    const disparar = async () =>
      (
        await em((s) =>
          runAutomations(s, {
            type: 'sla.breached',
            aggregateType: 'work_order',
            aggregateId: os.id,
            payload: { alvo: 'contrato-parado' },
          } as never)
        )
      ).filter((x) => regras.includes(x.ruleId));
    const estado = async () =>
      (
        await em((s) =>
          s.query<{ dono: string | null; n: number }>(
            `SELECT assignee_membership_id AS dono,
                    (SELECT count(*)::int FROM aurora.work_order_comments k WHERE k.work_order_id = w.id) AS n
               FROM aurora.work_orders w WHERE id = $1`,
            [os.id]
          )
        )
      )[0];
    await em((s) => holdContractService(s, contrato, 'blocked', 'Bloqueio para automação'));
    const barradas = await disparar();
    expect(barradas).toHaveLength(2);
    for (const e of barradas) {
      expect(e.outcome).toBe('failed');
      expect(e.actionsRun[0]!.detail).toMatch(/Bloqueio para automação/);
    }
    expect(await estado()).toEqual({ dono: null, n: 0 });
    await em((s) => releaseContractService(s, contrato, null));
    expect((await disparar()).map((x) => x.outcome)).toEqual(['matched', 'matched']);
    expect(await estado()).toEqual({ dono: MEM, n: 1 });
  });

  it('plano: o item dispensado pelo contrato volta quando ele é reativado dentro da janela — e só então', async () => {
    const c = await novoCliente('Restaura');
    const k = await contratoVigente(c.cliente);
    await em((s) => holdContractService(s, k, 'suspended', 'Suspensão curta do plano'));
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Anual que não pode se perder',
          customerId: c.cliente,
          sectorId: c.setor,
          assetIds: [],
          items: [
            { assetId: c.vent, checklistTemplateKey: 'prev_ventilador' },
            { assetId: c.mon, checklistTemplateKey: 'prev_monitor' },
          ],
          kind: 'preventive',
          checklistTemplateKey: null,
          frequencyUnit: 'year',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 0,
          toleranceDays: 5,
          autoGenerate: true,
        },
        TUDO
      )
    );
    const itens = () =>
      em((s) =>
        s.query<{ asset_id: string; status: string }>(
          `SELECT asset_id, status::text FROM aurora.plan_cycle_items WHERE task_id = ANY($1::uuid[])`,
          [r.taskIds]
        )
      );
    expect((await itens()).map((i) => i.status)).toEqual(['skipped', 'skipped']);
    // Ainda suspenso: nada volta.
    await em((s) => restoreHeldCycleItems(s));
    expect((await itens()).map((i) => i.status)).toEqual(['skipped', 'skipped']);
    // A dispensa feita por PESSOA não volta.
    await em((s) =>
      s.query(`UPDATE aurora.plan_cycle_items SET skipped_by = $2 WHERE task_id = $1`, [r.taskIds[1], USER])
    );
    await em((s) => releaseContractService(s, k, null));
    // Ciclo já vencido não vira obrigação retroativa.
    const doisAnos = new Date(Date.now() + 800 * 86_400_000);
    expect((await em((s) => restoreHeldCycleItems(s, doisAnos))).restored).toBe(0);
    await em((s) => restoreHeldCycleItems(s));
    const por = Object.fromEntries((await itens()).map((i) => [i.asset_id, i.status]));
    expect(por).toEqual({ [c.vent]: 'generated', [c.mon]: 'skipped' });
    // Idempotente.
    expect(await em((s) => restoreHeldCycleItems(s))).toEqual({ restored: 0, workOrders: 0 });
  });

  it('bloqueado: mesma parada; o motivo e o contrato aparecem no bloqueio', async () => {
    const c = await novoCliente('Bloqueado');
    const contrato = await contratoVigente(c.cliente);
    await em((s) => holdContractService(s, contrato, 'blocked', 'Contrato em auditoria jurídica'));
    const b = await em((s) => serviceBlockFor(s, { customerId: c.cliente, assetId: c.vent }));
    expect(b).toMatchObject({ reason: 'blocked', holdReason: 'Contrato em auditoria jurídica' });
    await expect(abrirOs(c.cliente, c.vent)).rejects.toThrow(/bloqueado/);
  });

  it('vencido pela data: para; contrato novo vigente libera; encerrado não bloqueia', async () => {
    const c = await novoCliente('Vencido');
    const velho = await contratoVigente(c.cliente, { inicio: dia(-400), fim: dia(-1) });
    expect(velho).toBeTruthy();
    await expect(abrirOs(c.cliente, c.vent)).rejects.toThrow(/venceu/);

    // encerrar o vencido (fim negociado) devolve o cliente a "sem contrato": atende normalmente
    await em((s) => terminateContract(s, velho, 'Contrato encerrado pelas partes'));
    await expect(abrirOs(c.cliente, c.vent)).resolves.toBeTruthy();
  });

  it('vigente e cliente sem contrato: atendimento livre; outro cliente não é afetado', async () => {
    const livre = await novoCliente('SemContrato');
    await expect(abrirOs(livre.cliente, livre.vent)).resolves.toBeTruthy();
    const vigente = await novoCliente('Vigente');
    await contratoVigente(vigente.cliente);
    await expect(abrirOs(vigente.cliente, vigente.mon)).resolves.toBeTruthy();

    const parado = await novoCliente('Vizinho');
    const k = await contratoVigente(parado.cliente);
    await em((s) => holdContractService(s, k, 'blocked', 'Bloqueio do vizinho'));
    await expect(abrirOs(vigente.cliente, vigente.vent)).resolves.toBeTruthy();
  });

  it('só contrato vigente se suspende; motivo curto é recusado; outra organização não vê', async () => {
    const c = await novoCliente('Regras');
    const rascunho = await em((s) =>
      createContract(s, { customerId: c.cliente, kind: 'on_demand', startsOn: dia(0) })
    );
    await expect(
      em((s) => holdContractService(s, rascunho, 'suspended', 'Motivo qualquer longo'))
    ).rejects.toThrow(/não está vigente/);
    const k = await contratoVigente(c.cliente);
    await expect(em((s) => holdContractService(s, k, 'suspended', 'curto'))).rejects.toThrow(/motivo/);
    await expect(
      withTenant(t.db, ctxB, (s) => holdContractService(s, k, 'blocked', 'Tentativa de outra organização'))
    ).rejects.toThrow(/não encontrado/);
  });

  it('plano: ciclo aberto com o contrato parado NÃO gera OS; o item nasce dispensado com o motivo', async () => {
    const c = await novoCliente('PlanoParado');
    const k = await contratoVigente(c.cliente);
    await em((s) => holdContractService(s, k, 'suspended', 'Suspensão para teste do plano'));
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          name: 'Preventiva semestral',
          customerId: c.cliente,
          sectorId: c.setor,
          assetIds: [],
          items: [{ assetId: c.vent, checklistTemplateKey: 'prev_ventilador' }],
          kind: 'preventive',
          checklistTemplateKey: null,
          frequencyUnit: 'semester',
          frequencyInterval: 1,
          anchorDate: new Date(`${hoje}T00:00:00Z`),
          leadTimeDays: 400,
          toleranceDays: 5,
          autoGenerate: true,
        },
        TUDO
      )
    );
    expect(r.cyclesOpened).toBe(1);
    expect(r.workOrders).toBe(0);
    const [item] = await em((s) =>
      s.query<{ status: string; skip_reason: string; work_order_id: string | null }>(
        `SELECT status::text, skip_reason, work_order_id FROM aurora.plan_cycle_items WHERE task_id = $1`,
        [r.taskIds[0]]
      )
    );
    expect(item).toMatchObject({ status: 'skipped', work_order_id: null });
    expect(item!.skip_reason).toMatch(/suspenso/);
  });
});

/* ========================================================================== */
/* D-7 — vigência e renovação automática                                       */
/* ========================================================================== */

describe('D-7 · renovação automática', () => {
  it('renova no último dia pelo prazo original, uma vez só, com histórico', async () => {
    const c = await novoCliente('Renova');
    // 12 meses: começa amanhã do ano passado, termina hoje
    const inicio = (() => {
      const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
      return new Date(Date.UTC(a - 1, m - 1, d + 1)).toISOString().slice(0, 10);
    })();
    const k = await contratoVigente(c.cliente, { inicio, fim: hoje, auto: true });
    const feitas = await em((s) => sweepContractRenewals(s, hoje));
    expect(feitas.map((f) => f.contractId)).toContain(k);
    const [row] = await em((s) =>
      s.query<{ ends_on: string; status: string }>(
        `SELECT ends_on::text, status::text FROM aurora.contracts WHERE id = $1`,
        [k]
      )
    );
    const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
    expect(row).toEqual({
      ends_on: new Date(Date.UTC(a + 1, m - 1, d)).toISOString().slice(0, 10),
      status: 'active',
    });
    // segunda varredura no mesmo dia: nada
    expect((await em((s) => sweepContractRenewals(s, hoje))).map((f) => f.contractId)).not.toContain(k);
    const historico = await em((s) => contractRenewals(s, k));
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ seq: 1, previous_ends_on: hoje, mode: 'automatic' });
    // e o atendimento continua livre
    await expect(abrirOs(c.cliente, c.vent)).resolves.toBeTruthy();
  });

  it('suspenso ou bloqueado NÃO renova: vence na varredura e para', async () => {
    const c = await novoCliente('NaoRenova');
    const k = await contratoVigente(c.cliente, { inicio: dia(-364), fim: dia(-1), auto: true });
    await em((s) => holdContractService(s, k, 'blocked', 'Bloqueio antes do vencimento'));
    await em((s) => sweepContractAlerts(s, hoje, hoje.slice(0, 7)));
    const [row] = await em((s) =>
      s.query<{ status: string; ends_on: string }>(
        `SELECT status::text, ends_on::text FROM aurora.contracts WHERE id = $1`,
        [k]
      )
    );
    expect(row).toEqual({ status: 'expired', ends_on: dia(-1) });
    expect(await em((s) => contractRenewals(s, k))).toHaveLength(0);
  });

  it('prazo indeterminado não tem ciclo: renovação automática é recusada e a varredura o ignora', async () => {
    const c = await novoCliente('Indeterminado');
    await expect(
      em((s) => createContract(s, { customerId: c.cliente, kind: 'loan', startsOn: dia(0), autoRenew: true }))
    ).rejects.toThrow(/prazo indeterminado/);
    const k = await contratoVigente(c.cliente, { fim: null });
    await expect(em((s) => renewContract(s, k, {}))).rejects.toThrow(/indeterminado/);
  });

  it('vencido não renova sozinho; a renovação manual regulariza e libera o atendimento', async () => {
    const c = await novoCliente('Manual');
    const k = await contratoVigente(c.cliente, { inicio: dia(-90), fim: dia(-1), auto: false });
    await em((s) => sweepContractAlerts(s, hoje, hoje.slice(0, 7)));
    await expect(abrirOs(c.cliente, c.vent)).rejects.toThrow(/venceu/);
    const r = await em((s) => renewContract(s, k, { note: 'Aditivo assinado' }));
    expect(r.previous_ends_on).toBe(dia(-1));
    expect(r.new_ends_on > hoje).toBe(true);
    await expect(abrirOs(c.cliente, c.vent)).resolves.toBeTruthy();
    expect((await em((s) => contractRenewals(s, k)))[0]).toMatchObject({
      mode: 'manual',
      note: 'Aditivo assinado',
    });
  });
});

/* ========================================================================== */
/* D-3 — hora de início e de término                                           */
/* ========================================================================== */

describe('D-3 · horas técnicas pela hora de início e de término da OS', () => {
  it('concluir sem as horas é recusado; término antes do início também; com elas, grava', async () => {
    const c = await novoCliente('Horas');
    const os = await abrirOs(c.cliente, c.vent);
    await em((s) => transitionWorkOrder(s, os.id, 'in_progress'));
    await expect(
      em((s) =>
        transitionWorkOrder(s, os.id, 'completed', { resolution: 'feito', operationalResult: 'released' })
      )
    ).rejects.toThrow(/hora de início e a hora de término/);
    await expect(
      em((s) =>
        transitionWorkOrder(s, os.id, 'completed', {
          resolution: 'feito',
          operationalResult: 'released',
          serviceStartedAt: new Date(Date.now() - 60_000),
          serviceEndedAt: new Date(Date.now() - 3_600_000),
        })
      )
    ).rejects.toThrow(/depois da hora de início/);
    await expect(
      em((s) =>
        updateServiceReport(s, os.id, { serviceStartedAt: new Date(Date.now() + 86_400_000).toISOString() })
      )
    ).rejects.toThrow(/futuro/);
    // pelo relatório, e depois a conclusão lê o que está gravado
    await em((s) =>
      updateServiceReport(s, os.id, {
        serviceStartedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        serviceEndedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      })
    );
    await expect(
      em((s) =>
        transitionWorkOrder(s, os.id, 'completed', { resolution: 'feito', operationalResult: 'released' })
      )
    ).resolves.toMatchObject({ category: 'review' });
  });

  it('apura preventiva e corretiva separadas, por OS, e conta à parte as antigas sem horário', async () => {
    const c = await novoCliente('Apuracao');
    const k = await contratoVigente(c.cliente);
    const concluir = async (natureza: string, minutos: number) => {
      const os = await abrirOs(c.cliente, c.vent, natureza);
      await em(async (s) => {
        await transitionWorkOrder(s, os.id, 'in_progress');
        await transitionWorkOrder(s, os.id, 'completed', {
          resolution: 'feito',
          operationalResult: 'released',
          serviceStartedAt: new Date(Date.now() - (minutos + 10) * 60_000),
          serviceEndedAt: new Date(Date.now() - 10 * 60_000),
        });
      });
      return os.id;
    };
    await concluir(natPrev, 90);
    await concluir(natCorr, 45);
    await concluir(natCorr, 30);
    // OS "antiga": concluída sem horário — como antes da regra (a organização que desliga a
    // exigência em `settings.require_service_hours` também conclui assim).
    const antiga = await abrirOs(c.cliente, c.mon);
    await em(async (s) => {
      await s.query(
        `UPDATE aurora.organizations SET settings = COALESCE(settings, '{}'::jsonb) || '{"require_service_hours": false}'::jsonb`
      );
      await transitionWorkOrder(s, antiga.id, 'in_progress');
      await transitionWorkOrder(s, antiga.id, 'completed', {
        resolution: 'feito',
        operationalResult: 'released',
      });
      await s.query(`UPDATE aurora.organizations SET settings = settings - 'require_service_hours'`);
    });
    const r = await em((s) => technicalHours(s, k, dia(-1), dia(0)));
    const por = Object.fromEntries(r.totals.map((x) => [x.group, x]));
    expect(por.preventive).toMatchObject({ work_orders: 1, minutes: 90 });
    expect(por.corrective).toMatchObject({ work_orders: 2, minutes: 75 });
    expect(r.without_hours).toBe(1);
    expect(r.items).toHaveLength(3);
    await expect(withTenant(t.db, ctxB, (s) => technicalHours(s, k, dia(-1), dia(0)))).rejects.toThrow(
      /não encontrado/
    );
  });
});

/* ========================================================================== */
/* Planos — o vídeo de 13/11/2026                                              */
/* ========================================================================== */

describe('planos · um procedimento por equipamento, educação continuada e edição', () => {
  const base = (c: Awaited<ReturnType<typeof novoCliente>>) => ({
    name: `Preventiva — UTI Adulto — ${c.cliente.slice(-8)}`,
    customerId: c.cliente,
    sectorId: c.setor,
    assetIds: [] as string[],
    kind: 'preventive' as const,
    checklistTemplateKey: null,
    frequencyUnit: 'semester' as const,
    frequencyInterval: 1,
    anchorDate: new Date(`${hoje}T00:00:00Z`),
    leadTimeDays: 400,
    toleranceDays: 5,
    autoGenerate: true,
  });

  it('cada equipamento recebe o SEU checklist na OS gerada (ventilador ≠ monitor), mais o adicional', async () => {
    const c = await novoCliente('PorEquip');
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          ...base(c),
          items: [
            {
              assetId: c.vent,
              checklistTemplateKey: 'prev_ventilador',
              extraChecklistTemplateKeys: ['tse_geral'],
            },
            { assetId: c.mon, checklistTemplateKey: 'prev_monitor' },
          ],
        },
        TUDO
      )
    );
    expect(r.taskIds).toHaveLength(2);
    expect(r.cyclesOpened).toBe(2);
    expect(r.workOrders).toBe(2);
    const anexos = await em((s) =>
      s.query<{ asset_id: string; chaves: string }>(
        `SELECT w.asset_id, string_agg(cr.template_key, ',' ORDER BY cr.template_key) AS chaves
           FROM aurora.plan_cycle_items i
           JOIN aurora.work_orders w ON w.id = i.work_order_id
           JOIN aurora.checklist_responses cr ON cr.work_order_id = w.id
          WHERE i.task_id = ANY($1::uuid[])
          GROUP BY w.asset_id`,
        [r.taskIds]
      )
    );
    const por = Object.fromEntries(anexos.map((a) => [a.asset_id, a.chaves]));
    expect(por[c.vent]).toBe('prev_ventilador,tse_geral');
    expect(por[c.mon]).toBe('prev_monitor');
  });

  it('equipamento sem procedimento, procedimento de outro tipo e primeira data já vencida são recusados', async () => {
    const c = await novoCliente('Recusas');
    await expect(
      em((s) => createGuidedPlan(s, { ...base(c), items: [{ assetId: c.vent }] }, TUDO))
    ).rejects.toThrow(/escolha o procedimento/);
    await expect(
      em((s) =>
        createGuidedPlan(
          s,
          { ...base(c), items: [{ assetId: c.vent, checklistTemplateKey: 'tse_geral' }] },
          TUDO
        )
      )
    ).rejects.toThrow(/outro tipo de plano/);
    await expect(
      em((s) =>
        createGuidedPlan(
          s,
          {
            ...base(c),
            frequencyUnit: 'month',
            anchorDate: new Date(`${dia(-400)}T00:00:00Z`),
            items: [{ assetId: c.vent, checklistTemplateKey: 'prev_ventilador' }],
          },
          TUDO
        )
      )
    ).rejects.toThrow(/já passou/);
    const [n] = await em((s) =>
      s.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM aurora.maintenance_plans WHERE customer_id = $1`,
        [c.cliente]
      )
    );
    expect(n!.n).toBe(0);
  });

  it('educação continuada: sem procedimento, data obrigatória por equipamento, OS de treinamento na data', async () => {
    const c = await novoCliente('Educacao');
    await expect(
      em((s) => createGuidedPlan(s, { ...base(c), kind: 'education', items: [{ assetId: c.vent }] }, TUDO))
    ).rejects.toThrow(/informe a data/);
    await expect(
      em((s) =>
        createGuidedPlan(
          s,
          {
            ...base(c),
            kind: 'education',
            items: [{ assetId: c.vent, firstDueOn: dia(20), checklistTemplateKey: 'prev_ventilador' }],
          },
          TUDO
        )
      )
    ).rejects.toThrow(/não leva procedimento/);
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          ...base(c),
          kind: 'education',
          frequencyUnit: 'year',
          leadTimeDays: 30,
          items: [
            { assetId: c.vent, firstDueOn: dia(20) },
            { assetId: c.mon, firstDueOn: dia(200) },
          ],
        },
        TUDO
      )
    );
    // vencimento do primeiro ciclo = a data de cada equipamento (o ciclo abre um período antes)
    const itens = await em((s) =>
      s.query<{ asset_id: string; due: string; tipo: string; checklists: number }>(
        `SELECT i.asset_id, i.due_at::date::text AS due, ci.system_key AS tipo,
                (SELECT count(*)::int FROM aurora.checklist_responses cr WHERE cr.work_order_id = i.work_order_id)
                  AS checklists
           FROM aurora.plan_cycle_items i
           JOIN aurora.work_orders w ON w.id = i.work_order_id
           JOIN aurora.catalog_items ci ON ci.id = w.work_order_type_id
          WHERE i.task_id = ANY($1::uuid[])`,
        [r.taskIds]
      )
    );
    const porAtivo = Object.fromEntries(itens.map((i) => [i.asset_id, i]));
    expect(porAtivo[c.vent]).toEqual({ asset_id: c.vent, due: dia(20), tipo: 'training', checklists: 0 });
    expect(porAtivo[c.mon]).toEqual({ asset_id: c.mon, due: dia(200), tipo: 'training', checklists: 0 });
    expect(natTreino).toBeTruthy();
  });

  it('editar o plano, a tarefa, incluir e retirar equipamento — tudo no histórico', async () => {
    const c = await novoCliente('Edicao');
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          ...base(c),
          autoGenerate: false,
          leadTimeDays: 0,
          items: [{ assetId: c.vent, checklistTemplateKey: 'prev_ventilador' }],
        },
        TUDO
      )
    );
    await em((s) => updatePlan(s, r.planId, { name: 'Preventiva UTI — revisada', autoGenerate: true }));
    await em((s) =>
      updatePlanTask(s, r.taskIds[0]!, {
        frequencyUnit: 'quarter',
        toleranceDays: 10,
        extraChecklistTemplateKeys: ['tse_geral'],
      })
    );
    await expect(em((s) => updatePlanTask(s, r.taskIds[0]!, { checklistTemplateKey: null }))).rejects.toThrow(
      /precisa de um procedimento/
    );
    const add = await em((s) =>
      addGuidedPlanItems(s, r.planId, [{ assetId: c.mon, checklistTemplateKey: 'prev_monitor' }], TUDO)
    );
    expect(add.taskIds).toHaveLength(1);
    await expect(
      em((s) =>
        addGuidedPlanItems(s, r.planId, [{ assetId: c.mon, checklistTemplateKey: 'prev_monitor' }], TUDO)
      )
    ).rejects.toThrow(/já está neste plano/);
    await em((s) => removePlanTask(s, add.taskIds[0]!, 'Monitor transferido para outro setor'));
    await expect(em((s) => removePlanTask(s, r.taskIds[0]!, 'Tentativa de tirar o último'))).rejects.toThrow(
      /único equipamento/
    );
    const historico = await em((s) => planHistory(s, r.planId));
    expect(historico.some((h) => h.entity === 'plan' && h.action === 'update')).toBe(true);
    expect(historico.filter((h) => h.entity === 'task').length).toBeGreaterThanOrEqual(3);
  });

  it('plano manual: o ciclo abre sem OS; "gerar OS deste ciclo" materializa', async () => {
    const c = await novoCliente('PlanoManual');
    const r = await em((s) =>
      createGuidedPlan(
        s,
        {
          ...base(c),
          autoGenerate: false,
          leadTimeDays: 0,
          items: [{ assetId: c.vent, checklistTemplateKey: 'prev_ventilador' }],
        },
        TUDO
      )
    );
    expect(r).toMatchObject({ cyclesOpened: 1, workOrders: 0 });
    const [ciclo] = await em((s) =>
      s.query<{ id: string }>(`SELECT id FROM aurora.plan_cycles WHERE task_id = $1`, [r.taskIds[0]])
    );
    expect(await em((s) => materializeCycle(s, ciclo!.id))).toBe(1);
    // e a varredura não abre outro ciclo antes da hora
    expect(await em((s) => generateCycle(s, r.taskIds[0]!))).toBeNull();
  });
});
