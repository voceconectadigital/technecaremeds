-- =============================================================================
-- Aurora — 0017 resolução pública de QR Code (SPEC v0.2 §07) · EPIC-006
--
-- A rota `/q/{token}` é pública por desenho: alguém aponta a câmera para a
-- etiqueta colada no equipamento e cai nela sem sessão nenhuma. Isso cria um
-- problema que nenhuma outra rota do sistema tem — não há contexto de tenant,
-- e portanto a RLS nega tudo, corretamente.
--
-- A solução é a mesma da migration 0004 (resolução de identidade): uma função
-- SECURITY DEFINER de consulta fixa, dona de um papel próprio, que recebe
-- exatamente um token e devolve exatamente o que a tela pública precisa. Não há
-- como usá-la para varrer nada: sem o token não sai linha nenhuma, e o token
-- tem 130 bits.
--
-- O QUE ELA DEVOLVE, E O QUE NÃO DEVOLVE
--
-- Quem escaneia a etiqueta está fisicamente diante do equipamento, então o nome
-- e a categoria não revelam nada que a pessoa já não esteja vendo. O que NÃO
-- sai daqui é tudo que ela não veria olhando: número de série, patrimônio,
-- caminho completo do local, valores, observações internas, situação.
--
-- E mesmo isso só sai se a organização tiver ligado `allow_anonymous_requests`.
-- O padrão é falso: uma etiqueta fotografada e repassada não deve virar um
-- canal de descoberta de inventário alheio.
-- =============================================================================

ALTER TABLE aurora.organizations
  ADD COLUMN allow_anonymous_requests boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN aurora.organizations.allow_anonymous_requests IS
  'Permite que a rota pública /q/{token} identifique o ativo sem sessão. Padrão: não.';

CREATE FUNCTION aurora.resolve_qr_token(p_token text)
RETURNS TABLE (
  asset_id          uuid,
  organization_id   uuid,
  organization_name text,
  asset_label       text,
  asset_name        text,
  category_name     text,
  location_name     text,
  is_retired        boolean,
  allows_anonymous  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = aurora, pg_catalog
AS $fn$
  SELECT
    a.id,
    o.id,
    o.name,
    o.asset_label,
    a.name,
    c.name,
    -- Só o nome do setor onde o ativo está, nunca o caminho inteiro: a árvore
    -- de locais é o mapa do cliente, e o mapa não vai na etiqueta.
    l.name,
    a.status IN ('decommissioned', 'disposed'),
    o.allow_anonymous_requests
  FROM aurora.assets a
  JOIN aurora.organizations o     ON o.id = a.organization_id AND o.deleted_at IS NULL
  JOIN aurora.asset_categories c  ON c.id = a.asset_category_id
  LEFT JOIN aurora.locations l    ON l.id = a.location_id
  WHERE a.qr_token = p_token
    AND a.deleted_at IS NULL
$fn$;

ALTER FUNCTION aurora.resolve_qr_token(text) OWNER TO aurora_identity;
REVOKE ALL ON FUNCTION aurora.resolve_qr_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aurora.resolve_qr_token(text) TO aurora_app;

-- O papel de identidade precisa enxergar as tabelas para que a função rode.
GRANT SELECT ON aurora.assets, aurora.asset_categories, aurora.locations TO aurora_identity;
CREATE POLICY assets_identity_read            ON aurora.assets            FOR SELECT TO aurora_identity USING (true);
CREATE POLICY asset_categories_identity_read  ON aurora.asset_categories  FOR SELECT TO aurora_identity USING (true);
CREATE POLICY locations_identity_read         ON aurora.locations         FOR SELECT TO aurora_identity USING (true);

-- -----------------------------------------------------------------------------
-- Regeneração de token.
--
-- Existe porque etiqueta some, rasga e é fotografada. Trocar o token invalida
-- a etiqueta antiga na hora — e é a única forma de fazer isso, já que o token é
-- a única credencial da rota pública.
--
-- Roda dentro do contexto do tenant, sob RLS: não é caminho para tocar ativo
-- alheio.
-- -----------------------------------------------------------------------------
CREATE FUNCTION aurora.rotate_qr_token(p_asset_id uuid, p_new_token text)
RETURNS text
LANGUAGE plpgsql
SET search_path = aurora, pg_catalog
AS $fn$
DECLARE v_old text;
BEGIN
  SELECT qr_token INTO v_old FROM aurora.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ativo inexistente ou fora do seu acesso' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF length(p_new_token) <> 26 THEN
    RAISE EXCEPTION 'token de QR deve ter 26 caracteres' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE aurora.assets
     SET qr_token = p_new_token, updated_by = aurora.current_actor_id()
   WHERE id = p_asset_id;
  RETURN v_old;
END
$fn$;

GRANT EXECUTE ON FUNCTION aurora.rotate_qr_token(uuid, text) TO aurora_app;
