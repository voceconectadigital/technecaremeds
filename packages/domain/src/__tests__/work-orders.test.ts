/**
 * Aurora — máquina de estados da OS (SPEC v0.2 §10, ADR-003, ADR-004 · EPIC-008).
 */
import { describe, it, expect } from 'vitest';
import {
  STATUS_CATEGORIES,
  CATEGORY_SEMANTICS,
  FACTORY_STATUSES,
  FACTORY_WAIT_REASONS,
  FACTORY_TRANSITIONS,
  slaRunsIn,
  isActiveCategory,
  isTerminalCategory,
  evaluateTransition,
  eventForTransition,
  checkCompletion,
  formatWorkOrderNumber,
  type StatusRef,
  type CompletionFacts,
} from '../work-orders';

const byKey = (key: string): StatusRef => {
  const s = FACTORY_STATUSES.find((x) => x.key === key)!;
  return { key: s.key, label: s.label, category: s.category, requiresWaitReason: s.requiresWaitReason };
};

const TODAS = new Set([
  'work_order.update',
  'work_order.assign',
  'work_order.schedule',
  'work_order.execute',
  'work_order.complete',
  'work_order.validate',
  'work_order.close',
  'work_order.reopen',
  'work_order.cancel',
]);

const mover = (from: string, to: string, fields: Record<string, unknown> = {}, perms = TODAS) =>
  evaluateTransition({
    from: byKey(from),
    to: byKey(to),
    graph: FACTORY_TRANSITIONS,
    permissions: perms,
    fields: {
      customer_id: 'x',
      location_id: 'x',
      work_order_type_id: 'x',
      ...fields,
    },
  });

describe('categorias — o que o software sabe interpretar', () => {
  it('toda categoria tem semântica declarada', () => {
    for (const c of STATUS_CATEGORIES) expect(CATEGORY_SEMANTICS[c], c).toBeDefined();
  });

  it('só closed e cancelled são terminais', () => {
    expect(STATUS_CATEGORIES.filter(isTerminalCategory)).toEqual(['closed', 'cancelled']);
  });

  it('rascunho e categorias finais não contam como trabalho em andamento', () => {
    expect(isActiveCategory('draft')).toBe(false);
    expect(isActiveCategory('done')).toBe(false);
    expect(isActiveCategory('closed')).toBe(false);
    expect(isActiveCategory('in_progress')).toBe(true);
    expect(isActiveCategory('waiting')).toBe(true);
  });

  /** O coração do ADR-004: em `waiting`, quem decide o relógio é o motivo. */
  it('em waiting o relógio depende do motivo, não da categoria', () => {
    expect(slaRunsIn('waiting', false)).toBe(true);
    expect(slaRunsIn('waiting', true)).toBe(false);
  });

  it('fora de waiting o motivo não muda nada', () => {
    expect(slaRunsIn('in_progress', true)).toBe(true);
    expect(slaRunsIn('review', false)).toBe(false);
    expect(slaRunsIn('closed', false)).toBe(false);
  });
});

describe('situações e motivos de fábrica', () => {
  it('as dez situações da SPEC, com categoria válida cada', () => {
    expect(FACTORY_STATUSES).toHaveLength(11);
    for (const s of FACTORY_STATUSES) expect(STATUS_CATEGORIES, s.key).toContain(s.category);
  });

  it('Pausada e Aguardando compartilham categoria, e só Aguardando exige motivo', () => {
    const pausada = FACTORY_STATUSES.find((s) => s.key === 'paused')!;
    const aguardando = FACTORY_STATUSES.find((s) => s.key === 'waiting')!;
    expect(pausada.category).toBe('waiting');
    expect(aguardando.category).toBe('waiting');
    expect(pausada.requiresWaitReason).toBeFalsy();
    expect(aguardando.requiresWaitReason).toBe(true);
  });

  /**
   * A decisão que a SPEC marca com nota de rodapé: falta de peça é
   * responsabilidade da organização, não do cliente.
   */
  it('falta de peça NÃO pausa o SLA; espera pelo cliente pausa', () => {
    const peca = FACTORY_WAIT_REASONS.find((w) => w.key === 'parts')!;
    const cliente = FACTORY_WAIT_REASONS.find((w) => w.key === 'customer_response')!;
    expect(peca.pausesSla).toBe(false);
    expect(cliente.pausesSla).toBe(true);
  });

  it('todo motivo que pausa o SLA aponta um responsável externo ou o gestor', () => {
    for (const w of FACTORY_WAIT_REASONS.filter((x) => x.pausesSla)) {
      expect(['customer', 'supplier', 'manager'], w.key).toContain(w.responsible);
    }
  });

  it('as chaves de motivo são únicas', () => {
    expect(new Set(FACTORY_WAIT_REASONS.map((w) => w.key)).size).toBe(FACTORY_WAIT_REASONS.length);
  });
});

