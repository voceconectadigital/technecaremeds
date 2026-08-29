-- =============================================================================
-- Aurora — 0013 cadeia de classificação de ativos (SPEC v0.2 §07, ADR-006)
-- EPIC-005 · BL-021 a BL-023
--
-- fabricante → modelo → ativo
--
-- Na referência, fabricante e modelo são texto livre. Isso impede responder
-- "quantos BeneHeart R3 temos e qual a taxa de falha desse modelo?" — que é
-- exatamente a pergunta que justifica trocar de fornecedor. Normalizar custa
-- uma tela a mais no cadastro e devolve uma classe inteira de perguntas.
--
-- POR QUE ESTAS QUATRO NÃO SÃO `catalog_items`
--
-- Pela regra do ADR-028: forma diferente, tabela diferente.
--   · `manufacturers` tem país, site, contato de suporte e verificação
--   · `asset_models` tem fabricante, categoria, specs, vida útil de referência
--   · `criticality_levels` tem score e multiplicador de SLA — números que
--     entram em cálculo, não rótulos
--   · `asset_categories` tem herança de exigência regulatória
-- Nenhuma delas caberia em "chave, rótulo, posição, cor".
--
-- O que elas COMPARTILHAM com os catálogos é a governança: nome único por
-- organização sobre a forma normalizada, e mesclagem para consertar duplicata
-- que a importação criou. `aurora.normalize_label` (0011) é reaproveitada.
-- =============================================================================

CREATE TYPE aurora.asset_status AS ENUM (
  'active', 'under_maintenance', 'standby', 'loaned', 'decommissioned', 'disposed'
);
CREATE TYPE aurora.asset_ownership AS ENUM (
  'owned', 'leased', 'loaned', 'rented', 'service_only'
);

