/**
 * Aurora — leitura de catálogo configurável.
 *
 * Toda organização tem os seus itens: natureza de OS, código de falha, motivo
 * de recusa. A interface NUNCA traz uma lista fixa dessas — a auditoria do
 * sistema de referência registrou o custo de listas fixas: a organização que
 * precisava de "empréstimo de equipamento" acabava usando "outros" e o
 * relatório inteiro perdia sentido.
 *
 * `staleTime` alto porque catálogo muda uma vez por mês, e não uma vez por
 * tela: revalidar a cada abertura de diálogo transformaria uma lista de dez
 * itens numa requisição por clique.
 */
import { catalogItems, type CatalogItem } from '@aurora/contracts';
import { useApiQuery } from './api';

export function useCatalogo(catalogKey: string): CatalogItem[] {
  const { data } = useApiQuery(
    catalogItems,
    { params: { catalog: catalogKey } },
    { staleTime: 10 * 60_000 }
  ) as { data: { items: CatalogItem[] } | undefined };

  return data?.items ?? [];
}
