-- =============================================================================
-- Aurora — 0040 o convite passa a ser possível sob o papel de produção
--          (SPEC v0.2 §05 · EPIC-002)
--
-- O DEFEITO
--
-- A política `users_visible_through_membership` diz: uma pessoa só existe para
-- a organização que já tem vínculo com ela. É a regra certa — é ela que impede
-- uma organização de listar os usuários de outra.
--
-- Só que ela também vale para INSERT, e aí vira ovo e galinha:
--
--   · para criar o usuário, é preciso já existir o vínculo;
--   · para criar o vínculo, é preciso já existir o usuário (chave estrangeira).
--
-- Resultado: `aurora_app` tinha GRANT INSERT em `users` desde a 0003 e nunca
-- conseguiu usá-lo uma única vez. Ninguém notou porque todo teste e todo seed
-- criava usuário pelo caminho administrativo, que não passa pela RLS. O convite
-- — a operação mais comum de administração de uma organização — nunca foi
-- exercitada pelo papel que a executaria em produção.
--
-- A CORREÇÃO, EM DUAS PARTES
--
-- 1. A chave estrangeira `memberships.user_id -> users.id` passa a ser diferida.
--    Assim a aplicação insere o VÍNCULO primeiro e o USUÁRIO depois, na mesma
--    transação: quando a linha de `users` é verificada pela política, o vínculo
--    já está lá e a política aprova — sem nenhuma exceção, sem afrouxar nada.
--    A integridade continua garantida: chave diferida é verificada no COMMIT,
--    e um vínculo apontando para usuário inexistente derruba a transação.
--
-- 2. Uma função de resolução de e-mail, estreita e somente-leitura, para o caso
--    em que a pessoa JÁ existe na plataforma (o consultor que atende duas
--    empresas). Sem ela, convidar alguém já cadastrado esbarraria no índice
--    único de e-mail com uma mensagem de banco, e a mesma pessoa acabaria com
--    duas identidades — o que quebra o seletor de organização.
--
--    A função devolve APENAS o identificador. Não devolve nome, não devolve
--    organizações, não aceita predicado: quem convida descobre que o endereço
--    já tem conta, que é exatamente o que precisa saber para convidar, e nada
--    além disso.
-- =============================================================================

ALTER TABLE aurora.memberships DROP CONSTRAINT memberships_user_id_fkey;

ALTER TABLE aurora.memberships
  ADD CONSTRAINT memberships_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES aurora.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- Resolução de e-mail para convite.
--
-- Espelha exatamente o índice único `users_email_uq` (lower(email) entre os não
-- excluídos): se esta função devolve NULL, o INSERT é seguro; se devolve um id,
-- é aquele o usuário a reaproveitar. Qualquer divergência entre o filtro daqui
-- e o do índice reintroduziria a colisão que a função existe para evitar.
--
-- Deliberadamente NÃO filtra por status: um usuário suspenso continua ocupando
-- o endereço, e fingir que ele não existe só adiantaria o erro do índice.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.find_user_id_by_email(p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT id FROM aurora.users
   WHERE lower(email) = lower(p_email) AND deleted_at IS NULL
$$;

ALTER FUNCTION aurora.find_user_id_by_email(text) OWNER TO aurora_identity;

REVOKE ALL   ON FUNCTION aurora.find_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.find_user_id_by_email(text) TO aurora_app;
