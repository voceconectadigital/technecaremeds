-- =============================================================================
-- Aurora — 0041 papel do agendador de trabalhos (SPEC v0.2 §31 · §37)
--
-- O PROBLEMA
--
-- O trabalho periódico roda POR ORGANIZAÇÃO, e para isso alguém precisa saber
-- quais organizações existem. `aurora_app` não sabe — e é assim que tem de ser:
-- a política de `organizations` só deixa ver a organização do contexto, e o
-- contexto é justamente o que ainda não existe antes da dispersão.
--
-- Duas saídas ruins e a que foi escolhida:
--
--   · dar BYPASSRLS ao aurora_app resolveria e destruiria o isolamento inteiro;
--   · uma função SECURITY DEFINER devolvendo a lista deixaria qualquer caminho
--     da API capaz de enumerar as organizações da plataforma.
--
-- A saída é a mesma que a 0003 já usa para o publicador do outbox: um papel
-- PRÓPRIO, com uma política dedicada e o mínimo de privilégio. `aurora_scheduler`
-- lê o identificador das organizações ativas e mais nada — não lê OS, não lê
-- ativo, não escreve em lugar nenhum. O trabalho em si continua rodando sob
-- `aurora_app`, dentro de `withTenant`, sujeito à RLS como qualquer requisição.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_scheduler') THEN
    CREATE ROLE aurora_scheduler NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE aurora_scheduler NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA aurora TO aurora_scheduler;

-- Só leitura, e só desta tabela.
GRANT SELECT ON aurora.organizations TO aurora_scheduler;

CREATE POLICY organizations_scheduler_read ON aurora.organizations
  FOR SELECT TO aurora_scheduler USING (true);
