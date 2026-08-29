/**
 * Aurora — o catálogo de trabalhos periódicos (SPEC v0.2 §31 · ADR-017).
 *
 * Cada entrada declara O QUE roda, COM QUE FREQUÊNCIA e SOB QUAL ESCOPO. O
 * runtime (pg-boss) não sabe nada de manutenção; este arquivo não sabe nada de
 * fila. A separação é o que permite testar a regra sem subir infraestrutura e
 * trocar a infraestrutura sem reescrever a regra.
 *
 * DOIS ESCOPOS, E A DIFERENÇA IMPORTA
 *
 *   · `tenant` — roda uma vez POR ORGANIZAÇÃO, dentro de `withTenant`, sujeito
 *     à RLS como qualquer requisição. Um cliente com dez mil OS atrasadas não
 *     atrasa a varredura dos outros, e uma falha isolada é a falha DAQUELE
 *     cliente: retentativa e carta morta são por organização.
 *
 *   · `platform` — roda uma vez, atravessando organizações de propósito. Hoje
 *     só o publicador do outbox, que usa `aurora_publisher` — papel que lê
 *     evento de todo mundo e não escreve dado de negócio nenhum.
 *
 * A frequência é `cron` de cinco campos, no fuso da instância. Nenhum destes
 * trabalhos é sensível a minuto exato: são varreduras que reconciliam estado, e
 * uma passada perdida é recuperada na próxima — o que é diferente de uma
 * passada PERDIDA SEM AVISO, que é o que a carta morta existe para impedir.
 */
import type { TenantSession } from '@aurora/db';
import {
  sweepPlans,
  sweepSlaClocks,
  sweepExpiredQuotes,
  sweepContractAlerts,
  sweepDocumentExpiry,
} from '@aurora/db';

/** O que um trabalho devolve: números para o registro, nunca a linha inteira. */
export type JobOutcome = Record<string, number>;

export interface TenantJob {
  readonly name: string;
  readonly scope: 'tenant';
  readonly cron: string;
  readonly description: string;
  /**
   * O `now` vem do enfileiramento, não do relógio de dentro do handler.
   *
   * Uma retentativa três horas depois precisa medir a MESMA janela da primeira
   * tentativa — senão "vencido há 30 dias" muda de significado entre a
   * tentativa que falhou e a que deu certo, e o alerta sai com número diferente
   * do que teria saído.
   */
  run(session: TenantSession, now: Date): Promise<JobOutcome>;
}

export interface PlatformJob {
  readonly name: string;
  readonly scope: 'platform';
  readonly cron: string;
  readonly description: string;
}

export type JobDefinition = TenantJob | PlatformJob;

/** O período de medição de contrato no formato `AAAA-MM`. */
function periodoDe(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A data no formato `AAAA-MM-DD`. */
function dataDe(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export const TENANT_JOBS: readonly TenantJob[] = Object.freeze([
  {
    name: 'aurora.sla.sweep',
    scope: 'tenant',
    // De cinco em cinco minutos: o SLA é medido em minutos e um aviso que
    // chega meia hora depois do prazo não é aviso, é constatação.
    cron: '*/5 * * * *',
    description: 'Avisa SLA prestes a estourar e marca o que estourou',
    async run(session, now) {
      const r = await sweepSlaClocks(session, now);
      return { warned: r.warned, breached: r.breached };
    },
  },
  {
    name: 'aurora.plans.sweep',
    scope: 'tenant',
    // Uma vez por hora. Plano preventivo tem folga de dias; varrer a cada
    // minuto só gastaria banco para descobrir que nada mudou.
    cron: '7 * * * *',
    description: 'Abre os ciclos vencidos dos planos preventivos e gera as OS',
    async run(session, now) {
      const r = await sweepPlans(session, now);
      return { cyclesOpened: r.cyclesOpened, workOrders: r.workOrders };
    },
  },
  {
    name: 'aurora.quotes.expire',
    scope: 'tenant',
    // Uma vez por dia, de madrugada: a validade do orçamento é em dias.
    cron: '13 3 * * *',
    description: 'Marca como expirado o orçamento cuja validade passou',
    async run(session, now) {
      return { expired: await sweepExpiredQuotes(session, dataDe(now)) };
    },
  },
  {
    name: 'aurora.contracts.alerts',
    scope: 'tenant',
    cron: '23 3 * * *',
    description: 'Expira contrato vencido e avisa o que está por vencer',
    async run(session, now) {
      const alertas = await sweepContractAlerts(session, dataDe(now), periodoDe(now));
      return { alerts: alertas.length };
    },
  },
  {
    name: 'aurora.documents.expiry',
    scope: 'tenant',
    cron: '33 3 * * *',
    description: 'Avisa documento com validade próxima do fim',
    async run(session, now) {
      const alertas = await sweepDocumentExpiry(session, now);
      return { alerts: alertas.length };
    },
  },
]);

export const PLATFORM_JOBS: readonly PlatformJob[] = Object.freeze([
  {
    name: 'aurora.outbox.publish',
    scope: 'platform',
    // A cada minuto, e o publicador roda em laço enquanto o lote vier cheio:
    // o cron é a rede de segurança, não o mecanismo de vazão.
    cron: '* * * * *',
    description: 'Entrega os eventos de domínio ainda não publicados',
  },
]);

export const ALL_JOBS: readonly JobDefinition[] = Object.freeze([...TENANT_JOBS, ...PLATFORM_JOBS]);

export function findJob(name: string): JobDefinition | undefined {
  return ALL_JOBS.find((j) => j.name === name);
}

/**
 * O QUE AINDA NÃO TEM TRABALHO AGENDADO, e por quê.
 *
 * Está escrito aqui, e não só no PROGRESS, porque quem for acrescentar um
 * trabalho lê este arquivo — e a pergunta "cadê o digest?" tem de ter resposta
 * no lugar em que ela é feita.
 *
 *   · **digest de notificações** — a entrega já é marcada como `digested` pelo
 *     roteador, mas não existe função de domínio que AGRUPE as pendentes e
 *     emita o resumo. A §26 diz "resumo diário ou semanal" e não diz a que
 *     hora; escolher a hora aqui seria inventar requisito. Falta a função,
 *     não o agendamento.
 *
 *   · **automação com gatilho de agenda** — o §29 prevê regra do tipo
 *     `schedule` ("toda segunda 07:00"), mas o motor de automação hoje só
 *     responde a EVENTO (`runAutomations` recebe um evento de entrada). Não há
 *     onde o agendador pendurar a regra periódica.
 */
export const JOBS_SEM_FUNCAO_DE_DOMINIO = Object.freeze([
  'digest de notificações (§26)',
  'automação com gatilho de agenda (§29)',
]);
