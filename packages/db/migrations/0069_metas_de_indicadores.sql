-- =============================================================================
-- Aurora — 0069 METAS dos indicadores (relatórios Basic / Advanced / Expert,
-- Fase 1 — auditoria de 17/10/2026, §13)
--
-- Fórmula não é meta: o mesmo indicador tem meta diferente por organização, por
-- cliente e por contrato (disponibilidade: 92 %, 98 %, 98 %). Esta tabela guarda
-- SÓ a meta configurada — nenhum valor é semeado e nenhum indicador ganha meta
-- por padrão. Sem linha vigente, o relatório diz "SEM META CONFIGURADA".
--
--   · escopo: organização (cliente e contrato nulos), cliente, ou contrato (que
--     sempre traz o cliente dele — e o gatilho confere que é o cliente do
--     contrato). Precedência na leitura: contrato → cliente → organização;
--   · vigência em dias, inclusive nas duas pontas; `valid_to` nulo é vigência
--     aberta. Duas metas do MESMO escopo não podem se sobrepor (gatilho, com
--     trava consultiva — a vigência futura convive com a atual, mas não a cobre);
--   · sentido (≥ / ≤) e unidade são persistidos para a trilha de auditoria; a
--     aplicação os confere contra o catálogo de indicadores (que vive no
--     domínio, não no banco);
--   · apagar é arquivar (`deleted_at`): uma meta que já pautou relatório
--     entregue não some do histórico. O papel da API não tem DELETE;
--   · permissão própria `insight.manage_targets` (escrita). A leitura é
--     `insight.read`, como o resto dos indicadores.
--
-- ADITIVA: não altera nem remove nada que já existe.
-- =============================================================================

INSERT INTO aurora.permissions (key, resource, action, description, field_level)
VALUES ('insight.manage_targets', 'insight', 'manage_targets', 'Configurar as metas dos indicadores', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'insight.manage_targets'
  FROM aurora.roles r
 WHERE r.deleted_at IS NULL
   AND r.key IN ('owner', 'admin', 'maintenance_manager', 'manager')
ON CONFLICT DO NOTHING;

CREATE TABLE aurora.indicator_targets (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  /** Código estável do indicador (catálogo em `@aurora/domain`). */
  indicator_key    text NOT NULL,
  /** Nulo + contrato nulo = meta da organização. */
  customer_id      uuid,
  contract_id      uuid,
  valid_from       date NOT NULL,
  valid_to         date,
  target_value     numeric(14,4) NOT NULL,
  unit             text NOT NULL,
  direction        text NOT NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,

  CONSTRAINT indicator_targets_key_format CHECK (indicator_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT indicator_targets_unit_valid CHECK (unit IN ('count', 'minutes', 'hours', 'percent', 'score')),
  CONSTRAINT indicator_targets_direction_valid CHECK (direction IN ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER')),
  CONSTRAINT indicator_targets_value_non_negative CHECK (target_value >= 0),
  CONSTRAINT indicator_targets_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT indicator_targets_contract_has_customer CHECK (contract_id IS NULL OR customer_id IS NOT NULL),
  CONSTRAINT indicator_targets_note_len CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT indicator_targets_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT indicator_targets_customer_org_fk
    FOREIGN KEY (customer_id, organization_id) REFERENCES aurora.customers (id, organization_id),
  CONSTRAINT indicator_targets_contract_org_fk
    FOREIGN KEY (contract_id, organization_id) REFERENCES aurora.contracts (id, organization_id)
);

CREATE INDEX indicator_targets_lookup_idx
  ON aurora.indicator_targets (organization_id, indicator_key, valid_from)
  WHERE deleted_at IS NULL;

CREATE FUNCTION aurora.fn_indicator_target_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_contract_customer uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- O contrato é do cliente informado: meta de contrato com cliente de outro
  -- seria resolvida para o cliente errado.
  IF NEW.contract_id IS NOT NULL THEN
    SELECT customer_id INTO v_contract_customer FROM aurora.contracts WHERE id = NEW.contract_id;
    IF v_contract_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'o contrato da meta não pertence ao cliente informado'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Mesmo escopo, mesma vigência: uma só meta. A trava consultiva serializa duas
  -- gravações simultâneas do mesmo escopo (sem ela, ambas passariam na conferência).
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || '|' || NEW.indicator_key || '|' ||
    coalesce(NEW.customer_id::text, '-') || '|' || coalesce(NEW.contract_id::text, '-'), 0));

  IF EXISTS (
    SELECT 1 FROM aurora.indicator_targets o
     WHERE o.id <> NEW.id
       AND o.deleted_at IS NULL
       AND o.organization_id = NEW.organization_id
       AND o.indicator_key = NEW.indicator_key
       AND o.customer_id IS NOT DISTINCT FROM NEW.customer_id
       AND o.contract_id IS NOT DISTINCT FROM NEW.contract_id
       AND o.valid_from <= coalesce(NEW.valid_to, 'infinity'::date)
       AND coalesce(o.valid_to, 'infinity'::date) >= NEW.valid_from
  ) THEN
    RAISE EXCEPTION 'já existe meta deste indicador, neste escopo, com vigência sobreposta'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$fn$;
ALTER FUNCTION aurora.fn_indicator_target_guard() OWNER TO aurora_owner;

CREATE TRIGGER indicator_targets_guard BEFORE INSERT OR UPDATE ON aurora.indicator_targets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_indicator_target_guard();
CREATE TRIGGER indicator_targets_touch BEFORE UPDATE ON aurora.indicator_targets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER indicator_targets_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.indicator_targets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('indicator_key');

ALTER TABLE aurora.indicator_targets OWNER TO aurora_owner;
ALTER TABLE aurora.indicator_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.indicator_targets FORCE  ROW LEVEL SECURITY;
CREATE POLICY indicator_targets_tenant_isolation ON aurora.indicator_targets FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON aurora.indicator_targets TO aurora_app;
GRANT SELECT ON aurora.indicator_targets TO aurora_readonly;
