-- =============================================================================
-- Aurora — 0089 identificação do equipamento, cadastro de pessoa e certificado (rodada 29/10/2026)
--
--   ATV-04  "tag obrigatória e identificação única"
--   ATV-11  "registro ANVISA pesquisável, com tratamento de equipamento sem registro aplicável"
--   USR-05  "empresa/CNPJ quando aplicável"
--   QUA-04  "certificado com referência ao procedimento/ativo"
--
-- TAG ÚNICA POR ORGANIZAÇÃO. Índice único PARCIAL sobre a tag normalizada do mesmo jeito que a
-- projeção de identificadores (0015/0016): sem acento, sem pontuação, sem espaço — "UTI-01",
-- "uti 01" e "UTI01" são a mesma etiqueta. Fica de fora do índice:
--   · tag nula ou vazia (o parque antigo, cadastrado antes da tag obrigatória);
--   · equipamento na lixeira (`deleted_at`): a tag do aparelho excluído não bloqueia o substituto;
--   · as COLISÕES QUE JÁ EXISTEM. Resolver uma colisão exigiria trocar a tag de um dos
--     equipamentos — e a tag está colada no aparelho, no papel da OS, no relatório entregue.
--     Renomear aqui seria destruir dado. Então: em cada grupo repetido o equipamento mais antigo
--     segue no índice, e os demais ficam marcados (`tag_legacy_duplicate`) e FORA dele — a regra
--     vale para toda gravação nova, e a marcação cai sozinha quando alguém troca a tag do
--     marcado (o gatilho abaixo), que a partir daí também passa a ser conferida.
--
-- TAG NÃO SE APAGA. Equipamento que tem tag só a troca por outra; apagar (nula ou vazia) é
-- recusado aqui também, e não só na API — a importação e o SQL direto passam por este gatilho.
--
-- ANVISA "NÃO SE APLICA". Nem todo equipamento tem registro na ANVISA (mobiliário, apoio). Sem a
-- marcação, "sem número" não distingue "não se aplica" de "ninguém cadastrou". As duas coisas
-- juntas — número E "não se aplica" — são recusadas.
--
-- CNPJ DA EMPRESA DA PESSOA. Opcional, sem pontuação: 14 posições, as 12 primeiras de 0-9/A-Z (o
-- CNPJ alfanumérico da Receita) e os 2 dígitos verificadores — conferidos na aplicação
-- (`isValidCnpj`), como o CPF da 0061.
--
-- PROCEDIMENTO DO CERTIFICADO. A versão EXATA do procedimento/checklist (`checklist_templates.id`)
-- a que o certificado de qualificação se refere — opcional, além do equipamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ATV-04 · tag
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS tag_legacy_duplicate boolean NOT NULL DEFAULT false;

-- As colisões de hoje: todos os do grupo, menos o mais antigo, saem do índice (sem renomear nada).
UPDATE aurora.assets a
   SET tag_legacy_duplicate = true
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY organization_id, replace(aurora.normalize_label(tag), ' ', '')
             ORDER BY created_at, id
           ) AS n
      FROM aurora.assets
     WHERE deleted_at IS NULL
       AND tag IS NOT NULL
       AND replace(aurora.normalize_label(tag), ' ', '') <> ''
  ) d
 WHERE a.id = d.id AND d.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS assets_org_tag_uq
  ON aurora.assets (organization_id, (replace(aurora.normalize_label(tag), ' ', '')))
  WHERE tag IS NOT NULL
    AND deleted_at IS NULL
    AND NOT tag_legacy_duplicate
    AND replace(aurora.normalize_label(tag), ' ', '') <> '';

CREATE OR REPLACE FUNCTION aurora.fn_assets_tag_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tag IS DISTINCT FROM OLD.tag THEN
      IF coalesce(btrim(OLD.tag), '') <> '' AND coalesce(btrim(NEW.tag), '') = '' THEN
        RAISE EXCEPTION 'a tag do equipamento não pode ser apagada: troque-a por outra válida'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Tag nova é conferida como qualquer outra: a marcação de colisão antiga não a acompanha.
      NEW.tag_legacy_duplicate := false;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- Cadastro novo nunca nasce fora da regra.
    NEW.tag_legacy_duplicate := false;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS assets_tag_guard ON aurora.assets;
CREATE TRIGGER assets_tag_guard BEFORE INSERT OR UPDATE ON aurora.assets
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_assets_tag_guard();

-- -----------------------------------------------------------------------------
-- ATV-11 · ANVISA "não se aplica"
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.assets
  ADD COLUMN IF NOT EXISTS anvisa_not_applicable boolean NOT NULL DEFAULT false;

ALTER TABLE aurora.assets DROP CONSTRAINT IF EXISTS assets_anvisa_na_exclusive;
ALTER TABLE aurora.assets
  ADD CONSTRAINT assets_anvisa_na_exclusive
  CHECK (NOT anvisa_not_applicable OR coalesce(btrim(anvisa_registration), '') = '');

-- Busca pelo número (a lista filtra por ele): índice parcial, só de quem tem número.
CREATE INDEX IF NOT EXISTS assets_anvisa_registration_idx
  ON aurora.assets (organization_id, anvisa_registration)
  WHERE anvisa_registration IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- USR-05 · CNPJ da empresa da pessoa
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.memberships
  ADD COLUMN IF NOT EXISTS company_tax_id text;

ALTER TABLE aurora.memberships DROP CONSTRAINT IF EXISTS memberships_company_tax_id_digits;
ALTER TABLE aurora.memberships
  ADD CONSTRAINT memberships_company_tax_id_digits
  CHECK (company_tax_id IS NULL OR company_tax_id ~ '^[0-9A-Z]{12}[0-9]{2}$');

-- -----------------------------------------------------------------------------
-- QUA-04 · procedimento do certificado
-- -----------------------------------------------------------------------------
ALTER TABLE aurora.quality_records
  ADD COLUMN IF NOT EXISTS procedure_template_id uuid;

ALTER TABLE aurora.quality_records DROP CONSTRAINT IF EXISTS quality_records_procedure_org_fk;
ALTER TABLE aurora.quality_records
  ADD CONSTRAINT quality_records_procedure_org_fk
  FOREIGN KEY (procedure_template_id, organization_id)
  REFERENCES aurora.checklist_templates (id, organization_id);

CREATE INDEX IF NOT EXISTS quality_records_procedure_idx
  ON aurora.quality_records (procedure_template_id)
  WHERE procedure_template_id IS NOT NULL AND deleted_at IS NULL;
