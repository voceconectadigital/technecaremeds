-- =============================================================================
-- Aurora — 0034 motor único de documentos (SPEC v0.2 §18) · EPIC-018
--
-- A referência tem SEIS módulos documentais separados — calibração, rascunho de
-- calibração, certificado de padrão, TSE, laudo de obsolescência, qualificação
-- térmica — com estrutura 90 % comum. Um motor com tipos elimina cinco
-- implementações e torna o sétimo tipo uma linha de configuração.
--
-- TRÊS DECISÕES ESTRUTURAIS
--
-- 1. NÚMERO EMITIDO NUNCA É REAPROVEITADO
--    Documento cancelado mantém o número QUEIMADO, com o motivo. É requisito de
--    auditoria: uma série com buraco explicado é auditável; uma série sem
--    buracos porque os números voltaram a circular não é — e ninguém consegue
--    provar depois qual documento tinha aquele número.
--
-- 2. DOCUMENTO ASSINADO NÃO SE EDITA
--    O `content_hash` é calculado sobre o payload canônico antes de assinar.
--    Alterar depois invalidaria a assinatura, então a alteração é RECUSADA pelo
--    banco e o caminho é uma versão nova. Permitir edição transformaria a
--    assinatura numa afirmação sobre nada.
--
-- 3. O PAYLOAD ESPECIALIZADO É `jsonb`, MAS VALIDADO
--    Cada tipo declara os campos que exige, na mesma gramática dos campos
--    personalizados do EPIC-004. Não é o `jsonb` livre que o ADR-009 recusa: é
--    `jsonb` com esquema declarado fora dele.
-- =============================================================================

CREATE TYPE aurora.document_status AS ENUM (
  'draft', 'under_review', 'issued', 'released', 'expired', 'cancelled', 'superseded'
);
CREATE TYPE aurora.document_verdict AS ENUM (
  'conforming', 'non_conforming', 'conforming_with_restriction', 'na'
);
CREATE TYPE aurora.document_signature_method AS ENUM (
  'drawn', 'email_code', 'portal', 'icp_brasil'
);

-- -----------------------------------------------------------------------------
-- Tipos de documento — configuração, não código.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.document_types (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  key                 text NOT NULL,
  label               text NOT NULL,
  series              text NOT NULL,
  default_validity_days integer,
  requires_technical_manager boolean NOT NULL DEFAULT false,
  requires_signature  boolean NOT NULL DEFAULT false,
  /** Campos exigidos no payload, na gramática do EPIC-004. */
  payload_fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_key        text,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,

  CONSTRAINT document_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT document_types_series_present CHECK (length(btrim(series)) > 0),
  CONSTRAINT document_types_validity_positive CHECK (
    default_validity_days IS NULL OR default_validity_days > 0
  ),
  CONSTRAINT document_types_payload_is_array CHECK (jsonb_typeof(payload_fields) = 'array'),
  CONSTRAINT document_types_key_uq UNIQUE (organization_id, key),
  CONSTRAINT document_types_id_org_uq UNIQUE (id, organization_id)
);

