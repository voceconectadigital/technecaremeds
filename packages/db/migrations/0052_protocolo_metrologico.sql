-- =============================================================================
-- Aurora — 0052 protocolo metrológico como extensão do checklist versionado
-- Auditoria de gap V2 §18, P2.3 · PLAT §5 "Procedimento" · SPEC §14 (Fase 2)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NÃO EXISTE UM SEGUNDO MOTOR
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `checklist_templates` já é versionado, imutável depois de publicado, desce
-- ao campo e congela a versão na resposta. Um "motor de procedimentos" ao lado
-- reimplementaria tudo isso e divergiria na primeira correção. O protocolo
-- metrológico é um checklist com:
--
--   · cabeçalho: tipo de procedimento (calibração, TSE, qualificação, aceite)
--     e responsável técnico;
--   · instrumentos exigidos (por categoria de ativo — "analisador de segurança
--     elétrica"), na mesma imutabilidade da estrutura;
--   · itens `measurement`, com unidade, nominal, tolerâncias e leituras
--     exigidas.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- TOLERÂNCIA É DADO. COMPARAR É DECISÃO DE METROLOGISTA.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nominal e tolerâncias são guardados como o procedimento escrito os declara —
-- `tolerance_mode` diz se o número é absoluto (na unidade do item) ou
-- percentual. O sistema NÃO converte percentual em limite, NÃO arredonda e NÃO
-- julga a leitura: cada um desses passos é uma das cinco decisões bloqueadas
-- (critério de aceitação, arredondamento — `AURORA-METROLOGIA-FRONTEIRA.md`).
-- O veredito de um item `measurement` é sempre `na` até que um metrologista
-- valide a regra com casos de referência.
-- =============================================================================

ALTER TABLE aurora.checklist_templates
  ADD COLUMN IF NOT EXISTS procedure_kind aurora.procedure_kind,
  ADD COLUMN IF NOT EXISTS technical_manager_id uuid;

ALTER TABLE aurora.checklist_templates DROP CONSTRAINT IF EXISTS ct_manager_org_fk;
ALTER TABLE aurora.checklist_templates
  ADD CONSTRAINT ct_manager_org_fk
    FOREIGN KEY (technical_manager_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE aurora.checklist_items
  ADD COLUMN IF NOT EXISTS nominal_value     numeric,
  ADD COLUMN IF NOT EXISTS tolerance_minus   numeric,
  ADD COLUMN IF NOT EXISTS tolerance_plus    numeric,
  ADD COLUMN IF NOT EXISTS tolerance_mode    text,
  ADD COLUMN IF NOT EXISTS readings_required integer;

-- A unidade agora vale para `number` E para `measurement`. A restrição antiga
-- recusava unidade fora de `number`; ela é refeita com o tipo novo.
ALTER TABLE aurora.checklist_items DROP CONSTRAINT IF EXISTS ci_range_only_number;
ALTER TABLE aurora.checklist_items
  ADD CONSTRAINT ci_range_only_number CHECK (
    (kind = 'number')
    OR (kind = 'measurement' AND min_value IS NULL AND max_value IS NULL)
    OR (min_value IS NULL AND max_value IS NULL AND unit IS NULL)
  );

ALTER TABLE aurora.checklist_items DROP CONSTRAINT IF EXISTS ci_measurement_spec;
ALTER TABLE aurora.checklist_items
  ADD CONSTRAINT ci_measurement_spec CHECK (
    (kind <> 'measurement'
      AND nominal_value IS NULL AND tolerance_minus IS NULL AND tolerance_plus IS NULL
      AND tolerance_mode IS NULL AND readings_required IS NULL)
    OR (kind = 'measurement'
      -- medição sem unidade não é medição: "12" de quê?
      AND unit IS NOT NULL AND length(btrim(unit)) > 0
      AND readings_required IS NOT NULL AND readings_required BETWEEN 1 AND 50
      AND (tolerance_minus IS NULL OR tolerance_minus >= 0)
      AND (tolerance_plus IS NULL OR tolerance_plus >= 0)
      -- o modo só faz sentido com tolerância, e tolerância exige o modo
      AND ((tolerance_minus IS NULL AND tolerance_plus IS NULL) = (tolerance_mode IS NULL))
      AND (tolerance_mode IS NULL OR tolerance_mode IN ('absolute', 'percent')))
  );

-- -----------------------------------------------------------------------------
-- Instrumentos exigidos pelo protocolo ("padrões exigidos", PLAT §5).
--
-- Por CATEGORIA de ativo, não por exemplar: o protocolo diz "use um analisador
-- de segurança elétrica", e qualquer exemplar com certificado válido na data
-- serve. Faz parte da ESTRUTURA do protocolo — e por isso o mesmo gatilho de
-- imutabilidade de itens e seções vale aqui.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.checklist_template_instruments (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  template_id       uuid NOT NULL,
  asset_category_id uuid NOT NULL,
  note              text NOT NULL DEFAULT '',
  CONSTRAINT cti_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT cti_template_org_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES aurora.checklist_templates (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cti_category_org_fk
    FOREIGN KEY (asset_category_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cti_template_category_uq
  ON aurora.checklist_template_instruments (template_id, asset_category_id);
CREATE INDEX cti_org_idx ON aurora.checklist_template_instruments (organization_id);

CREATE TRIGGER checklist_template_instruments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON aurora.checklist_template_instruments
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_structure_guard();

-- -----------------------------------------------------------------------------
-- O cabeçalho do protocolo publicado também é imutável.
--
-- O gatilho da 0024 confere título e descrição; tipo de procedimento e
-- responsável técnico passam a fazer parte do que um protocolo publicado
-- PROMETE, e mudar um deles depois mudaria o significado das sessões feitas.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_checklist_template_header_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status <> 'draft'
     AND (NEW.procedure_kind IS DISTINCT FROM OLD.procedure_kind
          OR NEW.technical_manager_id IS DISTINCT FROM OLD.technical_manager_id) THEN
    RAISE EXCEPTION 'o tipo e o responsável técnico de um protocolo publicado não mudam; crie a próxima versão'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER checklist_templates_header_guard BEFORE UPDATE ON aurora.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_template_header_guard();

DO $do$
BEGIN
  ALTER TABLE aurora.checklist_template_instruments OWNER TO aurora_owner;
  ALTER TABLE aurora.checklist_template_instruments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.checklist_template_instruments FORCE  ROW LEVEL SECURITY;
  CREATE POLICY checklist_template_instruments_tenant_isolation ON aurora.checklist_template_instruments FOR ALL
    USING (organization_id = aurora.current_organization_id())
    WITH CHECK (organization_id = aurora.current_organization_id());
  GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.checklist_template_instruments TO aurora_app;
  GRANT SELECT ON aurora.checklist_template_instruments TO aurora_readonly;
END
$do$;