describe('grafo de fábrica', () => {
  it('toda transição aponta para situações que existem', () => {
    const chaves = new Set(FACTORY_STATUSES.map((s) => s.key));
    for (const t of FACTORY_TRANSITIONS) {
      expect(chaves, `${t.from} -> ${t.to}`).toContain(t.from);
      expect(chaves, `${t.from} -> ${t.to}`).toContain(t.to);
    }
  });

  it('cancelar é possível de toda situação ativa, e de nenhuma final', () => {
    const cancelaveis = new Set(FACTORY_TRANSITIONS.filter((t) => t.to === 'cancelled').map((t) => t.from));
    for (const s of FACTORY_STATUSES) {
      const ativa = isActiveCategory(s.category) || s.category === 'draft';
      expect(cancelaveis.has(s.key), `${s.key} (categoria ${s.category})`).toBe(ativa);
    }
  });

  it('não há transição de uma situação para ela mesma', () => {
    expect(FACTORY_TRANSITIONS.every((t) => t.from !== t.to)).toBe(true);
  });

  it('não há transição duplicada', () => {
    const pares = FACTORY_TRANSITIONS.map((t) => `${t.from}->${t.to}`);
    expect(new Set(pares).size).toBe(pares.length);
  });
});

describe('transições proibidas — explicitamente (SPEC §10)', () => {
  it('draft não vai direto para completed', () => {
    expect(mover('draft', 'completed').allowed).toBe(false);
  });

  it('open não vai direto para closed', () => {
    expect(mover('open', 'closed').allowed).toBe(false);
  });

  it('waiting não vai direto para completed — não se conclui o que está bloqueado', () => {
    expect(mover('waiting', 'completed').allowed).toBe(false);
  });

  it('cancelled é terminal: nada sai dele', () => {
    const r = mover('cancelled', 'open');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/situação final/);
  });

  it('a recusa nomeia as situações possíveis, nunca só "erro"', () => {
    const r = mover('open', 'closed');
    expect(r.reason).toMatch(/só é possível ir para/);
    expect(r.reason).toMatch(/scheduled|in_progress|cancelled/);
  });
});

describe('ir para Aguardando sem motivo é impossível', () => {
  it('recusado, nomeando o campo que falta', () => {
    const r = mover('in_progress', 'waiting');
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain('wait_reason_id');
  });

  it('com motivo, passa', () => {
    expect(mover('in_progress', 'waiting', { wait_reason_id: 'parts' }).allowed).toBe(true);
  });

  it('pausar NÃO exige motivo — não há dependência externa a nomear', () => {
    expect(mover('in_progress', 'paused').allowed).toBe(true);
  });
});

describe('permissões', () => {
  it('executar não dá direito a validar', () => {
    const soExecuta = new Set(['work_order.execute']);
    expect(mover('in_progress', 'paused', {}, soExecuta).allowed).toBe(true);
    expect(mover('completed', 'validated', {}, soExecuta).allowed).toBe(false);
  });

  it('as saídas oferecidas já vêm filtradas pelas permissões', () => {
    const soCancela = new Set(['work_order.cancel']);
    const r = mover('open', 'scheduled', {}, soCancela);
    expect(r.allowedTargets).toEqual(['cancelled']);
  });

  it('reabrir OS fechada exige permissão própria', () => {
    const semReabrir = new Set([...TODAS].filter((p) => p !== 'work_order.reopen'));
    const r = mover('closed', 'in_progress', { reopen_reason: 'erro de fechamento' }, semReabrir);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/work_order\.reopen/);
  });
});

describe('justificativas obrigatórias', () => {
  it('cancelar exige motivo', () => {
    expect(mover('open', 'cancelled').missing).toContain('cancellation_reason');
    expect(mover('open', 'cancelled', { cancellation_reason: 'cliente desistiu' }).allowed).toBe(true);
  });

  it('reprovar na validação exige o motivo do retrabalho', () => {
    expect(mover('completed', 'in_progress').missing).toContain('rework_reason');
  });

  it('reabrir exige justificativa', () => {
    expect(mover('closed', 'in_progress').missing).toContain('reopen_reason');
  });

  it('agendar exige responsável e janela', () => {
    const r = mover('open', 'scheduled');
    expect(r.missing).toEqual(expect.arrayContaining(['assignee', 'scheduled_start']));
  });
});

