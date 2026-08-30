/**
 * Aurora — capturar uma evidência, em qualquer plataforma (EPIC-014).
 *
 * O MESMO `AnexoPendente` SAI DAS TRÊS DISTRIBUIÇÕES.
 *
 * A câmera do navegador devolve um `File`; a do Android devolve base64; a do
 * iOS devolve base64 de outro jeito. Se a tela conhecesse essa diferença, ela
 * existiria em três versões — e as três divergiriam.
 *
 * Aqui a diferença morre: a porta da câmera entrega bytes, e este arquivo
 * transforma bytes em três coisas que sempre têm a mesma forma — o registro na
 * base local, os bytes no adaptador de arquivos, e o comando de registro na
 * fila.
 *
 * A ORDEM DAS TRÊS É O QUE IMPEDE PERDER FOTO
 *
 *  1. os BYTES primeiro. Se o aplicativo morrer depois disto, existe um arquivo
 *     órfão — que a limpeza recolhe, e que não custa nada a ninguém;
 *  2. o REGISTRO depois. A partir daqui a foto existe para a tela, com estado
 *     `capturado`, e a pessoa vê que ela está no aparelho;
 *  3. o COMANDO por último. Ele é o que leva a foto ao servidor, e a fila
 *     garante que ele chega.
 *
 * Na ordem inversa — comando primeiro — um servidor rápido responderia antes
 * de os bytes estarem guardados, e o envio começaria a ler um arquivo que ainda
 * não existe.
 */
import type { Colecao } from './armazenamento';
import type { AdaptadorDeArquivos, AnexoPendente } from './arquivos';
import type { AdaptadorDeCamera } from './dispositivo';

/**
 * O SHA-256 do conteúdo, calculado no aparelho.
 *
 * `crypto.subtle` existe em todo contexto seguro — que é o único em que este
 * aplicativo roda, porque o service worker e o IndexedDB também exigem. Não há
 * ramo alternativo de propósito: um hash falso seria pior do que hash nenhum,
 * porque o servidor confiaria nele.
 */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CapturaDeEvidencia {
  workOrderId: string;
  /** `before`, `after`, `signature`… — a finalidade do domínio. */
  finalidade: string;
  camera: AdaptadorDeCamera;
  arquivos: AdaptadorDeArquivos;
  anexos: Colecao<AnexoPendente>;
  novoId(): string;
  agora(): Date;
  /** Enfileira o comando de registro e devolve o identificador da operação. */
  enfileirar(e: {
    agregado: string;
    metodo: 'POST';
    caminho: string;
    corpo: unknown;
    rotulo: string;
    id?: string;
  }): Promise<string>;
}

/**
 * Captura, guarda e enfileira. Devolve `null` quando a pessoa desiste.
 *
 * Desistir não é erro: fechar a câmera sem tirar foto é uma decisão legítima, e
 * tratá-la como exceção faria a tela mostrar "falha ao capturar" para quem
 * simplesmente mudou de ideia.
 */
export async function capturarEvidencia(e: CapturaDeEvidencia): Promise<AnexoPendente | null> {
  const foto = await e.camera.capturar({ qualidade: 70, larguraMaxima: 1600 });
  if (!foto) return null;
  return guardarEvidencia({ ...e, bytes: foto.bytes, tipo: foto.tipo });
}

/**
 * Guarda bytes que JÁ EXISTEM como evidência pendente.
 *
 * A captura pela câmera é um caminho; a assinatura desenhada no dedo é outro, e
 * produz um PNG sem passar por câmera nenhuma. As duas terminam no mesmo lugar
 * — e precisam terminar, ou a assinatura teria um caminho de envio próprio, com
 * a própria retomada e os próprios defeitos.
 */
export async function guardarEvidencia(
  e: Omit<CapturaDeEvidencia, 'camera'> & { bytes: Uint8Array; tipo: string }
): Promise<AnexoPendente> {
  const foto = { bytes: e.bytes, tipo: e.tipo };

  /*
   * O IDENTIFICADOR DO ANEXO É TAMBÉM O DA OPERAÇÃO.
   *
   * Um só para as duas coisas mantém a correspondência óbvia entre a foto no
   * aparelho e a linha no banco — inclusive seis meses depois, quando alguém
   * perguntar de onde veio aquele arquivo.
   */
  const id = e.novoId();
  const hash = await sha256(foto.bytes);
  const nome = `${e.finalidade}-${id}.${foto.tipo.split('/')[1] ?? 'jpg'}`;

  // 1 · OS BYTES PRIMEIRO. Ver a nota do cabeçalho.
  await e.arquivos.guardar(id, foto.bytes, foto.tipo);

  // 2 · O REGISTRO. A partir daqui a foto existe para a tela.
  const anexo: AnexoPendente = {
    id,
    agregado: `work_order:${e.workOrderId}`,
    workOrderId: e.workOrderId,
    finalidade: e.finalidade,
    nomeDoArquivo: nome,
    tipo: foto.tipo,
    bytes: foto.bytes.byteLength,
    sha256: hash,
    estado: 'capturado',
    enviados: 0,
    tentativas: 0,
    ultimoErro: null,
    chaveNoServidor: null,
    idNoServidor: null,
    referenciaLocal: id,
    criadoEm: e.agora().toISOString(),
  };
  await e.anexos.gravar(id, anexo);

  /*
   * 3 · O COMANDO. E ele usa o MESMO identificador do anexo como operação —
   * o que faz a resposta do servidor encontrar o anexo certo em `aoConcluir`.
   */
  await e.enfileirar({
    // O MESMO identificador do anexo. Ver a nota do campo `id` acima: é por
    // ele que o aviso de conclusão da fila reencontra esta foto.
    id,
    agregado: anexo.agregado,
    metodo: 'POST',
    caminho: `/work-orders/${e.workOrderId}/attachments`,
    corpo: {
      purpose: e.finalidade,
      file_name: nome,
      content_type: foto.tipo,
      byte_size: foto.bytes.byteLength,
      sha256: hash,
    },
    rotulo: `Foto ${e.finalidade}`,
  });

  return anexo;
}

