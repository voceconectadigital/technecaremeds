/**
 * Aurora — verificações de sanidade de segurança do banco (SPEC v0.2 §37).
 *
 * Executadas no boot da aplicação. A ideia é simples: se a configuração do
 * banco desativa o isolamento entre organizações, a aplicação NÃO sobe. Falhar
 * no start é barato; descobrir em produção que o papel tinha BYPASSRLS não é.
 */
import type { Database } from './client';

export class UnsafeDatabaseRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseRoleError';
  }
}

export interface RolePrivileges {
  role: string;
  bypassRls: boolean;
  superuser: boolean;
}

export async function inspectCurrentRole(db: Database): Promise<RolePrivileges> {
  const rows = await db.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
    `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`
  );
  const r = rows[0];
  if (!r) throw new UnsafeDatabaseRoleError('não foi possível identificar o papel atual do banco');
  return { role: r.rolname, bypassRls: r.rolbypassrls, superuser: r.rolsuper };
}

/**
 * Recusa o boot se o papel usado pela API puder ignorar RLS.
 * @param allowUnsafe libera apenas em desenvolvimento/teste, com intenção explícita.
 */
export async function assertAppRoleIsSafe(db: Database, allowUnsafe = false): Promise<RolePrivileges> {
  const priv = await inspectCurrentRole(db);
  if ((priv.bypassRls || priv.superuser) && !allowUnsafe) {
    throw new UnsafeDatabaseRoleError(
      `Recusando subir: o papel de banco "${priv.role}" tem ` +
        `${priv.superuser ? 'SUPERUSER' : ''}${priv.superuser && priv.bypassRls ? ' e ' : ''}` +
        `${priv.bypassRls ? 'BYPASSRLS' : ''}. Isso desativa o isolamento entre organizações. ` +
        `Use um papel que herde de aurora_app. Ver SPEC §37.`
    );
  }
  return priv;
}

/**
 * Verificação de conectividade para o endpoint de readiness.
 * Fica aqui, e não no controller, para que a regra de lint que proíbe acesso
 * direto ao banco fora da camada de dados continue valendo sem exceções.
 */
export async function checkConnectivity(db: Database): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
