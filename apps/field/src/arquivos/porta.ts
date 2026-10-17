/**
 * Aurora — os bytes das fotos, separados de tudo o mais (SPEC §20 · EPIC-014).
 *
 * TRÊS COISAS DIFERENTES, TRÊS LUGARES DIFERENTES
 *
 *   1. o METADADO do anexo — nome, tipo, tamanho, hash, finalidade — vive na
 *      base local, na coleção `anexos`;
 *   2. o ESTADO DO ENVIO — quanto já subiu, quantas tentativas, qual erro, qual
 *      chave o servidor deu — vive no mesmo registro, porque é sobre o anexo;
 *   3. os BYTES vivem aqui, num adaptador de arquivos.
 *
 * Juntar os três seria o caminho curto, e ele custa caro em campo. Um blob de
 * dez megabytes dentro do registro faz toda leitura da lista de anexos carregar
 * as fotos inteiras para a memória — num aparelho com dois gigabytes, com o
 * navegador e mais o aplicativo, isso derruba a aba. E no empacotamento nativo
 * encheria a base de dados com o que pertence ao sistema de arquivos, que é
 * onde o Android e o iOS sabem cuidar de arquivo grande.
 *
 * A SEPARAÇÃO TAMBÉM É O QUE TORNA O ENVIO RETOMÁVEL POSSÍVEL. Retomar exige
 * ler um PEDAÇO do arquivo a partir de um deslocamento; um blob dentro de um
 * registro JSON não tem pedaço, tem tudo ou nada.
 *
 * O CASO DE BORDA QUE A SPEC LISTA: "dispositivo sem espaço para as fotos".
 * Por isso o adaptador sabe dizer quanto cabe — e por isso `guardar` pode
 * falhar de um jeito que o aplicativo consegue explicar, em vez de estourar
 * numa transação de banco.
 */

import type { Identidade } from '../fila';

/** Uma referência opaca ao arquivo dentro do adaptador. */
export type ReferenciaDeArquivo = string;

export interface AdaptadorDeArquivos {
  /** Identifica a implementação nos diagnósticos do aparelho. */
  readonly nome: string;

  guardar(ref: ReferenciaDeArquivo, bytes: Uint8Array, tipo: string): Promise<void>;

  /**
   * Um PEDAÇO do arquivo, para o envio retomável.
   *
   * `fim` é exclusivo, como em `slice`. Pedir além do fim devolve o que houver
   * — e não é erro: a última fatia de um arquivo quase sempre é menor que as
   * outras, e transformar isso em exceção obrigaria quem chama a calcular o
   * resto, que é onde o erro de um byte mora.
   */
  fatia(ref: ReferenciaDeArquivo, inicio: number, fim: number): Promise<Uint8Array>;

  /** `undefined` quando não existe. Nunca lança por ausência. */
  tamanho(ref: ReferenciaDeArquivo): Promise<number | undefined>;

  apagar(ref: ReferenciaDeArquivo): Promise<void>;

  /**
   * Quanto ainda cabe, em bytes, ou `null` quando a plataforma não sabe dizer.
   *
   * `null` é uma resposta legítima e precisa ser tratada como tal: o navegador
   * dá uma estimativa, o aparelho dá o número real, e um dos dois pode não
   * responder. Chutar um valor aqui faria a tela prometer espaço que não existe.
   */
  espacoLivre(): Promise<number | null>;
}

/** O que o técnico capturou e ainda não chegou ao servidor. */
export interface AnexoPendente {
  /**
   * Gerado no aparelho, no momento da captura — e é também o
   * `client_operation_id` do comando que REGISTRA o anexo no servidor.
   *
   * Um identificador só para as duas coisas mantém a correspondência óbvia
   * entre a foto no aparelho e a linha no banco, inclusive seis meses depois.
   */
  id: string;
  /** `work_order:<uuid>` — o mesmo agregado que sequencia a fila. */
  agregado: string;
  workOrderId: string;
  /** `before`, `after`, `signature`… — a finalidade do domínio. */
  finalidade: string;
  nomeDoArquivo: string;
  tipo: string;
  bytes: number;
  /**
   * SHA-256 do conteúdo, calculado no aparelho.
   *
   * Serve a duas coisas: o servidor confere que recebeu o que foi enviado, e a
   * retomada confere que está continuando o MESMO arquivo — sem isso, um envio
   * retomado depois de a foto ser substituída juntaria metade de uma com
   * metade da outra.
   */
  sha256: string;
  estado: 'capturado' | 'registrado' | 'enviando' | 'enviado' | 'falhou';
  /** Quantos bytes já subiram. É o ponto de retomada. */
  enviados: number;
  tentativas: number;
  ultimoErro: string | null;
  /** Onde o servidor quer o arquivo. Só existe depois do registro. */
  chaveNoServidor: string | null;
  /**
   * O IDENTIFICADOR QUE O SERVIDOR DEU A ESTE ANEXO — que NÃO é o `id` daqui.
   *
   * O `id` local é do aparelho e serve de `client_operation_id`; a linha no
   * banco tem chave própria, escolhida lá. Quem precisa apontar para o anexo —
   * a assinatura, que carrega `attachment_id` — precisa DESTE, e não daquele.
   *
   * Mandar o identificador local foi exatamente o defeito que o teste de
   * sobrevivência offline encontrou: a assinatura era recusada pela chave
   * estrangeira (`sig_attachment_org_fk`) depois de o dia inteiro de trabalho
   * já ter sido feito, e ia parar na tela de atenção sem que ninguém
   * entendesse por quê.
   *
   * Nulo enquanto o registro não voltou do servidor.
   */
  idNoServidor: string | null;
  /** Onde os bytes estão, no adaptador de arquivos. */
  referenciaLocal: ReferenciaDeArquivo;
  criadoEm: string;
  /**
   * DE QUEM É A FOTO — a mesma marca dos comandos (`Identidade` em `fila.ts`,
   * pente-fino PF-66).
   *
   * Sem ela, os bytes eram enviados com a credencial de quem estivesse logado
   * na hora do ENVIO: a foto que Ana tirou às 15h subia às 19h na sessão de
   * Bruno, ou na organização errada. Foto de outra sessão fica guardada,
   * intacta, e sobe quando o dono entrar de novo. Ausente nas fotos gravadas
   * antes desta versão — tratadas como da sessão atual (`mesmaIdentidade`).
   */
  identidade?: Identidade;
}

/**
 * O tamanho da fatia do envio retomável.
 *
 * 256 kB é um meio-termo com razão: fatia pequena demais multiplica as idas de
 * rede e o custo por requisição domina; fatia grande demais faz cada falha
 * jogar fora muito trabalho, e numa rede de hospital as falhas são a regra.
 *
 * O número é daqui e não do servidor porque quem sofre a falha é o aparelho.
 */
export const TAMANHO_DA_FATIA = 256 * 1024;
