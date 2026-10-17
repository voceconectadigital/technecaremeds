#!/usr/bin/env node
/**
 * Aurora — massa de dados para medir desempenho (SPEC v0.2 §41).
 *
 * A SPEC promete lista filtrada de ordens de serviço em menos de 400 ms com
 * 100 mil OS. Uma promessa dessas só significa alguma coisa se alguém a medir
 * com 100 mil OS de verdade — num banco com dez registros, tudo é rápido, e
 * toda decisão de índice parece certa.
 *
 * O QUE ESTA MASSA PRECISA TER PARA A MEDIÇÃO NÃO MENTIR
 *
 *   · DUAS organizações, com volumes diferentes. Uma só esconde o custo da
 *     RLS: com um tenant, o filtro por organização não separa nada, e o
 *     planejador escolhe caminhos que não escolheria em produção;
 *   · árvore de locais com profundidade real (cliente → unidade → setor →
 *     sala), porque consulta em árvore é onde o caminho materializado é posto
 *     à prova;
 *   · distribuição TORTA. Dados uniformes fazem qualquer índice parecer bom;
 *     no mundo real 20% dos ativos concentram 80% das OS, e é o ativo com
 *     quatro mil ordens que revela o índice faltando;
 *   · datas espalhadas por dois anos, porque a lista é ordenada por data e a
 *     seletividade do índice depende disso.
 *
 * Uso: DATABASE_URL=... node tools/bench/seed.mjs [--work-orders 100000]
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TSX_TSCONFIG_PATH ??= join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tsconfig.base.json'
);
require('tsx/cjs');

const { Pool } = require('pg');
const { newId } = require('../../packages/domain/src/id.ts');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

/**
 * Lê um argumento numérico da linha de comando.
 *
 * `indexOf` devolve -1 quando a bandeira não está lá, e `argv[-1 + 1]` é o
 * caminho do node — que vira `NaN`. O laço de medição rodava zero vezes e o
 * relatório quebrava numa linha que não tinha nada a ver.
 */
