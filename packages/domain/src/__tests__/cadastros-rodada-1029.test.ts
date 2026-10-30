/**
 * Aurora — regras de cadastro da rodada de 29/10/2026 (domínio puro).
 *
 *   · ATV-10  depreciação em linha reta com a metodologia explícita e o residual;
 *   · ATV-11  registro ANVISA × "não se aplica";
 *   · USR-04  telefone brasileiro com DDD e conselho exigido conforme a profissão;
 *   · USR-05  CNPJ (numérico e alfanumérico) pelos dígitos verificadores;
 *   · CLI-02  "Outro EAS"/"Outra empresa" fora das opções de cadastro novo;
 *   · CLI-03  setores padrão do EAS.
 */
import { describe, it, expect } from 'vitest';
import {
  straightLineDepreciation,
  assertResidualValue,
  assertAnvisaConsistency,
  DEPRECIATION_METHOD,
  normalizeBrazilianPhone,
  isValidBrazilianPhone,
  formatBrazilianPhone,
  isValidCnpj,
  normalizeCnpj,
  formatCnpj,
  requiredRegistrationKind,
  missingRegistrationForProfession,
  PROFESSION_SUGGESTIONS,
  isKnownRegistrationKind,
  isValidCustomerSubtype,
  isSelectableCustomerSubtype,
  LEGACY_CUSTOMER_SUBTYPES,
  customerSubtypeLabel,
  DEFAULT_EAS_SECTORS,
  COMMON_SECTORS,
  ValidationError,
} from '../index';

describe('ATV-10 · depreciação: metodologia explícita e residual', () => {
  const agora = new Date('2025-01-01T00:00:00Z');

  it('a metodologia diz o método, a data-base, a vida útil, o fim, o residual e a base', () => {
    const d = straightLineDepreciation({
      acquiredAt: '2020-01-01',
      usefulLifeYears: 10,
      purchaseValue: 10000,
      residualValue: 1000,
      now: agora,
    })!;
    expect(d.methodology).toEqual({
      method: 'straight_line',
      baseDate: '2020-01-01',
      usefulLifeYears: 10,
      endDate: '2030-01-01',
      residualValue: 1000,
      depreciableBase: 9000,
    });
    expect(DEPRECIATION_METHOD).toBe('straight_line');
  });

  it('o residual entra no cálculo: a cota anual é (compra − residual) ÷ vida útil, e o fim vale o residual', () => {
    const com = straightLineDepreciation({
      acquiredAt: '2020-01-01',
      usefulLifeYears: 10,
      purchaseValue: 12000,
      residualValue: 2000,
      now: agora,
    })!;
    const sem = straightLineDepreciation({
      acquiredAt: '2020-01-01',
      usefulLifeYears: 10,
      purchaseValue: 12000,
      now: agora,
    })!;
    expect(com.annualDepreciation).toBe(1000);
    expect(sem.annualDepreciation).toBe(1200);
    // Sem residual informado, o padrão é 0 — e a metodologia mostra o 0.
    expect(sem.methodology.residualValue).toBe(0);
    expect(sem.methodology.depreciableBase).toBe(12000);

    const fim = straightLineDepreciation({
      acquiredAt: '2000-01-01',
      usefulLifeYears: 10,
      purchaseValue: 12000,
      residualValue: 2000,
      now: agora,
    })!;
    expect(fim.bookValue).toBe(2000);
  });

  it('sem valor de compra (ou sem permissão financeira): residual e base saem nulos, o resto não', () => {
    const d = straightLineDepreciation({ acquiredAt: '2020-01-01', usefulLifeYears: 5, now: agora })!;
    expect(d.methodology.residualValue).toBeNull();
    expect(d.methodology.depreciableBase).toBeNull();
    expect(d.methodology.baseDate).toBe('2020-01-01');
    expect(d.methodology.endDate).toBe('2025-01-01');
  });

  it('29/02 + vida útil cai em 01/03 de ano comum, sem inventar dia', () => {
    const d = straightLineDepreciation({ acquiredAt: '2024-02-29', usefulLifeYears: 1, now: agora })!;
    expect(d.methodology.endDate).toBe('2025-03-01');
  });

  it('residual negativo ou maior que a compra é recusado; ausente vale 0', () => {
    expect(() => assertResidualValue(1000, -1)).toThrow(ValidationError);
    expect(() => assertResidualValue(1000, 1000.01)).toThrow(/maior que o valor de compra/);
    expect(() => assertResidualValue(1000, 1000)).not.toThrow();
    expect(() => assertResidualValue(1000, null)).not.toThrow();
    expect(() => assertResidualValue(null, 500)).not.toThrow();
  });
});

describe('ATV-11 · ANVISA: número OU "não se aplica"', () => {
  it('os dois juntos se contradizem', () => {
    expect(() => assertAnvisaConsistency('80102030040', true)).toThrow(ValidationError);
    try {
      assertAnvisaConsistency('80102030040', true);
    } catch (e) {
      expect((e as ValidationError).details).toMatchObject({ field: 'anvisa_not_applicable' });
    }
  });
  it('número sozinho, "não se aplica" sozinho ou nenhum dos dois: aceitos', () => {
    expect(() => assertAnvisaConsistency('80102030040', false)).not.toThrow();
    expect(() => assertAnvisaConsistency(null, true)).not.toThrow();
    expect(() => assertAnvisaConsistency('   ', true)).not.toThrow();
    expect(() => assertAnvisaConsistency(null, false)).not.toThrow();
  });
});

