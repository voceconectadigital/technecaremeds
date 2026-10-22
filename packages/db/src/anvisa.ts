/**
 * Aurora — verificação do registro ANVISA do equipamento (conversa com o cliente, 21/10/2026).
 *
 * O cliente pediu que o sistema avise quando o registro ANVISA de um equipamento tiver alerta ou
 * proibição de uso. Este módulo é a metade que existe hoje: REGISTRA a verificação (quem, quando,
 * o que encontrou) e AVISA as pessoas certas quando o resultado é alerta ou proibição.
 *
 * A consulta automática à ANVISA não existe ainda — falta escolher a fonte oficial, a frequência e
 * o limite de uso (ver migration 0081). Quando existir, ela chama esta mesma função: o aviso, a
 * trilha e a tela não mudam.
 */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  ANVISA_STATUSES,
  type AnvisaStatus,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

export interface AnvisaCheckInput {
  status: AnvisaStatus;
  note?: string | null;
}

export async function recordAnvisaCheck(
  session: TenantSession,
  assetId: string,
  input: AnvisaCheckInput
): Promise<{ status: AnvisaStatus; alerted: boolean }> {
  if (!(ANVISA_STATUSES as readonly string[]).includes(input.status)) {
    throw new ValidationError('situação ANVISA desconhecida', { field: 'status' });
  }
  const nota = input.note?.trim() || null;
  if (nota && nota.length > 1000) {
    throw new ValidationError('a observação vai até 1000 caracteres', { field: 'note' });
  }
  // Alerta e proibição precisam dizer O QUÊ: "uso proibido" sem motivo não orienta ninguém.
  if (input.status !== 'regular' && !nota) {
    throw new ValidationError('descreva o alerta ou a proibição (número da notificação, motivo)', {
      field: 'note',
    });
  }

  const [ativo] = await session.query<{ name: string; registro: string | null }>(
    `SELECT name, anvisa_registration AS registro FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
    [assetId]
  );
  if (!ativo) throw new NotFoundError('Equipamento', assetId);
  if (!ativo.registro?.trim()) {
    throw new ConflictError(
      'este equipamento não tem registro ANVISA cadastrado: informe-o antes de registrar a verificação'
    );
  }

  await session.query(
    `UPDATE aurora.assets
        SET anvisa_status = $2, anvisa_note = $3, anvisa_checked_at = now(), anvisa_checked_by = $4,
            updated_at = now(), updated_by = $4
      WHERE id = $1`,
    [assetId, input.status, nota, session.context.actorId]
  );

  const alerted = input.status !== 'regular';
  if (alerted) {
    await emitEvent(session, {
      type: 'asset.anvisa_alert',
      aggregateId: assetId,
      payload: { name: ativo.name, registration: ativo.registro, status: input.status, note: nota },
    });
  }
  return { status: input.status, alerted };
}
