-- =============================================================================
-- Aurora — 0018 solicitações de serviço (SPEC v0.2 §08, ADR-002) · EPIC-007
--
-- ADR-002: `service_request` é entidade própria, distinta de `work_order`.
--
-- Três invariantes que esta migration torna estruturais:
--
-- 1. NUMERAÇÃO SEM BURACO E SEM COLISÃO
--    `SR-{ano}-{sequência}`, série própria por organização e por ano. A
--    sequência sai de uma tabela de contador com bloqueio de linha, não de um
--    `max(number) + 1` — que sob concorrência gera dois números iguais, e é o
--    defeito clássico deste campo.
--
-- 2. ESTADO TERMINAL EXIGE O QUE O TERMINAL SIGNIFICA
--    `rejected` sem motivo e `duplicate` sem original são estados que mentem:
--    o registro diz "decidi" e não diz o quê. Restrição de tabela, não
--    validação de formulário.
--
-- 3. O RELATO DO CLIENTE É IMUTÁVEL
--    `summary` e `description` não mudam depois do envio. Na referência, a
--    descrição original do solicitante era sobrescrita pelo técnico, e com ela
--    sumia a única evidência do que o cliente de fato pediu.
-- =============================================================================

CREATE TYPE aurora.request_status AS ENUM (
  'draft', 'submitted', 'triage', 'info_needed', 'accepted',
  'in_service', 'fulfilled', 'closed', 'rejected', 'duplicate', 'cancelled'
);
CREATE TYPE aurora.request_source AS ENUM (
  'portal', 'qr_code', 'phone', 'email', 'walk_in', 'api', 'internal'
);
CREATE TYPE aurora.request_priority AS ENUM ('emergency', 'very_urgent', 'urgent', 'low', 'none');

-- -----------------------------------------------------------------------------
-- Contadores de série.
--
-- Genérico de propósito: a OS terá a sua própria série (`WO`), e o motor de
-- documentos do EPIC-018 terá mais algumas. Um contador por (organização,
-- série, ano).
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.number_sequences (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  series            text NOT NULL,
  year              integer NOT NULL,
  last_value        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, series, year),
  CONSTRAINT number_sequences_series_format CHECK (series ~ '^[A-Z]{2,6}$'),
  CONSTRAINT number_sequences_year_range CHECK (year BETWEEN 2000 AND 2999)
);

/*
 * Próximo número da série.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` incrementa e devolve numa única instrução:
 * a linha do contador fica bloqueada pelo tempo da instrução, e duas transações
 * concorrentes se serializam nela em vez de lerem o mesmo valor.
 *
 * O número é consumido mesmo que a transação role atrás — buraco na sequência é
 * aceitável e reutilização não é. Um número reaproveitado apontaria para dois
 * registros diferentes no histórico de alguém.
 */
CREATE FUNCTION aurora.next_number(p_organization_id uuid, p_series text, p_year integer)
RETURNS bigint
LANGUAGE sql
SET search_path = aurora, pg_catalog
AS $fn$
  INSERT INTO aurora.number_sequences (organization_id, series, year, last_value)
  VALUES (p_organization_id, p_series, p_year, 1)
  ON CONFLICT (organization_id, series, year)
  DO UPDATE SET last_value = aurora.number_sequences.last_value + 1
  RETURNING last_value
$fn$;

