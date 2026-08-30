-- ---------------------------------------------------------------------------
-- Aurora — o ESTADO DO ENVIO dos bytes de um anexo (SPEC §20 · EPIC-014).
--
-- Até aqui `aurora.attachments` registrava que uma foto EXISTE: nome, tipo,
-- tamanho, resumo criptográfico, e a chave de armazenamento escolhida pelo
-- servidor. O que ela não registrava era se os bytes chegaram — e sem isso o
-- envio retomável não tem onde retomar.
--
-- POR QUE A CONTA É DO SERVIDOR, E NÃO DO APARELHO
--
-- O aparelho perde a resposta o tempo todo: a fatia chega, a confirmação se
-- perde no elevador, e o aparelho tenta de novo do mesmo ponto. Se cada lado
-- guardasse a própria conta, a segunda entrega da mesma fatia somaria duas
-- vezes e o envio nunca terminaria — ou pior, terminaria com o arquivo maior
-- do que ele é. Havendo UMA conta, e sendo ela a de quem recebe, a repetição
-- é inofensiva: o servidor responde "eu tenho tantos bytes" e o aparelho se
-- alinha ao número dele.
--
-- POR QUE `received_bytes` E NÃO UMA TABELA DE FATIAS
--
-- Uma tabela de fatias permitiria receber fora de ordem, e o custo seria uma
-- linha por 256 kB — dezenas de milhares de linhas por dia de campo, para
-- comprar uma liberdade que ninguém pediu. O envio é sequencial por decisão:
-- uma foto sobe do começo ao fim, e o que interessa guardar é até onde foi.
-- ---------------------------------------------------------------------------

ALTER TABLE aurora.attachments
  ADD COLUMN received_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN upload_completed_at timestamptz;

-- O recebido nunca passa do declarado. Se passar, alguma conta está errada, e
-- é melhor a transação morrer aqui do que o arquivo sair corrompido lá.
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_received_within_size
  CHECK (received_bytes >= 0 AND received_bytes <= byte_size);

-- Concluído só quando tudo chegou. O banco recusa a combinação impossível em
-- vez de confiar em quem escreve.
ALTER TABLE aurora.attachments
  ADD CONSTRAINT att_completed_means_full
  CHECK (upload_completed_at IS NULL OR received_bytes = byte_size);

/*
 * OS ANEXOS QUE JÁ EXISTIAM.
 *
 * As linhas anteriores a esta migração foram registradas por um caminho que
 * NUNCA subiu bytes — a rota de recebimento não existia. Marcá-las como
 * concluídas seria mentir no banco; deixá-las em zero é o que elas são: um
 * registro sem arquivo. A tela de anexos mostra a diferença, e quem quiser
 * pode recapturar.
 */

COMMENT ON COLUMN aurora.attachments.received_bytes IS
  'Quantos bytes do arquivo o servidor já tem. É a única conta que vale na retomada.';
COMMENT ON COLUMN aurora.attachments.upload_completed_at IS
  'Quando o último byte chegou e o resumo criptográfico conferiu. Nulo = arquivo incompleto.';
