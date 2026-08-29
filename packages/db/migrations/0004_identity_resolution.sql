-- =============================================================================
-- Aurora — 0004 resolução de identidade
--
-- PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- Descobrir a quais organizações um usuário pertence é a única leitura do
-- sistema que precisa, por definição, atravessar organizações: o tenant é o
-- *resultado* da consulta, não uma pré-condição dela.
--
-- Com RLS + falha fechada, essa consulta feita por `aurora_app` retorna zero
-- linhas — ou seja, ninguém consegue logar. A tentação seria dar BYPASSRLS ao
-- papel da aplicação. Isso desmontaria todo o isolamento.
--
-- SOLUÇÃO
--
-- Uma única função SECURITY DEFINER, com consulta fixa, pertencente a um papel
-- dedicado (`aurora_identity`) que existe só para isso e que a API não pode
-- assumir. `aurora_app` recebe apenas EXECUTE na função.
--
-- Resultado: existe exatamente UM caminho de leitura cross-tenant no sistema,
-- ele é nomeado, tem consulta fixa e é auditável em uma tela de código.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_identity') THEN
    CREATE ROLE aurora_identity NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE aurora_identity NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA aurora TO aurora_identity;

-- Leitura restrita: apenas as três tabelas necessárias, apenas SELECT.
GRANT SELECT ON aurora.memberships       TO aurora_identity;
GRANT SELECT ON aurora.users             TO aurora_identity;
GRANT SELECT ON aurora.organizations     TO aurora_identity;
GRANT SELECT ON aurora.membership_scopes TO aurora_identity;

CREATE POLICY memberships_identity_read       ON aurora.memberships       FOR SELECT TO aurora_identity USING (true);
CREATE POLICY users_identity_read             ON aurora.users             FOR SELECT TO aurora_identity USING (true);
CREATE POLICY organizations_identity_read     ON aurora.organizations     FOR SELECT TO aurora_identity USING (true);
CREATE POLICY membership_scopes_identity_read ON aurora.membership_scopes FOR SELECT TO aurora_identity USING (true);

-- -----------------------------------------------------------------------------
-- A consulta é fixa e filtra sempre pelo e-mail do portador da credencial.
-- Não aceita predicado arbitrário; não existe forma de usá-la para varrer dados.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.find_memberships_for_email(p_email text)
RETURNS TABLE (
  membership_id     uuid,
  organization_id   uuid,
  user_id           uuid,
  status            text,
  seat_type         text,
  customer_scope    text,
  customer_ids      uuid[],
  location_scope    text,
  location_ids      uuid[],
  assignment_scope  text,
  warehouse_ids     uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT m.id, m.organization_id, m.user_id, m.status::text, m.seat_type::text,
         s.customer_scope::text, s.customer_ids,
         s.location_scope::text, s.location_ids,
         s.assignment_scope::text, s.warehouse_ids
    FROM aurora.memberships m
    JOIN aurora.users u          ON u.id = m.user_id
    JOIN aurora.organizations o  ON o.id = m.organization_id
    LEFT JOIN aurora.membership_scopes s ON s.membership_id = m.id
   WHERE lower(u.email) = lower(p_email)
     AND u.deleted_at IS NULL AND u.status = 'active'
     AND m.deleted_at IS NULL AND m.status = 'active'
     AND o.deleted_at IS NULL AND o.status = 'active'
   ORDER BY m.created_at
$$;

ALTER FUNCTION aurora.find_memberships_for_email(text) OWNER TO aurora_identity;

-- a API pode executar; jamais pode assumir o papel
REVOKE ALL ON FUNCTION aurora.find_memberships_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.find_memberships_for_email(text) TO aurora_app;
