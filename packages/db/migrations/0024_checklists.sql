-- =============================================================================
-- Aurora — 0024 motor de checklists versionados (SPEC v0.2 §14, ADR-012)
-- EPIC-011
--
-- A referência guarda o checklist como um array JSON de `{tipo, desc, appr[]}`
-- numa coluna. É simples e barato de escrever, e impossível de versionar, de
-- consultar e de agregar. "Quantos ventiladores reprovaram no teste de pressão
-- no último trimestre?" não tem resposta a partir de um JSON solto.
--
-- Aqui o checklist é relacional e versionado, porque a resposta de um checklist
-- É EVIDÊNCIA — e evidência que muda depois do fato deixa de ser evidência.
--
-- A REGRA QUE ORGANIZA TUDO: VERSÃO PUBLICADA É IMUTÁVEL
--
-- Publicar cria uma versão nova. Editar uma versão publicada é impossível — não
-- por convenção, por gatilho. Uma resposta antiga continua apontando para a
-- versão que foi de fato usada, e assim a pergunta "o que exatamente foi
-- verificado naquele dia?" continua tendo resposta cinco anos depois.
-- =============================================================================

CREATE TYPE aurora.checklist_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE aurora.checklist_item_kind AS ENUM (
  'text', 'number', 'boolean', 'option', 'multi_option', 'photo', 'date'
);
CREATE TYPE aurora.checklist_verdict AS ENUM ('pass', 'fail', 'na');
CREATE TYPE aurora.photo_requirement AS ENUM ('never', 'always', 'on_fail');
CREATE TYPE aurora.fail_action AS ENUM ('none', 'flag', 'block_completion', 'create_work_order');

