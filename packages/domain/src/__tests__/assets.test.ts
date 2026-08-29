/**
 * Aurora — regras puras de ativo (SPEC v0.2 §07 · EPIC-005).
 */
import { describe, it, expect } from 'vitest';
import {
  generateQrToken,
  isQrToken,
  countsForAvailability,
  isRetired,
  effectiveSpecs,
  overriddenSpecKeys,
  assetAgeYears,
  isUnderWarranty,
  validateImportRow,
  ASSET_STATUSES,
} from '../assets';

/** Gerador determinístico: o teste não deve depender de entropia real. */
const sequencial = (start = 0) => {
  let n = start;
  return (len: number) => Uint8Array.from({ length: len }, () => n++ % 256);
};

describe('token do QR Code', () => {
  it('tem 26 caracteres e passa na própria validação', () => {
    const token = generateQrToken(sequencial());
    expect(token).toHaveLength(26);
    expect(isQrToken(token)).toBe(true);
  });

  it('não usa caracteres ambíguos em etiqueta impressa', () => {
    for (let i = 0; i < 40; i++) {
      expect(generateQrToken(sequencial(i))).not.toMatch(/[01ILOU]/);
    }
  });

  it('recusa token de tamanho errado ou com caractere fora do alfabeto', () => {
    expect(isQrToken('ABC')).toBe(false);
    expect(isQrToken('AAAAAAAAAAAAAAAAAAAAAAAAA0')).toBe(false);
    expect(isQrToken(null)).toBe(false);
    expect(isQrToken(12345)).toBe(false);
  });

  it('entropias diferentes produzem tokens diferentes', () => {
    const tokens = new Set(Array.from({ length: 30 }, (_, i) => generateQrToken(sequencial(i))));
    expect(tokens.size).toBe(30);
  });
});

describe('disponibilidade', () => {
  it('só ativo e em manutenção contam', () => {
    const contam = ASSET_STATUSES.filter(countsForAvailability);
    expect(contam).toEqual(['active', 'under_maintenance']);
  });

  it('reserva não é indisponibilidade', () => {
    // premiar quem mantém sobressalente, não penalizar
    expect(countsForAvailability('standby')).toBe(false);
    expect(isRetired('standby')).toBe(false);
  });

  it('descomissionado e baixado saíram do inventário operacional', () => {
    expect(isRetired('decommissioned')).toBe(true);
    expect(isRetired('disposed')).toBe(true);
    expect(isRetired('loaned')).toBe(false);
  });
});

describe('herança de specs', () => {
  it('o ativo sobrescreve chave a chave, não o objeto inteiro', () => {
    const modelo = { tensao_v: 220, classe_risco: 'II', peso_kg: 8 };
    expect(effectiveSpecs(modelo, { tensao_v: 127 })).toEqual({
      tensao_v: 127,
      classe_risco: 'II',
      peso_kg: 8,
    });
  });

  it('ativo sem specs herda tudo; modelo ausente não quebra', () => {
    expect(effectiveSpecs({ a: 1 }, null)).toEqual({ a: 1 });
    expect(effectiveSpecs(null, { a: 1 })).toEqual({ a: 1 });
    expect(effectiveSpecs(null, null)).toEqual({});
  });

  it('sabe dizer o que foi sobrescrito, para a ficha poder marcar', () => {
    const modelo = { tensao_v: 220, classe_risco: 'II' };
    expect(overriddenSpecKeys(modelo, { tensao_v: 127, cor: 'branco' })).toEqual(['tensao_v']);
    // valor igual ao do modelo não é sobrescrita
    expect(overriddenSpecKeys(modelo, { tensao_v: 220 })).toEqual([]);
  });
});

describe('idade e garantia', () => {
  const agora = new Date('2026-08-28T12:00:00Z');

  it('prefere instalação, depois aquisição, depois fabricação', () => {
    expect(assetAgeYears({ installedAt: '2020-08-28', acquiredAt: '2018-01-01' }, agora)).toBe(6);
    expect(assetAgeYears({ acquiredAt: '2018-08-28' }, agora)).toBe(8);
    expect(assetAgeYears({ manufacturedAt: '2016-08-28' }, agora)).toBe(10);
  });

  it('sem nenhuma data devolve nulo, não zero', () => {
    // zero significaria "novo"; ativo sem data não é novo, é desconhecido
    expect(assetAgeYears({}, agora)).toBeNull();
    expect(assetAgeYears({ installedAt: 'não é data' }, agora)).toBeNull();
  });

  it('data futura não vira idade negativa', () => {
    expect(assetAgeYears({ installedAt: '2030-01-01' }, agora)).toBe(0);
  });

  it('garantia vigente no último dia ainda vale', () => {
    expect(isUnderWarranty('2026-08-28', agora)).toBe(true);
    expect(isUnderWarranty('2026-08-27', agora)).toBe(false);
    expect(isUnderWarranty(null, agora)).toBe(false);
  });
});

describe('validação de linha de importação', () => {
  const base = { line: 1, name: 'Monitor', category: 'Monitor' };

  it('linha bem formada não gera problema', () => {
    expect(validateImportRow(base)).toEqual([]);
  });

  it('nome e categoria são obrigatórios, e o problema traz o número da linha', () => {
    const issues = validateImportRow({ line: 42 });
    expect(issues.map((i) => i.field).sort()).toEqual(['category', 'name']);
    expect(issues.every((i) => i.line === 42)).toBe(true);
  });

  it('modelo sem fabricante é recusado; fabricante sem modelo é aceito', () => {
    expect(validateImportRow({ ...base, model: 'R3' })[0]?.field).toBe('manufacturer');
    expect(validateImportRow({ ...base, manufacturer: 'Mindray' })).toEqual([]);
  });

  it('data fora do formato ISO e data inexistente são recusadas', () => {
    expect(validateImportRow({ ...base, acquired_at: '31/12/2025' })[0]?.message).toMatch(/AAAA-MM-DD/);
    expect(validateImportRow({ ...base, acquired_at: '2025-02-30' })[0]?.message).toMatch(/calendário/);
  });

  it('valor de compra não numérico ou negativo é recusado', () => {
    expect(validateImportRow({ ...base, purchase_value: 'abc' })[0]?.message).toMatch(/não é um número/);
    expect(validateImportRow({ ...base, purchase_value: -1 })[0]?.message).toMatch(/negativo/);
    expect(validateImportRow({ ...base, purchase_value: 0 })).toEqual([]);
    expect(validateImportRow({ ...base, purchase_value: '' })).toEqual([]);
  });
});
