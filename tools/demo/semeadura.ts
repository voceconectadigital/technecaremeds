/**
 * Téchne Care — a massa da DEMONSTRAÇÃO PÚBLICA.
 *
 * NÃO É A MASSA DE HOMOLOGAÇÃO, E NÃO VAI PARA BANCO NENHUM.
 *
 * Ela roda dentro de um PGlite em memória, só durante `npm run demo:capturar`,
 * e morre com o processo. O que sobrevive são as RESPOSTAS da API sobre ela,
 * gravadas em `apps/web/src/demo/capturas.json` — que é o que a demonstração
 * publicada lê.
 *
 * Por que semear e capturar, em vez de escrever as respostas à mão: cada
 * resposta passa pela API de verdade — controllers, regras, cálculo de SLA,
 * agregação de indicadores. Uma resposta escrita à mão erra primeiro no campo
 * calculado, e a tela da demonstração viraria uma tela que o produto não
 * produz.
 *
 * TUDO É FICTÍCIO. Pessoas são personagens, os endereços terminam em
 * `@demo.technecare.local` (domínio reservado que não recebe mensagem), e os
 * clientes não são estabelecimentos reais.
 *
 * É mais rica que a homologação de propósito: a homologação existe para
 * conferir regra; esta existe para alguém olhar e entender o produto. Seis OS
 * num quadro Kanban não contam a história de uma operação.
 */
import { buildContext, PERMISSION_KEYS } from '@aurora/domain';
import * as db from '@aurora/db';
import type { TestDatabase } from '@aurora/db/testing/harness';

/* -------------------------------------------------------------------------- */
/* identificadores fixos — a URL de uma OS da demo é a mesma a cada captura    */
/* -------------------------------------------------------------------------- */

export const DEMO = {
  org: '0193dd00-0000-7000-8000-00000000d001',
  usuario: '0193dd00-0001-7000-8000-00000000d001',
  vinculo: '0193dd00-0002-7000-8000-00000000d001',
  email: 'demo@technecare.local',
};

const PESSOAS = [
  // [chave, nome, e-mail, papel, assento]
  ['gestor', 'Paulo Ribeiro', 'paulo.ribeiro', 'maintenance_manager', 'staff'],
  ['coord', 'Fernanda Alves', 'fernanda.alves', 'coordinator', 'staff'],
  ['rafael', 'Rafael Souza', 'rafael.souza', 'technician', 'staff'],
  ['juliana', 'Juliana Prado', 'juliana.prado', 'technician', 'staff'],
  ['marcos', 'Marcos Lima', 'marcos.lima', 'technician', 'staff'],
  ['beatriz', 'Beatriz Costa', 'beatriz.costa', 'requester', 'portal'],
  ['auditor', 'Helena Duarte', 'helena.duarte', 'auditor', 'staff'],
] as const;

/** A prioridade da demo em palavras de gente, traduzida para o enum do domínio. */
type Prio = 'low' | 'normal' | 'high' | 'urgent' | 'emergency';
const PRIORIDADE = {
  emergency: 'emergency',
  urgent: 'very_urgent',
  high: 'urgent',
  normal: 'low',
  low: 'none',
} as const;
const prio = (p?: Prio) => (p ? PRIORIDADE[p] : undefined);

/** UUID v7 legível, derivado de um número — fixo entre capturas. */
const fixo = (grupo: number, n: number) =>
  `0193dd00-${String(grupo).padStart(4, '0')}-7000-8000-${String(n).padStart(12, '0')}`;

