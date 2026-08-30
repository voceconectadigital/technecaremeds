/**
 * Aurora — armazenamento no aparelho: SQLite (EPIC-014).
 *
 * O MESMO SQL RODA NO TESTE E NO APARELHO, e é isso que dá valor a este arquivo.
 *
 * O plugin de SQLite do Capacitor só existe dentro do aplicativo empacotado:
 * ele fala com o SQLite do Android e do iOS por ponte nativa. Escrever este
 * adaptador contra o plugin faria o SQL só ser exercitado num emulador, ou
 * seja, quase nunca — e um `CREATE TABLE` errado apareceria na primeira
 * instalação de loja.
 *
 * Então o adaptador fala com uma PORTA DE DRIVER de três operações. Quem a
 * implementa:
 *
 *   · nos testes, `node:sqlite` — SQLite de verdade, no processo do Vitest;
 *   · no aparelho, o plugin do Capacitor.
 *
 * O texto das consultas é o mesmo nos dois. O que muda é quem as executa.
 *
 * A FORMA DA TABELA
 *
 * Uma tabela só, com chave composta `(colecao, chave)`. A alternativa — uma
 * tabela por coleção — obrigaria a migrar o esquema toda vez que uma coleção
 * nova aparecesse, dentro de um aplicativo instalado, com o dia de trabalho de
 * alguém dentro. Com uma tabela só, coleção nova é uma linha nova.
 *
 * O valor é TEXTO com JSON. É a mesma conversão que a porta impõe a todos os
 * adaptadores (regra 7), e é o que torna as duas plataformas honestamente
 * equivalentes: o que não é JSON não atravessa em lugar nenhum.
 */
import { copiaJson, type ArmazenamentoOffline, type Colecao } from './porta';

/**
 * O mínimo que um driver de SQLite precisa oferecer.
 *
 * Três operações, e nenhuma delas expõe o mecanismo. `consultar` devolve
 * linhas; `executar` não devolve nada; `fechar` encerra. O plugin do Capacitor
 * e o `node:sqlite` cabem nisto sem adaptação de conceito.
 */
export interface DriverSql {
  readonly nome: string;
  executar(sql: string, params?: readonly unknown[]): Promise<void>;
  consultar<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  fechar(): Promise<void>;
}

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS registros (
    colecao TEXT NOT NULL,
    chave   TEXT NOT NULL,
    valor   TEXT NOT NULL,
    PRIMARY KEY (colecao, chave)
  )
`;

/*
 * O índice por coleção existe para o `todos()` e o `limpar()`.
 *
 * Sem ele, listar a fila varreria também as ordens, os ativos e os catálogos —
 * que num dia cheio são milhares de linhas. A fila é lida a cada escoamento, ou
 * seja, muitas vezes por minuto.
 */
const INDICE = `CREATE INDEX IF NOT EXISTS registros_por_colecao ON registros (colecao)`;

export async function armazenamentoSqlite(driver: DriverSql): Promise<ArmazenamentoOffline> {
  await driver.executar(ESQUEMA);
  await driver.executar(INDICE);

  return {
    nome: `sqlite:${driver.nome}`,
    colecao<T>(nome: string): Colecao<T> {
      return {
        async ler(chave) {
          const linhas = await driver.consultar<{ valor: string }>(
            'SELECT valor FROM registros WHERE colecao = ? AND chave = ?',
            [nome, chave]
          );
          return linhas.length === 0 ? undefined : (JSON.parse(linhas[0]!.valor) as T);
        },
        async gravar(chave, valor) {
          /*
           * `ON CONFLICT DO UPDATE` e não "apaga e insere": a segunda forma tem
           * um instante em que a linha não existe, e um aplicativo encerrado
           * pelo sistema exatamente ali perderia o registro. A regra 2 da porta
           * diz "substitui", e substituir é uma operação só.
           */
          await driver.executar(
            `INSERT INTO registros (colecao, chave, valor) VALUES (?, ?, ?)
             ON CONFLICT (colecao, chave) DO UPDATE SET valor = excluded.valor`,
            [nome, chave, JSON.stringify(copiaJson(valor))]
          );
        },
        async apagar(chave) {
          await driver.executar('DELETE FROM registros WHERE colecao = ? AND chave = ?', [nome, chave]);
        },
        async todos() {
          const linhas = await driver.consultar<{ valor: string }>(
            'SELECT valor FROM registros WHERE colecao = ?',
            [nome]
          );
          return linhas.map((l) => JSON.parse(l.valor) as T);
        },
        async limpar() {
          await driver.executar('DELETE FROM registros WHERE colecao = ?', [nome]);
        },
      };
    },
    fechar: () => driver.fechar(),
  };
}
