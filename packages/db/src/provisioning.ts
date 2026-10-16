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
import { ASSET_FAMILIES, newId } from '@aurora/domain';
import type { TenantSession } from './client';
import { provisionFactoryRoles } from './rbac';
import { provisionWorkOrderStates } from './work-orders';
import { provisionStarterLocationTypes } from './directory';

export interface BaselineResult {
  roles: Map<string, string>;
  locationTypes: Map<string, string>;
  /** family_key → id da categoria-raiz da família. */
  families: Map<string, string>;
}

export async function provisionOrganizationBaseline(session: TenantSession): Promise<BaselineResult> {
  const roles = await provisionFactoryRoles(session);
  const [temSituacao] = await session.query<{ ok: boolean }>(
    `SELECT true AS ok FROM aurora.work_order_statuses LIMIT 1`
  );
  if (!temSituacao) await provisionWorkOrderStates(session);
  const locationTypes = await provisionStarterLocationTypes(session);
  const families = await provisionAssetFamilies(session);
  await provisionNeutralCriticalities(session);
  return { roles, locationTypes, families };
}

/**
 * As cinco famílias de equipamento (0063). Categoria-raiz com o mesmo nome é
 * marcada, não duplicada — o mesmo critério da migration.
 */
export async function provisionAssetFamilies(session: TenantSession): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [i, f] of ASSET_FAMILIES.entries()) {
    const [existente] = await session.query<{ id: string; family_key: string | null }>(
      `SELECT id, family_key FROM aurora.asset_categories
        WHERE archived_at IS NULL
          AND (family_key = $1 OR (parent_id IS NULL AND normalized_name = aurora.normalize_label($2)))
        ORDER BY (family_key = $1) DESC NULLS LAST
        LIMIT 1`,
      [f.key, f.name]
    );
    if (existente) {
      if (!existente.family_key) {
        await session.query(`UPDATE aurora.asset_categories SET family_key = $2 WHERE id = $1`, [
          existente.id,
          f.key,
        ]);
      }
      ids.set(f.key, existente.id);
      continue;
    }
    const id = newId();
    await session.query(
      `INSERT INTO aurora.asset_categories (id, organization_id, name, family_key, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, session.context.organizationId, f.name, f.key, i + 1, session.context.actorId]
    );
    ids.set(f.key, id);
  }
  return ids;
}

/**
 * Três níveis de criticidade só quando a organização não tem nenhum — com
 * multiplicador de SLA NEUTRO (1,0): o rótulo ordena, mas nenhum prazo muda
 * até a organização decidir. Inventar multiplicador seria inventar regra.
 */
async function provisionNeutralCriticalities(session: TenantSession): Promise<void> {
  const [tem] = await session.query(`SELECT 1 FROM aurora.criticality_levels LIMIT 1`);
  if (tem) return;
  for (const [nome, score] of [
    ['Alta', 90],
    ['Média', 60],
    ['Baixa', 30],
  ] as const) {
    await session.query(
      `INSERT INTO aurora.criticality_levels (id, organization_id, name, score, sla_multiplier, created_by)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [newId(), session.context.organizationId, nome, score, session.context.actorId]
    );
  }
}
