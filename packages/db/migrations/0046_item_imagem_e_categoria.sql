-- =============================================================================
-- Aurora — 0046 o item de estoque ganha imagem e categoria
-- SPEC v0.2 §15 · EPIC-015
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE UMA IMAGEM NÃO É ENFEITE NUMA LISTA DE PEÇAS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- "Filtro HEPA FIL-HEPA-01" e "Filtro HEPA FIL-HEPA-02" são duas linhas de
-- texto quase idênticas. Quem está no almoxarifado está com a peça NA MÃO,
-- comparando com a tela — e uma lista puramente textual transforma essa
-- conferência de um segundo numa leitura de código caractere por caractere.
--
-- É também o que separa um catálogo de peças de uma planilha com bordas.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DUAS COLUNAS, E A SEGUNDA É A QUE FAZ A PRIMEIRA FUNCIONAR
-- ─────────────────────────────────────────────────────────────────────────────
--
--  · `image_key` é ONDE a imagem está. Um caminho, não os bytes: foto em
--    coluna de banco é backup que ninguém consegue restaurar, e é a mesma
--    decisão já tomada para os anexos (§28, a porta `ArmazenamentoDeObjetos`).
--
--  · `category` é o que dá à lista um eixo além do nome. Ela serve a três
--    coisas ao mesmo tempo: filtrar ("mostre só consumíveis"), agrupar, e
--    ESCOLHER A ILUSTRAÇÃO quando não houver foto — um item sem imagem em
--    "bateria" pode mostrar o desenho genérico de bateria em vez de um
--    retângulo cinza.
--
-- A categoria é TEXTO LIVRE, e isso é deliberado. `catalog_items` existe para
-- taxonomia governada (ADR-028) e seria o lugar certo se a organização
-- precisasse curar esta lista — mas categoria de peça é vocabulário de
-- almoxarifado, muda por cliente, e exigir cadastro prévio faria toda
-- importação de planilha parar na primeira linha com uma categoria nova.
-- Quando alguém pedir curadoria, vira FK; até lá, promover a tabela é custo
-- sem consumidor.
-- =============================================================================

ALTER TABLE aurora.inventory_items
  ADD COLUMN IF NOT EXISTS image_key text,
  ADD COLUMN IF NOT EXISTS category  text;

/*
 * A restrição existe para impedir a classe de erro mais provável aqui: alguém
 * gravar uma URL inteira ("https://fornecedor.com/foto.jpg") no lugar de uma
 * chave.
 *
 * Isso pareceria funcionar na tela de quem testou — e seria um endereço
 * externo, fora do nosso controle, que some quando o fornecedor reorganiza o
 * site, e que entrega a cada carregamento o endereço IP de quem abriu a tela
 * para um terceiro. Uma imagem de catálogo não vale um vazamento de tráfego.
 */
ALTER TABLE aurora.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_image_key_relativa;
ALTER TABLE aurora.inventory_items
  ADD CONSTRAINT inventory_items_image_key_relativa CHECK (
    image_key IS NULL
    OR (image_key !~ '^[a-zA-Z]+://' AND image_key !~ '^//' AND length(btrim(image_key)) > 0)
  );

ALTER TABLE aurora.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_category_nao_vazia;
ALTER TABLE aurora.inventory_items
  ADD CONSTRAINT inventory_items_category_nao_vazia CHECK (
    category IS NULL OR length(btrim(category)) > 0
  );

-- "quais categorias existem nesta organização?" é a consulta que monta o
-- filtro da tela, e ela roda a cada abertura.
CREATE INDEX IF NOT EXISTS inventory_items_category_idx
  ON aurora.inventory_items (organization_id, category)
  WHERE category IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN aurora.inventory_items.image_key IS
  'Caminho RELATIVO da imagem do item. Nunca uma URL absoluta — ver a restrição.';
COMMENT ON COLUMN aurora.inventory_items.category IS
  'Categoria de almoxarifado, texto livre. Filtra, agrupa e escolhe a ilustração de fallback.';
