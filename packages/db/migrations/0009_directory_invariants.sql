-- =============================================================================
-- Aurora — 0009 invariantes do diretório (EPIC-003, BL-014/BL-015/BL-018)
--
-- POR QUE NO BANCO E NÃO NO SERVIÇO
--
-- `path` e `depth` são dados derivados. Dado derivado mantido pela aplicação
-- fica correto enquanto existir um único caminho de escrita — e deixa de ficar
-- no dia em que aparecer o segundo (importação, correção manual, migração,
-- rotina de manutenção). Aqui a derivação é do banco: a aplicação escreve
-- `parent_id` e nada mais. Mover uma subárvore de 500 locais é um UPDATE de
-- uma coluna; a cascata é uma única instrução, dentro da mesma transação.
--
-- As quatro invariantes garantidas:
--   1. `path` sempre é o caminho real até a raiz, e `depth` o seu tamanho
--   2. nenhum ciclo
--   3. profundidade máxima de 8, inclusive depois de mover
--   4. o tipo do filho é aceito pelo tipo do pai (regra configurável, ADR-005)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Derivação e validação de um nó.
--
-- SECURITY INVOKER de propósito: rodando como o papel da aplicação, a busca do
-- pai passa pela RLS. Se o pai for de outro tenant, a consulta não o encontra e
-- a operação falha — mesmo resultado da FK composta, por um segundo caminho.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_location_tree() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent_path   text;
  v_parent_depth  integer;
  v_parent_type   uuid;
  v_parent_cust   uuid;
  v_can_root      boolean;
  v_allowed       uuid[];
  v_type_name     text;
  v_allowed_names text;
BEGIN
  -- Cascata: quando o UPDATE vem do gatilho que reescreve a subárvore, `path`
  -- e `depth` já chegam calculados e coerentes entre si. Recalcular aqui
  -- dependeria da ordem em que as linhas são atualizadas, que não é definida.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT lt.can_be_root, lt.allowed_parent_type_ids, lt.name
    INTO v_can_root, v_allowed, v_type_name
    FROM aurora.location_types lt
   WHERE lt.id = NEW.location_type_id AND lt.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tipo de local inexistente ou arquivado: %', NEW.location_type_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.parent_id IS NULL THEN
    IF NOT v_can_root THEN
      RAISE EXCEPTION 'o tipo "%" não pode ficar na raiz da árvore', v_type_name
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.path  := '/' || NEW.id::text || '/';
    NEW.depth := 1;
  ELSE
    SELECT p.path, p.depth, p.location_type_id, p.customer_id
      INTO v_parent_path, v_parent_depth, v_parent_type, v_parent_cust
      FROM aurora.locations p
     WHERE p.id = NEW.parent_id AND p.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'local pai inexistente, arquivado ou fora do escopo: %', NEW.parent_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- ciclo: o pai escolhido não pode estar dentro da própria subárvore
    IF position('/' || NEW.id::text || '/' in v_parent_path) > 0 THEN
      RAISE EXCEPTION 'mover para dentro da própria subárvore criaria um ciclo'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT (v_parent_type = ANY (v_allowed)) THEN
      SELECT string_agg(lt.name, ', ' ORDER BY lt.name) INTO v_allowed_names
        FROM aurora.location_types lt WHERE lt.id = ANY (v_allowed);
      RAISE EXCEPTION 'o tipo "%" só pode ficar sob: %', v_type_name, coalesce(v_allowed_names, 'nenhum tipo')
        USING ERRCODE = 'check_violation';
    END IF;

    -- A árvore não atravessa clientes. E a recusa é explícita, não uma
    -- reatribuição silenciosa: escrever `NEW.customer_id := v_parent_cust`
    -- funcionaria, e ao mover uma subárvore trocaria o cliente de centenas de
    -- locais sem que ninguém pedisse — o tipo de correção automática que só é
    -- descoberta quando o faturamento sai errado. Transferir local entre
    -- clientes é uma operação de negócio própria, com suas consequências
    -- (contrato, SLA, histórico), e não um efeito colateral de arrastar um nó.
    IF NEW.customer_id IS DISTINCT FROM v_parent_cust THEN
      RAISE EXCEPTION 'este local pertence a outro cliente que o local pai; transferir cliente é operação à parte'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.path        := v_parent_path || NEW.id::text || '/';
    NEW.depth       := v_parent_depth + 1;

    IF NEW.depth > 8 THEN
      RAISE EXCEPTION 'profundidade % excede o limite de 8 níveis', NEW.depth
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- -----------------------------------------------------------------------------
-- Cascata da subárvore.
--
-- `path` é composto só de uuid e barra — não contém `%` nem `_` — então o LIKE
-- de prefixo é literal e usa o índice `locations_path_idx`.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_location_cascade() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_max_depth integer;
  v_moved     integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF NEW.path IS NOT DISTINCT FROM OLD.path THEN
    RETURN NULL;
  END IF;

  -- A verificação de profundidade vem ANTES da cascata, não depois.
  --
  -- Descoberto por teste: a restrição `locations_depth_range` dispara na
  -- primeira linha descendente que passa de 8 e aborta com a mensagem genérica
  -- do PostgreSQL, então o RAISE que ficava depois do UPDATE nunca era
  -- alcançado. Mensagem inalcançável é pior que mensagem ausente, porque
  -- parece existir e some justamente no caso que ela existia para explicar.
  SELECT max(d.depth), count(*) INTO v_max_depth, v_moved
    FROM aurora.locations d
   WHERE d.path LIKE OLD.path || '%' AND d.id <> NEW.id;

  IF coalesce(v_max_depth, 0) + (NEW.depth - OLD.depth) > 8 THEN
    RAISE EXCEPTION 'mover esta subárvore de % descendentes chegaria a % níveis, acima do limite de 8',
      v_moved, v_max_depth + (NEW.depth - OLD.depth)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE aurora.locations d
     SET path        = NEW.path || substring(d.path from length(OLD.path) + 1),
         depth       = d.depth + (NEW.depth - OLD.depth),
         customer_id = NEW.customer_id
   WHERE d.path LIKE OLD.path || '%'
     AND d.id <> NEW.id;

  RETURN NULL;
