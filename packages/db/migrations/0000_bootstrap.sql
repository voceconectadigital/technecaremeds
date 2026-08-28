-- =============================================================================
-- Aurora — 0000 bootstrap: schema, papéis de banco e funções de contexto
-- SPEC v0.2 §37 (Segurança multitenant) · ADR-023
--
-- Idempotente: pode rodar em banco vazio ou já inicializado.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS aurora;

-- -----------------------------------------------------------------------------
-- Papéis de banco separados (§37)
--   aurora_owner    — dono do schema e das tabelas; alvo das migrations
--   aurora_migrator — executa DDL assumindo aurora_owner
--   aurora_app      — usado pela API em runtime; SEM BYPASSRLS, NÃO é owner
--   aurora_readonly — analytics e suporte; leitura sujeita a RLS
--
-- Sem LOGIN: são papéis de grupo. O usuário concreto de cada ambiente herda
-- deles, o que mantém a configuração portável entre local, Supabase e outros.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_owner') THEN
    CREATE ROLE aurora_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_migrator') THEN
    CREATE ROLE aurora_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_app') THEN
    CREATE ROLE aurora_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_readonly') THEN
    CREATE ROLE aurora_readonly NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- aurora_app JAMAIS pode ter BYPASSRLS ou SUPERUSER; reafirmado a cada migration
ALTER ROLE aurora_app      NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE aurora_readonly NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT aurora_owner TO aurora_migrator;

ALTER SCHEMA aurora OWNER TO aurora_owner;
GRANT USAGE ON SCHEMA aurora TO aurora_app, aurora_readonly;

-- -----------------------------------------------------------------------------
-- Contexto da requisição — SEMPRE transaction-local (§37)
--
-- A aplicação define o contexto com set_config(..., is_local => true) dentro da
-- transação. Variável de sessão sobreviveria ao COMMIT e vazaria para o próximo
-- tenant quando a conexão voltasse ao pool. Aqui isso é impossível por construção.
--
-- Falha fechada: sem contexto, as funções retornam NULL e a comparação
-- `organization_id = NULL` é falsa — nega acesso em vez de liberar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('aurora.organization_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION aurora.current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('aurora.actor_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION aurora.current_actor_kind() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT coalesce(nullif(current_setting('aurora.actor_kind', true), ''), 'system') $$;

CREATE OR REPLACE FUNCTION aurora.current_request_id() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('aurora.request_id', true), '') $$;

CREATE OR REPLACE FUNCTION aurora.current_client_ip() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('aurora.client_ip', true), '') $$;

CREATE OR REPLACE FUNCTION aurora.current_user_agent() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('aurora.user_agent', true), '') $$;

CREATE OR REPLACE FUNCTION aurora.current_source() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog
AS $$ SELECT coalesce(nullif(current_setting('aurora.source', true), ''), 'unknown') $$;

ALTER FUNCTION aurora.current_organization_id() OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_actor_id()        OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_actor_kind()      OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_request_id()      OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_client_ip()       OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_user_agent()      OWNER TO aurora_owner;
ALTER FUNCTION aurora.current_source()          OWNER TO aurora_owner;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aurora.fn_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
ALTER FUNCTION aurora.fn_touch_updated_at() OWNER TO aurora_owner;

-- -----------------------------------------------------------------------------
-- Enumerações estruturais (§32: enum de banco só para o que é estrutural)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actor_kind') THEN
    CREATE TYPE aurora.actor_kind AS ENUM ('user', 'system', 'automation', 'api', 'support', 'import');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE aurora.audit_action AS ENUM ('create', 'update', 'delete', 'restore');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seat_type') THEN
    CREATE TYPE aurora.seat_type AS ENUM ('staff', 'portal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE aurora.membership_status AS ENUM ('invited', 'active', 'suspended', 'removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_status') THEN
    CREATE TYPE aurora.organization_status AS ENUM ('active', 'suspended', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE aurora.user_status AS ENUM ('active', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scope_mode') THEN
    CREATE TYPE aurora.scope_mode AS ENUM ('all', 'listed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_scope') THEN
    CREATE TYPE aurora.assignment_scope AS ENUM ('all', 'team', 'own');
  END IF;
END
$$;
