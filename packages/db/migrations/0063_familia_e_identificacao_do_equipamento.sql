-- =============================================================================
-- Aurora — 0063 família do equipamento e identificação física
-- (reunião 16/10/2026, Fase 3)
--
-- 1. `asset_categories.family_key` marca as CINCO famílias definidas pelo
--    cliente (Suporte à vida, Diagnóstico, Terapia, Tratamento, Equipamentos de
--    apoio). Família é categoria-raiz; o TIPO do equipamento é a categoria-filha
--    (a 0013 já limita a dois níveis). As organizações existentes recebem as
--    famílias aqui; as novas, por `provisionOrganizationBaseline`. Categoria
--    raiz com o mesmo nome é MARCADA, não duplicada.
--
-- 2. `assets.tracker_kind` / `tracker_tag` — referência a chip geolocalizador,
--    beacon, RFID ou NFC. Só CADASTRO E VÍNCULO: não há leitura de hardware
--    nem integração (bloqueado até existir hardware/API especificados). Único
--    por organização, para o mesmo chip não estar em dois equipamentos.
-- =============================================================================

ALTER TABLE aurora.asset_categories ADD COLUMN IF NOT EXISTS family_key text;
ALTER TABLE aurora.asset_categories
  ADD CONSTRAINT asset_categories_family_key_valid
    CHECK (family_key IS NULL OR family_key IN ('life_support', 'diagnosis', 'therapy', 'treatment', 'support')),
  ADD CONSTRAINT asset_categories_family_is_root CHECK (family_key IS NULL OR parent_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_family_uq
  ON aurora.asset_categories (organization_id, family_key)
  WHERE family_key IS NOT NULL AND archived_at IS NULL;

WITH familias(key, name, position) AS (
  VALUES ('life_support', 'Suporte à vida', 1),
         ('diagnosis', 'Diagnóstico', 2),
         ('therapy', 'Terapia', 3),
         ('treatment', 'Tratamento', 4),
         ('support', 'Equipamentos de apoio', 5)
)
UPDATE aurora.asset_categories c
   SET family_key = f.key
  FROM familias f
 WHERE c.parent_id IS NULL AND c.family_key IS NULL AND c.archived_at IS NULL
   AND c.normalized_name = aurora.normalize_label(f.name)
   AND NOT EXISTS (
     SELECT 1 FROM aurora.asset_categories x
      WHERE x.organization_id = c.organization_id AND x.family_key = f.key AND x.archived_at IS NULL
   );

WITH familias(key, name, position) AS (
  VALUES ('life_support', 'Suporte à vida', 1),
         ('diagnosis', 'Diagnóstico', 2),
         ('therapy', 'Terapia', 3),
         ('treatment', 'Tratamento', 4),
         ('support', 'Equipamentos de apoio', 5)
)
INSERT INTO aurora.asset_categories (id, organization_id, name, family_key, position)
SELECT gen_random_uuid(), o.id, f.name, f.key, f.position
  FROM aurora.organizations o
 CROSS JOIN familias f
 WHERE NOT EXISTS (
   SELECT 1 FROM aurora.asset_categories x
    WHERE x.organization_id = o.id AND x.archived_at IS NULL
      AND (x.family_key = f.key OR x.normalized_name = aurora.normalize_label(f.name))
 );

ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS tracker_kind text,
  ADD COLUMN IF NOT EXISTS tracker_tag  text;
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_tracker_kind_valid
    CHECK (tracker_kind IS NULL OR tracker_kind IN ('gps', 'ble', 'rfid', 'nfc', 'outro')),
  ADD CONSTRAINT assets_tracker_pair CHECK ((tracker_kind IS NULL) = (tracker_tag IS NULL)),
  ADD CONSTRAINT assets_tracker_tag_len CHECK (tracker_tag IS NULL OR length(tracker_tag) BETWEEN 2 AND 80);
CREATE UNIQUE INDEX IF NOT EXISTS assets_tracker_tag_uq
  ON aurora.assets (organization_id, tracker_tag)
  WHERE tracker_tag IS NOT NULL AND deleted_at IS NULL;

-- O Gestor (0061) passa a curar o catálogo de tipos e modelos de equipamento.
INSERT INTO aurora.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'organization.manage_catalogs'
  FROM aurora.roles r
 WHERE r.key = 'manager' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
