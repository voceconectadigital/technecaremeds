-- =============================================================================
-- Aurora — 0036 notificações (SPEC v0.2 §23) · EPIC-023
--
-- O roteador consome os eventos que os quinze épicos anteriores já emitem. Nada
-- aqui inventa um segundo barramento: o `domain_events` é a fonte, e é por isso
-- que a notificação guarda o `event_id` que a originou — dá para percorrer o
-- caminho de volta de qualquer aviso até o fato que o gerou.
--
-- TRÊS DECISÕES
--
-- 1. A NOTIFICAÇÃO É UMA COISA; A ENTREGA É OUTRA
--    Uma notificação vira N entregas, uma por canal. Colapsar as duas faria a
--    caixa do aplicativo somar o mesmo aviso duas vezes quando ele também sai
--    por e-mail — e obrigaria a apagar a entrega para "marcar como lida".
--
-- 2. A DE-DUPLICAÇÃO É ÍNDICE, NÃO CONSULTA PRÉVIA
--    Duas transações que roteiam o mesmo evento ao mesmo tempo passariam as
--    duas por uma leitura. O que impede o aviso duplicado é a restrição.
--
-- 3. E-MAIL NÃO VERIFICADO NÃO É ENTREGA PENDENTE, É ENTREGA SUPRIMIDA
--    Guardar como pendente faria a fila encher de coisa que nunca sairá, e o
--    dia em que o endereço fosse verificado despejaria meses de aviso velho.
-- =============================================================================

CREATE TYPE aurora.notification_channel AS ENUM ('in_app', 'email', 'push', 'whatsapp');
CREATE TYPE aurora.digest_mode AS ENUM ('immediate', 'daily', 'weekly');
CREATE TYPE aurora.delivery_state AS ENUM (
  'pending', 'sent', 'failed', 'suppressed', 'digested'
);

-- -----------------------------------------------------------------------------
-- Verificação de e-mail — a regra copiada literalmente da referência (§23).
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE aurora.users ADD COLUMN email_blocked_at timestamptz;
ALTER TABLE aurora.users ADD COLUMN email_blocked_reason text;

-- Silêncio por vínculo, e não por usuário: a mesma pessoa pode ser plantonista
-- numa organização e administrativa em outra, e o horário de sossego é do papel
-- que ela exerce em cada uma.
ALTER TABLE aurora.memberships ADD COLUMN quiet_start_minute integer;
ALTER TABLE aurora.memberships ADD COLUMN quiet_end_minute integer;
ALTER TABLE aurora.memberships ADD COLUMN quiet_full_days integer[] NOT NULL DEFAULT '{}';
ALTER TABLE aurora.memberships ADD CONSTRAINT memberships_quiet_range CHECK (
  (quiet_start_minute IS NULL AND quiet_end_minute IS NULL)
  OR (quiet_start_minute BETWEEN 0 AND 1439 AND quiet_end_minute BETWEEN 0 AND 1439)
);

CREATE TABLE aurora.notification_preferences (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL,
  type_key          text NOT NULL,
  channel           aurora.notification_channel NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  digest            aurora.digest_mode NOT NULL DEFAULT 'immediate',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, type_key, channel),
  CONSTRAINT notif_pref_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX notif_pref_org_idx ON aurora.notification_preferences (organization_id);

CREATE TABLE aurora.notifications (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL,
  type_key          text NOT NULL,
  /** Evento que originou — o caminho de volta até o fato. */
  event_id          uuid,
  aggregate_type    text NOT NULL,
  aggregate_id      uuid NOT NULL,
  title             text NOT NULL,
  body              text,
  /** Para onde a interface leva ao clicar. */
  link              text,
  /** Chave de de-duplicação: tipo + destinatário + agregado. */
  dedupe_key        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,

  CONSTRAINT notifications_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT notifications_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT notifications_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT notifications_event_fk
    FOREIGN KEY (event_id) REFERENCES aurora.domain_events (id) ON DELETE SET NULL
);
CREATE INDEX notifications_inbox_idx
  ON aurora.notifications (membership_id, created_at DESC);
CREATE INDEX notifications_unread_idx
  ON aurora.notifications (membership_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_dedupe_idx
  ON aurora.notifications (organization_id, dedupe_key, created_at DESC);
CREATE INDEX notifications_org_idx ON aurora.notifications (organization_id);

CREATE TABLE aurora.notification_deliveries (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  notification_id   uuid NOT NULL,
  channel           aurora.notification_channel NOT NULL,
  state             aurora.delivery_state NOT NULL DEFAULT 'pending',
  /** Por que não saiu: silêncio, resumo, e-mail não verificado, duplicata. */
  reason            text,
  /** Quando entra em resumo, qual. */
  digest            aurora.digest_mode,
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  scheduled_for     timestamptz,
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deliveries_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT deliveries_sent_has_state CHECK (state <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT deliveries_channel_uq UNIQUE (notification_id, channel),
  CONSTRAINT deliveries_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT deliveries_notification_org_fk
    FOREIGN KEY (notification_id, organization_id)
    REFERENCES aurora.notifications (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX deliveries_pending_idx
  ON aurora.notification_deliveries (organization_id, channel, created_at)
  WHERE state = 'pending';
CREATE INDEX deliveries_digest_idx
  ON aurora.notification_deliveries (organization_id, digest, created_at)
  WHERE state = 'digested';

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_preferences', 'notifications', 'notification_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE aurora.%I OWNER TO aurora_owner', t);
    EXECUTE format('ALTER TABLE aurora.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aurora.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON aurora.%I FOR ALL
         USING (organization_id = aurora.current_organization_id())
         WITH CHECK (organization_id = aurora.current_organization_id())',
      t || '_tenant_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.%I TO aurora_app', t);
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;
