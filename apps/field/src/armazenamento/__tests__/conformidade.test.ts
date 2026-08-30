/**
 * Aurora — a porta de persistência, provada duas vezes (EPIC-014).
 *
 * O REQUISITO É EXPLÍCITO: o armazenamento do navegador e o do aparelho
 * precisam obedecer à MESMA interface e à MESMA semântica. Interface é o que o
 * TypeScript garante; semântica é o que quebra em campo.
 *
 * A mesma suíte roda contra dois mecanismos que não têm nada em comum:
 * um mapa em memória e um SQLite de verdade, via `node:sqlite`. Se as duas
 * passam, a fila e a sincronização podem ser escritas uma vez só.
 *
 * O IndexedDB não roda aqui — ele não existe em Node, e um simulador provaria o
 * simulador. Ele é conferido no NAVEGADOR, pela tela de diagnóstico do
 * aparelho, com a mesma suíte, e o teste de ponta a ponta exige que passe.
 */
import { describe, it, expect } from 'vitest';
import { conferirConformidade, REGRAS, armazenamentoEmMemoria, armazenamentoSqlite } from '..';
import { driverNodeSqlite } from './driver-node-sqlite';

const ADAPTADORES = [
  { nome: 'memória', fabrica: async () => armazenamentoEmMemoria() },
  { nome: 'sqlite (node:sqlite)', fabrica: () => armazenamentoSqlite(driverNodeSqlite()) },
] as const;

describe.each(ADAPTADORES)('conformidade da porta · $nome', ({ fabrica }) => {
  it('passa nas oito regras, uma a uma', async () => {
    const resultados = await conferirConformidade(fabrica);

    const reprovadas = resultados.filter((r) => !r.passou);
    if (reprovadas.length > 0) {
      throw new Error(
        'o adaptador divergiu da porta:\n' +
          reprovadas.map((r) => `  · ${r.regra}\n      ${r.detalhe}`).join('\n')
      );
    }
    // A contagem confere que a suíte inteira rodou: um `for` que sai cedo
    // deixaria regras sem executar e ainda assim não teria reprovada nenhuma.
    expect(resultados).toHaveLength(REGRAS.length);
  });
});

describe('a suíte de conformidade reprova de verdade', () => {
  it('um adaptador que devolve a referência guardada é reprovado na regra da cópia', async () => {
    /*
     * A PROVA DE QUE A SUÍTE PROVA ALGO.
     *
     * Uma suíte de conformidade que passa em tudo pode estar passando porque
     * confere pouco. Este adaptador é deliberadamente errado de UM jeito — ele
     * devolve a mesma referência que guardou —, e a suíte precisa achar
     * exatamente essa regra, e só ela.
     *
     * É o defeito mais provável de um adaptador escrito às pressas, e o mais
     * difícil de perceber: tudo funciona até uma tela ordenar a lista lida e o
     * disco mudar junto.
     */
    const dados = new Map<string, Map<string, unknown>>();
    const semCopia = async () => ({
      nome: 'sem-copia',
      colecao<T>(nome: string) {
        if (!dados.has(nome)) dados.set(nome, new Map());
        const m = dados.get(nome)!;
        return {
          /*
           * Ele converte para JSON ao GRAVAR — como um adaptador correto faria
           * — e devolve a referência guardada ao LER. O defeito fica isolado
           * numa regra só, que é o ponto: uma suíte que reprova por duas
           * razões não prova que acha a razão certa.
           */
          ler: async (k: string) => m.get(k) as T | undefined,
          gravar: async (k: string, v: T) => void m.set(k, JSON.parse(JSON.stringify(v))),
          apagar: async (k: string) => void m.delete(k),
          todos: async () => [...m.values()] as T[],
          limpar: async () => m.clear(),
        };
      },
      fechar: async () => dados.clear(),
    });

    const resultados = await conferirConformidade(semCopia);
    const reprovadas = resultados.filter((r) => !r.passou);

    expect(reprovadas).toHaveLength(1);
    expect(reprovadas[0]!.regra).toContain('cópia');
  });

  it('um adaptador que não isola coleções é reprovado no isolamento', async () => {
    /*
     * O segundo defeito clássico: uma tabela só, sem a coluna da coleção. Ele
     * passa em quase tudo — grava, lê, apaga — e faz a fila enxergar ordens de
     * serviço no meio dos comandos.
     */
    const tudoJunto = new Map<string, unknown>();
    const semIsolamento = async () => ({
      nome: 'sem-isolamento',
      colecao<T>() {
        return {
          ler: async (k: string) => {
            const v = tudoJunto.get(k);
            return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
          },
          gravar: async (k: string, v: T) => void tudoJunto.set(k, JSON.parse(JSON.stringify(v))),
          apagar: async (k: string) => void tudoJunto.delete(k),
          todos: async () => [...tudoJunto.values()].map((v) => JSON.parse(JSON.stringify(v)) as T),
          limpar: async () => tudoJunto.clear(),
        };
      },
      fechar: async () => tudoJunto.clear(),
    });

    const reprovadas = (await conferirConformidade(semIsolamento)).filter((r) => !r.passou);
    expect(reprovadas.map((r) => r.regra).join(' ')).toContain('isoladas');
  });
});

describe('SQLite · o que só o motor de verdade mostra', () => {
  it('o dado sobrevive a fechar e reabrir a mesma base', async () => {
    /*
     * Em memória isto é trivial; num arquivo é a diferença entre guardar e
     * parecer guardar. O aparelho fecha e reabre o aplicativo o tempo todo — o
     * sistema recuperando memória, a pessoa trocando de aplicativo.
     *
     * O `node:sqlite` compartilha a base entre conexões quando o caminho é o
     * mesmo; aqui a base é a mesma instância reaberta pelo adaptador, que é
     * exatamente o que acontece no aplicativo.
     */
    const driver = driverNodeSqlite();
    const a = await armazenamentoSqlite(driver);
    await a.colecao<{ n: number }>('fila').gravar('cmd-1', { n: 1 });

    // Um segundo adaptador sobre o MESMO driver: é o que o aplicativo faz ao
    // remontar sem fechar o banco.
    const b = await armazenamentoSqlite(driver);
    expect(await b.colecao<{ n: number }>('fila').ler('cmd-1')).toEqual({ n: 1 });
    await driver.fechar();
  });

  it('subir o esquema duas vezes não é erro — é o caminho normal de toda abertura', async () => {
    const driver = driverNodeSqlite();
    await armazenamentoSqlite(driver);
    await armazenamentoSqlite(driver);
    await armazenamentoSqlite(driver);
    await driver.fechar();
  });

  it('a chave composta impede duas linhas para a mesma coleção e chave', async () => {
    // É a garantia que sustenta a regra 2 no SQLite: sem a chave composta, o
    // `ON CONFLICT` não teria em que se apoiar e "gravar por cima" viraria
    // "gravar mais uma".
    const driver = driverNodeSqlite();
    const a = await armazenamentoSqlite(driver);
    const c = a.colecao<{ v: number }>('meta');
    await c.gravar('k', { v: 1 });
    await c.gravar('k', { v: 2 });
    await c.gravar('k', { v: 3 });

    const linhas = await driver.consultar<{ total: number }>(
      'SELECT count(*) AS total FROM registros WHERE colecao = ? AND chave = ?',
      ['meta', 'k']
    );
    expect(linhas[0]!.total).toBe(1);
    expect(await c.ler('k')).toEqual({ v: 3 });
    await driver.fechar();
  });
});
