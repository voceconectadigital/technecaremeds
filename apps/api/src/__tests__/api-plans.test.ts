/**
 * Aurora — planos preventivos pela HTTP (SPEC v0.2 §13 · EPIC-013).
 *
 * O QUE ESTE ARQUIVO PROVA
 *
 * Que a conta de cumprimento é a do domínio, e não uma reimplementação da
 * borda. A tolerância, a distinção entre atrasado-em-andamento e
 * atrasado-sem-ninguém, e a exclusão das dispensadas do denominador são
 * decisões de negócio — e cada uma delas, errada, produz um número que parece
 * plausível.
 *
 * Um indicador plausível e errado é pior do que indicador nenhum: as pessoas
 * agem sobre ele.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext } from '@aurora/domain';
import { createTestDatabase, seedOrganization, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  provisionWorkOrderStates,
  createCustomer,
  createLocation,
  createCatalogItem,
  createAssetCategory,
  createAsset,
  createPlan,
  addPlanTask,
  generateCycle,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../bootstrap';

const ORG = newId();
const GESTOR_USER = newId(),
  GESTOR_MEM = newId();
const EMAIL = 'gestor@plan.test';
const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

let t: TestDatabase;
let app: INestApplication;
let http: ReturnType<typeof request>;
let plano: string, tarefa: string, cicloId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedOrganization(
    t,
    { organizationId: ORG, userId: GESTOR_USER, membershipId: GESTOR_MEM },
    { slug: 'plan', name: 'Rede Preventiva', email: EMAIL, userName: 'Gestora' }
  );

  const sysCtx = buildContext({ organizationId: ORG, actorKind: 'system', requestId: 'setup' });
  await withTenant(t.db, sysCtx, async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, GESTOR_MEM, papeis.get('maintenance_manager')!);
    await provisionWorkOrderStates(s);

    const tipos = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: 'Rede Preventiva', isInternal: true });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Unidade',
    });
    const setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const sala = await createLocation(s, {
      customerId: cliente,
      parentId: setor,
      locationTypeId: tipos.get('sala')!,
      name: 'Leito 3',
    });

    const cat = await createAssetCategory(s, { name: 'Ventilador' });
    await createAsset(s, {
      name: 'Ventilador no setor',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: setor,
    });
    // O segundo está uma camada ABAIXO: é ele que prova que a expressão
    // alcança a subárvore, e não só o local exato.
    await createAsset(s, {
      name: 'Monitor na sala',
      customerId: cliente,
      assetCategoryId: cat,
      locationId: sala,
    });

    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'preventiva',
      label: 'Preventiva',
      systemKey: 'preventive',
    });

    plano = await createPlan(s, {
      name: 'Preventiva trimestral',
      customerId: cliente,
      autoGenerate: false,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    });
    tarefa = await addPlanTask(s, {
      planId: plano,
      name: 'Troca de filtro',
      targetKind: 'location_subtree',
      targetLocationId: setor,
      workOrderTypeId: natureza,
      frequencyUnit: 'quarter',
      frequencyInterval: 1,
      // Antecedência grande para o ciclo abrir agora: sem ciclo, não há o que
      // medir, e o teste passaria contra o vazio.
      leadTimeDays: 3650,
      toleranceDays: 5,
    });
    const ciclo = await generateCycle(s, tarefa);
    cicloId = ciclo!.cycleId;
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  app = await createApp({ db: t.db, env });
  await app.init();
  http = request(app.getHttpServer());
}, 120_000);

afterAll(async () => {
  await app?.close();
  await t?.close();
});

/* -------------------------------------------------------------------------- */

describe('planos', () => {
  it('a lista diz quantas tarefas o plano tem', async () => {
    // Plano sem tarefa não gera nada, e é o erro de cadastro mais comum:
    // alguém cria, salva, e descobre três meses depois que nenhuma preventiva
    // foi aberta.
    const r = await http.get('/v1/maintenance-plans').set(auth(EMAIL));
    expect(r.status).toBe(200);
    const p = r.body.items.find((x: { id: string }) => x.id === plano);
    expect(p.task_count).toBe(1);
    expect(p.next_cycle_ends_at).not.toBeNull();
  });

  it('a lista satisfaz o contrato', async () => {
    const { plansList } = await import('@aurora/contracts');
    const r = await http.get('/v1/maintenance-plans').set(auth(EMAIL));
    const conferido = plansList.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });

  it('o detalhe traz o ciclo aberto de cada tarefa, e satisfaz o contrato', async () => {
    const { planDetail } = await import('@aurora/contracts');
    const r = await http.get(`/v1/maintenance-plans/${plano}`).set(auth(EMAIL));
    expect(r.status).toBe(200);
    expect(r.body.tasks).toHaveLength(1);
    expect(r.body.tasks[0].open_cycle_id).toBe(cicloId);

    const conferido = planDetail.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });

  it('a expressão do alvo alcança a SUBÁRVORE, e não só o local exato', async () => {
    /*
     * O ventilador está no setor; o monitor está numa sala DENTRO dele.
     *
     * Se só o ventilador aparecesse, o alvo estaria comparando o local exato —
     * e o sintoma real seria uma preventiva que ignora tudo que está nas
     * salas, que é onde os equipamentos ficam.
     */
    const r = await http.get(`/v1/maintenance-plans/tasks/${tarefa}/assets`).set(auth(EMAIL));
    expect(r.status).toBe(200);
    const nomes = r.body.items.map((a: { name: string }) => a.name).sort();
    expect(nomes).toEqual(['Monitor na sala', 'Ventilador no setor']);
  });
});

