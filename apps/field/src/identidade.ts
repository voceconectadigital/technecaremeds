/**
 * Aurora — quem está usando este aparelho agora (EPIC-014).
 *
 * A sessão do `app-kit` guarda só o token opaco e a organização; nenhum dos
 * dois diz QUEM é a pessoa (o token muda a cada entrada da mesma pessoa). O
 * e-mail com que ela entrou é o que a fila precisa para não mandar o trabalho
 * de uma pessoa com a credencial de outra — ver `Identidade` em `fila.ts`. Ele
 * fica só no aparelho, como o token, e é gravado pela tela de entrar.
 *
 * Mora num arquivo próprio, e não em `campo.tsx`, porque a tela de entrar
 * precisa dele sem montar a base local.
 */
import type { Identidade } from './fila';

const CHAVE_USUARIO = 'aurora:campo:usuario';
const CHAVE_ORGANIZACAO = 'aurora:organizacao';

export function lembrarUsuario(email: string): void {
  try {
    localStorage.setItem(CHAVE_USUARIO, email.trim().toLowerCase());
  } catch {
    /* sem armazenamento: a conferência compara só a organização */
  }
}

/** A identidade da sessão de AGORA. `null` sem organização escolhida. */
export function identidadeAtual(): Identidade | null {
  try {
    const organizacao = localStorage.getItem(CHAVE_ORGANIZACAO);
    if (!organizacao) return null;
    return { organizacao, usuario: localStorage.getItem(CHAVE_USUARIO) };
  } catch {
    return null;
  }
}
