-- =============================================================================
-- Aurora — 0020 situações, transições e motivos de espera (ADR-003, ADR-004)
-- EPIC-008
--
-- A REFERÊNCIA TINHA 42 ESTADOS. ESTA MIGRATION EXPLICA POR QUÊ, E O DESFAZ.
--
-- Lá, o motivo do bloqueio foi codificado dentro do estado: "Aguardando peças",
-- "Aguardando aprovação do orçamento", "Aguardando liberação da unidade",
-- "Aguardando empresa externa", "Aguardando NF para envio". Cada combinação de
-- situação e causa virou um estado, e a lista explodiu combinatoriamente.
--
-- Aqui são três eixos:
--
--   CATEGORIA   fixa na plataforma. É o que o software sabe interpretar — se
--               conta como ativo, se o relógio corre, se o ativo está parado.
--               Não é editável, e é por isso que o produto continua funcionando
--               quando a organização cria uma situação que ninguém previu.
--
--   SITUAÇÃO    configurável, declarando obrigatoriamente uma categoria. É o
--               vocabulário do cliente.
--
--   MOTIVO      dimensão separada, só aplicável na categoria `waiting`.
--
-- Consequência mensurável: "quanto tempo perdemos esperando peça?" passa a ser
-- uma consulta. Na referência exigiria somar estados grafados de cinco formas.
-- =============================================================================

CREATE TYPE aurora.status_category AS ENUM (
  'draft', 'open', 'scheduled', 'in_progress', 'waiting', 'review', 'done', 'closed', 'cancelled'
);
CREATE TYPE aurora.wait_responsible AS ENUM ('customer', 'supplier', 'internal', 'manager');

-- -----------------------------------------------------------------------------
-- work_order_statuses
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.work_order_statuses (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL,
  label             text NOT NULL,
  category          aurora.status_category NOT NULL,
  color             text,
  position          integer NOT NULL DEFAULT 0,
  is_system         boolean NOT NULL DEFAULT false,
  visible_on_board  boolean NOT NULL DEFAULT true,
  -- Exigir motivo é propriedade da SITUAÇÃO, não da categoria.
  --
  -- "Pausada" e "Aguardando" compartilham a categoria `waiting` porque têm a
  -- mesma semântica de SLA e de parada do ativo. Mas pausar é interrupção
  -- interna — fim de turno, prioridade maior — e não tem dependência externa a
  -- nomear. Exigir motivo ali obrigaria a inventar um, e motivo inventado
  -- envenena justamente o relatório que o ADR-004 existe para produzir.
  requires_wait_reason boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT wos_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT wos_label_present CHECK (length(btrim(label)) > 0),
  CONSTRAINT wos_color_format CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  -- Só faz sentido exigir motivo onde motivo existe.
  CONSTRAINT wos_reason_only_in_waiting CHECK (NOT requires_wait_reason OR category = 'waiting'),
  CONSTRAINT wos_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX wos_key_uq ON aurora.work_order_statuses (organization_id, key);
CREATE INDEX wos_org_category_idx ON aurora.work_order_statuses (organization_id, category)
  WHERE archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- Grafo de transições, por organização.
--
-- A tabela É a regra. Não existe `if` em código que decida se uma transição
-- vale: o motor lê estas linhas. É o que permite a uma rede hospitalar exigir
-- validação e a uma clínica pequena não exigir, sem duas versões do produto.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.work_order_status_transitions (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  from_status_id    uuid NOT NULL,
  to_status_id      uuid NOT NULL,
  permission_key    text NOT NULL REFERENCES aurora.permissions(key) ON DELETE RESTRICT,
  required_fields   text[] NOT NULL DEFAULT '{}',
  note              text NOT NULL DEFAULT '',
  PRIMARY KEY (from_status_id, to_status_id),
  CONSTRAINT wost_not_self CHECK (from_status_id <> to_status_id),
  CONSTRAINT wost_from_org_fk
    FOREIGN KEY (from_status_id, organization_id)
    REFERENCES aurora.work_order_statuses (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT wost_to_org_fk
    FOREIGN KEY (to_status_id, organization_id)
    REFERENCES aurora.work_order_statuses (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX wost_org_idx  ON aurora.work_order_status_transitions (organization_id);
CREATE INDEX wost_from_idx ON aurora.work_order_status_transitions (from_status_id);

-- -----------------------------------------------------------------------------
-- wait_reasons — a dimensão que o ADR-004 separou.
--
-- Tabela própria, e não `catalog_items`, pela regra do ADR-028: tem `pauses_sla`
-- e responsável, que são campos com consequência de cálculo, não rótulos.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.wait_reasons (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL,
  label             text NOT NULL,
  -- Padrão de fábrica: falta de peça NÃO pausa o relógio. Falta de peça é
  -- responsabilidade da organização, não do cliente, e um SLA que pausa aí
  -- perdoaria o próprio atraso. A organização pode inverter — a coluna é
  -- configurável — mas terá de fazê-lo explicitamente.
  pauses_sla        boolean NOT NULL DEFAULT false,
  responsible       aurora.wait_responsible NOT NULL DEFAULT 'internal',
  requires_note     boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  is_system         boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT wait_reasons_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT wait_reasons_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX wait_reasons_key_uq ON aurora.wait_reasons (organization_id, key);
CREATE INDEX wait_reasons_org_idx ON aurora.wait_reasons (organization_id) WHERE archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- Situação de sistema não muda de categoria.
--
-- Mudar a categoria de "Concluída" de `review` para `done` alteraria em silêncio
-- o significado de todas as OS já fechadas — e todo indicador que as conta.
-- Renomear o rótulo continua livre: é para isso que rótulo e chave são
-- separados.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_work_order_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'a chave da situação é imutável; para renomear, altere o rótulo'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.is_system AND NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'a categoria de uma situação de sistema é imutável: mudá-la reinterpretaria todas as OS já registradas nela'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.is_system AND NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    RAISE EXCEPTION 'situação de sistema não é arquivável' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER work_order_statuses_guard BEFORE UPDATE ON aurora.work_order_statuses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_work_order_status_guard();

CREATE TRIGGER work_order_statuses_touch BEFORE UPDATE ON aurora.work_order_statuses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER wait_reasons_touch BEFORE UPDATE ON aurora.wait_reasons
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER work_order_statuses_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.work_order_statuses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('label');
CREATE TRIGGER wait_reasons_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.wait_reasons
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('label');
CREATE TRIGGER wost_audit AFTER INSERT OR DELETE ON aurora.work_order_status_transitions
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('permission_key', 'from_status_id');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_statuses', 'work_order_status_transitions', 'wait_reasons']
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