END
$fn$;

CREATE TRIGGER locations_tree BEFORE INSERT OR UPDATE ON aurora.locations
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_location_tree();

CREATE TRIGGER locations_cascade AFTER UPDATE ON aurora.locations
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_location_cascade();

-- -----------------------------------------------------------------------------
-- Janelas de calendário não se sobrepõem no mesmo dia.
--
-- A forma canônica disso seria uma restrição EXCLUDE, que exige `btree_gist` —
-- extensão, e portanto indisponível pelo mesmo motivo do ADR-026. O gatilho faz
-- a mesma verificação; para que duas transações simultâneas não passem as duas
-- pela leitura antes de qualquer escrita, o calendário é serializado por
-- advisory lock de transação.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_calendar_window_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.calendar_id::text));
  IF EXISTS (
    SELECT 1 FROM aurora.calendar_windows w
     WHERE w.calendar_id = NEW.calendar_id
       AND w.weekday     = NEW.weekday
       AND w.id         <> NEW.id
       AND w.starts_at   < NEW.ends_at
       AND NEW.starts_at < w.ends_at
  ) THEN
    RAISE EXCEPTION 'a janela % a % sobrepõe outra já cadastrada neste dia', NEW.starts_at, NEW.ends_at
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER calendar_windows_no_overlap BEFORE INSERT OR UPDATE ON aurora.calendar_windows
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_calendar_window_no_overlap();

-- -----------------------------------------------------------------------------
-- `updated_at`
-- -----------------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'customer_contacts', 'location_types', 'locations',
                           'suppliers', 'calendars', 'teams']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON aurora.%I FOR EACH ROW EXECUTE FUNCTION aurora.fn_touch_updated_at()',
                   t || '_touch', t);
  END LOOP;
END
$do$;
