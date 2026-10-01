/**
 * Téchne Care — a "sessão" da demonstração.
 *
 * NÃO É AUTENTICAÇÃO, e não finge ser. Não há senha, não há token, não há
 * servidor que confira nada: a demonstração só precisa lembrar que a pessoa já
 * passou pela tela de entrada, para que um recarregamento numa tela interna não
 * a mande de volta para o começo.
 *
 * Para isso usa as MESMAS chaves que a sessão de verdade usa — e assim a guarda
 * de rotas, a moldura e o "Sair" funcionam sem nenhum desvio. O valor gravado é
 * um marcador legível, e não uma credencial: o cliente da demonstração não o
 * envia a lugar nenhum, porque não envia nada a lugar nenhum.
 */
import { CHAVE_ORG, CHAVE_TOKEN, lerSessaoGuardada } from '@aurora/app-kit';

export const MARCADOR = 'demonstracao';

/**
 * A organização fictícia da captura — a única que a demonstração conhece.
 *
 * Literal, e não lida de `capturas.json`: este arquivo é importado pelo
 * roteador, e ler as capturas daqui puxaria o arquivo inteiro para o pacote
 * principal. O valor é `DEMO.org` de `tools/demo/semeadura.ts`, fixo entre
 * capturas justamente para isto.
 */
export const ORGANIZACAO_DEMO = '0193dd00-0000-7000-8000-00000000d001';

export function entrarNaDemonstracao(): void {
  try {
    localStorage.setItem(CHAVE_TOKEN, MARCADOR);
    localStorage.setItem(CHAVE_ORG, ORGANIZACAO_DEMO);
  } catch {
    /* sem armazenamento: a demonstração segue, e um recarregamento pede a entrada de novo */
  }
}

export function estaNaDemonstracao(): boolean {
  const { token, organizationId } = lerSessaoGuardada();
  return token === MARCADOR && organizationId !== null;
}
