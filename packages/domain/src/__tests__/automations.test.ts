/**
 * Aurora — motor de automações (SPEC v0.2 §24 · EPIC-024).
 *
 * As salvaguardas são o produto, e é o que estes testes protegem: nada de
 * recursão, nada de estourar a janela em silêncio, e a simulação que impede a
 * regra de inundar a equipe.
 */
import { describe, it, expect } from 'vitest';
import {
  readField,
  evaluateComparison,
  evaluateConditions,
  validateConditions,
  ACTIONS,
  actionDefinition,
  validateAction,
  canReact,
  checkRateLimit,
  summarizeSimulation,
  MAX_CHAIN_DEPTH,
  FLOOD_THRESHOLD,
} from '../automations';
import { isKnownPermission } from '../permissions';

const FATOS = {
  type: 'work_order.status_changed',
  priority: 'emergency',
  customerId: 'c-1',
  payload: { toStatus: 'waiting', waitReason: 'parts', count: 4 },
  resolution: 'trocado o filtro bacteriológico',
};

describe('leitura de campo', () => {
  it('lê no primeiro nível e em profundidade', () => {
    expect(readField(FATOS, 'priority')).toBe('emergency');
    expect(readField(FATOS, 'payload.waitReason')).toBe('parts');
  });

  it('caminho que não existe devolve indefinido, sem estourar', () => {
    expect(readField(FATOS, 'payload.nada.aqui')).toBeUndefined();
    expect(readField(FATOS, 'resolution.length.x')).toBeUndefined();
  });
});

describe('comparações', () => {
  it('igualdade compara valores, não tipos — o payload vem do banco', () => {
    expect(evaluateComparison(FATOS, { field: 'payload.count', op: 'eq', value: '4' })).toBe(true);
    expect(evaluateComparison(FATOS, { field: 'payload.count', op: 'eq', value: 4 })).toBe(true);
  });

  it('campo ausente nunca satisfaz — exceto "missing"', () => {
    for (const op of ['eq', 'neq', 'in', 'not_in', 'gt', 'contains'] as const) {
      expect(evaluateComparison(FATOS, { field: 'naoExiste', op, value: ['x'] })).toBe(false);
    }
    expect(evaluateComparison(FATOS, { field: 'naoExiste', op: 'missing' })).toBe(true);
    expect(evaluateComparison(FATOS, { field: 'priority', op: 'exists' })).toBe(true);
  });

  it('pertence a lista, e não pertence', () => {
    expect(evaluateComparison(FATOS, { field: 'customerId', op: 'in', value: ['c-1', 'c-2'] })).toBe(true);
    expect(evaluateComparison(FATOS, { field: 'customerId', op: 'not_in', value: ['c-9'] })).toBe(true);
  });

  it('contém texto, sem depender de maiúsculas', () => {
    expect(evaluateComparison(FATOS, { field: 'resolution', op: 'contains', value: 'FILTRO' })).toBe(true);
  });

  it('grandeza sobre coisa que não é número não dispara', () => {
    expect(evaluateComparison(FATOS, { field: 'priority', op: 'gt', value: 3 })).toBe(false);
    expect(evaluateComparison(FATOS, { field: 'payload.count', op: 'gte', value: 4 })).toBe(true);
    expect(evaluateComparison(FATOS, { field: 'payload.count', op: 'lt', value: 4 })).toBe(false);
  });
});

describe('árvore de condições', () => {
  it('o exemplo do §24: prioridade e cliente e natureza', () => {
    const arvore = {
      all: [
        { field: 'priority', op: 'eq' as const, value: 'emergency' },
        { field: 'customerId', op: 'in' as const, value: ['c-1', 'c-2'] },
      ],
    };
    expect(evaluateConditions(FATOS, arvore)).toBe(true);
  });

  it('"ou" basta um', () => {
    expect(
      evaluateConditions(FATOS, {
        any: [
          { field: 'priority', op: 'eq', value: 'low' },
          { field: 'payload.waitReason', op: 'eq', value: 'parts' },
        ],
      })
    ).toBe(true);
  });

  it('aninha "e" dentro de "ou"', () => {
    expect(
      evaluateConditions(FATOS, {
        any: [
          { all: [{ field: 'priority', op: 'eq', value: 'low' }] },
          {
            all: [
              { field: 'payload.toStatus', op: 'eq', value: 'waiting' },
              { field: 'payload.waitReason', op: 'eq', value: 'parts' },
            ],
          },
        ],
      })
    ).toBe(true);
  });

  it('sem condição, dispara sempre', () => {
    expect(evaluateConditions(FATOS, null)).toBe(true);
    expect(evaluateConditions(FATOS, { all: [] })).toBe(true);
  });

  it('"ou" vazio nunca dispara: a regra incompleta fica inerte', () => {
    expect(evaluateConditions(FATOS, { any: [] })).toBe(false);
  });
});

