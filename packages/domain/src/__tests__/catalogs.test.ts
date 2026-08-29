/**
 * Aurora — sugestão de mesclagem (EPIC-004).
 *
 * Os casos vêm todos da auditoria da referência. Não são exemplos inventados:
 * são as duplicatas que de fato estavam no sistema em produção.
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOGS,
  CATALOG_KEYS,
  catalogByKey,
  normalizeLabel,
  labelsCollide,
  suggestMergeGroups,
} from '../catalogs';

const item = (id: string, label: string) => ({ id, label });

describe('registro de catálogos', () => {
  it('as chaves são únicas e bem formadas', () => {
    expect(new Set(CATALOG_KEYS).size).toBe(CATALOGS.length);
    for (const c of CATALOGS) expect(c.key).toMatch(/^[a-z][a-z0-9_]{1,48}$/);
  });

  it('a taxonomia de falha tem os três eixos separados', () => {
    expect(CATALOG_KEYS).toContain('failure_symptom');
    expect(CATALOG_KEYS).toContain('failure_cause');
    expect(CATALOG_KEYS).toContain('failure_action');
  });

  it('a natureza da OS declara as chaves de sistema que os indicadores usam', () => {
    const tipos = catalogByKey('work_order_type')!;
    expect(tipos.systemKeys).toContain('preventive');
    expect(tipos.systemKeys).toContain('corrective');
  });

  it('catálogo desconhecido devolve indefinido em vez de improvisar', () => {
    expect(catalogByKey('inventado')).toBeUndefined();
  });
});

describe('colisão de rótulo', () => {
  it('caixa, acento e espaço não distinguem dois itens', () => {
    expect(labelsCollide('Fechada', 'fechada')).toBe(true);
    expect(labelsCollide('  FECHADA ', 'Fechada')).toBe(true);
    expect(labelsCollide('Empréstimo', 'Emprestimo')).toBe(true);
    expect(normalizeLabel('Reposição de Oxigênio')).toBe('reposicao de oxigenio');
  });

  it('rótulos de fato diferentes não colidem', () => {
    expect(labelsCollide('Empréstimo', 'Empréstimo de equipamento')).toBe(false);
  });

  it('dois rótulos vazios não colidem — vazio não identifica nada', () => {
    expect(labelsCollide('---', '///')).toBe(false);
  });
});

describe('sugestão de mesclagem', () => {
  it('encontra o rótulo contido no outro', () => {
    const s = suggestMergeGroups([item('1', 'Empréstimo'), item('2', 'Empréstimo de equipamento')]);
    expect(s).toHaveLength(1);
    expect(s[0]!.reason).toBe('um_contem_o_outro');
  });

  it('encontra grafia próxima — o erro de digitação que sobrevive à normalização', () => {
    const s = suggestMergeGroups([item('1', 'Ventilador'), item('2', 'Ventliador')]);
    expect(s).toHaveLength(1);
    expect(s[0]!.reason).toBe('grafia_proxima');
    expect(s[0]!.score).toBeGreaterThanOrEqual(0.8);
  });

  it('acha o caso real "Reposição de Oxigênio" contra "Reposicao Oxigenio"', () => {
    const s = suggestMergeGroups([item('1', 'Reposição de Oxigênio'), item('2', 'Reposicao Oxigenio')]);
    expect(s).toHaveLength(1);
    expect(s[0]!.reason).toBe('um_contem_o_outro');
  });

  it('não sugere para itens que apenas compartilham um prefixo comum', () => {
    const s = suggestMergeGroups([item('1', 'Corretiva'), item('2', 'Preventiva'), item('3', 'Calibração')]);
    expect(s).toEqual([]);
  });

  it('não casa palavra com outra que apenas a contém como pedaço', () => {
    const s = suggestMergeGroups([item('1', 'Cabo'), item('2', 'Cabografia digital')]);
    expect(s).toEqual([]);
  });

  it('ignora rótulos curtos na comparação por grafia — ali uma letra já é outra palavra', () => {
    const s = suggestMergeGroups([item('1', 'UTI'), item('2', 'UTQ')]);
    expect(s).toEqual([]);
  });

  it('ordena por confiança, do mais provável para o menos', () => {
    const s = suggestMergeGroups([
      item('1', 'Bomba de infusão'),
      item('2', 'Bomba de infusao'),
      item('3', 'Bomba'),
    ]);
    expect(s.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1]!.score).toBeGreaterThanOrEqual(s[i]!.score);
    }
  });

  it('aguenta uma lista do tamanho da que a auditoria encontrou', () => {
    const grande = Array.from({ length: 651 }, (_, i) => item(String(i), `Tipo de equipamento ${i}`));
    const s = suggestMergeGroups(grande, { limit: 20 });
    expect(s.length).toBeLessThanOrEqual(20);
  });

  it('nunca sugere um item com ele mesmo', () => {
    const s = suggestMergeGroups([item('1', 'Ventilador'), item('2', 'Ventliador')]);
    expect(s.every((x) => x.a.id !== x.b.id)).toBe(true);
  });
});