-- -----------------------------------------------------------------------------
-- checklist_templates — uma linha por VERSÃO.
--
-- `key` identifica o checklist ao longo do tempo; `version` identifica a
-- encarnação. A resposta aponta para a versão, não para a chave.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.checklist_templates (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  status            aurora.checklist_status NOT NULL DEFAULT 'draft',
  published_at      timestamptz,
  published_by      uuid,
  supersedes_id     uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT ct_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  CONSTRAINT ct_version_positive CHECK (version >= 1),
  CONSTRAINT ct_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT ct_published_has_stamp CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT ct_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ct_supersedes_org_fk
    FOREIGN KEY (supersedes_id, organization_id)
    REFERENCES aurora.checklist_templates (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ct_key_version_uq ON aurora.checklist_templates (organization_id, key, version);
-- Só uma versão em rascunho por chave: duas em edição ao mesmo tempo produziriam
-- duas "próximas versões" e ninguém saberia qual publicar.
CREATE UNIQUE INDEX ct_one_draft_uq
  ON aurora.checklist_templates (organization_id, key) WHERE status = 'draft';
CREATE INDEX ct_published_idx
  ON aurora.checklist_templates (organization_id, key, version DESC) WHERE status = 'published';

CREATE TABLE aurora.checklist_sections (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  template_id       uuid NOT NULL,
  title             text NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  CONSTRAINT cs_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT cs_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT cs_template_org_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES aurora.checklist_templates (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX cs_template_idx ON aurora.checklist_sections (template_id, position);

CREATE TABLE aurora.checklist_items (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  template_id           uuid NOT NULL,
  section_id            uuid,
  kind                  aurora.checklist_item_kind NOT NULL,
  label                 text NOT NULL,
  help_text             text NOT NULL DEFAULT '',
  required              boolean NOT NULL DEFAULT true,
  position              integer NOT NULL DEFAULT 0,
  options               text[] NOT NULL DEFAULT '{}',
  /** Opções que reprovam, para `option` e `multi_option`. */
  failing_options       text[] NOT NULL DEFAULT '{}',
  min_value             numeric,
  max_value             numeric,
  unit                  text,
  expected_boolean      boolean,
  min_selections        integer,
  max_selections        integer,
  min_photos            integer,
  requires_photo_when   aurora.photo_requirement NOT NULL DEFAULT 'never',
  fail_action           aurora.fail_action NOT NULL DEFAULT 'none',
  /** Lógica condicional: mostrar este item se o item X tiver o valor Y. */
  condition_item_id     uuid,
  condition_equals      text,
  CONSTRAINT ci_label_present CHECK (length(btrim(label)) > 0),
  CONSTRAINT ci_range_order CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
  -- Faixa numérica só faz sentido em item numérico; opção só em item de opção.
  -- Configuração que nunca seria lida é erro de configuração, e erro de
  -- configuração deve falhar onde foi configurado.
  CONSTRAINT ci_range_only_number CHECK (
    kind = 'number' OR (min_value IS NULL AND max_value IS NULL AND unit IS NULL)
  ),
  CONSTRAINT ci_options_coherent CHECK (
    (kind IN ('option', 'multi_option') AND cardinality(options) > 0)
    OR (kind NOT IN ('option', 'multi_option') AND cardinality(options) = 0)
  ),
  CONSTRAINT ci_failing_subset CHECK (failing_options <@ options),
  CONSTRAINT ci_expected_only_boolean CHECK (kind = 'boolean' OR expected_boolean IS NULL),
  CONSTRAINT ci_selections_only_multi CHECK (
    kind = 'multi_option' OR (min_selections IS NULL AND max_selections IS NULL)
  ),
  CONSTRAINT ci_photos_only_photo CHECK (kind = 'photo' OR min_photos IS NULL),
  CONSTRAINT ci_condition_pair CHECK ((condition_item_id IS NULL) = (condition_equals IS NULL)),
  CONSTRAINT ci_condition_not_self CHECK (condition_item_id IS DISTINCT FROM id),
  CONSTRAINT ci_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ci_template_org_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES aurora.checklist_templates (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT ci_section_org_fk
    FOREIGN KEY (section_id, organization_id)
    REFERENCES aurora.checklist_sections (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT ci_condition_org_fk
    FOREIGN KEY (condition_item_id, organization_id)
    REFERENCES aurora.checklist_items (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX ci_template_idx ON aurora.checklist_items (template_id, position);
CREATE INDEX ci_section_idx  ON aurora.checklist_items (section_id, position);

-- -----------------------------------------------------------------------------
-- Respostas — congeladas na versão que foi usada.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.checklist_responses (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  template_id       uuid NOT NULL,
  /** Redundante com o template, e de propósito: sobrevive a qualquer refatoração. */
  template_key      text NOT NULL,
  template_version  integer NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  CONSTRAINT cr_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT cr_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cr_template_org_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES aurora.checklist_templates (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cr_wo_template_uq ON aurora.checklist_responses (work_order_id, template_id);
CREATE INDEX cr_org_idx ON aurora.checklist_responses (organization_id);

CREATE TABLE aurora.checklist_answers (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  response_id       uuid NOT NULL,
  item_id           uuid NOT NULL,
  value_text        text,
  value_number      numeric,
  value_boolean     boolean,
  value_options     text[],
  value_date        date,
  verdict           aurora.checklist_verdict NOT NULL DEFAULT 'na',
  photo_count       integer NOT NULL DEFAULT 0,
  note              text,
  measured_by       uuid,
  measured_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ca_photo_count_non_negative CHECK (photo_count >= 0),
  CONSTRAINT ca_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT ca_response_org_fk
    FOREIGN KEY (response_id, organization_id)
    REFERENCES aurora.checklist_responses (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT ca_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.checklist_items (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ca_response_item_uq ON aurora.checklist_answers (response_id, item_id);
CREATE INDEX ca_org_idx     ON aurora.checklist_answers (organization_id);
-- A pergunta que o JSON solto da referência não respondia: "quantos reprovaram
-- neste item no último trimestre?".
CREATE INDEX ca_item_verdict_idx ON aurora.checklist_answers (item_id, verdict, measured_at);

-- -----------------------------------------------------------------------------
-- Versão publicada é imutável.
--
-- Sem isto, editar um item de um template já usado mudaria retroativamente o
-- significado de todas as respostas que apontam para ele — e a evidência
-- deixaria de ser evidência sem que ninguém percebesse.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_checklist_template_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'published' THEN
    -- Arquivar é a única mudança permitida: retira de circulação sem alterar o
    -- que já foi respondido.
    IF NEW.status = 'archived'
       AND NEW.key = OLD.key AND NEW.version = OLD.version
       AND NEW.title = OLD.title AND NEW.description = OLD.description THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a versão % do checklist "%" está publicada e é imutável; crie a próxima versão',
      OLD.version, OLD.key
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'chave e versão do checklist são imutáveis' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER checklist_templates_guard BEFORE UPDATE ON aurora.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_template_guard();

/** Estrutura de versão publicada também é imutável — itens e seções incluídos. */
CREATE FUNCTION aurora.fn_checklist_structure_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_template uuid;
  v_status   aurora.checklist_status;
BEGIN
  v_template := CASE TG_OP WHEN 'DELETE' THEN OLD.template_id ELSE NEW.template_id END;
  SELECT status INTO v_status FROM aurora.checklist_templates WHERE id = v_template;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'checklist inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'a estrutura de um checklist publicado não muda; crie a próxima versão'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

CREATE TRIGGER checklist_items_guard BEFORE INSERT OR UPDATE OR DELETE ON aurora.checklist_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_structure_guard();
CREATE TRIGGER checklist_sections_guard BEFORE INSERT OR UPDATE OR DELETE ON aurora.checklist_sections
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_structure_guard();

-- -----------------------------------------------------------------------------
-- Uma resposta só se anexa a um checklist PUBLICADO.
--
-- Responder um rascunho produziria evidência sobre um documento que ainda pode
-- mudar — e que provavelmente vai.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_checklist_response_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status  aurora.checklist_status;
  v_key     text;
  v_version integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.template_version IS DISTINCT FROM OLD.template_version THEN
      RAISE EXCEPTION 'a versão do checklist usada numa resposta é imutável'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status, key, version INTO v_status, v_key, v_version
    FROM aurora.checklist_templates WHERE id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checklist inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'só se responde checklist publicado; "%" está em %', v_key, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Congela a identificação da versão na própria resposta.
  NEW.template_key := v_key;
  NEW.template_version := v_version;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER checklist_responses_guard BEFORE INSERT OR UPDATE ON aurora.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_response_guard();

/** A resposta pertence ao mesmo template da resposta-mãe. */
CREATE FUNCTION aurora.fn_checklist_answer_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_resp_template uuid;
  v_item_template uuid;
BEGIN
  SELECT template_id INTO v_resp_template FROM aurora.checklist_responses WHERE id = NEW.response_id;
  SELECT template_id INTO v_item_template FROM aurora.checklist_items WHERE id = NEW.item_id;
  IF v_resp_template IS DISTINCT FROM v_item_template THEN
    RAISE EXCEPTION 'este item pertence a outro checklist' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER checklist_answers_guard BEFORE INSERT OR UPDATE ON aurora.checklist_answers
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_checklist_answer_guard();

CREATE TRIGGER checklist_templates_touch BEFORE UPDATE ON aurora.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER checklist_templates_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('title');

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklist_templates', 'checklist_sections', 'checklist_items',
    'checklist_responses', 'checklist_answers'
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
