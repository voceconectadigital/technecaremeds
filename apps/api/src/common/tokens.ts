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
