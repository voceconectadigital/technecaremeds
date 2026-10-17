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
import { ASSET_FAMILIES, SERVICE_REQUEST_TYPES, newId } from '@aurora/domain';
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
  // Idempotente por chave: numa organização existente só acrescenta o que falta.
  await provisionWorkOrderStates(session);
  const locationTypes = await provisionStarterLocationTypes(session);
  const families = await provisionAssetFamilies(session);
  await provisionNeutralCriticalities(session);
  await provisionWorkOrderTypes(session);
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
 * As naturezas de OS dos sete tipos de solicitação (0064). Item existente com a
 * mesma chave de sistema, a mesma chave ou o mesmo rótulo é reaproveitado.
 */
const CHAVE_DO_ITEM: Record<string, string> = {
  corrective: 'corretiva',
  preventive: 'preventiva',
  technical_instruction: 'instrucao_tecnica',
  training: 'treinamento',
  calibration: 'calibracao',
  electrical_safety: 'teste_seguranca_eletrica',
  qualification: 'qualificacao',
};

export async function provisionWorkOrderTypes(session: TenantSession): Promise<void> {
  for (const [i, t] of SERVICE_REQUEST_TYPES.entries()) {
    const chave = CHAVE_DO_ITEM[t.key]!;
    const [existente] = await session.query<{ id: string; system_key: string | null }>(
      `SELECT id, system_key FROM aurora.catalog_items
        WHERE catalog_key = 'work_order_type' AND archived_at IS NULL
          AND (system_key = $1 OR key = $2 OR normalized_label = aurora.normalize_label($3))
        ORDER BY (system_key = $1) DESC NULLS LAST
        LIMIT 1`,
      [t.key, chave, t.label]
    );
    if (existente) {
      if (!existente.system_key) {
        await session.query(`UPDATE aurora.catalog_items SET system_key = $2 WHERE id = $1`, [
          existente.id,
          t.key,
        ]);
      }
      continue;
    }
    await session.query(
      `INSERT INTO aurora.catalog_items
         (id, organization_id, catalog_key, key, system_key, label, position, is_system, created_by)
       VALUES ($1, $2, 'work_order_type', $3, $4, $5, $6, true, $7)
       ON CONFLICT DO NOTHING`,
      [newId(), session.context.organizationId, chave, t.key, t.label, i + 1, session.context.actorId]
    );
  }
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