-- -----------------------------------------------------------------------------
-- Séries de numeração (§18).
--
-- Separada de `number_sequences` (EPIC-007) de propósito: aquela é um contador
-- simples por série e ano, e serve para OS e solicitação. Esta tem PADRÃO —
-- prefixo, sufixo, casas, reinício anual — porque número de documento vai
-- impresso em laudo e o formato é acordado com o cliente, às vezes por escrito.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.number_series (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  document_type_id  uuid NOT NULL,
  /** Série por cliente, quando o contrato exige numeração própria. */
  customer_id       uuid,
  prefix            text NOT NULL,
  suffix            text,
  digits            integer NOT NULL DEFAULT 6,
  include_year      boolean NOT NULL DEFAULT true,
  reset_yearly      boolean NOT NULL DEFAULT true,
  current_year      integer,
  next_value        bigint NOT NULL DEFAULT 1,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT number_series_digits_range CHECK (digits BETWEEN 1 AND 12),
  CONSTRAINT number_series_next_positive CHECK (next_value >= 1),
  CONSTRAINT number_series_prefix_present CHECK (length(btrim(prefix)) > 0),
  CONSTRAINT number_series_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT number_series_type_org_fk
    FOREIGN KEY (document_type_id, organization_id)
    REFERENCES aurora.document_types (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT number_series_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE CASCADE
);
-- Uma série ativa por tipo e escopo. O índice é parcial porque série desativada
-- fica para histórico e não disputa o lugar da nova.
CREATE UNIQUE INDEX number_series_scope_uq
  ON aurora.number_series (organization_id, document_type_id, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;

-- -----------------------------------------------------------------------------
-- Documento.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.documents (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  document_type_id    uuid NOT NULL,
  /** Nulo enquanto rascunho: o número só é queimado na emissão. */
  number              text,
  version             integer NOT NULL DEFAULT 1,
  supersedes_id       uuid,
  status              aurora.document_status NOT NULL DEFAULT 'draft',

  asset_id            uuid,
  work_order_id       uuid,
  customer_id         uuid,

  title               text,
  verdict             aurora.document_verdict,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** SHA-256 do payload canônico no momento da emissão. */
  content_hash        text,

  issued_at           timestamptz,
  issued_by           uuid,
  valid_until         timestamptz,
  technical_manager_id uuid,
  released_to_customer_at timestamptz,
  released_by         uuid,
  pdf_key             text,

  cancelled_at        timestamptz,
  cancellation_reason text,
  /** Último marco de vencimento avisado — impede o aviso diário. */
  expiry_notified_threshold integer,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,

  CONSTRAINT documents_version_positive CHECK (version >= 1),
  CONSTRAINT documents_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT documents_hash_format CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  -- Emitido tem número, carimbo e hash. Os três juntos ou nenhum: um documento
  -- emitido sem hash não teria como provar o que foi assinado depois.
  CONSTRAINT documents_issued_complete CHECK (
    status IN ('draft', 'under_review')
    OR (number IS NOT NULL AND issued_at IS NOT NULL AND content_hash IS NOT NULL)
  ),
  CONSTRAINT documents_cancellation_has_reason CHECK (
    status <> 'cancelled' OR (cancelled_at IS NOT NULL AND length(btrim(cancellation_reason)) >= 10)
  ),
  CONSTRAINT documents_released_after_issue CHECK (
    released_to_customer_at IS NULL OR issued_at IS NOT NULL
  ),
  CONSTRAINT documents_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT documents_type_org_fk
    FOREIGN KEY (document_type_id, organization_id)
    REFERENCES aurora.document_types (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT documents_asset_org_fk
    FOREIGN KEY (asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT documents_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT documents_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT documents_manager_org_fk
    FOREIGN KEY (technical_manager_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT documents_supersedes_org_fk
    FOREIGN KEY (supersedes_id, organization_id)
    REFERENCES aurora.documents (id, organization_id) ON DELETE SET NULL
);
-- O número é único NA ORGANIZAÇÃO e para sempre, inclusive o do cancelado: é
-- isso que significa "queimado".
CREATE UNIQUE INDEX documents_number_uq ON aurora.documents (organization_id, number)
  WHERE number IS NOT NULL;
CREATE INDEX documents_asset_idx ON aurora.documents (organization_id, asset_id, status)
  WHERE asset_id IS NOT NULL;
CREATE INDEX documents_wo_idx ON aurora.documents (organization_id, work_order_id)
  WHERE work_order_id IS NOT NULL;
CREATE INDEX documents_expiry_idx ON aurora.documents (organization_id, valid_until)
  WHERE status IN ('issued', 'released') AND valid_until IS NOT NULL;

CREATE TABLE aurora.document_signatures (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL,
  signer_name       text NOT NULL,
  signer_role       text NOT NULL,
  signer_document   text,
  signer_email      text,
  method            aurora.document_signature_method NOT NULL,
  /** O que foi assinado. Sem isto, "assinou" é afirmação sem objeto. */
  signed_content_hash text NOT NULL,
  attachment_id     uuid,
  portal_user_id    uuid,
  certificate_subject text,
  signed_at         timestamptz NOT NULL DEFAULT now(),
  client_ip         text,
  user_agent        text,

  CONSTRAINT doc_sig_name_present CHECK (length(btrim(signer_name)) >= 2),
  CONSTRAINT doc_sig_hash_format CHECK (signed_content_hash ~ '^[0-9a-f]{64}$'),
  -- Cada método tem a sua prova de origem. Assinatura sem prova é um nome
  -- digitado, e um nome digitado não sustenta laudo nenhum.
  CONSTRAINT doc_sig_evidence_present CHECK (
    (method = 'drawn' AND attachment_id IS NOT NULL)
    OR (method = 'email_code' AND signer_email IS NOT NULL)
    OR (method = 'portal' AND portal_user_id IS NOT NULL)
    OR (method = 'icp_brasil' AND certificate_subject IS NOT NULL)
  ),
  CONSTRAINT doc_sig_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT doc_sig_document_org_fk
    FOREIGN KEY (document_id, organization_id)
    REFERENCES aurora.documents (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT doc_sig_attachment_org_fk
    FOREIGN KEY (attachment_id, organization_id)
    REFERENCES aurora.attachments (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX doc_sig_document_idx ON aurora.document_signatures (document_id, signed_at);
CREATE INDEX doc_sig_org_idx ON aurora.document_signatures (organization_id);

CREATE TABLE aurora.document_status_history (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  document_id       uuid NOT NULL,
  from_status       aurora.document_status,
  to_status         aurora.document_status NOT NULL,
  note              text,
  changed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by        uuid,
  CONSTRAINT doc_history_document_org_fk
    FOREIGN KEY (document_id, organization_id)
    REFERENCES aurora.documents (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX doc_history_idx ON aurora.document_status_history (document_id, sequence);

-- -----------------------------------------------------------------------------
-- Alocação de número, com trava de aconselhamento.
--
-- A trava serializa a alocação da MESMA série sem bloquear as outras: duas
-- emissões simultâneas de tipos diferentes não se esperam. Sem ela, duas
-- transações leriam `next_value` antes de qualquer uma escrever e o mesmo
-- número sairia em dois laudos — que é o defeito que a exigência de "número
-- nunca reaproveitado" existe para impedir.
--
-- O reinício anual acontece aqui, dentro da mesma trava: fazê-lo fora abriria a
-- janela em que duas transações virariam o ano ao mesmo tempo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.allocate_document_number(p_series_id uuid, p_year integer)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_next  bigint;
  v_reset boolean;
  v_year  integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aurora.number_series:' || p_series_id::text));

  SELECT reset_yearly, current_year INTO v_reset, v_year
    FROM aurora.number_series WHERE id = p_series_id AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'série de numeração inexistente ou desativada' USING ERRCODE = '23503';
  END IF;

  IF v_reset AND v_year IS DISTINCT FROM p_year THEN
    UPDATE aurora.number_series
       SET current_year = p_year, next_value = 2, updated_at = now()
     WHERE id = p_series_id
     RETURNING 1 INTO v_next;
    RETURN 1;
  END IF;

  UPDATE aurora.number_series
     SET next_value = next_value + 1,
         current_year = COALESCE(current_year, p_year),
         updated_at = now()
   WHERE id = p_series_id
   RETURNING next_value - 1 INTO v_next;

  RETURN v_next;
END
$fn$;

GRANT EXECUTE ON FUNCTION aurora.allocate_document_number(uuid, integer) TO aurora_app;

-- -----------------------------------------------------------------------------
-- Guardas.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_document_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_assinaturas integer;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO aurora.document_status_history
      (id, organization_id, document_id, from_status, to_status, changed_by)
    VALUES (gen_random_uuid(), NEW.organization_id, NEW.id, OLD.status, NEW.status,
            aurora.current_actor_id());
  END IF;

  -- Conteúdo de documento ASSINADO é imutável. A assinatura promete um hash
  -- específico; mudar o payload depois faria o sistema guardar uma assinatura
  -- que não corresponde a nada — e ninguém saberia disso olhando a tela.
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.verdict IS DISTINCT FROM OLD.verdict THEN
    SELECT count(*) INTO v_assinaturas
      FROM aurora.document_signatures WHERE document_id = OLD.id;

    IF v_assinaturas > 0 THEN
      RAISE EXCEPTION
        'documento % já assinado: o conteúdo não se altera, emita uma versão nova',
        COALESCE(OLD.number, OLD.id::text)
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- O número, uma vez queimado, é daquele documento para sempre.
  IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'número de documento emitido não se altera: % ', OLD.number
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER documents_guard BEFORE UPDATE ON aurora.documents
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_document_guard();

/**
 * A assinatura registra o hash do conteúdo daquele instante.
 *
 * Preenchido pelo banco a partir do documento, e não recebido de quem assina:
 * aceitar o hash do chamador permitiria assinar um conteúdo e gravar o resumo
 * de outro — que é precisamente a fraude que o hash existe para impedir.
 */
CREATE FUNCTION aurora.fn_document_signature_hash() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_hash text; v_status aurora.document_status;
BEGIN
  SELECT content_hash, status INTO v_hash, v_status
    FROM aurora.documents WHERE id = NEW.document_id;

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'documento sem conteúdo consolidado não pode ser assinado'
      USING ERRCODE = '23514';
  END IF;

  IF v_status IN ('cancelled', 'superseded') THEN
    RAISE EXCEPTION 'documento % não aceita assinatura', v_status
      USING ERRCODE = '23514';
  END IF;

  NEW.signed_content_hash := v_hash;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER document_signatures_hash BEFORE INSERT ON aurora.document_signatures
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_document_signature_hash();

CREATE FUNCTION aurora.fn_document_signature_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'assinatura não se altera nem se apaga' USING ERRCODE = '23514';
END
$fn$;

CREATE TRIGGER document_signatures_immutable
  BEFORE UPDATE OR DELETE ON aurora.document_signatures
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_document_signature_immutable();

CREATE TRIGGER documents_touch BEFORE UPDATE ON aurora.documents
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER document_types_touch BEFORE UPDATE ON aurora.document_types
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER documents_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.documents
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('number');
CREATE TRIGGER document_types_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.document_types
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('key');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_types', 'number_series', 'documents',
    'document_signatures', 'document_status_history'
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
