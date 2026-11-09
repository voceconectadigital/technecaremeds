/**
 * Aurora — as logomarcas da organização (pedido do Anderson, 06/11/2026).
 *
 * "Até 2 logos por empresa": a do hospital e a da mantenedora, a da prestadora e a do hospital, a da
 * empresa e a do grupo. São DUAS VAGAS fixas (1 e 2), na ordem em que saem no cabeçalho da folha.
 *
 * ONDE FICA CADA COISA. Os metadados moram em `organizations.settings.logos`, mesclados (a coluna
 * guarda também a marca e o domínio, e sobrescrevê-la apagaria os dois). Os bytes ficam no mesmo
 * armazenamento de objetos dos certificados — banco cheio de imagem é banco que não se restaura.
 * Por isso não há migration: a coluna `settings` já existe e a RLS da organização já a protege.
 *
 * O ISOLAMENTO é o da linha da organização: a sessão só enxerga a própria, e a chave do arquivo
 * leva o id dela. Nenhuma rota recebe id de organização por parâmetro.
 */
import { NotFoundError, ValidationError } from '@aurora/domain';
import type { TenantSession } from './client';

export const ORGANIZATION_LOGO_SLOTS = [1, 2] as const;
export type OrganizationLogoSlot = (typeof ORGANIZATION_LOGO_SLOTS)[number];

export interface OrganizationLogoMeta {
  slot: OrganizationLogoSlot;
  label: string | null;
  file_key: string;
  file_name: string;
  content_type: string;
  size: number;
  sha256: string;
  updated_at: string;
}

function normalizar(cru: unknown): OrganizationLogoMeta[] {
  if (!Array.isArray(cru)) return [];
  const vistos = new Set<number>();
  const saida: OrganizationLogoMeta[] = [];
  for (const item of cru) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Partial<OrganizationLogoMeta>;
    if ((l.slot !== 1 && l.slot !== 2) || vistos.has(l.slot)) continue;
    if (typeof l.file_key !== 'string' || l.file_key.length === 0) continue;
    vistos.add(l.slot);
    saida.push({
      slot: l.slot,
      label: typeof l.label === 'string' && l.label.trim() ? l.label.trim() : null,
      file_key: l.file_key,
      file_name: typeof l.file_name === 'string' ? l.file_name : 'logo',
      content_type: typeof l.content_type === 'string' ? l.content_type : 'application/octet-stream',
      size: typeof l.size === 'number' ? l.size : 0,
      sha256: typeof l.sha256 === 'string' ? l.sha256 : '',
      updated_at: typeof l.updated_at === 'string' ? l.updated_at : '',
    });
  }
  return saida.sort((a, b) => a.slot - b.slot);
}

async function lerComTrava(session: TenantSession): Promise<OrganizationLogoMeta[]> {
  const rows = await session.query<{ logos: unknown }>(
    `SELECT settings->'logos' AS logos FROM aurora.organizations WHERE deleted_at IS NULL FOR UPDATE`
  );
  if (rows.length === 0) throw new NotFoundError('Organização');
  return normalizar(rows[0]!.logos);
}

async function gravar(session: TenantSession, logos: OrganizationLogoMeta[]): Promise<void> {
  await session.query(
    `UPDATE aurora.organizations
        SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('logos', $1::jsonb)
      WHERE deleted_at IS NULL`,
    [JSON.stringify(logos)]
  );
}

/** As logomarcas da organização da sessão, na ordem das vagas. Zero, uma ou duas. */
export async function listOrganizationLogos(session: TenantSession): Promise<OrganizationLogoMeta[]> {
  const rows = await session.query<{ logos: unknown }>(
    `SELECT settings->'logos' AS logos FROM aurora.organizations WHERE deleted_at IS NULL`
  );
  return normalizar(rows[0]?.logos);
}

/**
 * Põe (ou troca) a logomarca de uma vaga. Devolve a chave do arquivo anterior, para o chamador
 * apagá-lo DEPOIS de os metadados novos estarem gravados — nunca antes.
 */
export async function setOrganizationLogo(
  session: TenantSession,
  logo: Omit<OrganizationLogoMeta, 'updated_at'>
): Promise<{ logo: OrganizationLogoMeta; previousKey: string | null }> {
  if (!(ORGANIZATION_LOGO_SLOTS as readonly number[]).includes(logo.slot)) {
    throw new ValidationError('vaga de logomarca inválida (1 ou 2)', { field: 'slot' });
  }
  const atuais = await lerComTrava(session);
  const anterior = atuais.find((l) => l.slot === logo.slot) ?? null;
  const nova: OrganizationLogoMeta = {
    ...logo,
    label: logo.label?.trim() ? logo.label.trim().slice(0, 80) : null,
    updated_at: new Date().toISOString(),
  };
  await gravar(
    session,
    [...atuais.filter((l) => l.slot !== logo.slot), nova].sort((a, b) => a.slot - b.slot)
  );
  return { logo: nova, previousKey: anterior?.file_key ?? null };
}

/** Tira a logomarca da vaga. 404 quando a vaga já está vazia. */
export async function removeOrganizationLogo(
  session: TenantSession,
  slot: OrganizationLogoSlot
): Promise<{ previousKey: string }> {
  const atuais = await lerComTrava(session);
  const anterior = atuais.find((l) => l.slot === slot);
  if (!anterior) throw new NotFoundError('Logomarca', String(slot));
  await gravar(
    session,
    atuais.filter((l) => l.slot !== slot)
  );
  return { previousKey: anterior.file_key };
}
