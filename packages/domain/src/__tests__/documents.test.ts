/**
 * Aurora — motor de documentos: grafo, hash e emissão (SPEC v0.2 §18 · EPIC-018).
 *
 * O teste que mais importa é o do hash canônico: é ele que decide se
 * "assinado" é uma afirmação sobre um conteúdo ou sobre nada.
 */
import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_TYPES,
  documentType,
  DOCUMENT_TRANSITIONS,
  allowedDocumentTransitions,
  canTransitionDocument,
  TERMINAL_DOCUMENT_STATUSES,
  formatDocumentNumber,
  canonicalize,
  contentHash,
  signatureBlockers,
  checkIssue,
  validUntilFor,
  daysToExpiry,
  expiryThreshold,
} from '../documents';

describe('tipos', () => {
  it('o MVP tem um tipo só, e os demais estão declarados sem payload inventado', () => {
    expect(DOCUMENT_TYPES.filter((t) => t.phase === 'MVP').map((t) => t.key)).toEqual(['work_order_report']);
    // Inventar os pontos de medição de um certificado de calibração escreveria
    // no sistema uma exigência metrológica que ninguém confirmou.
    expect(DOCUMENT_TYPES.every((t) => t.payloadFields.length === 0)).toBe(true);
  });

  it('cada tipo tem série própria — número de calibração não se confunde com laudo', () => {
    const series = DOCUMENT_TYPES.map((t) => t.series);
    expect(new Set(series).size).toBe(series.length);
  });

  it('tipo desconhecido não é resolvido', () => {
    expect(documentType('receita_de_bolo')).toBeUndefined();
  });
});

describe('ciclo de vida', () => {
  it('não há saída de situação terminal', () => {
    for (const t of TERMINAL_DOCUMENT_STATUSES) {
      expect(allowedDocumentTransitions(t)).toHaveLength(0);
    }
  });

  it('vencido pode ser substituído, mas não cancelado — cancelar reescreveria o passado', () => {
    expect(canTransitionDocument('expired', 'superseded')).not.toBeNull();
    expect(canTransitionDocument('expired', 'cancelled')).toBeNull();
  });

  it('não se emite direto do rascunho: existe revisão no meio', () => {
    expect(canTransitionDocument('draft', 'issued')).toBeNull();
    expect(canTransitionDocument('under_review', 'issued')?.permission).toBe('document.issue');
  });

  it('liberar ao cliente tem permissão própria', () => {
    expect(canTransitionDocument('issued', 'released')?.permission).toBe('document.release_to_customer');
  });

  it('cada par origem-destino aparece uma vez', () => {
    const pares = DOCUMENT_TRANSITIONS.map((t) => `${t.from}→${t.to}`);
    expect(new Set(pares).size).toBe(pares.length);
  });
});

describe('numeração', () => {
  it('preenche com zeros à esquerda para o número ser lido e ordenado', () => {
    const p = { prefix: 'REL', digits: 6, includeYear: true };
    expect(formatDocumentNumber(p, 42, 2025)).toBe('REL-2025-000042');
    expect(formatDocumentNumber(p, 420, 2025)).toBe('REL-2025-000420');
    expect([formatDocumentNumber(p, 100, 2025), formatDocumentNumber(p, 20, 2025)].sort()).toEqual([
      'REL-2025-000020',
      'REL-2025-000100',
    ]);
  });

  it('o sufixo entra no fim, quando existe', () => {
    expect(
      formatDocumentNumber({ prefix: 'CAL', digits: 4, includeYear: false, suffix: 'BH' }, 7, 2025)
    ).toBe('CAL-0007-BH');
  });
});

