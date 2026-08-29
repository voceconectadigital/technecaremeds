/**
 * Aurora — motor de checklists (SPEC v0.2 §14, ADR-012 · EPIC-011).
 */
import { describe, it, expect } from 'vitest';
import {
  computeVerdict,
  isVisible,
  canonicalValue,
  validateAnswer,
  evaluateChecklist,
  intervalsOverlap,
  entryMinutes,
  entryCost,
  type ChecklistItem,
} from '../checklists';

const item = (over: Partial<ChecklistItem> & Pick<ChecklistItem, 'id' | 'kind'>): ChecklistItem => ({
  label: `Item ${over.id}`,
  required: true,
  requiresPhotoWhen: 'never',
  failAction: 'none',
  ...over,
});

describe('veredito automático', () => {
  const pressao = item({
    id: 'pressao',
    kind: 'number',
    label: 'Pressão de teste (cmH₂O)',
    minValue: 20,
    maxValue: 40,
  });

  it('número dentro da faixa aprova; fora reprova', () => {
    expect(computeVerdict(pressao, { number: 30 })).toBe('pass');
    expect(computeVerdict(pressao, { number: 19.9 })).toBe('fail');
    expect(computeVerdict(pressao, { number: 41 })).toBe('fail');
  });

  it('os extremos da faixa aprovam — a faixa é fechada', () => {
    expect(computeVerdict(pressao, { number: 20 })).toBe('pass');
    expect(computeVerdict(pressao, { number: 40 })).toBe('pass');
  });

  it('número sem faixa declarada não julga nada', () => {
    const livre = item({ id: 'obs', kind: 'number' });
    expect(computeVerdict(livre, { number: 999 })).toBe('na');
  });

  it('faixa só com mínimo, ou só com máximo, funciona', () => {
    expect(computeVerdict(item({ id: 'a', kind: 'number', minValue: 10 }), { number: 9 })).toBe('fail');
    expect(computeVerdict(item({ id: 'a', kind: 'number', minValue: 10 }), { number: 11 })).toBe('pass');
    expect(computeVerdict(item({ id: 'b', kind: 'number', maxValue: 10 }), { number: 11 })).toBe('fail');
  });

  it('booleano compara com o esperado', () => {
    const aterramento = item({ id: 'terra', kind: 'boolean', expectedBoolean: true });
    expect(computeVerdict(aterramento, { boolean: true })).toBe('pass');
    expect(computeVerdict(aterramento, { boolean: false })).toBe('fail');
  });

  it('booleano sem valor esperado é informativo, não julgamento', () => {
    expect(computeVerdict(item({ id: 'x', kind: 'boolean' }), { boolean: false })).toBe('na');
  });

  it('opção reprova quando cai na lista de reprovação', () => {
    const visual = item({
      id: 'visual',
      kind: 'option',
      options: ['Aprovado', 'Reprovado', 'Não se aplica'],
      failingOptions: ['Reprovado'],
    });
    expect(computeVerdict(visual, { text: 'Aprovado' })).toBe('pass');
    expect(computeVerdict(visual, { text: 'Reprovado' })).toBe('fail');
    expect(computeVerdict(visual, { text: 'Não se aplica' })).toBe('pass');
  });

  it('foto reprova quando falta a quantidade mínima', () => {
    const foto = item({ id: 'foto', kind: 'photo', minPhotos: 2 });
    expect(computeVerdict(foto, { photoCount: 2 })).toBe('pass');
    expect(computeVerdict(foto, { photoCount: 1 })).toBe('fail');
  });

  it('texto e data não têm veredito automático', () => {
    expect(computeVerdict(item({ id: 't', kind: 'text' }), { text: 'qualquer' })).toBe('na');
    expect(computeVerdict(item({ id: 'd', kind: 'date' }), { date: '2026-01-01' })).toBe('na');
  });
});

describe('lógica condicional', () => {
  const temFuga = item({ id: 'fuga', kind: 'boolean', expectedBoolean: false });
  const ondeVaza = item({
    id: 'onde',
    kind: 'text',
    conditionItemId: 'fuga',
    conditionEquals: 'true',
  });

  it('o item condicional só aparece quando a condição bate', () => {
    expect(isVisible(ondeVaza, { fuga: { boolean: true } })).toBe(true);
    expect(isVisible(ondeVaza, { fuga: { boolean: false } })).toBe(false);
    expect(isVisible(ondeVaza, {})).toBe(false);
  });

  it('item sem condição está sempre visível', () => {
    expect(isVisible(temFuga, {})).toBe(true);
  });

  /**
   * A condição é declarada como texto e o valor pode ser número ou booleano.
   * Sem forma canônica, comparar "true" com true daria falso e a condição
   * nunca dispararia — em silêncio.
   */
  it('a forma canônica compara tipos diferentes sem falhar em silêncio', () => {
    expect(canonicalValue({ boolean: true })).toBe('true');
    expect(canonicalValue({ number: 42 })).toBe('42');
    expect(canonicalValue({ options: ['b', 'a'] })).toBe('a,b');
    expect(canonicalValue({})).toBeNull();
    expect(canonicalValue(undefined)).toBeNull();
  });

  it('item oculto NÃO é obrigatório e não entra na completude', () => {
    const r = evaluateChecklist([temFuga, ondeVaza], { fuga: { boolean: false } });
    expect(r.total).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.pending).toEqual([]);
  });

  it('quando a condição passa a valer, o item volta a ser exigido', () => {
    const r = evaluateChecklist([temFuga, ondeVaza], { fuga: { boolean: true } });
    expect(r.total).toBe(2);
    expect(r.complete).toBe(false);
    expect(r.pending.map((p) => p.itemId)).toEqual(['onde']);
  });
});

