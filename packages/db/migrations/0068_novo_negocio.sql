-- =============================================================================
-- Aurora — 0068 "Novo Negócio": provisionamento lógico de tenant
-- (reunião 16/10/2026, Fase 11)
--
-- UM CÓDIGO, VÁRIAS ORGANIZAÇÕES. Um negócio novo é uma linha em
-- `organizations` + a base de fábrica (papéis, situações de OS, catálogos) +
-- o primeiro administrador. Nada é duplicado no código.
--
-- ADMIN GLOBAL DE PLATAFORMA — EXPLÍCITO
--   `platform_admins` não tem rota de escrita, e a aplicação (`aurora_app`)
--   não lê nem grava a tabela. Conceder é um ato de DBA, com motivo:
--
--     INSERT INTO aurora.platform_admins (user_id, granted_by, reason)
--     VALUES ('<uuid do usuário>', '<quem concedeu>', '<motivo, 10+ caracteres>');
--
--   O que o admin de plataforma enxerga ATRAVÉS de organizações é só o
--   REGISTRO de tenants (nome, slug, situação, criação) — pela função
--   `platform_list_tenants`, que recusa quem não é admin. Dado de negócio de
--   outra organização continua atrás da RLS, inclusive para ele.
-- =============================================================================

CREATE TABLE aurora.platform_admins (
  user_id     uuid PRIMARY KEY REFERENCES aurora.users (id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  text NOT NULL,
  reason      text NOT NULL,
  CONSTRAINT platform_admins_reason CHECK (length(btrim(reason)) >= 10)
);
ALTER TABLE aurora.platform_admins OWNER TO aurora_owner;
ALTER TABLE aurora.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.platform_admins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON aurora.platform_admins FROM PUBLIC;
GRANT SELECT ON aurora.platform_admins TO aurora_identity;
CREATE POLICY platform_admins_identity_read ON aurora.platform_admins
  FOR SELECT TO aurora_identity USING (true);

CREATE OR REPLACE FUNCTION aurora.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM aurora.platform_admins WHERE user_id = p_user_id)
$$;
ALTER FUNCTION aurora.is_platform_admin(uuid) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.is_platform_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.is_platform_admin(uuid) TO aurora_app;

-- O registro de tenants — e só ele. Quem não é admin de plataforma recebe erro.
CREATE OR REPLACE FUNCTION aurora.platform_list_tenants(p_user_id uuid)
RETURNS TABLE (
  id          uuid,
  slug        text,
  name        text,
  status      text,
  created_at  timestamptz,
  settings    jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aurora.platform_admins a WHERE a.user_id = p_user_id) THEN
    RAISE EXCEPTION 'apenas o admin global de plataforma lista organizações'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.status::text, o.created_at, o.settings
      FROM aurora.organizations o
     WHERE o.deleted_at IS NULL
     ORDER BY o.created_at;
END
$$;
ALTER FUNCTION aurora.platform_list_tenants(uuid) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.platform_list_tenants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.platform_list_tenants(uuid) TO aurora_app;

-- O slug é global (índice único), mas a RLS esconde o slug alheio: a checagem
-- de disponibilidade passa por função estreita, que responde só sim ou não.
CREATE OR REPLACE FUNCTION aurora.organization_slug_taken(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM aurora.organizations WHERE slug = p_slug AND deleted_at IS NULL)
$$;
ALTER FUNCTION aurora.organization_slug_taken(text) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.organization_slug_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.organization_slug_taken(text) TO aurora_app;
