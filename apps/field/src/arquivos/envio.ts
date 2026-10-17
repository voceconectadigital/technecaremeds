/**
 * Aurora — o envio retomável das fotos (SPEC §20 · EPIC-014).
 *
 * DUAS COISAS ACONTECEM COM UM ANEXO, E ELAS SÃO SEPARADAS.
 *
 *  1. O REGISTRO — `POST /work-orders/:id/attachments` — vai pela fila normal,
 *     com `client_operation_id`, idempotente como todo comando. O servidor
 *     devolve a chave de armazenamento: é ele quem decide onde o arquivo mora,
 *     nunca o cliente.
 *  2. OS BYTES sobem por aqui, em fatias, direto para o armazenamento.
 *
 * Passar o arquivo pela API transformaria cada foto de campo — em rede de
 * hospital, pelo celular — numa requisição que pode morrer no meio sem deixar
 * rastro nem do envio. Já era assim antes deste épico; o que muda é que agora
 * a morte no meio é RETOMÁVEL.
 *
 * O QUE TORNA RETOMÁVEL DE VERDADE
 *
 * O progresso é gravado no registro do anexo DEPOIS de cada fatia aceita, e não
 * ao fim do envio. Gravar no fim faria uma interrupção aos noventa por cento
 * recomeçar do zero — que numa foto de oito megabytes em rede de hospital é a
 * diferença entre chegar e não chegar.
 *
 * E o `sha256` viaja em toda fatia. Sem ele, retomar depois de a foto ter sido
 * substituída juntaria metade de uma com metade da outra, e o resultado seria
 * um arquivo corrompido que ninguém saberia explicar.
 */
import { TAMANHO_DA_FATIA, type AdaptadorDeArquivos, type AnexoPendente } from './porta';
import type { Colecao } from '../armazenamento';
import { mesmaIdentidade, type Identidade } from '../fila';

export interface RespostaDaFatia {
  status: number;
  /** Quanto o servidor diz ter agora. É ele quem manda, e não o cliente. */
  recebidos?: number;
}

export interface DependenciasDoEnvio {
  /**
   * Sobe uma fatia. Quem implementa decide o transporte.
   *
   * O `offset` vai junto porque o servidor precisa saber onde encaixar — e
   * porque é ele quem confirma quanto tem, no retorno. Confiar na contagem do
   * cliente faria duas retomadas concorrentes escreverem por cima uma da outra.
   */
  enviarFatia(entrada: {
    anexo: AnexoPendente;
    offset: number;
    pedaco: Uint8Array;
    ultima: boolean;
  }): Promise<RespostaDaFatia>;
  agora(): Date;
  /**
   * A identidade da sessão ATUAL (PF-66). Só sobem as fotos dela — ver
   * `AnexoPendente.identidade`. Sem esta dependência, sobem todas (o que a
   * versão anterior fazia).
   */
  identidade?(): Identidade | null;
}

const MAX_TENTATIVAS_POR_RODADA = 3;

export interface ResultadoDoEnvio {
  enviados: number;
  falharam: number;
  bytesSubidos: number;
  /** Fotos guardadas por OUTRA sessão: ficaram no aparelho, intactas. */
  deOutraSessao: number;
}

/**
 * Sobe o que der, e para no primeiro sinal de que não vai dar.
 *
 * Devolve o que aconteceu para a tela poder dizer — "3 de 7 fotos enviadas" é
 * informação; "sincronizando" não é.
 */
