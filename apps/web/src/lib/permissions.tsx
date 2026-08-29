/**
 * Aurora — permissões na interface (SPEC v0.2 §21, §40).
 *
 * A REGRA, DITA UMA VEZ
 *
 * Esconder um botão é CONVENIÊNCIA. Quem nega é o servidor, em toda rota.
 * Nada aqui é defesa — se alguém remover este arquivo inteiro, o sistema
 * continua seguro e fica só mais confuso de usar.
 *
 * A confusão que este arquivo evita: um item de menu que leva a um 403 é pior
 * do que um item ausente. A pessoa clica, recebe a negativa e não sabe se
 * errou o caminho, se perdeu acesso ou se o sistema quebrou.
 *
 * A LISTA VEM DO SERVIDOR, e é a mesma que o guard usa. Deduzi-la no cliente
 * a partir do papel divergiria na primeira revogação individual — que existe
 * justamente para casos delicados ("suspenso durante apuração interna").
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface PermissoesCtx {
  /** Conjunto para consulta em O(1): a barra lateral pergunta muitas vezes. */
  set: ReadonlySet<string>;
}

const Ctx = createContext<PermissoesCtx | null>(null);

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: readonly string[];
  children: ReactNode;
}) {
  const valor = useMemo(() => ({ set: new Set(permissions) }), [permissions]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export interface PermissionApi {
  /** Tem TODAS as permissões listadas. */
  can(...keys: string[]): boolean;
  /** Tem ao menos UMA. Serve para seções de menu com várias telas dentro. */
  canAny(...keys: string[]): boolean;
  all: ReadonlySet<string>;
}

export function usePermissions(): PermissionApi {
  const ctx = useContext(Ctx);
  const set = ctx?.set ?? EMPTY;

  return useMemo(
    () => ({
      can: (...keys) => keys.every((k) => set.has(k)),
      canAny: (...keys) => keys.some((k) => set.has(k)),
      all: set,
    }),
    [set]
  );
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Esconde o que a pessoa não pode.
 *
 * `fallback` existe para quando a AUSÊNCIA confunde mais do que a explicação:
 * numa ficha de OS, sumir com o bloco de custo faz a pessoa achar que a OS não
 * tem custo. Aí é melhor dizer "você não tem permissão para ver valores".
 */
export function Can({
  permission,
  any = false,
  children,
  fallback = null,
}: {
  permission: string | string[];
  any?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const p = usePermissions();
  const chaves = Array.isArray(permission) ? permission : [permission];
  const pode = any ? p.canAny(...chaves) : p.can(...chaves);
  return <>{pode ? children : fallback}</>;
}
