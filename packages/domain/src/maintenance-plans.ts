/**
 * Aurora — planos de manutenção preventiva (SPEC v0.2 §12 · EPIC-012).
 *
 * O modelo da referência é bom — ciclos, janela, progresso, conformidade,
 * geração automática. Duas limitações reais são corrigidas aqui, e as duas
 * aparecem neste arquivo:
 *
 * CORREÇÃO 1 — FREQUÊNCIA É DA TAREFA, NÃO DO PLANO
 *   Lá, ter preventiva semestral e calibração anual no mesmo equipamento exige
 *   dois planos. O tenant auditado tem **826 planos**, muitos deles duplicatas
 *   do mesmo escopo com ritmos diferentes. Aqui um plano tem N tarefas, cada
 *   uma com o seu ritmo.
 *
 * CORREÇÃO 2 — ALVO É UMA EXPRESSÃO, NÃO UMA LISTA DE CAIXAS MARCADAS
 *   "Todos os ativos da categoria Ventilador pulmonar na subárvore UTI" é uma
 *   regra que continua valendo para o ventilador que chegar amanhã. Uma lista
 *   de ativos marcados um a um envelhece no dia seguinte, e ninguém percebe.
 */

export const FREQUENCY_UNITS = ['day', 'week', 'month', 'quarter', 'semester', 'year'] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

/** Rótulos em português, para a interface não ter a sua própria tradução. */
export const FREQUENCY_LABELS: Record<FrequencyUnit, string> = {
  day: 'dia',
  week: 'semana',
  month: 'mês',
  quarter: 'trimestre',
  semester: 'semestre',
  year: 'ano',
};

const MONTHS_PER_UNIT: Partial<Record<FrequencyUnit, number>> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
};

/**
 * Soma uma frequência a uma data.
 *
 * O caso que costuma quebrar: 31 de janeiro + 1 mês. Somar ingenuamente daria
 * 3 de março (ou 2, em ano bissexto) porque o dia 31 não existe em fevereiro —
 * e a preventiva de fim de mês escorregaria alguns dias a cada ciclo até sair
 * do mês. Aqui o dia é grampeado no último dia do mês de destino, que é o que
 * "todo dia 31" significa na prática.
 */
export function addFrequency(from: Date, unit: FrequencyUnit, interval: number): Date {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new RangeError(`intervalo de frequência inválido: ${interval}`);
  }

  if (unit === 'day') return new Date(from.getTime() + interval * 86_400_000);
  if (unit === 'week') return new Date(from.getTime() + interval * 7 * 86_400_000);

  const meses = (MONTHS_PER_UNIT[unit] ?? 1) * interval;
  const ano = from.getUTCFullYear();
  const mes = from.getUTCMonth() + meses;
  const dia = from.getUTCDate();

  const ultimoDiaDoMesDestino = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      ano,
      mes,
      Math.min(dia, ultimoDiaDoMesDestino),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds()
    )
  );
}

/** Quantos ciclos de uma frequência cabem em um ano — para estimativa de carga. */
export function cyclesPerYear(unit: FrequencyUnit, interval: number): number {
  const porAno: Record<FrequencyUnit, number> = {
    day: 365,
    week: 52,
    month: 12,
    quarter: 4,
    semester: 2,
    year: 1,
  };
  return Number((porAno[unit] / interval).toFixed(2));
}

/* -------------------------------------------------------------------------- */
/* alvo                                                                        */
/* -------------------------------------------------------------------------- */

export const PLAN_TARGET_KINDS = ['asset', 'asset_category', 'location_subtree'] as const;
export type PlanTargetKind = (typeof PLAN_TARGET_KINDS)[number];

export interface PlanTarget {
  readonly kind: PlanTargetKind;
  /** Ativo, categoria ou local raiz, conforme o tipo. */
  readonly referenceId: string;
  /** Restringe a categoria dentro de uma subárvore de locais. */
  readonly categoryId?: string | null;
}

export function describeTarget(
  target: PlanTarget,
  names: { reference?: string; category?: string } = {}
): string {
  const ref = names.reference ?? target.referenceId;
  switch (target.kind) {
    case 'asset':
      return `o ativo ${ref}`;
    case 'asset_category':
      return `todos os ativos da categoria ${ref}`;
    case 'location_subtree':
      return names.category
        ? `os ativos da categoria ${names.category} em ${ref} e abaixo`
        : `todos os ativos em ${ref} e abaixo`;
  }
}

