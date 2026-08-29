/**
 * Aurora — leitura da sessão fora do React.
 *
 * A guarda de rota do TanStack roda ANTES de qualquer componente montar, então
 * não pode usar `useSession`. Este arquivo lê as mesmas chaves.
 *
 * Repetir a leitura em dois lugares seria receita de divergência, e por isso
 * as chaves ficam aqui — `lib/session.tsx` as importa.
 */
export const CHAVE_TOKEN = 'aurora:token';
export const CHAVE_ORG = 'aurora:organizacao';

export function lerSessaoGuardada(): { token: string | null; organizationId: string | null } {
  try {
    return {
      token: localStorage.getItem(CHAVE_TOKEN),
      organizationId: localStorage.getItem(CHAVE_ORG),
    };
  } catch {
    // Janela anônima com armazenamento bloqueado: sem sessão persistida, a
    // guarda manda para a entrada — que é o comportamento correto.
    return { token: null, organizationId: null };
  }
}
