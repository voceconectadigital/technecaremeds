/**
 * Aurora — contratos (SPEC v0.2 §17 · EPIC-017).
 *
 * Na referência auditada, contrato é cadastro documental: nome, apelido,
 * contratante, datas. Aqui é o instrumento que governa SLA, escopo, preço e
 * medição — e é o que sustenta a conversa de renovação.
 *
 * A diferença prática: lá, quando o cliente pergunta "o que eu paguei e o que
 * eu recebi neste mês", a resposta é montada à mão numa planilha, com números
 * que ninguém consegue reproduzir três meses depois. Aqui a medição é derivada
 * dos mesmos fatos que operaram o mês — OS, horas, peças, relógios de SLA — e
 * fechada num período imutável.
 *
 * Este arquivo é aritmética pura: nada aqui toca banco.
 */

export const CONTRACT_KINDS = [
  'full_service',
  'preventive_only',
  'on_demand',
  'rental',
  'loan',
  'warranty',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  full_service: 'Full service',
  preventive_only: 'Somente preventiva',
  on_demand: 'Sob demanda',
  rental: 'Locação',
  loan: 'Comodato',
  warranty: 'Garantia',
};

/**
 * O PERFIL é a classificação do contrato — e a única (confirmado pelo cliente).
 *
 * `kind` acima é a natureza do acordo (locação, comodato, garantia…), opcional
 * desde a 0060; "sob demanda" ou "preventiva" nunca foram tipo de contrato.
 * O que cada perfil libera (indicadores, SLA, relatórios) é NS-008 e ainda não
 * existe: aqui o perfil só classifica.
 */
export const CONTRACT_PROFILES = ['basic', 'complete', 'expert'] as const;
export type ContractProfile = (typeof CONTRACT_PROFILES)[number];

export const CONTRACT_PROFILE_LABELS: Record<ContractProfile, string> = {
  basic: 'Básico',
  complete: 'Completo',
  expert: 'Expert',
};

/**
 * Situações em que o contrato ainda é "o contrato do cliente".
 *
 * O rascunho conta: é o contrato declarado no cadastro do cliente e que ainda
 * espera cobertura e datas. Expirado e encerrado não contam — o cliente deixou
 * de ter contrato, e dizer o contrário esconderia uma renovação perdida.
 */
export const CURRENT_CONTRACT_STATUSES = ['active', 'suspended', 'draft'] as const;

export const BILLING_MODELS = ['fixed_monthly', 'per_asset', 'per_call', 'hybrid'] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const CONTRACT_STATUSES = ['draft', 'active', 'suspended', 'expired', 'terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const COVERAGE_KINDS = ['customer', 'location_subtree', 'asset_category', 'asset'] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

/* -------------------------------------------------------------------------- */
/* vigência                                                                    */
/* -------------------------------------------------------------------------- */

/** Um dia, em ISO `YYYY-MM-DD`. Contrato é assunto de data, não de instante. */
export type IsoDate = string;

const DAY = 86_400_000;

function dayNumber(iso: IsoDate): number {
  const [a, m, d] = iso.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    throw new RangeError(`data inválida: ${iso}`);
  }
  return Date.UTC(a, m - 1, d) / DAY;
}

/** Dias entre duas datas, positivo quando `to` é posterior. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export interface DateRange {
  readonly startsOn: IsoDate;
  /** `null` é vigência aberta — comum em comodato e em garantia de fabricante. */
  readonly endsOn: IsoDate | null;
}

