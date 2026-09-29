-- =============================================================================
-- Aurora — 0045 credenciais e sessões: identidade REAL, sem provedor externo
-- SPEC v0.2 §36 (porta de autenticação), §37 (camadas 1 e 2)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE ESTA MIGRATION EXISTE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Até aqui a única identidade que funcionava era o `LocalAuthProvider`, que
-- aceita `local:<sujeito>:<e-mail>` e entra SEM SENHA. A configuração já o
-- recusa em homologação e em produção (`packages/config/src/env.ts`), e o
-- resultado prático era um beco: fora da máquina de quem desenvolve, NINGUÉM
-- conseguia entrar. Não havia login real em lugar nenhum.
--
-- O provedor previsto era o Supabase Auth, e ele continua sendo um caminho
-- válido — mas está BLOQUEADO por falta de acesso ao projeto (ADR-025, OQ-16).
-- Escrever o adaptador dele agora entregaria código que ninguém pode exercitar,
-- e o cliente continuaria sem conseguir entrar.
--
-- Então a plataforma passa a saber autenticar por conta própria: senha que só a
-- pessoa conhece, guardada como resumo `scrypt`, e sessão como token opaco cujo
-- resumo — não o token — mora no banco. Nada disso substitui o Supabase Auth:
-- os dois são adaptadores da MESMA porta (`AuthProvider`), e a aplicação não
-- sabe qual está em uso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A DECISÃO QUE ORGANIZA O ARQUIVO: NENHUMA DAS DUAS TABELAS É ALCANÇÁVEL
-- PELO PAPEL DA APLICAÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Autenticar acontece ANTES de existir organização no contexto. É o mesmo
-- problema que a migration 0004 resolveu para descobrir vínculos, e a solução é
-- a mesma, por consistência e porque ela é a correta:
--
--   · `aurora_app` NÃO recebe privilégio nenhum sobre `user_credentials` nem
--     sobre `user_sessions`. Uma consulta direta a partir do código da
--     aplicação falha com "permission denied" — ALTO, e não com zero linhas;
--   · todo acesso passa por funções `SECURITY DEFINER` de consulta FIXA,
--     pertencentes a `aurora_auth`, papel `NOLOGIN` que a API não pode
--     assumir;
--   · `aurora_app` recebe apenas `EXECUTE` nessas funções.
--
-- Resultado: a superfície de autenticação do sistema são seis funções nomeadas,
-- auditáveis numa tela de código. Não existe caminho difuso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE NÃO ESTÁ AQUI, E POR QUÊ
-- ─────────────────────────────────────────────────────────────────────────────
--
--  · A VERIFICAÇÃO da senha. `scrypt` roda em Node (`packages/domain/src/senha.ts`).
--    Fazer no banco exigiria `pgcrypto`, e a decisão do projeto sobre extensão
--    já está tomada e justificada duas vezes (ADR-026, ADR-027): extensão não é
--    garantida em PostgreSQL gerenciado nem existe no PGlite.
--  · MFA. A coluna `users.mfa_enabled` existe desde a 0001 e continua `false`;
--    segundo fator exige decisão de canal (TOTP? e-mail? SMS?) que é do cliente.
--    Ver `docs/AI-HANDOFF.md` §7.
--  · Recuperação de senha por e-mail. Não há transporte de e-mail no sistema
--    (a fila de saída existe, o adaptador não). Enquanto não houver, redefinir
--    senha é operação administrativa local — `npm run admin:criar`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- `aurora_auth` — um papel NOVO, e não `aurora_identity`.
--
-- A primeira versão desta migration pendurou as funções em `aurora_identity`,
-- que já existia para a resolução de vínculos, e a suíte de isolamento acusou:
-- há um teste que exige que `aurora_identity` tenha APENAS `SELECT` — "não
-- escreve em lugar nenhum". O teste estava certo e a migration, errada.
--
-- A propriedade que ele defende vale dinheiro no dia ruim: se alguma função
-- `SECURITY DEFINER` daquele papel for explorada, um papel só-leitura limita o
-- estrago a leitura. Ampliá-lo para escrever sessão teria trocado essa garantia
-- por conveniência, e a troca só apareceria num incidente.
--
-- Então autenticar ganha o SEU papel, com o mínimo: escreve em duas tabelas, e
-- em nenhuma outra. `NOLOGIN` porque ninguém se conecta como ele — é dono das
-- funções, e só.
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aurora_auth') THEN
    CREATE ROLE aurora_auth NOLOGIN NOBYPASSRLS;
  END IF;
END
$do$;
ALTER ROLE aurora_auth NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA aurora TO aurora_auth;

/*
 * Leitura de `users` para as funções montarem a identidade (e-mail e nome) sem
 * uma segunda ida ao banco. SELECT e nada mais: quem autentica não altera
 * cadastro.
 */
