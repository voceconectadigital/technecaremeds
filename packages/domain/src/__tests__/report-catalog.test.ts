/**
 * Aurora — catálogo central de indicadores, metas e razão percentual
 * (relatórios Basic / Advanced / Expert, Fase 1 — auditoria de 17/10/2026).
 *
 * O que esta suíte trava: que o catálogo é a fonte única e coerente, que o
 * Expert não herda o Basic por engano, que nada bloqueado pela auditoria ganhou
 * fórmula escondida, e que a escolha da meta segue contrato → cliente →
 * organização com vigência e sem inventar zero.
 */
import { describe, it, expect } from 'vitest';
import {
  REPORT_INDICATORS,
  REPORT_TIERS,
  defaultIndicatorsForTier,
  findIndicator,
  indicatorsForTier,
  isReportable,
  legacyStatusOf,
  NO_TARGET_LABEL,
  checkTargetAgainstCatalog,
  evaluateTarget,
  ratioPercent,
  resolveTarget,
  targetInForce,
  targetScopeOf,
  targetTimeline,
  type IndicatorTarget,
} from '../index';

/* -------------------------------------------------------------------------- */
/* catálogo                                                                    */
/* -------------------------------------------------------------------------- */

describe('catálogo de indicadores', () => {
  it('códigos estáveis, únicos e em snake_case', () => {
    const chaves = REPORT_INDICATORS.map((i) => i.key);
    expect(new Set(chaves).size).toBe(chaves.length);
    chaves.forEach((k) => expect(k).toMatch(/^[a-z][a-z0-9_]+$/));
  });

  it('todo indicador declara nome, descrição, unidade, categoria, modelos, situação e sentido', () => {
    for (const i of REPORT_INDICATORS) {
      expect(i.label.length, i.key).toBeGreaterThanOrEqual(3);
      expect(i.description.length, i.key).toBeGreaterThan(10);
      expect(i.tiers.length, i.key).toBeGreaterThan(0);
      i.tiers.forEach((t) => expect(REPORT_TIERS).toContain(t));
      expect(['ACTIVE', 'PROVISIONAL', 'PENDING_DEFINITION']).toContain(i.state);
      expect(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'INFORMATIONAL']).toContain(i.targetDirection);
    }
  });

  it('só indicador com cálculo é ACTIVE/PROVISIONAL; pendente não tem fonte e diz o que falta', () => {
    for (const i of REPORT_INDICATORS) {
      if (i.state === 'PENDING_DEFINITION') {
        expect(i.source, `${i.key} pendente não pode ter fonte de cálculo`).toBeNull();
        expect(i.pendingKind, i.key).toBeDefined();
        expect(i.note, i.key).toBeTruthy();
      } else {
        expect(i.source, `${i.key} precisa de fonte de cálculo`).not.toBeNull();
      }
    }
  });

  it('o que a auditoria deixou bloqueado continua PENDING_DEFINITION', () => {
    const bloqueados = [
      'requests_fulfilled_ratio', // ICRS: população não confirmada (P-04)
      'training_ratio', // ITRS: sem vínculo solicitado → realizado
      'first_response_time', // TMPA (P-03)
      'availability_internal',
      'availability_external',
      'availability_global',
      'tmrg_internal',
      'tmrg_external',
      'tmrg_global',
      'critical_resolution_internal',
      'critical_resolution_external',
      'critical_resolution_global',
      'quality_activities_on_time',
      'attendance',
      'imr_penalty', // glosa (P-14)
      'obsolescence', // P-16
    ];
    for (const k of bloqueados) {
      const i = findIndicator(k);
      expect(i, k).toBeDefined();
      expect(i!.state, k).toBe('PENDING_DEFINITION');
      expect(isReportable(i!), k).toBe(false);
    }
  });

  it('MTTR, MTBF e ACM seguem PROVISIONAL: o sistema calcula, o cliente não confirmou', () => {
    expect(findIndicator('mttr')!.state).toBe('PROVISIONAL');
    expect(findIndicator('mtbf')!.state).toBe('PROVISIONAL');
    expect(findIndicator('compliance_preventive')!.state).toBe('PROVISIONAL');
  });

  it('avaliação da qualidade e AxF são indicadores ACTIVE e distintos do ICRS', () => {
    expect(findIndicator('service_rating')!.state).toBe('ACTIVE');
    const axf = findIndicator('opened_vs_closed')!;
    expect(axf.state).toBe('ACTIVE');
    expect(axf.label).toBe('Chamados Abertos x Encerrados');
    expect(axf.key).not.toBe('requests_fulfilled_ratio');
  });

  it('legado: PENDING_DEFINITION → awaiting_definition; o resto → available', () => {
    expect(legacyStatusOf('PENDING_DEFINITION')).toBe('awaiting_definition');
    expect(legacyStatusOf('ACTIVE')).toBe('available');
    expect(legacyStatusOf('PROVISIONAL')).toBe('available');
  });
});

