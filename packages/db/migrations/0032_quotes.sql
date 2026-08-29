-- =============================================================================
-- Aurora — 0032 orçamentos (SPEC v0.2 §16) · EPIC-016
--
-- O orçamento é o que destrava a OS parada: o motivo de espera "aguardando
-- aprovação de orçamento" existe na máquina de estados desde o EPIC-008, e até
-- aqui não havia o que aprovar.
--
-- TRÊS DECISÕES ESTRUTURAIS
--
-- 1. VERSÃO, NÃO SOBRESCRITA
--    A referência tem "Modificar", que reescreve a proposta no lugar. O
--    histórico de propostas é argumento comercial — saber que a primeira versão
--    custava 40 % mais é o que sustenta a conversa de desconto — e sobrescrever
--    apaga exatamente isso. Aqui revisar cria a versão N+1 em rascunho e a
--    anterior fica `superseded`, visível.
--
-- 2. DINHEIRO EM CENTAVOS, INTEIRO
--    Todos os valores são `bigint` em centavos. `numeric` seria correto no
--    banco e viraria ponto flutuante ao chegar em JavaScript, que é onde a
--    diferença aparece: trinta linhas somadas em `float` não batem com a
--    calculadora do cliente.
--
-- 3. OS TOTAIS SÃO MANTIDOS PELO BANCO
--    Gatilho recalcula o cabeçalho a cada escrita de item. Deixar isso para a
--    aplicação significaria que qualquer caminho novo — importação, ajuste em
--    lote, correção manual — poderia deixar o cabeçalho dizendo um número e as
--    linhas outro, e o cliente recebe os dois no mesmo PDF.
-- =============================================================================

CREATE TYPE aurora.quote_status AS ENUM (
  'draft', 'sent', 'viewed', 'approved', 'rejected', 'expired',
  'in_execution', 'invoiced', 'closed', 'cancelled', 'superseded'
);
CREATE TYPE aurora.quote_nature AS ENUM ('parts', 'services', 'parts_and_services');
CREATE TYPE aurora.quote_item_kind AS ENUM ('part', 'service');
CREATE TYPE aurora.price_source AS ENUM (
  'customer_alias', 'contract_price_list', 'catalog', 'manual'
);

