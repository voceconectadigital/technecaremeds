/**
 * Aurora — sessão do navegador (SPEC v0.2 §05, §21, §37).
 *
 * O QUE É GUARDADO, E ONDE
 *
 * A credencial e a organização escolhida vivem em `localStorage`. A
 * ORGANIZAÇÃO é apenas uma ESCOLHA entre as que a pessoa já tem — nunca
 * autorização. Trocar o valor à mão no navegador não dá acesso a nada: o
 * servidor confere o vínculo em toda requisição e devolve 403 se não houver.
 * É a camada 1 da §37, e é por isso que ela pode morar no cliente.
 *
 * TROCAR DE ORGANIZAÇÃO É AÇÃO EXPLÍCITA (§05), nunca implícita por URL. Não
 * existe `/org/:id/...` nesta aplicação: a URL de uma OS é a mesma para
 * qualquer organização, e quem determina o que ela mostra é o vínculo. Isso
 * impede o acidente clássico de mandar um link para um colega de outra empresa
 * e ele ver metade da tela carregar antes do 403.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { CHAVE_TOKEN, CHAVE_ORG, lerSessaoGuardada } from './session-guard';

function gravar(chave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: segue em memória, e o recarregamento pede login */
  }
}

export interface SessionState {
  token: string | null;
  organizationId: string | null;
  signIn(token: string): void;
  signOut(): void;
  chooseOrganization(id: string): void;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => lerSessaoGuardada().token);
  const [organizationId, setOrganizationId] = useState<string | null>(
    () => lerSessaoGuardada().organizationId
  );

  const signIn = useCallback((novo: string) => {
    gravar(CHAVE_TOKEN, novo);
    // Entrar de novo NÃO herda a organização da sessão anterior: pode ser
    // outra pessoa no mesmo computador, e o vínculo dela é outro.
    gravar(CHAVE_ORG, null);
    setToken(novo);
    setOrganizationId(null);
  }, []);

  const signOut = useCallback(() => {
    gravar(CHAVE_TOKEN, null);
    gravar(CHAVE_ORG, null);
    setToken(null);
    setOrganizationId(null);
  }, []);

  const chooseOrganization = useCallback((id: string) => {
    gravar(CHAVE_ORG, id);
    setOrganizationId(id);
  }, []);

  const valor = useMemo<SessionState>(
    () => ({ token, organizationId, signIn, signOut, chooseOrganization }),
    [token, organizationId, signIn, signOut, chooseOrganization]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession exige <SessionProvider> acima na árvore');
  return s;
}
