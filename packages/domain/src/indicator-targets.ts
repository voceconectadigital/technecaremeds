/**
 * Aurora — METAS dos indicadores (auditoria 17/10/2026, §13).
 *
 * Fórmula não é meta: o mesmo indicador tem metas diferentes por cliente e por
 * contrato (a disponibilidade é 92 %, 98 % ou 98 % conforme o documento). Nada
 * aqui fixa meta — este arquivo só diz COMO uma meta configurada é escolhida e
 * lida. Os valores vêm do banco (`indicator_targets`).
 *
 * PRECEDÊNCIA — a mais específica vence:
 *
 *     contrato  →  cliente  →  organização
 *
 * Dentro de um mesmo escopo, vale a que está em vigor na data de referência.
 * Sem nenhuma em vigor, o resultado é `null`: SEM META CONFIGURADA. Nunca zero —
 * zero é uma meta (e uma meta absurda para disponibilidade).
 *
 * Funções puras: o Painel, o relatório e a automação chamam as MESMAS.
 */
import { REPORT_INDICATORS, findIndicator, type TargetDirection } from './report-tiers';

export const NO_TARGET_LABEL = 'SEM META CONFIGURADA';

export type TargetScope = 'contract' | 'customer' | 'organization';
export type TargetTimeline = 'active' | 'future' | 'expired';

/** Unidades aceitas numa meta: as dos indicadores que têm sentido de meta. */
export const TARGET_UNITS = ['count', 'minutes', 'hours', 'percent', 'score'] as const;
export type TargetUnit = (typeof TARGET_UNITS)[number];

/** Sentido persistido: o `INFORMATIONAL` do catálogo não tem meta. */
export type StoredDirection = Exclude<TargetDirection, 'INFORMATIONAL'>;

export interface IndicatorTarget {
  readonly id: string;
  readonly indicatorKey: string;
  /** `null` = meta da organização. */
  readonly customerId: string | null;
  /** `null` = sem contrato. Contrato sempre vem com o cliente dele. */
  readonly contractId: string | null;
  /** Dia (YYYY-MM-DD), inclusive. */
  readonly validFrom: string;
  /** Dia (YYYY-MM-DD), inclusive. `null` = vigência aberta. */
  readonly validTo: string | null;
  readonly value: number;
  readonly unit: TargetUnit;
  readonly direction: StoredDirection;
}

export function targetScopeOf(t: Pick<IndicatorTarget, 'customerId' | 'contractId'>): TargetScope {
  if (t.contractId) return 'contract';
  if (t.customerId) return 'customer';
  return 'organization';
}

/** Dia de calendário (UTC) de uma data. */
export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A meta está em vigor no dia? (datas ISO comparam como texto) */
export function targetInForce(t: Pick<IndicatorTarget, 'validFrom' | 'validTo'>, day: string): boolean {
  return t.validFrom <= day && (t.validTo === null || t.validTo >= day);
}

export function targetTimeline(
  t: Pick<IndicatorTarget, 'validFrom' | 'validTo'>,
  today: string
): TargetTimeline {
  if (t.validFrom > today) return 'future';
  if (t.validTo !== null && t.validTo < today) return 'expired';
  return 'active';
}

const PESO: Record<TargetScope, number> = { contract: 3, customer: 2, organization: 1 };

export interface TargetContext {
  readonly indicatorKey: string;
  readonly customerId?: string | null;
  readonly contractId?: string | null;
  /** Dia de referência (YYYY-MM-DD). */
  readonly on: string;
}

export interface ResolvedTarget {
  readonly target: IndicatorTarget;
  readonly scope: TargetScope;
}

/**
 * A meta que vale para o indicador no contexto, ou `null`.
 *
 * Uma meta de contrato só vale quando o contexto traz ESSE contrato; uma de
 * cliente, quando traz esse cliente. Uma meta de outro cliente nunca "vaza"
 * para este contexto — por isso o contexto sem cliente só enxerga a da
 * organização.
 */