-- -----------------------------------------------------------------------------
-- service_requests
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.service_requests (
  id                        uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  number                    text NOT NULL,
  source                    aurora.request_source NOT NULL DEFAULT 'portal',
  status                    aurora.request_status NOT NULL DEFAULT 'draft',

  -- quem pediu: usuário do portal quando autenticado, campos livres quando
  -- registrado por telefone (a referência já expunha telefone na fila)
  requester_membership_id   uuid,
  requester_name            text,
  requester_phone           text,
  requester_email           text,

  customer_id               uuid NOT NULL,
  location_id               uuid,
  asset_id                  uuid,

  summary                   text NOT NULL,
  description               text NOT NULL DEFAULT '',
  reported_failure_code_id  uuid,
  requested_priority        aurora.request_priority NOT NULL DEFAULT 'none',
  priority                  aurora.request_priority NOT NULL DEFAULT 'none',

  rejection_reason_id       uuid,
  rejection_note            text,
  merged_into_request_id    uuid,
  cancellation_reason       text,
  info_request              text,

  triaged_by                uuid,
  triaged_at                timestamptz,
  first_response_at         timestamptz,
  submitted_at              timestamptz,
  closed_at                 timestamptz,

  rating                    smallint,
  rating_comment            text,

  custom                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  version                   integer NOT NULL DEFAULT 1,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_by                uuid,

  CONSTRAINT service_requests_summary_present CHECK (length(btrim(summary)) >= 3),
  CONSTRAINT service_requests_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT service_requests_not_own_merge CHECK (merged_into_request_id IS DISTINCT FROM id),

  -- Quem pediu tem de estar identificável de alguma forma: vínculo do portal,
  -- ou nome com um meio de contato. Solicitação sem solicitante é um chamado
  -- que ninguém consegue responder.
  CONSTRAINT service_requests_requester_identified CHECK (
    requester_membership_id IS NOT NULL
    OR (requester_name IS NOT NULL AND (requester_phone IS NOT NULL OR requester_email IS NOT NULL))
  ),

  -- Estado terminal exige o que o terminal significa.
  CONSTRAINT service_requests_rejected_needs_reason CHECK (
    status <> 'rejected' OR rejection_reason_id IS NOT NULL
  ),
  CONSTRAINT service_requests_duplicate_needs_original CHECK (
    status <> 'duplicate' OR merged_into_request_id IS NOT NULL
  ),
  CONSTRAINT service_requests_cancelled_needs_reason CHECK (
    status <> 'cancelled' OR length(btrim(coalesce(cancellation_reason, ''))) >= 3
  ),
  CONSTRAINT service_requests_info_needed_has_question CHECK (
    status <> 'info_needed' OR length(btrim(coalesce(info_request, ''))) >= 5
  ),

  CONSTRAINT service_requests_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT service_requests_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_location_org_fk
    FOREIGN KEY (location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_failure_org_fk
    FOREIGN KEY (reported_failure_code_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_rejection_org_fk
    FOREIGN KEY (rejection_reason_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_merge_org_fk
    FOREIGN KEY (merged_into_request_id, organization_id)
    REFERENCES aurora.service_requests (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT service_requests_requester_org_fk
    FOREIGN KEY (requester_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX service_requests_number_uq ON aurora.service_requests (organization_id, number);
CREATE INDEX service_requests_org_status_idx ON aurora.service_requests (organization_id, status);
CREATE INDEX service_requests_asset_idx      ON aurora.service_requests (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX service_requests_location_idx   ON aurora.service_requests (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX service_requests_customer_idx   ON aurora.service_requests (customer_id);
CREATE INDEX service_requests_custom_gin     ON aurora.service_requests USING gin (custom);
-- A fila de triagem é a consulta mais frequente do coordenador; um índice
-- parcial mantém pequeno exatamente o que ela varre.
CREATE INDEX service_requests_queue_idx
  ON aurora.service_requests (organization_id, priority, created_at)
  WHERE status IN ('submitted', 'triage', 'info_needed');

-- -----------------------------------------------------------------------------
-- Histórico de estado, com duração no estado anterior.
--
-- Existe porque "quanto tempo a solicitação ficou esperando triagem?" não tem
-- resposta a partir do estado atual — e é a pergunta que mede se a operação
-- está dando conta da demanda.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.service_request_status_history (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  request_id        uuid NOT NULL,
  from_status       aurora.request_status,
  to_status         aurora.request_status NOT NULL,
  changed_by        uuid,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  seconds_in_from   bigint,
  note              text,
  CONSTRAINT srsh_request_org_fk
    FOREIGN KEY (request_id, organization_id)
    REFERENCES aurora.service_requests (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX srsh_request_idx ON aurora.service_request_status_history (request_id, changed_at);
CREATE INDEX srsh_org_idx     ON aurora.service_request_status_history (organization_id);
