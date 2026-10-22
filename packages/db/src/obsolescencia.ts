/**
 * Aurora — laudo de obsolescência como ordem de serviço própria (conversa com o cliente,
 * 21/10/2026).
 *
 * "Preciso da função laudo de obsolescência, onde qualquer equipamento pode virar um outro
 * tipo de ordem de serviço separada com numeração diferente, exemplo OBCxyz; esta função
 * desativa o equipamento com justificativa técnica e fotos."
 *
 * Como funciona, em quatro passos:
 *   1. qualquer equipamento ativo gera um LAUDO: uma OS de tipo próprio (`obsolescence`),
 *      com numeração própria (OBC-AAAA-NNNN) e a justificativa técnica na descrição;
 *   2. a OS segue o fluxo normal (triagem, execução, fotos, conclusão);
 *   3. ao CONCLUIR, o laudo exige a justificativa e ao menos uma foto — sem foto não há prova
 *      de que o equipamento foi visto (ver `exigirLaudoCompleto`, chamada pela transição);
 *   4. ao VALIDAR (a OS vai a `done`), o equipamento é descomissionado com a justificativa do
 *      laudo (ver `baixarPeloLaudo`).
 *
 * O equipamento só sai de operação quando alguém com poder de validar aceita o laudo: gerar
 * o laudo não o desativa.
 */
import { ConflictError, NotFoundError, ValidationError } from '@aurora/domain';
import type { TenantSession } from './client';
import { createCatalogItem } from './catalogs';
import { createWorkOrder } from './work-orders';

/** Chave de sistema do tipo de OS do laudo. */
export const OBSOLESCENCE_SYSTEM_KEY = 'obsolescence';
/** A série de numeração do laudo: OBC-2026-0001. */
export const OBSOLESCENCE_NUMBER_SERIES = 'OBC';
/** A justificativa técnica não é uma frase solta: pede o mínimo para alguém conseguir validar. */
export const MIN_JUSTIFICATION = 20;

/** O tipo de OS do laudo, criado na primeira vez que a organização precisa dele. */
export async function ensureObsolescenceType(session: TenantSession): Promise<string> {
  const [existente] = await session.query<{ id: string }>(
    `SELECT id FROM aurora.catalog_items
      WHERE catalog_key = 'work_order_type' AND system_key = $1 AND archived_at IS NULL`,
    [OBSOLESCENCE_SYSTEM_KEY]
  );
  if (existente) return existente.id;
  return createCatalogItem(session, {
    catalogKey: 'work_order_type',
    key: 'laudo_obsolescencia',
    label: 'Laudo de obsolescência',
    systemKey: OBSOLESCENCE_SYSTEM_KEY,
  });
}

/** Gera o laudo de obsolescência de um equipamento: uma OS OBC-AAAA-NNNN com a justificativa. */
export async function createObsolescenceReport(
  session: TenantSession,
  assetId: string,
  justification: string
): Promise<{ id: string; number: string | null }> {
  const justificativa = justification.trim();
  if (justificativa.length < MIN_JUSTIFICATION) {
    throw new ValidationError(
      `a justificativa técnica precisa de ao menos ${MIN_JUSTIFICATION} caracteres: ela é o que o validador lê`,
      { field: 'justification' }
    );
  }

  const [ativo] = await session.query<{
    name: string;
    status: string;
    customer_id: string;
    location_id: string | null;
  }>(
    `SELECT name, status::text AS status, customer_id, location_id
       FROM aurora.assets WHERE id = $1 AND deleted_at IS NULL`,
    [assetId]
  );
  if (!ativo) throw new NotFoundError('Equipamento', assetId);
  if (ativo.status === 'decommissioned' || ativo.status === 'disposed') {
    throw new ConflictError('este equipamento já está fora de operação');
  }

  // Um laudo por vez: dois laudos abertos para o mesmo equipamento seriam dois validadores
  // decidindo a mesma baixa.
  const [aberto] = await session.query<{ number: string | null }>(
    `SELECT w.number
       FROM aurora.work_orders w
       JOIN aurora.catalog_items t ON t.id = w.work_order_type_id
      WHERE w.asset_id = $1 AND t.system_key = $2
        AND w.status_category::text NOT IN ('done', 'closed', 'cancelled')
      LIMIT 1`,
    [assetId, OBSOLESCENCE_SYSTEM_KEY]
  );
  if (aberto) {
    throw new ConflictError(
      `já existe um laudo de obsolescência em andamento para este equipamento (${aberto.number})`
    );
  }

  const tipo = await ensureObsolescenceType(session);
  return createWorkOrder(session, {
    customerId: ativo.customer_id,
    workOrderTypeId: tipo,
    title: `Laudo de obsolescência — ${ativo.name}`,
    description: justificativa,
    locationId: ativo.location_id,
    assetId,
    source: 'manual',
    publish: true,
    numberSeries: OBSOLESCENCE_NUMBER_SERIES,
  });
}
