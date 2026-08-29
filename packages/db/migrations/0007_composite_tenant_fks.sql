-- =============================================================================
-- Aurora — 0007 chaves estrangeiras compostas por tenant
--
-- DEFEITO QUE ESTA MIGRATION CORRIGE
--
-- Encontrado pelo teste "A não consegue atribuir papel de B ao próprio vínculo",
-- que passou quando deveria falhar.
--
-- Verificação de chave estrangeira no PostgreSQL é executada como o dono da
-- tabela referenciada e **ignora Row Level Security**. Consequência: a policy
-- protege a LINHA, mas não protege a REFERÊNCIA. A organização A podia inserir
-- em `membership_roles` uma linha com `organization_id = A` apontando para um
-- `role_id` pertencente à organização B — a policy aprovava (organization_id
-- estava certo) e a FK aprovava (o papel existia).
--
-- CORREÇÃO
--
-- Chave estrangeira COMPOSTA incluindo `organization_id`. Com isso, referenciar
-- uma linha de outro tenant deixa de ser bloqueado por política e passa a ser
-- estruturalmente impossível — o banco não consegue nem representar o estado
-- inválido.
--
-- Esta é a diferença entre "está proibido" e "não existe".
-- =============================================================================

-- Chaves candidatas necessárias para o lado referenciado da FK composta.
ALTER TABLE aurora.organizations ADD CONSTRAINT organizations_id_self_uq UNIQUE (id);
ALTER TABLE aurora.memberships   ADD CONSTRAINT memberships_id_org_uq    UNIQUE (id, organization_id);
ALTER TABLE aurora.roles         ADD CONSTRAINT roles_id_org_uq          UNIQUE (id, organization_id);

-- -----------------------------------------------------------------------------
-- membership_scopes
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.membership_scopes
  DROP CONSTRAINT membership_scopes_membership_id_fkey,
  ADD CONSTRAINT membership_scopes_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- role_permissions
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.role_permissions
  DROP CONSTRAINT role_permissions_role_id_fkey,
  ADD CONSTRAINT role_permissions_role_org_fk
    FOREIGN KEY (role_id, organization_id)
    REFERENCES aurora.roles (id, organization_id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- membership_roles — onde o defeito foi encontrado
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.membership_roles
  DROP CONSTRAINT membership_roles_membership_id_fkey,
  DROP CONSTRAINT membership_roles_role_id_fkey,
  ADD CONSTRAINT membership_roles_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT membership_roles_role_org_fk
    FOREIGN KEY (role_id, organization_id)
    REFERENCES aurora.roles (id, organization_id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- membership_permission_overrides
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.membership_permission_overrides
  DROP CONSTRAINT membership_permission_overrides_membership_id_fkey,
  ADD CONSTRAINT membership_overrides_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- Defesa adicional na função de permissões efetivas.
--
-- A FK composta já torna o estado inválido irrepresentável. Ainda assim, a
-- função passa a exigir que papel e vínculo pertençam à mesma organização:
-- se um dia alguém introduzir um caminho novo de escrita, a leitura continua
-- correta. Defesa em profundidade também vale dentro do banco.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.effective_permissions(p_membership_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  WITH ctx AS (
    SELECT m.organization_id FROM aurora.memberships m
     WHERE m.id = p_membership_id AND m.deleted_at IS NULL
  ),
  granted AS (
    SELECT rp.permission_key
      FROM aurora.membership_roles mr
      JOIN ctx                        ON ctx.organization_id = mr.organization_id
      JOIN aurora.roles r             ON r.id = mr.role_id
                                     AND r.organization_id = ctx.organization_id
                                     AND r.deleted_at IS NULL
      JOIN aurora.role_permissions rp ON rp.role_id = r.id
                                     AND rp.organization_id = ctx.organization_id
     WHERE mr.membership_id = p_membership_id
    UNION
    SELECT o.permission_key
      FROM aurora.membership_permission_overrides o
      JOIN ctx ON ctx.organization_id = o.organization_id
     WHERE o.membership_id = p_membership_id
       AND o.effect = 'grant'
       AND (o.expires_at IS NULL OR o.expires_at > now())
  ),
  denied AS (
    SELECT o.permission_key
      FROM aurora.membership_permission_overrides o
      JOIN ctx ON ctx.organization_id = o.organization_id
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
