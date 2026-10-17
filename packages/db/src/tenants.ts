/**
 * Aurora — "Novo Negócio": provisionamento lógico de tenant (reunião
 * 16/10/2026, Fase 11).
 *
 * Um negócio novo é DADO, não código: a organização, a base de fábrica
 * (`provisionOrganizationBaseline`), a marca e o primeiro administrador — tudo
 * numa transação, sob o contexto DA NOVA organização (a RLS aprova a linha de
 * `organizations` porque o id é o do contexto). Nada atravessa tenant.
 *
 * Só o admin GLOBAL de plataforma provisiona e lista tenants, e a condição é
 * conferida no banco (`aurora.is_platform_admin`), não num papel de tenant:
 * ser admin de UMA organização não dá poder sobre as outras.
 *
 * Domínio próprio: é guardado como PEDIDO (`pending_dns`). Apontar DNS e emitir
 * certificado não é automatizado — BLOQUEADO — INFRA. Sem preço, sem cobrança.
 */
import {
  newId,
  buildContext,
  PERMISSION_KEYS,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '@aurora/domain';
import { withTenant, withPlatformSession, type Database } from './client';
import { provisionOrganizationBaseline } from './provisioning';
import { inviteMember } from './memberships';

export interface TenantBranding {
  display_name?: string | null;
  /** Cor primária, `#rrggbb`. */
  primary_color?: string | null;
  support_email?: string | null;
}

export interface ProvisionTenantInput {
  slug: string;
  name: string;
  taxId?: string | null;
  branding?: TenantBranding;
  /** Domínio pedido — fica `pending_dns` (BLOQUEADO — INFRA). */
  domain?: string | null;
  admin: { email: string; name: string };
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  branding: TenantBranding;
  domain: { host: string; status: string } | null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function isPlatformAdmin(db: Database, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const [r] = await withPlatformSession(db, (c) =>
    c.query<{ ok: boolean }>('SELECT aurora.is_platform_admin($1) AS ok', [userId])
  );
  return Boolean(r?.ok);
}

async function exigirAdminDePlataforma(db: Database, userId: string | null): Promise<void> {
  if (!(await isPlatformAdmin(db, userId))) {
    throw new ForbiddenError('apenas o admin global de plataforma gerencia negócios (tenants)');
  }
}

function resumo(o: {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  settings: Record<string, unknown> | null;
}): TenantSummary {
  const s = (o.settings ?? {}) as { branding?: TenantBranding; domain?: { host: string; status: string } };
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    status: o.status,
    created_at: o.created_at,
    branding: s.branding ?? {},
    domain: s.domain ?? null,
  };
}

export async function listTenants(db: Database, userId: string | null): Promise<TenantSummary[]> {
  await exigirAdminDePlataforma(db, userId);
  const linhas = await withPlatformSession(db, (c) =>
    c.query<{
      id: string;
      slug: string;
      name: string;
      status: string;
      created_at: Date;
      settings: Record<string, unknown> | null;
    }>('SELECT * FROM aurora.platform_list_tenants($1)', [userId])
  );
  return linhas.map(resumo);
}

function validar(input: ProvisionTenantInput): string[] {
  const erros: string[] = [];
  if (!SLUG.test(input.slug)) erros.push('slug: letras minúsculas, números e hífen (2 a 63)');
  if (!input.name?.trim()) erros.push('name: obrigatório');
  const b = input.branding ?? {};
  if (b.primary_color && !COR.test(b.primary_color)) erros.push('branding.primary_color: use #rrggbb');
  if (b.support_email && !EMAIL.test(b.support_email)) erros.push('branding.support_email inválido');
  if (input.domain && !HOST.test(input.domain.toLowerCase())) erros.push('domain: nome de host inválido');
  if (!EMAIL.test(input.admin?.email ?? '')) erros.push('admin.email inválido');
  if (!input.admin?.name?.trim()) erros.push('admin.name: obrigatório');
  return erros;
}

/**
 * Cria o negócio. Uma transação: se o convite do administrador falhar, não
 * sobra organização sem dono.
 */
export async function provisionTenant(
  db: Database,
  input: ProvisionTenantInput,
  actor: { userId: string | null; requestId: string }
): Promise<{ organizationId: string; adminMembershipId: string; reusedUser: boolean }> {
  await exigirAdminDePlataforma(db, actor.userId);
  const erros = validar(input);
  if (erros.length > 0) throw new ValidationError(erros.join('; '));

  const [ocupado] = await withPlatformSession(db, (c) =>
    c.query<{ taken: boolean }>('SELECT aurora.organization_slug_taken($1) AS taken', [input.slug])
  );
  if (ocupado?.taken) throw new ConflictError(`o identificador "${input.slug}" já está em uso`);

  const id = newId();
  const ctx = buildContext({
    organizationId: id,
    actorId: actor.userId,
    actorKind: 'user',
    requestId: actor.requestId,
    source: 'api',
    permissions: PERMISSION_KEYS,
  });
  const settings = {
    branding: {
      display_name: input.branding?.display_name?.trim() || input.name.trim(),
      primary_color: input.branding?.primary_color ?? null,
      support_email: input.branding?.support_email ?? null,
    },
    ...(input.domain ? { domain: { host: input.domain.toLowerCase(), status: 'pending_dns' } } : {}),
  };

  return withTenant(db, ctx, async (s) => {
    await s.query(
      `INSERT INTO aurora.organizations (id, slug, name, tax_id, settings, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [id, input.slug, input.name.trim(), input.taxId ?? null, JSON.stringify(settings), actor.userId]
    );
    await provisionOrganizationBaseline(s);
    const convite = await inviteMember(s, {
      email: input.admin.email,
      name: input.admin.name,
      seatType: 'staff',
      roleKeys: ['admin'],
    });
    await s.query(`UPDATE aurora.memberships SET is_owner = true WHERE id = $1`, [convite.membershipId]);
    return { organizationId: id, adminMembershipId: convite.membershipId, reusedUser: convite.reusedUser };
  });
}