export async function semearDemonstracao(t: TestDatabase): Promise<void> {
  const falhas: string[] = [];
  /*
   * Passo opcional: se a regra do domínio o recusar, a massa segue sem ele. O
   * SAVEPOINT é o que permite seguir — sem ele, a primeira recusa abortaria a
   * transação inteira e levaria a semeadura junto.
   */
  let sessao: { query: (sql: string) => Promise<unknown> } | null = null;
  const tentar = async <T>(rotulo: string, fn: () => Promise<T>): Promise<T | undefined> => {
    await sessao?.query('SAVEPOINT passo');
    try {
      const r = await fn();
      await sessao?.query('RELEASE SAVEPOINT passo');
      return r;
    } catch (e) {
      await sessao?.query('ROLLBACK TO SAVEPOINT passo');
      falhas.push(`${rotulo}: ${(e as Error).message}`);
      return undefined;
    }
  };

  /* ------------------------------------------------- organização e pessoas */

  await t.raw(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [
    DEMO.org,
    'technecare-demo',
    'Téchne Care Engenharia Clínica',
  ]);

  const vinculos: Record<string, string> = { demo: DEMO.vinculo };
  const criarPessoa = async (
    user: string,
    mem: string,
    nome: string,
    email: string,
    assento: string,
    dono: boolean
  ) => {
    await t.raw(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [user, email, nome]);
    await t.admin.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', $4::aurora.seat_type, $5)`,
        [mem, DEMO.org, user, assento, dono]
      );
      await tx.query(
        `INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`,
        [mem, DEMO.org]
      );
    });
  };

  await criarPessoa(DEMO.usuario, DEMO.vinculo, 'Usuário Demonstração', DEMO.email, 'staff', true);
  for (const [i, [chave, nome, email]] of PESSOAS.entries()) {
    const assento = PESSOAS[i][4];
    vinculos[chave] = fixo(2, 100 + i);
    await criarPessoa(
      fixo(1, 100 + i),
      vinculos[chave],
      nome,
      `${email}@demo.technecare.local`,
      assento,
      false
    );
  }

  const ctx = (mem: string) =>
    buildContext({
      organizationId: DEMO.org,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'demo-seed',
      permissions: PERMISSION_KEYS,
    });

  const ordensPorIdade: Array<{ id: string; dias: number; reparoH: number }> = [];
  const chamadosPorIdade: Array<{ id: string; dias: number }> = [];

  await db.withTenant(t.db, ctx(DEMO.vinculo), async (s) => {
    sessao = s;
    const papeis = await db.provisionFactoryRoles(s);
    await db.assignRole(s, DEMO.vinculo, papeis.get('admin')!);
    for (const [chave, , , papel] of PESSOAS) await db.assignRole(s, vinculos[chave], papeis.get(papel)!);
    await db.provisionWorkOrderStates(s);
    const tipos = await db.provisionStarterLocationTypes(s);

    /* ----------------------------------------------------------- catálogos */

    const natureza: Record<string, string> = {};
    for (const [key, label, systemKey] of [
      ['corretiva', 'Corretiva', 'corrective'],
      ['preventiva', 'Preventiva', 'preventive'],
      ['calibracao', 'Calibração', 'calibration'],
      ['seguranca_eletrica', 'Teste de segurança elétrica', 'inspection'],
      ['instalacao', 'Instalação', null],
    ] as const) {
      natureza[key] = await db.createCatalogItem(s, { catalogKey: 'work_order_type', key, label, systemKey });
    }
    for (const [key, label] of [
      ['nao_liga', 'Não liga'],
      ['alarme_falso', 'Alarme sem causa aparente'],
      ['leitura_incorreta', 'Leitura fora de faixa'],
      ['ruido', 'Ruído anormal'],
      ['vazamento', 'Vazamento'],
      ['display', 'Falha no display'],
      ['bateria', 'Bateria não segura carga'],
    ]) {
      await tentar(`sintoma ${key}`, () =>
        db.createCatalogItem(s, { catalogKey: 'failure_symptom', key, label })
      );
    }
    const recusa: Record<string, string | undefined> = {};
    for (const [key, label] of [
      ['fora_de_contrato', 'Fora do escopo do contrato'],
      ['duplicada', 'Chamado em duplicidade'],
      ['uso_incorreto', 'Uso incorreto, orientado no local'],
    ]) {
      recusa[key] = await tentar(`recusa ${key}`, () =>
        db.createCatalogItem(s, { catalogKey: 'rejection_reason', key, label })
      );
    }
    const motivos = new Map(
      (await s.query<{ id: string; key: string }>(`SELECT id, key FROM aurora.wait_reasons`)).map((r) => [
        r.key,
        r.id,
      ])
    );
    const motivo = (preferidos: string[]) =>
      preferidos.map((k) => motivos.get(k)).find(Boolean) ?? [...motivos.values()][0];

    /* -------------------------------------------------- clientes e locais */

    const saoLucas = await db.createCustomer(s, { name: 'Hospital São Lucas', isInternal: false });
    const vidaPlena = await db.createCustomer(s, { name: 'Clínica Vida Plena', isInternal: false });
    const bemEstar = await db.createCustomer(s, { name: 'Policlínica Bem-Estar', isInternal: false });

    const local: Record<string, string> = {};
    const clienteDoLocal: Record<string, string> = {};
    for (const [chave, cliente, nome, pai, tipo] of [
      ['saoLucas', saoLucas, 'Hospital São Lucas', null, 'unidade'],
      ['uti', saoLucas, 'UTI Adulto', 'saoLucas', 'setor'],
      ['leito7', saoLucas, 'Leito 7', 'uti', 'sala'],
      ['leito12', saoLucas, 'Leito 12', 'uti', 'sala'],
      ['utiNeo', saoLucas, 'UTI Neonatal', 'saoLucas', 'setor'],
      ['centroCirurgico', saoLucas, 'Centro Cirúrgico', 'saoLucas', 'setor'],
      ['sala3', saoLucas, 'Sala Cirúrgica 3', 'centroCirurgico', 'sala'],
      ['cme', saoLucas, 'Central de Material Esterilizado', 'saoLucas', 'setor'],
      ['ps', saoLucas, 'Pronto-socorro', 'saoLucas', 'setor'],
      ['vidaPlena', vidaPlena, 'Clínica Vida Plena', null, 'unidade'],
      ['imagem', vidaPlena, 'Diagnóstico por Imagem', 'vidaPlena', 'setor'],
      ['cardio', vidaPlena, 'Cardiologia', 'vidaPlena', 'setor'],
      ['bemEstar', bemEstar, 'Policlínica Bem-Estar', null, 'unidade'],
      ['odonto', bemEstar, 'Odontologia', 'bemEstar', 'setor'],
      ['coleta', bemEstar, 'Sala de Coleta', 'bemEstar', 'setor'],
    ] as const) {
      local[chave] = await db.createLocation(s, {
        customerId: cliente,
        parentId: pai ? local[pai] : undefined,
        locationTypeId: tipos.get(tipo) ?? tipos.get('setor')!,
        name: nome,
      });
      clienteDoLocal[chave] = cliente;
    }

    /* --------------------------------------------------------------- ativos */

    const categoria: Record<string, string> = {};
    for (const [chave, nome, calibra] of [
      ['ventilador', 'Ventilador pulmonar', true],
      ['monitor', 'Monitor multiparâmetros', true],
      ['bomba', 'Bomba de infusão', true],
      ['desfibrilador', 'Desfibrilador', true],
      ['autoclave', 'Autoclave', true],
      ['ecg', 'Eletrocardiógrafo', true],
      ['ultrassom', 'Ultrassom', false],
      ['raiox', 'Raio-X', false],
      ['incubadora', 'Incubadora neonatal', true],
      ['bisturi', 'Bisturi elétrico', true],
      ['foco', 'Foco cirúrgico', false],
      ['cadeira', 'Cadeira odontológica', false],
    ] as const) {
      categoria[chave] = await db.createAssetCategory(s, { name: nome, requiresCalibration: calibra });
    }

    const ativo: Record<string, string> = {};
    const ativoLocal: Record<string, string> = {};
    const ATIVOS = [
      // chave, nome, categoria, local, patrimônio, série, aquisição, valor (R$)
      [
        'vent1',
        'Ventilador Inter 5 Plus',
        'ventilador',
        'leito7',
        'PAT-0101',
        'IT5-22-0187',
        '2021-03-10',
        98000,
      ],
      [
        'vent2',
        'Ventilador Inter 7',
        'ventilador',
        'leito12',
        'PAT-0102',
        'IT7-23-0042',
        '2023-01-22',
        132000,
      ],
      [
        'vent3',
        'Ventilador de transporte VT-30',
        'ventilador',
        'ps',
        'PAT-0103',
        'VT30-20-0911',
        '2020-07-02',
        54000,
      ],
      [
        'mon1',
        'Monitor multiparâmetros DX-2020',
        'monitor',
        'leito7',
        'PAT-0201',
        'DX20-21-5530',
        '2021-05-18',
        31000,
      ],
      [
        'mon2',
        'Monitor multiparâmetros DX-2020',
        'monitor',
        'leito12',
        'PAT-0202',
        'DX20-21-5531',
        '2021-05-18',
        31000,
      ],
      ['mon3', 'Monitor cirúrgico CX-9', 'monitor', 'sala3', 'PAT-0203', 'CX9-22-0077', '2022-02-08', 46000],
      [
        'mon4',
        'Monitor de sinais vitais SV-3',
        'monitor',
        'cardio',
        'PAT-0204',
        'SV3-19-1203',
        '2019-11-30',
        12500,
      ],
      ['bomba1', 'Bomba de infusão ST-670', 'bomba', 'uti', 'PAT-0301', 'ST670-22-3381', '2022-06-14', 9800],
      ['bomba2', 'Bomba de infusão ST-670', 'bomba', 'uti', 'PAT-0302', 'ST670-22-3382', '2022-06-14', 9800],
      [
        'bomba3',
        'Bomba de seringa SR-200',
        'bomba',
        'utiNeo',
        'PAT-0303',
        'SR200-21-0450',
        '2021-09-01',
        11200,
      ],
      [
        'desf1',
        'Desfibrilador DEA Life 300',
        'desfibrilador',
        'ps',
        'PAT-0401',
        'DL300-20-0088',
        '2020-04-12',
        27000,
      ],
      [
        'desf2',
        'Cardioversor CV-5',
        'desfibrilador',
        'centroCirurgico',
        'PAT-0402',
        'CV5-23-0014',
        '2023-03-03',
        39000,
      ],
      [
        'autoclave1',
        'Autoclave horizontal 150 L',
        'autoclave',
        'cme',
        'PAT-0501',
        'AH150-18-0005',
        '2018-08-20',
        185000,
      ],
      [
        'ecg1',
        'Eletrocardiógrafo 12 canais E-12',
        'ecg',
        'cardio',
        'PAT-0601',
        'E12-22-0341',
        '2022-10-05',
        18500,
      ],
      ['us1', 'Ultrassom Sonar 8', 'ultrassom', 'imagem', 'PAT-0701', 'SN8-21-0019', '2021-12-12', 265000],
      ['rx1', 'Raio-X digital DR-500', 'raiox', 'imagem', 'PAT-0801', 'DR500-19-0003', '2019-06-25', 620000],
      [
        'inc1',
        'Incubadora neonatal NeoCare 2',
        'incubadora',
        'utiNeo',
        'PAT-0901',
        'NC2-22-0110',
        '2022-04-19',
        72000,
      ],
      [
        'inc2',
        'Incubadora neonatal NeoCare 2',
        'incubadora',
        'utiNeo',
        'PAT-0902',
        'NC2-22-0111',
        '2022-04-19',
        72000,
      ],
      [
        'bist1',
        'Bisturi elétrico BE-400',
        'bisturi',
        'sala3',
        'PAT-1001',
        'BE400-20-0230',
        '2020-01-15',
        48000,
      ],
      ['foco1', 'Foco cirúrgico LED Duplo', 'foco', 'sala3', 'PAT-1101', 'FLD-21-0067', '2021-02-02', 56000],
      [
        'cad1',
        'Cadeira odontológica Prime',
        'cadeira',
        'odonto',
        'PAT-1201',
        'CP-20-0451',
        '2020-09-09',
        38000,
      ],
      [
        'mon5',
        'Monitor de sinais vitais SV-3',
        'monitor',
        'coleta',
        'PAT-0205',
        'SV3-20-1418',
        '2020-03-14',
        12500,
      ],
    ] as const;
    for (const [chave, nome, cat, loc, patrimonio, serie, aquisicao, valor] of ATIVOS) {
      ativo[chave] = await db.createAsset(s, {
        name: nome,
        customerId: clienteDoLocal[loc],
        assetCategoryId: categoria[cat],
        locationId: local[loc],
        assetNumber: patrimonio,
        serialNumber: serie,
        acquiredAt: aquisicao,
        purchaseValue: valor,
        status: (
          {
            vent3: 'under_maintenance',
            us1: 'under_maintenance',
            desf2: 'under_maintenance',
            inc2: 'standby',
          } as Record<string, db.AssetInput['status']>
        )[chave],
      } as db.AssetInput);
      ativoLocal[chave] = loc;
    }

    /* ------------------------------------------------- ordens de serviço */

    const ORDENS: Array<{
      titulo: string;
      ativo: keyof typeof ativo | string;
      natureza: string;
      tecnico: string | null;
      prioridade?: 'low' | 'normal' | 'high' | 'urgent' | 'emergency';
      caminho: string[];
      dias: number;
      /** [dias a partir de hoje, hora local de Brasília, duração em minutos] */
      agenda?: [number, number, number];
      espera?: string[];
      comentario?: string;
      horas?: number;
    }> = [
      // abertas
      {
        titulo: 'Ventilador não pressuriza',
        ativo: 'vent1',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'urgent',
        caminho: [],
        dias: 0,
        comentario: 'Equipe de enfermagem relata alarme de baixa pressão contínuo.',
      },
      {
        titulo: 'Incubadora com temperatura oscilando',
        ativo: 'inc2',
        natureza: 'corretiva',
        tecnico: null,
        prioridade: 'high',
        caminho: [],
        dias: 1,
      },
      {
        titulo: 'Troca de bateria do DEA',
        ativo: 'desf1',
        natureza: 'corretiva',
        tecnico: null,
        prioridade: 'normal',
        caminho: [],
        dias: 2,
      },
      {
        titulo: 'Instalação de monitor na sala de coleta',
        ativo: 'mon5',
        natureza: 'instalacao',
        tecnico: 'marcos',
        prioridade: 'low',
        caminho: [],
        dias: 3,
      },
      {
        titulo: 'Cadeira odontológica com vazamento no refletor',
        ativo: 'cad1',
        natureza: 'corretiva',
        tecnico: null,
        prioridade: 'normal',
        caminho: [],
        dias: 1,
      },
      // agendadas (programadas)
      {
        titulo: 'Preventiva trimestral do Inter 7',
        ativo: 'vent2',
        natureza: 'preventiva',
        tecnico: 'juliana',
        caminho: ['scheduled'],
        dias: 6,
        agenda: [0, 14, 120],
      },
      {
        titulo: 'Calibração do eletrocardiógrafo',
        ativo: 'ecg1',
        natureza: 'calibracao',
        tecnico: 'marcos',
        caminho: ['scheduled'],
        dias: 5,
        agenda: [0, 16, 90],
      },
      {
        titulo: 'Teste de segurança elétrica do bisturi',
        ativo: 'bist1',
        natureza: 'seguranca_eletrica',
        tecnico: 'rafael',
        caminho: ['scheduled'],
        dias: 4,
        agenda: [1, 9, 60],
      },
      {
        titulo: 'Preventiva da autoclave',
        ativo: 'autoclave1',
        natureza: 'preventiva',
        tecnico: 'juliana',
        caminho: ['scheduled'],
        dias: 9,
        agenda: [2, 8, 180],
      },
      {
        titulo: 'Inspeção do foco cirúrgico',
        ativo: 'foco1',
        natureza: 'preventiva',
        tecnico: 'rafael',
        caminho: ['scheduled'],
        dias: 7,
        agenda: [-1, 10, 60],
      },
      // em análise
      {
        titulo: 'Desfibrilador com falha intermitente na carga',
        ativo: 'desf2',
        natureza: 'corretiva',
        tecnico: 'marcos',
        prioridade: 'high',
        caminho: ['scheduled', 'in_analysis'],
        dias: 2,
        agenda: [0, 11, 60],
      },
      // em execução
      {
        titulo: 'Monitor com alarme intermitente',
        ativo: 'mon1',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'high',
        caminho: ['in_progress'],
        dias: 1,
        comentario: 'Cabo de SpO2 com mau contato; testando com cabo reserva.',
        horas: 1.5,
      },
      {
        titulo: 'Bomba de infusão fora de faixa',
        ativo: 'bomba2',
        natureza: 'corretiva',
        tecnico: 'juliana',
        prioridade: 'high',
        caminho: ['in_progress'],
        dias: 2,
        horas: 2,
      },
      {
        titulo: 'Ultrassom com artefato na imagem',
        ativo: 'us1',
        natureza: 'corretiva',
        tecnico: 'marcos',
        prioridade: 'normal',
        caminho: ['in_progress'],
        dias: 3,
        horas: 3,
      },
      // aguardando
      {
        titulo: 'Placa de controle do ventilador de transporte',
        ativo: 'vent3',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'high',
        caminho: ['in_progress', 'waiting'],
        dias: 8,
        espera: ['parts', 'awaiting_parts', 'part'],
        comentario: 'Placa PCB-VNT-03 solicitada ao fornecedor, previsão de 5 dias úteis.',
        horas: 2.5,
      },
      {
        titulo: 'Cardioversor sem sincronismo',
        ativo: 'desf2',
        natureza: 'corretiva',
        tecnico: 'juliana',
        prioridade: 'urgent',
        caminho: ['in_progress', 'waiting'],
        dias: 5,
        espera: ['customer_window', 'customer', 'access'],
        horas: 1,
      },
      {
        titulo: 'Calibração da bomba de seringa',
        ativo: 'bomba3',
        natureza: 'calibracao',
        tecnico: 'marcos',
        caminho: ['in_progress', 'waiting'],
        dias: 4,
        espera: ['calibration'],
      },
      // pausada
      {
        titulo: 'Monitor cirúrgico reiniciando',
        ativo: 'mon3',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'normal',
        caminho: ['in_progress', 'paused'],
        dias: 6,
        horas: 1,
      },
      // concluídas / validadas / fechadas — alimentam os indicadores
      {
        titulo: 'Substituição do sensor de fluxo',
        ativo: 'vent2',
        natureza: 'corretiva',
        tecnico: 'juliana',
        caminho: ['in_progress', 'completed'],
        dias: 3,
        horas: 2,
      },
      {
        titulo: 'Preventiva semestral das incubadoras',
        ativo: 'inc1',
        natureza: 'preventiva',
        tecnico: 'marcos',
        caminho: ['in_progress', 'completed', 'validated'],
        dias: 12,
        horas: 4,
      },
      {
        titulo: 'Bomba de infusão com display fraco',
        ativo: 'bomba1',
        natureza: 'corretiva',
        tecnico: 'juliana',
        caminho: ['in_progress', 'completed', 'validated', 'closed'],
        dias: 18,
        horas: 1.5,
      },
      {
        titulo: 'Calibração anual do monitor DX-2020',
        ativo: 'mon2',
        natureza: 'calibracao',
        tecnico: 'marcos',
        caminho: ['in_progress', 'completed', 'validated', 'closed'],
        dias: 25,
        horas: 2,
      },
      {
        titulo: 'Preventiva do raio-X digital',
        ativo: 'rx1',
        natureza: 'preventiva',
        tecnico: 'rafael',
        caminho: ['in_progress', 'completed', 'validated', 'closed'],
        dias: 33,
        horas: 5,
      },
      {
        titulo: 'DEA não reconhecia as pás',
        ativo: 'desf1',
        natureza: 'corretiva',
        tecnico: 'rafael',
        caminho: ['in_progress', 'completed', 'validated', 'closed'],
        dias: 41,
        horas: 2.5,
      },
      {
        titulo: 'Preventiva do monitor de sinais vitais',
        ativo: 'mon4',
        natureza: 'preventiva',
        tecnico: 'marcos',
        caminho: ['in_progress', 'completed', 'validated', 'closed'],
        dias: 52,
        horas: 1,
      },
      // cancelada
      {
        titulo: 'Verificação de ruído na autoclave',
        ativo: 'autoclave1',
        natureza: 'corretiva',
        tecnico: null,
        caminho: ['cancelled'],
        dias: 15,
      },
    ];

    const agora = new Date();
    for (const [indice, o] of ORDENS.entries()) {
      const loc = ativoLocal[o.ativo];
      const criada = await tentar(`OS ${o.titulo}`, () =>
        db.createWorkOrder(s, {
          customerId: clienteDoLocal[loc],
          workOrderTypeId: natureza[o.natureza],
          title: o.titulo,
          description: 'Ordem de demonstração — dados fictícios.',
          locationId: local[loc],
          assetId: ativo[o.ativo],
          priority: prio(o.prioridade),
          assigneeMembershipId: o.tecnico ? vinculos[o.tecnico] : null,
          publish: true,
        })
      );
      if (!criada) continue;
      // Horas entre abrir e concluir: o que o MTTR vai medir. Variado de
      // propósito — um MTTR feito de tempos iguais parece inventado.
      const reparoH = o.caminho.includes('completed') ? [6, 26, 9, 40, 14, 3, 20][indice % 7] : 0;
      ordensPorIdade.push({ id: criada.id, dias: o.dias, reparoH });

      let janela: { scheduledStart: Date; scheduledEnd: Date } | null = null;
      if (o.agenda && o.tecnico) {
        // Horário comercial de Brasília (UTC−3), e não "daqui a N horas": a
        // captura pode rodar de madrugada, e uma agenda às 2h não convence.
        const [diasPedidos, hora, minutos] = o.agenda;
        // "Hoje" é o dia de Brasília: às 23h de lá, em UTC já é amanhã.
        const brasilia = new Date(agora.getTime() - 3 * 3_600_000);
        /*
         * Captura rodada depois do meio-dia: as visitas "de hoje à tarde"
         * nasceriam vencidas, e a demonstração mostraria como atrasado o que é
         * só o horário da captura. Tudo que é futuro anda um dia; a visita
         * vencida de propósito (dias < 0) fica onde está.
         */
        const dias = diasPedidos >= 0 && brasilia.getUTCHours() >= 12 ? diasPedidos + 1 : diasPedidos;
        const inicio = new Date(
          Date.UTC(brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate() + dias, hora + 3)
        );
        const fim = new Date(inicio.getTime() + minutos * 60_000);
        janela = { scheduledStart: inicio, scheduledEnd: fim };
        await tentar(`agenda ${o.titulo}`, () =>
          db.scheduleWorkOrder(s, {
            workOrderId: criada.id,
            assigneeMembershipId: vinculos[o.tecnico!],
            startsAt: inicio,
            endsAt: fim,
          } as Parameters<typeof db.scheduleWorkOrder>[1])
        );
      }

      if (o.horas && o.tecnico) {
        // Um dia por OS: a mesma pessoa não aponta duas horas no mesmo intervalo.
        const fim = new Date(agora.getTime() - (indice + 1) * 86_400_000);
        const inicio = new Date(fim.getTime() - o.horas * 3_600_000);
        await tentar(`horas ${o.titulo}`, () =>
          db.logTime(s, {
            workOrderId: criada.id,
            membershipId: vinculos[o.tecnico!],
            startedAt: inicio,
            endedAt: fim,
            note: 'Atendimento em campo',
          })
        );
      }

      for (const passo of o.caminho) {
        await tentar(`transição ${o.titulo} → ${passo}`, () =>
          db.transitionWorkOrder(s, criada.id, passo, {
            ...(passo === 'scheduled' && janela
              ? { ...janela, assigneeMembershipId: vinculos[o.tecnico!] }
              : {}),
            ...(passo === 'waiting' ? { waitReasonId: motivo(o.espera ?? []) } : {}),
            ...(passo === 'completed'
              ? { resolution: 'Componente substituído, teste funcional e de segurança aprovados.' }
              : {}),
            ...(passo === 'cancelled' ? { cancellationReason: 'Aberta em duplicidade.' } : {}),
          })
        );
      }

      if (o.comentario && o.tecnico) {
        await tentar(`comentário ${o.titulo}`, () =>
          db.addComment(s, { workOrderId: criada.id, body: o.comentario!, visibility: 'internal' })
        );
      }
    }

    /* ------------------------------------------------------- solicitações */

    const CHAMADOS: Array<
      [string, string, 'low' | 'normal' | 'high' | 'urgent' | 'emergency', string, number, string[]]
    > = [
      [
        'Ventilador do leito 7 apitando sem parar',
        'vent1',
        'urgent',
        'Alarme de alta pressão dispara mesmo sem paciente conectado.',
        0,
        [],
      ],
      [
        'Monitor do centro cirúrgico desliga sozinho',
        'mon3',
        'emergency',
        'Desligou duas vezes durante procedimento hoje pela manhã.',
        0,
        [],
      ],
      [
        'Incubadora 2 não mantém 36,5 °C',
        'inc2',
        'high',
        'Temperatura oscila entre 35 e 37 °C.',
        1,
        ['triage'],
      ],
      [
        'Bomba de seringa com alarme de oclusão falso',
        'bomba3',
        'normal',
        'Alarme de oclusão sem obstrução aparente na linha.',
        2,
        ['triage'],
      ],
      [
        'Eletrocardiógrafo imprimindo traçado falhado',
        'ecg1',
        'normal',
        'Linhas do papel saem interrompidas.',
        3,
        ['triage', 'info_needed'],
      ],
      [
        'Cadeira odontológica com vazamento',
        'cad1',
        'normal',
        'Água pingando sob o refletor.',
        1,
        ['triage', 'accepted'],
      ],
      [
        'DEA indicando bateria baixa',
        'desf1',
        'high',
        'Indicador de bateria em vermelho no autoteste.',
        2,
        ['triage', 'accepted'],
      ],
      [
        'Foco cirúrgico com lâmpada queimada',
        'foco1',
        'low',
        'Uma das cúpulas sem iluminação.',
        6,
        ['triage', 'rejected'],
      ],
      [
        'Raio-X travando na aquisição',
        'rx1',
        'high',
        'Equipamento trava ao enviar imagem para o PACS.',
        9,
        ['triage', 'accepted'],
      ],
      ['Monitor da coleta sem bateria', 'mon5', 'low', 'Não funciona fora da tomada.', 4, []],
    ];
    for (const [resumo, at, prioridade, descricao, dias, caminho] of CHAMADOS) {
      const loc = ativoLocal[at];
      const sr = await tentar(`chamado ${resumo}`, () =>
        db.createServiceRequest(s, {
          customerId: clienteDoLocal[loc],
          locationId: local[loc],
          assetId: ativo[at],
          summary: resumo,
          description: descricao,
          requestedPriority: prio(prioridade),
          requesterMembershipId: vinculos.beatriz,
          source: 'portal',
          submit: true,
        })
      );
      if (!sr) continue;
      chamadosPorIdade.push({ id: sr.id, dias });
      for (const passo of caminho) {
        if (passo === 'accepted') {
          await tentar(`aceite ${resumo}`, () =>
            db.acceptServiceRequest(s, sr.id, [
              {
                assetId: ativo[at],
                locationId: local[loc],
                workOrderTypeId: natureza.corretiva,
                title: resumo,
                assigneeMembershipId: vinculos.marcos,
              },
            ])
          );
        } else {
          await tentar(`chamado ${resumo} → ${passo}`, () =>
            db.transitionRequest(
              s,
              sr.id,
              passo as never,
              {
                ...(passo === 'rejected' ? { rejectionReasonId: recusa.fora_de_contrato } : {}),
                ...(passo === 'info_needed'
                  ? { infoRequest: 'Pode enviar uma foto do traçado impresso?' }
                  : {}),
              } as never
            )
          );
        }
      }
    }

    /* -------------------------------------------------------------- estoque */

    const central = await db.createWarehouse(s, { name: 'Almoxarifado Central' });
    const carro = await db.createWarehouse(s, {
      name: 'Carro da oficina móvel',
      kind: 'van',
      ownerMembershipId: vinculos.rafael,
    });
    const itens: Record<string, string> = {};
    for (const [chave, sku, nome, unidade, cat, imagem] of [
      ['valvula', 'VAL-EXA-01', 'Válvula de exalação', 'un', 'Pneumática', 'catalogo/valvula.svg'],
      ['filtro', 'FIL-HEPA-01', 'Filtro HEPA', 'un', 'Filtros', 'catalogo/filtro-hepa.svg'],
      ['celula', 'CEL-O2-01', 'Célula de oxigênio', 'un', 'Sensores', 'catalogo/sensor.svg'],
      ['bateria', 'BAT-12V-01', 'Bateria selada 12 V', 'un', 'Energia', 'catalogo/bateria.svg'],
      ['circuito', 'CIR-PAC-01', 'Circuito paciente adulto', 'un', 'Descartáveis', 'catalogo/mangueira.svg'],
      ['placa', 'PCB-VNT-03', 'Placa de controle do ventilador', 'un', 'Eletrônica', 'catalogo/circuito.svg'],
      ['cabo', 'CAB-ECG-05', 'Cabo de ECG 5 vias', 'un', 'Cabos', 'catalogo/cabo.svg'],
      ['eletrodo', 'ELE-DES-01', 'Eletrodo descartável', 'cx', 'Descartáveis', 'catalogo/eletrodo.svg'],
      ['equipo', 'EQP-INF-02', 'Equipo de infusão', 'un', 'Descartáveis', 'catalogo/seringa.svg'],
      ['oring', 'VED-OR-220', 'Anel de vedação 22 mm', 'un', 'Vedação', 'catalogo/oring.svg'],
      ['fusivel', 'FUS-5A-01', 'Fusível 5 A retardado', 'un', 'Energia', 'catalogo/fusivel.svg'],
      ['lampada', 'LAM-FOC-01', 'Lâmpada de foco cirúrgico', 'un', 'Iluminação', 'catalogo/lampada.svg'],
      ['genérico', 'KIT-MAN-01', 'Kit de manutenção preventiva', 'kit', 'Kits', null],
    ] as const) {
      itens[chave] = await db.createItem(s, {
        sku,
        name: nome,
        unit: unidade,
        category: cat,
        imageKey: imagem,
      } as Parameters<typeof db.createItem>[1]);
    }
    for (const [item, dep, qtd, custo, minimo] of [
      ['valvula', central, 24, 150, 12],
      ['filtro', central, 4, 90, 10],
      ['celula', central, 12, 420, 6],
      ['bateria', central, 2, 180, 6],
      ['circuito', carro, 15, 65, 8],
      ['placa', central, 1, 1850, 3],
      ['cabo', central, 9, 320, 4],
      ['eletrodo', central, 48, 28, 20],
      ['equipo', carro, 30, 22, 15],
      ['oring', central, 120, 4, 50],
      ['fusivel', carro, 6, 9, 10],
      ['lampada', central, 1, 640, 3],
      ['genérico', central, 7, 210, 4],
    ] as const) {
      await db.recordMovement(s, {
        itemId: itens[item],
        warehouseId: dep,
        kind: 'receipt',
        qty: qtd,
        unitCost: custo,
      });
      await db.setMinimum(s, itens[item], dep, minimo);
    }
    for (const [item, dep, qtd] of [
      ['oring', central, 8],
      ['eletrodo', central, 6],
      ['valvula', central, 2],
      ['equipo', carro, 4],
      ['filtro', central, 2],
      ['bateria', central, 1],
    ] as const) {
      await db.recordMovement(s, {
        itemId: itens[item],
        warehouseId: dep,
        kind: 'issue',
        qty: qtd,
        reason: 'Consumo em ordem de serviço',
      });
    }

    /* ------------------------------------------------------------ comercial */

    const contratos: Array<[string, string, string, string, string, string, number, number, string]> = [
      [
        saoLucas,
        'full_service',
        'Manutenção integral — Hospital São Lucas',
        '2026-01-01',
        '2026-12-31',
        'fixed_monthly',
        28500,
        40,
        'saoLucas',
      ],
      [
        vidaPlena,
        'preventive_only',
        'Preventiva programada — Clínica Vida Plena',
        '2026-03-01',
        '2027-02-28',
        'per_call',
        0,
        0,
        'vidaPlena',
      ],
      [
        bemEstar,
        'full_service',
        'Manutenção integral — Policlínica Bem-Estar',
        '2025-11-01',
        '2026-10-31',
        'fixed_monthly',
        9800,
        12,
        'bemEstar',
      ],
    ];
    for (const [cliente, tipo, titulo, inicio, fim, cobranca, mensal, chamados, raiz] of contratos) {
      const id = await tentar(`contrato ${titulo}`, () =>
        db.createContract(s, {
          customerId: cliente,
          kind: tipo,
          title: titulo,
          startsOn: inicio,
          endsOn: fim,
          autoRenew: tipo === 'full_service',
          billingModel: cobranca,
          monthlyValue: mensal,
          includedCalls: chamados,
        } as Parameters<typeof db.createContract>[1])
      );
      if (!id) continue;
      await tentar(`cobertura ${titulo}`, () =>
        db.addCoverage(s, { contractId: id, kind: 'location_subtree', locationId: local[raiz] } as never)
      );
      await tentar(`ativação ${titulo}`, () => db.activateContract(s, id));
    }

    const contato: Record<string, string> = {};
    for (const [cliente, nome, email] of [
      [saoLucas, 'Dra. Renata Moura', 'renata.moura'],
      [vidaPlena, 'Carlos Henrique', 'carlos.henrique'],
      [bemEstar, 'Luciana Ferraz', 'luciana.ferraz'],
    ]) {
      contato[cliente] = fixo(3, Object.keys(contato).length + 1);
      await s.query(
        `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email) VALUES ($1, $2, $3, $4, $5)`,
        [contato[cliente], DEMO.org, cliente, nome, `${email}@demo.technecare.local`]
      );
    }

    const orcamentos: Array<
      [string, Array<['part' | 'service', string, number, number, string?]>, string[]]
    > = [
      [
        vidaPlena,
        [
          ['service', 'Reparo da fonte do ultrassom', 1, 480000],
          ['part', 'Placa de controle', 1, 1290000, 'placa'],
        ],
        ['sent'],
      ],
      [
        saoLucas,
        [
          ['part', 'Placa de controle do ventilador', 1, 185000, 'placa'],
          ['service', 'Mão de obra técnica (h)', 4, 18000],
        ],
        ['sent', 'approved'],
      ],
      [
        bemEstar,
        [
          ['service', 'Revisão completa da cadeira odontológica', 1, 95000],
          ['part', 'Anel de vedação 22 mm', 4, 2100, 'oring'],
        ],
        [],
      ],
      [
        saoLucas,
        [
          ['part', 'Bateria selada 12 V', 2, 89000, 'bateria'],
          ['service', 'Troca e teste do DEA', 1, 25000],
        ],
        ['sent', 'rejected'],
      ],
      [
        vidaPlena,
        [
          ['service', 'Calibração de monitores (un)', 3, 32000],
          ['part', 'Cabo de ECG 5 vias', 2, 41000, 'cabo'],
        ],
        ['sent', 'viewed'],
      ],
    ];
    for (const [cliente, linhas, caminho] of orcamentos) {
      const q = await tentar('orçamento', () =>
        db.createQuote(s, {
          customerId: cliente,
          approverContactId: contato[cliente],
          validUntil: '2026-12-31',
          paymentTerms: '30 dias após faturamento',
        })
      );
      if (!q) continue;
      for (const [kind, descricao, qtd, preco, item] of linhas) {
        await tentar(`item ${descricao}`, () =>
          db.addQuoteItem(s, {
            quoteId: q,
            kind,
            description: descricao,
            quantity: qtd,
            unitPriceCents: preco,
            itemId: item ? itens[item] : null,
          })
        );
      }
      for (const passo of caminho) {
        await tentar(`orçamento → ${passo}`, () =>
          db.transitionQuote(
            s,
            q,
            passo as never,
            (passo === 'rejected'
              ? { rejectionReasonId: recusa.fora_de_contrato, note: 'Optou por substituir o equipamento.' }
              : {}) as never
          )
        );
      }
    }

    /* ---------------------------------------------- procedimentos (checklists) */

    // Dois procedimentos publicados, no motor versionado de sempre: o
    // checklist operacional da preventiva e o protocolo de calibração com
    // ponto de medição (nominal e tolerância como DADO; veredito "na").
    const checklistPreventiva = await tentar('checklist preventiva', async () => {
      const r = await db.createTemplateWithItems(s, {
        title: 'Preventiva de ventilador pulmonar',
        procedureKind: null,
        publish: true,
        items: [
          { kind: 'text', label: 'Número de série conferido com a etiqueta' },
          { kind: 'boolean', label: 'Alarmes sonoros e visuais funcionam?' },
          {
            kind: 'option',
            label: 'Estado do circuito e das conexões',
            options: ['Conforme', 'Não conforme', 'Não se aplica'],
            failingOptions: ['Não conforme'],
          },
          { kind: 'number', label: 'Horas de uso no horímetro', unit: 'h' },
          { kind: 'photo', label: 'Foto do painel após a preventiva' },
          { kind: 'text', label: 'Observações', required: false },
        ],
      });
      return r.key;
    });
    const checklistCalibracao = await tentar('checklist calibração', async () => {
      const r = await db.createTemplateWithItems(s, {
        title: 'Calibração de monitor — PNI',
        procedureKind: 'calibration',
        publish: true,
        items: [
          {
            kind: 'measurement',
            label: 'Pressão estática a 100 mmHg',
            unit: 'mmHg',
            nominalValue: 100,
            toleranceMinus: 3,
            tolerancePlus: 3,
            toleranceMode: 'absolute',
            readingsRequired: 3,
          },
          {
            kind: 'measurement',
            label: 'Pressão estática a 200 mmHg',
            unit: 'mmHg',
            nominalValue: 200,
            toleranceMinus: 3,
            tolerancePlus: 3,
            toleranceMode: 'absolute',
            readingsRequired: 3,
          },
          { kind: 'boolean', label: 'Teste de vazamento aprovado pelo técnico?' },
        ],
      });
      return r.key;
    });

    /* ---------------------------------------------------------- planos */

    for (const [nome, cliente, raiz, unidade] of [
      ['Preventiva trimestral de ventiladores', saoLucas, 'saoLucas', 'quarter'],
      ['Calibração anual de monitores', saoLucas, 'saoLucas', 'year'],
      ['Preventiva semestral — Vida Plena', vidaPlena, 'vidaPlena', 'month'],
    ] as const) {
      const calibra = nome.startsWith('Calibração');
      const plano = await tentar(`plano ${nome}`, () =>
        db.createPlan(s, {
          name: nome,
          customerId: cliente,
          description: 'Plano de demonstração.',
          autoGenerate: false,
          anchorDate: new Date('2026-01-01T00:00:00Z'),
        } as Parameters<typeof db.createPlan>[1])
      );
      if (!plano) continue;
      const tarefa = await tentar(`tarefa ${nome}`, () =>
        db.addPlanTask(s, {
          planId: plano,
          name: nome,
          targetKind: 'location_subtree',
          targetLocationId: local[raiz],
          workOrderTypeId: calibra ? natureza.calibracao : natureza.preventiva,
          checklistTemplateKey: (calibra ? checklistCalibracao : checklistPreventiva) ?? null,
          frequencyUnit: unidade,
          frequencyInterval: unidade === 'month' ? 6 : 1,
          leadTimeDays: 3650,
          toleranceDays: 5,
        } as Parameters<typeof db.addPlanTask>[1])
      );
      if (tarefa) await tentar(`ciclo ${nome}`, () => db.generateCycle(s, tarefa));
    }

    /* ------------------------------------------------------- automações */

    await tentar('automação 1', () =>
      db.createRule(s, {
        name: 'Avisar a coordenação em chamado de emergência',
        description: 'Quando um chamado chega com prioridade de emergência, notifica a coordenação.',
        triggerKind: 'event',
        triggerEvent: 'service_request.submitted',
        actions: [{ kind: 'notify', params: { audience: 'coordinators' } }],
      })
    );
  });

  /* --------------------------------------- envelhecimento — a operação tem passado */

  /*
   * Tudo nasceu "agora". Sem envelhecer, o indicador de tempo médio de reparo
   * daria minutos, e todas as OS teriam a mesma idade no quadro. Cada OS recua
   * o seu número de dias — e o histórico dela recua junto, para a linha do
   * tempo continuar coerente. A agenda NÃO recua: ela é relativa a hoje.
   */
  const colunas = async (tabela: string) =>
    (
      await t.raw(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'aurora' AND table_name = $1 AND data_type = 'timestamp with time zone'`,
        [tabela]
      )
    )
      .map((r) => String(r.column_name))
      .filter((c) => !c.startsWith('scheduled_'));

  const recuar = async (tabela: string, chave: string, id: string, dias: number) => {
    const cols = await colunas(tabela);
    if (cols.length === 0 || dias === 0) return;
    const set = cols.map((c) => `${c} = ${c} - make_interval(days => $2)`).join(', ');
    await t.raw(`ALTER TABLE aurora.${tabela} DISABLE TRIGGER USER`).catch(() => undefined);
    try {
      await t.raw(`UPDATE aurora.${tabela} SET ${set} WHERE ${chave} = $1`, [id, dias]);
    } catch (e) {
      falhas.push(`recuar ${tabela}: ${(e as Error).message}`);
    } finally {
      await t.raw(`ALTER TABLE aurora.${tabela} ENABLE TRIGGER USER`).catch(() => undefined);
    }
  };

  for (const { id, dias, reparoH } of ordensPorIdade) {
    await recuar('work_orders', 'id', id, dias);
    await recuar('work_order_status_history', 'work_order_id', id, dias);
    if (reparoH > 0) {
      // Gatilhos desligados pelo mesmo motivo do recuo: a OS fechada é somente
      // leitura, e com razão — aqui é a massa sendo montada, não uma edição.
      await t.raw(`ALTER TABLE aurora.work_orders DISABLE TRIGGER USER`);
      try {
        await t.raw(
          `UPDATE aurora.work_orders SET created_at = created_at - make_interval(hours => $2) WHERE id = $1`,
          [id, reparoH]
        );
      } finally {
        await t.raw(`ALTER TABLE aurora.work_orders ENABLE TRIGGER USER`);
      }
    }
  }
  /*
   * O fato analítico é mantido por gatilho — que esteve desligado durante o
   * recuo. Ele é ressincronizado com a mesma conta que o gatilho faz (0035).
   */
  await t.raw(
    `UPDATE aurora.fact_work_order f
        SET opened_at = CASE WHEN w.status_category = 'draft' THEN NULL ELSE w.created_at END,
            started_at = w.started_at, completed_at = w.completed_at, closed_at = w.closed_at,
            resolution_minutes = CASE WHEN w.completed_at IS NOT NULL
              THEN GREATEST(0, (EXTRACT(EPOCH FROM (w.completed_at - w.created_at)) / 60)::integer) END
       FROM aurora.work_orders w
      WHERE w.id = f.work_order_id AND w.organization_id = $1`,
    [DEMO.org]
  );
  for (const [i, { id, dias }] of chamadosPorIdade.entries()) {
    await recuar('service_requests', 'id', id, dias);
    await recuar('service_request_status_history', 'request_id', id, dias);
    /*
     * Primeira resposta entre 15 min e 3 h depois da abertura — e não no
     * mesmo milissegundo, que é o que a semeadura produz. A métrica lê o
     * HISTÓRICO (a primeira passagem por triagem), e por isso é ele que anda;
     * cada passo seguinte fica meia hora depois do anterior.
     */
    const minutos = [15, 40, 95, 180, 25, 60, 120][i % 7]!;
    await t
      .raw(`ALTER TABLE aurora.service_request_status_history DISABLE TRIGGER USER`)
      .catch(() => undefined);
    try {
      await t.raw(
        `WITH passos AS (
           SELECT h.ctid AS linha, row_number() OVER (ORDER BY h.changed_at) AS n
             FROM aurora.service_request_status_history h
            WHERE h.request_id = $1 AND h.to_status NOT IN ('draft', 'submitted')
         )
         UPDATE aurora.service_request_status_history h
            SET changed_at = r.submitted_at + make_interval(mins => $2 + (p.n::int - 1) * 30)
           FROM passos p, aurora.service_requests r
          WHERE h.ctid = p.linha AND r.id = $1 AND r.submitted_at IS NOT NULL`,
        [id, minutos]
      );
      await t.raw(
        `UPDATE aurora.service_requests
            SET first_response_at = submitted_at + make_interval(mins => $2)
          WHERE id = $1 AND first_response_at IS NOT NULL AND submitted_at IS NOT NULL`,
        [id, minutos]
      );
    } catch (e) {
      falhas.push(`primeira resposta: ${(e as Error).message}`);
    } finally {
      await t
        .raw(`ALTER TABLE aurora.service_request_status_history ENABLE TRIGGER USER`)
        .catch(() => undefined);
    }
  }

  if (falhas.length) {
    console.warn(
      `\nsemeadura da demo: ${falhas.length} passo(s) recusado(s) — seguem como informação:\n  ` +
        falhas.join('\n  ')
    );
  }
}
