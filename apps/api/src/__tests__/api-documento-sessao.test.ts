/**
 * Aurora — do que foi medido ao documento entregue (gap V2 P2.6–P2.8 · critério 6).
 *
 *  · o rascunho nasce da sessão por CÓPIA, e só de sessão encerrada;
 *  · o tipo do documento precisa combinar com o procedimento do protocolo;
 *  · a emissão confere a fronteira de calendário (padrão vencido, cadeia
 *    vazia) e o vínculo do conteúdo com a sessão;
 *  · o PDF sai para quem pode ler, com faixa quando não emitido;
 *  · o portal só baixa o LIBERADO, do próprio cliente.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import {
  SESSION_SNAPSHOT_SCHEMA,
  AVISO_SEM_VEREDITO_AUTOMATICO,
  buildContext,
  PERMISSION_KEYS,
} from '@aurora/domain';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createAssetCategory,
  createCustomer,
  createWorkOrder,
  transitionWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  registerInstrument,
  registerInstrumentCertificate,
  openMeasurementSession,
  registerMeasurement,
  finishMeasurementSession,
  provisionDocumentTypes,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let rt: { email: string; mem: string; user: string };
let portalDoCliente: { email: string };
let portalDeOutroCliente: { email: string };

let sessaoCal = '';
let sessaoAberta = '';
let sessaoSemPadrao = '';

/** Monta OS + checklist + sessão, opcionalmente com instrumento e certificado. */
async function sessao(
  org: OrgDeTeste,
  opts: { key: string; comInstrumento: boolean; encerrar: boolean; customerId?: string }
): Promise<string> {
  const ctx = buildContext({
    organizationId: org.org,
    actorId: rt?.user,
    membershipId: rt?.mem,
    requestId: `sessao-${opts.key}`,
    permissions: PERMISSION_KEYS,
  });
  return withTenant(t.db, org === A ? ctx : ctxSistema(org.org), async (s) => {
    let instrumento: string | null = null;
    let cert: string | null = null;
    if (opts.comInstrumento) {
      const cat = await createAssetCategory(s, { name: `Termômetro ${opts.key}` });
      instrumento = await createAsset(s, {
        name: `Termômetro ${opts.key}`,
        customerId: org.cliente,
        assetCategoryId: cat,
      });
      await registerInstrument(s, { assetId: instrumento });
      cert = await registerInstrumentCertificate(s, {
        instrumentId: instrumento,
        certificateNumber: `C-${opts.key}`,
        laboratory: 'Lab X',
        issuedOn: '2026-01-01',
        validUntil: '2026-12-31',
        traceabilityStatement: 'RBC',
      });
    }
    const tpl = await createChecklistTemplate(s, {
      key: opts.key,
      title: `Calibração ${opts.key}`,
      procedureKind: 'calibration',
      technicalManagerId: org === A ? rt.mem : null,
    });
    const ponto = await addChecklistItem(s, {
      templateId: tpl,
      kind: 'measurement',
      label: 'Temperatura',
      unit: '°C',
      nominalValue: 37,
      toleranceMinus: 0.5,
      tolerancePlus: 0.5,
      toleranceMode: 'absolute',
      readingsRequired: 2,
    });
    await publishChecklist(s, tpl);
    const ativo = await createAsset(s, {
      name: `Incubadora ${opts.key}`,
      customerId: opts.customerId ?? org.cliente,
      assetCategoryId: org.categoria,
    });
    const w = await createWorkOrder(s, {
      customerId: opts.customerId ?? org.cliente,
      workOrderTypeId: org.natureza,
      title: `OS ${opts.key}`,
      assetId: ativo,
    });
    await transitionWorkOrder(s, w.id, 'in_progress');
    const resp = await attachChecklist(s, w.id, tpl);
    const id = await openMeasurementSession(s, {
      responseId: resp,
      instrumentId: instrumento,
      instrumentCertificateId: cert,
      measuredOn: '2026-09-30',
      ambient: { temperatura_c: 22 },
    });
    await registerMeasurement(s, {
      origem: 'manual',
      respostaId: resp,
      itemId: ponto,
      leituras: [37.2, 37.1],
      unidade: '°C',
      instrumentoId: null,
      medidoEmNoAparelho: null,
      motivoDaCorrecao: null,
    });
    if (opts.encerrar) await finishMeasurementSession(s, id);
    return id;
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'doc-a');
  B = await criarOrganizacao(t, 'doc-b');
  rt = await criarPessoa(t, A, 'rt', 'metrologist');
  portalDoCliente = await criarPessoa(t, A, 'cliente', 'customer_manager', {
    seatType: 'portal',
    customerIds: [A.cliente],
  });
  const outroCliente = await withTenant(t.db, ctxSistema(A.org), (s) =>
    createCustomer(s, { name: 'Outro hospital', isInternal: false })
  );
  portalDeOutroCliente = await criarPessoa(t, A, 'outro-cliente', 'customer_manager', {
    seatType: 'portal',
    customerIds: [outroCliente],
  });
  await withTenant(t.db, ctxSistema(A.org), (s) => provisionDocumentTypes(s));
  await withTenant(t.db, ctxSistema(B.org), (s) => provisionDocumentTypes(s));

  sessaoCal = await sessao(A, { key: 'cal_ok', comInstrumento: true, encerrar: true });
  sessaoAberta = await sessao(A, { key: 'cal_aberta', comInstrumento: true, encerrar: false });
  sessaoSemPadrao = await sessao(A, { key: 'cal_sem_padrao', comInstrumento: false, encerrar: true });

  ({ app, http } = await subirApi(t.db));
}, 180_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

let doc = '';

describe('rascunho a partir da sessão', () => {
  it('sessão ainda aberta não gera documento', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoAberta}`).set(auth(rt.email)).send({});
    expect(r.status).toBe(409);
  });

  it('tipo que não combina com o procedimento é recusado', async () => {
    const r = await http
      .post(`/v1/documents/from-session/${sessaoCal}`)
      .set(auth(rt.email))
      .send({ document_type_key: 'electrical_safety_test' });
    expect(r.status).toBe(422);
  });

  it('cria o rascunho de calibração com o conteúdo COPIADO, sem cálculo e sem veredito', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoCal}`).set(auth(rt.email)).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.document_type_key).toBe('calibration_certificate');
    doc = r.body.id;

    const d = await http.get(`/v1/documents/${doc}`).set(auth(rt.email));
    const p = d.body.document.payload.measurement_session;
    expect(p.schema).toBe(SESSION_SNAPSHOT_SCHEMA);
    expect(p.measurement_session_id).toBe(sessaoCal);
    expect(p.points[0]).toMatchObject({
      label: 'Temperatura',
      unit: '°C',
      nominal: 37,
      readings: [37.2, 37.1],
    });
    expect(p.instrument_certificate).toMatchObject({ number: 'C-cal_ok', valid_until: '2026-12-31' });
    expect(p.notice).toBe(AVISO_SEM_VEREDITO_AUTOMATICO);
    // Nada calculado: nenhuma chave de média, incerteza, erro ou veredito por ponto.
    expect(JSON.stringify(p)).not.toMatch(/"(mean|media|average|uncertainty|incerteza|error|erro|verdict)"/);
    expect(d.body.document.verdict).toBeNull();
    expect(d.body.document.technical_manager_id).toBe(rt.mem);
  });

  it('a mesma sessão em outra organização é 404', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoCal}`).set(auth(B.email)).send({});
    expect(r.status).toBe(404);
  });
});

describe('a emissão confere a sessão de origem', () => {
  it('certificado de calibração de sessão SEM padrão não emite: a cadeia está vazia', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoSemPadrao}`).set(auth(rt.email)).send({});
    const check = await http.get(`/v1/documents/${r.body.id}/issue-check`).set(auth(rt.email));
    expect(check.body.ok).toBe(false);
    expect(check.body.blockers.join(' ')).toMatch(/nenhum padrão foi declarado/);
  });

  it('conteúdo que perdeu o vínculo com a sessão não emite', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoCal}`).set(auth(rt.email)).send({});
    await http
      .post(`/v1/documents/${r.body.id}/content`)
      .set(auth(rt.email))
      .send({ payload: { measurement_session: { schema: 'outro' } }, verdict: 'conforming' });
    const check = await http.get(`/v1/documents/${r.body.id}/issue-check`).set(auth(rt.email));
    expect(check.body.blockers.join(' ')).toMatch(/perdeu o vínculo/);
  });

  it('o vínculo com a sessão não se troca depois', async () => {
    await expect(
      t.raw(`UPDATE aurora.documents SET measurement_session_id = $2 WHERE id = $1`, [doc, sessaoSemPadrao])
    ).rejects.toThrow(/não muda/);
  });

  it('o fluxo inteiro: parecer humano → revisão → assinatura → emissão', async () => {
    const c = await http
      .post(`/v1/documents/${doc}/content`)
      .set(auth(rt.email))
      .send({ verdict: 'conforming' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(
      (await http.post(`/v1/documents/${doc}/transitions`).set(auth(rt.email)).send({ to: 'under_review' }))
        .status
    ).toBe(201);
    const s = await http.post(`/v1/documents/${doc}/signatures`).set(auth(rt.email)).send({
      signerName: 'Responsável Técnico',
      signerRole: 'technical_manager',
      method: 'portal',
      portalUserId: rt.user,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const e = await http.post(`/v1/documents/${doc}/transitions`).set(auth(rt.email)).send({ to: 'issued' });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect(e.body.number).toMatch(/^CAL-\d{4}-\d{6}$/);
  });
});

describe('PDF', () => {
  it('quem lê documento baixa o PDF; o hash do conteúdo vem no cabeçalho', async () => {
    const r = await http
      .get(`/v1/documents/${doc}/pdf`)
      .set(auth(rt.email))
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="CAL-\d{4}-\d{6}-v1\.pdf"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    const [d] = await t.raw(`SELECT content_hash FROM aurora.documents WHERE id = $1`, [doc]);
    expect(r.headers['x-aurora-content-hash']).toBe(d!.content_hash);
    const corpo = (r.body as Buffer).toString('latin1');
    expect(corpo.startsWith('%PDF-1.4')).toBe(true);
    expect(corpo).toContain('C-cal_ok');
    expect(corpo).not.toContain('N\\303O EMITIDO');
  });

  it('rascunho baixa com faixa de NÃO EMITIDO', async () => {
    const r = await http.post(`/v1/documents/from-session/${sessaoSemPadrao}`).set(auth(rt.email)).send({});
    const pdf = await http
      .get(`/v1/documents/${r.body.id}/pdf`)
      .set(auth(rt.email))
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect((pdf.body as Buffer).toString('latin1')).toContain('DOCUMENTO N\\303O EMITIDO');
  });

  it('outra organização recebe 404, e não o PDF', async () => {
    const r = await http.get(`/v1/documents/${doc}/pdf`).set(auth(B.email));
    expect(r.status).toBe(404);
  });

  it('o portal NÃO baixa o emitido-e-não-liberado', async () => {
    const r = await http.get(`/v1/portal/documents/${doc}/pdf`).set(auth(portalDoCliente.email));
    expect(r.status).toBe(404);
  });

  it('liberado, o cliente do documento baixa — e outro cliente da mesma prestadora não', async () => {
    const lib = await http
      .post(`/v1/documents/${doc}/transitions`)
      .set(auth(rt.email))
      .send({ to: 'released' });
    expect(lib.status, JSON.stringify(lib.body)).toBe(201);

    const meu = await http.get(`/v1/portal/documents/${doc}/pdf`).set(auth(portalDoCliente.email));
    expect(meu.status).toBe(200);
    expect(meu.headers['content-type']).toBe('application/pdf');

    const alheio = await http.get(`/v1/portal/documents/${doc}/pdf`).set(auth(portalDeOutroCliente.email));
    expect(alheio.status).toBe(404);

    const outraOrg = await http.get(`/v1/portal/documents/${doc}/pdf`).set(auth(B.email));
    expect(outraOrg.status).toBe(404);
  });
});