describe('modelos Basic / Advanced / Expert respeitam o catálogo', () => {
  it('Basic traz os da reunião e do PDF Basic, e nada que seja só do Advanced', () => {
    const chaves = indicatorsForTier('basic').map((i) => i.key);
    for (const k of [
      'work_orders_opened',
      'work_orders_completed',
      'compliance_preventive',
      'compliance_calibration',
      'compliance_electrical_safety',
      'compliance_qualification',
      'service_rating',
      'mttr',
      'mtbf',
    ]) {
      expect(chaves, k).toContain(k);
    }
    for (const k of [
      'sla_compliance',
      'backlog',
      'work_order_evolution',
      'work_orders_by_status',
      'opened_vs_closed',
    ]) {
      expect(chaves, k).not.toContain(k);
    }
  });

  it('Advanced herda o Basic seguro e acrescenta SLA, evolução, backlog, OS por situação e AxF', () => {
    const chaves = indicatorsForTier('advanced').map((i) => i.key);
    for (const k of [
      'work_orders_opened',
      'compliance_preventive',
      'service_rating',
      'sla_compliance',
      'work_order_evolution',
      'backlog',
      'work_orders_by_status',
      'opened_vs_closed',
    ]) {
      expect(chaves, k).toContain(k);
    }
  });

  it('Expert NÃO herda o Basic nem o Advanced: o conjunto é o contratual (IMR)', () => {
    const expert = indicatorsForTier('expert').map((i) => i.key);
    for (const k of [
      'mttr',
      'mtbf',
      'work_orders_opened',
      'work_orders_completed',
      'compliance_calibration',
      'compliance_electrical_safety',
      'compliance_qualification',
      'sla_compliance',
      'backlog',
      'park_availability_snapshot',
    ]) {
      expect(expert, `${k} não é do IMR`).not.toContain(k);
    }
    // os 16 itens do IMR: 1 TMPA + 9 (disp./TMRG/crítica × I/E/G) + ICRS + qualidade + MP + treinamento + avaliação + assiduidade
    expect(expert).toEqual(
      expect.arrayContaining([
        'first_response_time',
        'availability_internal',
        'availability_external',
        'availability_global',
        'tmrg_internal',
        'tmrg_external',
        'tmrg_global',
        'critical_resolution_internal',
        'critical_resolution_external',
        'critical_resolution_global',
        'requests_fulfilled_ratio',
        'quality_activities_on_time',
        'compliance_preventive',
        'training_ratio',
        'service_rating',
        'attendance',
      ])
    );
  });

  it('sem seleção, só entram ACTIVE; PROVISIONAL e pendente ficam de fora', () => {
    for (const t of REPORT_TIERS) {
      defaultIndicatorsForTier(t).forEach((i) => expect(i.state, `${t}/${i.key}`).toBe('ACTIVE'));
    }
    const basicPadrao = defaultIndicatorsForTier('basic').map((i) => i.key);
    expect(basicPadrao).not.toContain('mttr');
    expect(basicPadrao).toContain('work_orders_opened');
    expect(basicPadrao).toContain('service_rating');
  });

  it('as conformidades continuam separadas (nada agrega MP+CAL+TSE)', () => {
    const conf = REPORT_INDICATORS.filter((i) => i.key.startsWith('compliance_')).map((i) => i.key);
    expect(conf.sort()).toEqual([
      'compliance_calibration',
      'compliance_electrical_safety',
      'compliance_preventive',
      'compliance_qualification',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* razão percentual (AxF)                                                      */
/* -------------------------------------------------------------------------- */

describe('razão percentual', () => {
  it('abaixo de 100 %', () => {
    const r = ratioPercent(97, 100);
    expect(r.percent).toBe(97);
    expect(r.numerator).toBe(97);
    expect(r.denominator).toBe(100);
  });

  it('exatamente 100 %', () => {
    expect(ratioPercent(23, 23).percent).toBe(100);
  });

  it('acima de 100 % (o modelo Advanced mostra 117 % e 125 %)', () => {
    expect(ratioPercent(125, 100).percent).toBe(125);
    expect(ratioPercent(35, 30).percent).toBe(116.67);
  });

  it('a razão comprovada do Data Studio: 1.713 ÷ 1.967 = 87,09 %', () => {
    expect(ratioPercent(1713, 1967).percent).toBe(87.09);
    expect(ratioPercent(1699, 1741).percent).toBe(97.59);
  });

  it('denominador zero é sem dado, e não 100 % nem 0 % (o PDF Basic mostra 100 % para 0 ÷ 0)', () => {
    expect(ratioPercent(0, 0).percent).toBeNull();
    expect(ratioPercent(5, 0).percent).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* metas                                                                       */
/* -------------------------------------------------------------------------- */

const CLIENTE_A = 'a0000000-0000-4000-8000-000000000001';
const CLIENTE_B = 'b0000000-0000-4000-8000-000000000002';
const CONTRATO_A = 'c0000000-0000-4000-8000-000000000003';

let n = 0;
function meta(p: Partial<IndicatorTarget> & { value: number }): IndicatorTarget {
  return {
    id: `m-${++n}`,
    indicatorKey: 'sla_compliance',
    customerId: null,
    contractId: null,
    validFrom: '2026-01-01',
    validTo: null,
    unit: 'percent',
    direction: 'HIGHER_IS_BETTER',
    ...p,
  };
}

describe('escolha da meta', () => {
  const org = meta({ value: 90 });
  const cliente = meta({ value: 95, customerId: CLIENTE_A });
  const contrato = meta({ value: 98, customerId: CLIENTE_A, contractId: CONTRATO_A });
  const todas = [org, cliente, contrato];

  it('o escopo da meta vem dos campos', () => {
    expect(targetScopeOf(org)).toBe('organization');
    expect(targetScopeOf(cliente)).toBe('customer');
    expect(targetScopeOf(contrato)).toBe('contract');
  });

  it('meta por organização vale quando não há nada mais específico', () => {
    const r = resolveTarget(todas, { indicatorKey: 'sla_compliance', on: '2026-09-30' });
    expect(r?.scope).toBe('organization');
    expect(r?.target.value).toBe(90);
  });

  it('override por cliente vence a organização', () => {
    const r = resolveTarget(todas, {
      indicatorKey: 'sla_compliance',
      customerId: CLIENTE_A,
      on: '2026-09-30',
    });
    expect(r?.scope).toBe('customer');
    expect(r?.target.value).toBe(95);
  });

  it('override por contrato vence o cliente e a organização', () => {
    const r = resolveTarget(todas, {
      indicatorKey: 'sla_compliance',
      customerId: CLIENTE_A,
      contractId: CONTRATO_A,
      on: '2026-09-30',
    });
    expect(r?.scope).toBe('contract');
    expect(r?.target.value).toBe(98);
  });

  it('meta de OUTRO cliente nunca vaza para este contexto', () => {
    const r = resolveTarget(todas, {
      indicatorKey: 'sla_compliance',
      customerId: CLIENTE_B,
      on: '2026-09-30',
    });
    expect(r?.scope).toBe('organization');
    expect(r?.target.value).toBe(90);
  });

  it('contexto sem contrato não pega meta de contrato', () => {
    const so = [contrato];
    expect(
      resolveTarget(so, { indicatorKey: 'sla_compliance', customerId: CLIENTE_A, on: '2026-09-30' })
    ).toBeNull();
  });

  it('vigência: antes do início e depois do fim a meta não vale; as pontas são inclusivas', () => {
    const m = meta({ value: 80, validFrom: '2026-03-01', validTo: '2026-03-31' });
    const ctx = (on: string) => resolveTarget([m], { indicatorKey: 'sla_compliance', on });
    expect(ctx('2026-02-28')).toBeNull();
    expect(ctx('2026-03-01')?.target.value).toBe(80);
    expect(ctx('2026-03-31')?.target.value).toBe(80);
    expect(ctx('2026-04-01')).toBeNull();
    expect(targetInForce(m, '2026-03-15')).toBe(true);
  });

  it('vigência futura convive com a atual: cada dia pega a sua', () => {
    const atual = meta({ value: 90, validFrom: '2026-01-01', validTo: '2026-06-30' });
    const futura = meta({ value: 95, validFrom: '2026-07-01' });
    const em = (on: string) =>
      resolveTarget([atual, futura], { indicatorKey: 'sla_compliance', on })?.target.value;
    expect(em('2026-06-30')).toBe(90);
    expect(em('2026-07-01')).toBe(95);
  });

  it('linha do tempo: futura, em vigor e expirada', () => {
    expect(targetTimeline({ validFrom: '2026-11-01', validTo: null }, '2026-10-17')).toBe('future');
    expect(targetTimeline({ validFrom: '2026-01-01', validTo: null }, '2026-10-17')).toBe('active');
    expect(targetTimeline({ validFrom: '2026-01-01', validTo: '2026-09-30' }, '2026-10-17')).toBe('expired');
  });

  it('SEM META CONFIGURADA: nenhuma vigente → nulo, e a avaliação diz "sem meta", nunca zero', () => {
    const r = resolveTarget([], { indicatorKey: 'sla_compliance', on: '2026-09-30' });
    expect(r).toBeNull();
    expect(NO_TARGET_LABEL).toBe('SEM META CONFIGURADA');
    expect(evaluateTarget(97, null, 'HIGHER_IS_BETTER')).toBe('no_target');
  });

  it('meta de outro indicador não se aplica', () => {
    const outro = meta({ value: 50, indicatorKey: 'backlog' });
    expect(resolveTarget([outro], { indicatorKey: 'sla_compliance', on: '2026-09-30' })).toBeNull();
  });
});

describe('avaliação contra a meta', () => {
  const maior = { value: 95, direction: 'HIGHER_IS_BETTER' as const };
  const menor = { value: 72, direction: 'LOWER_IS_BETTER' as const };

  it('≥ cumpre na igualdade e acima; ≤ cumpre na igualdade e abaixo', () => {
    expect(evaluateTarget(95, maior, 'HIGHER_IS_BETTER')).toBe('met');
    expect(evaluateTarget(94.9, maior, 'HIGHER_IS_BETTER')).toBe('not_met');
    expect(evaluateTarget(72, menor, 'LOWER_IS_BETTER')).toBe('met');
    expect(evaluateTarget(73, menor, 'LOWER_IS_BETTER')).toBe('not_met');
  });

  it('sem valor não é "não cumpriu"', () => {
    expect(evaluateTarget(null, maior, 'HIGHER_IS_BETTER')).toBe('no_value');
  });

  it('indicador informativo não tem avaliação', () => {
    expect(evaluateTarget(10, null, 'INFORMATIONAL')).toBe('informational');
  });
});

describe('meta confere com o catálogo', () => {
  it('aceita sentido e unidade do indicador', () => {
    const ck = checkTargetAgainstCatalog('sla_compliance', 'HIGHER_IS_BETTER', 'percent');
    expect(ck.ok).toBe(true);
    expect(ck.unit).toBe('percent');
  });

  it('recusa sentido contrário ao do indicador', () => {
    expect(checkTargetAgainstCatalog('sla_compliance', 'LOWER_IS_BETTER').ok).toBe(false);
    expect(checkTargetAgainstCatalog('mttr', 'HIGHER_IS_BETTER').ok).toBe(false);
  });

  it('recusa unidade diferente da do indicador', () => {
    expect(checkTargetAgainstCatalog('mttr', 'LOWER_IS_BETTER', 'percent').ok).toBe(false);
    expect(checkTargetAgainstCatalog('mttr', 'LOWER_IS_BETTER', 'minutes').ok).toBe(true);
  });

  it('recusa indicador informativo e desconhecido', () => {
    expect(checkTargetAgainstCatalog('work_orders_opened', 'HIGHER_IS_BETTER').ok).toBe(false);
    expect(checkTargetAgainstCatalog('inventado', 'HIGHER_IS_BETTER').ok).toBe(false);
  });

  it('indicador pendente aceita meta configurada antes da fórmula (a meta é dado do contrato)', () => {
    expect(checkTargetAgainstCatalog('availability_global', 'HIGHER_IS_BETTER', 'percent').ok).toBe(true);
  });
});