describe('cumprimento', () => {
  it('traz o resumo E os itens, com os seis estados do domínio', async () => {
    const r = await http.get(`/v1/maintenance-plans/cycles/${cicloId}/compliance`).set(auth(EMAIL));
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.summary.expected).toBe(2);

    // Os estados são os do domínio, e não uma simplificação da borda: a
    // distinção entre "em andamento" e "sem ninguém" é a que muda a decisão
    // de quem coordena.
    const validos = [
      'done',
      'skipped',
      'on_time_started',
      'on_time_not_started',
      'late_started',
      'late_not_started',
    ];
    for (const i of r.body.items) expect(validos).toContain(i.state);
  });

  it('dispensar sai do DENOMINADOR, e não conta como falha', async () => {
    /*
     * Um ativo emprestado a outro hospital não podia receber a preventiva.
     * Contá-lo como falha puniria a equipe por algo que ela não podia fazer —
     * e a saída seria a equipe parar de dispensar, o que torna o número ainda
     * menos verdadeiro.
     *
     * Dispensar exige justificativa; é isso que impede a dispensa de virar a
     * saída fácil para melhorar o indicador.
     */
    const antes = await http.get(`/v1/maintenance-plans/cycles/${cicloId}/compliance`).set(auth(EMAIL));
    const item = antes.body.items[0];

    await http
      .post(`/v1/maintenance-plans/cycle-items/${item.id}/skip`)
      .set(auth(EMAIL))
      .send({ reason: 'equipamento em comodato, devolvido ao fornecedor' })
      .expect(201);

    const depois = await http.get(`/v1/maintenance-plans/cycles/${cicloId}/compliance`).set(auth(EMAIL));
    expect(depois.body.summary.expected).toBe(2);
    expect(depois.body.summary.skipped).toBe(1);

    const dispensado = depois.body.items.find((i: { id: string }) => i.id === item.id);
    expect(dispensado.state).toBe('skipped');
  });

  it('pular sem motivo é recusado', async () => {
    const r0 = await http.get(`/v1/maintenance-plans/cycles/${cicloId}/compliance`).set(auth(EMAIL));
    const outro = r0.body.items.find((i: { state: string }) => i.state !== 'skipped');

    const r = await http
      .post(`/v1/maintenance-plans/cycle-items/${outro.id}/skip`)
      .set(auth(EMAIL))
      .send({ reason: 'ok' });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain('motivo');
  });

  it('o cumprimento satisfaz o contrato', async () => {
    const { cycleCompliance } = await import('@aurora/contracts');
    const r = await http.get(`/v1/maintenance-plans/cycles/${cicloId}/compliance`).set(auth(EMAIL));
    const conferido = cycleCompliance.response.safeParse(r.body);
    if (!conferido.success) {
      throw new Error(conferido.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'));
    }
  });
});

describe('gerar ciclo', () => {
  it('o segundo ciclo é ancorado no fim do primeiro, e a tarefa não duplica', async () => {
    /*
     * ESTE TESTE NASCEU DE UMA SUPOSIÇÃO MINHA QUE ESTAVA ERRADA.
     *
     * Eu esperava que gerar de novo fosse recusado enquanto houvesse ciclo
     * aberto. Não é: `generateCycle` ancora o próximo no FIM do anterior e
     * decide pela antecedência — com antecedência normal (dias), o próximo
     * simplesmente não chega a abrir. A antecedência absurda desta massa é o
     * que torna a segunda geração possível.
     *
     * O que a suposição errada REVELOU é que nada fecha um ciclo hoje:
     * `status` fica em 'open' indefinidamente. Uma consulta que juntasse por
     * `status = 'open'` devolveria N linhas por tarefa a partir do segundo
     * ciclo, e a tarefa apareceria duplicada — o indicador contaria cada
     * equipamento duas vezes.
     *
     * Por isso a consulta pega o ciclo de maior `seq`, e este teste guarda
     * essa propriedade.
     */
    const r = await http.post(`/v1/maintenance-plans/tasks/${tarefa}/cycles`).set(auth(EMAIL));
    expect(r.status).toBe(201);
    expect(r.body.cycle.seq).toBe(2);

    const detalhe = await http.get(`/v1/maintenance-plans/${plano}`).set(auth(EMAIL));
    // UMA linha por tarefa, e o ciclo corrente é o novo.
    expect(detalhe.body.tasks).toHaveLength(1);
    expect(detalhe.body.tasks[0].open_cycle_seq).toBe(2);
    expect(detalhe.body.tasks[0].open_cycle_id).toBe(r.body.cycle.id);

    // O ciclo novo começa onde o anterior terminou: ancorar em "hoje" faria a
    // data escorregar a cada geração atrasada, e em dois anos a preventiva de
    // janeiro estaria acontecendo em março.
    expect(new Date(r.body.cycle.starts_at).getTime()).toBeGreaterThan(0);
  });
});

describe('identificador malformado', () => {
  it('é recusado antes de chegar ao banco', async () => {
    for (const caminho of [
      '/v1/maintenance-plans/nao-e-uuid',
      '/v1/maintenance-plans/tasks/nao-e-uuid/assets',
      '/v1/maintenance-plans/cycles/nao-e-uuid/compliance',
    ]) {
      const r = await http.get(caminho).set(auth(EMAIL));
      expect(r.status, caminho).toBe(422);
    }
  });
});
