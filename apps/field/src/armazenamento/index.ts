/**
 * Aurora — a porta de persistência e os seus adaptadores (EPIC-014).
 *
 * Quem consome o armazenamento importa DAQUI, e nunca de um adaptador. É a
 * linha que separa "o Aurora Field guarda dado" de "o Aurora Field usa
 * IndexedDB" — e é ela que permite o mesmo código rodar no navegador, no
 * Android e no iOS.
 */
export * from './porta';
export * from './conformidade';
export { armazenamentoEmMemoria } from './memoria';
export { armazenamentoIndexedDb } from './indexeddb';
export { armazenamentoSqlite, type DriverSql } from './sqlite';