describe('USR-04 · telefone brasileiro com DDD', () => {
  it('celular (9 dígitos começando por 9) e fixo (8 dígitos, de 2 a 5), com ou sem +55 e pontuação', () => {
    expect(normalizeBrazilianPhone('(31) 99999-0000')).toBe('31999990000');
    expect(normalizeBrazilianPhone('+55 31 99999-0000')).toBe('31999990000');
    expect(normalizeBrazilianPhone('5531999990000')).toBe('31999990000');
    expect(normalizeBrazilianPhone('31 3333-0000')).toBe('3133330000');
    expect(normalizeBrazilianPhone('+55 (11) 2345-6789')).toBe('1123456789');
  });
  it('recusa sem DDD, DDD inexistente, celular sem o 9 e fixo começando por 6–9', () => {
    expect(isValidBrazilianPhone('99999-0000')).toBe(false); // sem DDD
    expect(isValidBrazilianPhone('(20) 99999-0000')).toBe(false); // DDD 20 não existe
    expect(isValidBrazilianPhone('(01) 3333-0000')).toBe(false);
    expect(isValidBrazilianPhone('(31) 89999-0000')).toBe(false); // 9 dígitos sem o 9
    expect(isValidBrazilianPhone('(31) 9999-0000')).toBe(false); // fixo começando por 9
    expect(isValidBrazilianPhone('abc')).toBe(false);
    expect(isValidBrazilianPhone('(31) 99999-00000')).toBe(false);
  });
  it('formata num jeito só', () => {
    expect(formatBrazilianPhone('31999990000')).toBe('(31) 99999-0000');
    expect(formatBrazilianPhone('+55 31 3333 0000')).toBe('(31) 3333-0000');
  });
});

describe('USR-04 · conselho exigido conforme a profissão (e só ele)', () => {
  it('as profissões da lista com conselho: médico → CRM, enfermagem → COREN, engenheiro → CREA, técnico → CFT', () => {
    expect(requiredRegistrationKind('Médico(a)')).toBe('CRM');
    expect(requiredRegistrationKind('Enfermeiro(a)')).toBe('COREN');
    expect(requiredRegistrationKind('Técnico(a) de enfermagem')).toBe('COREN');
    expect(requiredRegistrationKind('Auxiliar de enfermagem')).toBe('COREN');
    expect(requiredRegistrationKind('Engenheiro(a)')).toBe('CREA');
    expect(requiredRegistrationKind('Técnico(a)')).toBe('CFT');
    expect(requiredRegistrationKind('fisioterapeuta')).toBe('CREFITO');
    expect(requiredRegistrationKind('  ENGENHEIRA ')).toBe('CREA');
  });
  it('profissões sem conselho obrigatório (e texto livre) não exigem nada', () => {
    for (const p of ['Comprador(a)', 'Gerente', 'Diretor(a)', 'Empresário(a)', 'Analista de compras', '']) {
      expect(requiredRegistrationKind(p), p).toBeNull();
    }
    expect(requiredRegistrationKind(null)).toBeNull();
  });
  it('todo conselho exigido é um tipo de registro que o cadastro já conhece', () => {
    for (const p of [...PROFESSION_SUGGESTIONS, 'Fisioterapeuta']) {
      const k = requiredRegistrationKind(p);
      if (k) expect(isKnownRegistrationKind(k), p).toBe(true);
    }
  });
  it('exige SÓ o conselho da profissão — não todos ao mesmo tempo', () => {
    expect(missingRegistrationForProfession('Engenheiro(a)', [])).toMatch(/CREA/);
    expect(missingRegistrationForProfession('Engenheiro(a)', [{ kind: 'CRM' }])).toMatch(/CREA/);
    expect(missingRegistrationForProfession('Engenheiro(a)', [{ kind: 'crea' }])).toBeNull();
    expect(missingRegistrationForProfession('Enfermeiro(a)', [{ kind: 'COREN' }])).toBeNull();
    expect(missingRegistrationForProfession('Gerente', [])).toBeNull();
  });
});

describe('USR-05 · CNPJ pelos dígitos verificadores', () => {
  it('aceita o numérico, com ou sem pontuação', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('aceita o alfanumérico da Receita (cada caractere vale ASCII − 48)', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
  });
  it('recusa dígito verificador errado, tamanho errado e sequência repetida', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });
});

describe('CLI-02 · "Outro EAS" e "Outra empresa" fora do cadastro novo', () => {
  it('não se escolhem num cadastro novo', () => {
    expect(LEGACY_CUSTOMER_SUBTYPES).toEqual(['outro_eas', 'outro_corporativo']);
    expect(isSelectableCustomerSubtype('eas', 'outro_eas')).toBe(false);
    expect(isSelectableCustomerSubtype('corporate', 'outro_corporativo')).toBe(false);
    expect(isSelectableCustomerSubtype('eas', 'hospital')).toBe(true);
    expect(isSelectableCustomerSubtype('eas', null)).toBe(true);
  });
  it('o cliente antigo continua com o segmento: válido, com rótulo, e editável sem trocá-lo', () => {
    expect(isValidCustomerSubtype('eas', 'outro_eas')).toBe(true);
    expect(customerSubtypeLabel('outro_eas')).toBe('Outro EAS');
    expect(isSelectableCustomerSubtype('eas', 'outro_eas', 'outro_eas')).toBe(true);
    // Mas um cliente com outro segmento não passa PARA ele.
    expect(isSelectableCustomerSubtype('eas', 'outro_eas', 'hospital')).toBe(false);
  });
});

describe('CLI-03 · setores padrão do EAS', () => {
  it('Pronto Atendimento, Bloco Cirúrgico, UTI e Enfermaria — e continuam entre os atalhos de nome', () => {
    expect([...DEFAULT_EAS_SECTORS]).toEqual(['Pronto Atendimento', 'Bloco Cirúrgico', 'UTI', 'Enfermaria']);
    for (const s of DEFAULT_EAS_SECTORS) expect(COMMON_SECTORS).toContain(s);
  });
});
