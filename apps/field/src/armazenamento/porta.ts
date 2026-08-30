/**
 * Aurora — a porta de persistência do aparelho (SPEC v0.2 §20 · EPIC-014).
 *
 * POR QUE ESTE ARQUIVO É UMA PORTA, E NÃO UM ARQUIVO DE IndexedDB
 *
 * O Aurora Field é distribuído de três formas — navegador, Android e iOS — e as
 * três guardam dado de jeitos diferentes: IndexedDB no navegador, SQLite nativo
 * no aparelho. Se a fila, a sincronização ou uma tela chamassem o IndexedDB
 * direto, cada uma delas teria de ser reescrita para o empacotamento nativo — e
 * a versão reescrita divergiria da original em algum detalhe que ninguém
 * notaria até um técnico perder um dia de trabalho.
 *
 * Então existe uma porta. Nenhum caso de uso conhece o mecanismo.
 *
 * A SEMÂNTICA É PARTE DO CONTRATO, e não detalhe de implementação. Duas
 * implementações que satisfazem os TIPOS e discordam do comportamento são pior
 * do que uma só: a diferença aparece num aparelho, em campo, e não na máquina
 * de quem escreveu. Por isso as regras abaixo são verificadas por uma suíte de
 * conformidade que TODO adaptador precisa passar — `conformidade.ts`.
 *
 * AS SETE REGRAS
 *
 *  1. Ler uma chave que não existe devolve `undefined`. Nunca lança.
 *  2. Gravar sobre uma chave existente substitui o valor inteiro.
 *  3. O que sai é uma CÓPIA. Alterar o objeto lido não altera o guardado.
 *  4. Coleções são isoladas: a mesma chave em duas coleções são dois valores.
 *  5. `limpar()` esvazia uma coleção e não toca nas outras.
 *  6. `apagar()` de chave inexistente não é erro.
 *  7. SÓ JSON ATRAVESSA. Ver a nota abaixo — é a regra que mais dói descobrir
 *     tarde.
 *
 * SÓ JSON, E POR QUÊ ISSO É UMA DECISÃO E NÃO UMA LIMITAÇÃO
 *
 * O IndexedDB guarda `Date`, `Map`, `Set` e `undefined` dentro de objetos, por
 * clonagem estruturada. O SQLite guarda texto. Se o domínio pudesse gravar uma
 * `Date`, ele funcionaria no navegador e devolveria uma string no aparelho — e o
 * defeito apareceria como uma data formatada errado numa OS, em campo, sem
 * nenhuma pista de que a causa é o empacotamento.
 *
 * A porta portanto ADMITE apenas o que o JSON representa. É restritivo de
 * propósito: o que o domínio já faz — instantes em ISO 8601, números, texto,
 * booleanos, listas e objetos — cabe inteiro, e o que não cabe é justamente o
 * que quebraria em silêncio.
 */

/** Uma coleção de registros com chave de texto. */
export interface Colecao<T> {
  ler(chave: string): Promise<T | undefined>;
  gravar(chave: string, valor: T): Promise<void>;
  apagar(chave: string): Promise<void>;
  todos(): Promise<T[]>;
  limpar(): Promise<void>;
}

export interface ArmazenamentoOffline {
  /** O nome identifica a implementação nos diagnósticos do aparelho. */
  readonly nome: string;
  colecao<T>(nome: string): Colecao<T>;
  fechar(): Promise<void>;
}

/**
 * As coleções são declaradas aqui, e não criadas sob demanda.
 *
 * O IndexedDB só permite criar `objectStore` durante o `upgradeneeded`; criar
 * uma coleção depois exigiria subir a versão e reabrir o banco no meio do
 * trabalho, com dados dentro. A lista fechada evita isso — e tem a virtude de
 * dizer, num lugar só, tudo que o aparelho guarda.
 *
 * O adaptador de SQLite não teria essa restrição, mas obedece à mesma lista: a
 * porta existe justamente para que as duas plataformas não divirjam no que
 * conseguem fazer.
 */
export const COLECOES = [
  'ordens',
  'ativos',
  'locais',
  'checklists',
  'catalogos',
  'situacoes',
  'transicoes',
  'motivos',
  'estoque',
  /** A fila de saída. É a coleção que não pode perder um registro. */
  'fila',
  /** O que o servidor recusou, esperando decisão de gente. */
  'atencao',
  /**
   * Os ANEXOS, só os metadados.
   *
   * Os bytes da foto NÃO moram aqui — ver `arquivos.ts`. Guardar blob de dez
   * megabytes junto com o registro faria toda leitura da lista de anexos
   * carregar as fotos inteiras para a memória, e no aparelho nativo encheria a
   * base de dados com o que pertence ao sistema de arquivos.
   */
  'anexos',
  /**
   * O QUE O TÉCNICO DIGITOU E AINDA NÃO ENVIOU.
   *
   * Diagnóstico, resolução, nome de quem assina, quantidade de peça. São campos
   * de formulário — não são comandos, e por isso não pertencem à fila: enfileirar
   * cada tecla produziria centenas de operações para um texto que ainda está
   * sendo escrito.
   *
   * Mas eles precisam SOBREVIVER, e é isso que esta coleção existe para
   * garantir. Guardá-los só na memória do React significa perdê-los quando o
   * sistema derrubar o aplicativo — que é o comportamento normal de um celular
   * com pouca memória, e acontece no meio de uma OS, sem aviso.
   *
   * O critério do épico é literal: fechar o aplicativo, reabrir ainda offline, e
   * TUDO continuar lá.
   */
  'rascunhos',
  /** Marcas: último `synced_at`, identidade, versão do pacote. */
  'meta',
] as const;

export type NomeDeColecao = (typeof COLECOES)[number];

/**
 * A cópia que a regra 3 exige, feita do jeito que a porta admite.
 *
 * `JSON.parse(JSON.stringify(x))` e não `structuredClone`: é exatamente a
 * conversão que o adaptador de SQLite faz ao gravar, e usá-la também na
 * memória e nas asserções faz o adaptador de teste ter as MESMAS perdas que o
 * de produção. Um auxiliar mais generoso esconderia a regra 7 em vez de
 * exercitá-la.
 */
export function copiaJson<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor ?? null)) as T;
}
