-- =============================================================================
-- Aurora — 0066 estoque interno × Store (reunião 16/10/2026, Fase 8)
--
-- DOIS CONCEITOS, separados de propósito:
--
--   ESTOQUE INTERNO — privado de quem é dono. `warehouses.customer_id` diz se o
--   almoxarifado é de um CLIENTE (o estoque do hospital gerido pela plataforma)
--   ou da própria organização (nulo: a prestadora). Ganha MÁXIMO além do mínimo.
--
--   STORE — catálogo/oferta comercial da organização. Um item publicado
--   (`store_published`) aparece com descrição e preço de lista; NUNCA com saldo.
--   Pedir proposta pela Store vira OPORTUNIDADE (origem `customer_request`) —
--   não há carrinho, checkout nem pagamento.
-- =============================================================================

ALTER TABLE aurora.warehouses ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE aurora.warehouses
  ADD CONSTRAINT warehouses_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES aurora.customers (id, organization_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS warehouses_customer_idx ON aurora.warehouses (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE aurora.stock_balances ADD COLUMN IF NOT EXISTS max_qty numeric(16, 4);
ALTER TABLE aurora.stock_balances
  ADD CONSTRAINT balances_max_ge_min CHECK (max_qty IS NULL OR max_qty >= min_qty);

ALTER TABLE aurora.inventory_items
  ADD COLUMN IF NOT EXISTS store_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_summary   text;
ALTER TABLE aurora.inventory_items
  ADD CONSTRAINT inventory_items_store_summary_len CHECK (store_summary IS NULL OR length(store_summary) <= 1000);
CREATE INDEX IF NOT EXISTS inventory_items_store_idx
  ON aurora.inventory_items (organization_id) WHERE store_published;

-- Permissões da Store (o catálogo de permissões é espelhado pelo seed; aqui
-- entram para os papéis das organizações que já existem).
INSERT INTO aurora.permissions (key, resource, action, description, field_level)
VALUES ('store.read', 'store', 'read', 'Ver a Store (catálogo comercial)', false),
       ('store.request_quote', 'store', 'request_quote', 'Pedir proposta pela Store', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, p.k
  FROM aurora.roles r
 CROSS JOIN (VALUES ('store.read'), ('store.request_quote')) AS p(k)
 WHERE r.deleted_at IS NULL
   AND (p.k = 'store.read' OR r.key IN ('owner', 'admin', 'manager', 'finance',
                                        'coordinator', 'requester', 'customer_manager'))
ON CONFLICT DO NOTHING;