describe('validação da regra', () => {
  it('aponta o caminho exato do problema', () => {
    const erros = validateConditions({
      all: [
        { field: 'priority', op: 'eq', value: 'x' },
        { field: '', op: 'zzz' },
      ],
    });
    expect(erros).toHaveLength(2);
    expect(erros[0]).toMatch(/conditions\.all\[1\]/);
  });

  it('"in" sem lista é erro', () => {
    expect(validateConditions({ field: 'a', op: 'in', value: 'x' })[0]).toMatch(/exige uma lista/);
  });

  it('árvore vazia é válida', () => {
    expect(validateConditions(null)).toEqual([]);
  });
});

describe('ações', () => {
  it('toda ação declara permissão e obrigatórios', () => {
    for (const a of ACTIONS) {
      expect(a.permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(Array.isArray(a.required)).toBe(true);
    }
  });

  it('a permissão de cada ação EXISTE no registro do RBAC', () => {
    // Uma ação que aponta para permissão inexistente nunca executa, e falha
    // calada: o motor recusa por falta de uma permissão que ninguém pode
    // conceder, porque ela não está no catálogo para ser concedida.
    for (const a of ACTIONS) {
      expect(isKnownPermission(a.permission), `${a.kind} → ${a.permission}`).toBe(true);
    }
  });

  it('ação desconhecida é recusada, listando as disponíveis', () => {
    const erros = validateAction({ kind: 'lancar_foguete', params: {} });
    expect(erros[0]).toMatch(/disponíveis: notify/);
  });

  it('parâmetro obrigatório ausente é apontado pelo nome', () => {
    expect(validateAction({ kind: 'change_status', params: {} })[0]).toMatch(/"statusKey"/);
    expect(validateAction({ kind: 'add_comment', params: { text: '' } })[0]).toMatch(/"text"/);
  });

  it('ação completa não tem erro', () => {
    expect(validateAction({ kind: 'notify', params: { audience: 'assignee' } })).toEqual([]);
    expect(actionDefinition('notify')!.permission).toBe('work_order.read');
  });
});

describe('sem recursão', () => {
  it('a regra não reage ao que ela mesma causou', () => {
    const r = canReact('rule-1', { causedByRuleId: 'rule-1', causationDepth: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('self_caused');
  });

  it('outra regra pode reagir ao efeito desta', () => {
    expect(canReact('rule-2', { causedByRuleId: 'rule-1', causationDepth: 1 }).ok).toBe(true);
  });

  it('cadeia funda demais é cortada', () => {
    expect(canReact('rule-2', { causationDepth: MAX_CHAIN_DEPTH }).ok).toBe(false);
    expect(canReact('rule-2', { causationDepth: MAX_CHAIN_DEPTH }).reason).toBe('too_deep');
    expect(canReact('rule-2', { causationDepth: MAX_CHAIN_DEPTH - 1 }).ok).toBe(true);
  });

  it('evento humano, sem causa de regra, sempre pode disparar', () => {
    expect(canReact('rule-1', {}).ok).toBe(true);
  });
});

describe('limite e quarentena', () => {
  it('abaixo do limite, executa', () => {
    const d = checkRateLimit(99);
    expect(d.allowed).toBe(true);
    expect(d.shouldQuarantine).toBe(false);
  });

  it('no limite, entra em quarentena com o motivo escrito', () => {
    const d = checkRateLimit(100);
    expect(d.allowed).toBe(false);
    expect(d.shouldQuarantine).toBe(true);
    expect(d.detail).toMatch(/100 vezes em 60 minutos/);
  });

  it('o limite é configurável por regra', () => {
    expect(checkRateLimit(5, { max: 10, windowMinutes: 5 }).allowed).toBe(true);
    expect(checkRateLimit(10, { max: 10, windowMinutes: 5 }).detail).toMatch(/em 5 minutos/);
  });
});

describe('simulação obrigatória', () => {
  it('a frase é o produto, e diz o número', () => {
    const r = summarizeSimulation(412, 5000);
    expect(r.summary).toMatch(/teria disparado 412 vez\(es\) nos últimos 30 dias/);
    expect(r.floodRisk).toBe(true);
    expect(r.summary).toMatch(/volume alto/);
  });

  it('volume normal não alarma', () => {
    const r = summarizeSimulation(12, 5000);
    expect(r.floodRisk).toBe(false);
    expect(r.summary).not.toMatch(/volume alto/);
  });

  it('zero correspondência avisa que a regra pode estar filtrando demais', () => {
    expect(summarizeSimulation(0, 5000).summary).toMatch(/filtrando demais/);
  });

  it('o corte de inundação é o declarado', () => {
    expect(summarizeSimulation(FLOOD_THRESHOLD - 1, 1).floodRisk).toBe(false);
    expect(summarizeSimulation(FLOOD_THRESHOLD, 1).floodRisk).toBe(true);
  });
});
