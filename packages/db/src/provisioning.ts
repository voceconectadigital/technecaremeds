/**
 * Aurora — o ponto de partida de uma organização (reunião 16/10/2026).
 *
 * Uma organização recém-criada precisava de quatro scripts diferentes para
 * funcionar: papéis (admin:criar), situações de OS, tipos de local e catálogos
 * (só os seeds de demonstração e homologação faziam). Resultado: a organização
 * criada pelo caminho de produção abria a ficha de cliente e recebia "Esta
 * organização não tem o tipo de local 'Setor'".
 *
 * Esta função reúne o mínimo para operar, e é IDEMPOTENTE: rodar de novo numa
 * organização que já tem tudo não duplica nada e não sobrescreve o que a
 * organização editou (rótulos, posições). É o que `admin:criar` e o
 * provisionamento de novo negócio chamam.
 */
import type { TenantSession } from './client';
import { provisionFactoryRoles } from './rbac';
import { provisionWorkOrderStates } from './work-orders';
import { provisionStarterLocationTypes } from './directory';

export interface BaselineResult {
  roles: Map<string, string>;
  locationTypes: Map<string, string>;
}

export async function provisionOrganizationBaseline(session: TenantSession): Promise<BaselineResult> {
  const roles = await provisionFactoryRoles(session);
  const [temSituacao] = await session.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.work_order_statuses LIMIT 1`
  );
  if (!temSituacao) await provisionWorkOrderStates(session);
  const locationTypes = await provisionStarterLocationTypes(session);
  return { roles, locationTypes };
}
