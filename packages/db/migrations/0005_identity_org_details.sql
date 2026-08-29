-- =============================================================================
-- Aurora — 0005 identidade: dados da organização para o seletor
--
-- Migration 0004 devolvia apenas identificadores. O seletor de organização
-- (§05: "trocar de organização é uma ação explícita") precisa de nome e slug —
-- e um JOIN feito pela aplicação não funciona: sob RLS e sem contexto de
-- tenant, `aurora.organizations` devolve zero linhas, por construção.
--
-- A informação tem de sair da própria função controlada. Como o tipo de
-- retorno muda, é DROP + CREATE: `CREATE OR REPLACE` não altera assinatura.
--
-- Nota de processo: 0004 não é editada. Migration aplicada é imutável; a forma
-- correta de evoluir é uma migration nova.
-- =============================================================================

DROP FUNCTION IF EXISTS aurora.find_memberships_for_email(text);

CREATE FUNCTION aurora.find_memberships_for_email(p_email text)
RETURNS TABLE (
  membership_id       uuid,
  organization_id     uuid,
  organization_slug   text,
  organization_name   text,
  user_id             uuid,
  status              text,
  seat_type           text,
  is_owner            boolean,
  customer_scope      text,
  customer_ids        uuid[],
  location_scope      text,
  location_ids        uuid[],
  assignment_scope    text,
  warehouse_ids       uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT m.id, m.organization_id, o.slug, o.name, m.user_id,
         m.status::text, m.seat_type::text, m.is_owner,
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
   ORDER BY o.name, m.created_at
$$;

ALTER FUNCTION aurora.find_memberships_for_email(text) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.find_memberships_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.find_memberships_for_email(text) TO aurora_app;