export function resolveTarget(
  candidates: readonly IndicatorTarget[],
  ctx: TargetContext
): ResolvedTarget | null {
  let melhor: ResolvedTarget | null = null;
  for (const t of candidates) {
    if (t.indicatorKey !== ctx.indicatorKey || !targetInForce(t, ctx.on)) continue;
    const scope = targetScopeOf(t);
    const aplica =
      scope === 'organization' ||
      (scope === 'customer' && !!ctx.customerId && t.customerId === ctx.customerId) ||
      (scope === 'contract' && !!ctx.contractId && t.contractId === ctx.contractId);
    if (!aplica) continue;
    if (
      !melhor ||
      PESO[scope] > PESO[melhor.scope] ||
      (scope === melhor.scope && t.validFrom > melhor.target.validFrom)
    ) {
      melhor = { target: t, scope };
    }
  }
  return melhor;
}

export type TargetEvaluation = 'met' | 'not_met' | 'no_value' | 'no_target' | 'informational';

/**
 * Compara o valor com a meta, no sentido da meta. Igualdade cumpre a meta nos
 * dois sentidos (≥ e ≤). Sem valor não é "não cumpriu": é "sem dado".
 */
export function evaluateTarget(
  value: number | null,
  target: Pick<IndicatorTarget, 'value' | 'direction'> | null,
  catalogDirection: TargetDirection
): TargetEvaluation {
  if (catalogDirection === 'INFORMATIONAL') return 'informational';
  if (!target) return 'no_target';
  if (value === null) return 'no_value';
  return (target.direction === 'HIGHER_IS_BETTER' ? value >= target.value : value <= target.value)
    ? 'met'
    : 'not_met';
}

/**
 * Razão percentual genérica: `realizados ÷ solicitados × 100`.
 *
 * Calculadora SEM população: quem chama diz o que são numerador e denominador.
 * Serve ao ICRS, ao ITRS e ao AxF, mas só o AxF tem população confirmada.
 * Denominador zero é "sem dado" (`null`), nunca 0 % nem 100 % — o PDF Basic
 * mostra 100 % para 0 ÷ 0 e este código não reproduz isso. Pode passar de 100.
 */
export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
  /** Percentual com 2 casas; `null` quando o denominador é zero. */
  readonly percent: number | null;
}

export function ratioPercent(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    percent: denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : null,
  };
}

/** Os dados que uma meta nova precisa respeitar do catálogo. */
export interface TargetCatalogCheck {
  readonly ok: boolean;
  readonly reason?: string;
  readonly unit?: TargetUnit;
}

/**
 * Valida o par indicador × sentido × unidade contra o catálogo. O sentido e a
 * unidade são do indicador: configurar "≤" para uma disponibilidade, ou meta
 * em minutos para um percentual, seria uma meta que o cálculo nunca poderia
 * cumprir direito.
 */
export function checkTargetAgainstCatalog(
  indicatorKey: string,
  direction: StoredDirection,
  unit?: string
): TargetCatalogCheck {
  const ind = findIndicator(indicatorKey);
  if (!ind) return { ok: false, reason: `indicador desconhecido: ${indicatorKey}` };
  if (ind.targetDirection === 'INFORMATIONAL') {
    return { ok: false, reason: `"${ind.label}" é informativo: não tem meta` };
  }
  if (ind.targetDirection !== direction) {
    return {
      ok: false,
      reason: `o sentido da meta de "${ind.label}" é ${ind.targetDirection === 'HIGHER_IS_BETTER' ? '≥ (maior é melhor)' : '≤ (menor é melhor)'}`,
    };
  }
  if (!(TARGET_UNITS as readonly string[]).includes(ind.unit)) {
    return { ok: false, reason: `"${ind.label}" não tem unidade de meta` };
  }
  if (unit !== undefined && unit !== ind.unit) {
    return { ok: false, reason: `a unidade da meta de "${ind.label}" é ${ind.unit}` };
  }
  return { ok: true, unit: ind.unit as TargetUnit };
}

/** Chaves de indicador que aceitam meta. */
export const TARGETABLE_INDICATOR_KEYS: readonly string[] = REPORT_INDICATORS.filter(
  (i) => i.targetDirection !== 'INFORMATIONAL'
).map((i) => i.key);
