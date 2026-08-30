/**
 * Aurora — onde os bytes de um anexo realmente ficam (SPEC §20 · EPIC-014).
 *
 * O REGISTRO E O ARQUIVO SÃO DUAS COISAS, E ESTA É A SEGUNDA.
 *
 * `aurora.attachments` diz que a foto existe, quanto ela mede e qual é o resumo
 * criptográfico dela. Os bytes moram fora do banco — porque um banco cheio de
 * fotos de oito megabytes é um banco que ninguém consegue restaurar, e porque a
 * leitura de uma foto não deve disputar conexão com a fila de comandos.
 *
 * POR QUE UMA PORTA, E NÃO UMA CHAMADA DIRETA
 *
 * A homologação do cliente não pode depender de serviço pago: ela roda com os
 * arquivos em disco, e isso basta. Amanhã, em produção, os mesmos bytes podem
 * ir para um armazenamento de objetos de verdade. As duas coisas cabem atrás
 * desta porta, e nenhuma delas aparece no controller.
 *
 * A ESCRITA É POSICIONAL, E ISSO É O QUE TORNA A RETOMADA SEGURA.
 *
 * `escrever(chave, deslocamento, bytes)` grava NAQUELE ponto do arquivo — não
 * acrescenta ao fim. A diferença é tudo: a mesma fatia entregue duas vezes,
 * porque a confirmação se perdeu no elevador, escreve por cima de si mesma e o
 * arquivo continua correto. Com acréscimo ao fim, ela sairia duplicada no meio
 * do arquivo, e o resumo criptográfico só acusaria isso no último byte — depois
 * de o técnico já ter ido embora.
 */
export interface ArmazenamentoDeObjetos {
  /** Grava `bytes` a partir de `deslocamento`. Cria o objeto se não existir. */
  escrever(chave: string, deslocamento: number, bytes: Uint8Array): Promise<void>;
  /** Quantos bytes o objeto tem. `undefined` quando ele não existe. */
  tamanho(chave: string): Promise<number | undefined>;
  /** O conteúdo inteiro. Usado para conferir o resumo no fim do envio. */
  ler(chave: string): Promise<Uint8Array | undefined>;
  apagar(chave: string): Promise<void>;
}
