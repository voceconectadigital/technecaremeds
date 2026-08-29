-- =============================================================================
-- Aurora — 0038 correção: a FK do evento na notificação ignorava o tenant
--
-- ENCONTRADO PELA VALIDAÇÃO ESTRUTURAL CONTRA POSTGRESQL REAL
--
-- A migration 0036 criou `notifications.event_id` referenciando
-- `domain_events(id)` — só pelo identificador. Isso viola a convenção do
-- ADR-011, e a violação não é estética:
--
--   a verificação de chave estrangeira roda como DONA da tabela e IGNORA a RLS.
--
-- Com a FK apenas por `id`, uma notificação de uma organização podia apontar
-- para um evento de OUTRA. O `event_id` é justamente o caminho de volta do
-- aviso até o fato que o gerou — então a consequência prática seria uma linha
-- do tempo que atravessa a fronteira do tenant pelo elo que existe para
-- explicar a origem do aviso.
--
-- Não foi pego pelas suítes porque nenhuma delas tenta apontar para um evento
-- alheio: os testes de isolamento verificam LEITURA, e este é um caminho de
-- ESCRITA que só a inspeção do catálogo revela. É por isso que a validação
-- estrutural existe.
--
-- Migration nova, e não edição da 0036: migration aplicada é imutável, e o
-- checksum do migrador só significa alguma coisa se essa regra valer sempre.
-- =============================================================================

-- O par (id, organization_id) precisa ser único para poder ser referenciado.
-- `id` já é chave primária, então esta restrição não muda nada sobre os dados:
-- ela existe para dar à FK composta um destino declarado.
ALTER TABLE aurora.domain_events
  ADD CONSTRAINT domain_events_id_org_uq UNIQUE (id, organization_id);

ALTER TABLE aurora.notifications
  DROP CONSTRAINT notifications_event_fk;

ALTER TABLE aurora.notifications
  ADD CONSTRAINT notifications_event_org_fk
  FOREIGN KEY (event_id, organization_id)
  REFERENCES aurora.domain_events (id, organization_id) ON DELETE SET NULL;
