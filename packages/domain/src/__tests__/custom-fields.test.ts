/**
 * Aurora — motor de campos personalizados (SPEC v0.2 §29, ADR-009 · EPIC-004).
 *
 * A regra que estes testes protegem: a validação é do servidor. O formulário
 * usa a mesma função, mas quem decide é este código — e por isso ele precisa
 * ser correto sozinho, sem depender de nada ter sido filtrado antes.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDefinition,
  validateCustomValues,
  fieldApplies,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  type CustomFieldDefinition,
} from '../custom-fields';

const texto = (over: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition => ({
  key: 'observacao',
  label: 'Observação',
  kind: 'text',
  ...over,
});

describe('coerência da definição', () => {
  it('aceita uma definição simples', () => {
    expect(validateDefinition(texto())).toEqual([]);
  });

  it('recusa chave fora do formato', () => {
    expect(validateDefinition(texto({ key: 'Observação' }))[0]?.message).toMatch(/chave/);
    expect(validateDefinition(texto({ key: '1abc' }))).toHaveLength(1);
  });

  it('seleção sem opção é definição inutilizável', () => {
    const issues = validateDefinition(texto({ kind: 'select' }));
    expect(issues[0]?.message).toMatch(/ao menos uma opção/);
  });

  it('opção em campo que não é seleção é configuração que nunca seria lida', () => {
    const issues = validateDefinition(texto({ kind: 'number', options: ['a'] }));
    expect(issues[0]?.message).toMatch(/só fazem sentido em select/);
  });

  it('recusa opções repetidas', () => {
    const issues = validateDefinition(texto({ kind: 'select', options: ['A', 'B', 'A'] }));
    expect(issues[0]?.message).toMatch(/repetidas/);
  });

  it('recusa faixa invertida', () => {
    const issues = validateDefinition(texto({ kind: 'number', min: 10, max: 1 }));
    expect(issues[0]?.message).toMatch(/mínimo é maior/);
  });

  it('recusa expressão regular inválida, em vez de estourar depois', () => {
    const issues = validateDefinition(texto({ regex: '[' }));
    expect(issues[0]?.message).toMatch(/regular é inválida/);
  });

  it('recusa valor padrão que a própria definição rejeitaria', () => {
    const issues = validateDefinition(texto({ kind: 'select', options: ['A'], defaultValue: 'Z' }));
    expect(issues[0]?.message).toMatch(/valor padrão inválido/);
  });

  it('o limite por entidade está declarado onde a migration também o aplica', () => {
    expect(MAX_CUSTOM_FIELDS_PER_ENTITY).toBe(50);
  });
});

describe('validação de valores', () => {
  const defs: CustomFieldDefinition[] = [
    { key: 'tensao_v', label: 'Tensão (V)', kind: 'number', min: 90, max: 250, required: true },
    { key: 'classe_risco', label: 'Classe de risco', kind: 'select', options: ['I', 'II', 'III'] },
    { key: 'acessorios', label: 'Acessórios', kind: 'multi_select', options: ['cabo', 'sensor'] },
    { key: 'manual', label: 'Manual', kind: 'url' },
    { key: 'instalado_em', label: 'Instalado em', kind: 'date' },
    { key: 'patrimoniado', label: 'Patrimoniado', kind: 'boolean' },
  ];

  it('aceita um conjunto válido e devolve só o que foi validado', () => {
    const r = validateCustomValues(defs, {
      tensao_v: 220,
      classe_risco: 'III',
      acessorios: ['cabo'],
      manual: 'https://exemplo.test/manual.pdf',
      instalado_em: '2026-03-01',
      patrimoniado: true,
    });
    expect(r.issues).toEqual([]);
    expect(r.values.tensao_v).toBe(220);
    expect(r.values.acessorios).toEqual(['cabo']);
  });

  it('chave desconhecida é erro, não é descartada em silêncio', () => {
    const r = validateCustomValues(defs, { tensao_v: 220, inventado: 'x' });
    expect(r.issues.map((i) => i.key)).toContain('inventado');
    expect(r.values).not.toHaveProperty('inventado');
  });

  it('número fora da faixa é recusado com o limite na mensagem', () => {
    const r = validateCustomValues(defs, { tensao_v: 500 });
    expect(r.issues[0]?.message).toMatch(/não pode ser maior que 250/);
  });

  it('texto onde se espera número não é convertido por conveniência', () => {
    const r = validateCustomValues(defs, { tensao_v: '220' });
    expect(r.issues[0]?.message).toMatch(/esperado número/);
  });

  it('opção fora da lista é recusada nomeando o valor', () => {
    const r = validateCustomValues(defs, { tensao_v: 220, classe_risco: 'IV' });
    expect(r.issues[0]?.message).toMatch(/"IV" não está entre as opções/);
  });

  it('multi_select recusa item fora da lista e item repetido', () => {
    const a = validateCustomValues(defs, { tensao_v: 220, acessorios: ['cabo', 'bateria'] });
    expect(a.issues[0]?.message).toMatch(/fora da lista: bateria/);
    const b = validateCustomValues(defs, { tensao_v: 220, acessorios: ['cabo', 'cabo'] });
    expect(b.issues[0]?.message).toMatch(/repetidas/);
  });

  it('endereço sem esquema http é recusado', () => {
    const r = validateCustomValues(defs, { tensao_v: 220, manual: 'javascript:alert(1)' });
    expect(r.issues[0]?.message).toMatch(/http ou https/);
  });

  it('data fora do formato ISO é recusada', () => {
    const r = validateCustomValues(defs, { tensao_v: 220, instalado_em: '01/03/2026' });
    expect(r.issues[0]?.message).toMatch(/AAAA-MM-DD/);
  });

  it('campo obrigatório ausente é recusado', () => {
    const r = validateCustomValues(defs, {});
    expect(r.issues[0]?.message).toMatch(/Tensão \(V\) é obrigatório/);
  });

  it('string vazia conta como ausente, não como valor', () => {
    const r = validateCustomValues(defs, { tensao_v: '' });
    expect(r.issues[0]?.message).toMatch(/obrigatório/);
  });

  it('valor padrão preenche o ausente', () => {
    const comPadrao: CustomFieldDefinition[] = [
      { key: 'classe_risco', label: 'Classe', kind: 'select', options: ['I', 'II'], defaultValue: 'I' },
    ];
    expect(validateCustomValues(comPadrao, {}).values.classe_risco).toBe('I');
  });
});

describe('aplicabilidade condicional', () => {
  const soParaCalibracao: CustomFieldDefinition = {
    key: 'incerteza',
    label: 'Incerteza',
    kind: 'number',
    required: true,
    appliesWhen: { work_order_type: 'calibration' },
  };

  it('sem condição, o campo sempre se aplica', () => {
    expect(fieldApplies({ key: 'x', label: 'X', kind: 'text' }, {})).toBe(true);
  });

  it('a condição compara igualdade e pertencimento a lista', () => {
    expect(fieldApplies(soParaCalibracao, { work_order_type: 'calibration' })).toBe(true);
    expect(fieldApplies(soParaCalibracao, { work_order_type: 'corrective' })).toBe(false);
    const lista: CustomFieldDefinition = {
      ...soParaCalibracao,
      appliesWhen: { work_order_type: ['calibration', 'inspection'] },
    };
    expect(fieldApplies(lista, { work_order_type: 'inspection' })).toBe(true);
    expect(fieldApplies(lista, { work_order_type: 'corrective' })).toBe(false);
  });

  it('campo obrigatório que não se aplica NÃO é exigido', () => {
    const r = validateCustomValues([soParaCalibracao], {}, { work_order_type: 'corrective' });
    expect(r.issues).toEqual([]);
  });

  it('campo obrigatório que se aplica é exigido', () => {
    const r = validateCustomValues([soParaCalibracao], {}, { work_order_type: 'calibration' });
    expect(r.issues[0]?.message).toMatch(/obrigatório/);
  });

  it('valor de campo que deixou de se aplicar é removido, não guardado', () => {
    const r = validateCustomValues([soParaCalibracao], { incerteza: 0.5 }, { work_order_type: 'corrective' });
    expect(r.issues).toEqual([]);
    expect(r.values).not.toHaveProperty('incerteza');
  });
});
