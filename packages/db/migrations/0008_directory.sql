-- =============================================================================
-- Aurora — 0008 diretório: clientes, locais, fornecedores, equipes, calendários
-- SPEC v0.2 §32, EPIC-003 (BL-013 a BL-018)
--
-- DUAS DECISÕES ESTRUTURAIS DESTA MIGRATION
--
-- 1. Chave estrangeira composta desde o início. A 0007 aprendeu, corrigindo,
--    que verificação de FK roda como dono da tabela e ignora RLS. Aqui toda
--    referência entre tabelas de tenant já nasce com `organization_id` dentro
--    da chave, para que apontar para outro tenant seja irrepresentável e não
--    apenas proibido.
--
-- 2. A árvore de locais se mantém sozinha. `path` e `depth` são derivados por
--    gatilho a partir de `parent_id` — a aplicação nunca os escreve. Mover uma
--    subárvore é UPDATE de uma coluna só (`parent_id`); a cascata, o limite de
--    profundidade, a regra de aninhamento e a ausência de ciclo ficam por conta
--    do banco. Um caminho de escrita novo não tem como furar a invariante.
--    Caminho materializado em `text`, sem `ltree` (ADR-026).
-- =============================================================================

CREATE TYPE aurora.directory_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE aurora.calendar_exception_kind AS ENUM ('holiday', 'closed', 'extended');
CREATE TYPE aurora.availability_block_kind AS ENUM ('vacation', 'leave', 'training', 'other');

