/**
 * Aurora — máquina de estados da solicitação (SPEC v0.2 §08, ADR-002 · EPIC-007).
 */
import { describe, it, expect } from 'vitest';
import {
  REQUEST_STATUSES,
  TRANSITIONS,
  TERMINAL_STATUSES,
  isTerminal,
  canTransition,
  availableTransitions,
  formatRequestNumber,
  parseRequestNumber,
  findDuplicateHints,
  triageOrder,
  type RequestStatus,
} from '../service-requests';

const perms = (...p: string[]) => new Set(p);
const TODAS = perms(
  'service_request.triage',
  'service_request.accept',
  'service_request.reject',
  'service_request.merge'
);

describe('integridade do grafo', () => {
  it('todo estado declarado tem entrada no grafo', () => {
    for (const s of REQUEST_STATUSES) expect(TRANSITIONS[s], s).toBeDefined();
  });

  it('nenhuma transição aponta para estado inexistente', () => {
    for (const [from, regras] of Object.entries(TRANSITIONS)) {
      for (const r of regras) {
        expect(REQUEST_STATUSES, `${from} -> ${r.to}`).toContain(r.to);
      }
    }
  });

  it('estados terminais não têm saída, e só eles', () => {
    for (const s of REQUEST_STATUSES) {
      const semSaida = TRANSITIONS[s].length === 0;
      expect(semSaida, s).toBe(isTerminal(s));
    }
    expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'closed', 'duplicate', 'rejected']);
  });

  it('todo estado não inicial é alcançável a partir de draft', () => {
    const alcancados = new Set<RequestStatus>(['draft']);
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const s of [...alcancados]) {
        for (const r of TRANSITIONS[s]) {
          if (!alcancados.has(r.to)) {
            alcancados.add(r.to);
            mudou = true;
          }
        }
      }
    }
    for (const s of REQUEST_STATUSES) expect(alcancados.has(s), `${s} é inalcançável`).toBe(true);
  });

  it('nenhuma transição exige campo que não seja da solicitação', () => {
    const conhecidos = new Set([
      'rejection_reason_id',
      'merged_into_request_id',
      'cancellation_reason',
      'info_request',
    ]);
    for (const regras of Object.values(TRANSITIONS)) {
      for (const r of regras) for (const f of r.requires ?? []) expect(conhecidos, f).toContain(f);
    }
  });
});

describe('transições permitidas', () => {
  it('o caminho feliz vai de ponta a ponta', () => {
    const caminho: Array<[RequestStatus, RequestStatus]> = [
      ['draft', 'submitted'],
      ['submitted', 'triage'],
      ['triage', 'accepted'],
      ['accepted', 'in_service'],
      ['in_service', 'fulfilled'],
      ['fulfilled', 'closed'],
    ];
    for (const [de, para] of caminho) {
      expect(canTransition(de, para, { permissions: TODAS }).allowed, `${de} -> ${para}`).toBe(true);
    }
  });

  it('transição não declarada é recusada nomeando as possíveis', () => {
    const r = canTransition('submitted', 'closed', { permissions: TODAS });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/só é possível ir para: triage, cancelled/);
  });

  it('estado terminal diz que é terminal, não "transição inválida"', () => {
    const r = canTransition('rejected', 'triage', { permissions: TODAS });
    expect(r.reason).toMatch(/estado final/);
  });
});

describe('exigências de cada decisão', () => {
  it('recusar sem motivo é impossível', () => {
    const semMotivo = canTransition('triage', 'rejected', { permissions: TODAS });
    expect(semMotivo.allowed).toBe(false);
    expect(semMotivo.missing).toEqual(['rejection_reason_id']);

    const comMotivo = canTransition('triage', 'rejected', {
      permissions: TODAS,
      fields: { rejection_reason_id: 'algum-id' },
    });
    expect(comMotivo.allowed).toBe(true);
  });

  it('marcar como duplicata sem apontar a original é impossível', () => {
    expect(canTransition('triage', 'duplicate', { permissions: TODAS }).missing).toEqual([
      'merged_into_request_id',
    ]);
  });

  it('pedir informação sem dizer o que falta é impossível', () => {
    expect(canTransition('triage', 'info_needed', { permissions: TODAS }).missing).toEqual(['info_request']);
  });

  it('campo em branco não conta como preenchido', () => {
    const r = canTransition('triage', 'rejected', {
      permissions: TODAS,
      fields: { rejection_reason_id: '   ' },
    });
    expect(r.allowed).toBe(false);
  });
});

