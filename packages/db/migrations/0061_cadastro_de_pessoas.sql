-- =============================================================================
-- Aurora — 0061 cadastro de pessoas e perfis de acesso (reunião 16/10/2026)
--
-- 1. Dados de cadastro do VÍNCULO: CPF, telefone, empresa e o rastro da
--    situação de acesso (motivo, quando, quem). A profissão continua em
--    `memberships.job_title` — texto, que NÃO concede permissão.
--
-- 2. Registros profissionais como PARES (tipo, número), 0..N por vínculo, em
--    tabela própria. Nunca uma coluna por conselho (CRM, CREA, COREN…): a pessoa
--    pode ter dois, e o conselho de amanhã não exige migration.
--
-- 3. Os papéis de fábrica `operator` (Operador) e `manager` (Gestor) para as
--    organizações que já existem — as novas os recebem por
--    `provisionFactoryRoles`. As listas abaixo espelham `FACTORY_ROLES`
--    (packages/domain/src/permissions.ts); a próxima chamada de
--    `provisionFactoryRoles` (seed, admin:criar) reconcilia qualquer diferença.
-- =============================================================================

ALTER TABLE aurora.memberships
  ADD COLUMN IF NOT EXISTS cpf               text,
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS company_name      text,
  ADD COLUMN IF NOT EXISTS status_reason     text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid;

ALTER TABLE aurora.memberships
  ADD CONSTRAINT memberships_cpf_digits CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
  ADD CONSTRAINT memberships_phone_len  CHECK (phone IS NULL OR length(phone) BETWEEN 8 AND 32),
  ADD CONSTRAINT memberships_company_len CHECK (company_name IS NULL OR length(company_name) <= 160);

-- O mesmo CPF não vira duas pessoas na mesma organização.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_cpf_uq
  ON aurora.memberships (organization_id, cpf)
  WHERE cpf IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Registros profissionais
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.membership_registrations (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL,
  kind              text NOT NULL,
  number            text NOT NULL,
  region            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT membership_registrations_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT membership_registrations_membership_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT membership_registrations_kind
    CHECK (kind IN ('CRM', 'COREN', 'CREA', 'CFT', 'CREFITO', 'OAB', 'OUTRO')),
  CONSTRAINT membership_registrations_number_fmt
    CHECK (number ~ '^[A-Z0-9][A-Z0-9./-]{1,23}$'),
  CONSTRAINT membership_registrations_region_fmt
    CHECK (region IS NULL OR region ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX membership_registrations_uq
  ON aurora.membership_registrations (membership_id, kind, number);
CREATE INDEX membership_registrations_org_idx ON aurora.membership_registrations (organization_id);

CREATE TRIGGER membership_registrations_audit AFTER INSERT OR UPDATE OR DELETE
  ON aurora.membership_registrations FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('kind', 'number');

DO $do$
BEGIN
  ALTER TABLE aurora.membership_registrations OWNER TO aurora_owner;
  ALTER TABLE aurora.membership_registrations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.membership_registrations FORCE  ROW LEVEL SECURITY;
  CREATE POLICY membership_registrations_tenant_isolation ON aurora.membership_registrations FOR ALL
    USING (organization_id = aurora.current_organization_id())
    WITH CHECK (organization_id = aurora.current_organization_id());
  GRANT SELECT, INSERT, DELETE ON aurora.membership_registrations TO aurora_app;
  GRANT SELECT ON aurora.membership_registrations TO aurora_readonly;
END
$do$;

-- -----------------------------------------------------------------------------
-- Papéis Operador e Gestor nas organizações existentes
-- -----------------------------------------------------------------------------
INSERT INTO aurora.roles (id, organization_id, key, name, description, seat_type, is_system)
SELECT gen_random_uuid(), o.id, v.key, v.name, v.description, 'staff'::aurora.seat_type, true
  FROM aurora.organizations o
 CROSS JOIN (VALUES
   ('operator', 'Operador',
    'Perfil de acesso para quem executa a operação técnica: atende ordens, preenche procedimentos e usa peças. Não cadastra clientes, equipamentos, planos nem checklists. Profissão não define este papel.'),
   ('manager', 'Gestor',
    'Perfil de acesso gerencial dentro do próprio escopo: estoque, orçamentos, indicadores, usuários e operações de gestão. Não é administrador da plataforma nem responde pelo faturamento.')
 ) AS v(key, name, description)
 WHERE EXISTS (SELECT 1 FROM aurora.roles r WHERE r.organization_id = o.id AND r.key = 'technician' AND r.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM aurora.roles r WHERE r.organization_id = o.id AND r.key = v.key AND r.deleted_at IS NULL);

-- Operador = as permissões do Técnico + ver planos e orçamentos.
INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT op.organization_id, op.id, x.permission_key
  FROM aurora.roles op
  JOIN LATERAL (
    SELECT rp.permission_key
      FROM aurora.role_permissions rp
      JOIN aurora.roles t ON t.id = rp.role_id
     WHERE t.organization_id = op.organization_id AND t.key = 'technician' AND t.deleted_at IS NULL
    UNION
    SELECT k FROM unnest(ARRAY['maintenance_plan.read', 'quote.read']) AS k
  ) x ON true
 WHERE op.key = 'operator' AND op.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM aurora.permissions p WHERE p.key = x.permission_key)
ON CONFLICT DO NOTHING;

-- Gestor = toda leitura + a lista curada de FACTORY_ROLES.
INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT g.organization_id, g.id, p.key
  FROM aurora.roles g
  JOIN aurora.permissions p
    ON p.action = 'read'
    OR p.key = ANY (ARRAY[
      'organization.manage_members',
      'customer.create', 'customer.update',
      'location.create', 'location.update',
      'asset.create', 'asset.update', 'asset.transfer', 'asset.print_label', 'asset.read_financials',
      'service_request.triage', 'service_request.accept', 'service_request.reject',
      'work_order.create', 'work_order.update', 'work_order.comment', 'work_order.assign',
      'work_order.schedule', 'work_order.complete', 'work_order.validate', 'work_order.close',
      'work_order.cancel', 'work_order.read_costs', 'work_order.read_internal_notes',
      'time_entry.approve',
      'maintenance_plan.create', 'maintenance_plan.update', 'maintenance_plan.generate_cycle',
      'maintenance_plan.skip_item',
      'inventory.create', 'inventory.update', 'inventory.move', 'inventory.adjust', 'inventory.count',
      'inventory.read_costs',
      'quote.create', 'quote.update', 'quote.send', 'quote.approve',
      'contract.read_financials',
      'insight.read_financial_metrics', 'insight.manage_dashboards',
      'document.release_to_customer',
      'opportunity.authorize'
    ])
 WHERE g.key = 'manager' AND g.deleted_at IS NULL
ON CONFLICT DO NOTHING;
