-- =============================================================================
-- Aurora — 0003 Row Level Security
-- SPEC v0.2 §37 · ADR-023
--
-- Duas coisas são obrigatórias e uma sem a outra deixa porta aberta:
--   1. FORCE ROW LEVEL SECURITY — submete inclusive o owner às policies
--   2. aurora_app NÃO ser owner das tabelas
--
-- Falha fechada: sem contexto, aurora.current_organization_id() é NULL e
-- `organization_id = NULL` é falso — nega acesso em vez de liberar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations — o tenant é a própria linha
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.organizations FORCE  ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON aurora.organizations
  FOR ALL
  USING      (id = aurora.current_organization_id())
  WITH CHECK (id = aurora.current_organization_id());

-- -----------------------------------------------------------------------------
-- users — identidade global, mas visível apenas para quem compartilha organização
--
-- Um usuário nunca é listado por uma organização à qual não pertence. A regra é
-- "existe membership não excluído deste usuário na organização corrente".
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.users FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_visible_through_membership ON aurora.users
  FOR ALL
  USING (
    aurora.current_organization_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM aurora.memberships m
      WHERE m.user_id = users.id
        AND m.organization_id = aurora.current_organization_id()
        AND m.deleted_at IS NULL
    )
  )
  WITH CHECK (
    aurora.current_organization_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM aurora.memberships m
      WHERE m.user_id = users.id
        AND m.organization_id = aurora.current_organization_id()
        AND m.deleted_at IS NULL
    )
  );

-- -----------------------------------------------------------------------------
-- memberships / membership_scopes — tenant-scoped clássico
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.memberships FORCE  ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON aurora.memberships
  FOR ALL
  USING      (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

ALTER TABLE aurora.membership_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.membership_scopes FORCE  ROW LEVEL SECURITY;
CREATE POLICY membership_scopes_tenant_isolation ON aurora.membership_scopes
  FOR ALL
  USING      (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

-- -----------------------------------------------------------------------------
-- audit_logs — leitura tenant-scoped; escrita SOMENTE pelo trigger
--
-- O trigger roda como SECURITY DEFINER (dono: aurora_owner), então insere sem
-- depender de permissão do aurora_app. A aplicação não recebe INSERT/UPDATE/
-- DELETE: a trilha é append-only do ponto de vista de quem usa o sistema (§22).
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.audit_logs FORCE  ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant_read ON aurora.audit_logs
  FOR SELECT
  USING (organization_id = aurora.current_organization_id());

-- FORCE RLS vale também para o dono da tabela. Como aurora.fn_audit() é
-- SECURITY DEFINER e pertence a aurora_owner, sem esta policy o próprio trigger
-- de auditoria seria bloqueado ao gravar. Só o owner recebe INSERT — aurora_app
-- tem apenas SELECT, então a trilha continua append-only para a aplicação.
CREATE POLICY audit_logs_trigger_insert ON aurora.audit_logs
  FOR INSERT TO aurora_owner
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- domain_events — leitura tenant-scoped; inserção pela aplicação dentro do tenant
--
-- O publicador do outbox precisa varrer eventos de todas as organizações, e por
-- isso roda com um papel próprio (aurora_publisher) e uma policy dedicada. Isso
-- evita a tentação de dar BYPASSRLS ao aurora_app.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_publisher') THEN
    CREATE ROLE aurora_publisher NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE aurora_publisher NOBYPASSRLS NOSUPERUSER;
GRANT USAGE ON SCHEMA aurora TO aurora_publisher;

ALTER TABLE aurora.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.domain_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY domain_events_tenant_isolation ON aurora.domain_events
  FOR ALL
  TO aurora_app
  USING      (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

-- publicador enxerga todas as organizações, mas SÓ pode ler e marcar como publicado
CREATE POLICY domain_events_publisher_read ON aurora.domain_events
  FOR SELECT TO aurora_publisher USING (true);
CREATE POLICY domain_events_publisher_mark ON aurora.domain_events
  FOR UPDATE TO aurora_publisher USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- GRANTs — mínimo necessário, nada além
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.organizations     TO aurora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.users             TO aurora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.memberships       TO aurora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.membership_scopes TO aurora_app;
GRANT SELECT                          ON aurora.audit_logs       TO aurora_app;  -- append-only
GRANT SELECT, INSERT                  ON aurora.domain_events    TO aurora_app;  -- outbox: escreve, não altera

GRANT SELECT, UPDATE ON aurora.domain_events TO aurora_publisher;

GRANT SELECT ON ALL TABLES IN SCHEMA aurora TO aurora_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE aurora_owner IN SCHEMA aurora
  GRANT SELECT ON TABLES TO aurora_readonly;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA aurora TO aurora_app, aurora_readonly, aurora_publisher;