describe('completude e consequências', () => {
  const pressao = item({
    id: 'pressao',
    kind: 'number',
    label: 'Pressão',
    minValue: 20,
    maxValue: 40,
    requiresPhotoWhen: 'on_fail',
    failAction: 'block_completion',
  });
  const aterramento = item({
    id: 'terra',
    kind: 'boolean',
    label: 'Aterramento íntegro',
    expectedBoolean: true,
    failAction: 'create_work_order',
  });

  it('tudo respondido e aprovado fecha o checklist', () => {
    const r = evaluateChecklist([pressao, aterramento], {
      pressao: { number: 30 },
      terra: { boolean: true },
    });
    expect(r.complete).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.generatesWorkOrder).toEqual([]);
  });

  it('reprovação que exige foto sem foto vira pendência própria', () => {
    const r = evaluateChecklist([pressao], { pressao: { number: 50, photoCount: 0 } });
    expect(r.complete).toBe(false);
    expect(r.pending).toEqual([]); // respondido, mas sem evidência
    expect(r.missingPhotos.map((m) => m.itemId)).toEqual(['pressao']);
  });

  it('com a foto, a pendência de evidência some — mas o bloqueio permanece', () => {
    const r = evaluateChecklist([pressao], { pressao: { number: 50, photoCount: 1 } });
    expect(r.missingPhotos).toEqual([]);
    expect(r.blocking.map((b) => b.itemId)).toEqual(['pressao']);
  });

  it('reprovação com ação de gerar OS aparece separada do bloqueio', () => {
    const r = evaluateChecklist([aterramento], { terra: { boolean: false } });
    expect(r.generatesWorkOrder.map((g) => g.itemId)).toEqual(['terra']);
    expect(r.blocking).toEqual([]);
  });

  it('item não obrigatório não conta no total, mas suas consequências valem', () => {
    const opcional = item({
      id: 'opc',
      kind: 'number',
      required: false,
      minValue: 0,
      maxValue: 1,
      failAction: 'block_completion',
    });
    const r = evaluateChecklist([opcional], { opc: { number: 5 } });
    expect(r.total).toBe(0);
    expect(r.blocking.map((b) => b.itemId)).toEqual(['opc']);
  });

  it('a pendência traz o rótulo, não só o identificador', () => {
    const r = evaluateChecklist([pressao], {});
    expect(r.pending[0]!.label).toBe('Pressão');
  });
});

describe('validação de forma da resposta', () => {
  it('opção fora da lista é recusada nomeando o valor', () => {
    const visual = item({ id: 'v', kind: 'option', options: ['A', 'B'] });
    expect(validateAnswer(visual, { text: 'C' })[0]?.message).toMatch(/"C" não está entre as opções/);
  });

  it('múltipla escolha recusa item fora da lista e repetido', () => {
    const m = item({ id: 'm', kind: 'multi_option', options: ['A', 'B'] });
    expect(validateAnswer(m, { options: ['A', 'Z'] })[0]?.message).toMatch(/fora da lista: Z/);
    expect(validateAnswer(m, { options: ['A', 'A'] })[0]?.message).toMatch(/repetidas/);
  });

  it('data fora do formato ISO é recusada', () => {
    expect(validateAnswer(item({ id: 'd', kind: 'date' }), { date: '01/01/2026' })[0]?.message).toMatch(
      /AAAA-MM-DD/
    );
  });

  it('resposta bem formada não gera problema', () => {
    expect(validateAnswer(item({ id: 'n', kind: 'number' }), { number: 10 })).toEqual([]);
  });
});

describe('apontamento de horas', () => {
  it('dois apontamentos da mesma pessoa que se cruzam são sobreposição', () => {
    const a = { startedAt: '2026-08-28T08:00:00Z', endedAt: '2026-08-28T10:00:00Z' };
    const b = { startedAt: '2026-08-28T09:00:00Z', endedAt: '2026-08-28T11:00:00Z' };
    expect(intervalsOverlap(a, b)).toBe(true);
  });

  it('encostar não é sobrepor: um turno termina onde o outro começa', () => {
    const a = { startedAt: '2026-08-28T08:00:00Z', endedAt: '2026-08-28T10:00:00Z' };
    const b = { startedAt: '2026-08-28T10:00:00Z', endedAt: '2026-08-28T12:00:00Z' };
    expect(intervalsOverlap(a, b)).toBe(false);
  });

  it('cronômetro aberto se sobrepõe a tudo que vier depois', () => {
    const aberto = { startedAt: '2026-08-28T08:00:00Z', endedAt: null };
    const depois = { startedAt: '2026-08-28T14:00:00Z', endedAt: '2026-08-28T15:00:00Z' };
    expect(intervalsOverlap(aberto, depois)).toBe(true);
  });

  it('a duração de um cronômetro aberto é zero, não indefinida', () => {
    expect(entryMinutes({ startedAt: '2026-08-28T08:00:00Z', endedAt: null })).toBe(0);
    expect(entryMinutes({ startedAt: '2026-08-28T08:00:00Z', endedAt: '2026-08-28T09:30:00Z' })).toBe(90);
  });

  /** O custo usa o valor congelado no apontamento, não o vigente hoje. */
  it('o custo sai do valor/hora recebido, não de uma tabela consultada agora', () => {
    const entrada = { startedAt: '2026-08-28T08:00:00Z', endedAt: '2026-08-28T09:30:00Z' };
    expect(entryCost(entrada, 80)).toBe(120);
    expect(entryCost(entrada, null)).toBeNull();
  });
});
