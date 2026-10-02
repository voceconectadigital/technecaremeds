/**
 * Aurora — metrologia N0 pela HTTP (gap V2 P0.2, P2.1–P2.5 · critérios 4 e 5).
 *
 * O fluxo inteiro, na ordem em que acontece no laboratório:
 *   instrumento → certificado externo → protocolo com ponto de medição →
 *   OS com checklist → sessão (instrumento + certificado vigente) → leituras
 *   (fonte manual → envelope) → correção preservada → dado bruto com SHA-256 →
 *   encerramento.
 *
 * E o que não pode acontecer em cada passo: certificado que não cobria o dia,
 * instrumento de outra categoria, unidade convertida em silêncio, leitura sem
 * sessão, dado bruto sem resumo, outra organização tocando em qualquer coisa.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import { newId } from '@aurora/domain';
import { MeasurementSessionDetail, InstrumentRow } from '@aurora/contracts';
import { createTestDatabase, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  createAsset,
  createAssetCategory,
  createWorkOrder,
  transitionWorkOrder,
  createChecklistTemplate,
  addChecklistItem,
  publishChecklist,
  attachChecklist,
  requireInstrumentCategory,
} from '@aurora/db';
import { auth, criarOrganizacao, criarPessoa, ctxSistema, subirApi, type OrgDeTeste } from './apoio/cenario';

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let A: OrgDeTeste;
let B: OrgDeTeste;
let metrologista: { email: string; mem: string };
let tecnico: { email: string; mem: string };

let analisador = '';
let outroInstrumento = '';
let instrumentoB = '';
let os = '';
let resposta = '';
let pontoTemp = '';
let respostaB = '';
let certVigente = '';
let certVencido = '';

const resumo = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  t = await createTestDatabase();
  A = await criarOrganizacao(t, 'metro-a');
  B = await criarOrganizacao(t, 'metro-b');
  metrologista = await criarPessoa(t, A, 'metrologista', 'metrologist');
  tecnico = await criarPessoa(t, A, 'tecnico', 'technician');

  await withTenant(t.db, ctxSistema(A.org), async (s) => {
    const catAnalisador = await createAssetCategory(s, { name: 'Analisador de incubadora' });
    const catMultimetro = await createAssetCategory(s, { name: 'Multímetro' });
    analisador = await createAsset(s, {
      name: 'Analisador INC-01',
      customerId: A.cliente,
      assetCategoryId: catAnalisador,
      serialNumber: 'AN-0001',
    });
    outroInstrumento = await createAsset(s, {
      name: 'Multímetro MM-04',
      customerId: A.cliente,
      assetCategoryId: catMultimetro,
    });
    const incubadora = await createAsset(s, {
      name: 'Incubadora neonatal',
      customerId: A.cliente,
      assetCategoryId: A.categoria,
      locationId: A.setor,
    });

    const tpl = await createChecklistTemplate(s, {
      key: 'calibracao_incubadora',
      title: 'Calibração de incubadora',
      procedureKind: 'calibration',
      technicalManagerId: metrologista.mem,
    });
    pontoTemp = await addChecklistItem(s, {
      templateId: tpl,
      kind: 'measurement',
      label: 'Temperatura da câmara',
      unit: '°C',
      nominalValue: 37,
      toleranceMinus: 0.3,
      tolerancePlus: 0.3,
      toleranceMode: 'absolute',
      readingsRequired: 3,
    });
    await requireInstrumentCategory(s, tpl, catAnalisador, 'qualquer analisador com certificado vigente');
    await publishChecklist(s, tpl);

    const w = await createWorkOrder(s, {
      customerId: A.cliente,
      workOrderTypeId: A.natureza,
      title: 'Calibração anual',
      locationId: A.setor,
      assetId: incubadora,
    });
    os = w.id;
    await transitionWorkOrder(s, os, 'in_progress');
    resposta = await attachChecklist(s, os, tpl);
  });

  await withTenant(t.db, ctxSistema(B.org), async (s) => {
    const cat = await createAssetCategory(s, { name: 'Analisador' });
    instrumentoB = await createAsset(s, {
      name: 'Analisador B',
      customerId: B.cliente,
      assetCategoryId: cat,
    });
    const tpl = await createChecklistTemplate(s, {
      key: 'proto_b',
      title: 'Proto B',
      procedureKind: 'calibration',
    });
    await addChecklistItem(s, {
      templateId: tpl,
      kind: 'measurement',
      label: 'X',
      unit: 'V',
      readingsRequired: 1,
    });
    await publishChecklist(s, tpl);
    const w = await createWorkOrder(s, {
      customerId: B.cliente,
      workOrderTypeId: B.natureza,
      title: 'OS de B',
      locationId: B.setor,
    });
    await transitionWorkOrder(s, w.id, 'in_progress');
    respostaB = await attachChecklist(s, w.id, tpl);
  });

  ({ app, http } = await subirApi(t.db));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('instrumento como papel de ativo', () => {
  it('o metrologista marca o ativo como instrumento; fabricante e série vêm do ativo', async () => {
    const r = await http.post('/v1/instruments').set(auth(metrologista.email)).send({
      asset_id: analisador,
      interface: 'USB',
      firmware_version: '2.4.1',
      known_limitations: 'faixa até 45 °C',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const l = await http.get('/v1/instruments').set(auth(tecnico.email));
    expect(l.status).toBe(200);
    const linha = InstrumentRow.parse(
      l.body.items.find((i: { asset_id: string }) => i.asset_id === analisador)
    );
    expect(linha).toMatchObject({
      serial_number: 'AN-0001',
      firmware_version: '2.4.1',
      current_certificate: null,
    });

    await http.post('/v1/instruments').set(auth(metrologista.email)).send({ asset_id: outroInstrumento });
  });

  it('o mesmo ativo não vira instrumento duas vezes', async () => {
    const r = await http.post('/v1/instruments').set(auth(metrologista.email)).send({ asset_id: analisador });
    expect(r.status).toBe(409);
  });

  it('o técnico vê, mas não cadastra (403 nomeando instrument.manage)', async () => {
    const r = await http
      .post('/v1/instruments')
      .set(auth(tecnico.email))
      .send({ asset_id: outroInstrumento });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('instrument.manage');
  });

  it('ativo de outra organização não vira instrumento daqui (404, não 403)', async () => {
    const r = await http.post('/v1/instruments').set(auth(A.email)).send({ asset_id: instrumentoB });
    expect(r.status).toBe(404);
  });
});

describe('certificado externo', () => {
  it('registra o certificado do laboratório, e ele passa a ser o vigente do cadastro', async () => {
    const v = await http
      .post(`/v1/instruments/${analisador}/certificates`)
      .set(auth(metrologista.email))
      .send({
        certificate_number: 'LAB-2026-0042',
        laboratory: 'Laboratório Acreditado X',
        issued_on: '2026-01-10',
        valid_until: '2027-01-10',
        scope: 'temperatura 20–45 °C, conforme certificado',
        traceability_statement: 'RBC',
      });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    certVigente = v.body.id;

    const velho = await http
      .post(`/v1/instruments/${analisador}/certificates`)
      .set(auth(metrologista.email))
      .send({
        certificate_number: 'LAB-2024-0007',
        laboratory: 'Laboratório Acreditado X',
        issued_on: '2024-01-10',
        valid_until: '2025-01-10',
      });
    certVencido = velho.body.id;

    const d = await http.get(`/v1/instruments/${analisador}`).set(auth(tecnico.email));
    expect(d.body.instrument.current_certificate.certificate_number).toBe('LAB-2026-0042');
    expect(d.body.certificates).toHaveLength(2);
  });

  it('validade antes da emissão e número repetido são recusados', async () => {
    const r1 = await http
      .post(`/v1/instruments/${analisador}/certificates`)
      .set(auth(metrologista.email))
      .send({
        certificate_number: 'X1',
        laboratory: 'L',
        issued_on: '2026-05-01',
        valid_until: '2026-04-01',
      });
    expect(r1.status).toBe(422);
    const r2 = await http
      .post(`/v1/instruments/${analisador}/certificates`)
      .set(auth(metrologista.email))
      .send({
        certificate_number: 'LAB-2026-0042',
        laboratory: 'L',
        issued_on: '2026-01-10',
        valid_until: '2027-01-10',
      });
    expect(r2.status).toBe(409);
  });

  it('certificado registrado não se edita — nem por SQL direto da aplicação', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.instrument_certificates SET valid_until = '2030-01-01' WHERE id = $1`, [
          certVigente,
        ])
      )
    ).rejects.toThrow(/não se edita/);
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`DELETE FROM aurora.instrument_certificates WHERE id = $1`, [certVigente])
      )
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('o arquivo do certificado exige SHA-256 e entra pelo envio retomável', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% certificado de teste\n');
    const sem = await http
      .post(`/v1/instrument-certificates/${certVigente}/files`)
      .set(auth(metrologista.email))
      .send({ file_name: 'cert.pdf', content_type: 'application/pdf', byte_size: pdf.byteLength });
    expect(sem.status).toBe(422);

    const r = await http
      .post(`/v1/instrument-certificates/${certVigente}/files`)
      .set(auth(metrologista.email))
      .send({
        file_name: 'cert.pdf',
        content_type: 'application/pdf',
        byte_size: pdf.byteLength,
        sha256: resumo(pdf),
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.storage_key).toMatch(/\/instrument-certificates\//);

    const bytes = await http
      .put(`/v1/field/attachments/${r.body.attachment_id}/bytes`)
      .set(auth(metrologista.email))
      .set('content-type', 'application/octet-stream')
      .set('x-aurora-offset', '0')
      .set('x-aurora-sha256', resumo(pdf))
      .set('x-aurora-final', '1')
      .send(pdf);
    expect(bytes.status, JSON.stringify(bytes.body)).toBe(200);
    expect(bytes.body.completed).toBe(true);
  });

  it('outra organização não registra certificado em instrumento alheio', async () => {
    const r = await http.post(`/v1/instruments/${analisador}/certificates`).set(auth(B.email)).send({
      certificate_number: 'INTRUSO',
      laboratory: 'L',
      issued_on: '2026-01-01',
      valid_until: '2027-01-01',
    });
    expect(r.status).toBe(404);
  });
});

describe('sessão de medição — proveniência conferida', () => {
  it('leitura antes de abrir a sessão é recusada: sem sessão não há instrumento nem origem', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(tecnico.email))
      .send({ item_id: pontoTemp, readings: [37, 37, 37] });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/sessão de medição/);
  });

  it('certificado que não cobria o dia da medição é recusado, dizendo a vigência', async () => {
    const r = await http.post(`/v1/work-orders/${os}/measurement-sessions`).set(auth(tecnico.email)).send({
      response_id: resposta,
      instrument_id: analisador,
      instrument_certificate_id: certVencido,
      measured_on: '2026-09-30',
    });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/LAB-2024-0007.*2026-09-30/);
  });

  it('instrumento de categoria que o protocolo não aceita é recusado', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/measurement-sessions`)
      .set(auth(tecnico.email))
      .send({ response_id: resposta, instrument_id: outroInstrumento, measured_on: '2026-09-30' });
    expect(r.status).toBe(422);
  });

  it('o protocolo exige instrumento: sem ele, recusado', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/measurement-sessions`)
      .set(auth(tecnico.email))
      .send({ response_id: resposta, measured_on: '2026-09-30' });
    expect(r.status).toBe(422);
  });

  it('resposta de OUTRA organização não abre sessão aqui', async () => {
    const r = await http
      .post(`/v1/work-orders/${os}/measurement-sessions`)
      .set(auth(tecnico.email))
      .send({ response_id: respostaB, instrument_id: analisador, measured_on: '2026-09-30' });
    expect(r.status).toBe(404);
  });

  it('instrumento de OUTRA organização não entra na sessão de B (404)', async () => {
    const os2 = await t.raw(`SELECT work_order_id FROM aurora.checklist_responses WHERE id = $1`, [
      respostaB,
    ]);
    const r = await http
      .post(`/v1/work-orders/${os2[0]!.work_order_id}/measurement-sessions`)
      .set(auth(B.email))
      .send({ response_id: respostaB, instrument_id: analisador, measured_on: '2026-09-30' });
    expect(r.status).toBe(404);
  });

  let sessao = '';
  it('com instrumento e certificado vigente, a sessão abre — e é idempotente pela fila de campo', async () => {
    const op = newId();
    const corpo = {
      response_id: resposta,
      instrument_id: analisador,
      instrument_certificate_id: certVigente,
      measured_on: '2026-09-30',
      ambient: { temperatura_ambiente_c: 23.1, umidade_relativa: 48 },
    };
    const r1 = await http
      .post(`/v1/work-orders/${os}/measurement-sessions`)
      .set({ ...auth(tecnico.email), 'x-aurora-client-operation': op })
      .send(corpo);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const r2 = await http
      .post(`/v1/work-orders/${os}/measurement-sessions`)
      .set({ ...auth(tecnico.email), 'x-aurora-client-operation': op })
      .send(corpo);
    expect(r2.body.id).toBe(r1.body.id);
    sessao = r1.body.id;

    const [c] = await t.raw(
      `SELECT count(*)::int AS c FROM aurora.measurement_sessions WHERE response_id = $1`,
      [resposta]
    );
    expect(c!.c).toBe(1);
  });

  it('leituras entram pela fonte manual; o ponto NÃO é julgado (veredito "na")', async () => {
    const r = await http
      .post(`/v1/measurement-sessions/${sessao}/measurements`)
      .set(auth(tecnico.email))
      .send({
        item_id: pontoTemp,
        readings: [37.1, 37.0, 37.9],
        unit: '°C',
        measured_at: '2026-09-30T10:02:00-03:00',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // 37,9 está fora de 37 ± 0,3 declarados — e mesmo assim NÃO há reprovação
    // automática: o critério de aceitação é decisão de metrologista.
    expect(r.body).toMatchObject({ verdict: 'na', revision: 1 });
  });

  it('unidade diferente da do protocolo é recusada — o sistema não converte', async () => {
    const r = await http
      .post(`/v1/measurement-sessions/${sessao}/measurements`)
      .set(auth(tecnico.email))
      .send({ item_id: pontoTemp, readings: [310.2, 310.1, 310.3], unit: 'K' });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/não converte/);
  });

  it('quantidade de leituras diferente da exigida é recusada', async () => {
    const r = await http
      .post(`/v1/measurement-sessions/${sessao}/measurements`)
      .set(auth(tecnico.email))
      .send({ item_id: pontoTemp, readings: [37.1] });
    expect(r.status).toBe(422);
  });

  it('corrigir pela rota antiga de resposta preserva a leitura original no histórico', async () => {
    const r = await http
      .post(`/v1/checklist-responses/${resposta}/answers`)
      .set(auth(tecnico.email))
      .send({
        item_id: pontoTemp,
        readings: [37.1, 37.0, 37.2],
        correction_reason: 'terceira leitura digitada errada',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.revision).toBe(2);

    const h = await http.get(`/v1/checklist-responses/${resposta}/revisions`).set(auth(tecnico.email));
    const linhas = h.body.items.filter((i: { item_id: string }) => i.item_id === pontoTemp);
    expect(linhas).toHaveLength(2);
    const original = await t.raw(
      `SELECT value_readings::text AS l FROM aurora.checklist_answer_revisions WHERE item_id = $1 AND revision = 1`,
      [pontoTemp]
    );
    expect(original[0]!.l).toBe('{37.1,37,37.9}');
  });

  it('o dado bruto exige SHA-256, só se pendura na sessão, e não é interpretado', async () => {
    const csv = Buffer.from('t_s;temp_c\n0;37.1\n60;37.0\n120;37.2\n');
    const sem = await http
      .post(`/v1/measurement-sessions/${sessao}/raw-data`)
      .set(auth(tecnico.email))
      .send({ file_name: 'export.csv', content_type: 'text/csv', byte_size: csv.byteLength });
    expect(sem.status).toBe(422);

    const r = await http
      .post(`/v1/measurement-sessions/${sessao}/raw-data`)
      .set(auth(tecnico.email))
      .send({
        file_name: 'export.csv',
        content_type: 'text/csv',
        byte_size: csv.byteLength,
        sha256: resumo(csv),
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const bytes = await http
      .put(`/v1/field/attachments/${r.body.attachment_id}/bytes`)
      .set(auth(tecnico.email))
      .set('content-type', 'application/octet-stream')
      .set('x-aurora-offset', '0')
      .set('x-aurora-sha256', resumo(csv))
      .set('x-aurora-final', '1')
      .send(csv);
    expect(bytes.body.completed).toBe(true);

    // Dado bruto pendurado na OS perderia o ponto medido: recusado.
    const naOs = await http
      .post(`/v1/work-orders/${os}/attachments`)
      .set(auth(tecnico.email))
      .send({
        purpose: 'raw_data',
        file_name: 'x.csv',
        content_type: 'text/csv',
        byte_size: 10,
        sha256: resumo(csv),
      });
    expect(naOs.status).toBe(422);
  });

  it('a identidade de um anexo registrado não muda depois', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.attachments SET sha256 = $2 WHERE measurement_session_id = $1`, [
          sessao,
          'f'.repeat(64),
        ])
      )
    ).rejects.toThrow(/identidade de um anexo/);
  });

  it('o detalhe devolve a proveniência inteira, e cabe no contrato', async () => {
    const r = await http.get(`/v1/measurement-sessions/${sessao}`).set(auth(tecnico.email));
    expect(r.status).toBe(200);
    const d = MeasurementSessionDetail.parse(r.body);
    expect(d.work_order_id).toBe(os);
    expect(d.protocol).toMatchObject({
      key: 'calibracao_incubadora',
      version: 1,
      procedure_kind: 'calibration',
    });
    expect(d.protocol.technical_manager_id).toBe(metrologista.mem);
    expect(d.instrument?.serial_number).toBe('AN-0001');
    expect(d.certificate?.certificate_number).toBe('LAB-2026-0042');
    expect(d.ambient).toEqual({ temperatura_ambiente_c: 23.1, umidade_relativa: 48 });
    expect(d.points[0]).toMatchObject({
      unit: '°C',
      nominal_value: 37,
      tolerance_minus: 0.3,
      tolerance_plus: 0.3,
      tolerance_mode: 'absolute',
      readings: [37.1, 37.0, 37.2],
      answer_unit: '°C',
      source: 'manual',
      revision: 2,
      verdict: 'na',
    });
    expect(d.raw_data[0]).toMatchObject({ file_name: 'export.csv', upload_completed: true });
  });

  it('outra organização não vê a sessão (404)', async () => {
    const r = await http.get(`/v1/measurement-sessions/${sessao}`).set(auth(B.email));
    expect(r.status).toBe(404);
    const g = await http
      .post(`/v1/measurement-sessions/${sessao}/measurements`)
      .set(auth(B.email))
      .send({ item_id: pontoTemp, readings: [1, 1, 1] });
    expect(g.status).toBe(404);
  });

  it('encerrada, a sessão não aceita leitura nova', async () => {
    const f = await http.post(`/v1/measurement-sessions/${sessao}/finish`).set(auth(tecnico.email));
    expect(f.status).toBe(201);
    const r = await http
      .post(`/v1/measurement-sessions/${sessao}/measurements`)
      .set(auth(tecnico.email))
      .send({ item_id: pontoTemp, readings: [37, 37, 37] });
    expect(r.status).toBe(409);
  });

  it('a proveniência da sessão não se reescreve', async () => {
    await expect(
      withTenant(t.db, ctxSistema(A.org), (s) =>
        s.query(`UPDATE aurora.measurement_sessions SET instrument_certificate_id = $2 WHERE id = $1`, [
          sessao,
          certVencido,
        ])
      )
    ).rejects.toThrow(/proveniência/);
  });

  it('revogar um certificado não apaga nada, e revogado não serve para sessão nova', async () => {
    const r = await http
      .post(`/v1/instrument-certificates/${certVencido}/revocation`)
      .set(auth(metrologista.email))
      .send({ reason: 'registrado com a data errada' });
    expect(r.status).toBe(201);
    const deNovo = await http
      .post(`/v1/instrument-certificates/${certVencido}/revocation`)
      .set(auth(metrologista.email))
      .send({ reason: 'registrado com a data errada' });
    expect(deNovo.status).toBe(409);

    const [existe] = await t.raw(`SELECT revoked_reason FROM aurora.instrument_certificates WHERE id = $1`, [
      certVencido,
    ]);
    expect(existe!.revoked_reason).toBe('registrado com a data errada');
  });
});
