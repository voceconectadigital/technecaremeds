/**
 * Aurora — rótulos e formatos do Painel de Controle e dos planos.
 *
 * Um lugar só para "o que a chave quer dizer em português", usado pelo
 * painel, pelo Modo Exibição e pelo módulo de planos — três telas que
 * divergiriam no primeiro rótulo se cada uma tivesse o seu.
 */
import type { Tone } from '@aurora/ui';
import { diaLocal, fimDoDiaLocal, inicioDoDiaLocal, somarDias } from '@aurora/app-kit';

export const ROTULO_SITUACAO_OS: Record<string, string> = {
  draft: 'Rascunho',
  open: 'Aberta',
  scheduled: 'Agendada',
  in_progress: 'Em execução',
  waiting: 'Aguardando',
  review: 'Em revisão',
  done: 'Concluída',
  closed: 'Encerrada',
  cancelled: 'Cancelada',
};

export const ROTULO_PRIORIDADE: Record<string, string> = {
  emergency: 'Emergência',
  very_urgent: 'Muito urgente',
  urgent: 'Urgente',
  low: 'Baixa',
  none: 'Sem prioridade',
};

export const ROTULO_STATUS_ATIVO: Record<string, string> = {
  active: 'Em operação',
  under_maintenance: 'Em manutenção',
  standby: 'Reserva',
  loaned: 'Emprestado',
  decommissioned: 'Baixado',
  disposed: 'Descartado',
};

/** Estado de cadastro do ativo como TOM: é estado, não série. */
export const TOM_STATUS_ATIVO: Record<string, Tone> = {
  active: 'good',
  under_maintenance: 'warn',
  standby: 'info',
  loaned: 'accent',
  decommissioned: 'neutral',
  disposed: 'neutral',
};

/**
 * Tipo de plano/procedimento. A chave vem do domínio: `procedure_kind` do
 * checklist (calibration, electrical_safety, qualification, acceptance) ou a
 * natureza da OS (preventive, inspection, …).
 */
export const ROTULO_TIPO_PLANO: Record<string, string> = {
  preventive: 'Preventiva',
  calibration: 'Calibração',
  electrical_safety: 'TSE · Segurança elétrica',
  qualification: 'Qualificação',
  acceptance: 'Aceite',
  inspection: 'Inspeção',
  corrective: 'Corretiva',
  installation: 'Instalação',
  other: 'Outro',
};

export function rotuloTipo(k: string | null | undefined): string {
  if (!k) return 'Preventiva';
  return ROTULO_TIPO_PLANO[k] ?? k;
}

export const ROTULO_ESTADO_ITEM: Record<string, string> = {
  done: 'Realizado',
  pending: 'Pendente',
  late: 'Vencido',
  skipped: 'Dispensado',
  planned: 'Previsto',
};

export const TOM_ESTADO_ITEM: Record<string, Tone> = {
  done: 'good',
  pending: 'info',
  late: 'bad',
  skipped: 'neutral',
  planned: 'accent',
};

/* -------------------------------------------------------------------------- */

/** Minutos → "3,2 h" ou "2,1 d". Nulo vira nulo (traço na tela, nunca zero). */
export function formatarDuracao(min: number | null | undefined): { valor: string | null; unidade: string } {
  if (min === null || min === undefined) return { valor: null, unidade: '' };
  if (min < 60) return { valor: String(Math.round(min)), unidade: 'min' };
  const h = min / 60;
  if (h < 48) return { valor: h.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), unidade: 'h' };
  return { valor: (h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 }), unidade: 'd' };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Rótulo curto de uma fatia do período, conforme a granularidade. A fatia
 * começa na meia-noite LOCAL (o período é pedido em dias locais), então o
 * rótulo também é lido no calendário local.
 */
export function rotuloDaFatia(iso: string, granularidade: 'day' | 'week' | 'month'): string {
  const d = new Date(iso);
  if (granularidade === 'month') return `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-05" → "mai/26". */
export function rotuloDoMes(chave: string): string {
  const [a, m] = chave.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${(a ?? '').slice(2)}`;
}

export function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/* -------------------------------------------------------------------------- */
/* período                                                                     */
/* -------------------------------------------------------------------------- */

export const PERIODOS = [
  { valor: '7d', rotulo: '7 dias', dias: 7 },
  { valor: '30d', rotulo: '30 dias', dias: 30 },
  { valor: '90d', rotulo: '90 dias', dias: 90 },
  { valor: '12m', rotulo: '12 meses', dias: 365 },
] as const;
/** Os atalhos, mais o período personalizado (`de`/`ate` na URL). */
export type Periodo = (typeof PERIODOS)[number]['valor'] | 'custom';

/**
 * O intervalo do preset: os últimos N dias INTEIROS do calendário local,
 * terminando no fim de HOJE. Era em UTC — em Brasília, depois das 21 h, "hoje"
 * já era amanhã e o primeiro dia começava às 21 h da véspera (pente-fino
 * 17/10/2026, PF-51/PF-72). Começa à meia-noite local para a fatia diária cair
 * em dia inteiro.
 */
export function intervaloDe(p: string, agora: Date = new Date()): { from: string; to: string; dias: number } {
  const def = PERIODOS.find((x) => x.valor === p) ?? PERIODOS[1];
  const hoje = diaLocal(agora);
  const fim = fimDoDiaLocal(hoje);
  const ini = inicioDoDiaLocal(somarDias(hoje, 1 - def.dias));
  return { from: ini.toISOString(), to: fim.toISOString(), dias: def.dias };
}

/* -------------------------------------------------------------------------- */
/* avaliação das OS (REL-14)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * O cartão "Avaliação das OS" do Painel: média de 1 a 5 (uma nota por OS, assinada pelo
 * solicitante), quantas avaliações e o período. Sem avaliação, o valor é nulo — nunca zero.
 */
export function cartaoDaAvaliacao(
  r: { average: number | null; count: number } | undefined,
  periodo: { from: string; to: string } | undefined
): { valor: string | null; dica: string; vazio: string } {
  const quando = periodo
    ? `${dataCurta(periodo.from)} a ${dataCurta(new Date(new Date(periodo.to).getTime() - 1).toISOString())}`
    : 'no período';
  const media = r?.average ?? null;
  return {
    valor:
      media === null
        ? null
        : media.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
    dica: `${r?.count ?? 0} ${r?.count === 1 ? 'avaliação' : 'avaliações'} · ${quando}`,
    vazio: `Nenhuma OS avaliada · ${quando}`,
  };
}