-- -----------------------------------------------------------------------------
-- Tabela de preço — o degrau do meio da cascata do §16.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.price_lists (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'BRL',
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT price_lists_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT price_lists_id_org_uq UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX price_lists_name_uq
  ON aurora.price_lists (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE aurora.price_list_items (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  price_list_id     uuid NOT NULL,
  item_id           uuid NOT NULL,
  price_cents       bigint NOT NULL,
  PRIMARY KEY (price_list_id, item_id),
  CONSTRAINT price_list_items_non_negative CHECK (price_cents >= 0),
  CONSTRAINT price_list_items_list_org_fk
    FOREIGN KEY (price_list_id, organization_id)
    REFERENCES aurora.price_lists (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT price_list_items_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX price_list_items_org_idx ON aurora.price_list_items (organization_id);

-- O último degrau da cascata: o preço de catálogo do item.
ALTER TABLE aurora.inventory_items ADD COLUMN list_price_cents bigint;
ALTER TABLE aurora.inventory_items
  ADD CONSTRAINT items_list_price_non_negative
  CHECK (list_price_cents IS NULL OR list_price_cents >= 0);

-- -----------------------------------------------------------------------------
-- Buraco na convenção de chave composta, encontrado aqui.
--
-- `customer_contacts` nasceu no EPIC-003 sem `UNIQUE (id, organization_id)`, e
-- ninguém percebeu porque até agora nada apontava para ela. A convenção existe
-- por um motivo concreto (ADR-011): a verificação de chave estrangeira roda como
-- dona da tabela e IGNORA a RLS, então uma FK só por `id` aceitaria apontar para
-- a linha de outro tenant. Sem esta restrição, o aprovador do orçamento poderia
-- ser um contato de outra organização.
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.customer_contacts
  ADD CONSTRAINT customer_contacts_id_org_uq UNIQUE (id, organization_id);

-- O contrato aponta a sua tabela de preço (§17, degrau adiado no EPIC-017).
ALTER TABLE aurora.contracts ADD COLUMN price_list_id uuid;
ALTER TABLE aurora.contracts ADD CONSTRAINT contracts_price_list_org_fk
  FOREIGN KEY (price_list_id, organization_id)
  REFERENCES aurora.price_lists (id, organization_id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Orçamento.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.quotes (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  number            text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  /** Versão anterior, quando esta nasceu de uma revisão. */
  supersedes_id     uuid,

  status            aurora.quote_status NOT NULL DEFAULT 'draft',
  customer_id       uuid NOT NULL,
  approver_contact_id uuid,
  work_order_id     uuid,
  contract_id       uuid,
  nature            aurora.quote_nature NOT NULL DEFAULT 'parts_and_services',

  valid_until       date,
  currency          char(3) NOT NULL DEFAULT 'BRL',
  payment_terms     text,
  customer_notes    text,
  internal_notes    text,

  subtotal_cents          bigint NOT NULL DEFAULT 0,
  item_discount_cents     bigint NOT NULL DEFAULT 0,
  general_discount_cents  bigint NOT NULL DEFAULT 0,
  general_discount_percent numeric(5,2),
  additions_cents         bigint NOT NULL DEFAULT 0,
  taxes_cents             bigint NOT NULL DEFAULT 0,
  total_cents             bigint NOT NULL DEFAULT 0,

  sent_at           timestamptz,
  viewed_at         timestamptz,
  viewed_by_contact_id uuid,
  decided_at        timestamptz,
  /**
   * Evidência do aceite: quem, quando, de qual endereço.
   *
   * É REGISTRO DE EVIDÊNCIA, e o sistema não afirma nada sobre valor jurídico
   * ou validade legal de assinatura — isso depende de norma e de instrumento
   * que não estão no escopo do produto e que a auditoria não confirmou.
   */
  accepted_ip       text,
  accepted_user_agent text,
  acceptance_note   text,
  rejection_reason_id uuid,
  rejection_note    text,
  invoiced_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT quotes_number_present CHECK (length(btrim(number)) > 0),
  CONSTRAINT quotes_version_positive CHECK (version >= 1),
  CONSTRAINT quotes_amounts_non_negative CHECK (
    subtotal_cents >= 0 AND item_discount_cents >= 0 AND general_discount_cents >= 0
    AND additions_cents >= 0 AND taxes_cents >= 0
  ),
  CONSTRAINT quotes_discount_shape CHECK (
    general_discount_percent IS NULL OR general_discount_percent BETWEEN 0 AND 100
  ),
  -- Recusar exige motivo do catálogo: "recusado" sem porquê não alimenta
  -- análise de perda nenhuma, e análise de perda é o que faz a proposta
  -- seguinte ser melhor.
  CONSTRAINT quotes_rejection_has_reason CHECK (
    status <> 'rejected' OR rejection_reason_id IS NOT NULL
  ),
  CONSTRAINT quotes_version_uq UNIQUE (organization_id, number, version),
  CONSTRAINT quotes_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT quotes_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT quotes_contact_org_fk
    FOREIGN KEY (approver_contact_id, organization_id)
    REFERENCES aurora.customer_contacts (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT quotes_work_order_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT quotes_contract_org_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES aurora.contracts (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT quotes_rejection_org_fk
    FOREIGN KEY (rejection_reason_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT quotes_supersedes_org_fk
    FOREIGN KEY (supersedes_id, organization_id)
    REFERENCES aurora.quotes (id, organization_id) ON DELETE SET NULL
);
CREATE INDEX quotes_customer_idx ON aurora.quotes (organization_id, customer_id, status);
CREATE INDEX quotes_work_order_idx ON aurora.quotes (organization_id, work_order_id)
  WHERE work_order_id IS NOT NULL;
CREATE INDEX quotes_open_idx ON aurora.quotes (organization_id, valid_until)
  WHERE status IN ('sent', 'viewed');

-- Uma versão viva por número. As demais estão superadas ou encerradas.
CREATE UNIQUE INDEX quotes_live_version_uq ON aurora.quotes (organization_id, number)
  WHERE status NOT IN ('superseded', 'cancelled', 'rejected', 'expired', 'closed');

CREATE TABLE aurora.quote_items (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  quote_id          uuid NOT NULL,
  position          integer NOT NULL,
  kind              aurora.quote_item_kind NOT NULL,
  item_id           uuid,
  supplier_id       uuid,
  lot_id            uuid,
  description       text NOT NULL,
  unit              text NOT NULL DEFAULT 'un',
  quantity          numeric(12,3) NOT NULL,
  unit_price_cents  bigint NOT NULL,
  discount_cents    bigint NOT NULL DEFAULT 0,
  gross_cents       bigint NOT NULL,
  net_cents         bigint NOT NULL,
  price_source      aurora.price_source NOT NULL DEFAULT 'manual',
  warranty_days     integer,
  delivery_days     integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT quote_items_description_present CHECK (length(btrim(description)) > 0),
  CONSTRAINT quote_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT quote_items_price_non_negative CHECK (unit_price_cents >= 0),
  CONSTRAINT quote_items_discount_within CHECK (discount_cents >= 0 AND discount_cents <= gross_cents),
  CONSTRAINT quote_items_net_consistent CHECK (net_cents = gross_cents - discount_cents),
  -- Item de peça sem item de estoque não pode ser reservado nem baixado, e
  -- descobrir isso na hora de faturar é descobrir tarde.
  CONSTRAINT quote_items_part_has_item CHECK (kind <> 'part' OR item_id IS NOT NULL),
  CONSTRAINT quote_items_position_uq UNIQUE (quote_id, position),
  CONSTRAINT quote_items_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT quote_items_quote_org_fk
    FOREIGN KEY (quote_id, organization_id)
    REFERENCES aurora.quotes (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT quote_items_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT quote_items_supplier_org_fk
    FOREIGN KEY (supplier_id, organization_id)
    REFERENCES aurora.suppliers (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT quote_items_lot_org_fk
    FOREIGN KEY (lot_id, organization_id)
    REFERENCES aurora.stock_lots (id, organization_id) ON DELETE SET NULL
);
CREATE INDEX quote_items_quote_idx ON aurora.quote_items (organization_id, quote_id, position);

CREATE TABLE aurora.quote_status_history (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  quote_id          uuid NOT NULL,
  from_status       aurora.quote_status,
  to_status         aurora.quote_status NOT NULL,
  note              text,
  changed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by        uuid,
  CONSTRAINT quote_history_quote_org_fk
    FOREIGN KEY (quote_id, organization_id)
    REFERENCES aurora.quotes (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX quote_history_idx ON aurora.quote_status_history (quote_id, sequence);

-- -----------------------------------------------------------------------------
-- Totais mantidos pelo banco.
--
-- O gatilho roda depois de qualquer escrita de item e recalcula o cabeçalho.
-- Assim, cabeçalho e linhas não podem divergir por caminho nenhum — nem por
-- importação, nem por correção manual, nem por código futuro que ninguém
-- lembrou de atualizar.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_quote_recalc() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_quote uuid := COALESCE(NEW.quote_id, OLD.quote_id);
  v_sub   bigint;
  v_desc  bigint;
  v_geral bigint;
  q       RECORD;
BEGIN
  SELECT COALESCE(sum(net_cents), 0), COALESCE(sum(discount_cents), 0)
    INTO v_sub, v_desc
    FROM aurora.quote_items WHERE quote_id = v_quote;

  SELECT general_discount_percent, general_discount_cents, additions_cents, taxes_cents
    INTO q FROM aurora.quotes WHERE id = v_quote;

  v_geral := CASE
    WHEN q.general_discount_percent IS NOT NULL
      THEN round(v_sub * q.general_discount_percent / 100)
    ELSE LEAST(q.general_discount_cents, v_sub)
  END;

  UPDATE aurora.quotes
     SET subtotal_cents = v_sub,
         item_discount_cents = v_desc,
         general_discount_cents = v_geral,
         total_cents = v_sub - v_geral + q.additions_cents + q.taxes_cents
   WHERE id = v_quote;

  RETURN NULL;
END
$fn$;

CREATE TRIGGER quote_items_recalc
  AFTER INSERT OR UPDATE OR DELETE ON aurora.quote_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_quote_recalc();

-- -----------------------------------------------------------------------------
-- Guardas.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_quote_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO aurora.quote_status_history
      (id, organization_id, quote_id, from_status, to_status, changed_by)
    VALUES (gen_random_uuid(), NEW.organization_id, NEW.id, OLD.status, NEW.status,
            aurora.current_actor_id());

    IF NEW.status IN ('approved', 'rejected') AND NEW.decided_at IS NULL THEN
      NEW.decided_at := now();
    END IF;
  END IF;

  -- Desconto, acréscimo e imposto do cabeçalho também mexem no total, e o
  -- gatilho de itens não é acionado por eles. Sem este trecho, mudar o desconto
  -- geral deixaria `total_cents` parado no valor anterior até alguém tocar num
  -- item — e o PDF sairia com o total velho e o desconto novo lado a lado.
  IF TG_OP = 'UPDATE' AND (
       NEW.general_discount_cents,   NEW.general_discount_percent,
       NEW.additions_cents,          NEW.taxes_cents
     ) IS DISTINCT FROM (
       OLD.general_discount_cents,   OLD.general_discount_percent,
       OLD.additions_cents,          OLD.taxes_cents
     ) THEN
    NEW.general_discount_cents := CASE
      WHEN NEW.general_discount_percent IS NOT NULL
        THEN round(NEW.subtotal_cents * NEW.general_discount_percent / 100)
      ELSE LEAST(NEW.general_discount_cents, NEW.subtotal_cents)
    END;
    NEW.total_cents :=
      NEW.subtotal_cents - NEW.general_discount_cents + NEW.additions_cents + NEW.taxes_cents;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER quotes_guard BEFORE UPDATE ON aurora.quotes
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_quote_guard();

/**
 * Proposta enviada não se edita.
 *
 * Trocar um preço depois do envio faria o sistema e o PDF que está na caixa de
 * entrada do cliente dizerem números diferentes — e o cliente aprovaria o que
 * ele leu, não o que está gravado. Para mudar existe a revisão, que cria uma
 * versão nova e exige nova aprovação.
 */
CREATE FUNCTION aurora.fn_quote_items_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_status aurora.quote_status;
BEGIN
  SELECT status INTO v_status FROM aurora.quotes
   WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'orçamento já enviado não se edita: revise para criar uma versão nova'
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$;

CREATE TRIGGER quote_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON aurora.quote_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_quote_items_frozen();

CREATE TRIGGER quotes_touch BEFORE UPDATE ON aurora.quotes
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER quotes_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.quotes
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('number');
CREATE TRIGGER price_lists_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.price_lists
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'price_lists', 'price_list_items', 'quotes', 'quote_items', 'quote_status_history'
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
