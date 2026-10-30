-- =============================================================================
-- Aurora — 0084 Store: para quem cada produto aparece, e o passo "separado" do pedido
-- Conversa com o cliente, 23/10/2026:
--   "não tem o local de cadastrar produtos e preços e disponibilizar para qual cliente eu quero que
--    veja ou se eu quiser por aberto a todos da rede de usuários"
--   "gera o histórico de acompanhamento desde aprovado, sendo separado, em trânsito, entregue, para o
--    usuário e para nós como donos do Store vermos"
--
-- PÚBLICO DO PRODUTO. Cada item publicado na Store passa a dizer para quem aparece: toda a rede
-- (`all`, o comportamento de antes, que continua o padrão) ou só os clientes escolhidos (`selected`).
-- A escolha mora em `store_item_customers`. O filtro vale no SERVIDOR — no catálogo, no pedido e no
-- pedido de proposta —, não só na tela: cliente fora da seleção não lista nem pede o item.
--
-- SEPARADO. O pedido ganha o passo `separated` entre o confirmado (aprovado) e o despachado
-- (em trânsito). Pular o passo continua permitido: a prestadora que não separa à parte despacha direto.
-- =============================================================================

ALTER TABLE aurora.inventory_items
  ADD COLUMN IF NOT EXISTS store_audience text NOT NULL DEFAULT 'all';
ALTER TABLE aurora.inventory_items
  ADD CONSTRAINT inventory_items_store_audience_valid CHECK (store_audience IN ('all', 'selected'));

CREATE TABLE aurora.store_item_customers (
  organization_id  uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL,
  customer_id      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  PRIMARY KEY (item_id, customer_id),
  CONSTRAINT store_item_customers_item_org_fk
    FOREIGN KEY (item_id, organization_id) REFERENCES aurora.inventory_items (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT store_item_customers_customer_org_fk
    FOREIGN KEY (customer_id, organization_id) REFERENCES aurora.customers (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX store_item_customers_customer_idx ON aurora.store_item_customers (customer_id);

ALTER TABLE aurora.store_item_customers OWNER TO aurora_owner;
ALTER TABLE aurora.store_item_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.store_item_customers FORCE  ROW LEVEL SECURITY;
CREATE POLICY store_item_customers_tenant_isolation ON aurora.store_item_customers FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
GRANT SELECT ON aurora.store_item_customers TO aurora_readonly;
-- A seleção é trocada inteira (apaga e grava de novo): sem UPDATE.
GRANT SELECT, INSERT, DELETE ON aurora.store_item_customers TO aurora_app;

ALTER TABLE aurora.store_orders DROP CONSTRAINT store_orders_status_valid;
ALTER TABLE aurora.store_orders
  ADD CONSTRAINT store_orders_status_valid
  CHECK (status IN ('requested', 'confirmed', 'separated', 'shipped', 'delivered', 'cancelled'));
