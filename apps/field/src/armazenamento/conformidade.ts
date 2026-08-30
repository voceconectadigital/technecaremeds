/**
 * Aurora — a suíte de conformidade da porta de persistência (EPIC-014).
 *
 * TODO ADAPTADOR PASSA POR AQUI, E É ISSO QUE TORNA A PORTA VERDADE.
 *
 * Uma porta declarada em TypeScript garante que as duas implementações têm as
 * mesmas assinaturas. Não garante que elas se comportam igual — e é o
 * comportamento que a fila, a sincronização e as telas assumem. Duas
 * implementações que compilam e discordam são pior do que uma só: a diferença
 * aparece num aparelho, em campo, longe de quem escreveu.
 *
 * Esta suíte é escrita UMA VEZ e executada contra cada adaptador:
 *
 *   · memória e SQLite, no Vitest, contra `node:sqlite` de verdade;
 *   · IndexedDB, no navegador de verdade, pela tela de diagnóstico do aparelho.
 *
 * ELA NÃO USA VITEST DE PROPÓSITO. Se dependesse de `expect`, não poderia rodar
 * dentro do aplicativo — e o diagnóstico que o técnico aciona no aparelho dele,
 * que é onde o defeito de plataforma realmente mora, não existiria.
 */
import type { ArmazenamentoOffline } from './porta';

export interface ResultadoDeConformidade {
  regra: string;
  passou: boolean;
  detalhe: string | null;
}

/**
 * Cria um armazenamento LIMPO. Chamada uma vez por regra, com o número dela.
 *
 * O número existe porque "limpo" não é grátis em toda plataforma. Em memória e
 * no SQLite, cada chamada devolve um armazenamento novo; no IndexedDB, abrir a
 * mesma base de novo devolve a base ANTERIOR, com o que a regra passada
 * escreveu dentro.
 *
 * Foi assim que a suíte reprovou duas regras no navegador de verdade sem que o
 * IndexedDB tivesse nada de errado: a regra 5 encontrava o registro que a 4
 * tinha deixado. Passar o número permite a quem chama dar um nome distinto por
 * regra — e faz o requisito ficar visível na assinatura, em vez de escondido
 * num comentário que a implementação seguinte não vai ler.
 */
export type FabricaDeArmazenamento = (regra: number) => Promise<ArmazenamentoOffline>;

interface Regra {
  nome: string;
  /** Lança com a explicação quando reprova. */
  executar(a: ArmazenamentoOffline): Promise<void>;
}

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new Error(mensagem);
}

