/**
 * Aurora — metas dos indicadores (auditoria 17/10/2026, §13; migration 0069).
 *
 * Persistência e regras de acesso. A ESCOLHA da meta (contrato → cliente →
 * organização, vigência, sem meta) e a leitura contra o valor são funções puras
 * do domínio (`resolveTarget`, `evaluateTarget`): o Painel, o relatório e a
 * automação chamam as mesmas.
 *
 * ESCOPO DE QUEM PERGUNTA
 *
 *   · leitura: a meta da organização é de todos; a meta de cliente/contrato só
 *     aparece para quem alcança o cliente. Fora da borda é 404, não 403;
 *   · escrita: meta de cliente/contrato exige o cliente no escopo; meta da
 *     ORGANIZAÇÃO inteira exige escopo sobre todos os clientes — quem enxerga só
 *     o Hospital A não muda o número que vale para o Hospital B.
 *
 * A permissão (`insight.manage_targets`) é conferida na rota; aqui entra o que a
 * rota não vê.
 */
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  checkTargetAgainstCatalog,
  newId,
  targetScopeOf,
  targetTimeline,
  dayOf,
  safeTimezone,
  type IndicatorTarget,
  type StoredDirection,
  type TargetScope,
  type TargetTimeline,
  type TargetUnit,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { assertCustomerInScope, type MembershipScope } from './painel';

