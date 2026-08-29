-- =============================================================================
-- Aurora — 0006 RBAC (SPEC v0.2 §21, ADR-007) · EPIC-002
--
-- Três eixos independentes, verificados sempre em conjunto:
--   QUEM        membership
--   O QUE PODE  papéis -> permissões (+ concessões/revogações individuais)
--   SOBRE O QUE escopo de dados (membership_scopes, migration 0001)
--
-- `permissions` é catálogo de PLATAFORMA, não tenant-scoped: uma permissão só
-- existe se houver código que a verifique, então quem a define é o código
-- (packages/domain/src/permissions.ts). Esta tabela é o espelho, e um teste
-- garante que os dois não divergem.
-- =============================================================================

CREATE TABLE aurora.permissions (
  key           text PRIMARY KEY,
  resource      text NOT NULL,
  action        text NOT NULL,
  description   text NOT NULL,
  field_level   boolean NOT NULL DEFAULT false,
  CONSTRAINT permissions_key_format CHECK (key = resource || '.' || action)
);
CREATE INDEX permissions_resource_idx ON aurora.permissions (resource);

-- -----------------------------------------------------------------------------
-- roles — tenant-scoped. Papéis de fábrica são somente leitura (§21): para
-- ajustar, duplica-se e edita-se a cópia. Isso impede que uma atualização nossa
-- sobrescreva customização e que uma customização quebre o papel padrão.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.roles (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL,
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  seat_type         aurora.seat_type NOT NULL DEFAULT 'staff',
  is_system         boolean NOT NULL DEFAULT false,
  copied_from_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$')
);
CREATE UNIQUE INDEX roles_org_key_uq ON aurora.roles (organization_id, key) WHERE deleted_at IS NULL;
CREATE INDEX roles_org_idx ON aurora.roles (organization_id) WHERE deleted_at IS NULL;

