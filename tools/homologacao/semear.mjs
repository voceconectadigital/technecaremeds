#!/usr/bin/env node
/**
 * Aurora — a massa de HOMOLOGAÇÃO, para o cliente clicar.
 *
 * ISTO NÃO É A MASSA DOS TESTES, E A DIFERENÇA IMPORTA.
 *
 * `e2e/fixtures/seed.mjs` existe para uma suíte: é mínima, determinística, e
 * cada registro dela está lá porque um caso o exige. Uma pessoa navegando por
 * ela encontra telas com dois registros e conclui, com razão, que o produto é
 * uma casca.
 *
 * Esta massa existe para GENTE. Duas organizações com feitios diferentes, oito
 * pessoas com papéis diferentes, e dado em todos os módulos que a SPEC nomeia —
 * o suficiente para alguém abrir cada tela e ver o produto trabalhando, não uma
 * lista vazia com um botão.
 *
 * TUDO É MARCADO COMO TESTE, E NADA É DE NINGUÊM.
 *
 * Os nomes de organização começam com "[HOMOLOGAÇÃO]"; os endereços de e-mail
 * terminam em `@homologacao.aurora.test`, um domínio reservado que não recebe
 * mensagem; as pessoas são personagens com nome de função — "Ana Administradora"
 * —, não gente. Nenhum dado pessoal real entra aqui, e nenhum contato daqui
 * pode receber uma mensagem por engano.
 *
 * ELE SE RECUSA A RODAR EM PRODUÇÃO.
 *
 * Uma massa de demonstração dentro do banco de um cliente é o tipo de acidente
 * que ninguém desfaz depois. A recusa é por `AURORA_AMBIENTE`, e não há opção
 * para forçá-la.
 *
 * Uso:
 *   DATABASE_URL=... node tools/homologacao/semear.mjs [--reset]
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.TSX_TSCONFIG_PATH ??= join(raiz, 'tsconfig.base.json');
require('tsx/cjs');

const { Pool } = require('pg');

/* -------------------------------------------------------------------------- */
/* as duas recusas                                                            */
/* -------------------------------------------------------------------------- */