/* -------------------------------------------------------------------------- */
/* conformidade                                                                */
/* -------------------------------------------------------------------------- */

export const CYCLE_ITEM_STATUSES = ['pending', 'generated', 'done', 'skipped', 'overdue'] as const;
export type CycleItemStatus = (typeof CYCLE_ITEM_STATUSES)[number];

export type ComplianceState =
  'on_time_not_started' | 'on_time_started' | 'late_not_started' | 'late_started' | 'done' | 'skipped';

export interface ItemFacts {
  readonly dueAt: string;
  readonly toleranceDays: number;
  readonly status: CycleItemStatus;
  /** Categoria da situação da OS materializada, quando existe. */
  readonly workOrderCategory: string | null;
}

/**
 * Situação de conformidade de um item previsto (SPEC §12).
 *
 * A tolerância é o detalhe que decide se o indicador é levado a sério: uma
 * preventiva executada um dia depois do previsto não é não conformidade, e
 * contá-la como tal destrói a credibilidade do número — as pessoas passam a
 * ignorar o relatório em vez de agir sobre ele.
 */
export function complianceState(item: ItemFacts, now: Date): ComplianceState {
  if (item.status === 'skipped') return 'skipped';
  if (item.status === 'done') return 'done';
  if (item.workOrderCategory === 'done' || item.workOrderCategory === 'closed') return 'done';

  const limite = new Date(item.dueAt).getTime() + item.toleranceDays * 86_400_000;
  const atrasado = now.getTime() > limite;
  const iniciado =
    item.workOrderCategory !== null &&
    !['draft', 'open', 'scheduled', 'cancelled'].includes(item.workOrderCategory);

  if (atrasado) return iniciado ? 'late_started' : 'late_not_started';
  return iniciado ? 'on_time_started' : 'on_time_not_started';
}

export interface ComplianceSummary {
  readonly expected: number;
  readonly done: number;
  readonly skipped: number;
  readonly late: number;
  readonly pending: number;
  /** Concluídas ÷ (previstas − dispensadas). `null` quando não há denominador. */
  readonly rate: number | null;
}

/**
 * Taxa de conformidade de um conjunto de itens.
 *
 * O denominador exclui as dispensadas: um ativo emprestado a outro hospital não
 * podia receber a preventiva, e contá-lo como falha puniria a equipe por algo
 * que ela não podia fazer. Dispensar exige justificativa — é isso que impede a
 * dispensa de virar a saída fácil para melhorar o número.
 */
export function summarizeCompliance(items: readonly ItemFacts[], now: Date): ComplianceSummary {
  let done = 0;
  let skipped = 0;
  let late = 0;
  let pending = 0;

  for (const item of items) {
    const estado = complianceState(item, now);
    if (estado === 'done') done++;
    else if (estado === 'skipped') skipped++;
    else {
      pending++;
      if (estado === 'late_started' || estado === 'late_not_started') late++;
    }
  }

  const denominador = items.length - skipped;
  return {
    expected: items.length,
    done,
    skipped,
    late,
    pending,
    rate: denominador > 0 ? Number(((done / denominador) * 100).toFixed(1)) : null,
  };
}

/**
 * Janela do próximo ciclo a partir do fim do anterior.
 *
 * O ciclo começa onde o anterior terminou, e não "hoje": ancorar em hoje faria
 * a data escorregar a cada geração atrasada, e em dois anos a preventiva de
 * janeiro estaria em março. A âncora é a data planejada, não a executada.
 */
export function nextCycleWindow(
  previousEnd: Date,
  unit: FrequencyUnit,
  interval: number
): { startsAt: Date; endsAt: Date } {
  const startsAt = previousEnd;
  return { startsAt, endsAt: addFrequency(startsAt, unit, interval) };
}

/** Está na hora de abrir o próximo ciclo, considerando a antecedência? */
export function shouldOpenCycle(cycleStart: Date, leadTimeDays: number, now: Date): boolean {
  return now.getTime() >= cycleStart.getTime() - leadTimeDays * 86_400_000;
}