-- -----------------------------------------------------------------------------
-- asset_categories — classe funcional. Profundidade máxima 2 (SPEC §32).
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.asset_categories (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  normalized_name           text GENERATED ALWAYS AS (aurora.normalize_label(name)) STORED,
  code                      text,
  parent_id                 uuid,
  default_criticality_id    uuid,
  requires_calibration      boolean NOT NULL DEFAULT false,
  requires_electrical_test  boolean NOT NULL DEFAULT false,
  icon                      text,
  position                  integer NOT NULL DEFAULT 0,
  archived_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_by                uuid,
  CONSTRAINT asset_categories_name_meaningful CHECK (length(aurora.normalize_label(name)) > 0),
  CONSTRAINT asset_categories_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT asset_categories_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT asset_categories_parent_org_fk
    FOREIGN KEY (parent_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX asset_categories_name_uq
  ON aurora.asset_categories (organization_id, normalized_name) WHERE archived_at IS NULL;
CREATE INDEX asset_categories_org_idx ON aurora.asset_categories (organization_id) WHERE archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- criticality_levels — `score` e `sla_multiplier` entram em cálculo.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.criticality_levels (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  normalized_name   text GENERATED ALWAYS AS (aurora.normalize_label(name)) STORED,
  score             integer NOT NULL,
  color             text,
  sla_multiplier    numeric(4, 2) NOT NULL DEFAULT 1.00,
  position          integer NOT NULL DEFAULT 0,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT criticality_score_range CHECK (score BETWEEN 1 AND 100),
  -- Multiplicador zero ou negativo produziria prazo de SLA no passado. Acima de
  -- 10 não é escala de risco, é erro de digitação com consequência silenciosa.
  CONSTRAINT criticality_multiplier_range CHECK (sla_multiplier > 0 AND sla_multiplier <= 10),
  CONSTRAINT criticality_color_format CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT criticality_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX criticality_name_uq
  ON aurora.criticality_levels (organization_id, normalized_name) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX criticality_score_uq
  ON aurora.criticality_levels (organization_id, score) WHERE archived_at IS NULL;

ALTER TABLE aurora.asset_categories
  ADD CONSTRAINT asset_categories_criticality_org_fk
  FOREIGN KEY (default_criticality_id, organization_id)
  REFERENCES aurora.criticality_levels (id, organization_id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- manufacturers
--
-- `verified` existe por causa da importação: a planilha de origem traz "Lider",
-- "LIDER" e "Líder" como três fabricantes. As três entram como não verificadas
-- e vão para uma fila de curadoria — em vez de serem recusadas na importação,
-- que faria a migração inteira parar, ou aceitas em silêncio, que é o que a
-- referência fez.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.manufacturers (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  normalized_name   text GENERATED ALWAYS AS (aurora.normalize_label(name)) STORED,
  country           text,
  website           text,
  support_contact   text,
  verified          boolean NOT NULL DEFAULT false,
  merged_into_id    uuid,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT manufacturers_name_meaningful CHECK (length(aurora.normalize_label(name)) > 0),
  CONSTRAINT manufacturers_not_own_merge CHECK (merged_into_id IS DISTINCT FROM id),
  CONSTRAINT manufacturers_merged_is_archived CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL),
  CONSTRAINT manufacturers_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT manufacturers_merge_org_fk
    FOREIGN KEY (merged_into_id, organization_id)
    REFERENCES aurora.manufacturers (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX manufacturers_name_uq
  ON aurora.manufacturers (organization_id, normalized_name) WHERE archived_at IS NULL;
CREATE INDEX manufacturers_curation_idx
  ON aurora.manufacturers (organization_id) WHERE NOT verified AND archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- asset_models
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.asset_models (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  manufacturer_id             uuid NOT NULL,
  asset_category_id           uuid NOT NULL,
  name                        text NOT NULL,
  normalized_name             text GENERATED ALWAYS AS (aurora.normalize_label(name)) STORED,
  code                        text,
  specs                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_useful_life_years   integer,
  verified                    boolean NOT NULL DEFAULT false,
  merged_into_id              uuid,
  archived_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid,
  updated_by                  uuid,
  CONSTRAINT asset_models_name_meaningful CHECK (length(aurora.normalize_label(name)) > 0),
  CONSTRAINT asset_models_life_positive CHECK (default_useful_life_years IS NULL OR default_useful_life_years > 0),
  CONSTRAINT asset_models_not_own_merge CHECK (merged_into_id IS DISTINCT FROM id),
  CONSTRAINT asset_models_merged_is_archived CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL),
  CONSTRAINT asset_models_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT asset_models_manufacturer_org_fk
    FOREIGN KEY (manufacturer_id, organization_id)
    REFERENCES aurora.manufacturers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT asset_models_category_org_fk
    FOREIGN KEY (asset_category_id, organization_id)
    REFERENCES aurora.asset_categories (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT asset_models_merge_org_fk
    FOREIGN KEY (merged_into_id, organization_id)
    REFERENCES aurora.asset_models (id, organization_id) ON DELETE RESTRICT
);
-- Único por (fabricante, nome): dois fabricantes podem ter modelos homônimos, e
-- frequentemente têm — "Serie 3", "Modelo A".
CREATE UNIQUE INDEX asset_models_name_uq
  ON aurora.asset_models (organization_id, manufacturer_id, normalized_name) WHERE archived_at IS NULL;
CREATE INDEX asset_models_manufacturer_idx ON aurora.asset_models (manufacturer_id) WHERE archived_at IS NULL;
CREATE INDEX asset_models_category_idx     ON aurora.asset_models (asset_category_id) WHERE archived_at IS NULL;
CREATE INDEX asset_models_curation_idx
  ON aurora.asset_models (organization_id) WHERE NOT verified AND archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- Categoria: no máximo dois níveis, pela mesma razão dos catálogos (0011) —
-- profundidade 2 torna o ciclo impossível por construção.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_asset_category_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_parent_parent uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id INTO v_parent_parent FROM aurora.asset_categories WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'categoria pai inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'categoria de ativo aceita no máximo dois níveis' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM aurora.asset_categories c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION 'esta categoria já tem subcategorias e não pode virar subcategoria de outra'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER asset_categories_guard BEFORE INSERT OR UPDATE ON aurora.asset_categories
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_asset_category_guard();

-- -----------------------------------------------------------------------------
-- Mesclagem de fabricante e de modelo.
--
-- Não reaproveita `merge_catalog_item` porque as tabelas são outras e as
-- referências a reapontar são outras. Duas funções curtas e explícitas custam
-- menos, e erram menos, que um motor genérico de SQL dinâmico sobre nome de
-- tabela — que precisaria de um registro, de validação de identificador e de
-- uma camada de confiança que aqui não se paga.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.merge_manufacturers(p_source uuid, p_target uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_moved integer;
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'não é possível mesclar um fabricante nele mesmo' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aurora.manufacturers WHERE id = p_source) THEN
    RAISE EXCEPTION 'fabricante de origem inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aurora.manufacturers WHERE id = p_target AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'fabricante de destino inexistente, arquivado ou fora do seu acesso'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Modelo homônimo dos dois lados viraria violação de unicidade no meio da
  -- mesclagem. Recusar antes, nomeando o conflito, deixa a decisão com quem
  -- sabe se "Serie 3" da Lider e "Serie 3" da LIDER são o mesmo aparelho.
  IF EXISTS (
    SELECT 1 FROM aurora.asset_models a
      JOIN aurora.asset_models b
        ON b.manufacturer_id = p_target
       AND b.normalized_name = a.normalized_name
       AND b.archived_at IS NULL
     WHERE a.manufacturer_id = p_source AND a.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'os dois fabricantes têm modelos de mesmo nome; mescle os modelos antes'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE aurora.asset_models SET manufacturer_id = p_target WHERE manufacturer_id = p_source;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE aurora.manufacturers
     SET archived_at = coalesce(archived_at, now()), merged_into_id = p_target
   WHERE id = p_source;
  RETURN v_moved;
END
$fn$;