/**
 * Duas vigências se sobrepõem?
 *
 * Os extremos são inclusivos: um contrato que termina em 31/12 e outro que
 * começa em 31/12 disputam aquele dia. Tratar o fim como exclusivo pareceria
 * mais limpo e deixaria passar exatamente o caso que a regra existe para pegar
 * — a virada de contrato, que é quando a dúvida sobre quem responde pelo ativo
 * de fato acontece.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aFim = a.endsOn === null ? Infinity : dayNumber(a.endsOn);
  const bFim = b.endsOn === null ? Infinity : dayNumber(b.endsOn);
  return dayNumber(a.startsOn) <= bFim && dayNumber(b.startsOn) <= aFim;
}

export function coversDate(range: DateRange, on: IsoDate): boolean {
  const dia = dayNumber(on);
  return dia >= dayNumber(range.startsOn) && (range.endsOn === null || dia <= dayNumber(range.endsOn));
}

/**
 * Situação efetiva numa data.
 *
 * `draft`, `suspended` e `terminated` são decisões humanas e valem sobre
 * qualquer cálculo de calendário. `expired` não é decisão: é consequência de a
 * data ter passado, e por isso é derivada aqui em vez de depender de alguém
 * rodar a varredura. Contrato que só expira quando o cron roda é contrato que
 * continua cobrindo ativo depois de vencido sempre que o cron falha.
 */
export function contractStatusOn(stored: ContractStatus, range: DateRange, on: IsoDate): ContractStatus {
  if (stored === 'draft' || stored === 'suspended' || stored === 'terminated') return stored;
  if (range.endsOn !== null && daysBetween(range.endsOn, on) > 0) return 'expired';
  if (daysBetween(range.startsOn, on) < 0) return 'draft';
  return 'active';
}

/* -------------------------------------------------------------------------- */
/* especificidade da cobertura                                                 */
/* -------------------------------------------------------------------------- */

export interface CoverageFacts {
  readonly kind: CoverageKind;
  /** Restringe a categoria dentro de uma subárvore. */
  readonly hasCategoryFilter: boolean;
  /** Profundidade do local raiz, quando a cobertura é por subárvore. */
  readonly depth: number;
}

/**
 * Quanto uma cobertura é específica — quanto maior, mais deliberada.
 *
 * Por que isto existe. A cobertura é uma EXPRESSÃO ("todos os ativos da UTI"),
 * não uma lista de caixas marcadas, e isso é proposital: o ventilador que
 * chegar amanhã entra no contrato sozinho. O preço disso é que dois contratos
 * podem passar a disputar o mesmo ativo sem ninguém ter feito nada — basta o
 * ativo novo casar com as duas expressões.
 *
 * A validação de sobreposição na escrita (§17: "um ativo em um contrato por vez
 * numa dada data") pega o conflito entre os ativos que existem AGORA. Não pega,
 * e não tem como pegar, o conflito que nasce depois. Então o desempate precisa
 * ser determinístico, e a regra é: vence quem nomeia mais de perto. Um contrato
 * que cita o ativo pelo nome é declaração mais forte do que um que cobre o
 * cliente inteiro.
 *
 * A alternativa — devolver os dois e deixar a aplicação escolher — significaria
 * que a política de SLA de uma OS dependeria da ordem de leitura do banco. Isso
 * é pior do que uma regra discutível: é uma regra invisível.
 */
export function coverageSpecificity(coverage: CoverageFacts): number {
  switch (coverage.kind) {
    case 'asset':
      return 1000;
    case 'location_subtree':
      // A profundidade entra aqui porque "UTI 3º andar" é mais específico que
      // "Hospital", e as duas são a mesma espécie de expressão.
      return 500 + coverage.depth * 10 + (coverage.hasCategoryFilter ? 5 : 0);
    case 'asset_category':
      return 300;
    case 'customer':
      return 100;
  }
}

/* -------------------------------------------------------------------------- */
/* renovação                                                                   */
/* -------------------------------------------------------------------------- */

export const RENEWAL_THRESHOLDS = [90, 60, 30] as const;
export type RenewalThreshold = (typeof RENEWAL_THRESHOLDS)[number];

export interface RenewalAlert {
  /** Qual marco foi cruzado — o mais próximo ainda não avisado. */
  readonly threshold: RenewalThreshold;
  readonly daysToEnd: number;
  /**
   * Já passou o prazo de aviso prévio para NÃO renovar?
   *
   * Este é o campo que muda a conversa. Num contrato com renovação automática e
   * 60 dias de aviso prévio, faltando 45 dias para o fim a decisão já foi
   * tomada por omissão: renovou. Avisar "vence em 30 dias" sem dizer isso
   * convida o coordenador a uma negociação que ele já perdeu.
   */
  readonly noticeWindowClosed: boolean;
}