GRANT SELECT ON aurora.users TO aurora_auth;
CREATE POLICY users_auth_read ON aurora.users FOR SELECT TO aurora_auth USING (true);

-- -----------------------------------------------------------------------------
-- user_credentials — uma linha por pessoa que tem senha nesta plataforma.
--
-- É 1:1 com `users` e mora separada de propósito: `users` é lida por dezenas de
-- consultas (nome de quem assinou, quem apontou hora, quem aprovou), e o resumo
-- da senha não tem por que viajar em nenhuma delas. Numa tabela própria, sem
-- privilégio para o papel da aplicação, ele não vaza nem por `SELECT *`.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.user_credentials (
  user_id           uuid PRIMARY KEY REFERENCES aurora.users(id) ON DELETE CASCADE,

  /**
   * O resumo, em formato próprio e autodescritivo:
   *   scrypt$<N>$<r>$<p>$<sal em base64>$<derivado em base64>
   *
   * Os parâmetros viajam COM o resumo, e não numa constante do código. Sem
   * isso, endurecer o custo amanhã invalidaria toda senha já cadastrada — e a
   * descoberta viria pelo suporte, uma pessoa por vez.
   */
  password_hash     text NOT NULL,
  password_set_at   timestamptz NOT NULL DEFAULT now(),

  /**
   * Tentativas erradas consecutivas, e até quando a conta fica fechada.
   *
   * O limitador em memória da borda HTTP conta por PROCESSO e por origem; este
   * contador é por CONTA e sobrevive a reinício. Os dois somam: o primeiro
   * segura o laço de shell, o segundo segura a tentativa distribuída e lenta,
   * que é a que passa por baixo de qualquer janela de um minuto.
   */
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,

  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_credentials_hash_formato CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  CONSTRAINT user_credentials_tentativas_nao_negativas CHECK (failed_attempts >= 0)
);

-- -----------------------------------------------------------------------------
-- user_sessions — o token opaco, guardado como RESUMO.
--
-- O QUE VAI NO BANCO É `sha256(token)`, nunca o token.
--
-- A diferença aparece no dia do vazamento de um backup: com o token em claro,
-- quem lê a tabela entra como qualquer pessoa que estivesse logada; com o
-- resumo, não entra como ninguém. É o mesmo raciocínio de nunca guardar senha
-- em claro, aplicado à credencial que a substitui durante a sessão.
--
-- Token opaco, e não JWT: revogar um JWT exige lista de revogados, que é uma
-- consulta ao banco em toda requisição — exatamente o custo que o JWT prometia
-- evitar. Sem esse ganho, sobra a desvantagem: um JWT roubado vale até expirar.
-- Aqui, `revoked_at` vale no instante seguinte.
-- -----------------------------------------------------------------------------
CREATE TABLE aurora.user_sessions (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES aurora.users(id) ON DELETE CASCADE,
  token_sha256      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_reason    text,
  client_ip         text,
  user_agent        text,

  CONSTRAINT user_sessions_resumo_formato CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_sessions_expira_depois_de_criar CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_revogacao_tem_motivo CHECK (
    revoked_at IS NULL OR length(btrim(coalesce(revoked_reason, ''))) > 0
  )
);

CREATE UNIQUE INDEX user_sessions_token_uq ON aurora.user_sessions (token_sha256);
-- "quais sessões esta pessoa tem abertas" é a consulta da tela de perfil e a do
-- encerramento em massa quando a senha muda.
CREATE INDEX user_sessions_user_idx ON aurora.user_sessions (user_id, created_at DESC);
CREATE INDEX user_sessions_expiracao_idx ON aurora.user_sessions (expires_at) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- As seis funções. Cada uma tem consulta fixa e um propósito só.
-- -----------------------------------------------------------------------------

/**
 * A credencial de um e-mail, para a aplicação conferir a senha em Node.
 *
 * Devolve o resumo, e isso é necessário: `scrypt` roda fora do banco. O resumo
 * não é uma credencial — é o que existe justamente para não ser.
 *
 * Filtra por pessoa ATIVA e não excluída. Uma conta suspensa não chega à
 * conferência de senha, então "senha certa em conta suspensa" responde igual a
 * "senha errada" — sem contar a quem tenta qual das duas é.
 */
