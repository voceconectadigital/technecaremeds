/**
 * Téchne Care — captura das respostas da DEMONSTRAÇÃO PÚBLICA.
 *
 *   npm run demo:capturar
 *
 * Sobe a API de verdade em processo, sobre um PGlite em memória semeado com a
 * massa fictícia de `semeadura.ts`, faz as MESMAS leituras que as telas fazem,
 * e grava as respostas em `apps/web/src/demo/capturas.json`.
 *
 * Nada aqui toca rede, Supabase ou banco remoto: o banco nasce e morre dentro
 * deste processo. É um arquivo de teste só porque o Vitest já sabe compilar os
 * decoradores do NestJS e resolver os pacotes do monorepo pela fonte — e por
 * isso ele mora fora de `apps/` e `packages/`, onde o `npm test` não o encontra.
 */
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createTestDatabase } from '@aurora/db/testing/harness';
import { loadEnv } from '@aurora/config';
import * as C from '@aurora/contracts';
import type { OperationDefinition } from '@aurora/contracts';
import { createApp } from '../../apps/api/src/bootstrap';
import { semearDemonstracao, DEMO } from './semeadura';

const DESTINO = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/src/demo/capturas.json');

type Q = Record<string, unknown>;
interface Captura {
  op: string;
  params: Q | null;
  query: Q | null;
  body: unknown;
}

/*
 * OS DIAS SÃO OS DE BRASÍLIA, e não os de UTC.
 *
 * A primeira versão pedia os períodos com `T00:00:00.000Z`: as fatias do
 * Painel começavam à meia-noite UTC, 21h do dia anterior em Brasília, e o
 * gráfico da demonstração rotulava cada dia com a data de ontem. A tela de
 * verdade pede o período com a meia-noite LOCAL (`intervaloDe` em
 * apps/web/src/features/painel/rotulos.ts, `inicioDoDiaLocal` no app-kit), e a
 * captura passa a pedir o mesmo — no fuso da organização de demonstração
 * (`America/Sao_Paulo`, o padrão), e não no da máquina que roda a captura.
 *
 * Fuso fixo de −03:00, como a semeadura: Brasília não tem horário de verão
 * desde 2019.
 */
const BRASILIA_MS = -3 * 3_600_000;
const doisDigitos = (n: number) => String(n).padStart(2, '0');
const dia = (deslocamento: number) => {
  const b = new Date(Date.now() + BRASILIA_MS);
  const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + deslocamento));
  return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
};
/** Meia-noite de Brasília do dia (AAAA-MM-DD), em ISO UTC. */
const inicioDoDia = (d: string) => new Date(`${d}T00:00:00.000-03:00`).toISOString();
/** Último milissegundo do dia (AAAA-MM-DD) em Brasília, em ISO UTC. */
const fimDoDia = (d: string) => new Date(`${d}T23:59:59.999-03:00`).toISOString();
/** "Últimos 30 dias" como a tela pede: hoje e os 29 anteriores, de Brasília. */
const ULTIMOS_30 = { from: inicioDoDia(dia(-29)), to: fimDoDia(dia(0)) };

