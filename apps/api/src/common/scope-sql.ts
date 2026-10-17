/**
 * Aurora — o fragmento de escopo das LISTAS de equipe (reunião 16/10/2026, Fase 1).
 *
 * O par do `ScopeGuard`: o guard protege a rota por identificador; este
 * fragmento recorta as listas (OS, quadro, fila de triagem, agenda). Vive num
 * lugar só pelo mesmo motivo do `NO_MEU_ESCOPO` do portal — a versão copiada e
 * colada é a que alguém esquece de colar na consulta nova.
 *
 * Só entra na consulta quando o vínculo é RESTRITO: para quem enxerga tudo, a
 * condição seria verdadeira em toda linha e só custaria plano de execução.
 */
import type { RequestContext } from '@aurora/domain';

export function escopoRestrito(ctx: RequestContext): boolean {
  return (
    Boolean(ctx.membershipId) && !(ctx.scope.customerScope === 'all' && ctx.scope.locationScope === 'all')
  );
}

/**
 * Condição SQL para uma tabela com `customer_id` e `location_id` (anulável).
 * `n` é a posição do parâmetro que carrega o `membershipId`.
 */
export function filtroDeEscopo(alias: string, n: number): string {
  return filtroDeEscopoPor(`${alias}.customer_id`, `${alias}.location_id`, n);
}

/**
 * A mesma condição, para quando cliente e local vêm de expressões — o
 * documento, por exemplo, tira o local do equipamento ou da OS. Cliente nulo
 * não passa (`NULL IN (...)` não é verdadeiro): por isso o fragmento só entra
 * na consulta de quem é RESTRITO (`escopoRestrito`).
 */
export function filtroDeEscopoPor(cliente: string, local: string, n: number): string {
  return `(${cliente} IN (SELECT customer_id FROM aurora.accessible_customer_ids($${n}))
           AND (${local} IS NULL
                OR ${local} IN (SELECT location_id FROM aurora.accessible_location_ids($${n}))))`;
}
