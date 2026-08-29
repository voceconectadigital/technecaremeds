/**
 * Aurora — solicitações de serviço (SPEC v0.2 §08, ADR-002 · EPIC-007).
 *
 * ADR-002 é a decisão mais consequente da especificação: `service_request` é
 * entidade própria, distinta de `work_order`. Uma solicitação gera zero, uma ou
 * várias ordens de serviço.
 *
 * O que essa separação compra, concretamente:
 *  · solicitação recusada não vira "OS cancelada" poluindo o denominador de
 *    todo indicador de ordem de serviço
 *  · duplicata é preservada apontando para a original, em vez de destruída
 *  · o relato do cliente é imutável; o diagnóstico do técnico vive na OS
 *  · o portal escreve em UMA tabela, e só nela
 *
 * A máquina de estados vive aqui, em código puro, e não em tabela configurável
 * — ao contrário da máquina de ORDENS DE SERVIÇO, que é configurável por
 * organização (ADR-003). A diferença não é inconsistência: o ciclo da
 * solicitação é o contrato com o cliente, e um contrato que cada organização
 * redesenha deixa de ser contrato. Já o fluxo interno de trabalho varia
 * legitimamente entre uma clínica e uma rede hospitalar.
 */

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'triage',
  'info_needed',
  'accepted',
  'in_service',
  'fulfilled',
  'closed',
  'rejected',
  'duplicate',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Por onde a solicitação foi aberta.
 *
 * Nome com prefixo porque `RequestSource` já existe em `context.ts` e
 * significa outra coisa — a origem da requisição HTTP. Dois conceitos com o
 * mesmo nome no mesmo pacote confundem quem lê antes de confundir o
 * compilador.
 */
export const SERVICE_REQUEST_SOURCES = [
  'portal',
  'qr_code',
  'phone',
  'email',
  'walk_in',
  'api',
  'internal',
] as const;
export type ServiceRequestSource = (typeof SERVICE_REQUEST_SOURCES)[number];

/** Estados dos quais não se sai. */
export const TERMINAL_STATUSES: readonly RequestStatus[] = ['closed', 'rejected', 'duplicate', 'cancelled'];

export function isTerminal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Estados que contam como "demanda em aberto" para a detecção de duplicidade e
 * para a fila. `draft` fica de fora: rascunho do portal ainda não é demanda.
 */
export const OPEN_STATUSES: readonly RequestStatus[] = [
  'submitted',
  'triage',
  'info_needed',
  'accepted',
  'in_service',
];

export interface TransitionRule {
  readonly to: RequestStatus;
  /** Permissão exigida; `null` quando quem move é o próprio solicitante. */
  readonly permission: string | null;
  /** Campos que a transição exige preenchidos. */
  readonly requires?: readonly string[];
  readonly note: string;
}

/**
 * O grafo, declarado. Reproduz o diagrama da SPEC §08 sem interpretação.
 */
export const TRANSITIONS: Readonly<Record<RequestStatus, readonly TransitionRule[]>> = Object.freeze({
  draft: [
    { to: 'submitted', permission: null, note: 'o solicitante envia o rascunho' },
    { to: 'cancelled', permission: null, note: 'o solicitante desiste antes de enviar' },
  ],
  submitted: [
    { to: 'triage', permission: 'service_request.triage', note: 'alguém assume a análise' },
    {
      to: 'cancelled',
      permission: null,
      requires: ['cancellation_reason'],
      note: 'o solicitante desiste',
    },
  ],
  triage: [
    {
      to: 'info_needed',
      permission: 'service_request.triage',
      requires: ['info_request'],
      note: 'falta informação',
    },
    { to: 'accepted', permission: 'service_request.accept', note: 'vai virar trabalho' },
    {
      to: 'rejected',
      permission: 'service_request.reject',
      requires: ['rejection_reason_id'],
      note: 'não vira trabalho',
    },
    {
      to: 'duplicate',
      permission: 'service_request.merge',
      requires: ['merged_into_request_id'],
      note: 'já existe solicitação equivalente',
    },
    { to: 'cancelled', permission: null, requires: ['cancellation_reason'], note: 'o solicitante desiste' },
  ],
  info_needed: [
    { to: 'triage', permission: null, note: 'o solicitante respondeu' },
    { to: 'cancelled', permission: null, requires: ['cancellation_reason'], note: 'o solicitante desiste' },
  ],
  accepted: [
    { to: 'in_service', permission: null, note: 'derivado: ao menos uma OS em andamento' },
    {
      to: 'cancelled',
      permission: null,
      requires: ['cancellation_reason'],
      note: 'desistência antes do serviço',
    },
  ],
  // Depois de `in_service` não se cancela a solicitação: cancela-se a OS. Se a
  // solicitação pudesse ser cancelada aqui, a OS ficaria órfã em execução, e a
  // pessoa que está com a chave de fenda na mão não saberia disso.
  in_service: [{ to: 'fulfilled', permission: null, note: 'derivado: todas as OS concluídas' }],
  fulfilled: [{ to: 'closed', permission: null, note: 'encerrada para o cliente' }],
  closed: [],
  rejected: [],
  duplicate: [],
  cancelled: [],
});

export interface TransitionCheck {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly missing?: readonly string[];
}

