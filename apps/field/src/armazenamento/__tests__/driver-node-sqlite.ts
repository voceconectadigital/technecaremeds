/**
 * Aurora — driver de SQLite para a suíte, sobre `node:sqlite`.
 *
 * É SQLite DE VERDADE, e é por isso que ele vale a pena.
 *
 * O plugin do Capacitor só existe dentro do aplicativo empacotado, então o SQL
 * do adaptador só seria exercitado num emulador — ou seja, quase nunca. Com
 * `node:sqlite`, o mesmo texto de consulta roda a cada execução da suíte, num
 * motor com a mesma gramática: um `ON CONFLICT` escrito errado falha aqui, e
 * não na primeira instalação vinda da loja.
 *
 * O que ele NÃO prova: a ponte nativa do Capacitor, as permissões do aparelho e
 * o comportamento sob pouca memória. Isso é do teste de fumaça em aparelho, que
 * está registrado como etapa futura.
 */
import { DatabaseSync } from 'node:sqlite';
import type { DriverSql } from '../sqlite';

export function driverNodeSqlite(caminho = ':memory:'): DriverSql {
  const db = new DatabaseSync(caminho);
  return {
    nome: 'node',
    async executar(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
    async consultar<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async fechar() {
      db.close();
    },
  };
}
