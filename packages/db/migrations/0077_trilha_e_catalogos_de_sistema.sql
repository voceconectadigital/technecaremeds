-- =============================================================================
-- 0077 — trilha de auditoria fora do "toda leitura" e catálogos de sistema
--        que não nasceram (pendências do pente-fino de 17/10/2026)
--
-- 1. PF-15 — `audit.read` entrava de carona em "toda leitura" (`ALL_READ`) no
--    Coordenador, no Gestor e no Financeiro: a trilha global da organização,
--    sem recorte de escopo. `FACTORY_ROLES` deixou de concedê-la a esses três;
--    aqui ela sai das organizações existentes — só do papel de FÁBRICA
--    (`is_system`). Papel próprio é decisão da organização.
--
-- 2. PF-20 — a 0064 (tipos de OS de sistema) e a 0063 (famílias de equipamento)
--    engoliam conflito em silêncio:
--      · a chave de catálogo é única INCLUSIVE entre arquivados; um item
--        aposentado com a chave `preventiva` fazia o `ON CONFLICT DO NOTHING`
--        pular a inserção, e a organização ficava sem o tipo de sistema;
--      · uma SUBcategoria viva com o nome da família ("Terapia" debaixo de
--        outra raiz) ocupava o nome, e a família não era marcada nem criada.
--    Este reparo cria o que falta, com a chave livre seguinte (`preventiva_2`)
--    ou o nome qualificado ("Terapia (família)"). Idempotente: organização
--    completa não é tocada.
-- =============================================================================

DELETE FROM aurora.role_permissions rp
 USING aurora.roles r
 WHERE r.id = rp.role_id
   AND r.is_system
   AND r.key IN ('coordinator', 'manager', 'finance')
   AND rp.permission_key = 'audit.read';

DO $do$
DECLARE
  o record;
  t record;
  f record;
  v_chave text;
  v_n int;
BEGIN
  FOR o IN SELECT id FROM aurora.organizations LOOP
    -- Só organização que já tem catálogo de tipos de OS (as demais recebem tudo
    -- no provisionamento, que já trata os dois conflitos).
    IF EXISTS (SELECT 1 FROM aurora.catalog_items
                WHERE organization_id = o.id AND catalog_key = 'work_order_type') THEN
      FOR t IN
        SELECT * FROM (VALUES ('corrective', 'corretiva', 'Corretiva', 1),
                              ('preventive', 'preventiva', 'Preventiva', 2),
                              ('technical_instruction', 'instrucao_tecnica', 'Instrução Técnica', 3),
                              ('training', 'treinamento', 'Treinamento', 4),
                              ('calibration', 'calibracao', 'Calibração', 5),
                              ('electrical_safety', 'teste_seguranca_eletrica', 'Teste de Segurança Elétrica', 6),
                              ('qualification', 'qualificacao', 'Qualificação', 7)) AS v(system_key, key, label, position)
      LOOP
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM aurora.catalog_items
           WHERE organization_id = o.id AND catalog_key = 'work_order_type'
             AND system_key = t.system_key AND archived_at IS NULL);

        -- Item vivo com o mesmo rótulo e sem chave de sistema: marca, não duplica.
        UPDATE aurora.catalog_items
           SET system_key = t.system_key
         WHERE id = (SELECT id FROM aurora.catalog_items
                      WHERE organization_id = o.id AND catalog_key = 'work_order_type'
                        AND archived_at IS NULL AND system_key IS NULL
                        AND normalized_label = aurora.normalize_label(t.label)
                      LIMIT 1);
        CONTINUE WHEN FOUND;

        v_chave := t.key;
        v_n := 2;
        WHILE EXISTS (SELECT 1 FROM aurora.catalog_items
                       WHERE organization_id = o.id AND catalog_key = 'work_order_type' AND key = v_chave) LOOP
          v_chave := t.key || '_' || v_n;
          v_n := v_n + 1;
        END LOOP;

        INSERT INTO aurora.catalog_items
          (id, organization_id, catalog_key, key, system_key, label, position, is_system)
        VALUES (gen_random_uuid(), o.id, 'work_order_type', v_chave, t.system_key, t.label, t.position, true);
      END LOOP;
    END IF;

    -- Famílias: só organização que já tem alguma família (passou pela 0063).
    IF EXISTS (SELECT 1 FROM aurora.asset_categories
                WHERE organization_id = o.id AND family_key IS NOT NULL) THEN
      FOR f IN
        SELECT * FROM (VALUES ('life_support', 'Suporte à vida', 1),
                              ('diagnosis', 'Diagnóstico', 2),
                              ('therapy', 'Terapia', 3),
                              ('treatment', 'Tratamento', 4),
                              ('support', 'Equipamentos de apoio', 5)) AS v(key, name, position)
      LOOP
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM aurora.asset_categories
           WHERE organization_id = o.id AND family_key = f.key AND archived_at IS NULL);

        -- Raiz viva com o nome da família e sem marca: marca, não duplica.
        UPDATE aurora.asset_categories
           SET family_key = f.key
         WHERE id = (SELECT id FROM aurora.asset_categories
                      WHERE organization_id = o.id AND archived_at IS NULL AND parent_id IS NULL
                        AND family_key IS NULL AND normalized_name = aurora.normalize_label(f.name)
                      LIMIT 1);
        CONTINUE WHEN FOUND;

        INSERT INTO aurora.asset_categories (id, organization_id, name, family_key, position)
        VALUES (
          gen_random_uuid(), o.id,
          CASE WHEN EXISTS (SELECT 1 FROM aurora.asset_categories
                             WHERE organization_id = o.id AND archived_at IS NULL
                               AND normalized_name = aurora.normalize_label(f.name))
               THEN f.name || ' (família)'
               ELSE f.name
          END,
          f.key, f.position);
      END LOOP;
    END IF;
  END LOOP;
END
$do$;