describe('eventos derivados do par de situações', () => {
  it('in_progress significa coisas diferentes conforme de onde se vem', () => {
    expect(eventForTransition(byKey('scheduled'), byKey('in_progress'))).toBe('work_order.started');
    expect(eventForTransition(byKey('waiting'), byKey('in_progress'))).toBe('work_order.unblocked');
    expect(eventForTransition(byKey('closed'), byKey('in_progress'))).toBe('work_order.reopened');
    expect(eventForTransition(byKey('completed'), byKey('in_progress'))).toBe('work_order.rework_requested');
  });

  it('bloquear é notícia; pausar não é', () => {
    expect(eventForTransition(byKey('in_progress'), byKey('waiting'))).toBe('work_order.blocked');
    expect(eventForTransition(byKey('in_progress'), byKey('paused'))).toBeNull();
  });

  it('encerramentos têm cada um o seu evento', () => {
    expect(eventForTransition(byKey('completed'), byKey('validated'))).toBe('work_order.validated');
    expect(eventForTransition(byKey('validated'), byKey('closed'))).toBe('work_order.closed');
    expect(eventForTransition(byKey('open'), byKey('cancelled'))).toBe('work_order.cancelled');
  });
});

describe('bloco de conclusão — o guarda mais importante', () => {
  const completo: CompletionFacts = {
    checklistTotal: 10,
    checklistAnswered: 10,
    failedItemsWithoutPhoto: 0,
    loggedMinutes: 90,
    resolution: 'Substituída a placa de alimentação e testado o equipamento',
    causeFailureCodeId: 'causa-1',
    photosBefore: 1,
    photosAfter: 2,
    hasCustomerSignature: true,
    partsPending: 0,
  };

  it('com tudo em ordem, libera', () => {
    const r = checkCompletion(
      [...(['checklist_complete', 'hours_logged', 'resolution_filled'] as const)],
      completo
    );
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('nenhum requisito exigido libera sem perguntar nada', () => {
    expect(checkCompletion([], { ...completo, resolution: null }).ok).toBe(true);
  });

  /** O critério de aceite: nunca "Erro!". Cada pendência nomeada e localizada. */
  it('cada pendência volta nomeada e com o detalhe do que falta', () => {
    const r = checkCompletion(
      ['checklist_complete', 'hours_logged', 'resolution_filled', 'cause_code_filled', 'photo_before_after'],
      {
        ...completo,
        checklistAnswered: 7,
        loggedMinutes: 0,
        resolution: 'ok',
        causeFailureCodeId: null,
        photosAfter: 0,
      }
    );
    expect(r.ok).toBe(false);
    const porRequisito = new Map(r.missing.map((m) => [m.requirement, m.detail]));
    expect(porRequisito.get('checklist_complete')).toBe('3 de 10 itens sem resposta');
    expect(porRequisito.get('hours_logged')).toMatch(/nenhuma hora/);
    expect(porRequisito.get('resolution_filled')).toMatch(/10 caracteres/);
    expect(porRequisito.get('cause_code_filled')).toMatch(/causa identificada/);
    expect(porRequisito.get('photo_before_after')).toBe('falta a foto de depois');
    for (const m of r.missing) expect(m.label.length).toBeGreaterThan(0);
  });

  it('distingue "nenhuma foto" de "falta a de depois"', () => {
    const nenhuma = checkCompletion(['photo_before_after'], { ...completo, photosBefore: 0, photosAfter: 0 });
    expect(nenhuma.missing[0]!.detail).toMatch(/nenhuma foto/);
    const soAntes = checkCompletion(['photo_before_after'], { ...completo, photosAfter: 0 });
    expect(soAntes.missing[0]!.detail).toMatch(/de depois/);
  });

  it('item reprovado sem foto de evidência é pendência contada', () => {
    const r = checkCompletion(['failed_items_have_photo'], { ...completo, failedItemsWithoutPhoto: 2 });
    expect(r.missing[0]!.detail).toMatch(/2 item\(ns\) reprovado/);
  });

  it('peça sem confirmação de consumo trava a conclusão', () => {
    const r = checkCompletion(['parts_confirmed'], { ...completo, partsPending: 3 });
    expect(r.missing[0]!.detail).toMatch(/3 peça/);
  });
});

describe('numeração', () => {
  it('a série da OS é separada da de solicitações', () => {
    expect(formatWorkOrderNumber(2026, 7)).toBe('WO-2026-0007');
  });
});
