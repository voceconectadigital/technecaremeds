-- =============================================================================
-- Aurora — 0026 requisitos de conclusão por natureza de OS (SPEC v0.2 §10)
-- EPIC-011
--
-- "Ao concluir, o sistema valida um conjunto configurável por NATUREZA."
-- Uma preventiva exige checklist completo e foto; uma corretiva de urgência
-- exige só a resolução. Fixar um conjunto único obrigaria a pior das duas
-- escolhas: ou burocratizar a urgência, ou afrouxar a preventiva.
--
-- POR QUE TABELA PRÓPRIA, E NÃO `catalog_items.custom`
--
-- Pela mesma regra do ADR-028 que manteve `wait_reasons` separada: a natureza
-- de OS tem configuração que os demais catálogos não têm. Guardar em `custom`
-- funcionaria e custaria a tipagem — um requisito escrito errado só apareceria
-- na hora de concluir uma OS, para o técnico, que não pode fazer nada a
-- respeito. Aqui a chave estrangeira recusa o requisito inexistente na hora em
-- que alguém o configura.
-- =============================================================================

-- Catálogo de plataforma: o requisito só existe se houver código que o
-- verifique. Mesma escolha de `permissions` e `catalog_definitions`.
CREATE TABLE aurora.completion_requirements (
  key           text PRIMARY KEY,
  label         text NOT NULL,
  description   text NOT NULL DEFAULT ''
);

INSERT INTO aurora.completion_requirements (key, label, description) VALUES
  ('checklist_complete',      'Checklist completo',              'Todos os itens obrigatórios e visíveis respondidos'),
  ('failed_items_have_photo', 'Foto nos itens reprovados',       'Item reprovado que exige evidência precisa ter foto'),
  ('hours_logged',            'Horas apontadas',                 'Ao menos um apontamento fechado nesta OS'),
  ('resolution_filled',       'Resolução descrita',              'O que foi feito, em ao menos 10 caracteres'),
  ('cause_code_filled',       'Causa identificada',              'Segundo eixo da taxonomia de falha'),
  ('photo_before_after',      'Fotos de antes e depois',         'Uma foto de cada finalidade'),
  ('customer_signature',      'Assinatura do cliente',           'Assinatura colhida na conclusão'),
  ('parts_confirmed',         'Peças confirmadas',               'Nenhuma peça pendente de confirmação de consumo');

CREATE TABLE aurora.work_order_type_settings (
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_type_id        uuid NOT NULL,
  completion_requirements   text[] NOT NULL DEFAULT '{}',
  requires_asset            boolean NOT NULL DEFAULT false,
  causes_asset_downtime     boolean NOT NULL DEFAULT true,
  default_checklist_key     text,
  PRIMARY KEY (work_order_type_id),
  CONSTRAINT wots_type_org_fk
    FOREIGN KEY (work_order_type_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX wots_org_idx ON aurora.work_order_type_settings (organization_id);

-- Requisito desconhecido é recusado quando alguém o configura, e não quando o
-- técnico tenta concluir. Um array de texto sem verificação deixaria um erro de
-- digitação virar um requisito que nunca é cobrado — pior que o erro, porque
-- parece configurado.
CREATE FUNCTION aurora.fn_completion_requirements_known() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_desconhecidos text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_desconhecidos
    FROM unnest(NEW.completion_requirements) AS r
   WHERE r NOT IN (SELECT key FROM aurora.completion_requirements);
  IF v_desconhecidos IS NOT NULL THEN
    RAISE EXCEPTION 'requisito de conclusão desconhecido: %', v_desconhecidos
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A natureza tem de ser natureza mesmo, e não outro item de catálogo.
  IF NOT EXISTS (
    SELECT 1 FROM aurora.catalog_items
     WHERE id = NEW.work_order_type_id AND catalog_key = 'work_order_type'
  ) THEN
    RAISE EXCEPTION 'este item não é uma natureza de OS' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER wots_guard BEFORE INSERT OR UPDATE ON aurora.work_order_type_settings
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_completion_requirements_known();

CREATE TRIGGER wots_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.work_order_type_settings
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('work_order_type_id', 'work_order_type_id');

ALTER TABLE aurora.completion_requirements     OWNER TO aurora_owner;
ALTER TABLE aurora.work_order_type_settings    OWNER TO aurora_owner;

ALTER TABLE aurora.completion_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.completion_requirements FORCE  ROW LEVEL SECURITY;
CREATE POLICY completion_requirements_read_all ON aurora.completion_requirements FOR SELECT USING (true);

ALTER TABLE aurora.work_order_type_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.work_order_type_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY wots_tenant_isolation ON aurora.work_order_type_settings FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

GRANT SELECT ON aurora.completion_requirements TO aurora_app, aurora_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.work_order_type_settings TO aurora_app;
GRANT SELECT ON aurora.work_order_type_settings TO aurora_readonly;
