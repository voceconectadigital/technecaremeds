-- =============================================================================
-- Aurora — 0042 o vocabulário que o cliente lê (SPEC v0.2 §19)
--
-- O PROBLEMA
--
-- O portal precisa dizer "Aguardando sua aprovação" onde a operação diz
-- "Aguardando / quote_approval". São a mesma situação, e são duas frases
-- diferentes porque falam com duas pessoas diferentes.
--
-- A SPEC §19 é explícita: "o mapeamento é DADO, e não código. Uma organização
-- pode ajustar a linguagem que seus clientes veem sem tocar na máquina de
-- estados."
--
-- POR QUE ISSO IMPORTA MAIS DO QUE PARECE
--
-- Um portal que mostra o vocabulário interno obriga o cliente a aprender o
-- jargão da manutenção para entender o próprio chamado. A referência auditada
-- fazia isso — o portal era o conjunto de telas internas com 21 permissões por
-- cima — e o resultado registrado foi previsível: o cliente liga para
-- perguntar o que "em triagem" significa, e a economia da autoatendimento
-- desaparece na conta de telefone.
--
-- Traduzir em CÓDIGO resolveria a primeira organização e quebraria na segunda:
-- um hospital diz "Aguardando peça", uma administradora predial diz "Aguardando
-- material", e uma frota diz "Aguardando componente". Nenhuma das três está
-- errada, e nenhuma delas deveria precisar de um lançamento de versão.
--
-- NULO É DELIBERADO
--
-- Sem rótulo de cliente, o portal usa o rótulo interno. É pior do que uma
-- tradução, e é melhor do que uma frase vazia: quem não configurou vê a
-- palavra da equipe em vez de ver nada.
-- =============================================================================

ALTER TABLE aurora.work_order_statuses
  ADD COLUMN IF NOT EXISTS customer_label text;

COMMENT ON COLUMN aurora.work_order_statuses.customer_label IS
  'Como esta situação aparece no portal do cliente. Nulo usa o rótulo interno.';

-- O motivo de espera também fala com o cliente: "aguardando peça" e "aguardando
-- sua resposta" são a MESMA situação para a operação e coisas opostas para
-- quem espera — uma é problema nosso, a outra é pendência dela.
ALTER TABLE aurora.wait_reasons
  ADD COLUMN IF NOT EXISTS customer_label text;

COMMENT ON COLUMN aurora.wait_reasons.customer_label IS
  'Como este motivo de parada aparece no portal. Nulo usa o rótulo interno.';

-- -----------------------------------------------------------------------------
-- As traduções da SPEC §19, aplicadas às situações de fábrica que já existem.
--
-- `WHERE customer_label IS NULL` porque esta migration é idempotente E não pode
-- desfazer o ajuste de uma organização: quem já escreveu a própria frase mantém
-- a dela.
-- -----------------------------------------------------------------------------
UPDATE aurora.work_order_statuses SET customer_label = t.frase
  FROM (VALUES
    ('open',        'Recebido'),
    ('scheduled',   'Agendado'),
    ('in_progress', 'Em atendimento'),
    ('waiting',     'Aguardando'),
    ('paused',      'Em análise'),
    ('completed',   'Concluído'),
    ('validated',   'Concluído'),
    ('closed',      'Encerrado'),
    ('cancelled',   'Cancelado')
  ) AS t(chave, frase)
 WHERE aurora.work_order_statuses.key = t.chave
   AND aurora.work_order_statuses.customer_label IS NULL;

-- `draft` NÃO ganha tradução de propósito: uma OS em rascunho ainda não é um
-- compromisso com ninguém, e não deve aparecer no portal. Sem rótulo de
-- cliente, a consulta do portal a exclui.

-- -----------------------------------------------------------------------------
-- Os motivos de espera, traduzidos pela pergunta que o cliente faz.
--
-- A pergunta é sempre "o atraso é meu ou de vocês?", e o modelo já sabe
-- responder: cada motivo tem `responsible`. As frases abaixo tornam essa
-- resposta legível sem inventar nada.
--
-- DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
--
--   · "Aguardando sua aprovação" e "Aguardando você" dizem, com todas as
--     letras, que a bola está com o cliente. Um portal que escreve "aguardando"
--     para tudo transfere para a equipe a ligação de "e aí, como está?" —
--     inclusive nos casos em que a resposta é "esperando você".
--
--   · Nenhuma frase NOMEIA fornecedor. "Em serviço externo" e "aguardando
--     fornecedor" dizem que há um terceiro envolvido, que é verdade e é útil;
--     quem é esse terceiro é informação comercial nossa, e a SPEC §19 a lista
--     entre o que não vaza.
-- -----------------------------------------------------------------------------
UPDATE aurora.wait_reasons SET customer_label = t.frase
  FROM (VALUES
    ('parts',              'Aguardando peça'),
    ('quote_approval',     'Aguardando sua aprovação'),
    ('quote_preparation',  'Preparando orçamento'),
    ('customer_response',  'Aguardando você'),
    ('asset_release',      'Aguardando liberação do equipamento'),
    ('external_service',   'Em serviço externo'),
    ('external_quote',     'Aguardando orçamento de terceiro'),
    ('warranty',           'Em acionamento de garantia'),
    ('internal_approval',  'Em análise'),
    ('scheduling',         'Aguardando janela para agendar'),
    ('transport',          'Em deslocamento'),
    ('documentation',      'Aguardando documento fiscal'),
    ('calibration',        'Aguardando calibração'),
    ('unrepairable',       'Sem reparo viável')
  ) AS t(chave, frase)
 WHERE aurora.wait_reasons.key = t.chave
   AND aurora.wait_reasons.customer_label IS NULL;
