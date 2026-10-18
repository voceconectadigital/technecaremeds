/**
 * Aurora — engenharia clínica / metrologia N0 pela HTTP (gap V2 P2.1–P2.5).
 *
 * Controller fino: valida com o contrato, delega à camada de dados, devolve.
 *
 * A leitura de um ponto entra por UM caminho — a fonte manual produz um
 * envelope neutro, e o envelope é o que o núcleo grava (`registerMeasurement`).
 * Quando houver adaptador de arquivo ou de gateway, ele produz o mesmo envelope
 * e chega ao mesmo núcleo; esta classe não precisará mudar de forma.
 *
 * As rotas de sessão, leitura e dado bruto passam por `runFieldOperation`: o
 * técnico mede no subsolo, e reenviar a mesma leitura nunca pode duplicar nem
 * "corrigir" o que já foi gravado.
 *
 * QUEM MEDE NA OS DE QUEM (PF-14). Abrir sessão, registrar leitura, anexar
 * dado bruto e encerrar são ações de EXECUÇÃO da OS, guardadas por
 * `work_order.execute` — e por isso seguem a mesma regra do checklist que elas
 * preenchem: sem `work_order.execute_any`, só na OS atribuída à pessoa ou à
 * equipe dela (`assertCanExecuteWorkOrder`). Medir na OS de outro técnico
 * gravaria leitura com a proveniência de quem não estava lá. O metrologista
 * tem `execute_any` e mede em qualquer OS. A conferência roda DENTRO de
 * `runFieldOperation`, na transação da escrita, como nas demais rotas de campo.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  withTenant,
  registerInstrument,
  updateInstrument,
  listInstruments,
  registerInstrumentCertificate,
  revokeInstrumentCertificate,
  listInstrumentCertificates,
  attachCertificateFile,
  openMeasurementSession,
  finishMeasurementSession,
  registerMeasurement,
  attachRawData,
  measurementSessionDetail,
  measurementSessionsForWorkOrder,
  assertCanExecuteWorkOrder,
  assertCanExecuteMeasurementSession,
  type Database,
} from '@aurora/db';
import { fonteManual, NotFoundError, ValidationError } from '@aurora/domain';
import {
  instrumentsList,
  instrumentsRegister,
  instrumentsUpdate,
  instrumentsRegisterCertificate,
  instrumentCertificatesRevoke,
  instrumentCertificatesAttachFile,
  measurementSessionsOpen,
  measurementSessionsRecord,
  measurementSessionsAttachRawData,
} from '@aurora/contracts';
import { RequirePermissions } from '../common/permissions.guard';
import { parseWith } from '../common/contract-validation';
import { runFieldOperation } from '../common/client-operation';
import { uuidParam } from '../common/params';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('instruments')
export class InstrumentsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('instrument.read')
  async list(@Req() req: AuroraRequest, @Query() query: unknown): Promise<{ items: unknown[] }> {
    const q = parseWith(instrumentsList.query, query);
    const items = await withTenant(this.db, req.auroraContext!, (s) =>
      listInstruments(s, { status: q.status })
    );
    return { items };
  }

  @Post()
  @RequirePermissions('instrument.manage')
  async register(@Req() req: AuroraRequest, @Body() body: unknown): Promise<{ asset_id: string }> {
    const b = parseWith(instrumentsRegister.body, body);
    const assetId = await withTenant(this.db, req.auroraContext!, (s) =>
      registerInstrument(s, {
        assetId: b.asset_id,
        status: b.status,
        ownership: b.ownership,
        interface: b.interface,
        protocol: b.protocol,
        firmwareVersion: b.firmware_version,
        adapter: b.adapter,
        lastValidatedOn: b.last_validated_on,
        knownLimitations: b.known_limitations,
        notes: b.notes,
      })
    );
    return { asset_id: assetId };
  }

  @Get(':id')
  @RequirePermissions('instrument.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    const assetId = uuidParam(id, 'id');
    return withTenant(this.db, req.auroraContext!, async (s) => {
      const [instrument] = await listInstruments(s, { assetId });
      if (!instrument) throw new NotFoundError('Instrumento', assetId);
      return { instrument, certificates: await listInstrumentCertificates(s, assetId) };
    });
  }

  @Patch(':id')
  @RequirePermissions('instrument.manage')
  async update(@Req() req: AuroraRequest, @Param('id') id: string, @Body() body: unknown): Promise<unknown> {
    const assetId = uuidParam(id, 'id');
    const b = parseWith(instrumentsUpdate.body, body);
    return withTenant(this.db, req.auroraContext!, async (s) => {
      await updateInstrument(s, assetId, {
        status: b.status,
        ownership: b.ownership,
        interface: b.interface,
        protocol: b.protocol,
        firmwareVersion: b.firmware_version,
        adapter: b.adapter,
        lastValidatedOn: b.last_validated_on,
        knownLimitations: b.known_limitations,
        notes: b.notes,
      });
      const [instrument] = await listInstruments(s, { assetId });
      return instrument;
    });
  }

  @Post(':id/certificates')
  @RequirePermissions('instrument.manage')
  async registerCertificate(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string }> {
    const b = parseWith(instrumentsRegisterCertificate.body, body);
    const certId = await withTenant(this.db, req.auroraContext!, (s) =>
      registerInstrumentCertificate(s, {
        instrumentId: uuidParam(id, 'id'),
        certificateNumber: b.certificate_number,
        laboratory: b.laboratory,
        issuedOn: b.issued_on,
        validUntil: b.valid_until,
        scope: b.scope,
        traceabilityStatement: b.traceability_statement,
        traceableToId: b.traceable_to_id ?? null,
      })
    );
    return { id: certId };
  }
}

@Controller('instrument-certificates')
export class InstrumentCertificatesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post(':id/revocation')
  @RequirePermissions('instrument.manage')
  async revoke(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const b = parseWith(instrumentCertificatesRevoke.body, body);
    await withTenant(this.db, req.auroraContext!, (s) =>
      revokeInstrumentCertificate(s, uuidParam(id, 'id'), b.reason)
    );
    return { ok: true };
  }

  @Post(':id/files')
  @RequirePermissions('instrument.manage')
  async attach(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ attachment_id: string; storage_key: string }> {
    const b = parseWith(instrumentCertificatesAttachFile.body, body);
    const r = await withTenant(this.db, req.auroraContext!, (s) =>
      attachCertificateFile(s, uuidParam(id, 'id'), {
        fileName: b.file_name,
        contentType: b.content_type,
        byteSize: b.byte_size,
        sha256: b.sha256,
      })
    );
    return { attachment_id: r.id, storage_key: r.storageKey };
  }
}

@Controller('work-orders')
export class WorkOrderMeasurementController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':id/measurement-sessions')
  @RequirePermissions('work_order.read')
  async list(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ items: unknown[] }> {
    const woId = uuidParam(id, 'id');
    const items = await withTenant(this.db, req.auroraContext!, async (s) => {
      const [existe] = await s.query(`SELECT 1 FROM aurora.work_orders WHERE id = $1`, [woId]);
      if (!existe) throw new NotFoundError('Ordem de serviço', woId);
      return measurementSessionsForWorkOrder(s, woId);
    });
    return { items };
  }

  @Post(':id/measurement-sessions')
  @RequirePermissions('work_order.execute')
  async open(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ id: string }> {
    const woId = uuidParam(id, 'id');
    const b = parseWith(measurementSessionsOpen.body, body);
    const sessionId = await runFieldOperation(
      this.db,
      req,
      'POST /work-orders/:id/measurement-sessions',
      body,
      async (s) => {
        await assertCanExecuteWorkOrder(s, woId);
        // A resposta tem de ser DESTA OS: abrir sessão na OS A apontando a
        // resposta da OS B é exatamente o atalho que embaralha evidência.
        const [resp] = await s.query<{ work_order_id: string }>(
          `SELECT work_order_id FROM aurora.checklist_responses WHERE id = $1`,
          [b.response_id]
        );
        if (!resp || resp.work_order_id !== woId) {
          throw new NotFoundError('Resposta de checklist nesta OS', b.response_id);
        }
        return openMeasurementSession(s, {
          id: b.id,
          responseId: b.response_id,
          instrumentId: b.instrument_id ?? null,
          instrumentCertificateId: b.instrument_certificate_id ?? null,
          measuredOn: b.measured_on,
          ambient: b.ambient,
          notes: b.notes,
        });
      }
    );
    return { id: sessionId };
  }
}

@Controller('measurement-sessions')
export class MeasurementSessionsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':id')
  @RequirePermissions('work_order.read')
  async detail(@Req() req: AuroraRequest, @Param('id') id: string): Promise<unknown> {
    return withTenant(this.db, req.auroraContext!, (s) => measurementSessionDetail(s, uuidParam(id, 'id')));
  }

  /**
   * Leituras de um ponto pela FONTE MANUAL.
   *
   * O corpo vira envelope (`fonteManual.normalizar`) e o envelope vai ao
   * núcleo. A resposta-mãe vem da SESSÃO, nunca do corpo: o chamador escolhe o
   * ponto, não a evidência a que ele pertence.
   */
  @Post(':id/measurements')
  @RequirePermissions('work_order.execute')
  async record(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ answer_id: string; revision: number; verdict: string }> {
    const sessionId = uuidParam(id, 'id');
    const b = parseWith(measurementSessionsRecord.body, body);
    const r = await runFieldOperation(
      this.db,
      req,
      'POST /measurement-sessions/:id/measurements',
      body,
      async (s) => {
        const [sessao] = await s.query<{ response_id: string }>(
          `SELECT response_id FROM aurora.measurement_sessions WHERE id = $1`,
          [sessionId]
        );
        if (!sessao) throw new NotFoundError('Sessão de medição', sessionId);
        await assertCanExecuteMeasurementSession(s, sessionId);
        const envelope = fonteManual.normalizar({
          response_id: sessao.response_id,
          item_id: b.item_id,
          readings: b.readings,
          unit: b.unit,
          instrument_id: b.instrument_id,
          measured_at: b.measured_at,
          correction_reason: b.correction_reason,
        });
        return registerMeasurement(s, envelope);
      }
    );
    return { answer_id: r.answerId, revision: r.revision, verdict: r.verdict };
  }

  @Post(':id/finish')
  @RequirePermissions('work_order.execute')
  async finish(@Req() req: AuroraRequest, @Param('id') id: string): Promise<{ ok: true }> {
    const sessionId = uuidParam(id, 'id');
    await runFieldOperation(
      this.db,
      req,
      'POST /measurement-sessions/:id/finish',
      { session_id: id },
      async (s) => {
        await assertCanExecuteMeasurementSession(s, sessionId);
        await finishMeasurementSession(s, sessionId);
      }
    );
    return { ok: true };
  }

  @Post(':id/raw-data')
  @RequirePermissions('work_order.execute')
  async rawData(
    @Req() req: AuroraRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<{ attachment_id: string; storage_key: string }> {
    const b = parseWith(measurementSessionsAttachRawData.body, body);
    if (b.byte_size <= 0) throw new ValidationError('arquivo vazio', { field: 'byte_size' });
    const sessionId = uuidParam(id, 'id');
    const r = await runFieldOperation(
      this.db,
      req,
      'POST /measurement-sessions/:id/raw-data',
      body,
      async (s) => {
        await assertCanExecuteMeasurementSession(s, sessionId);
        return attachRawData(s, sessionId, {
          fileName: b.file_name,
          contentType: b.content_type,
          byteSize: b.byte_size,
          sha256: b.sha256,
        });
      }
    );
    return { attachment_id: r.id, storage_key: r.storageKey };
  }
}