if (process.env.AURORA_AMBIENTE === 'producao') {
  console.error(
    '\nRECUSADO: AURORA_AMBIENTE=producao.\n\n' +
      'Esta massa é de demonstração e não entra em banco de cliente. Não há\n' +
      'opção para forçar — se o ambiente está errado, corrija o ambiente.\n'
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* identificadores fixos                                                      */
/* -------------------------------------------------------------------------- */

/**
 * UUID v7 escritos à mão, com prefixo de tempo legível.
 *
 * Fixos porque a homologação é conversada: "entre como a Ana" precisa dar na
 * mesma pessoa hoje e depois de o banco ser recriado. E porque quem investiga
 * um problema cita um identificador, e um identificador que muda a cada
 * semeadura não serve para citar.
 */
const H = {
  orgPrestadora: '0193da00-0000-7000-8000-00000000000a',
  orgHospital: '0193da00-0000-7000-8000-00000000000b',

  // As oito pessoas. Uma por papel que a SPEC descreve, mais a que existe em
  // duas organizações — que é a que prova o seletor de organização.
  userAdmin: '0193da00-0001-7000-8000-000000000001',
  userGestor: '0193da00-0001-7000-8000-000000000002',
  userCoord: '0193da00-0001-7000-8000-000000000003',
  userTecnico: '0193da00-0001-7000-8000-000000000004',
  userSolicitante: '0193da00-0001-7000-8000-000000000005',
  userPortal: '0193da00-0001-7000-8000-000000000006',
  userAuditor: '0193da00-0001-7000-8000-000000000007',
  userDuasOrgs: '0193da00-0001-7000-8000-000000000008',

  memAdmin: '0193da00-0002-7000-8000-000000000001',
  memGestor: '0193da00-0002-7000-8000-000000000002',
  memCoord: '0193da00-0002-7000-8000-000000000003',
  memTecnico: '0193da00-0002-7000-8000-000000000004',
  memSolicitante: '0193da00-0002-7000-8000-000000000005',
  memPortal: '0193da00-0002-7000-8000-000000000006',
  memAuditor: '0193da00-0002-7000-8000-000000000007',
  memDuasOrgsPrestadora: '0193da00-0002-7000-8000-000000000008',
  memDuasOrgsHospital: '0193da00-0002-7000-8000-000000000009',
  // A organização hospitalar precisa de um dono próprio: sem alguém com
  // `is_owner`, ninguém consegue administrar a segunda organização e metade da
  // homologação fica sem dono.
  memAdminHospital: '0193da00-0002-7000-8000-00000000000a',
};

/**
 * As pessoas, como quem faz a homologação vai lê-las.
 *
 * `papel` é a chave do papel de fábrica. `assento` separa quem consome assento
 * pago (§05): só `staff` consome, e o portal é onde mora a maior parte das
 * pessoas de um cliente.
 */
const PESSOAS = [
  {
    id: H.userAdmin,
    membro: H.memAdmin,
    nome: 'Ana Administradora',
    email: 'ana.admin@homologacao.aurora.test',
    papel: 'admin',
    assento: 'staff',
    dono: true,
    resumo: 'Configura a organização: papéis, catálogos, pessoas.',
  },
  {
    id: H.userGestor,
    membro: H.memGestor,
    nome: 'Gustavo Gestor',
    email: 'gustavo.gestor@homologacao.aurora.test',
    papel: 'maintenance_manager',
    assento: 'staff',
    dono: false,
    resumo: 'Enxerga o todo: indicadores, contratos, planos, custo.',
  },
  {
    id: H.userCoord,
    membro: H.memCoord,
    nome: 'Cida Coordenadora',
    email: 'cida.coord@homologacao.aurora.test',
    papel: 'coordinator',
    assento: 'staff',
    dono: false,
    resumo: 'Triagem, abertura de OS, atribuição e agenda.',
  },
  {
    id: H.userTecnico,
    membro: H.memTecnico,
    nome: 'Tiago Técnico',
    email: 'tiago.tecnico@homologacao.aurora.test',
    papel: 'technician',
    assento: 'staff',
    dono: false,
    resumo: 'O aplicativo de campo: executa, mede, fotografa, assina.',
  },
  {
    id: H.userSolicitante,
    membro: H.memSolicitante,
    nome: 'Sônia Solicitante',
    email: 'sonia.solicitante@homologacao.aurora.test',
    papel: 'requester',
    assento: 'portal',
    dono: false,
    resumo: 'Gente da operação que abre chamado e acompanha o próprio.',
  },
  {
    id: H.userPortal,
    membro: H.memPortal,
    nome: 'Paula do Cliente',
    email: 'paula.cliente@homologacao.aurora.test',
    papel: 'customer_manager',
    assento: 'portal',
    dono: false,
    resumo: 'O portal do cliente: vê os chamados da unidade dela, e só.',
  },
  {
    id: H.userAuditor,
    membro: H.memAuditor,
    nome: 'Aurélio Auditor',
    email: 'aurelio.auditor@homologacao.aurora.test',
    papel: 'auditor',
    assento: 'staff',
    dono: false,
    resumo: 'Lê tudo o que é registro e não altera nada — nem vê custo.',
  },
  {
    id: H.userDuasOrgs,
    membro: H.memDuasOrgsPrestadora,
    nome: 'Marina Multiorganização',
    email: 'marina.multi@homologacao.aurora.test',
    papel: 'coordinator',
    assento: 'staff',
    dono: false,
    resumo: 'A MESMA pessoa nas duas organizações — o seletor existe por ela.',
  },
];

const pool = new Pool({ connectionString: url, max: 4 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

/* -------------------------------------------------------------------------- */

async function limpar() {
  /*
   * As mesmas três garantias que a limpeza da massa de testes precisa desligar,
   * e pelo mesmo motivo: o razão de estoque é imutável e a estrutura de um
   * checklist publicado também. São propriedades corretas do produto, e a saída
   * é desligá-las explicitamente pelo tempo do apagamento — nunca afrouxá-las.
   */
  const gatilhos = [
    ['aurora.stock_movements', 'stock_movements_immutable'],
    ['aurora.checklist_items', 'checklist_items_guard'],
    ['aurora.checklist_sections', 'checklist_sections_guard'],
  ];
  for (const [tabela, gatilho] of gatilhos) {
    await q(`ALTER TABLE ${tabela} DISABLE TRIGGER ${gatilho}`);
  }
  try {
    await q(`DELETE FROM aurora.organizations WHERE slug LIKE 'homolog-%'`);
    await q(`DELETE FROM aurora.users WHERE email LIKE '%@homologacao.aurora.test'`);
  } finally {
    for (const [tabela, gatilho] of gatilhos) {
      await q(`ALTER TABLE ${tabela} ENABLE TRIGGER ${gatilho}`);
    }
  }
}

async function criarVinculo(membro, org, user, assento, dono) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
       VALUES ($1, $2, $3, 'active', $4::aurora.seat_type, $5)`,
      [membro, org, user, assento, dono]
    );
    // Vínculo e escopo na MESMA transação: o gatilho da 0039 recusa o vínculo
    // sem escopo no COMMIT, e com razão — vínculo cego não é vínculo.
    await c.query(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
      membro,
      org,
    ]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  if (process.argv.includes('--reset')) await limpar();

  const [{ existe }] = await q(
    `SELECT count(*)::int AS existe FROM aurora.organizations WHERE slug LIKE 'homolog-%'`
  );
  if (existe > 0) {
    console.log('massa de homologação já existe — use --reset para recriá-la');
    return;
  }

  /* ---------------------------------------------------------- organizações */

  /*
   * DUAS ORGANIZAÇÕES COM FEITIOS DIFERENTES, e não duas cópias.
   *
   * A prestadora atende clientes externos: é o caso em que contrato, orçamento
   * e portal do cliente fazem sentido. O hospital cuida do próprio parque: é o
   * caso em que "cliente" é interno e o portal serve à enfermagem da casa.
   *
   * Duas cópias da mesma coisa provariam o isolamento e nada mais. Duas formas
   * diferentes mostram que o produto atende às duas — que é a pergunta que o
   * cliente realmente tem.
   */
  for (const [id, slug, nome] of [
    [H.orgPrestadora, 'homolog-prestadora', '[HOMOLOGAÇÃO] Prestadora Horizonte'],
    [H.orgHospital, 'homolog-hospital', '[HOMOLOGAÇÃO] Hospital Santa Clara'],
  ]) {
    await q(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [id, slug, nome]);
  }

  for (const p of PESSOAS) {
    await q(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [p.id, p.email, p.nome]);
  }

  for (const p of PESSOAS) {
    await criarVinculo(p.membro, H.orgPrestadora, p.id, p.assento, p.dono);
  }
  // A segunda organização: a Marina, que é a mesma pessoa, e uma dona própria.
  await criarVinculo(H.memDuasOrgsHospital, H.orgHospital, H.userDuasOrgs, 'staff', false);
  await criarVinculo(H.memAdminHospital, H.orgHospital, H.userAdmin, 'staff', true);

  /* ------------------------------------------------------------- o resto */

  const db = require(join(raiz, 'packages', 'db', 'src', 'index.ts'));
  const { pgPoolAdapter } = require(join(raiz, 'packages', 'db', 'src', 'adapters.ts'));
  const { buildContext, PERMISSION_KEYS } = require(join(raiz, 'packages', 'domain', 'src', 'index.ts'));

  // O catálogo de permissões é espelho do código (§21) e não vem por migração:
  // sem sincronizar, o papel de fábrica aponta para uma chave que o banco não
  // conhece, e a chave estrangeira recusa.
  const admin = pgPoolAdapter(pool, null);
  await db.syncPermissionCatalog(admin);
  await db.syncCatalogDefinitions(admin);

  const conexao = pgPoolAdapter(pool, 'aurora_app');
  const contexto = (org, mem) =>
    buildContext({
      organizationId: org,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'homologacao-seed',
      permissions: PERMISSION_KEYS,
    });

  const resumo = { os: 0, chamados: 0, ativos: 0 };

  /* =========================== A PRESTADORA =============================== */

  await db.withTenant(conexao, contexto(H.orgPrestadora, H.memAdmin), async (s) => {
    const papeis = await db.provisionFactoryRoles(s);
    for (const p of PESSOAS) await db.assignRole(s, p.membro, papeis.get(p.papel));
    await db.provisionWorkOrderStates(s);
    const tipos = await db.provisionStarterLocationTypes(s);

    for (const [key, label, systemKey] of [
      ['corretiva', 'Corretiva', 'corrective'],
      ['preventiva', 'Preventiva', 'preventive'],
      ['calibracao', 'Calibração', null],
    ]) {
      await db.createCatalogItem(s, { catalogKey: 'work_order_type', key, label, systemKey });
    }
    const [corretiva] = await s.query(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND key = 'corretiva'`
    );
    const [preventiva] = await s.query(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' AND key = 'preventiva'`
    );

    /*
     * DOIS CLIENTES, e é isso que faz o portal ser testável de verdade.
     *
     * Com um cliente só, "a Paula não vê o chamado do outro cliente" não teria
     * o outro cliente — e a prova de não vazamento seria uma frase.
     */
    const hospitalCliente = await db.createCustomer(s, {
      name: 'Hospital São Lucas (cliente)',
      isInternal: false,
    });
    const clinicaCliente = await db.createCustomer(s, {
      name: 'Clínica Vida Plena (cliente)',
      isInternal: false,
    });

    const arvore = {};
    for (const [chave, cliente, nome, pai, tipo] of [
      ['saoLucas', hospitalCliente, 'Hospital São Lucas', null, 'unidade'],
      ['uti', hospitalCliente, 'UTI Adulto', 'saoLucas', 'setor'],
      ['leito7', hospitalCliente, 'Leito 7', 'uti', 'sala'],
      ['centroCirurgico', hospitalCliente, 'Centro Cirúrgico', 'saoLucas', 'setor'],
      ['vidaPlena', clinicaCliente, 'Clínica Vida Plena', null, 'unidade'],
      ['diagnostico', clinicaCliente, 'Diagnóstico por Imagem', 'vidaPlena', 'setor'],
    ]) {
      arvore[chave] = await db.createLocation(s, {
        customerId: cliente,
        parentId: pai ? arvore[pai] : undefined,
        locationTypeId: tipos.get(tipo) ?? tipos.get('setor'),
        name: nome,
      });
    }

    const catVentilador = await db.createAssetCategory(s, { name: 'Ventilador pulmonar' });
    const catMonitor = await db.createAssetCategory(s, { name: 'Monitor multiparâmetros' });
    const catBomba = await db.createAssetCategory(s, { name: 'Bomba de infusão' });

    const ativos = {};
    for (const [chave, nome, cat, local, cliente, patrimonio] of [
      ['vent1', 'Ventilador Inter 5 Plus', catVentilador, 'leito7', hospitalCliente, 'PAT-001'],
      ['vent2', 'Ventilador Inter 7', catVentilador, 'uti', hospitalCliente, 'PAT-002'],
      ['mon1', 'Monitor DX-2020', catMonitor, 'leito7', hospitalCliente, 'PAT-003'],
      ['bomba1', 'Bomba de infusão ST-670', catBomba, 'uti', hospitalCliente, 'PAT-004'],
      ['mon2', 'Monitor cirúrgico CX-9', catMonitor, 'centroCirurgico', hospitalCliente, 'PAT-005'],
      ['mon3', 'Monitor de imagem VP-1', catMonitor, 'diagnostico', clinicaCliente, 'PAT-006'],
    ]) {
      ativos[chave] = await db.createAsset(s, {
        name: nome,
        customerId: cliente,
        assetCategoryId: cat,
        locationId: arvore[local],
        assetNumber: patrimonio,
      });
      resumo.ativos++;
    }

    /* ------------------------------------------------------- checklists */

    const roteiro = await db.createChecklistTemplate(s, {
      key: 'preventiva_ventilador',
      title: 'Preventiva de ventilador pulmonar',
      description: 'Roteiro trimestral — inspeção, teste funcional e troca de filtro.',
    });
    for (const item of [
      { kind: 'boolean', label: 'Alarme sonoro funciona', required: true, expectedBoolean: true },
      {
        kind: 'number',
        label: 'Pressão de pico',
        required: true,
        minValue: 10,
        maxValue: 40,
        unit: 'cmH2O',
      },
      {
        kind: 'option',
        label: 'Estado do circuito paciente',
        required: false,
        options: ['íntegro', 'ressecado', 'trincado'],
        failingOptions: ['trincado'],
      },
      { kind: 'text', label: 'Observações do técnico', required: false },
    ].map((x, i) => ({ ...x, position: i + 1 }))) {
      await db.addChecklistItem(s, { templateId: roteiro, ...item });
    }
    await db.publishChecklist(s, roteiro);

    /* --------------------------------------------------------- chamados */

    /*
     * CHAMADOS EM ESTÁGIOS DIFERENTES.
     *
     * Uma fila de triagem só tem sentido se houver o que triar; um chamado já
     * aceito só tem sentido se houver a OS que nasceu dele. Semear os dois faz
     * a tela de triagem mostrar trabalho E histórico, que é como ela vive.
     */
    for (const [resumoTexto, local, ativo, prioridade] of [
      ['Ventilador do leito 7 apitando sem parar', 'leito7', 'vent1', 'urgent'],
      ['Monitor do centro cirúrgico desliga sozinho', 'centroCirurgico', 'mon2', 'emergency'],
      ['Bomba de infusão com display fraco', 'uti', 'bomba1', 'low'],
    ]) {
      await db.createServiceRequest(s, {
        customerId: hospitalCliente,
        locationId: arvore[local],
        assetId: ativos[ativo],
        summary: resumoTexto,
        description: 'Chamado de homologação, aberto pela massa de demonstração.',
        requestedPriority: prioridade,
        requesterMembershipId: H.memPortal,
        source: 'portal',
      });
      resumo.chamados++;
    }

    /* -------------------------------------------------- ordens de serviço */

    /*
     * ORDENS EM VÁRIOS ESTADOS, e não cinco iguais em "aberta".
     *
     * O quadro do coordenador é uma leitura de COLUNAS: com tudo numa coluna
     * só, ele não mostra nada sobre o fluxo. E a tela de indicadores contra um
     * mundo onde nada foi concluído mostra zero em toda parte — que passa a
     * impressão de produto quebrado, não de produto novo.
     */
    const ordens = [];
    for (const [titulo, ativo, local, natureza, atribuido] of [
      ['Ventilador não pressuriza', 'vent1', 'leito7', corretiva.id, H.memTecnico],
      ['Preventiva trimestral do Inter 7', 'vent2', 'uti', preventiva.id, H.memTecnico],
      ['Monitor com alarme intermitente', 'mon1', 'leito7', corretiva.id, H.memTecnico],
      ['Bomba de infusão fora de faixa', 'bomba1', 'uti', corretiva.id, H.memTecnico],
      ['Inspeção de rotina do centro cirúrgico', 'mon2', 'centroCirurgico', preventiva.id, null],
      ['Troca de bateria do monitor de imagem', 'mon3', 'diagnostico', corretiva.id, null],
    ]) {
      const os = await db.createWorkOrder(s, {
        customerId: local === 'diagnostico' ? clinicaCliente : hospitalCliente,
        workOrderTypeId: natureza,
        title: titulo,
        description: 'Ordem de homologação, criada pela massa de demonstração.',
        locationId: arvore[local],
        assetId: ativos[ativo],
        assigneeMembershipId: atribuido,
        publish: true,
      });
      ordens.push(os.id);
      resumo.os++;
    }

    /*
     * Duas delas avançam. As transições passam pelo GRAFO de estados, e não
     * por escrita direta: uma OS colocada em "concluída" por `UPDATE` teria
     * histórico vazio, e a tela de histórico — que é onde a auditoria olha —
     * mostraria uma ordem que apareceu pronta do nada.
     */
    await db.transitionWorkOrder(s, ordens[2], 'in_progress', { note: 'Técnico a caminho.' });
    await db.transitionWorkOrder(s, ordens[3], 'in_progress', { note: 'Em bancada.' });
    await db.transitionWorkOrder(s, ordens[3], 'completed', {
      resolution: 'Substituído o conjunto de teclas e refeita a calibração.',
    });
    /*
     * E uma delas vai até o FIM: concluída, validada, fechada.
     *
     * Sem uma OS fechada, a tela de indicadores mostra zero em toda parte e o
     * módulo de contrato não tem o que faturar — o que passa a impressão de
     * produto quebrado, e não de produto novo.
     */
    await db.transitionWorkOrder(s, ordens[3], 'validated', { note: 'Conferido pela coordenação.' });
    await db.transitionWorkOrder(s, ordens[3], 'closed', { note: 'Aceite do cliente registrado.' });

    /* --------------------------------------------------------- estoque */

    const deposito = await db.createWarehouse(s, { name: 'Almoxarifado Central' });
    const oficina = await db.createWarehouse(s, { name: 'Carro da oficina móvel' });

    const itens = {};
    for (const [chave, sku, nome, unidade] of [
      ['valvula', 'VAL-EXA-01', 'Válvula de exalação', 'un'],
      ['filtro', 'FIL-HEPA-01', 'Filtro HEPA', 'un'],
      ['celula', 'CEL-O2-01', 'Célula de oxigênio', 'un'],
      ['bateria', 'BAT-12V-01', 'Bateria selada 12 V', 'un'],
      ['circuito', 'CIR-PAC-01', 'Circuito paciente adulto', 'un'],
    ]) {
      itens[chave] = await db.createItem(s, { sku, name: nome, unit: unidade });
    }

    /*
     * O saldo entra por RECEBIMENTO, e não por escrita na tabela de saldos.
     *
     * Semear por fora produz um estado que a aplicação não sabe criar — e a
     * primeira movimentação real desmancharia a conta, na frente do cliente.
     */
    for (const [item, deposito_, quantidade, custo] of [
      ['valvula', deposito, 24, 150],
      ['filtro', deposito, 4, 90],
      ['celula', deposito, 12, 420],
      ['bateria', deposito, 2, 180],
      ['circuito', oficina, 15, 65],
    ]) {
      await db.recordMovement(s, {
        itemId: itens[item],
        warehouseId: deposito_,
        kind: 'receipt',
        qty: quantidade,
        unitCost: custo,
      });
    }
    // Dois abaixo do mínimo de propósito: a tela de estoque abre justamente
    // nessa aba, e uma massa com tudo em ordem a deixaria vazia.
    await db.setMinimum(s, itens.filtro, deposito, 10);
    await db.setMinimum(s, itens.bateria, deposito, 6);

    /* ------------------------------------------------------- comercial */

    const contrato = await db.createContract(s, {
      customerId: hospitalCliente,
      kind: 'full_service',
      title: 'Manutenção integral — Hospital São Lucas',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      autoRenew: true,
      billingModel: 'fixed_monthly',
      monthlyValue: 28500,
      includedCalls: 40,
    });
    await db.addCoverage(s, {
      contractId: contrato,
      kind: 'location_subtree',
      locationId: arvore.saoLucas,
    });

    const contratoClinica = await db.createContract(s, {
      customerId: clinicaCliente,
      kind: 'preventive_only',
      title: 'Preventiva programada — Clínica Vida Plena',
      startsOn: '2026-03-01',
      endsOn: '2027-02-28',
      autoRenew: false,
      billingModel: 'per_call',
      monthlyValue: 0,
      includedCalls: 0,
    });
    await db.addCoverage(s, {
      contractId: contratoClinica,
      kind: 'location_subtree',
      locationId: arvore.vidaPlena,
    });

    await db.createQuote(s, { customerId: clinicaCliente, validUntil: '2026-12-31' });

    /* ---------------------------------------------------- plano preventivo */

    const plano = await db.createPlan(s, {
      name: 'Preventiva trimestral de ventiladores',
      customerId: hospitalCliente,
      description: 'Inspeção, teste funcional e troca de filtro.',
      autoGenerate: false,
      anchorDate: new Date('2026-01-01T00:00:00Z'),
    });
    const tarefa = await db.addPlanTask(s, {
      planId: plano,
      name: 'Preventiva de ventilador',
      targetKind: 'location_subtree',
      targetLocationId: arvore.saoLucas,
      workOrderTypeId: preventiva.id,
      frequencyUnit: 'quarter',
      frequencyInterval: 1,
      // Antecedência larga para o ciclo abrir AGORA: um plano sem ciclo aberto
      // deixa a tela de cumprimento sem o que mostrar, e quem está avaliando
      // conclui que o módulo não funciona.
      leadTimeDays: 3650,
      toleranceDays: 5,
    });
    await db.generateCycle(s, tarefa);

    /* ------------------------------------------- o escopo do portal */

    /*
     * A Paula vê UM cliente e UMA unidade. É a persona da §19 — "a enfermeira
     * da UTI II vê a UTI II" — e o escopo restrito é o que torna o portal uma
     * prova, e não uma promessa: sem apertar, ela enxergaria a clínica também.
     */
    await s.query(
      `UPDATE aurora.membership_scopes
          SET customer_scope = 'listed', customer_ids = $2,
              location_scope = 'listed', location_ids = $3
        WHERE membership_id = $1`,
      [H.memPortal, [hospitalCliente], [arvore.saoLucas]]
    );
    // A Sônia é da operação do cliente e acompanha o próprio chamado: mesmo
    // cliente, sem restrição de local.
    await s.query(
      `UPDATE aurora.membership_scopes
          SET customer_scope = 'listed', customer_ids = $2
        WHERE membership_id = $1`,
      [H.memSolicitante, [hospitalCliente]]
    );
  });

  /* ============================ O HOSPITAL ================================ */

  /*
   * A SEGUNDA ORGANIZAÇÃO É MENOR, E DE PROPÓSITO.
   *
   * Ela existe para duas coisas: provar que nada da primeira aparece aqui, e
   * mostrar o feitio "cuido do meu próprio parque", em que o cliente é interno.
   * Enchê-la de dado só faria a homologação demorar mais sem mostrar nada novo.
   */
  await db.withTenant(conexao, contexto(H.orgHospital, H.memAdminHospital), async (s) => {
    const papeis = await db.provisionFactoryRoles(s);
    await db.assignRole(s, H.memAdminHospital, papeis.get('admin'));
    await db.assignRole(s, H.memDuasOrgsHospital, papeis.get('coordinator'));
    await db.provisionWorkOrderStates(s);
    const tipos = await db.provisionStarterLocationTypes(s);

    await db.createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'corretiva',
      label: 'Corretiva',
      systemKey: 'corrective',
    });
    const [corretiva] = await s.query(
      `SELECT id FROM aurora.catalog_items WHERE catalog_key = 'work_order_type' LIMIT 1`
    );

    const proprio = await db.createCustomer(s, {
      name: 'Santa Clara — parque próprio',
      isInternal: true,
    });
    const predio = await db.createLocation(s, {
      customerId: proprio,
      locationTypeId: tipos.get('unidade'),
      name: 'Prédio Principal',
    });
    const emergencia = await db.createLocation(s, {
      customerId: proprio,
      parentId: predio,
      locationTypeId: tipos.get('setor'),
      name: 'Pronto-socorro',
    });

    const cat = await db.createAssetCategory(s, { name: 'Desfibrilador' });
    const desfibrilador = await db.createAsset(s, {
      name: 'Desfibrilador HC-10',
      customerId: proprio,
      assetCategoryId: cat,
      locationId: emergencia,
      assetNumber: 'SC-0001',
    });
    resumo.ativos++;

    await db.createWorkOrder(s, {
      customerId: proprio,
      workOrderTypeId: corretiva.id,
      title: 'Desfibrilador não carrega',
      description: 'Ordem de homologação da segunda organização.',
      locationId: emergencia,
      assetId: desfibrilador,
      assigneeMembershipId: H.memDuasOrgsHospital,
      publish: true,
    });
    resumo.os++;
  });

  /* ----------------------------------------------------------- o resumo */

  /*
   * A CONTA É SÓ DA MASSA, e não do banco inteiro.
   *
   * A primeira versão contava a tabela toda e anunciou "1088 locais" num banco
   * que também tinha a massa de medição de desempenho dentro. Um resumo que
   * mente sobre a própria massa é pior do que resumo nenhum: quem lê passa a
   * duvidar de tudo o que o script diz.
   */
  const contar = async (tabela) =>
    Number(
      (
        await q(`SELECT count(*)::int AS n FROM ${tabela} WHERE organization_id = ANY($1::uuid[])`, [
          [H.orgPrestadora, H.orgHospital],
        ])
      )[0].n
    );

  console.log(`
massa de HOMOLOGAÇÃO criada.

  organizações  2   [HOMOLOGAÇÃO] Prestadora Horizonte · Hospital Santa Clara
  pessoas       ${PESSOAS.length}   todas em @homologacao.aurora.test
  vínculos      ${await contar('aurora.memberships')}
  clientes      ${await contar('aurora.customers')}
  locais        ${await contar('aurora.locations')}
  ativos        ${resumo.ativos}
  chamados      ${resumo.chamados}
  ordens        ${resumo.os}
  contratos     ${await contar('aurora.contracts')}
  ciclos        ${await contar('aurora.plan_cycles')}
  saldos        ${await contar('aurora.stock_balances')}

quem entra em quê:
${PESSOAS.map((p) => `  ${p.email.padEnd(42)} ${p.nome} — ${p.resumo}`).join('\n')}
  ${'(a Marina existe também no Hospital Santa Clara)'}

NADA AQUI É DADO REAL. Endereços em @homologacao.aurora.test não recebem
mensagem, e as pessoas são personagens.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
