/**
 * Aurora — o destino do outbox que entrega cada evento às AUTOMAÇÕES por evento (AUT-07,
 * 29/10/2026).
 *
 * Até aqui o motor (`runAutomations`) existia e era testado, mas nenhum processo o chamava: a
 * regra "OS aguardando peça → avisar compras" ficava ligada e calada. Mover a OS de coluna no
 * quadro é uma transição de situação; a transição grava `work_order.*` no outbox; o publicador
 * entrega o evento aqui; aqui cada regra que o escuta roda — UMA vez.
 *
 * SEM DUPLICAÇÃO. O publicador é "ao menos uma vez": um lote que falha volta. O motor confere
 * (regra, evento) antes de agir e o banco garante com o índice único da 0088.
 *
 * SEM LAÇO. Cada regra roda na sua própria transação, com o `request_id` que diz qual regra e em
 * que profundidade (`automationRequestId`). O que a ação dela emitir — a transição que ela fez —
 * carrega esse `request_id`; ao voltar aqui, o evento é reconhecido como causado por ela, e a
 * regra não reage a si mesma nem a cadeia passa da profundidade máxima (§24, `canReact`).
 *
 * Cada regra em sua transação também isola a falha: a regra que quebra não desfaz a vizinha.
 */
import { buildContext, PERMISSION_KEYS } from '@aurora/domain';
import {
  withTenant,
  runAutomations,
  eventRuleIds,
  automationEventFromOutbox,
  automationRequestId,
  type Database,
  type PendingEvent,
} from '@aurora/db';
import type { EventSink } from './outbox-publisher';

function contextoDeSistema(organizationId: string, requestId: string) {
  return buildContext({
    organizationId,
    actorKind: 'system',
    requestId,
    source: 'job',
    // Como os trabalhos periódicos: age em nome do sistema, dentro de UMA organização (RLS).
    // Cada ação ainda confere a permissão que declara.
    permissions: PERMISSION_KEYS,
  });
}

/** Entrega o evento às regras de evento da organização dele. */
export async function entregarAsAutomacoes(db: Database, evento: PendingEvent): Promise<number> {
  const leitura = contextoDeSistema(evento.organization_id, `automacao-leitura:${evento.id}`);
  const { regras, entrada } = await withTenant(db, leitura, async (s) => ({
    regras: await eventRuleIds(s, evento.type),
    entrada: await automationEventFromOutbox(s, evento.id),
  }));
  if (!entrada || regras.length === 0) return 0;
  let rodadas = 0;
  for (const regra of regras) {
    const ctx = contextoDeSistema(
      evento.organization_id,
      automationRequestId(regra, (entrada.causationDepth ?? 0) + 1)
    );
    const r = await withTenant(db, ctx, (s) => runAutomations(s, entrada, { onlyRuleId: regra }));
    rodadas += r.length;
  }
  return rodadas;
}

export function destinoDasAutomacoes(db: Database): EventSink {
  return {
    name: 'automacoes',
    async deliver(evento) {
      await entregarAsAutomacoes(db, evento);
    },
  };
}

/** Vários destinos em ordem: o evento só conta como entregue quando todos o receberam. */
export function destinosEmSerie(...destinos: EventSink[]): EventSink {
  return {
    name: destinos.map((d) => d.name).join('+'),
    async deliver(evento) {
      for (const d of destinos) await d.deliver(evento);
    },
  };
}