CREATE OR REPLACE FUNCTION aurora.credencial_por_email(p_email text)
RETURNS TABLE (
  user_id         uuid,
  email           text,
  name            text,
  password_hash   text,
  failed_attempts integer,
  locked_until    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  SELECT u.id, u.email, u.name, c.password_hash, c.failed_attempts, c.locked_until
    FROM aurora.users u
    JOIN aurora.user_credentials c ON c.user_id = u.id
   WHERE lower(u.email) = lower(btrim(p_email))
     AND u.deleted_at IS NULL
     AND u.status = 'active'
$$;

/**
 * Registra o desfecho de uma tentativa.
 *
 * O bloqueio é progressivo e tem teto: 5 erros fecham por 1 minuto, 10 por 15
 * minutos. Bloqueio permanente transformaria um ataque de dicionário em negação
 * de serviço contra a pessoa certa — quem soubesse o e-mail de alguém poderia
 * trancá-lo para sempre de fora.
 *
 * O acerto zera o contador. Sem isso, cinco erros espalhados por três meses
 * fechariam a conta de quem sempre entrou.
 */
CREATE OR REPLACE FUNCTION aurora.registrar_tentativa_de_senha(p_user_id uuid, p_sucesso boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
BEGIN
  IF p_sucesso THEN
    UPDATE aurora.user_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE user_id = p_user_id;
  ELSE
    UPDATE aurora.user_credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= 10 THEN now() + interval '15 minutes'
             WHEN failed_attempts + 1 >= 5  THEN now() + interval '1 minute'
             ELSE locked_until
           END,
           updated_at = now()
     WHERE user_id = p_user_id;
  END IF;
END
$$;

/**
 * Abre a sessão. Recebe o RESUMO do token — o token em si nunca entra aqui.
 */
CREATE OR REPLACE FUNCTION aurora.abrir_sessao(
  p_id            uuid,
  p_user_id       uuid,
  p_token_sha256  text,
  p_expires_at    timestamptz,
  p_client_ip     text,
  p_user_agent    text
)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  INSERT INTO aurora.user_sessions
    (id, user_id, token_sha256, expires_at, client_ip, user_agent)
  VALUES
    (p_id, p_user_id, p_token_sha256, p_expires_at, p_client_ip, p_user_agent);
$$;

/**
 * Quem é o portador deste token — e renova a janela no mesmo ato.
 *
 * A RENOVAÇÃO ACONTECE AQUI, e não numa rota de refresh, porque é isto que
 * "sessão que não expira em cima de quem está trabalhando" significa: cada
 * requisição empurra o vencimento. Uma rota de refresh separada precisaria ser
 * chamada pelo cliente, e o cliente que esquece de chamá-la derruba a pessoa no
 * meio de um formulário.
 *
 * O teto é a soma: a janela escorrega até `created_at + 30 dias`, e ali para.
 * Sem teto absoluto, uma aba aberta para sempre seria uma sessão eterna.
 *
 * Devolve vazio para token inexistente, expirado ou revogado — os três casos
 * respondem igual, e a rota devolve 401 sem dizer qual era.
 */
CREATE OR REPLACE FUNCTION aurora.sessao_por_token(p_token_sha256 text, p_janela interval)
RETURNS TABLE (
  session_id  uuid,
  user_id     uuid,
  email       text,
  name        text,
  expires_at  timestamptz
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  WITH viva AS (
    SELECT s.id
      FROM aurora.user_sessions s
      JOIN aurora.users u ON u.id = s.user_id
     WHERE s.token_sha256 = p_token_sha256
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.deleted_at IS NULL
       AND u.status = 'active'
  ), renovada AS (
    UPDATE aurora.user_sessions s
       SET last_seen_at = now(),
           expires_at = least(greatest(s.expires_at, now() + p_janela), s.created_at + interval '30 days')
     WHERE s.id IN (SELECT id FROM viva)
    RETURNING s.id, s.user_id, s.expires_at
  )
  SELECT r.id, r.user_id, u.email, u.name, r.expires_at
    FROM renovada r
    JOIN aurora.users u ON u.id = r.user_id;
$$;

/**
 * Encerra a sessão deste token. Idempotente: encerrar duas vezes não é erro.
 *
 * Saber o token É a autorização para encerrá-lo — não há como encerrar a sessão
 * de outra pessoa sem tê-la em mãos, e quem a tem já podia agir como ela.
 */
CREATE OR REPLACE FUNCTION aurora.encerrar_sessao(p_token_sha256 text, p_motivo text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
  WITH fechada AS (
    UPDATE aurora.user_sessions
       SET revoked_at = now(), revoked_reason = coalesce(nullif(btrim(p_motivo), ''), 'encerrada pelo portador')
     WHERE token_sha256 = p_token_sha256 AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM fechada;
$$;

/**
 * Grava a senha e DERRUBA todas as sessões abertas da pessoa.
 *
 * Derrubar é a parte que se esquece. Trocar a senha porque se suspeita de
 * vazamento e deixar a sessão do invasor viva é fazer metade do trabalho e
 * acreditar que fez o todo.
 */
CREATE OR REPLACE FUNCTION aurora.definir_senha(p_user_id uuid, p_hash text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $$
BEGIN
  INSERT INTO aurora.user_credentials (user_id, password_hash)
       VALUES (p_user_id, p_hash)
  ON CONFLICT (user_id) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         password_set_at = now(),
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = now();

  UPDATE aurora.user_sessions
     SET revoked_at = now(), revoked_reason = 'senha redefinida'
   WHERE user_id = p_user_id AND revoked_at IS NULL;
END
$$;

-- -----------------------------------------------------------------------------
-- Propriedade, isolamento e privilégio.
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  ALTER TABLE aurora.user_credentials OWNER TO aurora_owner;
  ALTER TABLE aurora.user_sessions    OWNER TO aurora_owner;

  /*
   * RLS LIGADA E FORÇADA, SEM NENHUMA POLICY.
   *
   * Parece contraditório e é o ponto: sem policy, ninguém submetido à RLS lê
   * nem escreve uma linha. Somem as duas formas de errar — o `SELECT` direto
   * que alguém escreveria por conveniência não devolve dado, e não há policy
   * frouxa para alguém ampliar sem perceber.
   *
   * As funções `SECURITY DEFINER` rodam como `aurora_auth`, que é DONO
   * delas e não está sujeito à RLS destas tabelas porque recebe privilégio
   * explícito abaixo — e é o único caminho que existe.
   */
  ALTER TABLE aurora.user_credentials ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.user_credentials FORCE  ROW LEVEL SECURITY;
  ALTER TABLE aurora.user_sessions    ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.user_sessions    FORCE  ROW LEVEL SECURITY;

  GRANT SELECT, INSERT, UPDATE ON aurora.user_credentials TO aurora_auth;
  GRANT SELECT, INSERT, UPDATE ON aurora.user_sessions    TO aurora_auth;

  CREATE POLICY user_credentials_identity ON aurora.user_credentials FOR ALL
    TO aurora_auth USING (true) WITH CHECK (true);
  CREATE POLICY user_sessions_identity ON aurora.user_sessions FOR ALL
    TO aurora_auth USING (true) WITH CHECK (true);

  /*
   * `aurora_app` NÃO recebe grant nenhum sobre as duas tabelas. É deliberado, e
   * é a metade da decisão que dá a garantia: a outra metade é o EXECUTE abaixo.
   */
  REVOKE ALL ON aurora.user_credentials FROM PUBLIC;
  REVOKE ALL ON aurora.user_sessions    FROM PUBLIC;
END
$do$;

ALTER FUNCTION aurora.credencial_por_email(text)                     OWNER TO aurora_auth;
ALTER FUNCTION aurora.registrar_tentativa_de_senha(uuid, boolean)    OWNER TO aurora_auth;
ALTER FUNCTION aurora.abrir_sessao(uuid, uuid, text, timestamptz, text, text) OWNER TO aurora_auth;
ALTER FUNCTION aurora.sessao_por_token(text, interval)               OWNER TO aurora_auth;
ALTER FUNCTION aurora.encerrar_sessao(text, text)                    OWNER TO aurora_auth;
ALTER FUNCTION aurora.definir_senha(uuid, text)                      OWNER TO aurora_auth;

REVOKE ALL ON FUNCTION aurora.credencial_por_email(text)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION aurora.registrar_tentativa_de_senha(uuid, boolean)    FROM PUBLIC;
REVOKE ALL ON FUNCTION aurora.abrir_sessao(uuid, uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION aurora.sessao_por_token(text, interval)               FROM PUBLIC;
REVOKE ALL ON FUNCTION aurora.encerrar_sessao(text, text)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION aurora.definir_senha(uuid, text)                      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION aurora.credencial_por_email(text)                  TO aurora_app;
GRANT EXECUTE ON FUNCTION aurora.registrar_tentativa_de_senha(uuid, boolean) TO aurora_app;
GRANT EXECUTE ON FUNCTION aurora.abrir_sessao(uuid, uuid, text, timestamptz, text, text) TO aurora_app;
GRANT EXECUTE ON FUNCTION aurora.sessao_por_token(text, interval)            TO aurora_app;
GRANT EXECUTE ON FUNCTION aurora.encerrar_sessao(text, text)                 TO aurora_app;

/*
 * `definir_senha` NÃO é concedida a `aurora_app`, e essa ausência é a decisão.
 *
 * Hoje a senha é definida por comando administrativo, que roda sob o papel de
 * migração/dono — não pela API. Conceder aqui abriria a capacidade antes de
 * existir o fluxo que a justifica (rota autenticada com senha atual, ou token
 * de uso único enviado por e-mail), e capacidade concedida "para quando
 * precisar" é a que aparece num incidente sem ninguém ter decidido nada.
 */