export interface IndicatorTargetView extends IndicatorTarget {
  readonly scope: TargetScope;
  readonly timeline: TargetTimeline;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Linha {
  id: string;
  indicator_key: string;
  customer_id: string | null;
  contract_id: string | null;
  valid_from: string;
  valid_to: string | null;
  target_value: string;
  unit: string;
  direction: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUNAS = `id, indicator_key, customer_id, contract_id, valid_from::text AS valid_from,
       valid_to::text AS valid_to, target_value::text AS target_value, unit, direction, note,
       created_at, updated_at`;

function mapear(r: Linha, hoje: string): IndicatorTargetView {
  const base: IndicatorTarget = {
    id: r.id,
    indicatorKey: r.indicator_key,
    customerId: r.customer_id,
    contractId: r.contract_id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    value: Number(r.target_value),
    unit: r.unit as TargetUnit,
    direction: r.direction as StoredDirection,
  };
  return {
    ...base,
    scope: targetScopeOf(base),
    timeline: targetTimeline(base, hoje),
    note: r.note,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Fragmento de `WHERE`: o que o escopo enxerga (organização + clientes alcançados). */
function visivel(scope: MembershipScope, from: number): { sql: string; params: unknown[] } {
  return {
    sql: `(customer_id IS NULL OR $${from}::uuid[] IS NULL OR customer_id = ANY($${from}::uuid[]))`,
    params: [scope.customerIds ? [...scope.customerIds] : null],
  };
}

/**
 * O fuso da organização da sessão (`organizations.timezone`, padrão
 * `America/Sao_Paulo`). O DIA de referência das metas, os períodos prontos do
 * relatório e o mês anterior agendado são dias do calendário LOCAL — e não de
 * UTC, que em Brasília vira "amanhã" às 21 h (pente-fino 17/10/2026, PF-51).
 * Fuso inválido gravado na tabela cai no padrão, nunca derruba o relatório.
 */
export async function organizationTimezone(session: TenantSession): Promise<string> {
  const [org] = await session.query<{ timezone: string | null }>(
    `SELECT timezone FROM aurora.organizations WHERE id = $1`,
    [session.context.organizationId]
  );
  return safeTimezone(org?.timezone);
}

async function hojeNaOrganizacao(session: TenantSession): Promise<string> {
  return dayOf(new Date(), await organizationTimezone(session));
}

export interface TargetFilters {
  indicatorKey?: string;
  customerId?: string;
  contractId?: string;
}

export async function listIndicatorTargets(
  session: TenantSession,
  scope: MembershipScope,
  f: TargetFilters = {},
  hoje?: string
): Promise<IndicatorTargetView[]> {
  const v = visivel(scope, 4);
  const rows = await session.query<Linha>(
    `SELECT ${COLUNAS} FROM aurora.indicator_targets
      WHERE deleted_at IS NULL
        AND ($1::text IS NULL OR indicator_key = $1)
        AND ($2::uuid IS NULL OR customer_id = $2)
        AND ($3::uuid IS NULL OR contract_id = $3)
        AND ${v.sql}
      ORDER BY indicator_key, customer_id NULLS FIRST, contract_id NULLS FIRST, valid_from DESC`,
    [f.indicatorKey ?? null, f.customerId ?? null, f.contractId ?? null, ...v.params]
  );
  const dia = hoje ?? (await hojeNaOrganizacao(session));
  return rows.map((r) => mapear(r, dia));
}

/** As metas que o escopo enxerga, no formato que o resolvedor do domínio consome. */
export async function loadVisibleTargets(
  session: TenantSession,
  scope: MembershipScope,
  indicatorKeys?: readonly string[]
): Promise<IndicatorTarget[]> {
  const v = visivel(scope, 2);
  const rows = await session.query<Linha>(
    `SELECT ${COLUNAS} FROM aurora.indicator_targets
      WHERE deleted_at IS NULL
        AND ($1::text[] IS NULL OR indicator_key = ANY($1::text[]))
        AND ${v.sql}`,
    [indicatorKeys ? [...indicatorKeys] : null, ...v.params]
  );
  const hoje = await hojeNaOrganizacao(session);
  return rows.map((r) => mapear(r, hoje));
}

export interface TargetInput {
  indicatorKey: string;
  customerId?: string | null;
  contractId?: string | null;
  validFrom: string;
  validTo?: string | null;
  value: number;
  direction: StoredDirection;
  unit?: string;
  note?: string | null;
}

async function conferirEscopoDeEscrita(
  session: TenantSession,
  scope: MembershipScope,
  customerId: string | null,
  contractId: string | null
): Promise<string | null> {
  if (customerId) {
    await assertCustomerInScope(session, scope, customerId);
  } else if (scope.customerIds !== null) {
    throw new ForbiddenError(
      'insight.manage_targets — a meta da organização inteira exige acesso a todos os clientes'
    );
  }
  if (contractId) {
    const [c] = await session.query<{ customer_id: string }>(
      `SELECT customer_id FROM aurora.contracts WHERE id = $1`,
      [contractId]
    );
    if (!c || c.customer_id !== customerId) throw new NotFoundError('contrato', contractId);
  }
  return customerId;
}

function validarCorpo(i: TargetInput): TargetUnit {
  const ck = checkTargetAgainstCatalog(i.indicatorKey, i.direction, i.unit);
  if (!ck.ok) throw new ValidationError(ck.reason ?? 'meta inválida', { field: 'indicator_key' });
  if (i.contractId && !i.customerId) {
    throw new ValidationError('a meta de contrato precisa informar o cliente do contrato', {
      field: 'customer_id',
    });
  }
  if (!Number.isFinite(i.value) || i.value < 0) {
    throw new ValidationError('o valor da meta não pode ser negativo', { field: 'value' });
  }
  if (i.validTo && i.validTo < i.validFrom) {
    throw new ValidationError('a vigência termina antes de começar', { field: 'valid_to' });
  }
  return ck.unit!;
}

export async function createIndicatorTarget(
  session: TenantSession,
  scope: MembershipScope,
  input: TargetInput
): Promise<IndicatorTargetView> {
  const unit = validarCorpo(input);
  const customerId = input.customerId ?? null;
  const contractId = input.contractId ?? null;
  await conferirEscopoDeEscrita(session, scope, customerId, contractId);

  const id = newId();
  const [row] = await session.query<Linha>(
    `INSERT INTO aurora.indicator_targets
       (id, organization_id, indicator_key, customer_id, contract_id, valid_from, valid_to,
        target_value, unit, direction, note, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11, $12, $12)
     RETURNING ${COLUNAS}`,
    [
      id,
      session.context.organizationId,
      input.indicatorKey,
      customerId,
      contractId,
      input.validFrom,
      input.validTo ?? null,
      input.value,
      unit,
      input.direction,
      input.note?.trim() || null,
      session.context.actorId,
    ]
  );
  return mapear(row!, await hojeNaOrganizacao(session));
}

async function obter(
  session: TenantSession,
  scope: MembershipScope,
  id: string
): Promise<IndicatorTargetView> {
  const v = visivel(scope, 2);
  const [row] = await session.query<Linha>(
    `SELECT ${COLUNAS} FROM aurora.indicator_targets WHERE id = $1 AND deleted_at IS NULL AND ${v.sql}`,
    [id, ...v.params]
  );
  if (!row) throw new NotFoundError('meta', id);
  return mapear(row, await hojeNaOrganizacao(session));
}

export interface TargetPatch {
  validFrom?: string;
  validTo?: string | null;
  value?: number;
  direction?: StoredDirection;
  note?: string | null;
}

/** Indicador, cliente e contrato não mudam: outra meta, outro registro. */
export async function updateIndicatorTarget(
  session: TenantSession,
  scope: MembershipScope,
  id: string,
  patch: TargetPatch
): Promise<IndicatorTargetView> {
  const atual = await obter(session, scope, id);
  await conferirEscopoDeEscrita(session, scope, atual.customerId, atual.contractId);
  const novo: TargetInput = {
    indicatorKey: atual.indicatorKey,
    customerId: atual.customerId,
    contractId: atual.contractId,
    validFrom: patch.validFrom ?? atual.validFrom,
    validTo: patch.validTo === undefined ? atual.validTo : patch.validTo,
    value: patch.value ?? atual.value,
    direction: patch.direction ?? atual.direction,
    note: patch.note === undefined ? atual.note : patch.note,
  };
  const unit = validarCorpo(novo);
  const [row] = await session.query<Linha>(
    `UPDATE aurora.indicator_targets
        SET valid_from = $2::date, valid_to = $3::date, target_value = $4, unit = $5,
            direction = $6, note = $7, updated_by = $8
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUNAS}`,
    [
      id,
      novo.validFrom,
      novo.validTo ?? null,
      novo.value,
      unit,
      novo.direction,
      novo.note?.trim() || null,
      session.context.actorId,
    ]
  );
  return mapear(row!, await hojeNaOrganizacao(session));
}

/** Arquiva (não apaga): a meta que pautou um relatório entregue fica na trilha. */
export async function archiveIndicatorTarget(
  session: TenantSession,
  scope: MembershipScope,
  id: string
): Promise<void> {
  const atual = await obter(session, scope, id);
  await conferirEscopoDeEscrita(session, scope, atual.customerId, atual.contractId);
  await session.query(
    `UPDATE aurora.indicator_targets SET deleted_at = now(), updated_by = $2 WHERE id = $1`,
    [id, session.context.actorId]
  );
}
