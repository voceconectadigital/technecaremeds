/**
 * Aurora — agenda (SPEC v0.2 §13 · EPIC-012).
 *
 * Na referência auditada há **2.950 serviços não agendados**. A agenda existe e
 * não é usada, e o diagnóstico é ergonômico: programar custa mais do que ligar
 * para o técnico. Tudo neste arquivo serve a uma meta só — tornar a programação
 * mais barata que a ligação.
 *
 * NÃO EXISTE ENTIDADE "AGENDAMENTO" (ADR-011)
 *   A programação vive na própria OS (`scheduled_start`, `scheduled_end`,
 *   responsável, equipe) e a agenda é uma PROJEÇÃO. Um evento de agenda que
 *   existisse fora da OS criaria duas fontes de verdade e a obrigação de
 *   sincronizá-las — e é sempre a sincronização que falha em silêncio. A
 *   referência acerta nisso, e não há motivo para divergir.
 *
 *   A exceção é `availability_blocks`: férias, treinamento, atestado, reunião.
 *   Não é OS e não deve virar uma.
 */

export const BLOCK_KINDS = ['vacation', 'leave', 'training', 'other'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * Quais ausências BLOQUEIAM o agendamento e quais apenas avisam.
 *
 * O §13 fala em bloco "de tipo `absence`", mas o enumerado do banco (§06) não
 * tem esse valor: tem `vacation`, `leave`, `training` e `other`. Em vez de
 * inventar um tipo novo — o que faria a SPEC e o esquema divergirem — a regra é
 * declarada aqui, uma vez, com o critério explícito:
 *
 *   BLOQUEIA quando a pessoa não está disponível de forma alguma: férias e
 *   afastamento. Agendar sobre isso não é uma decisão difícil, é um erro.
 *
 *   AVISA quando existe compromisso mas a pessoa está presente e alguém pode
 *   legitimamente decidir o contrário: treinamento (que se interrompe por uma
 *   emergência) e `other`, que abriga reunião e reserva de sala — coisas que
 *   nem sempre são sobre a disponibilidade do técnico.
 *
 * Errar para o lado de bloquear demais é pior aqui: um bloqueio que o
 * coordenador não consegue justificar é exatamente o custo que faz ele
 * abandonar a agenda e voltar a ligar para o técnico.
 */
export const BLOCKING_KINDS: ReadonlySet<BlockKind> = Object.freeze(
  new Set<BlockKind>(['vacation', 'leave'])
);

export function blocksScheduling(kind: BlockKind): boolean {
  return BLOCKING_KINDS.has(kind);
}

/* -------------------------------------------------------------------------- */
/* janelas                                                                     */
/* -------------------------------------------------------------------------- */

export interface Window {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Dois intervalos de INSTANTES se sobrepõem?
 *
 * Prima da `windowsOverlap` do diretório, que compara janelas de horário do
 * dia (minutos desde a meia-noite). Mesma regra, tipos diferentes: aqui são
 * datas com fuso, lá são horários que se repetem toda semana. Unificar as duas
 * obrigaria uma delas a converter para o domínio da outra em toda chamada.
 *
 * Extremos EXCLUSIVOS, ao contrário da vigência de contrato: uma OS que termina
 * às 10 h e outra que começa às 10 h não disputam nada — é a agenda funcionando
 * como deve. Tratar isso como conflito encheria a tela de avisos falsos, e o
 * aviso que aparece sempre é o aviso que ninguém lê.
 */
export function instantsOverlap(a: Window, b: Window): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function windowMinutes(w: Window): number {
  return Math.max(0, Math.round((w.endsAt.getTime() - w.startsAt.getTime()) / 60_000));
}

/** Minutos em que duas janelas de fato se cruzam. */
export function overlapMinutes(a: Window, b: Window): number {
  const inicio = Math.max(a.startsAt.getTime(), b.startsAt.getTime());
  const fim = Math.min(a.endsAt.getTime(), b.endsAt.getTime());
  return fim > inicio ? Math.round((fim - inicio) / 60_000) : 0;
}

/* -------------------------------------------------------------------------- */
/* conflitos                                                                   */
/* -------------------------------------------------------------------------- */

export const CONFLICT_KINDS = [
  'absence',
  'commitment',
  'overlap',
  'outside_location_calendar',
  'over_capacity',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export type ConflictSeverity = 'block' | 'warn';

export interface Conflict {
  readonly kind: ConflictKind;
  readonly severity: ConflictSeverity;
  /** Frase pronta para a tela — o coordenador decide com ela, não com um código. */
  readonly detail: string;
  readonly referenceId?: string;
}

export interface ScheduleCandidate extends Window {
  readonly workOrderId: string;
  readonly assigneeMembershipId: string | null;
}

export interface BusyWindow extends Window {
  readonly workOrderId: string;
  readonly number: string | null;
}

export interface BlockWindow extends Window {
  readonly id: string;
  readonly kind: BlockKind;
  readonly note: string | null;
}

const KIND_LABELS: Record<BlockKind, string> = {
  vacation: 'férias',
  leave: 'afastamento',
  training: 'treinamento',
  other: 'compromisso',
};

export interface ConflictInput {
  readonly candidate: ScheduleCandidate;
  readonly blocks: readonly BlockWindow[];
  /** Outras OS já agendadas para a mesma pessoa. */
  readonly busy: readonly BusyWindow[];
  /** Minutos já ocupados no dia, fora esta OS. */
  readonly bookedMinutesToday: number;
  /** Capacidade do dia em minutos. `null` quando a jornada não foi informada. */
  readonly capacityMinutes: number | null;
  /** A janela cabe no calendário do local? `null` quando o local não tem calendário. */
  readonly locationWindowFits: boolean | null;
  readonly locationName?: string;
  readonly locationHint?: string;
}

/**
 * Todos os conflitos de uma proposta de agendamento — bloqueios e avisos juntos.
 *
 * A separação entre bloquear e avisar é a decisão central do §13, e ela é uma
 * escolha de produto, não de implementação: **sobreposição avisa, ausência
 * bloqueia**. Duas OS no mesmo horário são legítimas numa ronda; três não são.
 * O sistema informa e o humano decide — porque o sistema não sabe que aquelas
 * duas ficam no mesmo andar.
 *
 * Devolve a lista inteira, nunca o primeiro problema. Um coordenador que
 * descobre o segundo conflito depois de resolver o primeiro tem duas tentativas
 * para agendar uma OS, e a terceira ele faz por telefone.
 */
export function detectConflicts(input: ConflictInput): Conflict[] {
  const conflitos: Conflict[] = [];
  const { candidate } = input;

  for (const bloco of input.blocks) {
    if (!instantsOverlap(candidate, bloco)) continue;
    const rotulo = KIND_LABELS[bloco.kind];
    const nota = bloco.note ? ` (${bloco.note})` : '';
    conflitos.push(
      blocksScheduling(bloco.kind)
        ? {
            kind: 'absence',
            severity: 'block',
            detail: `a pessoa está em ${rotulo} neste período${nota}`,
            referenceId: bloco.id,
          }
        : {
            kind: 'commitment',
            severity: 'warn',
            detail: `há ${rotulo} marcado neste período${nota}`,
            referenceId: bloco.id,
          }
    );
  }

  for (const outra of input.busy) {
    if (outra.workOrderId === candidate.workOrderId) continue;
    if (!instantsOverlap(candidate, outra)) continue;
    conflitos.push({
      kind: 'overlap',
      severity: 'warn',
      detail: `sobrepõe a OS ${outra.number ?? outra.workOrderId} por ${overlapMinutes(candidate, outra)} min`,
      referenceId: outra.workOrderId,
    });
  }

  if (input.locationWindowFits === false) {
    const onde = input.locationName ? ` em ${input.locationName}` : '';
    const porque = input.locationHint ? `: ${input.locationHint}` : '';
    conflitos.push({
      kind: 'outside_location_calendar',
      severity: 'warn',
      detail: `fora da janela de atendimento${onde}${porque}`,
    });
  }

  if (input.capacityMinutes !== null && input.capacityMinutes > 0) {
    const total = input.bookedMinutesToday + windowMinutes(candidate);
    if (total > input.capacityMinutes) {
      const pct = Math.round((total / input.capacityMinutes) * 100);
      conflitos.push({
        kind: 'over_capacity',
        severity: 'warn',
        detail: `o dia fica com ${pct} % da jornada ocupada`,
      });
    }
  }

  return conflitos;
}

export function blockingConflicts(conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.severity === 'block');
}

/* -------------------------------------------------------------------------- */
/* carga                                                                       */
/* -------------------------------------------------------------------------- */

export interface LoadSummary {
  readonly bookedMinutes: number;
  readonly capacityMinutes: number | null;
  /** Ocupação em percentual. `null` quando a jornada não foi informada. */
  readonly percent: number | null;
  readonly over: boolean;
}

/**
 * Carga de um dia.
 *
 * Sem jornada informada, a ocupação é `null` e NÃO zero: um técnico sem jornada
 * cadastrada não está com o dia livre, está com o cadastro incompleto. Mostrar
 * 0 % faria o coordenador empilhar trabalho justamente em quem o sistema
 * conhece menos.
 */
export function summarizeLoad(bookedMinutes: number, dailyHours: number | null): LoadSummary {
  if (dailyHours === null || dailyHours <= 0) {
    return { bookedMinutes, capacityMinutes: null, percent: null, over: false };
  }
  const capacidade = Math.round(dailyHours * 60);
  const pct = Number(((bookedMinutes / capacidade) * 100).toFixed(1));
  return {
    bookedMinutes,
    capacityMinutes: capacidade,
    percent: pct,
    over: bookedMinutes > capacidade,
  };
}

/* -------------------------------------------------------------------------- */
/* reagendamento                                                               */
/* -------------------------------------------------------------------------- */

/** Acima disto, reagendar deixa de ser ajuste e vira sinal operacional (§13). */
export const RESCHEDULE_SIGNAL_THRESHOLD = 3;

export function isRescheduleSignal(count: number): boolean {
  return count > RESCHEDULE_SIGNAL_THRESHOLD;
}

/**
 * A mudança é grande o bastante para avisar o solicitante?
 *
 * O limiar existe para o cliente não receber um e-mail porque a OS andou vinte
 * minutos. Quem recebe aviso de mudança irrelevante para de ler os avisos, e aí
 * perde o adiamento de três dias que importava.
 */
export function shouldNotifyRequester(previous: Date, next: Date, thresholdHours: number): boolean {
  const horas = Math.abs(next.getTime() - previous.getTime()) / 3_600_000;
  return horas >= thresholdHours;
}

/* -------------------------------------------------------------------------- */
/* baldes                                                                      */
/* -------------------------------------------------------------------------- */

export const SCHEDULE_BUCKETS = ['late', 'unscheduled', 'to_reschedule'] as const;
export type ScheduleBucket = (typeof SCHEDULE_BUCKETS)[number];

export const BUCKET_LABELS: Record<ScheduleBucket, string> = {
  late: 'Atrasadas',
  unscheduled: 'Não agendadas',
  to_reschedule: 'Reagendar',
};

export interface BucketFacts {
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly startedAt: Date | null;
  readonly dueAt: Date | null;
  /** A janela caiu sobre uma ausência criada depois do agendamento. */
  readonly windowInvalidated: boolean;
}

/**
 * Em qual balde do painel lateral a OS cai — ou em nenhum.
 *
 * A ordem das perguntas é a ordem da urgência, e por isso "reagendar" vem antes
 * de "atrasada": uma OS cuja janela caiu sobre férias não está atrasada por
 * culpa de ninguém, e tratá-la como atraso mistura o problema de programação
 * com o problema de execução. São conversas diferentes com pessoas diferentes.
 */
export function bucketFor(facts: BucketFacts, now: Date): ScheduleBucket | null {
  if (facts.startedAt !== null) return null;
  if (facts.windowInvalidated) return 'to_reschedule';

  if (facts.scheduledStart === null) {
    // Sem janela e com prazo vencido, o que falta é decidir quando — e é isso
    // que "não agendada" quer dizer. O atraso aparece no SLA, que é onde ele
    // tem consequência.
    return 'unscheduled';
  }

  if (facts.scheduledEnd !== null && facts.scheduledEnd.getTime() < now.getTime()) {
    return 'late';
  }
  return null;
}
