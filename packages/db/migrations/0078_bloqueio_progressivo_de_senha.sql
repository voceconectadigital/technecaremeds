-- =============================================================================
-- 0078 — o bloqueio por conta volta a ALCANÇAR o teto (revisão de 17/10/2026)
--
-- A 0073 acabou com o bloqueio perpétuo, mas recomeçava a contagem sempre que
-- QUALQUER bloqueio vencia. Como a tentativa feita durante o bloqueio não é
-- registrada, o contador nunca passava de 5: cinco erros, um minuto, e de novo
-- cinco erros. O degrau de 15 minutos ficou inalcançável pelo login real, e
-- quem soubesse o e-mail tinha ~5 tentativas por minuto, indefinidamente.
--
-- Agora a contagem só recomeça quando vence o bloqueio de TETO (10 ou mais
-- erros). Vencido o de 1 minuto, o contador continua subindo: cada erro entre
-- o 6º e o 9º fecha a conta por mais 1 minuto, e o 10º por 15. Depois dos 15
-- minutos, recomeça — sem bloqueio perpétuo. Ritmo máximo de um atacante:
-- ~10 tentativas a cada ~20 minutos por conta.
-- =============================================================================

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
    UPDATE aurora.user_credentials c
       SET failed_attempts = n.tentativas,
           locked_until = CASE
             WHEN n.tentativas >= 10 THEN now() + interval '15 minutes'
             WHEN n.tentativas >= 5  THEN now() + interval '1 minute'
             ELSE NULL
           END,
           updated_at = now()
      FROM (
        SELECT user_id,
               CASE WHEN failed_attempts >= 10 AND locked_until IS NOT NULL AND locked_until <= now()
                    THEN 1                      -- venceu o bloqueio de teto: recomeça
                    ELSE failed_attempts + 1
               END AS tentativas
          FROM aurora.user_credentials
         WHERE user_id = p_user_id
      ) n
     WHERE c.user_id = n.user_id;
  END IF;
END
$$;
