-- =============================================================================
-- Aurora — 0030 estoque (SPEC v0.2 §15) · EPIC-015
--
-- "Falta de peça é a maior causa de OS travada — 789 registros na referência.
--  O estoque não é módulo acessório: é o desbloqueador do fluxo principal."
--
-- TRÊS DECISÕES ESTRUTURAIS
--
-- 1. O MOVIMENTO É UM LIVRO-RAZÃO IMUTÁVEL
--    Nunca se apaga nem se edita um movimento. Correção é sempre um movimento
--    inverso com referência ao original. Um estoque cujo histórico pode ser
--    reescrito não explica a diferença que o inventário encontrou.
--
-- 2. O SALDO É PROJEÇÃO, E A PROIBIÇÃO DE NEGATIVO É RESTRIÇÃO
--    `stock_balances` é mantido por gatilho a partir do razão. Saldo negativo é
--    recusado por CHECK, não por verificação prévia — duas baixas simultâneas do
--    último item passariam as duas por uma leitura, e nenhuma passa por um
--    CHECK.
--
-- 3. RESERVA REDUZ O DISPONÍVEL, NÃO O FÍSICO
--    Reservar peça para uma OS não tira nada da prateleira. É a diferença entre
--    "tem" e "posso usar", e é ela que impede duas OS de contarem com a mesma
--    peça — o problema que trava as duas em vez de uma.
-- =============================================================================

CREATE TYPE aurora.warehouse_kind AS ENUM ('central', 'satellite', 'van', 'consignment');
CREATE TYPE aurora.item_tracking AS ENUM ('none', 'lot', 'serial');
CREATE TYPE aurora.movement_kind AS ENUM (
  'receipt', 'issue', 'adjustment', 'transfer_out', 'transfer_in',
  'consumption', 'return', 'scrap'
);

