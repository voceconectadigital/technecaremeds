/**
 * Validação sem `eval` — IMPORTADO PRIMEIRO em `main.tsx` (17/10/2026).
 *
 * O Zod 4 compila validadores de objeto com `new Function` quando o navegador
 * permite, e para descobrir isso ele SONDA `Function('')`. Com a política de
 * conteúdo (CSP) do Pages — sem `'unsafe-eval'`, de propósito —, a sonda vira uma
 * violação registrada a cada carga, e impediria trocar a CSP de Report-Only para
 * bloqueio com o console limpo.
 *
 * `jitless` desliga a compilação E a sonda (o Zod só sonda quando a compilação
 * está ligada). A decisão é tomada quando cada esquema é CONSTRUÍDO, então isto
 * precisa rodar antes de qualquer `import` de contratos — por isso é a primeira
 * linha de `main.tsx`. A validação continua a mesma; só deixa de ser compilada,
 * e no navegador os volumes são pequenos.
 */
import { config } from 'zod/v4';

config({ jitless: true });
