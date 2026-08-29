-- =============================================================================
-- Aurora — 0010 RLS, auditoria e permissões do diretório (EPIC-003)
--
-- Toda tabela do diretório é tenant-scoped e recebe o mesmo tratamento das
-- tabelas de plataforma: dono `aurora_owner`, RLS habilitada E forçada, política
-- única de isolamento com USING e WITH CHECK, e GRANT explícito para os papéis
-- de aplicação. Nada aqui é opcional: uma tabela sem FORCE fica aberta para o
-- dono, e uma política sem WITH CHECK impede ler o que é de outro tenant mas
-- não impede gravar com o `organization_id` de outro.
-- =============================================================================

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'customer_contacts', 'location_types', 'locations', 'suppliers',
    'calendars', 'calendar_windows', 'calendar_exceptions',
    'teams', 'team_members', 'availability_blocks'
  ]
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

-- -----------------------------------------------------------------------------
-- Auditoria.
--
-- O segundo argumento nomeia a coluna que identifica a linha, porque nem toda
-- tabela tem `id` — `team_members` é composta. O gatilho recusa iniciar se a
-- coluna informada não existir (migration 0002), então um erro de nome aqui
-- aparece na primeira escrita e não em silêncio.
-- -----------------------------------------------------------------------------
CREATE TRIGGER customers_audit            AFTER INSERT OR UPDATE OR DELETE ON aurora.customers            FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER customer_contacts_audit    AFTER INSERT OR UPDATE OR DELETE ON aurora.customer_contacts    FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER location_types_audit       AFTER INSERT OR UPDATE OR DELETE ON aurora.location_types       FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER locations_audit            AFTER INSERT OR UPDATE OR DELETE ON aurora.locations            FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER suppliers_audit            AFTER INSERT OR UPDATE OR DELETE ON aurora.suppliers            FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER calendars_audit            AFTER INSERT OR UPDATE OR DELETE ON aurora.calendars            FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER teams_audit                AFTER INSERT OR UPDATE OR DELETE ON aurora.teams                FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER team_members_audit         AFTER INSERT OR UPDATE OR DELETE ON aurora.team_members         FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('role_in_team', 'team_id');
CREATE TRIGGER availability_blocks_audit  AFTER INSERT OR UPDATE OR DELETE ON aurora.availability_blocks  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('kind');

-- Janelas e exceções de calendário mudam em lote quando se edita um calendário;
-- auditá-las linha a linha encheria a trilha de ruído sem responder nenhuma
-- pergunta que o registro do calendário já não responda.

-- -----------------------------------------------------------------------------
-- Locais acessíveis a um vínculo.
--
-- `membership_scopes` (migration 0001) guarda a raiz de escopo; o que a
-- aplicação precisa é do conjunto de locais abaixo dela. Resolver isso por
-- prefixo de caminho é o ganho concreto do ADR-026: uma condição indexável, sem
-- CTE recursiva por requisição.
--
-- Roda como invocador, dentro do contexto de tenant, e devolve apenas locais da
-- organização corrente.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.accessible_location_ids(p_membership_id uuid)
RETURNS TABLE (location_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  WITH scope AS (
    SELECT ms.location_scope, ms.location_ids, ms.customer_scope, ms.customer_ids
      FROM aurora.membership_scopes ms
     WHERE ms.membership_id = p_membership_id
  ),
  roots AS (
    SELECT l.path
      FROM aurora.locations l, scope s
     WHERE s.location_scope = 'listed' AND l.id = ANY (s.location_ids)
  )
  SELECT l.id
    FROM aurora.locations l, scope s
   WHERE l.deleted_at IS NULL
     AND (s.location_scope = 'all'
          OR EXISTS (SELECT 1 FROM roots r WHERE l.path LIKE r.path || '%'))
     AND (s.customer_scope = 'all' OR l.customer_id = ANY (s.customer_ids))
$fn$;

REVOKE ALL ON FUNCTION aurora.accessible_location_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.accessible_location_ids(uuid) TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- Clientes acessíveis a um vínculo.
--
-- O par da função acima. Existe separada porque a pergunta "quais clientes"
-- aparece sozinha em várias telas, e resolvê-la por meio dos locais obrigaria a
-- percorrer a árvore inteira para responder algo que está a um passo de
-- distância.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.accessible_customer_ids(p_membership_id uuid)
RETURNS TABLE (customer_id uuid)
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT c.id
    FROM aurora.customers c, aurora.membership_scopes ms
   WHERE ms.membership_id = p_membership_id
     AND c.deleted_at IS NULL
     AND (ms.customer_scope = 'all' OR c.id = ANY (ms.customer_ids))
$fn$;

REVOKE ALL ON FUNCTION aurora.accessible_customer_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.accessible_customer_ids(uuid) TO aurora_app, aurora_readonly;
