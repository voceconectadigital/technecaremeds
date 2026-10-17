-- =============================================================================
-- 0073 — endurecimento de autenticação e de identidade (pente-fino 17/10/2026)
--
-- 1. O BLOQUEIO POR CONTA VOLTA A TER TETO DE VERDADE.
--
--    A 0045 prometia "progressivo e com teto" e "bloqueio permanente
--    transformaria um ataque de dicionário em negação de serviço". Mas
--    `failed_attempts` só subia — zerava apenas no acerto. Depois do décimo erro,
--    TODA falha nova (inclusive a primeira depois de o bloqueio vencer) fechava
--    a conta por mais 15 minutos. Quem soubesse o e-mail de alguém mantinha a
--    pessoa trancada para sempre com uma tentativa a cada quinze minutos — e
--    como a recusa por bloqueio não deixa a senha certa chegar ao acerto, a
--    vítima nunca conseguia zerar o contador.
--
--    Agora, quando o bloqueio anterior já venceu, a contagem recomeça: são
--    precisos de novo 5 erros para 1 minuto e 10 para 15 minutos.
--
-- 2. O PAPEL DA APLICAÇÃO NÃO APAGA PESSOA.
--
--    `aurora.users` é GLOBAL: a mesma pessoa pode ter vínculo em várias
--    organizações. A RLS da 0003 deixava o papel da aplicação apagar o usuário de
--    quem tem vínculo na organização corrente — e `memberships.user_id` é
--    `ON DELETE CASCADE`, que roda por fora da RLS: um caminho defeituoso no
--    tenant A apagaria os vínculos da mesma pessoa no tenant B. Nenhum código da
--    aplicação apaga usuário (a saída de alguém é suspender/bloquear o vínculo);
--    só os scripts administrativos de massa de teste fazem isso, como dono.
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
               CASE WHEN locked_until IS NOT NULL AND locked_until <= now()
                    THEN 1                      -- o bloqueio anterior venceu: recomeça
                    ELSE failed_attempts + 1
               END AS tentativas
          FROM aurora.user_credentials
         WHERE user_id = p_user_id
      ) n
     WHERE c.user_id = n.user_id;
  END IF;
END
$$;

REVOKE DELETE ON aurora.users FROM aurora_app;
