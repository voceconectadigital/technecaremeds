/**
 * Aurora — contratos da API (SPEC v0.2 §36).
 *
 * A fonte compartilhada entre backend e frontend. Um campo é decidido aqui uma
 * vez e três coisas passam a concordar por construção: a validação do
 * controller, o documento OpenAPI e o cliente tipado.
 *
 * COBERTURA
 *
 * Nem toda rota tem contrato ainda, e isso é DITO em vez de escondido: o
 * gerador (`npm run openapi`) imprime a porcentagem e lista as que faltam. Uma
 * cobertura declarada e não medida é pior do que nenhuma — cria a impressão de
 * garantia sem a garantia.
 *
 * A ordem de escrita segue o consumidor: contrato nasce quando a tela que o
 * usa nasce. Escrever os 135 de uma vez produziria esquemas que ninguém
 * exercita, e esquema não exercitado erra no campo opcional.
 */
export * from './registry';
export * from './primitives';
export * from './json-schema';
export * from './client';

// Os módulos de operação registram-se ao serem importados. A ordem não importa;
// o registro reclama de identificador repetido.
export * from './operations/platform';
export * from './operations/session';
export * from './operations/members';
export * from './operations/catalogs';
export * from './operations/work-order-detail';
export * from './operations/assets';
export * from './operations/roles';
export * from './operations/inventory';
export * from './operations/commercial';
export * from './operations/plans';
export * from './operations/insights';
export * from './operations/directory';
export * from './operations/search';
export * from './operations/service-requests';
export * from './operations/work-orders';
export * from './operations/schedule';
