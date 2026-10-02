/**
 * Aurora — o rascunho de documento técnico a partir da sessão de medição
 * (0054 · gap V2 P2.6 · PLAT §6.2 · critério 6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO COPIA. ELE NÃO CALCULA.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O fluxo do PLAT §6.2 termina em "relatório → revisão → aprovação →
 * assinatura". O motor de documentos já faz a segunda metade. O que faltava era
 * a ponte: levar o que foi MEDIDO para dentro do documento sem ninguém
 * redigitar — e sem o sistema acrescentar nada que não foi medido.
 *
 * Por isso o instantâneo leva as leituras como vieram, o nominal e as
 * tolerâncias como o protocolo declarou, e NÃO leva média, desvio, incerteza,
 * erro, valor corrigido, arredondado ou veredito por ponto. Cada um desses é
 * uma das decisões bloqueadas da fronteira metrológica. O aviso vai escrito
 * no próprio conteúdo — quem lê o documento sabe o que ele não afirma.
 *
 * O veredito do DOCUMENTO continua sendo informado por uma pessoa com
 * permissão, na revisão, como sempre foi.
 */
import type { DocumentTypeKey } from './documents';

/** O formato do instantâneo — versionado para uma leitura futura saber o que encontra. */
export const SESSION_SNAPSHOT_SCHEMA = 'aurora.measurement-session/1' as const;

export const AVISO_SEM_VEREDITO_AUTOMATICO =
  'Leituras registradas sem cálculo e sem veredito automático por ponto: critério de aceitação, ' +
  'incerteza, correção e arredondamento não foram validados por metrologista (fronteira metrológica).';

/**
 * Que tipos de documento cada tipo de procedimento pode gerar.
 *
 * Lista fechada. Gerar um certificado de calibração a partir de um protocolo de
 * TSE produziria um documento cujo título promete o que a medição não fez.
 * Qualificação aponta para a qualificação TÉRMICA porque é a única
 * qualificação provisionada no catálogo de tipos; outra família de
 * qualificação entra como tipo novo, por decisão.
 */
export const DOCUMENT_TYPES_BY_PROCEDURE: Readonly<Record<string, readonly DocumentTypeKey[]>> =
  Object.freeze({
    calibration: ['calibration_certificate'],
    electrical_safety: ['electrical_safety_test'],
    qualification: ['thermal_qualification'],
    acceptance: ['acceptance_report'],
    /** Checklist operacional (sem tipo de procedimento): só o relatório de OS. */
    none: ['work_order_report'],
  });

export function documentTypesForProcedure(procedureKind: string | null): readonly DocumentTypeKey[] {
  return DOCUMENT_TYPES_BY_PROCEDURE[procedureKind ?? 'none'] ?? [];
}

/** O que a camada de dados entrega sobre a sessão — só o necessário para copiar. */
export interface SessaoParaDocumento {
  id: string;
  work_order_id: string;
  work_order_number: string | null;
  asset_id: string | null;
  asset_name: string | null;
  source: string;
  measured_on: string;
  started_at: string;
  finished_at: string | null;
  ambient: Readonly<Record<string, unknown>>;
  notes: string;
  technician: { membership_id: string; name: string | null } | null;
  protocol: {
    template_id: string;
    key: string;
    version: number;
    title: string;
    procedure_kind: string | null;
    technical_manager_id: string | null;
    technical_manager_name: string | null;
  };
  instrument: {
    asset_id: string;
    name: string;
    tag: string | null;
    serial_number: string | null;
    manufacturer_name: string | null;
    model_name: string | null;
  } | null;
  certificate: {
    id: string;
    certificate_number: string;
    laboratory: string;
    issued_on: string;
    valid_until: string;
    traceability_statement: string;
  } | null;
  points: ReadonlyArray<{
    item_id: string;
    label: string;
    unit: string | null;
    nominal_value: number | null;
    tolerance_minus: number | null;
    tolerance_plus: number | null;
    tolerance_mode: string | null;
    readings_required: number | null;
    readings: readonly number[] | null;
    source: string | null;
    instrument_id: string | null;
    revision: number | null;
    measured_at: string | null;
  }>;
  raw_data: ReadonlyArray<{ id: string; file_name: string; content_type: string; sha256: string | null }>;
}

