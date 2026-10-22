-- =============================================================================
-- Aurora — 0083 pedidos da Store (compra, entrega e nota fiscal)
-- Conversa com o cliente, 21/10/2026: "o cliente pode … comprar, e ao comprar já pode acompanhar
-- por aqui sua data de entrega, anexos como nota fiscal etc.; uma plataforma simples de venda para
-- o que precisarem pontualmente ou urgentemente de peças e acessórios".
--
-- A Store era vitrine com pedido de PROPOSTA (0066). Agora há também o PEDIDO: o cliente escolhe os
-- itens publicados, a prestadora confirma, informa a previsão de entrega, despacha, entrega e anexa a
-- nota fiscal. NÃO HÁ PAGAMENTO nem checkout: é pedido e acompanhamento, e o preço é o de lista no
-- momento do pedido (fica gravado — mudar a lista depois não reescreve pedido feito).
-- =============================================================================

CREATE TABLE aurora.store_orders (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  /** PED-AAAA-NNNN, da série própria. */
  number                      text NOT NULL,
  customer_id                 uuid NOT NULL,
  requested_by_membership_id  uuid NOT NULL,
  status                      text NOT NULL DEFAULT 'requested',
  note                        text,
  /** Soma dos itens COM preço de lista; itens "sob consulta" não entram — `has_unpriced` avisa. */
  total_cents                 bigint NOT NULL DEFAULT 0,
  has_unpriced                boolean NOT NULL DEFAULT false,
  expected_delivery           date,
  delivered_at                timestamptz,
  cancel_reason               text,
  -- Nota fiscal (opcional): número e arquivo. O arquivo mora no armazenamento de objetos.
  invoice_number              text,
  invoice_file_key            text,
  invoice_file_name           text,
  invoice_file_content_type   text,
  invoice_file_size           integer,
  invoice_file_sha256         text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid,
  updated_by                  uuid,

  CONSTRAINT store_orders_status_valid CHECK (status IN ('requested', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  CONSTRAINT store_orders_note_len CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT store_orders_total_non_negative CHECK (total_cents >= 0),
  CONSTRAINT store_orders_cancel_reason CHECK (status <> 'cancelled' OR length(btrim(coalesce(cancel_reason, ''))) >= 5),
  CONSTRAINT store_orders_delivered_at CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CONSTRAINT store_orders_invoice_file_together CHECK (
    (invoice_file_key IS NULL) = (invoice_file_name IS NULL)
    AND (invoice_file_key IS NULL) = (invoice_file_size IS NULL)
    AND (invoice_file_key IS NULL) = (invoice_file_sha256 IS NULL)
  ),
  CONSTRAINT store_orders_invoice_sha_format CHECK (invoice_file_sha256 IS NULL OR invoice_file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT store_orders_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT store_orders_customer_org_fk
    FOREIGN KEY (customer_id, organization_id) REFERENCES aurora.customers (id, organization_id),
  CONSTRAINT store_orders_requester_org_fk
    FOREIGN KEY (requested_by_membership_id, organization_id) REFERENCES aurora.memberships (id, organization_id)
);
CREATE UNIQUE INDEX store_orders_number_uq ON aurora.store_orders (organization_id, number);
CREATE INDEX store_orders_org_status_idx ON aurora.store_orders (organization_id, status, created_at DESC);
CREATE INDEX store_orders_customer_idx ON aurora.store_orders (customer_id);

-- Os itens guardam o que o cliente VIU: nome, sku e preço no momento do pedido.
CREATE TABLE aurora.store_order_items (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL,
  item_id          uuid NOT NULL,
  sku              text NOT NULL,
  name             text NOT NULL,
  unit             text NOT NULL,
  quantity         numeric(14, 3) NOT NULL,
  /** Preço de lista no momento do pedido; nulo = "preço sob consulta". */
  unit_price_cents bigint,
  CONSTRAINT store_order_items_qty_positive CHECK (quantity > 0),
  CONSTRAINT store_order_items_price_non_negative CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  CONSTRAINT store_order_items_order_org_fk
    FOREIGN KEY (order_id, organization_id) REFERENCES aurora.store_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT store_order_items_item_org_fk
    FOREIGN KEY (item_id, organization_id) REFERENCES aurora.inventory_items (id, organization_id)
);
CREATE INDEX store_order_items_order_idx ON aurora.store_order_items (order_id);

-- A linha do tempo do pedido: cada mudança de situação, quem fez e quando.
CREATE TABLE aurora.store_order_events (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  order_id             uuid NOT NULL,
  status               text NOT NULL,
  note                 text,
  actor_membership_id  uuid,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_order_events_order_org_fk
    FOREIGN KEY (order_id, organization_id) REFERENCES aurora.store_orders (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX store_order_events_order_idx ON aurora.store_order_events (order_id, occurred_at);

CREATE TRIGGER store_orders_touch BEFORE UPDATE ON aurora.store_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();
CREATE TRIGGER store_orders_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.store_orders
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('number');

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_orders', 'store_order_items', 'store_order_events']
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
    EXECUTE format('GRANT SELECT ON aurora.%I TO aurora_readonly', t);
  END LOOP;
END
$do$;
GRANT SELECT, INSERT, UPDATE ON aurora.store_orders TO aurora_app;
-- Itens e linha do tempo só se acrescentam: nem edição nem exclusão pela aplicação.
GRANT SELECT, INSERT ON aurora.store_order_items TO aurora_app;
GRANT SELECT, INSERT ON aurora.store_order_events TO aurora_app;
