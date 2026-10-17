/**
 * Téchne Care — o endereço da apresentação comercial.
 *
 * Arquivo MÍNIMO de propósito: é importado pelo roteador e pela composição da
 * aplicação (`app.tsx`) para saber que esta rota é PÚBLICA. Se ele puxasse a
 * página junto, a apresentação inteira entraria no pacote principal.
 */
export const ROTA_APRESENTACAO = '/apresentacao';

/**
 * Rotas que abrem sem conta e sem nenhuma consulta à API.
 *
 * A composição da aplicação pergunta pela sessão (`GET /me/session`) para
 * montar as permissões. Numa rota pública essa pergunta não pode acontecer:
 * sem conta ela volta 401, e o 401 manda a pessoa para `/entrar` — a
 * apresentação sumiria no meio da reunião.
 */
export function ehRotaPublica(pathname: string): boolean {
  const limpo = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return limpo === ROTA_APRESENTACAO;
}