-- -----------------------------------------------------------------------------
-- customers — "quem é atendido". No modo single-customer a organização tem um
-- único cliente `is_internal` e a interface esconde o seletor: o modelo não
-- muda, só a apresentação (§05).
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.customers (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  trade_name        text,
  code              text,
  tax_id            text,
  is_internal       boolean NOT NULL DEFAULT false,
  segment           text,
  status            aurora.directory_status NOT NULL DEFAULT 'active',
  billing_email     text,
  billing_address   jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_key          text,
  custom            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT customers_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT customers_id_org_uq    UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX customers_org_name_uq ON aurora.customers (organization_id, lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX customers_org_code_uq ON aurora.customers (organization_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
-- no máximo um cliente interno por organização
CREATE UNIQUE INDEX customers_one_internal_uq ON aurora.customers (organization_id) WHERE is_internal AND deleted_at IS NULL;
CREATE INDEX customers_org_idx ON aurora.customers (organization_id) WHERE deleted_at IS NULL;

CREATE TABLE aurora.customer_contacts (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  name              text NOT NULL,
  role_title        text,
  email             text,
  phone             text,
  is_primary        boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT customer_contacts_reach CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT customer_contacts_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX customer_contacts_primary_uq ON aurora.customer_contacts (customer_id) WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX customer_contacts_customer_idx ON aurora.customer_contacts (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX customer_contacts_org_idx ON aurora.customer_contacts (organization_id);

-- -----------------------------------------------------------------------------
-- location_types — os níveis da árvore são configuráveis (ADR-005). A regra de
-- aninhamento é dado, não código: é o que permite servir hospital hoje e outro
-- mercado depois sem alterar o esquema.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.location_types (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key                      text NOT NULL,
  name                     text NOT NULL,
  icon                     text,
  allowed_parent_type_ids  uuid[] NOT NULL DEFAULT '{}',
  can_be_root              boolean NOT NULL DEFAULT false,
  allows_assets            boolean NOT NULL DEFAULT true,
  position                 integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_by               uuid,
  deleted_at               timestamptz,
  CONSTRAINT location_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  -- um tipo que não pode ser raiz precisa dizer sob quem pode ficar; sem isso
  -- é um tipo inutilizável, que nenhuma posição da árvore aceitaria
  CONSTRAINT location_types_placeable CHECK (can_be_root OR cardinality(allowed_parent_type_ids) > 0),
  CONSTRAINT location_types_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX location_types_org_key_uq ON aurora.location_types (organization_id, key) WHERE deleted_at IS NULL;
CREATE INDEX location_types_org_idx ON aurora.location_types (organization_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- locations — `path` e `depth` são derivados; ver gatilhos adiante.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.locations (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  parent_id         uuid,
  location_type_id  uuid NOT NULL,
  name              text NOT NULL,
  code              text,
  path              text NOT NULL DEFAULT '',
  depth             integer NOT NULL DEFAULT 1,
  address           jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo_lat           numeric(9,6),
  geo_lng           numeric(9,6),
  timezone          text,
  calendar_id       uuid,
  manager_membership_id uuid,
  is_mobile         boolean NOT NULL DEFAULT false,
  status            aurora.directory_status NOT NULL DEFAULT 'active',
  custom            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT locations_name_present   CHECK (length(btrim(name)) > 0),
  CONSTRAINT locations_depth_range    CHECK (depth BETWEEN 1 AND 8),
  CONSTRAINT locations_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  -- o caminho termina no próprio id: barreira final contra caminho gravado à
  -- mão que não corresponda à linha
  CONSTRAINT locations_path_ends_with_self CHECK (path = '' OR path LIKE '%/' || id::text || '/'),
  CONSTRAINT locations_geo_pair CHECK ((geo_lat IS NULL) = (geo_lng IS NULL)),
  CONSTRAINT locations_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT locations_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT locations_parent_org_fk
    FOREIGN KEY (parent_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT locations_type_org_fk
    FOREIGN KEY (location_type_id, organization_id)
    REFERENCES aurora.location_types (id, organization_id) ON DELETE RESTRICT
);
-- consulta de subárvore por prefixo: este índice é a razão do ADR-026
CREATE INDEX locations_path_idx     ON aurora.locations (path text_pattern_ops);
CREATE INDEX locations_org_idx      ON aurora.locations (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX locations_parent_idx   ON aurora.locations (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX locations_customer_idx ON aurora.locations (customer_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX locations_customer_code_uq ON aurora.locations (customer_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- suppliers
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.suppliers (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  trade_name             text,
  tax_id                 text,
  categories             text[] NOT NULL DEFAULT '{}',
  is_authorized_service  boolean NOT NULL DEFAULT false,
  email                  text,
  phone                  text,
  address                jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_terms          text,
  rating                 smallint,
  status                 aurora.directory_status NOT NULL DEFAULT 'active',
  custom                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  deleted_at             timestamptz,
  CONSTRAINT suppliers_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT suppliers_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT suppliers_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX suppliers_org_name_uq ON aurora.suppliers (organization_id, lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE INDEX suppliers_org_idx ON aurora.suppliers (organization_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- calendars — cobertura de horário. Usados por SLA (§13) e agenda (§10).
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.calendars (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  timezone          text NOT NULL,
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT calendars_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX calendars_org_name_uq   ON aurora.calendars (organization_id, lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX calendars_one_default_uq ON aurora.calendars (organization_id) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE aurora.calendar_windows (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  calendar_id       uuid NOT NULL,
  weekday           smallint NOT NULL,
  starts_at         time NOT NULL,
  ends_at           time NOT NULL,
  CONSTRAINT calendar_windows_weekday_range CHECK (weekday BETWEEN 0 AND 6),
  -- janela que termina antes de começar não representa nada; a virada de
  -- meia-noite se declara com duas janelas, uma em cada dia
  CONSTRAINT calendar_windows_order CHECK (ends_at > starts_at),
  CONSTRAINT calendar_windows_calendar_org_fk
    FOREIGN KEY (calendar_id, organization_id)
    REFERENCES aurora.calendars (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX calendar_windows_calendar_idx ON aurora.calendar_windows (calendar_id, weekday);

CREATE TABLE aurora.calendar_exceptions (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  calendar_id       uuid NOT NULL,
  on_date           date NOT NULL,
  kind              aurora.calendar_exception_kind NOT NULL,
  starts_at         time,
  ends_at           time,
  note              text,
  CONSTRAINT calendar_exceptions_extended_needs_window
    CHECK (kind <> 'extended' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)),
  CONSTRAINT calendar_exceptions_calendar_org_fk
    FOREIGN KEY (calendar_id, organization_id)
    REFERENCES aurora.calendars (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX calendar_exceptions_uq ON aurora.calendar_exceptions (calendar_id, on_date, kind);

ALTER TABLE aurora.locations
  ADD CONSTRAINT locations_calendar_org_fk
  FOREIGN KEY (calendar_id, organization_id)
  REFERENCES aurora.calendars (id, organization_id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- teams
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.teams (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  code                   text,
  calendar_id            uuid,
  lead_membership_id     uuid,
  coverage               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 aurora.directory_status NOT NULL DEFAULT 'active',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  deleted_at             timestamptz,
  CONSTRAINT teams_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT teams_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT teams_calendar_org_fk
    FOREIGN KEY (calendar_id, organization_id)
    REFERENCES aurora.calendars (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT teams_lead_org_fk
    FOREIGN KEY (lead_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX teams_org_name_uq ON aurora.teams (organization_id, lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE INDEX teams_org_idx ON aurora.teams (organization_id) WHERE deleted_at IS NULL;

CREATE TABLE aurora.team_members (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  team_id           uuid NOT NULL,
  membership_id     uuid NOT NULL,
  role_in_team      text NOT NULL DEFAULT 'member',
  skills            text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  PRIMARY KEY (team_id, membership_id),
  CONSTRAINT team_members_team_org_fk
    FOREIGN KEY (team_id, organization_id)
    REFERENCES aurora.teams (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT team_members_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX team_members_org_idx        ON aurora.team_members (organization_id);
CREATE INDEX team_members_membership_idx ON aurora.team_members (membership_id);

-- -----------------------------------------------------------------------------
-- availability_blocks — férias, licença, treinamento. Entra no planejamento de
-- capacidade (§10) e evita atribuir OS a quem não está disponível.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.availability_blocks (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL,
  kind              aurora.availability_block_kind NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT availability_blocks_order CHECK (ends_at > starts_at),
  CONSTRAINT availability_blocks_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX availability_blocks_membership_idx ON aurora.availability_blocks (membership_id, starts_at);
CREATE INDEX availability_blocks_org_idx        ON aurora.availability_blocks (organization_id);

ALTER TABLE aurora.locations
  ADD CONSTRAINT locations_manager_org_fk
  FOREIGN KEY (manager_membership_id, organization_id)
  REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL;
