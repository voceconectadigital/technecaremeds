/**
 * Aurora — os dados do Painel de Controle e do Modo Exibição.
 *
 * As duas telas leem a MESMA resposta (`GET /insights/control-panel`), com os
 * mesmos filtros vindos da URL — é isso que faz o botão "Modo Exibição" abrir
 * na televisão exatamente o recorte que estava na tela.
 *
 * Nenhum número é montado aqui: o que a tela desenha é o que o servidor
 * calculou, com definição e cobertura, já recortado pelo escopo de quem
 * pergunta. Na versão conectada não há fixture de reserva — se a API falhar,
 * a tela diz que falhou.
 */
import { useMemo } from 'react';
import { insightControlPanel, type ControlPanel } from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { intervaloDe, type Periodo } from './rotulos';

/** O maior período que a API de indicadores aceita. */
export const MAX_DIAS = 400;

export interface FiltrosDoPainel {
  periodo: Periodo;
  /** Só com `periodo = 'custom'`: datas civis AAAA-MM-DD. */
  de: string;
  ate: string;
  cliente: string;
  setor: string;
  setPeriodo: (p: Periodo) => void;
  setDe: (d: string) => void;
  setAte: (d: string) => void;
  setCliente: (c: string) => void;
  setSetor: (s: string) => void;
}

export function useFiltrosDoPainel(): FiltrosDoPainel {
  const [periodo, setPeriodo] = useUrlState<Periodo>('periodo', '30d');
  const [de, setDe] = useUrlState<string>('de', '');
  const [ate, setAte] = useUrlState<string>('ate', '');
  const [cliente, setClienteBruto] = useUrlState<string>('cliente', '');
  const [setor, setSetor] = useUrlState<string>('setor', '');
  return {
    periodo,
    de,
    ate,
    cliente,
    setor,
    setPeriodo,
    setDe,
    setAte,
    setCliente: (c) => {
      // Trocar o cliente invalida o setor escolhido: setor é sempre DE um cliente.
      setClienteBruto(c);
      setSetor('');
    },
    setSetor,
  };
}

type Recorte = Pick<FiltrosDoPainel, 'periodo' | 'de' | 'ate' | 'cliente' | 'setor'>;

/** Os parâmetros da URL do painel, para levar o mesmo recorte a outra tela (a TV). */
export function buscaDoPainel(f: Recorte) {
  return {
    ...(f.periodo !== '30d' ? { periodo: f.periodo } : {}),
    ...(f.periodo === 'custom' && f.de ? { de: f.de } : {}),
    ...(f.periodo === 'custom' && f.ate ? { ate: f.ate } : {}),
    ...(f.cliente ? { cliente: f.cliente } : {}),
    ...(f.setor ? { setor: f.setor } : {}),
  };
}

/**
 * O intervalo pedido, ou o motivo de não haver um. Período personalizado
 * incompleto, invertido ou maior que a API aceita NÃO vira consulta: vira
 * mensagem na tela.
 */
export function intervaloDoPainel(
  f: Pick<FiltrosDoPainel, 'periodo' | 'de' | 'ate'>
): { from: string; to: string; problema: null } | { problema: string } {
  if (f.periodo !== 'custom') {
    const i = intervaloDe(f.periodo);
    return { from: i.from, to: i.to, problema: null };
  }
  if (!f.de || !f.ate) return { problema: 'Escolha a data inicial e a final do período.' };
  if (f.ate < f.de) return { problema: 'A data final vem antes da inicial.' };
  const dias = (Date.parse(`${f.ate}T00:00:00Z`) - Date.parse(`${f.de}T00:00:00Z`)) / 86_400_000 + 1;
  if (dias > MAX_DIAS) return { problema: `O período personalizado vai até ${MAX_DIAS} dias.` };
  return { from: `${f.de}T00:00:00.000Z`, to: `${f.ate}T23:59:59.999Z`, problema: null };
}

/** Atualização periódica: a televisão do corredor não tem quem aperte F5. */
export function usePainel(f: Recorte, opts: { refetchMs?: number } = {}) {
  // O intervalo muda uma vez por DIA (pela chave), não a cada render nem a
  // cada atualização: senão a chave da consulta mudaria sem parar e a TV
  // piscaria o esqueleto a cada minuto.
  const hoje = new Date().toISOString().slice(0, 10);
  const { periodo, de, ate } = f;
  const intervalo = useMemo(() => intervaloDoPainel({ periodo, de, ate }), [periodo, de, ate, hoje]);
  const consulta = useApiQuery(
    insightControlPanel,
    {
      query: {
        from: intervalo.problema === null ? intervalo.from : '',
        to: intervalo.problema === null ? intervalo.to : '',
        ...(f.cliente ? { customerId: f.cliente } : {}),
        ...(f.setor ? { sectorId: f.setor } : {}),
      },
    },
    {
      refetchInterval: opts.refetchMs ?? false,
      staleTime: 30_000,
      enabled: intervalo.problema === null,
    }
  ) as {
    data: ControlPanel | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    dataUpdatedAt: number;
  };
  return { ...consulta, problema: intervalo.problema };
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

/**
 * Situação cadastrada → disponível ou não, para a fotografia do parque.
 *
 * NÃO é disponibilidade no tempo (tempo parado ÷ tempo total): essa depende
 * de uma definição do cliente que não existe. É a contagem de AGORA:
 * disponível = em operação ou reserva; indisponível = em manutenção;
 * emprestado fica à parte; baixado e descartado saem da base.
 */
export function disponibilidadeAgora(byStatus: Record<string, number>) {
  const disponiveis = (byStatus.active ?? 0) + (byStatus.standby ?? 0);
  const indisponiveis = byStatus.under_maintenance ?? 0;
  const emprestados = byStatus.loaned ?? 0;
  const base = disponiveis + indisponiveis + emprestados;
  return {
    disponiveis,
    indisponiveis,
    emprestados,
    base,
    taxa: base > 0 ? Number(((disponiveis / base) * 100).toFixed(1)) : null,
  };
}
