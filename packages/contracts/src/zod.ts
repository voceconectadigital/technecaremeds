/**
 * O `z` dos contratos — TODO contrato importa daqui, e não de 'zod/v4'.
 *
 * NO NAVEGADOR, A VALIDAÇÃO NÃO COMPILA CÓDIGO (17/10/2026).
 *
 * O Zod 4 compila validadores de objeto com `new Function` quando pode, e para
 * descobrir se pode ele SONDA `Function('')`. A política de conteúdo (CSP) dos
 * apps no Pages não tem `'unsafe-eval'`, de propósito: a sonda virava uma
 * violação registrada a cada carga e impedia passar a CSP de Report-Only para
 * bloqueio com o console limpo.
 *
 * `jitless` desliga a compilação E a sonda — o Zod só sonda com a compilação
 * ligada. A decisão é tomada quando cada esquema é CONSTRUÍDO, e por isso ela
 * mora AQUI: um módulo carregado primeiro no `main.tsx` não bastava, porque o
 * empacotador sobe o `import` do pedaço compartilhado (onde vivem os contratos)
 * para antes do corpo do pedaço principal. Daqui, a configuração roda antes do
 * primeiro esquema, em qualquer ordem de pedaços.
 *
 * Só no navegador (`document` existe): na API a compilação é ganho de
 * desempenho, e o servidor não tem CSP de script.
 */
import { config, z } from 'zod/v4';

if (typeof (globalThis as { document?: unknown }).document !== 'undefined') config({ jitless: true });

export { z };