CREATE TABLE aurora.warehouses (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  kind              aurora.warehouse_kind NOT NULL DEFAULT 'central',
  location_id       uuid,
  /** Carro do técnico: o almoxarifado tem dono. */
  owner_membership_id uuid,
  /** Saldo negativo liberado exige justificativa em cada movimento que o gere. */
  allow_negative    boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT warehouses_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT warehouses_van_has_owner CHECK (kind <> 'van' OR owner_membership_id IS NOT NULL),
  CONSTRAINT warehouses_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT warehouses_location_org_fk
    FOREIGN KEY (location_id, organization_id)
    REFERENCES aurora.locations (id, organization_id) ON DELETE SET NULL,
  CONSTRAINT warehouses_owner_org_fk
    FOREIGN KEY (owner_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX warehouses_name_uq
  ON aurora.warehouses (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE aurora.inventory_items (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  sku                   text NOT NULL,
  name                  text NOT NULL,
  normalized_name       text GENERATED ALWAYS AS (aurora.normalize_label(name)) STORED,
  unit                  text NOT NULL DEFAULT 'un',
  manufacturer_id       uuid,
  manufacturer_code     text,
  tracking              aurora.item_tracking NOT NULL DEFAULT 'none',
  is_stockable          boolean NOT NULL DEFAULT true,
  lead_time_days        integer,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  CONSTRAINT items_sku_format CHECK (length(btrim(sku)) > 0),
  CONSTRAINT items_name_meaningful CHECK (length(aurora.normalize_label(name)) > 0),
  CONSTRAINT items_lead_non_negative CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  CONSTRAINT items_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT items_manufacturer_org_fk
    FOREIGN KEY (manufacturer_id, organization_id)
    REFERENCES aurora.manufacturers (id, organization_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX items_sku_uq ON aurora.inventory_items (organization_id, lower(btrim(sku)));
CREATE INDEX items_name_idx ON aurora.inventory_items (organization_id, normalized_name)
  WHERE archived_at IS NULL;

-- Nomenclatura e preço por cliente — herdado da referência, que acertou nisso:
-- o mesmo filtro tem nome e preço diferentes em cada contrato.
CREATE TABLE aurora.customer_item_aliases (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  item_id           uuid NOT NULL,
  alias             text NOT NULL,
  sale_price        numeric(14, 2),
  PRIMARY KEY (customer_id, item_id),
  CONSTRAINT aliases_price_non_negative CHECK (sale_price IS NULL OR sale_price >= 0),
  CONSTRAINT aliases_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT aliases_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX aliases_org_idx ON aurora.customer_item_aliases (organization_id);

CREATE TABLE aurora.stock_lots (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL,
  warehouse_id      uuid NOT NULL,
  lot_code          text,
  serial_number     text,
  supplier_id       uuid,
  invoice_number    text,
  expires_at        date,
  unit_cost         numeric(14, 4) NOT NULL DEFAULT 0,
  received_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lots_cost_non_negative CHECK (unit_cost >= 0),
  CONSTRAINT lots_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT lots_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lots_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES aurora.warehouses (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lots_supplier_org_fk
    FOREIGN KEY (supplier_id, organization_id)
    REFERENCES aurora.suppliers (id, organization_id) ON DELETE SET NULL
);
CREATE INDEX lots_item_wh_idx ON aurora.stock_lots (item_id, warehouse_id, received_at);
CREATE INDEX lots_expiry_idx  ON aurora.stock_lots (organization_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX lots_serial_uq
  ON aurora.stock_lots (organization_id, serial_number) WHERE serial_number IS NOT NULL;

-- -----------------------------------------------------------------------------
-- stock_balances — projeção. O gatilho do razão a mantém; o CHECK a protege.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.stock_balances (
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL,
  warehouse_id      uuid NOT NULL,
  on_hand           numeric(16, 4) NOT NULL DEFAULT 0,
  reserved          numeric(16, 4) NOT NULL DEFAULT 0,
  min_qty           numeric(16, 4) NOT NULL DEFAULT 0,
  /** Custo médio móvel ponderado, por almoxarifado. */
  average_cost      numeric(14, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, warehouse_id),
  CONSTRAINT balances_reserved_non_negative CHECK (reserved >= 0),
  CONSTRAINT balances_min_non_negative CHECK (min_qty >= 0),
  -- Reservar mais do que existe fisicamente é prometer o que não se tem.
  --
  -- `GREATEST(on_hand, 0)` e não `on_hand` direto: num almoxarifado que aceita
  -- saldo negativo (consignado, por exemplo) o físico pode ficar abaixo de zero,
  -- e a comparação crua recusaria até a reserva zero — travando a tabela inteira
  -- por causa de um saldo que a organização autorizou explicitamente.
  CONSTRAINT balances_reserved_within_hand CHECK (reserved <= GREATEST(on_hand, 0)),
  CONSTRAINT balances_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT balances_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES aurora.warehouses (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX balances_org_idx ON aurora.stock_balances (organization_id);
-- A consulta do painel de compras: o que está abaixo do mínimo.
CREATE INDEX balances_below_min_idx
  ON aurora.stock_balances (organization_id)
  WHERE min_qty > 0 AND on_hand < min_qty;

-- -----------------------------------------------------------------------------
-- stock_movements — o livro-razão. Imutável.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.stock_movements (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  item_id           uuid NOT NULL,
  warehouse_id      uuid NOT NULL,
  lot_id            uuid,
  kind              aurora.movement_kind NOT NULL,
  /** Com sinal: entrada positiva, saída negativa. */
  qty               numeric(16, 4) NOT NULL,
  /** Congelado no momento da saída (§15). */
  unit_cost         numeric(14, 4),
  ref_type          text,
  ref_id            uuid,
  reason            text,
  reverses_id       uuid,
  actor_id          uuid,
  occurred_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT movements_qty_not_zero CHECK (qty <> 0),
  CONSTRAINT movements_sign_matches_kind CHECK (
    (kind IN ('receipt', 'transfer_in', 'return') AND qty > 0)
    OR (kind IN ('issue', 'transfer_out', 'consumption', 'scrap') AND qty < 0)
    OR kind = 'adjustment'
  ),
  -- Ajuste sem justificativa é o buraco por onde a diferença de inventário
  -- desaparece sem que ninguém precise explicá-la.
  CONSTRAINT movements_adjustment_needs_reason CHECK (
    kind <> 'adjustment' OR length(btrim(coalesce(reason, ''))) >= 5
  ),
  CONSTRAINT movements_ref_pair CHECK ((ref_type IS NULL) = (ref_id IS NULL)),
  CONSTRAINT movements_not_self_reverse CHECK (reverses_id IS DISTINCT FROM id),
  CONSTRAINT movements_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT movements_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT movements_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES aurora.warehouses (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT movements_lot_org_fk
    FOREIGN KEY (lot_id, organization_id)
    REFERENCES aurora.stock_lots (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT movements_reverse_org_fk
    FOREIGN KEY (reverses_id, organization_id)
    REFERENCES aurora.stock_movements (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX movements_item_wh_idx ON aurora.stock_movements (item_id, warehouse_id, sequence);
CREATE INDEX movements_ref_idx     ON aurora.stock_movements (ref_type, ref_id)
  WHERE ref_id IS NOT NULL;
CREATE INDEX movements_org_idx     ON aurora.stock_movements (organization_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- Reservas por OS.
--
-- Tabela própria, e não uma coluna somada em `stock_balances`, porque "quem
-- reservou o quê" precisa ser respondível: cancelar uma OS libera a reserva
-- daquela OS, não uma fatia anônima do total.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.stock_reservations (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id     uuid NOT NULL,
  item_id           uuid NOT NULL,
  warehouse_id      uuid NOT NULL,
  qty               numeric(16, 4) NOT NULL,
  consumed_qty      numeric(16, 4) NOT NULL DEFAULT 0,
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT reservations_qty_positive CHECK (qty > 0),
  CONSTRAINT reservations_consumed_within CHECK (consumed_qty >= 0 AND consumed_qty <= qty),
  CONSTRAINT reservations_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT reservations_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT reservations_item_org_fk
    FOREIGN KEY (item_id, organization_id)
    REFERENCES aurora.inventory_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT reservations_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES aurora.warehouses (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX reservations_wo_idx  ON aurora.stock_reservations (work_order_id) WHERE released_at IS NULL;
CREATE INDEX reservations_item_idx ON aurora.stock_reservations (item_id, warehouse_id)
  WHERE released_at IS NULL;
CREATE INDEX reservations_org_idx ON aurora.stock_reservations (organization_id);

-- -----------------------------------------------------------------------------
-- O razão move o saldo, e o custo médio móvel.
--
-- O custo médio é recalculado só na ENTRADA: saída ao custo médio vigente não
-- muda a média, e recalculá-la ali faria o custo unitário derivar a cada baixa.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_stock_movement_applies() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_saldo    numeric;
  v_media    numeric;
  v_negativo boolean;
BEGIN
  INSERT INTO aurora.stock_balances (organization_id, item_id, warehouse_id)
  VALUES (NEW.organization_id, NEW.item_id, NEW.warehouse_id)
  ON CONFLICT (item_id, warehouse_id) DO NOTHING;

  SELECT on_hand, average_cost INTO v_saldo, v_media
    FROM aurora.stock_balances
   WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id
     FOR UPDATE;

  IF NEW.qty > 0 AND NEW.unit_cost IS NOT NULL THEN
    -- Média móvel ponderada: (valor em estoque + valor entrando) / quantidade.
    IF v_saldo + NEW.qty > 0 THEN
      v_media := ((v_saldo * v_media) + (NEW.qty * NEW.unit_cost)) / (v_saldo + NEW.qty);
    ELSE
      v_media := NEW.unit_cost;
    END IF;
  END IF;

  SELECT allow_negative INTO v_negativo FROM aurora.warehouses WHERE id = NEW.warehouse_id;
  IF NOT coalesce(v_negativo, false) AND v_saldo + NEW.qty < 0 THEN
    RAISE EXCEPTION 'saldo insuficiente: há % e a movimentação pede %', v_saldo, abs(NEW.qty)
      USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(v_negativo, false) AND v_saldo + NEW.qty < 0
     AND length(btrim(coalesce(NEW.reason, ''))) < 5 THEN
    RAISE EXCEPTION 'movimentação que deixa o saldo negativo exige justificativa'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE aurora.stock_balances
     SET on_hand = on_hand + NEW.qty,
         average_cost = coalesce(v_media, average_cost)
   WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id;

  RETURN NULL;
END
$fn$;

CREATE TRIGGER stock_movements_apply AFTER INSERT ON aurora.stock_movements
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_stock_movement_applies();

-- O razão é imutável: correção é movimento inverso, com referência ao original.
CREATE FUNCTION aurora.fn_stock_movement_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'movimento de estoque não se altera nem se apaga; corrija com um movimento inverso'
    USING ERRCODE = 'check_violation';
END
$fn$;

CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON aurora.stock_movements
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_stock_movement_immutable();

CREATE TRIGGER warehouses_touch BEFORE UPDATE ON aurora.warehouses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER items_touch BEFORE UPDATE ON aurora.inventory_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER warehouses_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.warehouses
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');
CREATE TRIGGER items_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.inventory_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('name');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouses', 'inventory_items', 'customer_item_aliases', 'stock_lots',
    'stock_balances', 'stock_movements', 'stock_reservations'
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

-- O razão não aceita UPDATE nem DELETE nem por permissão.
REVOKE UPDATE, DELETE ON aurora.stock_movements FROM aurora_app;
