/**
 * Aurora — o alvo de uma solicitação, conferido contra o ESCOPO de quem abre
 * (reunião 16/10/2026, Fase 4).
 *
 * O banco já garante a COERÊNCIA (ativo e local do mesmo cliente — gatilho da
 * 0019). Faltava o ESCOPO: quem só enxerga a UTI do Hospital A abria chamado
 * para o equipamento do Bloco, ou de outro hospital, desde que soubesse o id.
 * A tela filtra a lista de equipamentos; quem garante é esta função.
 *
 *   · cliente fora do escopo           → 404 (não confirmar que existe);
 *   · equipamento de outro cliente     → 422 no campo `asset_id`;
 *   · equipamento fora dos setores     → 422 no campo `asset_id`;
 *   · local fora do escopo/de outro    → 422 no campo `location_id`.
 *
 * Com equipamento e sem local, o local passa a ser o do equipamento — a
 * solicitação nasce no setor certo sem pedir duas vezes a mesma coisa.
 */
import { NotFoundError, ValidationError } from '@aurora/domain';
import type { TenantSession } from '@aurora/db';

export async function conferirAlvoDaSolicitacao(
  s: TenantSession,
  membershipId: string,
  alvo: { customerId: string; locationId: string | null; assetId: string | null }
): Promise<{ locationId: string | null }> {
  const [cliente] = await s.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.accessible_customer_ids($1) WHERE customer_id = $2`,
    [membershipId, alvo.customerId]
  );
  if (!cliente) throw new NotFoundError('cliente', alvo.customerId);

  let locationId = alvo.locationId;

  if (alvo.assetId) {
    const [ativo] = await s.query<{ customer_id: string; location_id: string | null; acessivel: boolean }>(
      `SELECT a.customer_id, a.location_id,
              (a.location_id IS NULL
               OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($1))) AS acessivel
         FROM aurora.assets a
        WHERE a.id = $2 AND a.deleted_at IS NULL`,
      [membershipId, alvo.assetId]
    );
    if (!ativo || ativo.customer_id !== alvo.customerId) {
      throw new ValidationError('o equipamento não é deste cliente', { field: 'asset_id' });
    }
    if (!ativo.acessivel) {
      throw new ValidationError('o equipamento está fora dos setores que você pode atender', {
        field: 'asset_id',
      });
    }
    if (locationId && ativo.location_id && locationId !== ativo.location_id) {
      throw new ValidationError('o local informado não é o do equipamento', { field: 'location_id' });
    }
    locationId = locationId ?? ativo.location_id;
  }

  if (locationId) {
    const [local] = await s.query<{ customer_id: string; acessivel: boolean }>(
      `SELECT l.customer_id,
              l.id IN (SELECT location_id FROM aurora.accessible_location_ids($1)) AS acessivel
         FROM aurora.locations l
        WHERE l.id = $2 AND l.deleted_at IS NULL`,
      [membershipId, locationId]
    );
    if (!local || !local.acessivel || local.customer_id !== alvo.customerId) {
      throw new ValidationError('local fora do seu escopo ou de outro cliente', { field: 'location_id' });
    }
  }

  return { locationId };
}
