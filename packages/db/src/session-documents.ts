/**
 * Aurora — rascunho de documento técnico a partir da sessão de medição
 * (0054 · gap V2 P2.6 · PLAT §6.2 · critério 6).
 *
 * O conteúdo é CÓPIA (`payloadDaSessao`); daqui em diante quem manda é o motor
 * de documentos: revisão, assinatura, emissão, versão, hash e histórico.
 */
import {
  payloadDaSessao,
  documentTypesForProcedure,
  ConflictError,
  ValidationError,
  type DocumentTypeKey,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { createDocument } from './documents';
import { measurementSessionDetail } from './metrology';

export async function createDocumentFromSession(
  session: TenantSession,
  sessionId: string,
  opts: { documentTypeKey?: DocumentTypeKey; title?: string | null; technicalManagerId?: string | null } = {}
): Promise<{ id: string; documentTypeKey: DocumentTypeKey }> {
  const s = await measurementSessionDetail(session, sessionId);

  if (!s.finished_at) {
    // Copiar uma sessão aberta produziria um documento com metade das leituras
    // e a aparência de completo.
    throw new ConflictError('encerre a sessão de medição antes de gerar o documento');
  }

  const permitidos = documentTypesForProcedure(s.protocol.procedure_kind);
  const tipoKey = opts.documentTypeKey ?? permitidos[0];
  if (!tipoKey || !permitidos.includes(tipoKey)) {
    throw new ValidationError(
      `um protocolo de "${s.protocol.procedure_kind ?? 'checklist operacional'}" gera ${permitidos.join(', ')}, não "${String(opts.documentTypeKey)}"`,
      { field: 'document_type_key', allowed: permitidos }
    );
  }

  const [tipo] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.document_types WHERE key = $1 AND archived_at IS NULL`,
    [tipoKey]
  );
  if (!tipo) {
    throw new ConflictError(`o tipo de documento "${tipoKey}" não está provisionado nesta organização`);
  }

  const [os] = await session.query<{ customer_id: string | null }>(
    `SELECT customer_id FROM aurora.work_orders WHERE id = $1`,
    [s.work_order_id]
  );

  const id = await createDocument(session, {
    documentTypeId: tipo.id,
    title: opts.title ?? `${s.protocol.title} — ${s.asset_name ?? s.work_order_number ?? s.measured_on}`,
    assetId: s.asset_id,
    workOrderId: s.work_order_id,
    customerId: os?.customer_id ?? null,
    // O responsável técnico do PROTOCOLO é o padrão; a pessoa pode indicar outro.
    technicalManagerId: opts.technicalManagerId ?? s.protocol.technical_manager_id,
    payload: payloadDaSessao(s),
    // Veredito do documento é ato humano, na revisão. Nunca derivado das leituras.
    verdict: null,
    measurementSessionId: s.id,
  });
  return { id, documentTypeKey: tipoKey };
}