/**
 * O servidor aceitou o registro: guarda a chave e libera o envio dos bytes.
 *
 * Chamado pelo aviso de conclusão da fila. Enquanto a chave não chega, o anexo
 * fica em `capturado` e o envio o ignora — não há para onde mandar.
 */
export async function registrarChaveDoServidor(
  anexos: Colecao<AnexoPendente>,
  operacaoId: string,
  corpo: unknown
): Promise<void> {
  const anexo = await anexos.ler(operacaoId);
  if (!anexo) return;

  const r = corpo as { storage_key?: string; attachment_id?: string } | null;
  if (!r?.storage_key) {
    /*
     * O servidor aceitou e não disse onde. É defeito de contrato, e a foto
     * ficaria em `capturado` para sempre sem ninguém entender por quê — então
     * ela vira `falhou` COM O MOTIVO, que é a diferença entre um problema
     * visível e um arquivo esquecido no aparelho.
     */
    await anexos.gravar(operacaoId, {
      ...anexo,
      estado: 'falhou',
      ultimoErro: 'o servidor registrou a foto sem devolver onde enviá-la',
    });
    return;
  }

  await anexos.gravar(operacaoId, {
    ...anexo,
    estado: 'registrado',
    chaveNoServidor: r.storage_key,
    /*
     * O identificador do servidor é guardado AQUI, e é a única passagem em que
     * ele existe. Sem guardá-lo, a assinatura que aponta para esta foto não
     * teria para onde apontar. Ver a nota em `AnexoPendente.idNoServidor`.
     */
    idNoServidor: r.attachment_id ?? null,
    ultimoErro: null,
  });
}

/*
 * ------------------------------------------------------------------------
 * APONTAR PARA UM ANEXO QUE AINDA NÃO EXISTE NO SERVIDOR
 * ------------------------------------------------------------------------
 *
 * A assinatura precisa dizer a QUAL imagem ela se refere, e o servidor
 * identifica a imagem pela chave que ELE escolheu no registro. No meio do mato
 * esse registro ainda não aconteceu: no instante em que a pessoa levanta o
 * dedo, o identificador do servidor não existe em lugar nenhum.
 *
 * Então o comando sai com uma REFERÊNCIA no lugar do valor, e a fila a troca
 * pelo valor de verdade um instante antes de enviar — quando o registro do
 * anexo, que é anterior no mesmo agregado, já voltou.
 *
 * Foi o defeito que o teste de sobrevivência offline encontrou: mandando o
 * identificador local, o servidor recusava a assinatura por chave estrangeira
 * (`sig_attachment_org_fk`) DEPOIS de o dia inteiro de trabalho já estar feito.
 */

/** A marca que ocupa o lugar do identificador do servidor até ele existir. */
export interface ReferenciaAoAnexo {
  $anexoLocal: string;
}

export function referenciaAoAnexo(idLocal: string): ReferenciaAoAnexo {
  return { $anexoLocal: idLocal };
}

function ehReferencia(v: unknown): v is ReferenciaAoAnexo {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as ReferenciaAoAnexo).$anexoLocal === 'string' &&
    Object.keys(v).length === 1
  );
}

/**
 * Troca as referências do corpo pelos identificadores do servidor.
 *
 * `pronto: false` quer dizer "ainda não dá" — e a fila entende isso como
 * esperar, e não como falha: o comando fica intacto e o agregado espera.
 *
 * Um corpo SEM referência nenhuma passa direto, inclusive o mesmo objeto: o
 * caso comum não paga nada por esta função existir.
 */
export async function resolverReferenciasAoAnexo(
  anexos: Colecao<AnexoPendente>,
  corpo: unknown
): Promise<{ pronto: true; corpo: unknown } | { pronto: false; motivo: string }> {
  let pendente: string | null = null;

  async function caminhar(v: unknown): Promise<unknown> {
    if (ehReferencia(v)) {
      const anexo = await anexos.ler(v.$anexoLocal);
      if (!anexo) {
        /*
         * O anexo sumiu do aparelho. Mandar a referência crua o servidor
         * recusaria com uma mensagem incompreensível; mandar nulo é honesto —
         * a assinatura existe, a imagem se perdeu, e o registro diz isso.
         */
        return null;
      }
      if (!anexo.idNoServidor) {
        pendente = anexo.nomeDoArquivo;
        return null;
      }
      return anexo.idNoServidor;
    }
    if (Array.isArray(v)) return Promise.all(v.map(caminhar));
    if (typeof v === 'object' && v !== null) {
      const saida: Record<string, unknown> = {};
      for (const [k, valor] of Object.entries(v)) saida[k] = await caminhar(valor);
      return saida;
    }
    return v;
  }

  const resolvido = await caminhar(corpo);
  if (pendente) {
    return { pronto: false, motivo: `esperando o servidor registrar ${pendente}` };
  }
  return { pronto: true, corpo: resolvido };
}
