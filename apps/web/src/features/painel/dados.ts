/**
 * Aurora — os dados do Painel de Controle e do Modo Exibição.
 *
 * As duas telas leem a MESMA resposta (`GET /insights/control-panel`), com os
 * mesmos filtros vindos da URL — é isso que faz o botão "Modo Exibição" abrir
 * na televisão exatamente o recorte que estava na tela.
 *
 * Nenhum número é montado aqui: o que a tela desenha é o que o servidor
 * calculou, com definição e cobertura. Na versão conectada não há fixture de
 * reserva — se a API falhar, a tela diz que falhou.
 */
import { useMemo } from 'react';
import { insightControlPanel, type ControlPanel } from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { intervaloDe, type Periodo } from './rotulos';

export interface FiltrosDoPainel {
  periodo: Periodo;
  cliente: string;
  setor: string;
  setPeriodo: (p: Periodo) => void;
  setCliente: (c: string) => void;
  setSetor: (s: string) => void;
}

export function useFiltrosDoPainel(): FiltrosDoPainel {
  const [periodo, setPeriodo] = useUrlState<Periodo>('periodo', '30d');
  const [cliente, setClienteBruto] = useUrlState<string>('cliente', '');
  const [setor, setSetor] = useUrlState<string>('setor', '');
  return {
    periodo,
    cliente,
    setor,
    setPeriodo,
    setCliente: (c) => {
      // Trocar o cliente invalida o setor escolhido: setor é sempre DE um cliente.
      setClienteBruto(c);
      setSetor('');
    },
    setSetor,
  };
}

/** Atualização periódica: a televisão do corredor não tem quem aperte F5. */
export function usePainel(
  f: Pick<FiltrosDoPainel, 'periodo' | 'cliente' | 'setor'>,
  opts: { refetchMs?: number } = {}
) {
  // O intervalo muda uma vez por DIA (pela chave), não a cada render nem a
  // cada atualização: senão a chave da consulta mudaria sem parar e a TV
  // piscaria o esqueleto a cada minuto.
  const hoje = new Date().toISOString().slice(0, 10);
  const intervalo = useMemo(() => intervaloDe(f.periodo), [f.periodo, hoje]);
  return useApiQuery(
    insightControlPanel,
    {
      query: {
        from: intervalo.from,
        to: intervalo.to,
        ...(f.cliente ? { customerId: f.cliente } : {}),
        ...(f.setor ? { sectorId: f.setor } : {}),
      },
    },
    { refetchInterval: opts.refetchMs ?? false, staleTime: 30_000 }
  ) as {
    data: ControlPanel | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    dataUpdatedAt: number;
    refetch: () => void;
  };
}

export function rotuloDoRecorte(d: ControlPanel | undefined, cliente: string, setor: string): string {
  if (!d) return '';
  const c = cliente ? d.customers.find((x) => x.id === cliente)?.name : null;
  const s = setor ? d.sectors.find((x) => x.id === setor)?.name : null;
  if (c && s) return `${c} · ${s}`;
  if (c) return c;
  if (d.customers.length === 1) return d.customers[0]!.name;
  return `Todos os clientes (${d.customers.length})`;
}