function iguais(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * As sete regras da porta, na ordem em que estão documentadas nela.
 *
 * Cada uma tem nome legível porque elas aparecem na tela de diagnóstico do
 * aparelho: quando uma reprova num Android específico, o técnico lê "cópia na
 * leitura" e o suporte sabe o que procurar — em vez de "regra 3".
 */
export const REGRAS: Regra[] = [
  {
    nome: '1 · ler chave inexistente devolve vazio, e não lança',
    async executar(a) {
      const v = await a.colecao<{ x: number }>('meta').ler('nao-existe');
      exigir(v === undefined, `esperava undefined, veio ${JSON.stringify(v)}`);
    },
  },
  {
    nome: '2 · gravar por cima substitui o valor inteiro',
    async executar(a) {
      const c = a.colecao<Record<string, unknown>>('meta');
      await c.gravar('k', { a: 1, b: 2 });
      await c.gravar('k', { a: 9 });
      const v = await c.ler('k');
      exigir(iguais(v, { a: 9 }), `esperava {"a":9}, veio ${JSON.stringify(v)}`);
    },
  },
  {
    nome: '3 · o que sai é cópia: alterar o lido não altera o guardado',
    async executar(a) {
      /*
       * A regra que mais economiza depuração. Sem ela, uma tela que ordena a
       * lista lida estaria reordenando o que está no disco — e o defeito
       * apareceria como "a fila mudou de ordem sozinha".
       */
      const c = a.colecao<{ lista: number[] }>('meta');
      await c.gravar('k', { lista: [1, 2, 3] });
      const lido = (await c.ler('k'))!;
      lido.lista.push(99);
      const denovo = await c.ler('k');
      exigir(
        iguais(denovo, { lista: [1, 2, 3] }),
        `o guardado mudou junto com o lido: ${JSON.stringify(denovo)}`
      );
    },
  },
  {
    nome: '4 · coleções são isoladas: a mesma chave em duas é dois valores',
    async executar(a) {
      await a.colecao<{ de: string }>('ordens').gravar('mesma', { de: 'ordens' });
      await a.colecao<{ de: string }>('fila').gravar('mesma', { de: 'fila' });
      const daOrdem = await a.colecao<{ de: string }>('ordens').ler('mesma');
      const daFila = await a.colecao<{ de: string }>('fila').ler('mesma');
      exigir(
        iguais(daOrdem, { de: 'ordens' }) && iguais(daFila, { de: 'fila' }),
        `vazou entre coleções: ${JSON.stringify({ daOrdem, daFila })}`
      );
    },
  },
  {
    nome: '5 · limpar esvazia uma coleção e não toca nas outras',
    async executar(a) {
      await a.colecao<{ n: number }>('ordens').gravar('1', { n: 1 });
      await a.colecao<{ n: number }>('fila').gravar('1', { n: 1 });
      await a.colecao('ordens').limpar();
      exigir((await a.colecao('ordens').todos()).length === 0, 'ordens deveria estar vazia');
      exigir((await a.colecao('fila').todos()).length === 1, 'fila não deveria ter sido limpa');
    },
  },
  {
    nome: '6 · apagar chave inexistente não é erro',
    async executar(a) {
      await a.colecao('meta').apagar('nunca-existiu');
    },
  },
  {
    nome: '7 · só JSON atravessa, e o que não atravessa é recusado ou perdido igual',
    async executar(a) {
      /*
       * A REGRA QUE MAIS DÓI DESCOBRIR TARDE.
       *
       * O IndexedDB guardaria uma `Date` e devolveria uma `Date`; o SQLite
       * guarda texto. Um domínio que dependesse disso funcionaria no navegador
       * e mostraria data errada no aplicativo da loja — sem nenhuma pista de
       * que a causa é o empacotamento.
       *
       * A porta impõe a conversão JSON em TODOS os adaptadores, inclusive nos
       * que não precisariam dela. O teste confirma que a perda é a mesma nos
       * dois: `Date` vira texto ISO, `undefined` some do objeto.
       */
      const c = a.colecao<Record<string, unknown>>('meta');
      await c.gravar('tipos', {
        texto: 'ação — acentuado, com “aspas” e emoji 🔧',
        numero: 12.5,
        zero: 0,
        booleano: false,
        nulo: null,
        lista: [1, 'dois', { tres: true }],
        aninhado: { a: { b: { c: 'fundo' } } },
        data: new Date('2026-08-29T12:00:00.000Z'),
        ausente: undefined,
      });
      const v = (await c.ler('tipos'))!;

      exigir(v.texto === 'ação — acentuado, com “aspas” e emoji 🔧', 'texto não sobreviveu');
      exigir(v.numero === 12.5 && v.zero === 0, 'número não sobreviveu');
      exigir(v.booleano === false, 'booleano falso virou outra coisa');
      exigir(v.nulo === null, 'nulo não sobreviveu');
      exigir(iguais(v.lista, [1, 'dois', { tres: true }]), 'lista não sobreviveu');
      exigir(iguais(v.aninhado, { a: { b: { c: 'fundo' } } }), 'aninhamento não sobreviveu');
      exigir(
        v.data === '2026-08-29T12:00:00.000Z',
        `Date precisa virar texto ISO em TODA plataforma; veio ${JSON.stringify(v.data)}`
      );
      exigir(!('ausente' in v), '`undefined` precisa sumir do objeto em toda plataforma');
    },
  },
  {
    nome: '8 · todos() devolve o que foi gravado, e nada além',
    async executar(a) {
      const c = a.colecao<{ n: number }>('fila');
      for (let i = 1; i <= 5; i++) await c.gravar(`k${i}`, { n: i });
      await c.apagar('k3');
      const todos = await c.todos();
      const ns = todos.map((x) => x.n).sort((x, y) => x - y);
      exigir(iguais(ns, [1, 2, 4, 5]), `esperava [1,2,4,5], veio ${JSON.stringify(ns)}`);
    },
  },
];

/**
 * Roda as regras contra um adaptador. Uma instância LIMPA por regra.
 *
 * Reaproveitar a mesma faria uma regra herdar o estado da anterior — e a que
 * reprovasse seria a seguinte, apontando para o lugar errado.
 */
export async function conferirConformidade(
  fabrica: FabricaDeArmazenamento
): Promise<ResultadoDeConformidade[]> {
  const resultados: ResultadoDeConformidade[] = [];

  for (const [i, regra] of REGRAS.entries()) {
    const a = await fabrica(i);
    try {
      await regra.executar(a);
      resultados.push({ regra: regra.nome, passou: true, detalhe: null });
    } catch (e) {
      resultados.push({
        regra: regra.nome,
        passou: false,
        detalhe: e instanceof Error ? e.message : String(e),
      });
    } finally {
      await a.fechar().catch(() => undefined);
    }
  }

  return resultados;
}
