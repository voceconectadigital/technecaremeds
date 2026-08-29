-- =============================================================================
-- Aurora — 0027 SLA (SPEC v0.2 §11) · EPIC-010
--
-- A referência põe `tempo_atendimento` e `tempo_fechamento` em minutos NO
-- EQUIPAMENTO e mede "% de chamados cumpridos dentro do prazo". É um começo
-- correto e não suporta contrato, horário comercial nem feriado.
--
-- TRÊS DECISÕES ESTRUTURAIS
--
-- 1. A POLÍTICA RESOLVIDA É CONGELADA NA OS
--    Trocar o contrato amanhã não pode reescrever se o atendimento de ontem
--    cumpriu o prazo. O relógio guarda o alvo em minutos e o calendário usados
--    — não uma referência que pode mudar debaixo dele.
--
-- 2. OS DOIS TEMPOS SÃO GRAVADOS, SEMPRE
--    `elapsed_minutes` (corridos) e `elapsed_business_minutes` (úteis). Guardar
--    só o segundo obrigaria a recalcular o histórico inteiro sempre que alguém
--    mudasse uma janela de calendário — e o histórico recalculado deixa de ser
--    histórico.
--
-- 3. REABRIR CRIA UM RELÓGIO NOVO
--    O anterior permanece. Reincidência se mede exatamente por isso: duas
--    resoluções para o mesmo problema, cada uma com o seu prazo.
-- =============================================================================

CREATE TYPE aurora.sla_target_kind AS ENUM ('response', 'onsite', 'resolution');
CREATE TYPE aurora.sla_clock_state AS ENUM ('running', 'paused', 'met', 'breached', 'cancelled');

