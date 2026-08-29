-- =============================================================================
-- Aurora — 0021 ordens de serviço (SPEC v0.2 §09, §10) · EPIC-008
--
-- A OS é o agregado raiz do domínio: tudo que a organização vende, mede, fatura
-- e comprova passa por ela.
--
-- DUAS DECISÕES ESTRUTURAIS
--
-- 1. SNAPSHOT DO ATIVO E DO LOCAL
--    A OS guarda, no momento da abertura, o nome do ativo, a série e o caminho
--    do local. Não é desnormalização por desempenho: é porque transferir um
--    ativo de setor NÃO pode reescrever o passado. A referência avisava que "OS
--    existentes não poderão ser editadas caso altere o proprietário" — sintoma
--    de que lá a mudança de dono corrompia o histórico. Aqui a OS diz onde o
--    equipamento estava quando o serviço aconteceu, para sempre.
--
-- 2. SITUAÇÃO QUE EXIGE MOTIVO SEM MOTIVO É IMPOSSÍVEL
--    Não por validação de formulário: por restrição de tabela. A exigência vem
--    da SITUAÇÃO (`requires_wait_reason`, 0020) e não da categoria, porque
--    "Pausada" e "Aguardando" compartilham a categoria `waiting` e só a segunda
--    tem dependência externa a nomear. É o critério de aceite do EPIC-008 e o
--    coração do ADR-004.
-- =============================================================================

CREATE TYPE aurora.work_order_source AS ENUM ('request', 'plan', 'manual', 'inspection', 'automation');

