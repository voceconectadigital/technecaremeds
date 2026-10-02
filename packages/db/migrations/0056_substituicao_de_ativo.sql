-- =============================================================================
-- Aurora — 0056 substituição de ativo: quem ficou no lugar de quem
-- Auditoria de gap V2 §7 e P1.5 · PLAT §4 Ativos, evolução "ciclo de vida,
-- obsolescência, substituição" · critério 3 do PLAT §14 (histórico completo)
--
-- RELAÇÃO, E NÃO SÓ DOCUMENTO.
--
-- O laudo de obsolescência (tipo de documento já provisionado) diz POR QUE um
-- equipamento saiu. A relação diz QUEM ficou no lugar — e é ela que permite à
-- linha do tempo do equipamento novo dizer "substituiu o ventilador 03,
-- descomissionado em março" sem ninguém procurar à mão. As duas coisas
-- convivem: o documento continua sendo o caminho do parecer.
--
-- Regras, todas de forma (nenhuma de negócio inventada):
--   · o sucessor é da mesma organização (FK composta);
--   · nenhum ativo sucede a si mesmo;
--   · só ativo descomissionado/baixado aponta sucessor — substituir é a saída
--     de um equipamento, não um apelido;
--   · cada ativo tem no máximo UM antecessor direto (o índice único): dois
--     equipamentos substituídos pelo mesmo novo seria uma consolidação, que é
--     outra coisa e não está modelada.
-- =============================================================================

ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS replaced_by_asset_id uuid;

ALTER TABLE aurora.assets DROP CONSTRAINT IF EXISTS assets_replaced_by_org_fk;
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_replaced_by_org_fk
    FOREIGN KEY (replaced_by_asset_id, organization_id)
    REFERENCES aurora.assets (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE aurora.assets DROP CONSTRAINT IF EXISTS assets_replacement_shape;
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_replacement_shape CHECK (
    replaced_by_asset_id IS NULL
    OR (replaced_by_asset_id <> id AND status IN ('decommissioned', 'disposed'))
  );

CREATE UNIQUE INDEX IF NOT EXISTS assets_one_predecessor_uq
  ON aurora.assets (replaced_by_asset_id) WHERE replaced_by_asset_id IS NOT NULL;