CREATE TABLE aurora.sla_policies (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  calendar_id       uuid,
  is_default        boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT sla_policies_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT sla_policies_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT sla_policies_calendar_org_fk
    FOREIGN KEY (calendar_id, organization_id)
    REFERENCES aurora.calendars (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX sla_policies_name_uq
  ON aurora.sla_policies (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX sla_policies_one_default_uq
  ON aurora.sla_policies (organization_id) WHERE is_default AND archived_at IS NULL;

CREATE TABLE aurora.sla_targets (
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  policy_id           uuid NOT NULL,
  priority            aurora.request_priority NOT NULL,
  kind                aurora.sla_target_kind NOT NULL,
  duration_minutes    integer NOT NULL,
  business_hours_only boolean NOT NULL DEFAULT true,
  PRIMARY KEY (policy_id, priority, kind),
  CONSTRAINT sla_targets_duration_positive CHECK (duration_minutes > 0),
  CONSTRAINT sla_targets_policy_org_fk
    FOREIGN KEY (policy_id, organization_id)
    REFERENCES aurora.sla_policies (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX sla_targets_org_idx ON aurora.sla_targets (organization_id);

-- A cascata de resolução da política (§11): ativo → contrato → cliente →
-- organização. `contract` entra no EPIC-017; as três outras pontas já existem.
ALTER TABLE aurora.organizations ADD COLUMN default_sla_policy_id uuid;
ALTER TABLE aurora.customers     ADD COLUMN default_sla_policy_id uuid;
ALTER TABLE aurora.assets        ADD COLUMN sla_policy_id uuid;

ALTER TABLE aurora.customers
  ADD CONSTRAINT customers_sla_policy_org_fk
  FOREIGN KEY (default_sla_policy_id, organization_id)
  REFERENCES aurora.sla_policies (id, organization_id) ON DELETE SET NULL;
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_sla_policy_org_fk
  FOREIGN KEY (sla_policy_id, organization_id)
  REFERENCES aurora.sla_policies (id, organization_id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- sla_clocks — um relógio por alvo, por documento.
--
-- `document_type` distingue solicitação de OS porque o relógio de RESPOSTA vive
-- na solicitação (tempo até alguém olhar) e os de ATENDIMENTO e RESOLUÇÃO vivem
-- na OS. Separá-los é o que permite medir demanda e trabalho como coisas
-- diferentes — o mesmo motivo do ADR-002.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.sla_clocks (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  document_type             text NOT NULL,
  document_id               uuid NOT NULL,
  kind                      aurora.sla_target_kind NOT NULL,
  state                     aurora.sla_clock_state NOT NULL DEFAULT 'running',

  -- congelados na abertura: o alvo e o calendário que valiam naquele momento
  policy_id                 uuid,
  policy_name_snapshot      text NOT NULL,
  target_minutes            integer NOT NULL,
  business_hours_only       boolean NOT NULL,
  calendar_snapshot         jsonb NOT NULL,
  priority_snapshot         aurora.request_priority NOT NULL,

  started_at                timestamptz NOT NULL,
  due_at                    timestamptz NOT NULL,
  stopped_at                timestamptz,
  breached_at               timestamptz,
  warned_at                 timestamptz,

  elapsed_minutes           integer,
  elapsed_business_minutes  integer,
  paused_minutes            integer NOT NULL DEFAULT 0,

  /** Sequência da reabertura: 1 é o primeiro relógio daquele tipo. */
  attempt                   integer NOT NULL DEFAULT 1,

  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sla_clocks_document_known CHECK (document_type IN ('service_request', 'work_order')),
  CONSTRAINT sla_clocks_target_positive CHECK (target_minutes > 0),
  CONSTRAINT sla_clocks_attempt_positive CHECK (attempt >= 1),
  CONSTRAINT sla_clocks_stopped_has_elapsed CHECK (
    state IN ('running', 'paused') OR stopped_at IS NOT NULL
  ),
  CONSTRAINT sla_clocks_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT sla_clocks_policy_org_fk
    FOREIGN KEY (policy_id, organization_id)
    REFERENCES aurora.sla_policies (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX sla_clocks_doc_kind_attempt_uq
  ON aurora.sla_clocks (document_type, document_id, kind, attempt);
CREATE INDEX sla_clocks_document_idx ON aurora.sla_clocks (document_type, document_id);
-- A varredura que procura o que está para vencer: pequena por construção.
CREATE INDEX sla_clocks_due_idx
  ON aurora.sla_clocks (organization_id, due_at)
  WHERE state = 'running';
CREATE INDEX sla_clocks_org_idx ON aurora.sla_clocks (organization_id, kind, state);

-- -----------------------------------------------------------------------------
-- sla_pauses — cada intervalo de pausa, com o motivo.
--
-- Um registro por pausa, e não um contador acumulado: "quanto tempo o relógio
-- ficou parado esperando aprovação de orçamento?" precisa do detalhe, e um
-- número somado não devolve o detalhe depois.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.sla_pauses (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  clock_id          uuid NOT NULL,
  wait_reason_id    uuid,
  paused_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  resumed_at        timestamptz,
  minutes           integer,
  CONSTRAINT sla_pauses_order CHECK (resumed_at IS NULL OR resumed_at >= paused_at),
  CONSTRAINT sla_pauses_clock_org_fk
    FOREIGN KEY (clock_id, organization_id)
    REFERENCES aurora.sla_clocks (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT sla_pauses_reason_org_fk
    FOREIGN KEY (wait_reason_id, organization_id)
    REFERENCES aurora.wait_reasons (id, organization_id) ON DELETE SET NULL
);
CREATE INDEX sla_pauses_clock_idx ON aurora.sla_pauses (clock_id, paused_at);
CREATE INDEX sla_pauses_org_idx   ON aurora.sla_pauses (organization_id);
-- Uma pausa aberta por relógio: duas seriam duas contagens do mesmo tempo.
CREATE UNIQUE INDEX sla_pauses_one_open_uq ON aurora.sla_pauses (clock_id) WHERE resumed_at IS NULL;

-- -----------------------------------------------------------------------------
-- O relógio parado é imutável.
--
-- Um SLA que pode ser "corrigido" depois do fato não mede nada. Ajustar exige
-- o mesmo que reabrir uma OS: um relógio novo, com o anterior preservado.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_sla_clock_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.state IN ('met', 'breached', 'cancelled') THEN
    RAISE EXCEPTION 'relógio de SLA já encerrado (%) não se altera; reabrir cria um relógio novo', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.target_minutes IS DISTINCT FROM OLD.target_minutes
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.calendar_snapshot IS DISTINCT FROM OLD.calendar_snapshot THEN
    RAISE EXCEPTION 'alvo, início e calendário do relógio são congelados na abertura'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER sla_clocks_guard BEFORE UPDATE ON aurora.sla_clocks
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_sla_clock_guard();

CREATE TRIGGER sla_policies_touch BEFORE UPDATE ON aurora.sla_policies
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER sla_policies_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.sla_policies
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER sla_targets_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.sla_targets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('kind', 'policy_id');

-- -----------------------------------------------------------------------------
-- Cascata de resolução da política (§11).
--
-- Ordem: política do ativo, depois do cliente, depois da organização. O degrau
-- do contrato entra no EPIC-017, entre o ativo e o cliente — o `COALESCE`
-- abaixo já está escrito para receber a coluna sem mudar a ordem.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.resolve_sla_policy(p_asset_id uuid, p_customer_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT COALESCE(
    (SELECT a.sla_policy_id FROM aurora.assets a WHERE a.id = p_asset_id),
    (SELECT c.default_sla_policy_id FROM aurora.customers c WHERE c.id = p_customer_id),
    (SELECT o.default_sla_policy_id FROM aurora.organizations o
      WHERE o.id = aurora.current_organization_id())
  )
$fn$;

GRANT EXECUTE ON FUNCTION aurora.resolve_sla_policy(uuid, uuid) TO aurora_app, aurora_readonly;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sla_policies', 'sla_targets', 'sla_clocks', 'sla_pauses']
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

-- Relógio encerrado não se apaga: é o registro de que o prazo foi ou não
-- cumprido, e apagá-lo é apagar a evidência do descumprimento.
REVOKE DELETE ON aurora.sla_clocks FROM aurora_app;
