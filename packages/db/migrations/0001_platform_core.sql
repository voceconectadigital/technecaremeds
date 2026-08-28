-- =============================================================================
-- Aurora — 0001 platform core: organizations, users, memberships, scopes
-- SPEC v0.2 §05 (multitenant), §32 (modelo de dados), EPIC-001
--
-- Convenções (§32): PK uuid v7 gerada pela aplicação (ADR-024 — sem DEFAULT,
-- para que uma inserção sem id falhe alto em vez de gerar um v4 silencioso);
-- timestamptz; created_at/updated_at/created_by/updated_by; deleted_at onde
-- houver soft delete.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations — o tenant (§05, ADR-001)
-- Tabela de raiz: NÃO possui organization_id, é a própria organização.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.organizations (
  id                uuid PRIMARY KEY,
  slug              text NOT NULL,
  name              text NOT NULL,
  tax_id            text,
  logo_key          text,
  locale            text NOT NULL DEFAULT 'pt-BR',
  timezone          text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- rótulo configurável do conceito `asset` (ADR-006): "Equipamento", "Ativo", …
  asset_label       text NOT NULL DEFAULT 'Equipamento',
  plan              text NOT NULL DEFAULT 'free',
  seat_limit        integer NOT NULL DEFAULT 5,
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            aurora.organization_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT organizations_seat_limit_positive CHECK (seat_limit >= 0)
);
CREATE UNIQUE INDEX organizations_slug_uq ON aurora.organizations (slug) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- users — identidade global, única por e-mail na plataforma (§05)
-- Tabela de plataforma: NÃO é tenant-scoped. O vínculo é o membership.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.users (
  id                uuid PRIMARY KEY,
  email             text NOT NULL,
  name              text NOT NULL,
  avatar_key        text,
  locale            text NOT NULL DEFAULT 'pt-BR',
  timezone          text NOT NULL DEFAULT 'America/Sao_Paulo',
  phone             text,
  status            aurora.user_status NOT NULL DEFAULT 'active',
  -- identificador no provedor de identidade (ADR: AuthProvider como porta).
  -- O domínio nunca conhece o SDK do fornecedor; guarda apenas a referência.
  auth_provider     text,
  auth_subject      text,
  mfa_enabled       boolean NOT NULL DEFAULT false,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT users_email_format CHECK (position('@' in email) > 1)
);
-- e-mail único de forma case-insensitive, ignorando registros excluídos
CREATE UNIQUE INDEX users_email_uq ON aurora.users (lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_auth_subject_uq ON aurora.users (auth_provider, auth_subject)
  WHERE auth_subject IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- memberships — vínculo usuário × organização (§05, ADR-015)
-- Só `staff` consome assento pago; `portal` é ilimitado.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.memberships (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES aurora.users(id) ON DELETE CASCADE,
  seat_type         aurora.seat_type NOT NULL DEFAULT 'staff',
  status            aurora.membership_status NOT NULL DEFAULT 'invited',
  job_title         text,
  -- custo/hora e jornada existem apenas para staff (base de custo e produtividade)
  hourly_cost       numeric(14,2),
  daily_hours       numeric(5,2),
  council           text,
  registration_no   text,
  signature_key     text,
  on_vacation       boolean NOT NULL DEFAULT false,
  is_owner          boolean NOT NULL DEFAULT false,
  invited_at        timestamptz,
  joined_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  CONSTRAINT memberships_hourly_cost_staff_only
    CHECK (hourly_cost IS NULL OR seat_type = 'staff'),
  CONSTRAINT memberships_daily_hours_staff_only
    CHECK (daily_hours IS NULL OR seat_type = 'staff'),
  CONSTRAINT memberships_hourly_cost_non_negative
    CHECK (hourly_cost IS NULL OR hourly_cost >= 0),
  CONSTRAINT memberships_daily_hours_range
    CHECK (daily_hours IS NULL OR (daily_hours > 0 AND daily_hours <= 24)),
  CONSTRAINT memberships_owner_is_staff
    CHECK (NOT is_owner OR seat_type = 'staff')
);
CREATE UNIQUE INDEX memberships_org_user_uq
  ON aurora.memberships (organization_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX memberships_org_idx  ON aurora.memberships (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX memberships_user_idx ON aurora.memberships (user_id) WHERE deleted_at IS NULL;
-- no máximo um Owner ativo por organização (§21: "um por organização, não removível")
CREATE UNIQUE INDEX memberships_single_owner_uq
  ON aurora.memberships (organization_id)
  WHERE is_owner AND deleted_at IS NULL AND status = 'active';

-- -----------------------------------------------------------------------------
-- membership_scopes — escopo de dados em três eixos (§05)
-- Os IDs de customer/location referenciam tabelas de EPIC-003; por isso ficam
-- como uuid[] sem FK nesta fase, e ganham integridade quando as tabelas existirem.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.membership_scopes (
  membership_id     uuid PRIMARY KEY REFERENCES aurora.memberships(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  customer_scope    aurora.scope_mode NOT NULL DEFAULT 'all',
  customer_ids      uuid[] NOT NULL DEFAULT '{}',
  location_scope    aurora.scope_mode NOT NULL DEFAULT 'all',
  location_ids      uuid[] NOT NULL DEFAULT '{}',
  assignment_scope  aurora.assignment_scope NOT NULL DEFAULT 'all',
  warehouse_ids     uuid[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  -- escopo 'listed' sem nenhum id seria acesso a nada por engano: proibido
  CONSTRAINT membership_scopes_customer_listed_non_empty
    CHECK (customer_scope <> 'listed' OR cardinality(customer_ids) > 0),
  CONSTRAINT membership_scopes_location_listed_non_empty
    CHECK (location_scope <> 'listed' OR cardinality(location_ids) > 0)
);
CREATE INDEX membership_scopes_org_idx ON aurora.membership_scopes (organization_id);

-- -----------------------------------------------------------------------------
-- triggers de updated_at
-- -----------------------------------------------------------------------------
CREATE TRIGGER organizations_touch     BEFORE UPDATE ON aurora.organizations     FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER users_touch             BEFORE UPDATE ON aurora.users             FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER memberships_touch       BEFORE UPDATE ON aurora.memberships       FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER membership_scopes_touch BEFORE UPDATE ON aurora.membership_scopes FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

ALTER TABLE aurora.organizations     OWNER TO aurora_owner;
ALTER TABLE aurora.users             OWNER TO aurora_owner;
ALTER TABLE aurora.memberships       OWNER TO aurora_owner;
ALTER TABLE aurora.membership_scopes OWNER TO aurora_owner;
