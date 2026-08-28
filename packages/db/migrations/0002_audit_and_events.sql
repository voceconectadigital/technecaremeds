-- =============================================================================
-- Aurora — 0002 auditoria e eventos de domínio
-- SPEC v0.2 §22 (duas camadas), §31 (catálogo de eventos), EPIC-001
--
-- Duas camadas complementares, deliberadamente separadas (ADR-014):
--   audit_logs    — mutação de dado, capturada por trigger, com diff campo a campo
--   domain_events — fato de negócio, escrito pela aplicação, outbox transacional
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_logs — append-only (§22)
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.audit_logs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   uuid,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  actor_user_id     uuid,
  actor_kind        aurora.actor_kind NOT NULL DEFAULT 'system',
  entity_type       text NOT NULL,
  entity_id         text NOT NULL,
  entity_label      text,
  action            aurora.audit_action NOT NULL,
  changes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ip         text,
  user_agent        text,
  request_id        text,
  source            text NOT NULL DEFAULT 'unknown'
);
CREATE INDEX audit_logs_org_time_idx    ON aurora.audit_logs (organization_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx      ON aurora.audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx       ON aurora.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_request_idx     ON aurora.audit_logs (request_id) WHERE request_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- domain_events — outbox transacional (§31)
-- O evento é gravado na MESMA transação do dado. Um publicador separado lê os
-- não publicados e entrega. Nunca "salva e torce para publicar".
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.domain_events (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL,
  type              text NOT NULL,
  schema_version    integer NOT NULL DEFAULT 1,
  aggregate_type    text NOT NULL,
  aggregate_id      uuid NOT NULL,
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id     uuid,
  actor_kind        aurora.actor_kind NOT NULL DEFAULT 'system',
  request_id        text,
  caused_by_event_id uuid,
  caused_by_rule_id  uuid,
  -- profundidade de cadeia causal: trava contra automação em laço (§24)
  causation_depth   integer NOT NULL DEFAULT 0,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  publish_attempts  integer NOT NULL DEFAULT 0,
  last_error        text,
  CONSTRAINT domain_events_type_format CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT domain_events_causation_depth_limit CHECK (causation_depth BETWEEN 0 AND 3)
);
-- índice do publicador: só o que falta publicar
CREATE INDEX domain_events_unpublished_idx
  ON aurora.domain_events (occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX domain_events_org_time_idx  ON aurora.domain_events (organization_id, occurred_at DESC);
CREATE INDEX domain_events_aggregate_idx ON aurora.domain_events (aggregate_type, aggregate_id, sequence);
CREATE INDEX domain_events_type_idx      ON aurora.domain_events (organization_id, type, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- Trigger genérico de auditoria
--
-- Colunas sensíveis nunca têm o valor registrado: o fato da mudança é auditado,
-- o conteúdo não (§22).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.fn_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = aurora, pg_catalog
AS $$
DECLARE
  v_old        jsonb;
  v_new        jsonb;
  v_changes    jsonb := '{}'::jsonb;
  v_action     aurora.audit_action;
  v_org        uuid;
  v_entity_id  text;
  v_label      text;
  v_label_col  text := coalesce(TG_ARGV[0], 'name');
  v_id_col     text := coalesce(TG_ARGV[1], 'id');
  v_redacted   text[] := ARRAY['password', 'password_hash', 'secret', 'token',
                               'api_key', 'signature_key', 'auth_subject'];
  k            text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new := to_jsonb(NEW);
    v_old := '{}'::jsonb;
  ELSIF TG_OP = 'UPDATE' THEN
    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
    -- soft delete e restauração são ações próprias, não "update"
    IF (v_old->>'deleted_at') IS NULL AND (v_new->>'deleted_at') IS NOT NULL THEN
      v_action := 'delete';
    ELSIF (v_old->>'deleted_at') IS NOT NULL AND (v_new->>'deleted_at') IS NULL THEN
      v_action := 'restore';
    ELSE
      v_action := 'update';
    END IF;
  ELSE
    v_action := 'delete';
    v_old := to_jsonb(OLD);
    v_new := '{}'::jsonb;
  END IF;

  -- diff: apenas as chaves que realmente mudaram
  FOR k IN SELECT jsonb_object_keys(v_old || v_new) LOOP
    CONTINUE WHEN k IN ('updated_at', 'updated_by');
    IF (v_old->k) IS DISTINCT FROM (v_new->k) THEN
      IF k = ANY(v_redacted) THEN
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', '[redacted]', 'to', '[redacted]'));
      ELSE
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k));
      END IF;
    END IF;
  END LOOP;

  -- nada mudou de fato: não polui a trilha
  IF TG_OP = 'UPDATE' AND v_changes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  v_entity_id := coalesce(v_new->>v_id_col, v_old->>v_id_col);
  IF v_entity_id IS NULL THEN
    RAISE EXCEPTION 'trigger de auditoria em %: coluna de identificador "%" não encontrada', TG_TABLE_NAME, v_id_col;
  END IF;
  v_label     := coalesce(v_new->>v_label_col, v_old->>v_label_col);
  v_org       := coalesce(
                   nullif(coalesce(v_new->>'organization_id', v_old->>'organization_id'), '')::uuid,
                   aurora.current_organization_id()
                 );
  -- a própria organização é seu tenant
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org := v_entity_id::uuid;
  END IF;

  INSERT INTO aurora.audit_logs (
    organization_id, actor_user_id, actor_kind, entity_type, entity_id, entity_label,
    action, changes, client_ip, user_agent, request_id, source
  ) VALUES (
    v_org,
    aurora.current_actor_id(),
    aurora.current_actor_kind()::aurora.actor_kind,
    TG_TABLE_NAME,
    v_entity_id,
    v_label,
    v_action,
    v_changes,
    aurora.current_client_ip(),
    aurora.current_user_agent(),
    aurora.current_request_id(),
    aurora.current_source()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
ALTER FUNCTION aurora.fn_audit() OWNER TO aurora_owner;

CREATE TRIGGER organizations_audit     AFTER INSERT OR UPDATE OR DELETE ON aurora.organizations     FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER users_audit             AFTER INSERT OR UPDATE OR DELETE ON aurora.users             FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER memberships_audit       AFTER INSERT OR UPDATE OR DELETE ON aurora.memberships       FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('job_title');
CREATE TRIGGER membership_scopes_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.membership_scopes FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('assignment_scope', 'membership_id');

ALTER TABLE aurora.audit_logs    OWNER TO aurora_owner;
ALTER TABLE aurora.domain_events OWNER TO aurora_owner;
