/**
 * Aurora — rótulos e formatos do Painel de Controle e dos planos.
 *
 * Um lugar só para "o que a chave quer dizer em português", usado pelo
 * painel, pelo Modo Exibição e pelo módulo de planos — três telas que
 * divergiriam no primeiro rótulo se cada uma tivesse o seu.
 */
import type { Tone } from '@aurora/ui';

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

/** Rótulo curto de uma fatia do período, conforme a granularidade. */
export function rotuloDaFatia(iso: string, granularidade: 'day' | 'week' | 'month'): string {
  const d = new Date(iso);
  if (granularidade === 'month') return `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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
export type Periodo = (typeof PERIODOS)[number]['valor'];

/**
 * O intervalo do preset, terminando no fim de HOJE (hora local). Começa à
 * meia-noite UTC do dia inicial para a fatia diária cair em dia inteiro.
 */
export function intervaloDe(p: string): { from: string; to: string; dias: number } {
  const def = PERIODOS.find((x) => x.valor === p) ?? PERIODOS[1];
  const fim = new Date();
  fim.setUTCHours(23, 59, 59, 999);
  const ini = new Date(fim.getTime() - def.dias * 86_400_000 + 1);
  ini.setUTCHours(0, 0, 0, 0);
  return { from: ini.toISOString(), to: fim.toISOString(), dias: def.dias };
}
