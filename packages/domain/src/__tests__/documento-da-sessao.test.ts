/**
 * Aurora — o instantâneo da sessão no documento é CÓPIA (gap V2 P2.6).
 */
import { describe, it, expect } from 'vitest';
import {
  payloadDaSessao,
  instantaneoIntegro,
  documentTypesForProcedure,
  SESSION_SNAPSHOT_KEY,
  SESSION_SNAPSHOT_SCHEMA,
  DOCUMENT_TYPES,
  type SessaoParaDocumento,
} from '../index';

const sessao: SessaoParaDocumento = {
  id: 's-1',
  work_order_id: 'w-1',
  work_order_number: 'WO-2026-0001',
  asset_id: 'a-1',
  asset_name: 'Incubadora',
  source: 'manual',
  measured_on: '2026-09-30',
  started_at: '2026-09-30T13:00:00.000Z',
  finished_at: '2026-09-30T14:00:00.000Z',
  ambient: { temperatura_c: 22.4 },
  notes: '',
  technician: { membership_id: 'm-1', name: 'Técnica' },
  protocol: {
    template_id: 't-1',
    key: 'cal',
    version: 3,
    title: 'Calibração',
    procedure_kind: 'calibration',
    technical_manager_id: 'm-2',
    technical_manager_name: 'RT',
  },
  instrument: null,
  certificate: null,
  points: [
    {
      item_id: 'i-1',
      label: 'Temperatura',
      unit: '°C',
      nominal_value: 37,
      tolerance_minus: 0.5,
      tolerance_plus: 0.5,
      tolerance_mode: 'absolute',
      readings_required: 3,
      readings: [37.123456, 36.9, 37.04],
      source: 'manual',
      instrument_id: null,
      revision: 2,
      measured_at: '2026-09-30T13:30:00.000Z',
    },
  ],
  raw_data: [{ id: 'r-1', file_name: 'x.csv', content_type: 'text/csv', sha256: 'f'.repeat(64) }],
};

describe('instantâneo', () => {
  it('mora numa chave reservada, com esquema versionado', () => {
    const p = payloadDaSessao(sessao);
    expect(Object.keys(p)).toEqual([SESSION_SNAPSHOT_KEY]);
    const inst = p[SESSION_SNAPSHOT_KEY] as Record<string, unknown>;
    expect(inst.schema).toBe(SESSION_SNAPSHOT_SCHEMA);
    expect(instantaneoIntegro(p, 's-1')).toBe(true);
    expect(instantaneoIntegro(p, 's-2')).toBe(false);
    expect(instantaneoIntegro({}, 's-1')).toBe(false);
  });

  it('as leituras saem EXATAMENTE como vieram — nem arredondadas, nem resumidas', () => {
    const inst = payloadDaSessao(sessao)[SESSION_SNAPSHOT_KEY] as { points: Array<Record<string, unknown>> };
    expect(inst.points[0]!.readings).toEqual([37.123456, 36.9, 37.04]);
    const texto = JSON.stringify(inst);
    expect(texto).not.toMatch(
      /"(mean|media|average|stddev|uncertainty|incerteza|error|erro|corrected|verdict)"/
    );
  });

  it('não há undefined em lugar nenhum — o hash canônico distingue ausente de nulo', () => {
    const texto = JSON.stringify(payloadDaSessao(sessao), (_k, v) => (v === undefined ? '__UNDEFINED__' : v));
    expect(texto).not.toContain('__UNDEFINED__');
  });
});

describe('qual documento cada procedimento gera', () => {
  it('lista fechada, e todo tipo apontado existe no catálogo', () => {
    expect(documentTypesForProcedure('calibration')).toEqual(['calibration_certificate']);
    expect(documentTypesForProcedure('electrical_safety')).toEqual(['electrical_safety_test']);
    expect(documentTypesForProcedure('qualification')).toEqual(['thermal_qualification']);
    expect(documentTypesForProcedure('acceptance')).toEqual(['acceptance_report']);
    expect(documentTypesForProcedure(null)).toEqual(['work_order_report']);
    expect(documentTypesForProcedure('inventado')).toEqual([]);
    const chaves = DOCUMENT_TYPES.map((t) => t.key as string);
    for (const k of ['calibration', 'electrical_safety', 'qualification', 'acceptance', null]) {
      for (const tipo of documentTypesForProcedure(k)) expect(chaves).toContain(tipo);
    }
  });
});