describe('permissões nas transições', () => {
  it('sem permissão de triagem, ninguém assume a análise', () => {
    const r = canTransition('submitted', 'triage', { permissions: perms() });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/service_request\.triage/);
  });

  it('quem pode triar não necessariamente pode aceitar', () => {
    const soTriagem = perms('service_request.triage');
    expect(canTransition('submitted', 'triage', { permissions: soTriagem }).allowed).toBe(true);
    expect(canTransition('triage', 'accepted', { permissions: soTriagem }).allowed).toBe(false);
  });

  it('cancelar não exige permissão: quem desiste é o solicitante', () => {
    const r = canTransition('submitted', 'cancelled', {
      permissions: perms(),
      fields: { cancellation_reason: 'resolvido internamente' },
    });
    expect(r.allowed).toBe(true);
  });

  it('as transições oferecidas já vêm filtradas pelo que a pessoa pode fazer', () => {
    const semNada = availableTransitions('triage', perms()).map((r) => r.to);
    expect(semNada).toEqual(['cancelled']);
    const completo = availableTransitions('triage', TODAS).map((r) => r.to);
    expect(completo).toEqual(['info_needed', 'accepted', 'rejected', 'duplicate', 'cancelled']);
  });

  it('depois de in_service a solicitação não é mais cancelável — cancela-se a OS', () => {
    expect(canTransition('in_service', 'cancelled', { permissions: TODAS }).allowed).toBe(false);
  });
});

describe('numeração', () => {
  it('formata com série própria e sequência preenchida à esquerda', () => {
    expect(formatRequestNumber(2026, 1)).toBe('SR-2026-0001');
    expect(formatRequestNumber(2026, 481)).toBe('SR-2026-0481');
    expect(formatRequestNumber(2026, 12345)).toBe('SR-2026-12345');
  });

  it('a leitura desfaz a escrita', () => {
    expect(parseRequestNumber('SR-2026-0481')).toEqual({ year: 2026, sequence: 481 });
    expect(parseRequestNumber('WO-2026-0481')).toBeNull();
    expect(parseRequestNumber('SR-2026-1')).toBeNull();
  });
});

describe('detecção de duplicidade', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  const candidato = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'a',
    number: 'SR-2026-0481',
    summary: 'DEA não liga',
    created_at: '2026-08-26T12:00:00Z',
    asset_id: 'dea-1',
    location_id: 'sala-1',
    reported_failure_code_id: 'nao-liga',
    ...over,
  });

  it('mesmo ativo em janela recente vira aviso', () => {
    const h = findDuplicateHints(
      { assetId: 'dea-1', locationId: null, failureCodeId: null },
      [candidato()],
      agora
    );
    expect(h).toHaveLength(1);
    expect(h[0]!.reason).toBe('mesmo_ativo');
    expect(h[0]!.ageDays).toBe(2);
  });

  it('mesmo local com mesmo sintoma também vira aviso', () => {
    const h = findDuplicateHints(
      { assetId: null, locationId: 'sala-1', failureCodeId: 'nao-liga' },
      [candidato({ asset_id: null })],
      agora
    );
    expect(h[0]!.reason).toBe('mesmo_local_e_sintoma');
  });

  it('mesmo local com sintoma diferente NÃO é duplicata', () => {
    const h = findDuplicateHints(
      { assetId: null, locationId: 'sala-1', failureCodeId: 'vazamento' },
      [candidato({ asset_id: null })],
      agora
    );
    expect(h).toEqual([]);
  });

  it('fora da janela não conta', () => {
    const h = findDuplicateHints(
      { assetId: 'dea-1', locationId: null, failureCodeId: null },
      [candidato({ created_at: '2026-08-01T12:00:00Z' })],
      agora
    );
    expect(h).toEqual([]);
  });

  it('a mais recente vem primeiro, para a pessoa ver a mais provável', () => {
    const h = findDuplicateHints(
      { assetId: 'dea-1', locationId: null, failureCodeId: null },
      [
        candidato({ id: 'antiga', created_at: '2026-08-23T12:00:00Z' }),
        candidato({ id: 'nova', created_at: '2026-08-28T09:00:00Z' }),
      ],
      agora
    );
    expect(h.map((x) => x.candidate.id)).toEqual(['nova', 'antiga']);
  });

  it('sem ativo e sem sintoma não há nada a comparar', () => {
    expect(
      findDuplicateHints({ assetId: null, locationId: 'sala-1', failureCodeId: null }, [candidato()], agora)
    ).toEqual([]);
  });
});

describe('ordem da fila de triagem', () => {
  const item = (id: string, priority: string, created_at: string) => ({ id, priority, created_at }) as never;

  it('prioridade primeiro, idade depois', () => {
    const fila = triageOrder([
      item('velha-baixa', 'low', '2026-01-01T00:00:00Z'),
      item('nova-emergencia', 'emergency', '2026-08-28T11:00:00Z'),
      item('media-urgente', 'urgent', '2026-06-01T00:00:00Z'),
      item('velha-urgente', 'urgent', '2026-02-01T00:00:00Z'),
    ]);
    expect(fila.map((x: { id: string }) => x.id)).toEqual([
      'nova-emergencia',
      'velha-urgente',
      'media-urgente',
      'velha-baixa',
    ]);
  });

  it('não modifica a lista recebida', () => {
    const original = [
      item('a', 'low', '2026-01-01T00:00:00Z'),
      item('b', 'emergency', '2026-01-02T00:00:00Z'),
    ];
    const copia = [...original];
    triageOrder(original);
    expect(original).toEqual(copia);
  });
});
