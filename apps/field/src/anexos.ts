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
    referenciaLocal: id,
    criadoEm: e.agora().toISOString(),
  };
  await e.anexos.gravar(id, anexo);

  /*
   * 3 · O COMANDO. E ele usa o MESMO identificador do anexo como operação —
   * o que faz a resposta do servidor encontrar o anexo certo em `aoConcluir`.
   */
  await e.enfileirar({
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
    ultimoErro: null,
  });
}