/**
 * A transição é possível?
 *
 * Devolve a razão da recusa e as transições disponíveis, porque "transição
 * inválida" sozinho obriga quem chamou a adivinhar o que fazer em seguida — que
 * é exatamente a experiência que a SPEC quer evitar (§08, critérios de aceite
 * do EPIC-008).
 */
export function canTransition(
  from: RequestStatus,
  to: RequestStatus,
  ctx: { permissions: ReadonlySet<string>; fields?: Readonly<Record<string, unknown>> } = {
    permissions: new Set(),
  }
): TransitionCheck {
  const regras = TRANSITIONS[from];
  const regra = regras.find((r) => r.to === to);
  if (!regra) {
    const possiveis = regras.map((r) => r.to);
    return {
      allowed: false,
      reason:
        possiveis.length === 0
          ? `"${from}" é um estado final; não há transição a partir dele`
          : `de "${from}" só é possível ir para: ${possiveis.join(', ')}`,
    };
  }

  if (regra.permission && !ctx.permissions.has(regra.permission)) {
    return { allowed: false, reason: `esta transição exige a permissão ${regra.permission}` };
  }

  const campos = ctx.fields ?? {};
  const faltando = (regra.requires ?? []).filter((f) => {
    const v = campos[f];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (faltando.length > 0) {
    return {
      allowed: false,
      reason: `a transição para "${to}" exige: ${faltando.join(', ')}`,
      missing: faltando,
    };
  }

  return { allowed: true };
}

/** Transições disponíveis a partir de um estado, já filtradas por permissão. */
export function availableTransitions(
  from: RequestStatus,
  permissions: ReadonlySet<string>
): TransitionRule[] {
  return TRANSITIONS[from].filter((r) => !r.permission || permissions.has(r.permission));
}

/* -------------------------------------------------------------------------- */
/* numeração                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Número visível da solicitação: `SR-{ano}-{sequência}`.
 *
 * Série própria, separada da série de OS (SPEC §08). Misturar as duas faria
 * "quantos chamados abrimos este mês?" e "quantas ordens executamos?"
 * responderem o mesmo número — que é precisamente a confusão que o ADR-002
 * existe para desfazer.
 */
export function formatRequestNumber(year: number, sequence: number): string {
  return `SR-${year}-${String(sequence).padStart(4, '0')}`;
}

const NUMBER_FORMAT = /^SR-(\d{4})-(\d{4,})$/;

export function parseRequestNumber(value: string): { year: number; sequence: number } | null {
  const m = NUMBER_FORMAT.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), sequence: Number(m[2]) };
}

/* -------------------------------------------------------------------------- */
/* duplicidade                                                                 */
/* -------------------------------------------------------------------------- */

export interface DuplicateCandidate {
  readonly id: string;
  readonly number: string;
  readonly summary: string;
  readonly created_at: string;
  readonly asset_id: string | null;
  readonly location_id: string | null;
  readonly reported_failure_code_id: string | null;
}

export interface DuplicateHint {
  readonly candidate: DuplicateCandidate;
  readonly reason: 'mesmo_ativo' | 'mesmo_local_e_sintoma';
  readonly ageDays: number;
}

/**
 * Avisa sobre solicitações abertas parecidas — **sem bloquear**.
 *
 * A regra vem direto da auditoria, onde dois chamados idênticos do mesmo
 * solicitante para o mesmo desfibrilador aparecem em sequência na fila. Mas
 * bloquear seria pior que o problema: existem casos legítimos de duas falhas
 * distintas no mesmo equipamento na mesma semana, e um bloqueio ensinaria a
 * contornar o sistema pelo telefone.
 */
export function findDuplicateHints(
  novo: { assetId: string | null; locationId: string | null; failureCodeId: string | null },
  abertas: readonly DuplicateCandidate[],
  now: Date,
  windowDays = 7
): DuplicateHint[] {
  const hints: DuplicateHint[] = [];
  for (const c of abertas) {
    const idade = (now.getTime() - new Date(c.created_at).getTime()) / 86_400_000;
    if (!Number.isFinite(idade) || idade > windowDays || idade < 0) continue;

    if (novo.assetId && c.asset_id === novo.assetId) {
      hints.push({ candidate: c, reason: 'mesmo_ativo', ageDays: Math.floor(idade) });
      continue;
    }
    if (
      novo.locationId &&
      novo.failureCodeId &&
      c.location_id === novo.locationId &&
      c.reported_failure_code_id === novo.failureCodeId
    ) {
      hints.push({ candidate: c, reason: 'mesmo_local_e_sintoma', ageDays: Math.floor(idade) });
    }
  }
  return hints.sort((a, b) => a.ageDays - b.ageDays);
}

/* -------------------------------------------------------------------------- */
/* fila de triagem                                                             */
/* -------------------------------------------------------------------------- */

export const REQUEST_PRIORITIES = ['emergency', 'very_urgent', 'urgent', 'low', 'none'] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

const PRIORITY_ORDER: Record<RequestPriority, number> = {
  emergency: 0,
  very_urgent: 1,
  urgent: 2,
  low: 3,
  none: 4,
};

/**
 * Ordena a fila de triagem: prioridade primeiro, idade depois.
 *
 * Ordenar só por idade enterraria uma emergência atrás de trinta pedidos
 * antigos de baixa prioridade. Ordenar só por prioridade deixaria os `none`
 * envelhecerem para sempre — por isso a idade é o segundo critério e não um
 * enfeite.
 */
export function triageOrder<T extends { priority: RequestPriority; created_at: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}
