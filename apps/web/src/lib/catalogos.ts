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
import {
  catalogItems,
  workOrderWaitReasons,
  type CatalogItem,
  type CatalogKey,
  type WaitReason,
} from '@aurora/contracts';
import { useApiQuery } from './api';

/**
 * `CatalogKey` e não `string`: a tela de abrir solicitação pedia
 * `failure_code`, chave que nunca existiu, e o resultado era um seletor
 * permanentemente vazio — porque lista que falha e lista vazia se parecem.
 */
export function useCatalogo(catalogKey: CatalogKey): CatalogItem[] {
  const { data } = useApiQuery(
    catalogItems,
    { params: { catalog: catalogKey } },
    { staleTime: 10 * 60_000 }
  ) as { data: { items: CatalogItem[] } | undefined };

  return data?.items ?? [];
}

/**
 * Motivos de espera.
 *
 * NÃO é catálogo, e por isso não passa por `useCatalogo`: cada motivo carrega
 * `pauses_sla` — se o relógio do prazo continua correndo enquanto a OS espera.
 * É a informação que decide se "aguardando peça" custa SLA ou não, e quem
 * escolhe precisa vê-la na hora de escolher.
 */
export function useMotivosDeEspera(): WaitReason[] {
  const { data } = useApiQuery(workOrderWaitReasons, undefined, {
    staleTime: 10 * 60_000,
  }) as { data: { items: WaitReason[] } | undefined };

  return data?.items ?? [];
}
