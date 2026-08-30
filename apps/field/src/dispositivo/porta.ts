/**
 * Aurora — os recursos do aparelho, atrás de portas (EPIC-014).
 *
 * NENHUMA TELA IMPORTA UM PLUGIN. É a regra que este arquivo existe para impor.
 *
 * Uma tela que chama `Camera.getPhoto()` direto passa a existir em duas
 * versões: a do navegador e a do aplicativo. As duas divergem — sempre na
 * mesma direção, com a menos usada ficando para trás —, e a menos usada é a de
 * campo, que ninguém consegue reproduzir da mesa.
 *
 * Com portas, a tela pede "uma foto" e recebe uma foto. Quem sabe se isso é
 * `<input type="file" capture>` ou a câmera nativa é o adaptador, e ele é
 * escolhido uma vez, no arranque.
 *
 * TODA PORTA SABE DIZER QUE NÃO EXISTE
 *
 * `disponivel()` está em todas de propósito. Um navegador sem leitor de código,
 * um aparelho sem câmera, um ambiente sem notificação — todos são estados
 * normais, e a tela precisa poder oferecer o caminho alternativo em vez de um
 * botão que falha quando tocado. Um recurso indisponível descoberto no toque é
 * um recurso que frustra; descoberto antes, é um botão que não aparece.
 */

/* -------------------------------------------------------------------------- */
/* câmera                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O que uma captura produz, igual nas três plataformas.
 *
 * Bytes crus e não `File` nem `Blob`: `File` é do navegador, e o aparelho
 * devolve base64 ou caminho. Escolher o menor denominador aqui é o que faz o
 * anexo pendente ter a MESMA forma venha de onde vier — que é o requisito.
 */
export interface FotoCapturada {
  bytes: Uint8Array;
  tipo: string;
  /** Sugestão de nome; quem grava decide o definitivo. */
  nomeSugerido: string;
  largura: number | null;
  altura: number | null;
}

export interface AdaptadorDeCamera {
  readonly nome: string;
  disponivel(): Promise<boolean>;
  /**
   * Devolve `null` quando a pessoa DESISTE — e isso não é erro.
   *
   * Fechar a câmera sem tirar foto é uma decisão legítima, e tratá-la como
   * exceção faria a tela mostrar "falha ao capturar" para quem simplesmente
   * mudou de ideia.
   */
  capturar(opcoes?: { qualidade?: number; larguraMaxima?: number }): Promise<FotoCapturada | null>;
}

/* -------------------------------------------------------------------------- */
/* leitura de código                                                           */
/* -------------------------------------------------------------------------- */

export interface CodigoLido {
  valor: string;
  /** `qr_code`, `code_128`… quando a plataforma souber dizer. */
  formato: string | null;
}

export interface AdaptadorDeLeituraDeCodigo {
  readonly nome: string;
  disponivel(): Promise<boolean>;
  /** `null` quando a pessoa fecha o leitor sem ler nada. */
  ler(): Promise<CodigoLido | null>;
}

/* -------------------------------------------------------------------------- */
/* rede                                                                        */
/* -------------------------------------------------------------------------- */

export interface EstadoDaRede {
  /**
   * O que o SISTEMA acha. Não é a verdade sobre a API.
   *
   * Um wi-fi de hospital conectado a um portal cativo diz `true` e não roteia
   * nada. Uma VPN pode dizer `false` com a API perfeitamente alcançável. Por
   * isso este campo NUNCA decide se vale a pena tentar sincronizar: ele é um
   * gatilho e uma informação para a tela.
   *
   * Quem sabe se a API está alcançável é a fila, porque ela tentou.
   */
  conectado: boolean;
  /** `wifi`, `cellular`, `none`, ou `null` quando a plataforma não diz. */
  tipo: string | null;
}

export interface AdaptadorDeRede {
  readonly nome: string;
  estado(): Promise<EstadoDaRede>;
  /** Devolve a função que cancela a inscrição. */
  aoMudar(ouvinte: (e: EstadoDaRede) => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* notificação empurrada                                                       */
/* -------------------------------------------------------------------------- */

export interface AdaptadorDePush {
  readonly nome: string;
  disponivel(): Promise<boolean>;
  /** `false` quando a pessoa recusa — e recusar é uma resposta, não uma falha. */
  pedirPermissao(): Promise<boolean>;
  /** O identificador que o servidor usaria para alcançar este aparelho. */
  registrar(): Promise<string | null>;
}

/* -------------------------------------------------------------------------- */
/* o conjunto                                                                  */
/* -------------------------------------------------------------------------- */

export type Plataforma = 'web' | 'android' | 'ios';

export interface Dispositivo {
  readonly plataforma: Plataforma;
  /** `true` dentro do aplicativo empacotado; `false` no navegador. */
  readonly nativo: boolean;
  camera: AdaptadorDeCamera;
  leitorDeCodigo: AdaptadorDeLeituraDeCodigo;
  rede: AdaptadorDeRede;
  push: AdaptadorDePush;
}
