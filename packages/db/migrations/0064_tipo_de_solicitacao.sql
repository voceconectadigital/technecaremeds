-- =============================================================================
-- Aurora — 0064 tipo da solicitação e naturezas de OS correspondentes
-- (reunião 16/10/2026, Fase 4)
--
-- `service_requests.requested_type` — lista FECHADA definida pelo cliente:
-- Corretiva, Preventiva, Instrução Técnica, Treinamento, Calibração, Teste de
-- Segurança Elétrica e Qualificação. Anulável: as solicitações anteriores não
-- tinham tipo, e não se inventa um para elas.
--
-- Cada tipo tem a natureza de OS de mesma chave de sistema no catálogo
-- `work_order_type`; as que faltam são criadas aqui para as organizações
-- existentes (as novas recebem por `provisionOrganizationBaseline`). Item com
-- o mesmo rótulo já existente é reaproveitado (ganha a chave), nunca duplicado.
-- =============================================================================

ALTER TABLE aurora.service_requests ADD COLUMN IF NOT EXISTS requested_type text;
ALTER TABLE aurora.service_requests
  ADD CONSTRAINT service_requests_requested_type_valid CHECK (
    requested_type IS NULL OR requested_type IN (
      'corrective', 'preventive', 'technical_instruction', 'training',
      'calibration', 'electrical_safety', 'qualification'
    )
  );

WITH tipos(system_key, key, label, position) AS (
  VALUES ('corrective', 'corretiva', 'Corretiva', 1),
         ('preventive', 'preventiva', 'Preventiva', 2),
         ('technical_instruction', 'instrucao_tecnica', 'Instrução Técnica', 3),
         ('training', 'treinamento', 'Treinamento', 4),
         ('calibration', 'calibracao', 'Calibração', 5),
         ('electrical_safety', 'teste_seguranca_eletrica', 'Teste de Segurança Elétrica', 6),
         ('qualification', 'qualificacao', 'Qualificação', 7)
)
UPDATE aurora.catalog_items c
   SET system_key = t.system_key
  FROM tipos t
 WHERE c.catalog_key = 'work_order_type' AND c.system_key IS NULL AND c.archived_at IS NULL
   AND c.normalized_label = aurora.normalize_label(t.label)
   AND NOT EXISTS (
     SELECT 1 FROM aurora.catalog_items x
      WHERE x.organization_id = c.organization_id AND x.catalog_key = 'work_order_type'
        AND x.system_key = t.system_key AND x.archived_at IS NULL
   );

WITH tipos(system_key, key, label, position) AS (
  VALUES ('corrective', 'corretiva', 'Corretiva', 1),
         ('preventive', 'preventiva', 'Preventiva', 2),
         ('technical_instruction', 'instrucao_tecnica', 'Instrução Técnica', 3),
         ('training', 'treinamento', 'Treinamento', 4),
         ('calibration', 'calibracao', 'Calibração', 5),
         ('electrical_safety', 'teste_seguranca_eletrica', 'Teste de Segurança Elétrica', 6),
         ('qualification', 'qualificacao', 'Qualificação', 7)
)
INSERT INTO aurora.catalog_items
  (id, organization_id, catalog_key, key, system_key, label, position, is_system)
SELECT gen_random_uuid(), o.id, 'work_order_type', t.key, t.system_key, t.label, t.position, true
  FROM aurora.organizations o
 CROSS JOIN tipos t
 WHERE NOT EXISTS (
   SELECT 1 FROM aurora.catalog_items x
    WHERE x.organization_id = o.id AND x.catalog_key = 'work_order_type' AND x.archived_at IS NULL
      AND (x.system_key = t.system_key
           OR x.key = t.key
           OR x.normalized_label = aurora.normalize_label(t.label))
 )
ON CONFLICT DO NOTHING;

-- O Gestor (0061) também abre solicitação — faltava na lista curada.
INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'service_request.create'
  FROM aurora.roles r
 WHERE r.key = 'manager' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