export async function enviarAnexosPendentes(
  anexos: Colecao<AnexoPendente>,
  arquivos: AdaptadorDeArquivos,
  deps: DependenciasDoEnvio
): Promise<ResultadoDoEnvio> {
  const todos = await anexos.todos();
  let enviados = 0;
  let falharam = 0;
  let bytesSubidos = 0;

  /*
   * SÓ OS JÁ REGISTRADOS SOBEM.
   *
   * Sem a chave do servidor não há para onde mandar. Um anexo capturado cujo
   * comando de registro ainda está na fila espera — e é a fila, não este
   * arquivo, que garante que o registro chega.
   */
  const candidatos = todos.filter((a) => a.chaveNoServidor !== null && a.estado !== 'enviado');

  /*
   * FOTO DE OUTRA SESSÃO NÃO SOBE COM A CREDENCIAL DESTA (PF-66).
   *
   * É a mesma regra da fila de comandos: o servidor aceitaria, porque para ele
   * é um pedido válido de quem está logado — e a foto de Ana entraria como de
   * Bruno, ou na organização errada. Ela NÃO é apagada nem marcada como
   * falha: fica como está, e sobe quando o dono entrar de novo.
   */
  const atual = deps.identidade?.() ?? null;
  const prontos = candidatos
    .filter((a) => mesmaIdentidade(a.identidade, atual))
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const deOutraSessao = candidatos.length - prontos.length;

  for (const anexo of prontos) {
    const tamanho = await arquivos.tamanho(anexo.referenciaLocal);

    if (tamanho === undefined) {
      /*
       * OS BYTES SUMIRAM — o sistema recuperou espaço, ou alguém limpou os
       * dados do aplicativo.
       *
       * O registro NÃO é apagado: ele vira `falhou` com o motivo escrito. A
       * pessoa precisa saber que aquela foto não existe mais, porque só ela
       * sabe se dá para tirar outra. Apagar em silêncio seria descartar
       * trabalho — a coisa que este produto não faz.
       */
      await anexos.gravar(anexo.id, {
        ...anexo,
        estado: 'falhou',
        ultimoErro: 'os bytes desta foto não estão mais no aparelho',
      });
      falharam++;
      continue;
    }

    // O tipo anotado é o do próprio anexo: com `as const` o estado ficaria
    // preso em 'enviando' e as transições seguintes não compilariam.
    let atual: AnexoPendente = { ...anexo, estado: 'enviando' };
    await anexos.gravar(atual.id, atual);

    let tentativasNestaRodada = 0;
    let deuCerto = true;

    while (atual.enviados < tamanho) {
      const inicio = atual.enviados;
      const fim = Math.min(inicio + TAMANHO_DA_FATIA, tamanho);
      const pedaco = await arquivos.fatia(atual.referenciaLocal, inicio, fim);

      let r: RespostaDaFatia;
      try {
        r = await deps.enviarFatia({ anexo: atual, offset: inicio, pedaco, ultima: fim >= tamanho });
      } catch (e) {
        atual = {
          ...atual,
          estado: 'falhou',
          tentativas: atual.tentativas + 1,
          ultimoErro: e instanceof Error ? e.message : 'falha de rede ao enviar a foto',
        };
        await anexos.gravar(atual.id, atual);
        deuCerto = false;
        break;
      }

      if (r.status >= 200 && r.status < 300) {
        /*
         * O SERVIDOR DIZ QUANTO TEM, e é o número dele que vale.
         *
         * Somar a fatia localmente parece equivalente e não é: se uma fatia
         * chegou duas vezes — retentativa depois de um tempo-limite que na
         * verdade tinha chegado —, a conta do cliente passaria do tamanho do
         * arquivo e o envio nunca terminaria.
         */
        atual = { ...atual, enviados: r.recebidos ?? fim, ultimoErro: null };
        bytesSubidos += pedaco.byteLength;
        // A GRAVAÇÃO É POR FATIA. Ver a nota do cabeçalho.
        await anexos.gravar(atual.id, atual);
        tentativasNestaRodada = 0;
        continue;
      }

      if (r.status === 409) {
        /*
         * 409 NÃO É FALHA: é o servidor dizendo qual é a conta dele.
         *
         * Acontece o tempo todo em rede ruim — a fatia chegou e a confirmação
         * se perdeu no elevador. O aparelho tentou de novo do ponto que ele
         * achava, e o servidor respondeu "eu já tenho mais do que isso".
         *
         * A versão anterior lia 409 como "o arquivo inteiro já está lá" e dava
         * o envio por concluído. Quando o desencontro era no MEIO do arquivo,
         * ela marcava como enviada uma foto que o servidor tinha pela metade —
         * exatamente a perda silenciosa que este produto não faz.
         *
         * O certo é alinhar-se ao número dele e continuar dali. Se o número já
         * cobre o arquivo, acabou de verdade.
         */
        const recebidos = r.recebidos ?? tamanho;
        const andou = Math.min(recebidos, tamanho) !== atual.enviados;
        atual = { ...atual, enviados: Math.min(recebidos, tamanho), ultimoErro: null };
        await anexos.gravar(atual.id, atual);
        if (atual.enviados >= tamanho) break;
        /*
         * Realinhar não conta tentativa QUANDO ANDA: não houve falha nenhuma, e
         * contar empurraria para "falhou" um envio que está indo bem.
         *
         * Quando NÃO anda, conta. Um servidor que responde 409 sempre com o
         * mesmo número — por defeito dele, ou por uma fatia que ele recusa em
         * silêncio — faria este laço girar para sempre, gastando bateria e rede
         * do técnico sem nunca terminar. O teto por rodada é a saída.
         */
        if (andou) continue;
        tentativasNestaRodada++;
        if (tentativasNestaRodada >= MAX_TENTATIVAS_POR_RODADA) {
          atual = {
            ...atual,
            estado: 'falhou',
            tentativas: atual.tentativas + 1,
            ultimoErro: `o servidor não avança do byte ${atual.enviados}`,
          };
          await anexos.gravar(atual.id, atual);
          deuCerto = false;
          break;
        }
        continue;
      }

      tentativasNestaRodada++;
      atual = {
        ...atual,
        tentativas: atual.tentativas + 1,
        ultimoErro: `o servidor respondeu ${r.status} ao receber a foto`,
      };
      await anexos.gravar(atual.id, atual);

      if (tentativasNestaRodada >= MAX_TENTATIVAS_POR_RODADA) {
        /*
         * Para esta RODADA, e não para sempre.
         *
         * O anexo continua na coleção, com o progresso guardado. A próxima
         * sincronização retoma exatamente do byte onde parou — que é a
         * diferença entre "falhou" e "perdeu".
         */
        atual = { ...atual, estado: 'falhou' };
        await anexos.gravar(atual.id, atual);
        deuCerto = false;
        break;
      }
    }

    if (deuCerto && atual.enviados >= tamanho) {
      await anexos.gravar(atual.id, { ...atual, estado: 'enviado', ultimoErro: null });
      /*
       * OS BYTES SÓ SÃO APAGADOS DEPOIS DE O SERVIDOR CONFIRMAR.
       *
       * É a mesma regra da fila de comandos: nada some do aparelho sem
       * resposta. Apagar antes liberaria espaço mais cedo e transformaria uma
       * confirmação perdida em foto perdida.
       */
      await arquivos.apagar(atual.referenciaLocal);
      enviados++;
    } else if (!deuCerto) {
      falharam++;
    }
  }

  return { enviados, falharam, bytesSubidos, deOutraSessao };
}

