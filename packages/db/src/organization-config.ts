/**
 * Aurora — modo de uso e recursos habilitados da organização (0049 · gap V2 P0.4).
 *
 * Sempre a organização DO CONTEXTO: a RLS de `organizations` só deixa ver a
 * própria linha, e nenhuma função aqui recebe identificador de organização.
 */
import {
  effectiveFeatures,
  normalizeFeatures,
  ORGANIZATION_USAGE_MODES,
  NotFoundError,
  ValidationError,
  type OrganizationFeature,
  type OrganizationUsageMode,
} from '@aurora/domain';
import type { TenantSession } from './client';
import { emitEvent } from './outbox';

export interface OrganizationConfiguration {
  usage_mode: OrganizationUsageMode;
  enabled_features: OrganizationFeature[];
  /** `false` enquanto ninguém escolheu: tudo habilitado por padrão. */
  features_customized: boolean;
  /**
   * Concluir a OS exige o parecer LIBERADO/PARADO (pente-fino PF-41).
   *
   * Mora em `organizations.settings` (jsonb, sem migration) e é `false` por
   * padrão: ninguém pediu a exigência para todos, e ligá-la mudaria o fluxo de
   * quem conclui hoje sem parecer.
   */
  require_operational_result: boolean;
}

/** A chave em `organizations.settings`. */
const CHAVE_PARECER = 'require_operational_result';

export async function loadOrganizationConfiguration(
  session: TenantSession
): Promise<OrganizationConfiguration> {
  const [row] = await session.query<{
    usage_mode: string;
    enabled_features: string[] | null;
    require_operational_result: boolean | null;
  }>(
    `SELECT usage_mode::text AS usage_mode, enabled_features,
            (settings ->> '${CHAVE_PARECER}')::boolean AS require_operational_result
       FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  if (!row) throw new NotFoundError('Organização');
  return {
    usage_mode: row.usage_mode as OrganizationUsageMode,
    enabled_features: effectiveFeatures(row.enabled_features),
    features_customized: row.enabled_features !== null,
    require_operational_result: row.require_operational_result === true,
  };
}

/** A conclusão exige o parecer? Lido na transição — ver `transitionWorkOrder`. */
export async function requiresOperationalResult(session: TenantSession): Promise<boolean> {
  const [row] = await session.query<{ exige: boolean | null }>(
    `SELECT (settings ->> '${CHAVE_PARECER}')::boolean AS exige
       FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  return row?.exige === true;
}

/**
 * Muda o modo, a lista de recursos e/ou a exigência do parecer.
 *
 * `enabledFeatures: null` volta ao padrão (tudo habilitado). Lista vazia é
 * recusada: uma organização sem módulo nenhum não tem tela para desfazer o
 * próprio erro.
 */
export async function updateOrganizationConfiguration(
  session: TenantSession,
  patch: {
    usageMode?: string;
    enabledFeatures?: readonly string[] | null;
    requireOperationalResult?: boolean;
  }
): Promise<OrganizationConfiguration> {
  if (
    patch.usageMode !== undefined &&
    !(ORGANIZATION_USAGE_MODES as readonly string[]).includes(patch.usageMode)
  ) {
    throw new ValidationError('modo de uso inválido', {
      field: 'usage_mode',
      allowed: ORGANIZATION_USAGE_MODES,
    });
  }
  if (patch.requireOperationalResult !== undefined && typeof patch.requireOperationalResult !== 'boolean') {
    throw new ValidationError('require_operational_result precisa ser verdadeiro ou falso', {
      field: 'require_operational_result',
    });
  }

  let lista: OrganizationFeature[] | null | undefined = undefined;
  if (patch.enabledFeatures === null) lista = null;
  else if (patch.enabledFeatures !== undefined) {
    lista = normalizeFeatures(patch.enabledFeatures);
    if (lista.length === 0) {
      throw new ValidationError('ao menos um recurso precisa continuar habilitado', {
        field: 'enabled_features',
      });
    }
  }

  // A exigência entra MESCLADA em `settings`: a coluna guarda também a marca e
  // o domínio, e sobrescrevê-la apagaria os dois.
  const rows = await session.query<{ id: string }>(
    `UPDATE aurora.organizations
        SET usage_mode = COALESCE($1::aurora.organization_usage_mode, usage_mode),
            enabled_features = CASE WHEN $2::boolean THEN $3::text[] ELSE enabled_features END,
            settings = CASE WHEN $5::boolean IS NULL THEN settings
                            ELSE COALESCE(settings, '{}'::jsonb) || jsonb_build_object('${CHAVE_PARECER}', $5::boolean)
                       END,
            updated_by = $4
      WHERE deleted_at IS NULL
      RETURNING id`,
    [
      patch.usageMode ?? null,
      lista !== undefined,
      lista ?? null,
      session.context.actorId,
      patch.requireOperationalResult ?? null,
    ]
  );
  if (rows.length === 0) throw new NotFoundError('Organização');

  const atual = await loadOrganizationConfiguration(session);
  await emitEvent(session, {
    type: 'organization.updated',
    aggregateId: rows[0]!.id,
    payload: {
      change: 'configuration',
      usage_mode: atual.usage_mode,
      enabled_features: atual.enabled_features,
      require_operational_result: atual.require_operational_result,
    },
  });
  return atual;
}
