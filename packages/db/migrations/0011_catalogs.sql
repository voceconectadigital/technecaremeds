-- =============================================================================
-- Aurora — 0011 catálogos governados (SPEC v0.2 §41, EPIC-004 · BL-019)
--
-- O PROBLEMA QUE ISTO RESOLVE
--
-- A auditoria encontrou na referência 651 tipos de equipamento, 360 problemas e
-- 344 origens, com "fechada" convivendo com "Fechada" em 312 OS e "Emprestimo"
-- ao lado de "Empréstimo de equipamento". Consequência: indicador fragmentado,
-- contagem errada, combo inoperável. Não foi descuido de quem cadastrou — foi
-- ausência de governança: a lista aceitava qualquer coisa e nunca oferecia um
-- caminho para consertar depois.
--
-- As três peças da governança, aqui:
--   1. chave técnica estável (`key`) separada do rótulo (`label`)
--   2. unicidade sobre o rótulo NORMALIZADO — sem acento, sem pontuação, sem
--      caixa — para que "Fechada" e "fechada" não coexistam
--   3. arquivar e mesclar, para que a lista suja de hoje tenha conserto
--
-- POR QUE UMA TABELA SÓ, E POR QUE ISSO NÃO É A `Empresa` POLIMÓRFICA
--
-- A `Empresa` da referência juntava conceitos com atributos e relacionamentos
-- DIFERENTES — cliente, fornecedor, local e setor — e por isso nenhum deles
-- podia ter campo próprio. Aqui é o contrário: os itens de catálogo têm
-- exatamente a mesma forma (chave, rótulo, posição, cor, arquivado), sem
-- exceção. Quem tem campo próprio continua em tabela própria: `customers`,
-- `locations`, `suppliers` na 0008, e `manufacturers`, `asset_models`,
-- `criticality_levels` no EPIC-005. A regra é: mesma forma, mesma tabela;
-- forma diferente, tabela diferente. Ver ADR-028.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Normalização do rótulo.
--
-- IMMUTABLE porque é usada em coluna gerada e em índice. Sem `unaccent`, que é
-- extensão (mesma razão do ADR-026): `translate` resolve o conjunto latino que
-- interessa e é determinístico em qualquer instalação.
--
-- Precisa concordar exatamente com `normalizeForSearch` em
-- packages/domain/src/directory.ts. Um teste compara as duas implementações
-- sobre a mesma lista de entradas.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.normalize_label(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $fn$
  SELECT btrim(
    regexp_replace(
      lower(translate(
        p_text,
        'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝáàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
        'AAAAAAEEEEIIIIOOOOOUUUUCNYaaaaaaeeeeiiiiooooouuuucnyy'
      )),
      '[^a-z0-9]+', ' ', 'g'
    )
  )
$fn$;

-- -----------------------------------------------------------------------------
-- Definições de catálogo: catálogo de PLATAFORMA, espelho do código.
--
-- Mesma escolha de `permissions` (0006): um catálogo só existe se houver código
-- que o use. Quem define é packages/domain/src/catalogs.ts, e um teste garante
-- que banco e código não divergem.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.catalog_definitions (
  key             text PRIMARY KEY,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  is_hierarchical boolean NOT NULL DEFAULT false,
  CONSTRAINT catalog_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$')
);

-- -----------------------------------------------------------------------------
-- Itens de catálogo.
--
-- `merged_into_id` preserva a duplicata em vez de apagá-la, exatamente como a
-- SPEC decide para solicitações duplicadas (§11): o registro antigo continua
-- existindo, aponta para o vencedor, e a trilha de quem escolheu o quê no
-- passado permanece legível. Apagar seria mais limpo na tabela e mentiria sobre
-- o histórico.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.catalog_items (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  catalog_key       text NOT NULL REFERENCES aurora.catalog_definitions(key) ON DELETE RESTRICT,
  key               text NOT NULL,
  -- Identidade estável ENTRE organizações, para os itens que alimentam
  -- indicador. É o que permite calcular "preventiva x corretiva" mesmo quando a
  -- organização renomeia tudo para o vocabulário dela (SPEC §14).
  system_key        text,
  label             text NOT NULL,
  normalized_label  text GENERATED ALWAYS AS (aurora.normalize_label(label)) STORED,
  description       text NOT NULL DEFAULT '',
  color             text,
  icon              text,
  position          integer NOT NULL DEFAULT 0,
  parent_id         uuid,
  is_system         boolean NOT NULL DEFAULT false,
  archived_at       timestamptz,
  merged_into_id    uuid,
  custom            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  CONSTRAINT catalog_items_key_format  CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  CONSTRAINT catalog_items_label_present CHECK (length(btrim(label)) > 0),
  -- rótulo que normaliza para nada ("---") não distingue nada
  CONSTRAINT catalog_items_label_meaningful CHECK (length(aurora.normalize_label(label)) > 0),
  CONSTRAINT catalog_items_color_format CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT catalog_items_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT catalog_items_not_own_merge  CHECK (merged_into_id IS DISTINCT FROM id),
  -- item mesclado está necessariamente arquivado: mesclar sem tirar da lista
  -- deixaria a duplicata selecionável, que é o problema que a mesclagem resolve
  CONSTRAINT catalog_items_merged_is_archived CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL),
  CONSTRAINT catalog_items_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT catalog_items_parent_org_fk
    FOREIGN KEY (parent_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT catalog_items_merge_org_fk
    FOREIGN KEY (merged_into_id, organization_id)
    REFERENCES aurora.catalog_items (id, organization_id) ON DELETE RESTRICT
);

-- A chave técnica é única sempre, inclusive entre arquivados: reaproveitar a
-- chave de um item aposentado faria o histórico apontar para outra coisa.
CREATE UNIQUE INDEX catalog_items_key_uq
  ON aurora.catalog_items (organization_id, catalog_key, key);

CREATE UNIQUE INDEX catalog_items_system_key_uq
  ON aurora.catalog_items (organization_id, catalog_key, system_key)
  WHERE system_key IS NOT NULL AND archived_at IS NULL;

-- O rótulo normalizado é único apenas entre os itens VIVOS. Um item arquivado
-- pode ter o mesmo rótulo do vencedor da mesclagem — é justamente o que ele é.
CREATE UNIQUE INDEX catalog_items_label_uq
  ON aurora.catalog_items (organization_id, catalog_key, normalized_label)
  WHERE archived_at IS NULL;

CREATE INDEX catalog_items_org_idx     ON aurora.catalog_items (organization_id, catalog_key) WHERE archived_at IS NULL;
CREATE INDEX catalog_items_parent_idx  ON aurora.catalog_items (parent_id) WHERE archived_at IS NULL;
CREATE INDEX catalog_items_merged_idx  ON aurora.catalog_items (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Registro de referências a itens de catálogo.
--
-- Mesclar só é útil se as referências existentes passarem a apontar para o
-- vencedor. Cada tabela que referenciar um item se declara aqui, e a mesclagem
-- percorre este registro. A alternativa — listar as tabelas dentro da função de
-- mesclagem — obrigaria a alterar a função a cada épico novo, e a esquecer de
-- alterá-la seria silencioso: a mesclagem "funcionaria" deixando referências
-- órfãs para trás.
--
-- É registro de plataforma, escrito por migration, nunca pela aplicação.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.catalog_references (
  table_name    text NOT NULL,
  column_name   text NOT NULL,
  -- NULL significa "qualquer catálogo": é o caso de `catalog_items.parent_id`,
  -- que aponta para um item do mesmo catálogo, seja ele qual for.
  catalog_key   text REFERENCES aurora.catalog_definitions(key) ON DELETE CASCADE,
  PRIMARY KEY (table_name, column_name),
  CONSTRAINT catalog_references_ident CHECK (
    table_name  ~ '^[a-z][a-z0-9_]{1,60}$' AND
    column_name ~ '^[a-z][a-z0-9_]{1,60}$'
  )
);

-- -----------------------------------------------------------------------------
-- `key` é imutável.
--
-- Renomear a chave técnica quebraria toda referência histórica que a usa como
-- identificador estável — é exatamente o que ela existe para impedir. O rótulo,
-- esse sim, muda à vontade: é para isso que os dois são separados.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent_catalog text;
  v_parent_parent  uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'a chave técnica "%" é imutável; para renomear, altere o rótulo', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.catalog_key IS DISTINCT FROM OLD.catalog_key THEN
      RAISE EXCEPTION 'um item não muda de catálogo'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_system AND NOT NEW.is_system THEN
      RAISE EXCEPTION 'item de sistema não deixa de ser de sistema'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT catalog_key, parent_id INTO v_parent_catalog, v_parent_parent
      FROM aurora.catalog_items WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item pai inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_parent_catalog <> NEW.catalog_key THEN
      RAISE EXCEPTION 'o item pai é do catálogo "%" e este é do catálogo "%"', v_parent_catalog, NEW.catalog_key
        USING ERRCODE = 'check_violation';
    END IF;

    -- Dois níveis, no máximo.
    --
    -- Não é economia de esforço: com profundidade 2 o ciclo é impossível por
    -- construção, e a mesclagem de um item-pai não precisa de detecção de
    -- ciclo ao reapontar filhos. Taxonomia que precisa de mais eixos usa mais
    -- catálogos — que é como a SPEC modela a falha, em três eixos separados
    -- (§08), e não como uma árvore profunda de significado ambíguo.
    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'catálogo aceita no máximo dois níveis; "%" já é um subitem', NEW.parent_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM aurora.catalog_items c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION 'este item já tem subitens e por isso não pode virar subitem de outro'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER catalog_items_guard BEFORE INSERT OR UPDATE ON aurora.catalog_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_catalog_item_guard();

CREATE TRIGGER catalog_items_touch BEFORE UPDATE ON aurora.catalog_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at();

CREATE TRIGGER catalog_items_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.catalog_items
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('label');

-- -----------------------------------------------------------------------------
-- Mesclagem assistida.
--
-- Roda como invocador: sob RLS, dentro do contexto do tenant. Um item de outra
-- organização simplesmente não é encontrado.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.merge_catalog_item(p_source uuid, p_target uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE
  v_src_catalog text;
  v_tgt_catalog text;
  v_src_label   text;
  v_target_final uuid;
  v_ref         record;
  v_count       integer;
  v_total       integer := 0;
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'não é possível mesclar um item nele mesmo' USING ERRCODE = 'check_violation';
  END IF;

  SELECT catalog_key, label INTO v_src_catalog, v_src_label
    FROM aurora.catalog_items WHERE id = p_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item de origem inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- O destino pode já ter sido mesclado: seguimos a cadeia até o vencedor
  -- final, para não criar corrente de ponteiros que ninguém resolve depois.
  v_target_final := p_target;
  FOR i IN 1..10 LOOP
    SELECT catalog_key, merged_into_id INTO v_tgt_catalog, p_target
      FROM aurora.catalog_items WHERE id = v_target_final;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item de destino inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
    END IF;
    EXIT WHEN p_target IS NULL;
    v_target_final := p_target;
  END LOOP;

  IF v_src_catalog <> v_tgt_catalog THEN
    RAISE EXCEPTION 'origem e destino são de catálogos diferentes (% e %)', v_src_catalog, v_tgt_catalog
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_target_final = p_source THEN
    RAISE EXCEPTION 'a mesclagem criaria um ciclo entre os itens' USING ERRCODE = 'check_violation';
  END IF;

  -- Repõe as referências declaradas. `format` com %I sobre nomes já validados
  -- por CHECK na tabela de registro: identificador não vem de entrada livre.
  FOR v_ref IN
    SELECT table_name, column_name FROM aurora.catalog_references
     WHERE catalog_key = v_src_catalog OR catalog_key IS NULL
  LOOP
    EXECUTE format('UPDATE aurora.%I SET %I = $1 WHERE %I = $2', v_ref.table_name, v_ref.column_name, v_ref.column_name)
      USING v_target_final, p_source;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
  END LOOP;

  UPDATE aurora.catalog_items
     SET archived_at = coalesce(archived_at, now()), merged_into_id = v_target_final
   WHERE id = p_source;

  RETURN v_total;
END
$fn$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.catalog_definitions OWNER TO aurora_owner;
ALTER TABLE aurora.catalog_references  OWNER TO aurora_owner;
ALTER TABLE aurora.catalog_items       OWNER TO aurora_owner;

ALTER TABLE aurora.catalog_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.catalog_definitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY catalog_definitions_read_all ON aurora.catalog_definitions FOR SELECT USING (true);

ALTER TABLE aurora.catalog_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.catalog_references FORCE  ROW LEVEL SECURITY;
CREATE POLICY catalog_references_read_all ON aurora.catalog_references FOR SELECT USING (true);

ALTER TABLE aurora.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.catalog_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY catalog_items_tenant_isolation ON aurora.catalog_items FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());

GRANT SELECT ON aurora.catalog_definitions, aurora.catalog_references TO aurora_app, aurora_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON aurora.catalog_items TO aurora_app;
GRANT SELECT ON aurora.catalog_items TO aurora_readonly;
GRANT EXECUTE ON FUNCTION aurora.merge_catalog_item(uuid, uuid) TO aurora_app;

-- A hierarquia de catálogo é ela própria uma referência a item de catálogo:
-- mesclar um item-pai precisa reapontar os filhos. Registrando isto agora, o
-- mecanismo nasce exercitado de verdade e não só previsto.
INSERT INTO aurora.catalog_references (table_name, column_name, catalog_key)
VALUES ('catalog_items', 'parent_id', NULL);