CREATE TABLE aurora.role_permissions (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL REFERENCES aurora.roles(id) ON DELETE CASCADE,
  permission_key    text NOT NULL REFERENCES aurora.permissions(key) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_org_idx ON aurora.role_permissions (organization_id);

CREATE TABLE aurora.membership_roles (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL REFERENCES aurora.memberships(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL REFERENCES aurora.roles(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  PRIMARY KEY (membership_id, role_id)
);
CREATE INDEX membership_roles_org_idx  ON aurora.membership_roles (organization_id);
CREATE INDEX membership_roles_role_idx ON aurora.membership_roles (role_id);

-- -----------------------------------------------------------------------------
-- Exceções individuais. `deny` vence qualquer concessão, inclusive de papel —
-- é o que permite suspender uma capacidade sem desmontar o papel da pessoa.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.membership_permission_overrides (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL REFERENCES aurora.memberships(id) ON DELETE CASCADE,
  permission_key    text NOT NULL REFERENCES aurora.permissions(key) ON DELETE RESTRICT,
  effect            text NOT NULL,
  reason            text NOT NULL,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  PRIMARY KEY (membership_id, permission_key),
  CONSTRAINT overrides_effect_valid CHECK (effect IN ('grant', 'deny')),
  CONSTRAINT overrides_reason_present CHECK (length(btrim(reason)) >= 5)
);
CREATE INDEX overrides_org_idx ON aurora.membership_permission_overrides (organization_id);

-- -----------------------------------------------------------------------------
-- triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER roles_touch BEFORE UPDATE ON aurora.roles
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER roles_audit                          AFTER INSERT OR UPDATE OR DELETE ON aurora.roles                          FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER role_permissions_audit               AFTER INSERT OR DELETE           ON aurora.role_permissions               FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('permission_key', 'permission_key');
CREATE TRIGGER membership_roles_audit               AFTER INSERT OR DELETE           ON aurora.membership_roles               FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('role_id', 'membership_id');
CREATE TRIGGER membership_overrides_audit           AFTER INSERT OR UPDATE OR DELETE ON aurora.membership_permission_overrides FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('permission_key', 'membership_id');

ALTER TABLE aurora.permissions                       OWNER TO aurora_owner;
ALTER TABLE aurora.roles                             OWNER TO aurora_owner;
ALTER TABLE aurora.role_permissions                  OWNER TO aurora_owner;
ALTER TABLE aurora.membership_roles                  OWNER TO aurora_owner;
ALTER TABLE aurora.membership_permission_overrides   OWNER TO aurora_owner;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- permissions é catálogo de plataforma: leitura livre para quem está autenticado,
-- escrita apenas por migration. Não contém dado de nenhum tenant.
ALTER TABLE aurora.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.permissions FORCE  ROW LEVEL SECURITY;
CREATE POLICY permissions_read_all ON aurora.permissions FOR SELECT USING (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'role_permissions', 'membership_roles', 'membership_permission_overrides']
  LOOP
    EXECUTE format('ALTER TABLE aurora.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aurora.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON aurora.%I FOR ALL
         USING (organization_id = aurora.current_organization_id())
         WITH CHECK (organization_id = aurora.current_organization_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

GRANT SELECT ON aurora.permissions TO aurora_app, aurora_readonly, aurora_identity;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.roles                           TO aurora_app;
GRANT SELECT, INSERT, DELETE         ON aurora.role_permissions                TO aurora_app;
GRANT SELECT, INSERT, DELETE         ON aurora.membership_roles                TO aurora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.membership_permission_overrides TO aurora_app;
GRANT SELECT ON aurora.roles, aurora.role_permissions, aurora.membership_roles,
                aurora.membership_permission_overrides TO aurora_readonly;

-- o resolvedor de identidade também lê papéis, para montar o contexto no login
GRANT SELECT ON aurora.roles, aurora.role_permissions, aurora.membership_roles,
                aurora.membership_permission_overrides TO aurora_identity;
CREATE POLICY roles_identity_read                          ON aurora.roles                           FOR SELECT TO aurora_identity USING (true);
CREATE POLICY role_permissions_identity_read               ON aurora.role_permissions                FOR SELECT TO aurora_identity USING (true);
CREATE POLICY membership_roles_identity_read               ON aurora.membership_roles                FOR SELECT TO aurora_identity USING (true);
CREATE POLICY membership_overrides_identity_read           ON aurora.membership_permission_overrides FOR SELECT TO aurora_identity USING (true);

-- -----------------------------------------------------------------------------
-- Permissões efetivas de um vínculo.
--
-- SECURITY DEFINER pelo mesmo motivo da migration 0004: no login o contexto de
-- tenant ainda não existe. A função só aceita um membership_id e devolve as
-- permissões daquele vínculo — não há como usá-la para varrer nada.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.effective_permissions(p_membership_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  WITH granted AS (
    SELECT rp.permission_key
      FROM aurora.membership_roles mr
      JOIN aurora.roles r          ON r.id = mr.role_id AND r.deleted_at IS NULL
      JOIN aurora.role_permissions rp ON rp.role_id = r.id
     WHERE mr.membership_id = p_membership_id
    UNION
    SELECT o.permission_key
      FROM aurora.membership_permission_overrides o
     WHERE o.membership_id = p_membership_id
       AND o.effect = 'grant'
       AND (o.expires_at IS NULL OR o.expires_at > now())
  ),
  denied AS (
    SELECT o.permission_key
      FROM aurora.membership_permission_overrides o
     WHERE o.membership_id = p_membership_id
       AND o.effect = 'deny'
       AND (o.expires_at IS NULL OR o.expires_at > now())
  )
  SELECT g.permission_key FROM granted g
   WHERE g.permission_key NOT IN (SELECT d.permission_key FROM denied d)
   ORDER BY 1
$$;

ALTER FUNCTION aurora.effective_permissions(uuid) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.effective_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.effective_permissions(uuid) TO aurora_app;