/**
 * Monta o payload do rascunho — CÓPIA campo a campo.
 *
 * Sem `undefined` em lugar nenhum (o hash canônico distingue `null` de
 * ausente), e na ordem do protocolo. Nenhum número é transformado.
 */
/**
 * A chave RESERVADA do payload onde o instantâneo mora.
 *
 * Os campos do TIPO de documento (`payload_fields`, definidos por norma e
 * hoje vazios — fronteira) ficam no nível de cima; o instantâneo da sessão
 * fica aqui dentro. Assim a validação dos campos do tipo não confunde
 * proveniência copiada com campo inventado, e um campo técnico que entrar
 * amanhã não colide com nenhuma chave do instantâneo.
 */
export const SESSION_SNAPSHOT_KEY = 'measurement_session' as const;

export function payloadDaSessao(s: SessaoParaDocumento): Record<string, unknown> {
  return { [SESSION_SNAPSHOT_KEY]: instantaneoDaSessao(s) };
}

function instantaneoDaSessao(s: SessaoParaDocumento): Record<string, unknown> {
  return {
    schema: SESSION_SNAPSHOT_SCHEMA,
    measurement_session_id: s.id,
    work_order: { id: s.work_order_id, number: s.work_order_number },
    asset: s.asset_id ? { id: s.asset_id, name: s.asset_name } : null,
    protocol: {
      key: s.protocol.key,
      version: s.protocol.version,
      title: s.protocol.title,
      procedure_kind: s.protocol.procedure_kind,
      technical_manager: s.protocol.technical_manager_id
        ? { membership_id: s.protocol.technical_manager_id, name: s.protocol.technical_manager_name }
        : null,
    },
    instrument: s.instrument
      ? {
          asset_id: s.instrument.asset_id,
          name: s.instrument.name,
          tag: s.instrument.tag,
          serial_number: s.instrument.serial_number,
          manufacturer: s.instrument.manufacturer_name,
          model: s.instrument.model_name,
        }
      : null,
    instrument_certificate: s.certificate
      ? {
          id: s.certificate.id,
          number: s.certificate.certificate_number,
          laboratory: s.certificate.laboratory,
          issued_on: s.certificate.issued_on,
          valid_until: s.certificate.valid_until,
          traceability: s.certificate.traceability_statement,
        }
      : null,
    measured_on: s.measured_on,
    started_at: s.started_at,
    finished_at: s.finished_at,
    measurement_source: s.source,
    technician: s.technician ? { membership_id: s.technician.membership_id, name: s.technician.name } : null,
    ambient: { ...s.ambient },
    notes: s.notes,
    points: s.points.map((p) => ({
      item_id: p.item_id,
      label: p.label,
      unit: p.unit,
      nominal: p.nominal_value,
      tolerance_minus: p.tolerance_minus,
      tolerance_plus: p.tolerance_plus,
      tolerance_mode: p.tolerance_mode,
      readings_required: p.readings_required,
      readings: p.readings ? [...p.readings] : null,
      source: p.source,
      instrument_id: p.instrument_id,
      revision: p.revision,
      measured_at: p.measured_at,
    })),
    raw_data: s.raw_data.map((r) => ({
      attachment_id: r.id,
      file_name: r.file_name,
      content_type: r.content_type,
      sha256: r.sha256,
    })),
    notice: AVISO_SEM_VEREDITO_AUTOMATICO,
  };
}

/**
 * O conteúdo do rascunho ainda diz de qual sessão veio?
 *
 * O rascunho é editável até a revisão. Se alguém apagar o vínculo de dentro do
 * conteúdo, o documento passaria a afirmar medições sem dizer de onde — e a
 * emissão recusa.
 */
export function instantaneoIntegro(payload: Readonly<Record<string, unknown>>, sessionId: string): boolean {
  const inst = payload[SESSION_SNAPSHOT_KEY] as Record<string, unknown> | null | undefined;
  return (
    !!inst &&
    typeof inst === 'object' &&
    inst.schema === SESSION_SNAPSHOT_SCHEMA &&
    inst.measurement_session_id === sessionId
  );
}
