/**
 * Aurora — contrato que PARA o atendimento (D-4) e renovação da vigência (D-7).
 *
 * Respostas do Anderson de 24/11/2026. A regra de "pode atender?" mora num
 * lugar só — `aurora.service_block()` (0092) — e é consultada pelas funções de
 * dados que abrem, executam ou concluem atendimento. Assim ela vale igual pela
 * API, pelo aplicativo de campo, pelo portal, pela geração de planos e pelas
 * automações: nenhum desses caminhos tem um atalho que a ignore.
 *
 * O QUE CONTINUA LIBERADO: consultar tudo (listas, fichas, relatórios,
 * histórico) e as operações de quem administra o contrato — editar, renovar,
 * reativar o atendimento. É exatamente o que permite regularizar.
 */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  describeServiceBlock,
  localDay,
  newId,
  nextRenewalEnd,
  renewalTerm,
  shouldAutoRenew,
  type ServiceBlock,
  type ServiceBlockReason,
  type ServiceHold,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

/** Hoje no calendário da organização (o servidor roda em UTC). */
export async function organizationToday(session: TenantSession, now: Date = new Date()): Promise<string> {
  const [org] = await session.query<{ timezone: string | null }>(
    `SELECT timezone FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  return localDay(now, org?.timezone ?? undefined);
}

/** O contrato que retém o atendimento deste cliente/equipamento, ou nulo. */
export async function serviceBlockFor(
  session: TenantSession,
  target: { customerId: string; assetId?: string | null },
  on?: string
): Promise<ServiceBlock | null> {
  const dia = on ?? (await organizationToday(session));
  const [row] = await session.query<{
    contract_id: string;
    contract_number: string;
    reason: ServiceBlockReason;
    held_at: string | null;
    hold_reason: string | null;
    ends_on: string | null;
  }>(
    `SELECT contract_id, contract_number, reason, held_at::text, hold_reason, ends_on::text
       FROM aurora.service_block($1, $2, $3::date)`,
    [target.customerId, target.assetId ?? null, dia]
  );
  if (!row) return null;
  return {
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    reason: row.reason,
    heldAt: row.held_at,
    holdReason: row.hold_reason,
    endsOn: row.ends_on,
  };
}

/**
 * Recusa a operação quando o contrato retém o atendimento. 409 com o motivo
 * por extenso e os dados estruturados (`service_block`), para a tela mostrar
 * o mesmo aviso que a API explica.
 */
export async function assertServiceAllowed(
  session: TenantSession,
  target: { customerId: string; assetId?: string | null }
): Promise<void> {
  const bloqueio = await serviceBlockFor(session, target);
  if (!bloqueio) return;
  throw new ConflictError(describeServiceBlock(bloqueio), {
    service_block: {
      contract_id: bloqueio.contractId,
      contract_number: bloqueio.contractNumber,
      reason: bloqueio.reason,
      held_at: bloqueio.heldAt,
      hold_reason: bloqueio.holdReason,
      ends_on: bloqueio.endsOn,
    },
  });
}

/** O mesmo, a partir da OS (cliente e equipamento dela). OS inexistente passa: quem chama dá o 404. */
export async function assertWorkOrderServiceAllowed(
  session: TenantSession,
  workOrderId: string
): Promise<void> {
  const [os] = await session.query<{ customer_id: string; asset_id: string | null }>(
    `SELECT customer_id, asset_id FROM aurora.work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (os) await assertServiceAllowed(session, { customerId: os.customer_id, assetId: os.asset_id });
}

/** A retenção, em formato de resposta (snake_case), para fichas e avisos. */
export function serviceBlockView(b: ServiceBlock | null) {
  return b
    ? {
        contract_id: b.contractId,
        contract_number: b.contractNumber,
        reason: b.reason,
        held_at: b.heldAt,
        hold_reason: b.holdReason,
        ends_on: b.endsOn,
        message: describeServiceBlock(b),
      }
    : null;
}

/* -------------------------------------------------------------------------- */
/* suspender / bloquear / reativar                                             */
/* -------------------------------------------------------------------------- */

const EVENTO_DA_RETENCAO: Record<ServiceHold, 'contract.service_suspended' | 'contract.service_blocked'> = {
  suspended: 'contract.service_suspended',
  blocked: 'contract.service_blocked',
};

/**
 * Suspende ou bloqueia o atendimento. Só contrato vigente: rascunho ainda não
 * atende, e vencido/encerrado já parou. Motivo obrigatório (≥ 10 letras): é o
 * que aparece para quem esbarrar no bloqueio. A trilha de auditoria
 * (`contracts_audit`) guarda autor, data e o antes/depois.
 */
export async function holdContractService(
  session: TenantSession,
  contractId: string,
  hold: ServiceHold,
  reason: string
): Promise<{ changed: boolean }> {
  const motivo = reason.trim();
  if (motivo.length < 10 || motivo.length > 500) {
    throw new ValidationError('informe o motivo (de 10 a 500 caracteres)', { field: 'reason' });
  }
  const [c] = await session.query<{ number: string; status: string; service_hold: string | null }>(
    `SELECT number, status::text, service_hold FROM aurora.contracts
      WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
    [contractId]
  );
  if (!c) throw new NotFoundError('contrato não encontrado');
  if (c.status !== 'active') {
    throw new ConflictError(
      `contrato ${c.number} não está vigente: só se suspende ou bloqueia o atendimento de contrato vigente`
    );
  }
  if (c.service_hold === hold) return { changed: false };
  await session.query(
    `UPDATE aurora.contracts
        SET service_hold = $2, service_hold_reason = $3, service_hold_at = now(), service_hold_by = $4,
            updated_by = $4, updated_at = now()
      WHERE id = $1`,
    [contractId, hold, motivo, session.context.actorId]
  );
  await emitEvent(session, {
    type: EVENTO_DA_RETENCAO[hold],
    aggregateId: contractId,
    payload: { number: c.number, reason: motivo, previous: c.service_hold },
  });
  return { changed: true };
}

/** Reativa o atendimento (tira a suspensão ou o bloqueio). */
export async function releaseContractService(
  session: TenantSession,
  contractId: string,
  reason: string | null
): Promise<{ changed: boolean }> {
  const motivo = reason?.trim() || null;
  if (motivo && motivo.length > 500) {
    throw new ValidationError('o motivo tem no máximo 500 caracteres', { field: 'reason' });
  }
  const [c] = await session.query<{ number: string; service_hold: string | null }>(
    `SELECT number, service_hold FROM aurora.contracts WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
    [contractId]
  );
  if (!c) throw new NotFoundError('contrato não encontrado');
  if (c.service_hold === null) return { changed: false };
  await session.query(
    `UPDATE aurora.contracts
        SET service_hold = NULL, service_hold_reason = NULL, service_hold_at = NULL, service_hold_by = NULL,
            updated_by = $2, updated_at = now()
      WHERE id = $1`,
    [contractId, session.context.actorId]
  );
  await emitEvent(session, {
    type: 'contract.service_released',
    aggregateId: contractId,
    payload: { number: c.number, previous: c.service_hold, reason: motivo },
  });
  return { changed: true };
}

/* -------------------------------------------------------------------------- */
/* renovação                                                                   */
/* -------------------------------------------------------------------------- */

export interface RenewalRow {
  id: string;
  seq: number;
  previous_ends_on: string;
  new_ends_on: string;
  mode: 'automatic' | 'manual';
  note: string | null;
  created_at: string;
  created_by_name: string | null;
}

export async function contractRenewals(session: TenantSession, contractId: string): Promise<RenewalRow[]> {
  return session.query<RenewalRow>(
    `SELECT r.id, r.seq, r.previous_ends_on::text, r.new_ends_on::text, r.mode, r.note,
            r.created_at, u.name AS created_by_name
       FROM aurora.contract_renewals r
       LEFT JOIN aurora.users u ON u.id = r.created_by
      WHERE r.contract_id = $1
      ORDER BY r.seq DESC`,
    [contractId]
  );
}

interface ContratoParaRenovar {
  number: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  auto_renew: boolean;
  service_hold: string | null;
  original_ends_on: string | null;
  last_seq: number;
}

async function lerParaRenovar(session: TenantSession, id: string): Promise<ContratoParaRenovar | undefined> {
  const [c] = await session.query<ContratoParaRenovar>(
    `SELECT c.number, c.status::text, c.starts_on::text, c.ends_on::text, c.auto_renew, c.service_hold,
            -- O prazo é o da vigência ORIGINAL: o fim antes da primeira renovação.
            COALESCE((SELECT r.previous_ends_on FROM aurora.contract_renewals r
                       WHERE r.contract_id = c.id ORDER BY r.seq LIMIT 1), c.ends_on)::text AS original_ends_on,
            COALESCE((SELECT max(r.seq) FROM aurora.contract_renewals r WHERE r.contract_id = c.id), 0)::int
              AS last_seq
       FROM aurora.contracts c
      WHERE c.id = $1 AND c.archived_at IS NULL
      FOR UPDATE OF c`,
    [id]
  );
  return c;
}

async function gravarRenovacao(
  session: TenantSession,
  id: string,
  c: ContratoParaRenovar,
  novoFim: string,
  mode: 'automatic' | 'manual',
  note: string | null
): Promise<void> {
  // A atualização só pega se o fim ainda é o que foi lido: duas varreduras ao
  // mesmo tempo não renovam a mesma vigência duas vezes (e a unicidade da
  // tabela recusaria a segunda linha de qualquer forma).
  const feito = await session.query<{ id: string }>(
    `UPDATE aurora.contracts
        SET ends_on = $2::date, status = 'active', updated_by = $4, updated_at = now()
      WHERE id = $1 AND ends_on = $3::date
      RETURNING id`,
    [id, novoFim, c.ends_on, session.context.actorId]
  );
  if (feito.length === 0) throw new ConflictError(`contrato ${c.number} mudou durante a renovação`);
  await session.query(
    `INSERT INTO aurora.contract_renewals
       (id, organization_id, contract_id, seq, previous_ends_on, new_ends_on, mode, note, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)`,
    [
      newId(),
      session.context.organizationId,
      id,
      c.last_seq + 1,
      c.ends_on,
      novoFim,
      mode,
      note,
      session.context.actorId,
    ]
  );
  await emitEvent(session, {
    type: 'contract.renewed',
    aggregateId: id,
    payload: { number: c.number, previous_ends_on: c.ends_on, new_ends_on: novoFim, mode },
  });
}

async function conflitosDeVigencia(session: TenantSession, id: string): Promise<string[]> {
  // Mesma regra de `updateContract`: um equipamento em um contrato por vez.
  const rows = await session.query<{ descricao: string }>(
    `SELECT DISTINCT a.name || ' (já em ' || outro.number || ')' AS descricao
       FROM aurora.contracts esta
       CROSS JOIN LATERAL aurora.resolve_contract_assets(esta.id) r
       JOIN aurora.assets a ON a.id = r.asset_id
       JOIN aurora.contracts outro ON outro.id <> esta.id AND outro.status IN ('draft', 'active')
                                  AND outro.customer_id = esta.customer_id
      WHERE esta.id = $1
        AND outro.starts_on <= COALESCE(esta.ends_on, 'infinity'::date)
        AND esta.starts_on <= COALESCE(outro.ends_on, 'infinity'::date)
        AND EXISTS (SELECT 1 FROM aurora.resolve_contract_assets(outro.id) o WHERE o.asset_id = r.asset_id)
      LIMIT 5`,
    [id]
  );
  return rows.map((r) => r.descricao);
}

/**
 * Renovação feita por quem administra — inclusive de contrato já vencido, que
 * é o caminho para regularizar. Sem `newEndsOn`, renova pelo prazo original.
 */
export async function renewContract(
  session: TenantSession,
  id: string,
  input: { newEndsOn?: string | null; note?: string | null }
): Promise<{ previous_ends_on: string; new_ends_on: string }> {
  const c = await lerParaRenovar(session, id);
  if (!c) throw new NotFoundError('contrato não encontrado');
  if (c.status !== 'active' && c.status !== 'expired') {
    throw new ConflictError(`contrato ${c.number} não está vigente nem vencido: não há o que renovar`);
  }
  if (!c.ends_on) {
    throw new ConflictError(`contrato ${c.number} tem prazo indeterminado: não há ciclo para renovar`);
  }
  const novoFim =
    input.newEndsOn ?? nextRenewalEnd(c.ends_on, renewalTerm(c.starts_on, c.original_ends_on ?? c.ends_on));
  if (novoFim <= c.ends_on) {
    throw new ValidationError('o novo término precisa ser depois do término atual', { field: 'newEndsOn' });
  }
  const nota = input.note?.trim() || null;
  if (nota && nota.length > 500) throw new ValidationError('a observação tem no máximo 500 caracteres');
  await gravarRenovacao(session, id, c, novoFim, 'manual', nota);
  const conflitos = await conflitosDeVigencia(session, id);
  if (conflitos.length > 0) {
    throw new ConflictError(
      `a renovação colocaria equipamento em dois contratos ao mesmo tempo: ${conflitos.join('; ')}`
    );
  }
  return { previous_ends_on: c.ends_on, new_ends_on: novoFim };
}

/**
 * Varredura diária: renova o que tem renovação automática e chegou ao fim.
 *
 * Contrato suspenso ou bloqueado NÃO renova ("renova o ciclo se ninguém
 * bloquear ou suspender"): ele segue para o vencimento. Prazo indeterminado
 * nunca vence e não tem ciclo. Renovação que criaria sobreposição de
 * equipamento com outro contrato é desfeita (SAVEPOINT) e o contrato vence —
 * alguém já cadastrou o sucessor, e a decisão é dessa pessoa.
 */
export async function sweepContractRenewals(
  session: TenantSession,
  today: string
): Promise<Array<{ contractId: string; number: string; newEndsOn: string }>> {
  const candidatos = await session.query<{ id: string }>(
    `SELECT id FROM aurora.contracts
      WHERE status = 'active' AND auto_renew AND service_hold IS NULL
        AND ends_on IS NOT NULL AND ends_on <= $1::date AND archived_at IS NULL
      ORDER BY ends_on, id`,
    [today]
  );
  const feitas: Array<{ contractId: string; number: string; newEndsOn: string }> = [];
  for (const { id } of candidatos) {
    const c = await lerParaRenovar(session, id);
    if (
      !c ||
      !shouldAutoRenew(
        { status: c.status, autoRenew: c.auto_renew, serviceHold: c.service_hold, endsOn: c.ends_on },
        today
      )
    ) {
      continue;
    }
    const novoFim = nextRenewalEnd(c.ends_on!, renewalTerm(c.starts_on, c.original_ends_on ?? c.ends_on!));
    await session.query('SAVEPOINT renovacao_automatica');
    await gravarRenovacao(session, id, c, novoFim, 'automatic', null);
    if ((await conflitosDeVigencia(session, id)).length > 0) {
      await session.query('ROLLBACK TO SAVEPOINT renovacao_automatica');
      continue;
    }
    await session.query('RELEASE SAVEPOINT renovacao_automatica');
    feitas.push({ contractId: id, number: c.number, newEndsOn: novoFim });
  }
  return feitas;
}

/* -------------------------------------------------------------------------- */
/* horas técnicas (D-3) — apuração, sem tarifa nem valor                       */
/* -------------------------------------------------------------------------- */

export type TechnicalHourGroup = 'preventive' | 'corrective' | 'other';

export interface TechnicalHours {
  period: { from: string; to: string };
  totals: Array<{ group: TechnicalHourGroup; work_orders: number; minutes: number }>;
  without_hours: number;
  items: Array<{
    work_order_id: string;
    number: string | null;
    title: string;
    work_order_type: string | null;
    group: TechnicalHourGroup;
    service_started_at: string;
    service_ended_at: string;
    minutes: number;
  }>;
}

/**
 * Horas de preventiva e de corretiva das OS DO CONTRATO (as carimbadas com ele
 * na abertura), pela hora de início e de término informadas na OS. Entra a OS
 * cujo atendimento TERMINOU no período [from, to] (dias do calendário da
 * organização). A duração é término − início, em minutos — auditável OS a OS
 * na lista. OS concluída sem as duas horas conta à parte: "não informadas".
 *
 * Nenhuma tarifa, nenhum valor: "todas as modalidades gerarão cálculos no
 * futuro" (D-5), mas as regras financeiras ainda não foram entregues.
 */
export async function technicalHours(
  session: TenantSession,
  contractId: string,
  from: string,
  to: string
): Promise<TechnicalHours> {
  if (to < from) throw new ValidationError('"to" precisa ser igual ou depois de "from"', { field: 'to' });
  const [c] = await session.query<{ id: string }>(`SELECT id FROM aurora.contracts WHERE id = $1`, [
    contractId,
  ]);
  if (!c) throw new NotFoundError('contrato não encontrado');
  const [org] = await session.query<{ timezone: string | null }>(
    `SELECT timezone FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  const fuso = org?.timezone ?? 'America/Sao_Paulo';
  const items = await session.query<TechnicalHours['items'][number]>(
    `SELECT w.id AS work_order_id, w.number, w.title, ci.system_key AS work_order_type,
            CASE ci.system_key WHEN 'preventive' THEN 'preventive'
                               WHEN 'corrective' THEN 'corrective' ELSE 'other' END AS "group",
            w.service_started_at, w.service_ended_at,
            round(extract(epoch FROM (w.service_ended_at - w.service_started_at)) / 60)::int AS minutes
       FROM aurora.work_orders w
       LEFT JOIN aurora.catalog_items ci ON ci.id = w.work_order_type_id
      WHERE w.contract_id = $1
        AND w.service_started_at IS NOT NULL AND w.service_ended_at IS NOT NULL
        AND (w.service_ended_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY w.service_ended_at, w.number`,
    [contractId, from, to, fuso]
  );
  const [sem] = await session.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM aurora.work_orders w
      WHERE w.contract_id = $1
        AND (w.service_started_at IS NULL OR w.service_ended_at IS NULL)
        AND w.completed_at IS NOT NULL
        AND (w.completed_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
    [contractId, from, to, fuso]
  );
  const totals = (['preventive', 'corrective', 'other'] as const).map((group) => {
    const doGrupo = items.filter((i) => i.group === group);
    return {
      group,
      work_orders: doGrupo.length,
      minutes: doGrupo.reduce((soma, i) => soma + Number(i.minutes), 0),
    };
  });
  return { period: { from, to }, totals, without_hours: sem?.n ?? 0, items };
}
