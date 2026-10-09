-- =============================================================================
-- Aurora — 0060 perfil do contrato (Básico · Completo · Expert)
--
-- O cliente (Be Care) confirmou: contrato se classifica por PERFIL — básico,
-- completo ou expert — e só por ele. "Atendimento sob demanda", "preventiva
-- programada" e "manutenção integral" eram títulos da massa de demonstração e
-- valores de `kind`, e nenhum dos dois é o tipo do contrato.
--
-- O PERFIL MORA NO CONTRATO, NÃO NO CLIENTE.
--
-- Um cliente pode ter mais de um contrato ao longo do tempo, e "possui
-- contrato?" é pergunta que o próprio cadastro de contratos responde. Uma
-- coluna no cliente seria uma segunda fonte de verdade, e a primeira a
-- envelhecer quando o contrato encerrar.
--
-- ADITIVA, E SEM SUPOSIÇÃO.
--
-- `profile` nasce nulo para todo contrato que já existe: ninguém disse qual é
-- o perfil deles, e "full_service vira expert" seria inventar uma cláusula. A
-- tela mostra "perfil não definido" até alguém dizer.
--
-- `kind` deixa de ser obrigatório. Ele continua dizendo a NATUREZA do acordo
-- (locação, comodato, garantia…) quando alguém a informa, mas o contrato
-- declarado no cadastro do cliente só sabe o perfil — e exigir a natureza ali
-- obrigaria a escolher uma ao acaso. Nada é apagado nem convertido.
--
-- Numerada 0060, e não 0059: há uma 0059 em outra linha de trabalho ainda não
-- integrada, e o migrator aplica por nome — dois arquivos 0059 seriam só
-- confusão para quem lê a pasta.
-- =============================================================================

CREATE TYPE aurora.contract_profile AS ENUM ('basic', 'complete', 'expert');

ALTER TABLE aurora.contracts ADD COLUMN profile aurora.contract_profile;
ALTER TABLE aurora.contracts ALTER COLUMN kind DROP NOT NULL;
