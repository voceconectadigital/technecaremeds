-- =============================================================================
-- Aurora — 0039 vínculo sem escopo deixa de ser possível (SPEC v0.2 §05)
--
-- A LACUNA QUE ESTA MIGRATION FECHA
--
-- `membership_scopes` guarda o alcance de um vínculo: quais clientes e quais
-- locais aquela pessoa enxerga. Um vínculo SEM essa linha não enxerga nada —
-- comportamento correto, porque a falha é fechada. Mas era possível criá-lo,
-- e o resultado prático é uma pessoa convidada que entra no sistema e vê uma
-- tela vazia sem nenhuma explicação: nem ela nem o administrador conseguem
-- distinguir "sem permissão" de "cadastro pela metade".
--
-- Até aqui, só os auxiliares de teste garantiam a linha de escopo. Disciplina
-- de código não é garantia: o primeiro caminho novo esquece.
--
-- POR QUE UM CONSTRAINT TRIGGER DEFERIDO, E NÃO UM NOT NULL OU UM AFTER INSERT
--
--   · uma coluna obrigatória em `memberships` duplicaria o escopo em dois
--     lugares e os dois divergiriam;
--   · um `AFTER INSERT` comum dispararia ANTES de a aplicação ter tido a
--     chance de inserir o escopo, e obrigaria a ordem inversa da natural;
--   · um gatilho que CRIASSE o escopo sozinho teria de escolher um padrão —
--     e qualquer padrão que ele escolhesse seria uma decisão de segurança
--     tomada por omissão.
--
-- Diferido, a verificação acontece no COMMIT: a aplicação insere o vínculo e o
-- escopo na ordem que quiser, dentro da mesma transação, e quem esquecer
-- descobre na hora — com a transação inteira desfeita, e não com um vínculo
-- cego solto no banco.
-- =============================================================================

CREATE FUNCTION aurora.fn_membership_requires_scope() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM aurora.membership_scopes s WHERE s.membership_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'vínculo % foi criado sem escopo: informe os clientes e locais que a pessoa enxerga',
      NEW.id
      USING ERRCODE = '23514',
            HINT = 'insira a linha em aurora.membership_scopes na mesma transação';
  END IF;

  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER memberships_require_scope
  AFTER INSERT ON aurora.memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_membership_requires_scope();

-- -----------------------------------------------------------------------------
-- E o inverso: apagar o escopo de um vínculo vivo cegaria a pessoa em silêncio.
--
-- O `DELETE` legítimo é o que acompanha a remoção do próprio vínculo, e esse
-- chega aqui pela cascata — quando a linha de `memberships` já não existe mais.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.fn_scope_delete_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM aurora.memberships m WHERE m.id = OLD.membership_id) THEN
    RAISE EXCEPTION
      'o escopo do vínculo % não se apaga: para tirar o acesso, ajuste o escopo ou encerre o vínculo',
      OLD.membership_id
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END
$fn$;

CREATE TRIGGER membership_scopes_delete_guard
  BEFORE DELETE ON aurora.membership_scopes
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_scope_delete_guard();