export interface RenewalFacts extends DateRange {
  readonly autoRenew: boolean;
  readonly renewalNoticeDays: number;
}

/**
 * O alerta de renovação devido hoje, se houver.
 *
 * Devolve o marco mais próximo já cruzado — 90, 60 ou 30 — para quem chama
 * comparar com o último marco notificado e decidir se emite. Manter essa
 * comparação fora daqui é o que permite reprocessar a varredura sem inundar
 * ninguém de e-mail repetido.
 */
export function renewalAlert(facts: RenewalFacts, today: IsoDate): RenewalAlert | null {
  if (facts.endsOn === null) return null;

  const faltam = daysBetween(today, facts.endsOn);
  if (faltam < 0) return null;

  // O marco é o MENOR que ainda comporta o prazo restante, não o primeiro da
  // lista. Com `find` numa lista descendente, faltando 56 dias o resultado
  // seria 90 — e como quem chama só emite marco mais próximo que o último
  // emitido, o contrato avisaria uma vez, aos 90 dias, e nunca mais. O aviso
  // dos 30 dias, que é o que faz alguém agir, jamais sairia.
  const marco = [...RENEWAL_THRESHOLDS].reverse().find((t) => faltam <= t);
  if (marco === undefined) return null;

  return {
    threshold: marco,
    daysToEnd: faltam,
    noticeWindowClosed: facts.autoRenew && faltam < facts.renewalNoticeDays,
  };
}

