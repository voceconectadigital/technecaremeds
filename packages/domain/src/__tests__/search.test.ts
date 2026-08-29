/**
 * Aurora — busca global (SPEC v0.2 §27 · EPIC-023).
 *
 * O teste que carrega o épico é o do ranqueamento: quem digita "7737" está com
 * a etiqueta na mão, e o ativo de patrimônio 7737 tem de vir antes da OS cujo
 * texto menciona 7737.
 */
import { describe, it, expect } from 'vitest';
import {
  parseQuery,
  looksLikeIdentifier,
  scoreHit,
  rankHits,
  matchCommands,
  COMMANDS,
  SCOPE_LABELS,
  SEARCH_SCOPES,
  MIN_TERM_LENGTH,
  type SearchHit,
} from '../search';

const AGORA = new Date('2025-06-01T12:00:00Z');

function hit(over: Partial<SearchHit>): SearchHit {
  return {
    scope: 'asset',
    id: 'a-1',
    title: 'Ventilador',
    subtitle: null,
    matchKind: 'text',
    touchedAt: null,
    ...over,
  };
}

describe('interpretação da consulta', () => {
  it('sem prefixo, busca em tudo', () => {
    const q = parseQuery('ventilador');
    expect(q.scopes).toEqual([]);
    expect(q.commandMode).toBe(false);
    expect(q.term).toBe('ventilador');
  });

  it('normaliza acento e caixa', () => {
    expect(parseQuery('Válvula').term).toBe('valvula');
  });

  it('"#" restringe a OS e solicitações', () => {
    const q = parseQuery('#1234');
    expect(q.scopes).toEqual(['work_order', 'service_request']);
    expect(q.looksLikeIdentifier).toBe(true);
    expect(q.term).toBe('1234');
  });

  it('"@" restringe a pessoas', () => {
    expect(parseQuery('@ana').scopes).toEqual(['person']);
  });

  it('">" vira paleta de comandos', () => {
    const q = parseQuery('> nova os');
    expect(q.commandMode).toBe(true);
    expect(q.term).toBe('nova os');
  });

  it('os prefixos são convenção de teclado, não sintaxe obrigatória', () => {
    // Quem não conhece nunca digita, e a busca funciona igual.
    expect(parseQuery('1234').scopes).toEqual([]);
    expect(parseQuery('1234').looksLikeIdentifier).toBe(true);
  });
});

describe('o que parece identificador', () => {
  it('número puro e código com hífen parecem', () => {
    expect(looksLikeIdentifier('7737')).toBe(true);
    expect(looksLikeIdentifier('VENT-01')).toBe(true);
    expect(looksLikeIdentifier('WO-2025-00042')).toBe(true);
  });

  it('palavra e frase não parecem', () => {
    expect(looksLikeIdentifier('ventilador')).toBe(false);
    expect(looksLikeIdentifier('ventilador 01')).toBe(false);
    expect(looksLikeIdentifier('')).toBe(false);
  });
});

describe('ranqueamento', () => {
  it('identificador exato vem sempre primeiro — a pessoa está com a etiqueta na mão', () => {
    const ordenado = rankHits(
      [
        hit({ id: 'os', scope: 'work_order', title: 'OS que menciona 7737', matchKind: 'text' }),
        hit({ id: 'ativo', title: 'Patrimônio 7737', matchKind: 'identifier_exact' }),
      ],
      AGORA
    );
    expect(ordenado[0]!.id).toBe('ativo');
  });

  it('prefixo de identificador vence texto, e perde para exato', () => {
    const ordenado = rankHits(
      [
        hit({ id: 'c', matchKind: 'text' }),
        hit({ id: 'a', matchKind: 'identifier_exact' }),
        hit({ id: 'b', matchKind: 'identifier_prefix' }),
      ],
      AGORA
    );
    expect(ordenado.map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('recência desempata dentro da mesma classe, e não atravessa classes', () => {
    const recente = hit({
      id: 'recente',
      matchKind: 'text',
      touchedAt: new Date('2025-05-31T12:00:00Z'),
    });
    const antigo = hit({
      id: 'antigo',
      matchKind: 'text',
      touchedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const exatoAntigo = hit({
      id: 'exato',
      matchKind: 'identifier_exact',
      touchedAt: new Date('2020-01-01T00:00:00Z'),
    });

    expect(rankHits([antigo, recente], AGORA).map((h) => h.id)).toEqual(['recente', 'antigo']);
    // Um ativo tocado hoje NÃO passa na frente do patrimônio que a pessoa
    // acabou de digitar, mesmo que aquele esteja parado há cinco anos.
    expect(rankHits([recente, exatoAntigo], AGORA)[0]!.id).toBe('exato');
  });

  it('a recência vale no máximo um ponto', () => {
    const agoraMesmo = hit({ matchKind: 'text', touchedAt: AGORA });
    expect(scoreHit(agoraMesmo, AGORA)).toBeLessThanOrEqual(101);
    expect(scoreHit(agoraMesmo, AGORA)).toBeGreaterThan(100);
  });

  it('empate técnico resolve pelo título — a lista não dança entre consultas iguais', () => {
    const a = hit({ id: '1', title: 'Bomba' });
    const b = hit({ id: '2', title: 'Autoclave' });
    expect(rankHits([a, b], AGORA).map((h) => h.title)).toEqual(['Autoclave', 'Bomba']);
    expect(rankHits([b, a], AGORA).map((h) => h.title)).toEqual(['Autoclave', 'Bomba']);
  });
});

describe('comandos', () => {
  it('o que a pessoa não pode executar não aparece — nem cinzento', () => {
    const semNada = matchCommands('', new Set());
    expect(semNada.every((c) => c.permission === null)).toBe(true);
    expect(semNada.map((c) => c.key)).toContain('toggle_theme');
    expect(semNada.map((c) => c.key)).not.toContain('new_work_order');
  });

  it('casa por palavra-chave, não só pelo rótulo', () => {
    const achados = matchCommands('chamado', new Set(['service_request.create']));
    expect(achados.map((c) => c.key)).toContain('new_request');
  });

  it('casa por rótulo, sem depender de acento', () => {
    const achados = matchCommands('organizacao', new Set());
    expect(achados.map((c) => c.key)).toContain('switch_organization');
  });

  it('termo vazio devolve tudo que a pessoa pode', () => {
    const tudo = matchCommands('', new Set(COMMANDS.map((c) => c.permission ?? '')));
    expect(tudo.length).toBe(COMMANDS.length);
  });
});

describe('catálogo', () => {
  it('todo escopo tem rótulo em português', () => {
    for (const s of SEARCH_SCOPES) {
      expect(SCOPE_LABELS[s].length).toBeGreaterThan(3);
    }
  });

  it('o termo mínimo é declarado', () => {
    expect(MIN_TERM_LENGTH).toBe(2);
  });
});