/**
 * O que a tela mostra sobre as fotos que ainda não chegaram.
 *
 * Separa "esperando" de "falhou" pelo mesmo motivo que o indicador da fila
 * separa pendente de parado: um é um dia normal, o outro precisa de gente.
 */
export interface EstadoDosAnexos {
  pendentes: number;
  falhados: number;
  bytesPendentes: number;
  /** 0 a 1, ou `null` quando não há nada pendente. */
  progresso: number | null;
  /**
   * Fotos que ainda não subiram e são de OUTRA sessão (PF-66). Ficam fora das
   * contas acima: não vão subir agora, e somá-las faria a barra de progresso
   * nunca terminar para quem está logado.
   */
  deOutraSessao: number;
}

export async function estadoDosAnexos(
  anexos: Colecao<AnexoPendente>,
  identidade: Identidade | null = null
): Promise<EstadoDosAnexos> {
  const naoEnviados = (await anexos.todos()).filter((a) => a.estado !== 'enviado');
  const todos = naoEnviados.filter((a) => mesmaIdentidade(a.identidade, identidade));
  const total = todos.reduce((t, a) => t + a.bytes, 0);
  const subido = todos.reduce((t, a) => t + a.enviados, 0);
  return {
    pendentes: todos.filter((a) => a.estado !== 'falhou').length,
    falhados: todos.filter((a) => a.estado === 'falhou').length,
    bytesPendentes: Math.max(0, total - subido),
    progresso: total === 0 ? null : subido / total,
    deOutraSessao: naoEnviados.length - todos.length,
  };
}