CREATE TABLE aurora.work_orders (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  number                    text,
  source                    aurora.work_order_source NOT NULL DEFAULT 'manual',

  -- estado
  status_id                 uuid NOT NULL,
  status_category           aurora.status_category NOT NULL,
  status_requires_reason    boolean NOT NULL DEFAULT false,
  wait_reason_id            uuid,
  wait_note                 text,
  status_changed_at         timestamptz NOT NULL DEFAULT now(),

  -- classificação
  work_order_type_id        uuid NOT NULL,
  priority                  aurora.request_priority NOT NULL DEFAULT 'none',
  criticality_id            uuid,

  -- a quem se refere
  customer_id               uuid NOT NULL,
  location_id               uuid,
  asset_id                  uuid,
  service_request_id        uuid,
  parent_work_order_id      uuid,

  -- snapshots: o mundo como estava quando o serviço aconteceu
  asset_name_snapshot       text,
  asset_serial_snapshot     text,
  location_path_snapshot    text,
  location_name_snapshot    text,

  -- conteúdo
  title                     text NOT NULL,
  description               text NOT NULL DEFAULT '',
  resolution                text,
  reported_failure_code_id  uuid,
  cause_failure_code_id     uuid,
  action_code_id            uuid,

  -- execução
  assignee_membership_id    uuid,
  team_id                   uuid,
  scheduled_start           timestamptz,
  scheduled_end             timestamptz,
  started_at                timestamptz,
  completed_at              timestamptz,
  validated_at              timestamptz,
  closed_at                 timestamptz,

  -- encerramentos com justificativa
  cancellation_reason       text,
  rework_reason             text,
  reopen_reason             text,

  custom                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  version                   integer NOT NULL DEFAULT 1,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_by                uuid,

  CONSTRAINT wo_title_present CHECK (length(btrim(title)) >= 3),
  CONSTRAINT wo_not_own_parent CHECK (parent_work_order_id IS DISTINCT FROM id),
  CONSTRAINT wo_schedule_order CHECK (
    scheduled_start IS NULL OR scheduled_end IS NULL OR scheduled_end > scheduled_start
  ),

  -- O critério de aceite do EPIC-008, como restrição. Avaliado contra a
  -- exigência declarada na situação, e não contra a chave — assim vale também
  -- para uma situação que a organização criou depois.
  CONSTRAINT wo_waiting_needs_reason CHECK (
    NOT status_requires_reason OR wait_reason_id IS NOT NULL
  ),
  -- E o simétrico: motivo de espera fora de `waiting` é ruído que sobraria de
  -- um desbloqueio mal feito e apareceria em relatório como tempo perdido.
  CONSTRAINT wo_reason_only_when_waiting CHECK (
    status_category = 'waiting' OR wait_reason_id IS NULL
  ),
  CONSTRAINT wo_cancelled_needs_reason CHECK (
    status_category <> 'cancelled' OR length(btrim(coalesce(cancellation_reason, ''))) >= 5
  ),
  -- Rascunho não tem número: o número é gerado ao publicar, e uma série sem
  -- buraco não pode ser gasta com rascunho que ninguém enviou.
  CONSTRAINT wo_number_when_published CHECK (
    (status_category = 'draft' AND number IS NULL) OR (status_category <> 'draft' AND number IS NOT NULL)
  ),

  CONSTRAINT wo_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT wo_status_org_fk
    FOREIGN KEY (status_id, organization_id)
    REFERENCES aurora.work_order_statuses (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_wait_reason_org_fk
    FOREIGN KEY (wait_reason_id, organization_id)
    REFERENCES aurora.wait_reasons (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_type_org_fk
    FOREIGN KEY (work_order_type_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_location_org_fk
    FOREIGN KEY (location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_request_org_fk
    FOREIGN KEY (service_request_id, organization_id)
    REFERENCES aurora.service_requests (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_parent_org_fk
    FOREIGN KEY (parent_work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_criticality_org_fk
    FOREIGN KEY (criticality_id, organization_id)
    REFERENCES aurora.criticality_levels (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT wo_assignee_org_fk
    FOREIGN KEY (assignee_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT wo_team_org_fk
    FOREIGN KEY (team_id, organization_id)
    REFERENCES aurora.teams (id, organization_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX wo_number_uq ON aurora.work_orders (organization_id, number) WHERE number IS NOT NULL;
-- A consulta que a SPEC exige responder em menos de 400 ms com 100 mil OS:
-- filtrada por cliente e situação (§39, critério de aceite do EPIC-008).
CREATE INDEX wo_customer_status_idx ON aurora.work_orders (organization_id, customer_id, status_id, created_at DESC);
CREATE INDEX wo_category_idx        ON aurora.work_orders (organization_id, status_category, created_at DESC);
CREATE INDEX wo_assignee_idx        ON aurora.work_orders (assignee_membership_id, status_category)
  WHERE assignee_membership_id IS NOT NULL;
CREATE INDEX wo_asset_idx           ON aurora.work_orders (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX wo_request_idx         ON aurora.work_orders (service_request_id) WHERE service_request_id IS NOT NULL;
CREATE INDEX wo_location_path_idx   ON aurora.work_orders (location_path_snapshot text_pattern_ops);
CREATE INDEX wo_schedule_idx        ON aurora.work_orders (organization_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL;
CREATE INDEX wo_custom_gin          ON aurora.work_orders USING gin (custom);
-- Motivo de espera é dimensão de análise (ADR-004): "quanto tempo perdemos
-- esperando peça" precisa de um índice, não de uma varredura.
CREATE INDEX wo_wait_reason_idx     ON aurora.work_orders (organization_id, wait_reason_id)
  WHERE wait_reason_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Histórico de situação, com duração e motivo.
--
-- É o que responde "quanto tempo ficou parada aguardando peça?" — a pergunta
-- que a referência não conseguia responder porque o motivo estava dentro do
-- nome do estado.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.work_order_status_history (
  id                uuid PRIMARY KEY,
  -- Ordem de inserção, e não `changed_at`.
  --
  -- Dentro de uma transação, `now()` devolve sempre o mesmo instante: quatro
  -- transições feitas no mesmo COMMIT teriam `changed_at` idêntico, e a ordem
  -- de leitura cairia no desempate por uuid — que é aleatório. A linha do tempo
  -- apareceria embaralhada. Uma identidade monotônica resolve isso sem depender
  -- de relógio nenhum.
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  from_status_id    uuid,
  to_status_id      uuid NOT NULL,
  from_category     aurora.status_category,
  to_category       aurora.status_category NOT NULL,
  wait_reason_id    uuid,
  changed_by        uuid,
  -- `clock_timestamp()` e não `now()`: aqui interessa quando o fato aconteceu,
  -- não quando a transação começou.
  changed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  seconds_in_from   bigint,
  note              text,
  CONSTRAINT wosh_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX wosh_wo_idx  ON aurora.work_order_status_history (work_order_id, sequence);
CREATE INDEX wosh_org_idx ON aurora.work_order_status_history (organization_id);
-- Consulta de análise: tempo por motivo de espera, sem varrer o histórico todo.
CREATE INDEX wosh_wait_idx ON aurora.work_order_status_history (organization_id, wait_reason_id)
  WHERE wait_reason_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Comentários com visibilidade.
--
-- `internal` nunca chega ao portal do cliente. A separação é de coluna, não de
-- convenção de escrita: na referência, nota interna e nota do cliente moravam
-- no mesmo campo, e a única proteção era lembrar de não escrever a coisa errada.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.work_order_comments (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  body              text NOT NULL,
  visibility        text NOT NULL DEFAULT 'internal',
  author_membership_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  CONSTRAINT woc_body_present CHECK (length(btrim(body)) > 0),
  CONSTRAINT woc_visibility_known CHECK (visibility IN ('internal', 'customer')),
  CONSTRAINT woc_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX woc_wo_idx  ON aurora.work_order_comments (work_order_id, created_at);
CREATE INDEX woc_org_idx ON aurora.work_order_comments (organization_id);
