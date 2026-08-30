/**
 * Aurora — tokens de injeção.
 *
 * A DI é explícita por token, sem depender de `emitDecoratorMetadata`. Além de
 * funcionar em qualquer transpilador, deixa visível o que cada classe recebe.
 */
export const DATABASE = Symbol('AURORA_DATABASE');
export const ENV = Symbol('AURORA_ENV');
export const LOGGER = Symbol('AURORA_LOGGER');
export const AUTH_PROVIDER = Symbol('AURORA_AUTH_PROVIDER');
export const CLOCK = Symbol('AURORA_CLOCK');
/**
 * Onde os bytes dos anexos moram.
 *
 * Injetado, e não importado: a homologação usa disco, os testes usam memória, e
 * um dia a produção pode usar armazenamento de objetos — sem que nenhum
 * controller precise saber a diferença.
 */
export const ARQUIVOS = Symbol('AURORA_ARQUIVOS');