function numero(bandeira, padrao) {
  const i = process.argv.indexOf(bandeira);
  if (i < 0) return padrao;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

const alvo = numero('--work-orders', 100_000);

const pool = new Pool({ connectionString: url, max: 4 });

/** Gerador determinístico: a mesma massa em toda execução (ADR-021). */
let semente = 42;
function aleatorio() {
  // Congruencial linear. Não serve para criptografia e não precisa servir:
  // precisa ser reproduzível, para que duas medições comparem a mesma coisa.
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}

function escolher(lista) {
  return lista[Math.floor(aleatorio() * lista.length)];
}

/**
 * Escolha TORTA: os primeiros itens da lista recebem a maior parte.
 *
 * `aleatorio()^3` concentra perto de zero. É o que reproduz "20% dos ativos
 * concentram 80% das ordens" — e é o ativo com milhares de OS que revela o
 * índice faltando.
 */
function escolherTorto(lista) {
  const i = Math.floor(Math.pow(aleatorio(), 3) * lista.length);
  return lista[Math.min(i, lista.length - 1)];
}

/**
 * Prioridade com distribuição realista.
 *
 * A maioria é rotina; a emergência é rara. Distribuir por igual faria a lista
 * filtrada por "emergência" devolver vinte mil linhas, e a medição mediria um
 * cenário que não existe.
 */
function escolherPrioridade() {
  const r = aleatorio();
  if (r < 0.02) return 'emergency';
  if (r < 0.08) return 'very_urgent';
  if (r < 0.25) return 'urgent';
  if (r < 0.75) return 'none';
  return 'low';
}

const TITULOS = [
  'Alarme intermitente durante uso',
  'Não liga após queda de energia',
  'Vazamento no circuito pneumático',
  'Calibração fora da faixa',
  'Bateria não segura carga',
  'Display com falha de leitura',
  'Ruído anormal no compressor',
  'Preventiva trimestral',
  'Preventiva semestral',
  'Substituição de filtro',
];

async function q(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function main() {
  const inicio = Date.now();
  console.log(`Semeando ~${alvo.toLocaleString('pt-BR')} ordens de serviço…`);

  if (process.argv.includes('--reset')) {
    /*
     * A limpeza vai pela ORGANIZAÇÃO, e a cascata leva o resto.
     *
     * É a mesma cascata de produção: se apagar a organização deixasse órfão
     * em alguma tabela, este comando falharia — e falhar aqui é melhor do que
     * descobrir o órfão num cliente.
     */
    console.log('Apagando massa de benchmark anterior…');
    await q(`DELETE FROM aurora.organizations WHERE slug LIKE 'bench-%'`);
    await q(`DELETE FROM aurora.users WHERE email LIKE 'bench-%@bench.test'`);
  }

  const [{ existe }] = await q(
    `SELECT count(*)::int AS existe FROM aurora.organizations WHERE slug LIKE 'bench-%'`
  );
  if (existe > 0) {
    console.log('Massa de benchmark já existe. Rode com --reset para refazer.');
    process.exit(0);
  }

  /* ------------------------------------------------------- organizações */

  // Duas, e com volumes DIFERENTES: com um tenant só, o filtro por
  // organização não separa nada e o planejador escolhe outro caminho.
  const orgs = [
    { id: newId(), slug: 'bench-grande', nome: 'Benchmark Grande', fatia: 0.85 },
    { id: newId(), slug: 'bench-pequena', nome: 'Benchmark Pequena', fatia: 0.15 },
  ];

  for (const o of orgs) {
    await q(`INSERT INTO aurora.organizations (id, slug, name) VALUES ($1, $2, $3)`, [o.id, o.slug, o.nome]);
  }

  for (const org of orgs) {
    const quantas = Math.round(alvo * org.fatia);
    console.log(`  ${org.slug}: ${quantas.toLocaleString('pt-BR')} OS`);
    await semearOrganizacao(org.id, quantas, org.slug);
  }

  /* ------------------------------------------------------------ estatísticas */

  // Sem `ANALYZE`, o planejador trabalha com estimativas de uma tabela vazia e
  // escolhe varredura sequencial onde deveria usar índice. A medição sairia
  // pessimista por um motivo que não é o do código.
  console.log('Atualizando estatísticas do planejador…');
  await q('ANALYZE aurora.work_orders');
  await q('ANALYZE aurora.assets');
  await q('ANALYZE aurora.locations');
  await q('ANALYZE aurora.service_requests');

  const [{ total }] = await q(`SELECT count(*)::int AS total FROM aurora.work_orders`);
  console.log(
    `\n✓ ${Number(total).toLocaleString('pt-BR')} ordens de serviço em ${Math.round((Date.now() - inicio) / 1000)}s`
  );
  console.log(`  organizações de benchmark: ${orgs.map((o) => o.id).join(', ')}`);
}

async function semearOrganizacao(orgId, quantasOs, slug) {
  /* --------------------------------------------------------------- pessoa */

  const userId = newId();
  const memId = newId();
  await q(`INSERT INTO aurora.users (id, email, name) VALUES ($1, $2, $3)`, [
    userId,
    `${slug}@bench.test`,
    'Operador de benchmark',
  ]);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
       VALUES ($1, $2, $3, 'active', 'staff', true)`,
      [memId, orgId, userId]
    );
    await c.query(`INSERT INTO aurora.membership_scopes (membership_id, organization_id) VALUES ($1, $2)`, [
      memId,
      orgId,
    ]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  /* ------------------------------------------------------------ catálogos */

  const naturezas = [];
  for (const [chave, rotulo, sistema] of [
    ['corretiva', 'Corretiva', 'corrective'],
    ['preventiva', 'Preventiva', 'preventive'],
    ['calibracao', 'Calibração', null],
  ]) {
    const id = newId();
    await q(
      // `normalized_label` é coluna gerada: quem escreve nela é o banco.
      `INSERT INTO aurora.catalog_items (id, organization_id, catalog_key, key, label, system_key)
       VALUES ($1, $2, 'work_order_type', $3, $4, $5)`,
      [id, orgId, chave, rotulo, sistema]
    );
    naturezas.push(id);
  }

  /* --------------------------------------------------------------- estados */

  const estados = [];
  const definicoes = [
    ['aberta', 'Aberta', 'open', 1],
    ['em_execucao', 'Em execução', 'in_progress', 2],
    ['aguardando_peca', 'Aguardando peça', 'waiting', 3],
    ['concluida', 'Concluída', 'done', 4],
  ];
  for (const [chave, rotulo, categoria, posicao] of definicoes) {
    const id = newId();
    await q(
      `INSERT INTO aurora.work_order_statuses
         (id, organization_id, key, label, category, position, visible_on_board)
       VALUES ($1, $2, $3, $4, $5::aurora.status_category, $6, true)`,
      [id, orgId, chave, rotulo, categoria, posicao]
    );
    estados.push({ id, categoria });
  }

  /* -------------------------------------------------- clientes e locais */

  const clientes = [];
  const locais = [];
  const QUANTOS_CLIENTES = 12;

  for (let ci = 0; ci < QUANTOS_CLIENTES; ci++) {
    const cliente = newId();
    await q(
      `INSERT INTO aurora.customers (id, organization_id, name, is_internal)
       VALUES ($1, $2, $3, $4)`,
      [cliente, orgId, `Hospital ${ci + 1}`, ci === 0]
    );
    clientes.push(cliente);

    // Árvore de verdade: unidade → setor → sala. Consulta em árvore é onde o
    // caminho materializado do ADR-026 é posto à prova.
    const tipos = await tiposDaOrganizacao(orgId, ci === 0);
    const { unidade: tipoUnidade, setor: tipoSetor, sala: tipoSala } = tipos;

    for (let u = 0; u < 2; u++) {
      const unidade = await inserirLocal(orgId, cliente, tipoUnidade, null, `Unidade ${u + 1}`);
      for (let s = 0; s < 4; s++) {
        const setor = await inserirLocal(orgId, cliente, tipoSetor, unidade, `Setor ${s + 1}`);
        for (let r = 0; r < 4; r++) {
          locais.push(await inserirLocal(orgId, cliente, tipoSala, setor, `Sala ${r + 1}`));
        }
      }
    }
  }

  /* ---------------------------------------------------------------- ativos */

  const categoria = newId();
  await q(
    `INSERT INTO aurora.asset_categories (id, organization_id, name) VALUES ($1, $2, 'Equipamento médico')`,
    [categoria, orgId]
  );

  const ativos = [];
  // O cliente de cada ativo: a OS herda o cliente do próprio equipamento. Desde a
  // 0072 a OS recusa ativo de outro cliente — e com razão.
  const clienteDoAtivo = new Map();
  const QUANTOS_ATIVOS = Math.max(200, Math.round(quantasOs / 25));
  console.log(`    ${QUANTOS_ATIVOS} ativos, ${locais.length} locais…`);

  for (let lote = 0; lote < QUANTOS_ATIVOS; lote += 500) {
    const valores = [];
    const params = [];
    const quantos = Math.min(500, QUANTOS_ATIVOS - lote);
    for (let i = 0; i < quantos; i++) {
      const id = newId();
      const local = escolher(locais);
      const n = lote + i;
      const base = params.length;
      valores.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
      );
      params.push(
        id,
        orgId,
        clienteDoLocal(local, clientes, locais),
        categoria,
        local,
        `Ventilador ${n + 1}`,
        `PAT-${String(n + 1).padStart(6, '0')}`,
        `SN${String(n + 1).padStart(8, '0')}`,
        // O token do QR é obrigatório: a etiqueta impressa é a identidade
        // física do equipamento, e ativo sem token é ativo que a leitura não
        // encontra.
        newId().replace(/-/g, '')
      );
      ativos.push(id);
      clienteDoAtivo.set(id, clienteDoLocal(local, clientes, locais));
    }
    await q(
      `INSERT INTO aurora.assets
         (id, organization_id, customer_id, asset_category_id, location_id, name, asset_number, serial_number, qr_token)
       VALUES ${valores.join(', ')}`,
      params
    );
  }

  /* ------------------------------------------------------ ordens de serviço */

  const AGORA = Date.parse('2026-08-29T12:00:00Z');
  const DOIS_ANOS = 730 * 24 * 3600 * 1000;
  const LOTE = 1000;

  for (let feitas = 0; feitas < quantasOs; feitas += LOTE) {
    const quantas = Math.min(LOTE, quantasOs - feitas);
    const valores = [];
    const params = [];

    for (let i = 0; i < quantas; i++) {
      // Distribuição torta: 20% dos ativos concentram a maior parte.
      const ativo = escolherTorto(ativos);
      const estado = escolherTorto(estados);
      const criadaEm = new Date(AGORA - aleatorio() * DOIS_ANOS);
      const n = feitas + i;
      const base = params.length;

      valores.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
          `$${base + 7}, $${base + 8}::aurora.status_category, $${base + 9}::aurora.request_priority, ` +
          `$${base + 10}, $${base + 11}, $${base + 12})`
      );
      params.push(
        newId(),
        orgId,
        `OS-${String(n + 1).padStart(7, '0')}`,
        clienteDoAtivo.get(ativo),
        escolher(naturezas),
        ativo,
        estado.id,
        estado.categoria,
        // Os rótulos são os do enumerado do banco, e não os que a interface
        // mostra: 'emergency', 'very_urgent', 'urgent', 'low', 'none'.
        escolherPrioridade(),
        escolher(TITULOS),
        `Ventilador ${1 + Math.floor(aleatorio() * QUANTOS_ATIVOS)}`,
        criadaEm.toISOString()
      );
    }

    await q(
      `INSERT INTO aurora.work_orders
         (id, organization_id, number, customer_id, work_order_type_id, asset_id,
          status_id, status_category, priority, title, asset_name_snapshot, created_at)
       VALUES ${valores.join(', ')}`,
      params
    );

    if ((feitas / LOTE) % 10 === 0) {
      process.stdout.write(`\r    ${feitas + quantas} / ${quantasOs} OS`);
    }
  }
  process.stdout.write('\n');
}

/* -------------------------------------------------------------------------- */

const tiposCache = new Map();

/**
 * Os três tipos de local, em cadeia.
 *
 * Unidade é raiz; setor só existe sob unidade; sala só existe sob setor. A
 * restrição do banco recusa tipo que não é raiz e não diz sob quem fica — e
 * recusa com razão: tipo órfão é como se produz a árvore em que ninguém
 * consegue cadastrar nada.
 */
async function tiposDaOrganizacao(orgId, criar) {
  if (tiposCache.has(orgId)) return tiposCache.get(orgId);

  if (!criar) {
    const linhas = await q(`SELECT key, id FROM aurora.location_types WHERE organization_id = $1`, [orgId]);
    const mapa = Object.fromEntries(linhas.map((l) => [l.key, l.id]));
    tiposCache.set(orgId, mapa);
    return mapa;
  }

  const unidade = newId();
  const setor = newId();
  const sala = newId();

  await q(
    `INSERT INTO aurora.location_types
       (id, organization_id, key, name, can_be_root, allows_assets, position, allowed_parent_type_ids)
     VALUES ($1, $2, 'unidade', 'Unidade', true,  false, 1, '{}'),
            ($3, $2, 'setor',   'Setor',   false, false, 2, ARRAY[$1]::uuid[]),
            ($4, $2, 'sala',    'Sala',    false, true,  3, ARRAY[$3]::uuid[])`,
    [unidade, orgId, setor, sala]
  );

  const mapa = { unidade, setor, sala };
  tiposCache.set(orgId, mapa);
  return mapa;
}

const clientePorLocal = new Map();

async function inserirLocal(orgId, clienteId, tipoId, paiId, nome) {
  const id = newId();
  await q(
    `INSERT INTO aurora.locations (id, organization_id, customer_id, location_type_id, parent_id, name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, orgId, clienteId, tipoId, paiId, nome]
  );
  clientePorLocal.set(id, clienteId);
  return id;
}

function clienteDoLocal(localId, clientes) {
  return clientePorLocal.get(localId) ?? clientes[0];
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