/** A data-limite para comunicar a não renovação. `null` quando não se aplica. */
export function noticeDeadline(facts: RenewalFacts): IsoDate | null {
  if (facts.endsOn === null || !facts.autoRenew) return null;
  const limite = new Date((dayNumber(facts.endsOn) - facts.renewalNoticeDays) * DAY);
  return limite.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* franquia e excedente                                                        */
/* -------------------------------------------------------------------------- */

export interface FranchiseState {
  readonly included: number;
  readonly used: number;
  readonly remaining: number;
  readonly ratio: number;
  /** ≥ 80 % consumido — o alerta que a SPEC pede (§17). */
  readonly warning: boolean;
  readonly exceeded: boolean;
}

/**
 * Consumo de uma franquia (N chamados ou N horas por período).
 *
 * O alerta em 80 % existe para o excedente não ser descoberto na fatura. Quem
 * descobre na fatura discute a fatura; quem soube no dia 20 decide se autoriza
 * o chamado extra — e essa é a diferença entre o contrato ser um instrumento de
 * gestão e ser um documento que alguém arquiva.
 */
export function franchiseState(included: number | null, used: number): FranchiseState | null {
  if (included === null || included <= 0) return null;

  const ratio = used / included;
  return {
    included,
    used,
    remaining: Math.max(included - used, 0),
    ratio: Number(ratio.toFixed(4)),
    warning: ratio >= 0.8,
    exceeded: used > included,
  };
}

/**
 * O excedente a faturar.
 *
 * Só o que passou da franquia é cobrado — a franquia já está no valor fixo, e
 * cobrar tudo de novo seria cobrar duas vezes pela mesma hora.
 */
export function overageAmount(included: number | null, used: number, unitRate: number | null): number {
  if (unitRate === null || unitRate <= 0) return 0;
  const excedente = Math.max(used - (included ?? 0), 0);
  return Number((excedente * unitRate).toFixed(2));
}

/* -------------------------------------------------------------------------- */
/* glosa                                                                       */
/* -------------------------------------------------------------------------- */

export interface PenaltyRule {
  /** Percentual do valor do período por SLA violado. Configurado, nunca suposto. */
  readonly percentPerBreach: number | null;
  /** Teto do desconto no período, em percentual. */
  readonly capPercent: number | null;
}

export interface PenaltyCalculation {
  readonly breaches: number;
  readonly percentApplied: number;
  readonly amount: number;
  readonly cappedAt: number | null;
  /** Sempre `false`: o cálculo é registrado, a aplicação é decisão humana. */
  readonly applied: false;
}

/**
 * A glosa por SLA violado — calculada, registrada, nunca aplicada sozinha.
 *
 * Duas decisões deliberadas aqui.
 *
 * A PRIMEIRA é não haver fórmula padrão. A auditoria não confirmou nenhuma
 * regra de glosa na referência, e inventar uma seria escrever no sistema uma
 * cláusula que não está em contrato nenhum — o tipo de número que vira
 * discussão jurídica com o cliente. Sem `percentPerBreach` configurado, esta
 * função devolve `null`, e a medição do período mostra os SLA violados sem
 * atribuir valor a eles.
 *
 * A SEGUNDA é `applied: false` ser do tipo, não um valor. Desconto em fatura de
 * cliente é ato comercial: alguém assina embaixo. O sistema calcula e apresenta;
 * quem decide aplicar é gente, e o dia em que isso mudar vai ser por decisão
 * explícita, não porque um `boolean` virou `true` sem ninguém notar.
 */
export function penaltyForBreaches(
  rule: PenaltyRule,
  breaches: number,
  periodAmount: number
): PenaltyCalculation | null {
  if (rule.percentPerBreach === null || rule.percentPerBreach <= 0) return null;
  if (breaches <= 0) {
    return { breaches: 0, percentApplied: 0, amount: 0, cappedAt: rule.capPercent, applied: false };
  }

  const bruto = breaches * rule.percentPerBreach;
  const percentual = rule.capPercent === null ? bruto : Math.min(bruto, rule.capPercent);

  return {
    breaches,
    percentApplied: Number(percentual.toFixed(4)),
    amount: Number(((periodAmount * percentual) / 100).toFixed(2)),
    cappedAt: rule.capPercent,
    applied: false,
  };
}

/* -------------------------------------------------------------------------- */
/* período de medição                                                          */
/* -------------------------------------------------------------------------- */

/** Primeiro e último dia do mês de competência (`YYYY-MM`). */
export function periodBounds(period: string): { startsOn: IsoDate; endsOn: IsoDate } {
  const casa = /^(\d{4})-(\d{2})$/.exec(period);
  if (!casa) throw new RangeError(`competência inválida: ${period}`);

  const ano = Number(casa[1]);
  const mes = Number(casa[2]);
  if (mes < 1 || mes > 12) throw new RangeError(`competência inválida: ${period}`);

  const fim = new Date(Date.UTC(ano, mes, 0));
  return { startsOn: `${period}-01`, endsOn: fim.toISOString().slice(0, 10) };
}

export interface MeasurementFacts {
  readonly workOrders: number;
  readonly laborMinutes: number;
  readonly partsCost: number;
  readonly slaTotal: number;
  readonly slaMet: number;
  readonly planExpected: number;
  readonly planDone: number;
}

export interface MeasurementSummary extends MeasurementFacts {
  readonly laborHours: number;
  /** `null` quando não houve relógio no período — denominador honesto (§11). */
  readonly slaRate: number | null;
  readonly slaBreaches: number;
  readonly planCompliance: number | null;
}

/**
 * O resumo do período.
 *
 * Taxas com denominador zero devolvem `null`, e não 100 %. Um mês sem nenhuma
 * OS com SLA não é um mês de SLA perfeito, e apresentá-lo como tal é a maneira
 * mais rápida de fazer o cliente perder a confiança no relatório inteiro — ele
 * conhece o próprio mês.
 */
export function summarizeMeasurement(facts: MeasurementFacts): MeasurementSummary {
  const denominadorPlano = facts.planExpected;
  return {
    ...facts,
    laborHours: Number((facts.laborMinutes / 60).toFixed(2)),
    slaRate: facts.slaTotal > 0 ? Number(((facts.slaMet / facts.slaTotal) * 100).toFixed(1)) : null,
    slaBreaches: Math.max(facts.slaTotal - facts.slaMet, 0),
    planCompliance:
      denominadorPlano > 0 ? Number(((facts.planDone / denominadorPlano) * 100).toFixed(1)) : null,
  };
}