describe('conteúdo canônico e hash', () => {
  it('a ordem das chaves não muda o hash — é o que faz a assinatura sobreviver', () => {
    const a = { asset: 'V-01', verdict: 'conforming', points: [1, 2, 3] };
    const b = { points: [1, 2, 3], verdict: 'conforming', asset: 'V-01' };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('a ordem dentro de uma lista MUDA o hash — lista é sequência', () => {
    expect(contentHash({ p: [1, 2] })).not.toBe(contentHash({ p: [2, 1] }));
  });

  it('ordena em profundidade, não só no primeiro nível', () => {
    expect(canonicalize({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });

  it('"não informado" e "explicitamente vazio" produzem hashes diferentes', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 1, b: null }));
    // `undefined` é ausência: some, e o hash iguala ao objeto sem a chave.
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it('qualquer mudança no conteúdo muda o hash', () => {
    const base = { medicao: 12.5 };
    expect(contentHash(base)).not.toBe(contentHash({ medicao: 12.51 }));
  });

  it('número não finito é recusado, em vez de virar null em silêncio', () => {
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(/não finito/);
  });

  it('data vira instante ISO, e não um objeto vazio', () => {
    expect(canonicalize({ d: new Date('2025-03-10T00:00:00Z') })).toBe('{"d":"2025-03-10T00:00:00.000Z"}');
  });

  it('o hash é hexadecimal de 64 caracteres', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('assinatura', () => {
  it('cada método exige a sua prova de origem', () => {
    expect(signatureBlockers({ method: 'drawn', signerName: 'Ana' })[0]).toMatch(/imagem/);
    expect(signatureBlockers({ method: 'email_code', signerName: 'Ana' })[0]).toMatch(/e-mail/);
    expect(signatureBlockers({ method: 'portal', signerName: 'Ana' })[0]).toMatch(/usuário/);
  });

  it('com a prova certa, nada impede', () => {
    expect(signatureBlockers({ method: 'drawn', signerName: 'Ana', attachmentId: 'a1' })).toEqual([]);
    expect(signatureBlockers({ method: 'portal', signerName: 'Ana', portalUserId: 'u1' })).toEqual([]);
  });

  it('certificado digital é recusado enquanto a cadeia não for verificada', () => {
    const faltas = signatureBlockers({ method: 'icp_brasil', signerName: 'Ana' });
    expect(faltas[0]).toMatch(/ainda não é verificada/);
  });

  it('nome vazio nunca passa', () => {
    expect(signatureBlockers({ method: 'drawn', signerName: ' ', attachmentId: 'a1' })).toHaveLength(1);
  });
});

describe('emissão', () => {
  const relatorio = documentType('work_order_report')!;
  const calibracao = documentType('calibration_certificate')!;

  it('o relatório de OS emite sem responsável técnico nem assinatura', () => {
    const r = checkIssue({
      type: relatorio,
      payload: {},
      technicalManagerId: null,
      verdict: 'na',
      signatureCount: 0,
    });
    expect(r.ok).toBe(true);
  });

  it('o certificado exige responsável e assinatura, e diz as duas coisas juntas', () => {
    const r = checkIssue({
      type: calibracao,
      payload: {},
      technicalManagerId: null,
      verdict: 'conforming',
      signatureCount: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers).toHaveLength(2);
  });

  it('o veredito é obrigatório — mesmo que seja "não se aplica"', () => {
    const r = checkIssue({
      type: relatorio,
      payload: {},
      technicalManagerId: null,
      verdict: null,
      signatureCount: 0,
    });
    expect(r.blockers[0]).toMatch(/veredito/);
  });

  it('campo desconhecido no payload é apontado, não descartado', () => {
    const r = checkIssue({
      type: relatorio,
      payload: { campoInventado: 1 },
      technicalManagerId: null,
      verdict: 'na',
      signatureCount: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.payloadIssues[0]!.key).toBe('campoInventado');
  });
});

describe('validade', () => {
  const emissao = new Date('2025-01-01T00:00:00Z');

  it('relatório de OS não vence', () => {
    expect(validUntilFor(documentType('work_order_report')!, emissao)).toBeNull();
    expect(daysToExpiry(null, emissao)).toBeNull();
  });

  it('certificado vence um ano depois', () => {
    const ate = validUntilFor(documentType('calibration_certificate')!, emissao)!;
    expect(ate.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('o marco de vencimento é o mais próximo já cruzado', () => {
    const ate = new Date('2025-04-01T00:00:00Z');
    expect(expiryThreshold(ate, new Date('2024-12-01T00:00:00Z'))).toBeNull();
    expect(expiryThreshold(ate, new Date('2025-01-05T00:00:00Z'))).toBe(90);
    expect(expiryThreshold(ate, new Date('2025-03-05T00:00:00Z'))).toBe(30);
    expect(expiryThreshold(ate, new Date('2025-03-28T00:00:00Z'))).toBe(7);
  });

  it('depois de vencido não há mais aviso — aí é outro fato', () => {
    expect(expiryThreshold(new Date('2025-01-01T00:00:00Z'), new Date('2025-02-01T00:00:00Z'))).toBeNull();
  });
});