it('captura as respostas da demonstração', async () => {
  const t = await createTestDatabase();
  await semearDemonstracao(t);

  const env = loadEnv({
    DATABASE_URL: 'postgresql://demo:demo@localhost:5432/demo',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
    AURORA_AUTH_PROVIDER: 'local',
  } as NodeJS.ProcessEnv);
  const app = await createApp({ db: t.db, env });
  await app.init();
  const http = request(app.getHttpServer());

  const capturas: Captura[] = [];
  const recusas: string[] = [];

  async function ler<T = Record<string, unknown>>(
    op: OperationDefinition,
    params: Q | null = null,
    query: Q | null = null
  ): Promise<T | undefined> {
    let caminho = op.path;
    for (const [k, v] of Object.entries(params ?? {})) caminho = caminho.replace(`:${k}`, String(v));
    const r = await http
      .get(`/v1${caminho}`)
      .query((query ?? {}) as Record<string, string>)
      .set('authorization', `Bearer local:${DEMO.email}:${DEMO.email}`)
      .set('x-aurora-organization', DEMO.org);
    if (r.status !== 200) {
      recusas.push(`${op.operationId} ${caminho} → ${r.status} ${r.body?.message ?? ''}`);
      return undefined;
    }
    // A resposta precisa caber no contrato: é o mesmo esquema que o cliente
    // de verdade usa para validar.
    let conferido = op.response.safeParse(r.body);
    if (!conferido.success) {
      /*
       * O PGlite devolve `numeric`/`bigint` como número; o driver `pg`, contra
       * o Postgres de verdade, devolve como texto — e o contrato descreve o
       * Postgres de verdade. A captura grava o que a API de produção mandaria.
       */
      for (const problema of conferido.error.issues) {
        if (problema.code !== 'invalid_type' || problema.expected !== 'string') continue;
        let alvo = r.body as Record<string | number, unknown>;
        for (const passo of problema.path.slice(0, -1)) alvo = alvo[passo as string] as typeof alvo;
        const campo = problema.path.at(-1) as string;
        if (typeof alvo?.[campo] === 'number') alvo[campo] = String(alvo[campo]);
      }
      conferido = op.response.safeParse(r.body);
    }
    if (!conferido.success) recusas.push(`${op.operationId} fora do contrato: ${conferido.error.message}`);
    capturas.push({ op: op.operationId, params, query, body: r.body });
    return r.body as T;
  }

  type ComId = { items: Array<{ id: string } & Q> };

  /* ------------------------------------------------------------ sessão */
  await ler(C.meSession);
  await ler(C.meOrganizations);

  /* ------------------------------------------------------------ ordens */
  await ler(C.workOrdersBoard);
  await ler(C.workOrderWaitReasons);
  const ordens = await ler<ComId>(C.workOrdersList, null, { limit: 500 });
  for (const o of ordens?.items ?? []) {
    const p = { id: o.id };
    await ler(C.workOrderDetail, p);
    await ler(C.workOrderTimeEntries, p);
    await ler(C.workOrderParts, p);
    await ler(C.workOrderAttachments, p);
    await ler(C.workOrderComments, p);
    // Assistente ▶ Executar (16/10/2026).
    await ler(C.workOrderVisits, p);
    await ler(C.workOrderCustomerParts, p);
    await ler(C.workOrderChecklists, p);
    await ler(C.workOrderCompletion, p);
  }

  /* ------------------------------------------------------ solicitações */
  const chamados = await ler<ComId>(C.requestsQueue, null, { limit: 200 });
  for (const c of chamados?.items ?? []) await ler(C.requestDetail, { id: c.id });
  await ler(C.customersList);
  for (const k of C.CATALOG_KEYS) await ler(C.catalogItems, { catalog: k });

  /* ----------------------------------------------------------- agenda */
  await ler(C.scheduleBuckets);
  await ler(C.scheduleResources, null, {});

  /* ----------------------------------------------------------- ativos */
  await ler(C.locationsList, null, {});
  const ativos = await ler<ComId>(C.assetsList, null, { limit: 500 });
  for (const a of ativos?.items ?? []) {
    await ler(C.assetDetail, { id: a.id });
    await ler(C.workOrdersList, null, { asset: a.id, limit: 50 });
  }

  /* ---------------------------------------------------------- estoque */
  const saldos = await ler<{ items: Array<{ item_id: string; warehouse_id: string }> }>(
    C.inventoryBalances,
    null,
    {}
  );
  await ler(C.inventoryBalances, null, { below_minimum: 'true' });
  for (const s of saldos?.items ?? []) {
    await ler(C.inventoryLedger, null, { item: s.item_id, warehouse: s.warehouse_id, limit: 50 });
  }

  // Gestão de estoque e Store (16/10/2026). A demonstração ignora from/to.
  await ler(C.inventoryItemsList);
  await ler(C.inventoryWarehouses);
  await ler(C.inventoryValuation);
  await ler(C.inventoryAbc, null, ULTIMOS_30);
  await ler(C.inventoryPeriodReport, null, ULTIMOS_30);
  await ler(C.storeItemsList);

  /* -------------------------------------------------------- comercial */
  const contratos = await ler<ComId>(C.contractsList, null, {});
  for (const c of contratos?.items ?? []) {
    await ler(C.contractDetail, { id: c.id });
    await ler(C.contractAssets, { id: c.id });
  }
  const orcamentos = await ler<ComId>(C.quotesList, null, {});
  for (const q of orcamentos?.items ?? []) {
    await ler(C.quoteDetail, { id: q.id });
    await ler(C.quoteVersions, { id: q.id });
  }

  /* ------------------------------------------------------ indicadores */
  const periodo = ULTIMOS_30;
  for (const op of [
    C.insightWorkOrdersOpened,
    C.insightWorkOrdersCompleted,
    C.insightMttr,
    C.insightFirstResponse,
    C.insightSla,
    C.insightPreventiveVsCorrective,
    C.insightPlanCompliance,
    C.insightTimeByWaitReason,
  ]) {
    await ler(op, null, periodo);
  }
  await ler(C.insightBacklog, null, { to: periodo.to });
  await ler(C.reportsCatalog);
  await ler(C.indicatorTargetsList);

  /* ------------------------------------------- Painel de Controle e TV */
  // A demonstração ignora from/to ao escolher a captura (PAGINACAO): uma por
  // recorte de cliente e de setor basta para os filtros da tela responderem.
  const painel = await ler<{
    customers: Array<{ id: string }>;
    sectors: Array<{ id: string; customer_id: string }>;
  }>(C.insightControlPanel, null, periodo);
  for (const c of painel?.customers ?? []) {
    await ler(C.insightControlPanel, null, { ...periodo, customerId: c.id });
  }
  for (const s of painel?.sectors ?? []) {
    await ler(C.insightControlPanel, null, { ...periodo, customerId: s.customer_id, sectorId: s.id });
  }

  /* ------------------------------------ clientes, setores e equipamentos */
  const clientesDemo = await ler<ComId>(C.customersList);
  for (const c of clientesDemo?.items ?? []) {
    await ler(C.customersDetail, { id: c.id });
    await ler(C.assetsList, null, { customer: c.id, limit: 500 });
    await ler(C.contractsList, null, { customerId: c.id });
  }
  await ler(C.assetsFormOptions);
  await ler(C.locationTypesList);

  /* --------------------------------- planos: painel, cronograma, checklist */
  const ano = Number(dia(0).slice(0, 4));
  const anoInicio = inicioDoDia(`${ano}-01-01`);
  const anoFim = inicioDoDia(`${ano + 1}-01-01`);
  await ler(C.plansFormOptions);
  await ler(C.plansBoard, null, { from: anoInicio, to: anoFim });
  await ler(C.plansSchedule, null, { from: inicioDoDia(dia(-30)), to: inicioDoDia(dia(91)) });
  for (const c of clientesDemo?.items ?? []) {
    await ler(C.plansBoard, null, { from: anoInicio, to: anoFim, customer: c.id });
    await ler(C.plansSchedule, null, {
      from: inicioDoDia(dia(-30)),
      to: inicioDoDia(dia(91)),
      customer: c.id,
    });
    await ler(C.plansList, null, { customer: c.id });
  }
  const modelos = await ler<ComId>(C.checklistTemplatesList);
  for (const m of modelos?.items ?? []) await ler(C.checklistTemplatesDetail, { id: m.id });

  /* ------------------------------------------------- planos e outros */
  const planos = await ler<ComId>(C.plansList);
  for (const p of planos?.items ?? []) {
    const d = await ler<{ tasks: Array<{ open_cycle_id: string | null }> }>(C.planDetail, { id: p.id });
    for (const tarefa of d?.tasks ?? []) {
      if (tarefa.open_cycle_id) await ler(C.cycleCompliance, { cycleId: tarefa.open_cycle_id });
    }
  }
  await ler(C.documentsList, null, {});
  await ler(C.documentsList, null, { expiring_within_days: 60 });
  await ler(C.notificationsInbox, null, { limit: 100 });
  await ler(C.notificationTypes);

  /* ----------------------------------------------------- configurações */
  const membros = await ler<{ items: Array<{ membership_id: string }> }>(C.membersList);
  for (const m of membros?.items ?? []) await ler(C.membershipPermissions, { id: m.membership_id });
  await ler(C.permissionCatalog);
  await ler(C.rolesList);
  const regras = await ler<ComId>(C.automationsList);
  for (const r of regras?.items ?? []) await ler(C.automationRuns, { id: r.id }, { limit: 50 });
  // Automações agendadas, tarefas e Novo Negócio (16/10/2026).
  await ler(C.automationVocabulary);
  await ler(C.automationTasksList, null, {});
  await ler(C.platformMe);
  // Configurações → Organização (PF-41): a exigência do parecer, desligada.
  await ler(C.organizationsCurrent);

  await app.close();
  await t.close();

  writeFileSync(
    DESTINO,
    JSON.stringify({ capturedAt: new Date().toISOString(), capturas }, null, 0) + '\n',
    'utf8'
  );

  if (recusas.length) console.warn('\nleituras recusadas:\n  ' + recusas.join('\n  '));
  console.log(`\n${capturas.length} respostas gravadas em ${DESTINO}`);
  expect(capturas.length).toBeGreaterThan(50);
}, 600_000);
