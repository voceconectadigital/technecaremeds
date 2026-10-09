#!/usr/bin/env node
/**
 * Téchne Care — a massa de DEMONSTRAÇÃO COMERCIAL dentro de UMA organização
 * que já existe.
 *
 * NÃO É A MASSA DE HOMOLOGAÇÃO, E NÃO É A DA DEMONSTRAÇÃO PÚBLICA.
 *
 * `tools/homologacao/semear.mjs` cria organizações próprias e se recusa a rodar
 * em produção. `tools/demo/semeadura.ts` vive num PGlite em memória e morre com
 * o processo. Esta aqui existe para outra coisa: uma organização de
 * demonstração REAL — criada antes por `admin:criar --nova-org`, com titular de
 * verdade — que precisa abrir no primeiro clique com cara de operação viva de
 * engenharia clínica hospitalar: hospital → setor → equipamento → solicitação →
 * triagem → OS → agenda → peça → indicadores.
 *
 * ELA SÓ ESCREVE NA ORGANIZAÇÃO PEDIDA, e nunca cria organização.
 *
 * `--org=<slug>` é obrigatório. Sem ele, ou com um slug que não existe, nada é
 * tentado. Toda escrita de negócio passa por `withTenant` com o papel da
 * aplicação, e é a RLS que garante o isolamento — não a boa vontade deste
 * arquivo. Os poucos passos administrativos (pessoas fictícias e o
 * envelhecimento das datas) filtram explicitamente pelo id da organização.
 *
 * EM PRODUÇÃO, SÓ A ORGANIZAÇÃO DE DEMONSTRAÇÃO.
 *
 * Com `AURORA_AMBIENTE=producao` o slug precisa estar na lista fechada abaixo.
 * Não há opção para forçar: uma massa de demonstração dentro do banco de um
 * cliente é o acidente que ninguém desfaz depois. O destino continua conferido
 * por `tools/db/destino.mjs`, como em todo comando de banco do Aurora.
 *
 * IDEMPOTENTE POR MARCADOR.
 *
 * O primeiro cliente semeado tem o código `DEMO-HSC`. Se ele já existe, o
 * comando diz "já semeado", mostra a contagem e sai com 0 sem tocar em nada —
 * exceto o perfil dos três contratos da própria massa, se ainda estiverem na
 * forma antiga (ver `ajustarPerfisDaDemonstracao`).
 * A semeadura de negócio roda numa transação só: ou o marcador e tudo o que
 * vem com ele entram juntos, ou nada entra.
 *
 * TUDO É FICTÍCIO. As pessoas são personagens, os endereços terminam em
 * `@demo.technecare.invalid` (TLD reservado pela RFC 2606 — não recebe
 * mensagem), ninguém ganha senha nem credencial, e fabricantes e modelos são
 * inventados.
 *
 * Uso:
 *   DATABASE_URL=... node tools/demo/semear-org.mjs --org=<slug>
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.TSX_TSCONFIG_PATH ??= join(raiz, 'tsconfig.base.json');
// Fonte TypeScript via tsx em desenvolvimento; `dist/` na imagem (tools/lib/fonte.mjs).
const { carregarFonte } = await import('../lib/fonte.mjs');

const { Pool } = require('pg');

/* -------------------------------------------------------------------------- */
/* as recusas                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * As ÚNICAS organizações que esta massa pode tocar em produção.
 *
 * Lista no código, e não em variável de ambiente: ampliá-la exige um commit
 * revisado, que é exatamente o atrito que uma decisão dessas merece.
 */
const PERMITIDAS_EM_PRODUCAO = ['technecare-demo'];

/** Marcador de idempotência: o código do primeiro cliente semeado. */
const MARCADOR = 'DEMO-HSC';

/** Domínio reservado (RFC 2606): nenhum endereço daqui recebe mensagem. */
const DOMINIO = 'demo.technecare.invalid';

function recusar(mensagem) {
  process.stderr.write(`\nRECUSADO: ${mensagem}\n\n`);
  process.exit(1);
}

const argumentos = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
    })
);

if (argumentos.help || argumentos.ajuda) {
  process.stdout.write('Uso: DATABASE_URL=... node tools/demo/semear-org.mjs --org=<slug>\n');
  process.exit(0);
}

const slug = typeof argumentos.org === 'string' ? argumentos.org.trim().toLowerCase() : '';
if (!slug) {
  recusar('informe a organização com --org=<slug>. Este comando não escolhe organização sozinho.');
}
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
  recusar(`slug inválido: "${slug}".`);
}

if (process.env.AURORA_AMBIENTE === 'producao' && !PERMITIDAS_EM_PRODUCAO.includes(slug)) {
  recusar(
    `AURORA_AMBIENTE=producao e a organização "${slug}" não está na lista de demonstração\n` +
      `(${PERMITIDAS_EM_PRODUCAO.join(', ')}). Massa de demonstração não entra em organização de cliente.\n` +
      'Não há opção para forçar.'
  );
}

const url = process.env.DATABASE_URL;
const { conferirOuSair } = await import('../db/destino.mjs');
conferirOuSair(url);

const pool = new Pool({ connectionString: url, max: 4 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

const db = carregarFonte(raiz, 'packages', 'db', 'src', 'index.ts');
const { pgPoolAdapter } = carregarFonte(raiz, 'packages', 'db', 'src', 'adapters.ts');
const { buildContext, PERMISSION_KEYS, newId } = carregarFonte(raiz, 'packages', 'domain', 'src', 'index.ts');

/* -------------------------------------------------------------------------- */
/* passos e falhas                                                            */
/* -------------------------------------------------------------------------- */

/** Passos recusados que NÃO derrubam a massa — aparecem no fim, com o motivo. */
const falhas = [];
const mensagem = (e) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** Passo administrativo isolado: falha vira aviso, e o comando segue. */
async function passo(rotulo, fn) {
  try {
    return await fn();
  } catch (e) {
    falhas.push(`${rotulo}: ${mensagem(e)}`);
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* o elenco — personagens, não gente                                          */
/* -------------------------------------------------------------------------- */

// [chave, nome, local do e-mail, papel de fábrica, assento, cargo, custo/hora]
// prettier-ignore
const PESSOAS = [
  ['coord', 'Fernanda Alves', 'fernanda.alves', 'coordinator', 'staff', 'Coordenadora de engenharia clínica', 95],
  ['rafael', 'Rafael Souza', 'rafael.souza', 'technician', 'staff', 'Técnico em equipamentos médicos', 68],
  ['juliana', 'Juliana Prado', 'juliana.prado', 'technician', 'staff', 'Técnica em equipamentos médicos', 68],
  ['marcos', 'Marcos Lima', 'marcos.lima', 'technician', 'staff', 'Técnico de imagem e calibração', 74],
  ['beatriz', 'Beatriz Costa', 'beatriz.costa', 'requester', 'portal', 'Enfermeira — UTI Adulto', null],
];

/** A prioridade em palavras de gente, traduzida para o enum do domínio. */
const PRIORIDADE = {
  emergencia: 'emergency',
  muito_urgente: 'very_urgent',
  urgente: 'urgent',
  normal: 'low',
  baixa: 'none',
};

/* -------------------------------------------------------------------------- */
/* datas relativas a AGORA — a demonstração não envelhece                     */
/* -------------------------------------------------------------------------- */

const agora = new Date();
const DIA = 86_400_000;
const HORA = 3_600_000;
const isoData = (d) => d.toISOString().slice(0, 10);
const emDias = (n) => isoData(new Date(agora.getTime() + n * DIA));

/**
 * Uma janela de agenda em horário de Brasília (UTC−3), relativa a hoje.
 *
 * Para HOJE, a hora pedida é empurrada para depois de agora: uma visita "de
 * hoje às 9h" semeada às 15h nasceria vencida, e a agenda mostraria como
 * atraso o que é só a hora em que o comando rodou. Se não cabe mais hoje,
 * vai para amanhã. Dias negativos ficam onde estão — são os atrasos de
 * propósito.
 */
function janela(dias, hora, minutos) {
  const br = new Date(agora.getTime() - 3 * HORA);
  let d = dias;
  let h = hora;
  if (dias === 0) {
    const agoraBr = br.getUTCHours() + br.getUTCMinutes() / 60;
    if (h < agoraBr + 1) h = Math.ceil(agoraBr + 1);
    if (h + minutos / 60 > 20) {
      d = 1;
      h = hora;
    }
  }
  const inicio = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + d, h + 3));
  return { startsAt: inicio, endsAt: new Date(inicio.getTime() + minutos * 60_000) };
}

/**
 * Há quantos minutos foi "(hoje − dias) às hora:minuto" de Brasília.
 *
 * É o que o envelhecimento recua. Recuar dias inteiros fazia todo chamado
 * nascer na mesma hora do relógio em que o comando rodou — às 2h da manhã, se
 * foi de madrugada. Com hora marcada, a fila mostra um plantão de verdade.
 * Hoje, numa hora que ainda não chegou, vira "há pouco".
 */
function minutosAtras(dias, hora, minuto = 0) {
  const br = new Date(agora.getTime() - 3 * HORA);
  const alvo = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() - dias, hora + 3, minuto);
  const m = Math.round((agora.getTime() - alvo) / 60_000);
  return m >= 10 ? m : 10 + ((hora * 7 + minuto) % 50);
}

/* -------------------------------------------------------------------------- */

async function contagem(orgId) {
  const um = async (sql) => Number((await q(sql, [orgId]))[0].n);
  return {
    clientes: await um(
      `SELECT count(*)::int AS n FROM aurora.customers WHERE organization_id = $1 AND deleted_at IS NULL`
    ),
    locais: await um(
      `SELECT count(*)::int AS n FROM aurora.locations WHERE organization_id = $1 AND deleted_at IS NULL`
    ),
    equipamentos: await um(`SELECT count(*)::int AS n FROM aurora.assets WHERE organization_id = $1`),
    solicitacoes: await um(
      `SELECT count(*)::int AS n FROM aurora.service_requests WHERE organization_id = $1`
    ),
    ordens: await um(`SELECT count(*)::int AS n FROM aurora.work_orders WHERE organization_id = $1`),
    agenda: await um(
      `SELECT count(*)::int AS n FROM aurora.work_orders
        WHERE organization_id = $1 AND scheduled_start IS NOT NULL
          AND status_category NOT IN ('closed', 'cancelled')`
    ),
    contratos: await um(
      `SELECT count(*)::int AS n FROM aurora.contracts WHERE organization_id = $1 AND status = 'active'`
    ),
    itens: await um(`SELECT count(*)::int AS n FROM aurora.inventory_items WHERE organization_id = $1`),
    abaixoDoMinimo: await um(
      `SELECT count(*)::int AS n FROM aurora.stock_balances
        WHERE organization_id = $1 AND min_qty > 0 AND on_hand < min_qty`
    ),
    ciclos: await um(`SELECT count(*)::int AS n FROM aurora.plan_cycles WHERE organization_id = $1`),
    apontamentos: await um(`SELECT count(*)::int AS n FROM aurora.time_entries WHERE organization_id = $1`),
    pessoas: await um(
      `SELECT count(*)::int AS n FROM aurora.memberships
        WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'active'`
    ),
  };
}

function imprimirContagem(org, c) {
  process.stdout.write(
    `\n  organização        ${org.name} (${org.slug})\n` +
      `  pessoas ativas     ${c.pessoas}\n` +
      `  clientes           ${c.clientes}\n` +
      `  locais             ${c.locais}\n` +
      `  equipamentos       ${c.equipamentos}\n` +
      `  solicitações       ${c.solicitacoes}\n` +
      `  ordens de serviço  ${c.ordens}\n` +
      `  na agenda          ${c.agenda}\n` +
      `  contratos vigentes ${c.contratos}\n` +
      `  itens de estoque   ${c.itens}\n` +
      `  abaixo do mínimo   ${c.abaixoDoMinimo}\n` +
      `  ciclos de plano    ${c.ciclos}\n` +
      `  apontamentos       ${c.apontamentos}\n`
  );
}

/* -------------------------------------------------------------------------- */

/*
 * O PERFIL DE CADA CONTRATO DA DEMONSTRAÇÃO, e o título que a massa antiga
 * usava no lugar dele.
 *
 * A massa até 09/10/2026 punha a "forma de vender" no título e em `kind`
 * ("Atendimento sob demanda", "Preventiva programada") — e o cliente leu,
 * com razão, como tipo de contrato. Tipo de contrato é o perfil.
 */
const PERFIL_DEMO = {
  hsc: {
    codigo: MARCADOR,
    perfil: 'expert',
    titulo: 'Contrato de manutenção — Hospital Santa Clara',
    tituloAntigo: 'Manutenção integral — Hospital Santa Clara',
  },
  cvp: {
    codigo: 'DEMO-CVP',
    perfil: 'complete',
    titulo: 'Contrato de manutenção — Clínica Vida Plena',
    tituloAntigo: 'Preventiva programada — Clínica Vida Plena',
  },
  idc: {
    codigo: 'DEMO-IDC',
    perfil: 'basic',
    titulo: 'Contrato de manutenção — Instituto do Coração',
    tituloAntigo: 'Atendimento sob demanda — Instituto do Coração',
  },
};

/**
 * Ajusta, numa organização JÁ semeada, só os três contratos da demonstração.
 *
 * Estreito de propósito: o contrato precisa ser do cliente marcado da massa
 * (`DEMO-*`), estar ainda sem perfil e ter exatamente o título antigo que esta
 * massa gravou. Contrato que alguém editou na demonstração não é tocado, e
 * contrato de cliente de verdade não casa com nada disto. Rodar de novo não
 * acha mais nada para ajustar.
 */
async function ajustarPerfisDaDemonstracao(orgId) {
  let ajustados = 0;
  for (const { codigo, perfil, titulo, tituloAntigo } of Object.values(PERFIL_DEMO)) {
    const linhas = await q(
      `UPDATE aurora.contracts ct
          SET profile = $3::aurora.contract_profile, title = $4, kind = NULL, updated_at = now()
         FROM aurora.customers cu
        WHERE ct.organization_id = $1
          AND cu.organization_id = $1
          AND cu.id = ct.customer_id
          AND cu.code = $2
          AND ct.profile IS NULL
          AND ct.title = $5
        RETURNING ct.id`,
      [orgId, codigo, perfil, titulo, tituloAntigo]
    );
    ajustados += linhas.length;
  }
  return ajustados;
}

async function main() {
  /* ----------------------------------------------------- a organização */

  const [org] = await q(
    `SELECT id, slug, name FROM aurora.organizations
      WHERE slug = $1 AND deleted_at IS NULL AND status = 'active'`,
    [slug]
  );
  if (!org) {
    process.stderr.write(`\nRECUSADO: não há organização ativa com slug "${slug}". Nada foi alterado.\n\n`);
    process.exitCode = 1;
    return;
  }

  const [marcado] = await q(
    `SELECT 1 FROM aurora.customers WHERE organization_id = $1 AND code = $2 AND deleted_at IS NULL`,
    [org.id, MARCADOR]
  );
  if (marcado) {
    const ajustados = await ajustarPerfisDaDemonstracao(org.id);
    process.stdout.write(
      ajustados > 0
        ? `\njá semeado — a organização "${slug}" já tem o cliente ${MARCADOR}. ` +
            `Só o perfil de ${ajustados} contrato(s) da demonstração foi ajustado.\n`
        : `\njá semeado — a organização "${slug}" já tem o cliente ${MARCADOR}. Nada foi alterado.\n`
    );
    imprimirContagem(org, await contagem(org.id));
    return;
  }

  /*
   * QUEM AGE É O TITULAR, e não um vínculo inventado.
   *
   * As OS, os comentários e o histórico precisam de um autor que exista na
   * organização. O titular criado por `admin:criar` é o candidato natural; na
   * falta dele, quem tiver papel `owner` ou `admin`. Sem nenhum dos dois a
   * organização não está pronta, e semear nela seria esconder isso.
   */
  const [titular] = await q(
    `SELECT m.id, m.user_id
       FROM aurora.memberships m
       JOIN aurora.users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.organization_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
        AND (m.is_owner OR EXISTS (
              SELECT 1 FROM aurora.membership_roles mr
                JOIN aurora.roles r ON r.id = mr.role_id
               WHERE mr.membership_id = m.id AND r.key IN ('owner', 'admin') AND r.deleted_at IS NULL))
      ORDER BY m.is_owner DESC, m.created_at
      LIMIT 1`,
    [org.id]
  );
  if (!titular) {
    process.stderr.write(
      `\nRECUSADO: a organização "${slug}" não tem titular nem administrador ativo.\n` +
        'Crie a conta com `npm run admin:criar -- --org=' +
        slug +
        '` antes de semear. Nada foi alterado.\n\n'
    );
    process.exitCode = 1;
    return;
  }

  /*
   * Nome de cliente é único por organização. Se algum dos quatro já existe sem
   * o marcador, alguém cadastrou à mão — e misturar a massa com dado de gente
   * é pior do que não semear.
   */
  const NOMES_CLIENTES = [
    'Hospital Santa Clara',
    'Hospital São Lucas',
    'Clínica Vida Plena',
    'Instituto do Coração',
  ];
  const colisao = await q(
    `SELECT name FROM aurora.customers
      WHERE organization_id = $1 AND deleted_at IS NULL AND lower(btrim(name)) = ANY($2::text[])`,
    [org.id, NOMES_CLIENTES.map((n) => n.toLowerCase())]
  );
  if (colisao.length > 0) {
    process.stderr.write(
      `\nRECUSADO: a organização já tem cliente(s) com o mesmo nome da massa (${colisao
        .map((c) => c.name)
        .join(', ')}) e sem o marcador ${MARCADOR}. Nada foi alterado.\n\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nsemeando a organização "${org.name}" (${org.slug})…\n`);

  /* ------------------------------------------- catálogos espelho do código */

  // O catálogo de permissões e as definições de catálogo são espelho do código
  // (§21) e não vêm por migração. Ressincronizar é idempotente e é o mesmo que
  // a aplicação faz ao subir — sem isso, o papel de fábrica ou o item de
  // catálogo aponta para uma chave que o banco ainda não conhece.
  const admin = pgPoolAdapter(pool, null);
  await db.syncPermissionCatalog(admin);
  await db.syncCatalogDefinitions(admin);

  /* ------------------------------------------------------------- pessoas */

  /*
   * As pessoas são GLOBAIS (`aurora.users`), os vínculos são da organização.
   *
   * Reaproveita o usuário pelo e-mail se ele já existe — a mesma personagem em
   * duas organizações de demonstração é legítimo, e duplicar daria erro no
   * índice único. Ninguém recebe senha: sem `user_credentials`, ninguém entra
   * como essas pessoas.
   *
   * Vínculo e escopo na MESMA transação: o gatilho da 0039 recusa o vínculo
   * sem escopo no COMMIT.
   */
  const vinculo = { titular: titular.id };
  await admin.transaction(async (tx) => {
    for (const [chave, nome, local, , assento, cargo, custo] of PESSOAS) {
      const email = `${local}@${DOMINIO}`;
      let [user] = await tx.query(
        `SELECT id FROM aurora.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [email]
      );
      if (!user) {
        user = { id: newId() };
        await tx.query(`INSERT INTO aurora.users (id, email, name, status) VALUES ($1, $2, $3, 'active')`, [
          user.id,
          email,
          nome,
        ]);
      }
      const [existente] = await tx.query(
        `SELECT id FROM aurora.memberships WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [org.id, user.id]
      );
      let mem = existente?.id;
      if (!mem) {
        mem = newId();
        await tx.query(
          `INSERT INTO aurora.memberships
             (id, organization_id, user_id, status, seat_type, is_owner, job_title, hourly_cost, joined_at)
           VALUES ($1, $2, $3, 'active', $4::aurora.seat_type, false, $5, $6, now())`,
          [mem, org.id, user.id, assento, cargo, assento === 'staff' ? custo : null]
        );
      }
      await tx.query(
        `INSERT INTO aurora.membership_scopes (membership_id, organization_id)
         VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`,
        [mem, org.id]
      );
      vinculo[chave] = mem;
    }
    // O titular precisa de escopo para ENXERGAR o que vai ser semeado. Sem
    // linha, ele não veria local nenhum (falha fechada, invisível na tela).
    await tx.query(
      `INSERT INTO aurora.membership_scopes (membership_id, organization_id)
       VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`,
      [titular.id, org.id]
    );
  });

  /* ---------------------------------------------------- a massa de negócio */

  const conexao = pgPoolAdapter(pool, 'aurora_app');
  const contexto = (mem) =>
    buildContext({
      organizationId: org.id,
      membershipId: mem,
      actorKind: 'system',
      requestId: 'demo-semear-org',
      permissions: PERMISSION_KEYS,
    });

  /** O que o envelhecimento precisa recuar depois do COMMIT. */
  const envelhecer = { ordens: [], chamados: [] };
  const resumo = { os: 0, chamados: 0, agenda: 0, comentarios: 0, apontamentos: 0 };

  await db.withTenant(conexao, contexto(titular.id), async (s) => {
    /*
     * Passo opcional: se a regra do domínio o recusar, a massa segue sem ele.
     * O SAVEPOINT é o que permite seguir — sem ele, a primeira recusa abortaria
     * a transação inteira e levaria a semeadura junto.
     */
    const tentar = async (rotulo, fn) => {
      await s.query('SAVEPOINT passo');
      try {
        const r = await fn();
        await s.query('RELEASE SAVEPOINT passo');
        return r;
      } catch (e) {
        await s.query('ROLLBACK TO SAVEPOINT passo');
        falhas.push(`${rotulo}: ${mensagem(e)}`);
        return undefined;
      }
    };
    /** A mesma transação, com outra pessoa como autora (comentário do técnico). */
    const como = (mem) => ({ context: contexto(mem), query: (sql, p) => s.query(sql, p) });

    /* ------------------------------------------- papéis, estados, catálogos */

    // Os papéis de fábrica só são provisionados se faltar algum: reprovisionar
    // regravaria as permissões de papéis que a organização já personalizou.
    const papeisExistentes = new Map(
      (await s.query(`SELECT id, key FROM aurora.roles WHERE deleted_at IS NULL`)).map((r) => [r.key, r.id])
    );
    const precisa = new Set(PESSOAS.map((p) => p[3]));
    const papeis = [...precisa].every((k) => papeisExistentes.has(k))
      ? papeisExistentes
      : await db.provisionFactoryRoles(s);
    for (const [chave, , , papel] of PESSOAS) await db.assignRole(s, vinculo[chave], papeis.get(papel));

    const { waitReasons } = await db.provisionWorkOrderStates(s);
    const tipos = await db.provisionStarterLocationTypes(s);

    /** Item de catálogo, reaproveitando o que a organização já tiver. */
    const itemDeCatalogo = async (catalogKey, key, label, systemKey = null) => {
      const [ja] = await s.query(
        `SELECT id FROM aurora.catalog_items
          WHERE catalog_key = $1 AND archived_at IS NULL
            AND (key = $2 OR ($3::text IS NOT NULL AND system_key = $3)
                 OR normalized_label = aurora.normalize_label($4))
          ORDER BY (key = $2) DESC LIMIT 1`,
        [catalogKey, key, systemKey, label]
      );
      return ja?.id ?? (await db.createCatalogItem(s, { catalogKey, key, label, systemKey }));
    };

    const natureza = {};
    for (const [key, label, systemKey] of [
      ['corretiva', 'Corretiva', 'corrective'],
      ['preventiva', 'Preventiva', 'preventive'],
      ['calibracao', 'Calibração', null],
      ['seguranca_eletrica', 'Teste de segurança elétrica', null],
    ]) {
      natureza[key] = await itemDeCatalogo('work_order_type', key, label, systemKey);
    }
    const recusa = {};
    for (const [key, label] of [
      ['fora_de_contrato', 'Fora do escopo do contrato'],
      ['duplicada', 'Chamado em duplicidade'],
    ]) {
      recusa[key] = await tentar(`motivo de recusa ${key}`, () =>
        itemDeCatalogo('rejection_reason', key, label)
      );
    }

    /* --------------------------------------------------- clientes e locais */

    // [chave, código, nome, segmento]. O primeiro é o MARCADOR de idempotência.
    const cliente = {};
    for (const [chave, code, name, segment] of [
      ['hsc', MARCADOR, 'Hospital Santa Clara', 'Hospital geral'],
      ['hsl', 'DEMO-HSL', 'Hospital São Lucas', 'Hospital geral'],
      ['cvp', 'DEMO-CVP', 'Clínica Vida Plena', 'Clínica de diagnóstico'],
      ['idc', 'DEMO-IDC', 'Instituto do Coração', 'Hospital especializado'],
    ]) {
      cliente[chave] = await db.createCustomer(s, { name, code, segment, isInternal: false });
    }

    /*
     * SLA HOSPITALAR, 24×7, ligado SÓ aos clientes da massa.
     *
     * Sem política, nenhum relógio nasce e o indicador de SLA fica vazio — que
     * na demonstração parece módulo quebrado. A política entra como padrão dos
     * quatro clientes semeados (`customers.default_sla_policy_id`), e não da
     * organização: o que a organização já tiver configurado continua valendo
     * para o resto. Tem de vir ANTES das solicitações e das OS, que é quando
     * os relógios nascem.
     */
    await tentar('política de SLA', async () => {
      const nome = 'SLA hospitalar 24×7 — demonstração';
      const [ja] = await s.query(
        `SELECT id FROM aurora.sla_policies WHERE name = $1 AND archived_at IS NULL`,
        [nome]
      );
      const politica = ja?.id ?? (await db.createSlaPolicy(s, { name: nome }));
      // [prioridade, resposta, atendimento no local, resolução] em minutos corridos
      for (const [prioridade, resposta, local_, resolucao] of [
        ['emergency', 15, 60, 240],
        ['very_urgent', 30, 120, 480],
        ['urgent', 60, 240, 1440],
        ['low', 240, 1440, 4320],
        ['none', 480, 2880, 10080],
      ]) {
        await db.setSlaTarget(s, politica, prioridade, 'response', resposta, false);
        await db.setSlaTarget(s, politica, prioridade, 'onsite', local_, false);
        await db.setSlaTarget(s, politica, prioridade, 'resolution', resolucao, false);
      }
      await s.query(`UPDATE aurora.customers SET default_sla_policy_id = $1 WHERE id = ANY($2::uuid[])`, [
        politica,
        Object.values(cliente),
      ]);
    });

    const local = {};
    const clienteDoLocal = {};
    for (const [chave, cli, nome, pai, tipo] of [
      // Hospital Santa Clara — unidade → prédio → andar → setor → sala
      ['hsc', 'hsc', 'Hospital Santa Clara — Unidade Centro', null, 'unidade'],
      ['hscBlocoA', 'hsc', 'Bloco A', 'hsc', 'predio'],
      ['hscTerreo', 'hsc', 'Térreo', 'hscBlocoA', 'andar'],
      ['hscEmerg', 'hsc', 'Emergência', 'hscTerreo', 'setor'],
      ['hsc2', 'hsc', '2º andar', 'hscBlocoA', 'andar'],
      ['hscUti', 'hsc', 'UTI Adulto', 'hsc2', 'setor'],
      ['hscLeito04', 'hsc', 'Leito 04', 'hscUti', 'sala'],
      ['hscLeito09', 'hsc', 'Leito 09', 'hscUti', 'sala'],
      ['hsc3', 'hsc', '3º andar', 'hscBlocoA', 'andar'],
      ['hscCc', 'hsc', 'Centro Cirúrgico', 'hsc3', 'setor'],
      ['hscSala2', 'hsc', 'Sala Cirúrgica 2', 'hscCc', 'sala'],
      ['hscCme', 'hsc', 'CME — Central de Material Esterilizado', 'hsc3', 'setor'],
      // Hospital São Lucas
      ['hsl', 'hsl', 'Hospital São Lucas', null, 'unidade'],
      ['hslPredio', 'hsl', 'Prédio Principal', 'hsl', 'predio'],
      ['hslTerreo', 'hsl', 'Térreo', 'hslPredio', 'andar'],
      ['hslEmerg', 'hsl', 'Pronto-socorro', 'hslTerreo', 'setor'],
      ['hslImagem', 'hsl', 'Diagnóstico por Imagem', 'hslTerreo', 'setor'],
      ['hslSalaTc', 'hsl', 'Sala de Tomografia', 'hslImagem', 'sala'],
      ['hsl1', 'hsl', '1º andar', 'hslPredio', 'andar'],
      ['hslHemo', 'hsl', 'Hemodiálise', 'hsl1', 'setor'],
      // Clínica Vida Plena — clínica pequena: setor direto sob a unidade
      ['cvp', 'cvp', 'Clínica Vida Plena', null, 'unidade'],
      ['cvpImagem', 'cvp', 'Imagem — Ultrassonografia', 'cvp', 'setor'],
      ['cvpCardio', 'cvp', 'Cardiologia', 'cvp', 'setor'],
      // Instituto do Coração
      ['idc', 'idc', 'Instituto do Coração', null, 'unidade'],
      ['idcBloco', 'idc', 'Bloco Cardiológico', 'idc', 'predio'],
      ['idcUtiCor', 'idc', 'UTI Coronariana', 'idcBloco', 'setor'],
      ['idcHemodin', 'idc', 'Hemodinâmica', 'idcBloco', 'setor'],
    ]) {
      local[chave] = await db.createLocation(s, {
        customerId: cliente[cli],
        parentId: pai ? local[pai] : undefined,
        locationTypeId: tipos.get(tipo) ?? tipos.get('setor'),
        name: nome,
      });
      clienteDoLocal[chave] = cliente[cli];
    }

    /*
     * O titular enxerga tudo o que foi semeado. Com escopo 'all' (o padrão de
     * `admin:criar`) não há o que fazer; com escopo 'listed', os clientes e as
     * unidades novas entram na lista — senão o dono da demonstração abriria
     * uma tela vazia.
     */
    await s.query(
      `UPDATE aurora.membership_scopes
          SET customer_ids = CASE WHEN customer_scope = 'listed'
                                  THEN (SELECT array_agg(DISTINCT x) FROM unnest(customer_ids || $2::uuid[]) x)
                                  ELSE customer_ids END,
              location_ids = CASE WHEN location_scope = 'listed'
                                  THEN (SELECT array_agg(DISTINCT x) FROM unnest(location_ids || $3::uuid[]) x)
                                  ELSE location_ids END
        WHERE membership_id = $1`,
      [titular.id, Object.values(cliente), [local.hsc, local.hsl, local.cvp, local.idc]]
    );
    // A Beatriz é enfermeira do Santa Clara: o portal dela mostra só esse cliente.
    await tentar('escopo da solicitante', () =>
      s.query(
        `UPDATE aurora.membership_scopes SET customer_scope = 'listed', customer_ids = $2
          WHERE membership_id = $1 AND customer_scope = 'all'`,
        [vinculo.beatriz, [cliente.hsc]]
      )
    );

    /* ----------------------------------------------- classificação de ativos */

    const categoria = {};
    for (const [chave, nome, calibra, eletrico] of [
      ['ventilador', 'Ventilador pulmonar', true, true],
      ['monitor', 'Monitor multiparamétrico', true, true],
      ['desfibrilador', 'Desfibrilador', true, true],
      ['bomba', 'Bomba de infusão', true, true],
      ['autoclave', 'Autoclave', true, false],
      ['tomografo', 'Tomógrafo', false, true],
      ['ultrassom', 'Ultrassom', false, true],
      ['hemodialise', 'Máquina de hemodiálise', true, true],
      ['ecg', 'Eletrocardiógrafo', true, true],
      ['mesa', 'Mesa cirúrgica', false, true],
    ]) {
      const [ja] = await s.query(
        `SELECT id FROM aurora.asset_categories
          WHERE normalized_name = aurora.normalize_label($1) AND archived_at IS NULL`,
        [nome]
      );
      categoria[chave] =
        ja?.id ??
        (await db.createAssetCategory(s, {
          name: nome,
          requiresCalibration: calibra,
          requiresElectricalTest: eletrico,
        }));
    }

    const criticidade = {};
    for (const [chave, nome, score, mult, cor] of [
      ['vida', 'Suporte à vida', 5, 0.5, '#d64545'],
      ['alta', 'Alta', 4, 0.75, '#e08a2b'],
      ['media', 'Média', 3, 1, '#3d7bd9'],
    ]) {
      criticidade[chave] = await tentar(`criticidade ${nome}`, async () => {
        const [ja] = await s.query(
          `SELECT id FROM aurora.criticality_levels WHERE lower(name) = lower($1) OR score = $2 LIMIT 1`,
          [nome, score]
        );
        return (
          ja?.id ?? (await db.createCriticality(s, { name: nome, score, slaMultiplier: mult, color: cor }))
        );
      });
    }

    /* ----------------------------------------------------------- equipamentos */

    // Fabricantes e modelos INVENTADOS: marca real com modelo falso seria a
    // pior das duas coisas numa demonstração comercial.
    // [chave, nome, categoria, local, patrimônio, série, fabricante, modelo,
    //  criticidade, aquisição, valor, situação]
    // prettier-ignore
    const ATIVOS = [
      ['vent1', 'Ventilador pulmonar VM-700', 'ventilador', 'hscLeito04', 'HSC-VP-0101', 'VM7-22-01873', 'Vitalis Médica', 'VM-700', 'vida', '2022-03-10', 132000, 'active'],
      ['vent2', 'Ventilador pulmonar VM-700', 'ventilador', 'hscLeito09', 'HSC-VP-0102', 'VM7-22-01874', 'Vitalis Médica', 'VM-700', 'vida', '2022-03-10', 132000, 'active'],
      ['vent3', 'Ventilador de transporte VT-30', 'ventilador', 'hslEmerg', 'HSL-VP-0201', 'VT30-20-00911', 'Vitalis Médica', 'VT-30', 'vida', '2020-07-02', 54000, 'under_maintenance'],
      ['mon1', 'Monitor multiparamétrico MX-12', 'monitor', 'hscLeito04', 'HSC-MM-0111', 'MX12-21-05530', 'Cardiomed Sistemas', 'MX-12', 'alta', '2021-05-18', 31000, 'active'],
      ['mon2', 'Monitor multiparamétrico MX-12', 'monitor', 'idcUtiCor', 'IDC-MM-0401', 'MX12-23-07714', 'Cardiomed Sistemas', 'MX-12', 'alta', '2023-02-14', 33500, 'active'],
      ['desf1', 'Desfibrilador bifásico DF-360', 'desfibrilador', 'hslEmerg', 'HSL-DF-0211', 'DF360-20-00088', 'Cardiomed Sistemas', 'DF-360', 'vida', '2020-04-12', 27000, 'active'],
      ['desf2', 'Desfibrilador bifásico DF-360', 'desfibrilador', 'idcHemodin', 'IDC-DF-0411', 'DF360-23-00214', 'Cardiomed Sistemas', 'DF-360', 'vida', '2023-03-03', 29500, 'active'],
      ['bomba1', 'Bomba de infusão volumétrica BI-50', 'bomba', 'hscUti', 'HSC-BI-0121', 'BI50-22-03381', 'Infusa Tecnologia', 'BI-50', 'alta', '2022-06-14', 9800, 'active'],
      ['bomba2', 'Bomba de infusão volumétrica BI-50', 'bomba', 'hscUti', 'HSC-BI-0122', 'BI50-22-03382', 'Infusa Tecnologia', 'BI-50', 'alta', '2022-06-14', 9800, 'active'],
      ['autoclave1', 'Autoclave horizontal AH-150', 'autoclave', 'hscCme', 'HSC-AC-0131', 'AH150-18-00005', 'Esterilis Equipamentos', 'AH-150', 'alta', '2018-08-20', 185000, 'active'],
      ['tc1', 'Tomógrafo computadorizado TC-64', 'tomografo', 'hslSalaTc', 'HSL-TC-0221', 'TC64-19-00003', 'Imagix Diagnóstica', 'TC-64', 'alta', '2019-06-25', 2150000, 'active'],
      ['us1', 'Ultrassom Doppler US-9', 'ultrassom', 'cvpImagem', 'CVP-US-0301', 'US9-21-00019', 'Imagix Diagnóstica', 'US-9', 'media', '2021-12-12', 265000, 'under_maintenance'],
      ['hemo1', 'Máquina de hemodiálise HD-4', 'hemodialise', 'hslHemo', 'HSL-HD-0231', 'HD4-22-00412', 'Nefrotec', 'HD-4', 'vida', '2022-09-01', 88000, 'active'],
      ['ecg1', 'Eletrocardiógrafo 12 canais EC-12', 'ecg', 'cvpCardio', 'CVP-EC-0311', 'EC12-22-00341', 'Cardiomed Sistemas', 'EC-12', 'media', '2022-10-05', 18500, 'active'],
      ['mesa1', 'Mesa cirúrgica eletro-hidráulica MC-5', 'mesa', 'hscSala2', 'HSC-MC-0141', 'MC5-20-00230', 'Cirúrgica Horizonte', 'MC-5', 'alta', '2020-01-15', 96000, 'active'],
    ];
    const ativo = {};
    const localDoAtivo = {};
    for (const [
      chave,
      nome,
      cat,
      loc,
      patrimonio,
      serie,
      fab,
      modelo,
      crit,
      aquisicao,
      valor,
      situacao,
    ] of ATIVOS) {
      const fabricante = await db.findOrCreateManufacturer(s, fab, { verified: true });
      const mod = await db.findOrCreateAssetModel(s, {
        manufacturerId: fabricante.id,
        categoryId: categoria[cat],
        name: modelo,
        verified: true,
      });
      ativo[chave] = await db.createAsset(s, {
        name: nome,
        customerId: clienteDoLocal[loc],
        assetCategoryId: categoria[cat],
        locationId: local[loc],
        assetModelId: mod.id,
        criticalityId: criticidade[crit] ?? null,
        assetNumber: patrimonio,
        serialNumber: serie,
        acquiredAt: aquisicao,
        purchaseValue: valor,
        status: situacao,
      });
      localDoAtivo[chave] = loc;
    }

    /* ----------------------------------------------------------- contratos */

    /*
     * Três contratos, um de cada PERFIL — Expert, Completo, Básico, que é a
     * classificação confirmada pelo cliente —, e um vencendo em 45 dias, que é
     * o que acende o alerta de renovação. O Hospital São Lucas fica SEM
     * contrato: o cliente atendido avulso existe e a lista precisa mostrá-lo.
     * Datas relativas a hoje: um contrato "até 31/12/2026" deixaria de vencer
     * em breve na semana seguinte. Os títulos são descritivos e não
     * classificam nada; a natureza (`kind`) fica em branco.
     */
    const contratos = [
      {
        cli: 'hsc',
        profile: PERFIL_DEMO.hsc.perfil,
        title: PERFIL_DEMO.hsc.titulo,
        startsOn: emDias(-320),
        endsOn: emDias(45),
        autoRenew: false,
        renewalNoticeDays: 60,
        billingModel: 'fixed_monthly',
        monthlyValue: 38500,
        includedCalls: 40,
        includedHours: 160,
        slaTargetPercent: 95,
        planTargetPercent: 90,
        raiz: 'hsc',
      },
      {
        cli: 'cvp',
        profile: PERFIL_DEMO.cvp.perfil,
        title: PERFIL_DEMO.cvp.titulo,
        startsOn: emDias(-180),
        endsOn: emDias(185),
        autoRenew: true,
        billingModel: 'per_asset',
        monthlyValue: 4200,
        planTargetPercent: 95,
        raiz: 'cvp',
      },
      {
        cli: 'idc',
        profile: PERFIL_DEMO.idc.perfil,
        title: PERFIL_DEMO.idc.titulo,
        startsOn: emDias(-90),
        endsOn: emDias(275),
        autoRenew: true,
        billingModel: 'per_call',
        monthlyValue: 0,
        overageCallRate: 480,
        overageHourRate: 165,
        raiz: 'idc',
      },
    ];
    for (const { cli, raiz: raizDoContrato, ...dados } of contratos) {
      const id = await tentar(`contrato ${dados.title}`, () =>
        db.createContract(s, { customerId: cliente[cli], ...dados })
      );
      if (!id) continue;
      const coberto = await tentar(`cobertura ${dados.title}`, () =>
        db.addCoverage(s, { contractId: id, kind: 'location_subtree', locationId: local[raizDoContrato] })
      );
      if (coberto) await tentar(`ativação ${dados.title}`, () => db.activateContract(s, id));
    }

    /* ------------------------------------------------------- solicitações */

    /*
     * DEZ SOLICITAÇÕES EM ESTÁGIOS DIFERENTES: a fila de triagem precisa ter o
     * que triar, e o aceite precisa ter a OS que nasceu dele. A Beatriz abre
     * pelo portal no Santa Clara; nos outros clientes o chamado chega por
     * telefone ou e-mail e a coordenação registra.
     */
    const CHAMADOS = [
      {
        resumo: 'Ventilador do leito 04 com alarme de alta pressão',
        ativo: 'vent1',
        prioridade: 'muito_urgente',
        descricao:
          'Alarme de alta pressão dispara mesmo com circuito novo. Paciente transferido para o ventilador reserva.',
        origem: 'portal',
        dias: 0,
        hora: [7, 40],
        caminho: [],
      },
      {
        resumo: 'Bomba de infusão com alarme de oclusão falso',
        ativo: 'bomba2',
        prioridade: 'normal',
        descricao: 'Alarme de oclusão sem obstrução aparente na linha; o equipo já foi trocado duas vezes.',
        origem: 'portal',
        dias: 1,
        hora: [14, 20],
        caminho: ['triage'],
      },
      {
        resumo: 'Autoclave não atinge a temperatura de esterilização',
        ativo: 'autoclave1',
        prioridade: 'urgente',
        descricao: 'Ciclo de 134 °C abortado duas vezes hoje. CME operando só com a autoclave reserva.',
        origem: 'portal',
        dias: 2,
        hora: [8, 5],
        caminho: ['triage', 'accepted'],
        os: {
          tecnico: 'juliana',
          passos: ['in_progress'],
          horas: 2,
          comentario:
            'Resistência do gerador de vapor com isolamento baixo. Kit de reparo separado no almoxarifado.',
        },
      },
      {
        resumo: 'Mesa cirúrgica não faz Trendelenburg',
        ativo: 'mesa1',
        prioridade: 'normal',
        descricao: 'O comando de inclinação não responde pelo controle com fio.',
        origem: 'portal',
        dias: 3,
        hora: [16, 45],
        caminho: ['triage', 'info_needed'],
        pedido: 'O comando manual de emergência também falha, ou só o controle com fio?',
      },
      {
        resumo: 'Desfibrilador reprovado no autoteste diário',
        ativo: 'desf1',
        prioridade: 'urgente',
        descricao: 'Autoteste das 7h indicou falha de carga. Equipamento retirado do carro de emergência.',
        origem: 'phone',
        solicitante: 'Enf. Carla Mendes — Pronto-socorro',
        dias: 1,
        hora: [7, 15],
        caminho: ['triage', 'accepted'],
        os: { tecnico: 'rafael', agenda: [0, 10, 90], passos: ['scheduled'] },
      },
      {
        resumo: 'Tomógrafo com artefato em anel nas imagens',
        ativo: 'tc1',
        prioridade: 'muito_urgente',
        descricao:
          'Anéis concêntricos visíveis em todos os protocolos desde ontem. Exames eletivos remarcados.',
        origem: 'phone',
        solicitante: 'Dr. Otávio Reis — Diagnóstico por Imagem',
        dias: 4,
        hora: [10, 30],
        caminho: ['triage', 'accepted'],
        os: {
          tecnico: 'marcos',
          passos: ['in_progress', 'waiting'],
          espera: 'external_service',
          horas: 3,
          comentario:
            'Canal do detector ruidoso. Módulo DAS solicitado ao fabricante — prazo de 7 dias úteis.',
        },
      },
      {
        resumo: 'Máquina de hemodiálise com alarme de condutividade',
        ativo: 'hemo1',
        prioridade: 'muito_urgente',
        descricao: 'Alarme de condutividade alta no início da sessão das 6h. Máquina isolada.',
        origem: 'phone',
        solicitante: 'Enf. Rodrigo Tavares — Hemodiálise',
        dias: 0,
        hora: [6, 20],
        caminho: [],
      },
      {
        resumo: 'Ultrassom com imagem granulada no transdutor convexo',
        ativo: 'us1',
        prioridade: 'normal',
        descricao: 'Imagem granulada e faixa escura lateral com o transdutor convexo. O linear está normal.',
        origem: 'email',
        solicitante: 'Dra. Marina Lopes — Ultrassonografia',
        dias: 6,
        hora: [9, 50],
        caminho: ['triage', 'accepted'],
        os: {
          tecnico: 'marcos',
          passos: ['in_progress', 'completed', 'validated', 'closed'],
          horas: 2.5,
          reparoH: 20,
          resolucao: 'Transdutor convexo com elementos danificados substituído; imagem validada com phantom.',
        },
      },
      {
        resumo: 'Troca da impressora térmica do eletrocardiógrafo',
        ativo: 'ecg1',
        prioridade: 'baixa',
        descricao: 'Solicitam substituir a impressora térmica por um modelo com papel A4.',
        origem: 'email',
        solicitante: 'Recepção — Cardiologia',
        dias: 5,
        hora: [11, 10],
        caminho: ['triage', 'rejected'],
      },
      {
        resumo: 'Monitor da UTI Coronariana reiniciando sozinho',
        ativo: 'mon2',
        prioridade: 'urgente',
        descricao: 'Reiniciou três vezes no plantão noturno, sempre com o módulo de PNI medindo.',
        origem: 'phone',
        solicitante: 'Enf. Paula Antunes — UTI Coronariana',
        dias: 0,
        hora: [3, 30],
        caminho: ['triage'],
      },
    ];

    /** Ordens que nasceram de chamado, para o bloco de execução abaixo. */
    const ORDENS = [];

    for (const [i, c] of CHAMADOS.entries()) {
      const loc = localDoAtivo[c.ativo];
      /*
       * Primeira resposta entre 15 min e 3 h depois da abertura — e não no
       * mesmo milissegundo, que é o que a semeadura produz. Nunca no futuro:
       * um chamado aberto há 20 minutos não foi triado há uma hora.
       */
      const aberturaMin = minutosAtras(c.dias, ...c.hora);
      const respostaMin = Math.max(
        5,
        Math.min(
          [15, 40, 95, 180, 25, 60, 120][i % 7],
          aberturaMin - 5 - 30 * Math.max(0, c.caminho.length - 1)
        )
      );
      const sr = await tentar(`solicitação ${c.resumo}`, () =>
        db.createServiceRequest(s, {
          customerId: clienteDoLocal[loc],
          locationId: local[loc],
          assetId: ativo[c.ativo],
          summary: c.resumo,
          description: c.descricao,
          requestedPriority: PRIORIDADE[c.prioridade],
          requesterMembershipId: c.origem === 'portal' ? vinculo.beatriz : vinculo.coord,
          requesterName: c.solicitante ?? null,
          source: c.origem,
          submit: true,
        })
      );
      if (!sr) continue;
      resumo.chamados++;
      envelhecer.chamados.push({ id: sr.id, aberturaMin, respostaMin });

      for (const etapa of c.caminho) {
        if (etapa === 'accepted') {
          const aceite = await tentar(`aceite ${c.resumo}`, () =>
            db.acceptServiceRequest(s, sr.id, [
              {
                assetId: ativo[c.ativo],
                locationId: local[loc],
                workOrderTypeId: natureza.corretiva,
                title: c.resumo,
                assigneeMembershipId: vinculo[c.os?.tecnico] ?? null,
              },
            ])
          );
          const os = aceite?.workOrders[0];
          if (os) {
            resumo.os++;
            // A OS nasce no aceite: depois da triagem, meia hora depois dela.
            ORDENS.push({
              id: os.id,
              titulo: c.resumo,
              aberturaMin: Math.max(5, aberturaMin - respostaMin - 35),
              ...c.os,
              ativo: c.ativo,
            });
          }
        } else {
          await tentar(`solicitação ${c.resumo} → ${etapa}`, () =>
            db.transitionRequest(s, sr.id, etapa, {
              ...(etapa === 'rejected' ? { rejectionReasonId: recusa.fora_de_contrato } : {}),
              ...(etapa === 'info_needed' ? { infoRequest: c.pedido } : {}),
            })
          );
        }
      }
    }

    /* ------------------------------------------------ ordens diretas */

    /*
     * Ordens abertas pela coordenação, sem chamado: calibrações, testes de
     * segurança elétrica e o HISTÓRICO concluído. Sem OS concluída há semanas,
     * o tempo médio de reparo e o backlog mostram zero — o que parece produto
     * quebrado, e não operação nova.
     */
    const DIRETAS = [
      {
        titulo: 'Calibração anual do monitor MX-12',
        ativo: 'mon1',
        natureza: 'calibracao',
        tecnico: 'marcos',
        dias: 3,
        hora: [10, 0],
        agenda: [1, 9, 90],
        passos: ['scheduled'],
      },
      {
        titulo: 'Teste de segurança elétrica — mesa cirúrgica',
        ativo: 'mesa1',
        natureza: 'seguranca_eletrica',
        tecnico: 'rafael',
        dias: 2,
        hora: [15, 30],
        agenda: [2, 14, 60],
        passos: ['scheduled'],
      },
      {
        titulo: 'Preventiva semestral da máquina de hemodiálise',
        ativo: 'hemo1',
        natureza: 'preventiva',
        tecnico: 'juliana',
        dias: 5,
        hora: [9, 0],
        agenda: [3, 8, 180],
        passos: ['scheduled'],
      },
      {
        titulo: 'Calibração do eletrocardiógrafo EC-12',
        ativo: 'ecg1',
        natureza: 'calibracao',
        tecnico: 'marcos',
        dias: 4,
        hora: [13, 0],
        agenda: [4, 10, 90],
        passos: ['scheduled'],
      },
      // Uma janela que já passou: é ela que povoa o balde "atrasadas" da agenda.
      {
        titulo: 'Validação térmica da autoclave',
        ativo: 'autoclave1',
        natureza: 'calibracao',
        tecnico: 'juliana',
        dias: 6,
        hora: [8, 30],
        agenda: [-1, 9, 120],
        passos: ['scheduled'],
      },
      {
        titulo: 'Ventilador de transporte com vazamento no circuito',
        ativo: 'vent3',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'urgente',
        dias: 8,
        hora: [11, 20],
        horas: 2.5,
        passos: ['in_progress', 'waiting'],
        espera: 'parts',
        comentario: 'Placa de controle PCB-VT30-03 com falha intermitente. Peça pedida ao fornecedor.',
      },
      {
        titulo: 'Inspeção do monitor da UTI Coronariana',
        ativo: 'mon2',
        natureza: 'preventiva',
        tecnico: 'juliana',
        dias: 2,
        hora: [8, 0],
        horas: 1,
        reparoH: 14,
        passos: ['in_progress', 'completed'],
      },
      {
        titulo: 'Bomba de infusão com display intermitente',
        ativo: 'bomba1',
        natureza: 'corretiva',
        tecnico: 'juliana',
        prioridade: 'urgente',
        dias: 12,
        hora: [9, 40],
        horas: 1.5,
        reparoH: 26,
        // Esperou a peça e voltou: é ela que dá o que mostrar no "tempo por
        // motivo de espera" — uma espera que ainda não terminou não entra na soma.
        passos: ['in_progress', 'waiting', 'in_progress', 'completed', 'validated', 'closed'],
        espera: 'parts',
        comentario: 'Teclado de membrana trocado após a chegada da peça; calibração de vazão conferida.',
      },
      {
        titulo: 'Desfibrilador não reconhecia as pás',
        ativo: 'desf2',
        natureza: 'corretiva',
        tecnico: 'rafael',
        prioridade: 'muito_urgente',
        dias: 21,
        hora: [7, 50],
        horas: 2,
        reparoH: 4,
        passos: ['in_progress', 'completed', 'validated', 'closed'],
      },
      {
        titulo: 'Preventiva anual do tomógrafo',
        ativo: 'tc1',
        natureza: 'preventiva',
        tecnico: 'marcos',
        dias: 33,
        hora: [13, 10],
        horas: 5,
        reparoH: 30,
        passos: ['in_progress', 'completed', 'validated', 'closed'],
      },
      {
        titulo: 'Troca de bateria do desfibrilador',
        ativo: 'desf1',
        natureza: 'corretiva',
        tecnico: null,
        prioridade: 'normal',
        dias: 1,
        hora: [16, 0],
        passos: [],
      },
    ];
    for (const o of DIRETAS) {
      const loc = localDoAtivo[o.ativo];
      const criada = await tentar(`OS ${o.titulo}`, () =>
        db.createWorkOrder(s, {
          customerId: clienteDoLocal[loc],
          workOrderTypeId: natureza[o.natureza],
          title: o.titulo,
          description: 'Ordem aberta pela coordenação de engenharia clínica.',
          locationId: local[loc],
          assetId: ativo[o.ativo],
          priority: o.prioridade ? PRIORIDADE[o.prioridade] : undefined,
          assigneeMembershipId: o.tecnico ? vinculo[o.tecnico] : null,
          publish: true,
        })
      );
      if (!criada) continue;
      resumo.os++;
      ORDENS.push({ id: criada.id, aberturaMin: minutosAtras(o.dias, ...o.hora), ...o });
    }

    /* --------------------------------------------- execução das ordens */

    for (const [indice, o] of ORDENS.entries()) {
      // Agenda — antes da transição, que exige responsável e janela.
      let jan = null;
      if (o.agenda && o.tecnico) {
        jan = janela(...o.agenda);
        const ok = await tentar(`agenda ${o.titulo}`, () =>
          db.scheduleWorkOrder(s, { workOrderId: o.id, assigneeMembershipId: vinculo[o.tecnico], ...jan })
        );
        if (ok) resumo.agenda++;
      }

      /*
       * A LINHA DO TEMPO DA OS, já envelhecida: aberta há `aberturaMin`;
       * concluída `reparoMin` depois; iniciada `inicioDepoisMin` depois da
       * abertura. O apontamento cabe dentro dela: na concluída, termina meia
       * hora antes da conclusão; na que segue aberta, começa 15 min depois do
       * início.
       */
      const reparoMin = (o.reparoH ?? 0) * 60;
      const duracaoMin = (o.horas ?? 0) * 60;
      const inicioDepoisMin = !o.passos?.includes('in_progress')
        ? null
        : reparoMin > 0
          ? Math.min(60, Math.floor(reparoMin / 4))
          : Math.min(180, Math.max(30, Math.floor(o.aberturaMin / 4)));
      if (o.aberturaMin > 0) {
        envelhecer.ordens.push({ id: o.id, aberturaMin: o.aberturaMin, reparoMin, inicioDepoisMin });
      }

      // Horas apontadas ANTES das transições: OS fechada não aceita apontamento.
      if (o.horas && o.tecnico && inicioDepoisMin !== null) {
        let inicio =
          reparoMin > 0
            ? new Date(agora.getTime() - (o.aberturaMin - reparoMin + 30 + duracaoMin) * 60_000)
            : new Date(agora.getTime() - (o.aberturaMin - inicioDepoisMin - 15) * 60_000);
        let fim = new Date(inicio.getTime() + duracaoMin * 60_000);
        const limite = agora.getTime() - (5 + indice) * 60_000;
        if (fim.getTime() > limite) {
          fim = new Date(limite);
          inicio = new Date(limite - duracaoMin * 60_000);
        }
        const ok = await tentar(`apontamento ${o.titulo}`, () =>
          db.logTime(s, {
            workOrderId: o.id,
            membershipId: vinculo[o.tecnico],
            startedAt: inicio,
            endedAt: fim,
            note: 'Atendimento em campo',
          })
        );
        if (ok) resumo.apontamentos++;
      }

      for (const etapa of o.passos ?? []) {
        await tentar(`OS ${o.titulo} → ${etapa}`, () =>
          db.transitionWorkOrder(s, o.id, etapa, {
            ...(etapa === 'scheduled' && jan
              ? {
                  scheduledStart: jan.startsAt,
                  scheduledEnd: jan.endsAt,
                  assigneeMembershipId: vinculo[o.tecnico],
                }
              : {}),
            ...(etapa === 'waiting'
              ? { waitReasonId: waitReasons.get(o.espera) ?? [...waitReasons.values()][0] }
              : {}),
            ...(etapa === 'completed'
              ? {
                  resolution:
                    o.resolucao ??
                    'Componente substituído; testes funcional e de segurança elétrica aprovados.',
                }
              : {}),
          })
        );
      }

      if (o.comentario && o.tecnico) {
        const ok = await tentar(`comentário ${o.titulo}`, () =>
          db.addComment(como(vinculo[o.tecnico]), {
            workOrderId: o.id,
            body: o.comentario,
            visibility: 'internal',
          })
        );
        if (ok) resumo.comentarios++;
      }
    }

    /* ------------------------------------------------- plano preventivo */

    /*
     * O plano abre o ciclo do trimestre corrente (âncora há 20 dias) e o
     * ciclo é MATERIALIZADO: as preventivas dos ventiladores aparecem como OS
     * de origem "plano", e duas delas já entram na agenda.
     */
    const plano = await tentar('plano de ventiladores', () =>
      db.createPlan(s, {
        name: 'Preventiva trimestral — ventiladores pulmonares',
        customerId: cliente.hsc,
        description: 'Inspeção, teste funcional, troca de filtros e teste de segurança elétrica.',
        autoGenerate: false,
        anchorDate: new Date(agora.getTime() - 20 * DIA),
      })
    );
    const tarefa =
      plano &&
      (await tentar('tarefa do plano de ventiladores', () =>
        db.addPlanTask(s, {
          planId: plano,
          name: 'Preventiva de ventilador pulmonar',
          targetKind: 'asset_category',
          targetCategoryId: categoria.ventilador,
          workOrderTypeId: natureza.preventiva,
          frequencyUnit: 'quarter',
          frequencyInterval: 1,
          leadTimeDays: 30,
          toleranceDays: 7,
          estimatedDurationMin: 120,
        })
      ));
    const ciclo =
      tarefa && (await tentar('ciclo do plano de ventiladores', () => db.generateCycle(s, tarefa)));
    if (ciclo) {
      const geradas = await tentar('materialização do ciclo', () => db.materializeCycle(s, ciclo.cycleId));
      if (geradas) resumo.os += geradas;
      const doPlano = await s.query(
        `SELECT i.work_order_id AS id, i.asset_id FROM aurora.plan_cycle_items i
          WHERE i.cycle_id = $1 AND i.work_order_id IS NOT NULL`,
        [ciclo.cycleId]
      );
      const agendaDoPlano = {
        [ativo.vent1]: ['juliana', [0, 15, 120]],
        [ativo.vent2]: ['rafael', [5, 9, 120]],
      };
      for (const { id, asset_id: assetId } of doPlano) {
        const plan = agendaDoPlano[assetId];
        if (!plan) continue;
        const [tecnico, quando] = plan;
        const jan = janela(...quando);
        const ok = await tentar('agenda da preventiva do plano', () =>
          db.scheduleWorkOrder(s, { workOrderId: id, assigneeMembershipId: vinculo[tecnico], ...jan })
        );
        if (!ok) continue;
        resumo.agenda++;
        await tentar('preventiva do plano → scheduled', () =>
          db.transitionWorkOrder(s, id, 'scheduled', {
            scheduledStart: jan.startsAt,
            scheduledEnd: jan.endsAt,
            assigneeMembershipId: vinculo[tecnico],
          })
        );
      }
    }

    // Um segundo plano, anual, com o ciclo aberto e ainda não materializado:
    // a tela de cumprimento mostra o que está previsto e não virou OS.
    const planoCal = await tentar('plano de calibração', () =>
      db.createPlan(s, {
        name: 'Calibração anual — monitores e desfibriladores',
        customerId: cliente.hsc,
        description: 'Calibração rastreável e emissão de certificado.',
        autoGenerate: false,
        anchorDate: new Date(agora.getTime() - 60 * DIA),
      })
    );
    if (planoCal) {
      const t = await tentar('tarefa do plano de calibração', () =>
        db.addPlanTask(s, {
          planId: planoCal,
          name: 'Calibração de monitor multiparamétrico',
          targetKind: 'asset_category',
          targetCategoryId: categoria.monitor,
          workOrderTypeId: natureza.calibracao,
          frequencyUnit: 'year',
          frequencyInterval: 1,
          leadTimeDays: 30,
          toleranceDays: 15,
        })
      );
      if (t) await tentar('ciclo do plano de calibração', () => db.generateCycle(s, t));
    }

    /* -------------------------------------------------------------- estoque */

    const central = await db.createWarehouse(s, { name: 'Almoxarifado Central — Engenharia Clínica' });
    const carro = await tentar('almoxarifado móvel', () =>
      db.createWarehouse(s, {
        name: 'Carro da oficina móvel',
        kind: 'van',
        ownerMembershipId: vinculo.rafael,
      })
    );
    const deposito = (d) => (d === 'carro' ? (carro ?? central) : central);

    const itens = {};
    // [chave, sku, nome, unidade, categoria, imagem, depósito, entrada, custo, mínimo, saída]
    // prettier-ignore
    const ITENS = [
      ['filtro', 'FIL-HEPA-01', 'Filtro HEPA para ventilador', 'un', 'Filtros', 'catalogo/filtro-hepa.svg', 'central', 4, 90, 10, 2],
      ['spo2', 'SEN-SPO2-01', 'Sensor de SpO2 adulto reutilizável', 'un', 'Sensores', 'catalogo/sensor.svg', 'central', 12, 420, 6, 3],
      ['bateriaDf', 'BAT-DF360-01', 'Bateria do desfibrilador DF-360', 'un', 'Energia', 'catalogo/bateria.svg', 'central', 2, 1150, 4, 1],
      ['bateria12', 'BAT-12V-07', 'Bateria selada 12 V 7 Ah', 'un', 'Energia', 'catalogo/bateria.svg', 'carro', 6, 180, 4, 0],
      ['circuito', 'CIR-PAC-AD', 'Circuito paciente adulto', 'un', 'Descartáveis', 'catalogo/mangueira.svg', 'carro', 15, 65, 8, 4],
      ['eletrodo', 'ELE-ECG-50', 'Eletrodo de ECG descartável (pacote com 50)', 'pct', 'Descartáveis', 'catalogo/eletrodo.svg', 'central', 40, 28, 20, 6],
      ['cabo', 'CAB-ECG-05', 'Cabo de ECG 5 vias', 'un', 'Cabos', 'catalogo/cabo.svg', 'central', 6, 320, 3, 0],
      ['fusivel', 'FUS-5A-RT', 'Fusível 5 A retardado', 'un', 'Energia', 'catalogo/fusivel.svg', 'carro', 6, 9, 10, 0],
      ['lampada', 'LAM-FOC-01', 'Lâmpada do foco cirúrgico', 'un', 'Iluminação', 'catalogo/lampada.svg', 'central', 3, 640, 2, 1],
      ['valvula', 'VAL-EXA-01', 'Válvula de exalação', 'un', 'Pneumática', 'catalogo/valvula.svg', 'central', 24, 150, 12, 2],
      ['oring', 'VED-OR-22', 'Anel de vedação 22 mm', 'un', 'Vedação', 'catalogo/oring.svg', 'central', 120, 4, 50, 8],
      ['equipo', 'EQP-INF-BI50', 'Equipo de infusão para bomba BI-50', 'un', 'Descartáveis', 'catalogo/seringa.svg', 'carro', 30, 22, 15, 4],
      ['placa', 'PCB-VT30-03', 'Placa de controle do ventilador VT-30', 'un', 'Eletrônica', 'catalogo/circuito.svg', 'central', 1, 1850, 2, 0],
      ['kit', 'KIT-PREV-AH150', 'Kit de preventiva da autoclave AH-150', 'kit', 'Kits', 'catalogo/generico.svg', 'central', 3, 760, 2, 1],
    ];
    for (const [chave, sku, nome, unidade, cat, imagem, dep, entrada, custo, minimo, saida] of ITENS) {
      const [ja] = await s.query(
        `SELECT id FROM aurora.inventory_items WHERE lower(btrim(sku)) = lower($1)`,
        [sku]
      );
      itens[chave] =
        ja?.id ??
        (await db.createItem(s, { sku, name: nome, unit: unidade, category: cat, imageKey: imagem }));
      const wh = deposito(dep);
      // O saldo entra por RECEBIMENTO, nunca por escrita na tabela de saldos:
      // a primeira movimentação real desmancharia uma conta feita por fora.
      await tentar(`entrada ${sku}`, () =>
        db.recordMovement(s, {
          itemId: itens[chave],
          warehouseId: wh,
          kind: 'receipt',
          qty: entrada,
          unitCost: custo,
          reason: 'Nota fiscal de compra — reposição',
        })
      );
      await tentar(`mínimo ${sku}`, () => db.setMinimum(s, itens[chave], wh, minimo));
      if (saida > 0) {
        await tentar(`saída ${sku}`, () =>
          db.recordMovement(s, {
            itemId: itens[chave],
            warehouseId: wh,
            kind: 'issue',
            qty: saida,
            reason: 'Consumo em ordem de serviço',
          })
        );
      }
    }

    /* --------------------------------------------- contatos e orçamentos */

    const contato = {};
    for (const [cli, nome, email] of [
      ['hsc', 'Dra. Renata Moura — Diretoria técnica', 'renata.moura'],
      ['hsl', 'Carlos Henrique — Suprimentos', 'carlos.henrique'],
      ['cvp', 'Luciana Ferraz — Gerência', 'luciana.ferraz'],
    ]) {
      contato[cli] = await tentar(`contato ${nome}`, async () => {
        const id = newId();
        await s.query(
          `INSERT INTO aurora.customer_contacts (id, organization_id, customer_id, name, email)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, org.id, cliente[cli], nome, `${email}@${DOMINIO}`]
        );
        return id;
      });
    }

    for (const [cli, linhas, caminho] of [
      [
        'hsl',
        [
          // Peça do fabricante fora do almoxarifado: entra como serviço, porque
          // linha de peça exige item de estoque (quote_items_part_has_item).
          ['service', 'Fornecimento e troca do módulo DAS do detector', 1, 4_850_000],
          ['service', 'Mão de obra especializada (h)', 6, 22_000],
        ],
        ['sent'],
      ],
      [
        'cvp',
        [
          ['service', 'Fornecimento do transdutor convexo US-9', 1, 1_890_000],
          ['service', 'Instalação e validação com phantom', 1, 45_000],
        ],
        ['sent', 'approved'],
      ],
      [
        'hsc',
        [
          ['part', 'Bateria do desfibrilador DF-360', 2, 115_000, 'bateriaDf'],
          ['service', 'Troca e teste de carga', 1, 25_000],
        ],
        [],
      ],
    ]) {
      const quote = await tentar('orçamento', () =>
        db.createQuote(s, {
          customerId: cliente[cli],
          approverContactId: contato[cli] ?? null,
          validUntil: emDias(30),
          paymentTerms: '30 dias após faturamento',
        })
      );
      if (!quote) continue;
      for (const [kind, descricao, qtd, preco, item] of linhas) {
        await tentar(`item de orçamento ${descricao}`, () =>
          db.addQuoteItem(s, {
            quoteId: quote,
            kind,
            description: descricao,
            quantity: qtd,
            unitPriceCents: preco,
            itemId: item ? itens[item] : null,
          })
        );
      }
      for (const etapa of caminho) {
        await tentar(`orçamento → ${etapa}`, () => db.transitionQuote(s, quote, etapa, {}));
      }
    }
  });

  /* ------------------------------------- envelhecimento — a operação tem passado */

  /*
   * Tudo nasceu "agora". Sem recuar, o tempo médio de reparo daria minutos e
   * todas as OS teriam a mesma idade no quadro. Cada OS e cada chamado recua
   * as suas horas — e o histórico, os comentários e os relógios de SLA recuam
   * junto, para a linha do tempo continuar coerente. A AGENDA não recua
   * (`scheduled_*`): ela é relativa a hoje.
   *
   * POR QUE `session_replication_role = replica`, e não `DISABLE TRIGGER`:
   * desligar o gatilho na TABELA vale para todas as organizações do banco
   * enquanto durar; o papel de replicação vale só para ESTA transação. As
   * garantias que ficam suspensas (OS fechada somente leitura, auditoria) são
   * suspensas só para a reescrita de datas desta massa, filtrada pelo id da
   * organização. Exige superusuário — o mesmo do migrador.
   */
  await passo('envelhecimento das datas', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL session_replication_role = replica`);
      const colunas = new Map();
      const colunasDe = async (tabela) => {
        if (!colunas.has(tabela)) {
          const { rows } = await c.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'aurora' AND table_name = $1 AND data_type = 'timestamp with time zone'`,
            [tabela]
          );
          colunas.set(
            tabela,
            rows.map((r) => String(r.column_name)).filter((n) => !n.startsWith('scheduled_'))
          );
        }
        return colunas.get(tabela);
      };
      /** Recua todas as colunas de data da linha (menos a agenda) em `minutos`. */
      const recuar = async (tabela, filtro, params, minutos) => {
        const cols = await colunasDe(tabela);
        if (cols.length === 0 || minutos <= 0) return;
        const set = cols.map((n) => `${n} = ${n} - make_interval(mins => $1)`).join(', ');
        await c.query(`UPDATE aurora.${tabela} SET ${set} WHERE organization_id = $2 AND ${filtro}`, [
          minutos,
          org.id,
          ...params,
        ]);
      };
      const relogios = `clock_id IN (SELECT id FROM aurora.sla_clocks WHERE document_id = $3)`;

      /*
       * 1. TUDO RECUA JUNTO até o momento do último fato da OS (a conclusão,
       *    se houve; a abertura, se não). Depois, só a abertura — e o início do
       *    relógio de SLA — recuam o tempo de reparo, e o início do atendimento
       *    vai para o ponto em que o apontamento de horas começa.
       */
      for (const { id, aberturaMin, reparoMin, inicioDepoisMin } of envelhecer.ordens) {
        const base = Math.max(0, aberturaMin - reparoMin);
        await recuar('work_orders', 'id = $3', [id], base);
        await recuar('work_order_status_history', 'work_order_id = $3', [id], base);
        await recuar('work_order_comments', 'work_order_id = $3', [id], base);
        await recuar('sla_pauses', relogios, [id], base);
        await recuar('sla_clocks', `document_type = 'work_order' AND document_id = $3`, [id], base);
        if (reparoMin > 0) {
          await c.query(
            `UPDATE aurora.work_orders SET created_at = created_at - make_interval(mins => $3)
              WHERE id = $1 AND organization_id = $2`,
            [id, org.id, reparoMin]
          );
          await c.query(
            `UPDATE aurora.sla_clocks
                SET started_at = started_at - make_interval(mins => $3),
                    due_at = due_at - make_interval(mins => $3)
              WHERE document_type = 'work_order' AND document_id = $1 AND organization_id = $2`,
            [id, org.id, reparoMin]
          );
        }
        if (inicioDepoisMin !== null) {
          await c.query(
            `UPDATE aurora.work_orders SET started_at = created_at + make_interval(mins => $3)
              WHERE id = $1 AND organization_id = $2 AND started_at IS NOT NULL`,
            [id, org.id, inicioDepoisMin]
          );
        }
      }

      /*
       * 2. O HISTÓRICO DE SITUAÇÕES ganha duração. Todas as transições
       *    aconteceram no mesmo segundo, e o "tempo por situação" dos
       *    indicadores daria zero em tudo. Cada passagem vai para o fato que a
       *    representa (abertura, início, conclusão), validação 90 min depois da
       *    conclusão e encerramento no dia seguinte — nunca depois de agora.
       */
      const idsOrdens = envelhecer.ordens.map((o) => o.id);
      await c.query(
        `UPDATE aurora.work_orders
            SET validated_at = CASE WHEN validated_at IS NULL THEN NULL
                                    ELSE LEAST(completed_at + interval '90 minutes', now() - interval '5 minutes') END,
                closed_at = CASE WHEN closed_at IS NULL THEN NULL
                                 ELSE LEAST(completed_at + interval '20 hours', now() - interval '4 minutes') END
          WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND completed_at IS NOT NULL`,
        [org.id, idsOrdens]
      );
      await c.query(
        `WITH h AS (
           SELECT h.sequence, s.key, row_number() OVER (PARTITION BY h.work_order_id ORDER BY h.sequence) AS n,
                  row_number() OVER (PARTITION BY h.work_order_id, s.key ORDER BY h.sequence) AS vez,
                  w.created_at, w.started_at, w.completed_at, w.validated_at, w.closed_at,
                  COALESCE(w.completed_at, now()) - COALESCE(w.started_at, w.created_at) AS execucao
             FROM aurora.work_order_status_history h
             JOIN aurora.work_order_statuses s ON s.id = h.to_status_id
             JOIN aurora.work_orders w ON w.id = h.work_order_id
            WHERE h.organization_id = $1 AND h.work_order_id = ANY($2::uuid[])
         )
         UPDATE aurora.work_order_status_history x
            SET changed_at = LEAST(now() - interval '3 minutes', CASE
                  WHEN h.n = 1 THEN h.created_at
                  WHEN h.key = 'scheduled' THEN h.created_at + interval '30 minutes'
                  WHEN h.key = 'in_progress' AND h.vez = 1 THEN COALESCE(h.started_at, x.changed_at)
                  -- a retomada depois de uma espera: a 70% da execução
                  WHEN h.key = 'in_progress' THEN COALESCE(h.started_at, h.created_at) + h.execucao * 0.7
                  -- a espera começa a 15% da execução
                  WHEN h.key IN ('waiting', 'paused') THEN COALESCE(h.started_at, h.created_at) + h.execucao * 0.15
                  WHEN h.key = 'completed' THEN COALESCE(h.completed_at, x.changed_at)
                  WHEN h.key = 'validated' THEN COALESCE(h.validated_at, x.changed_at)
                  WHEN h.key = 'closed' THEN COALESCE(h.closed_at, x.changed_at)
                  WHEN h.key = 'cancelled' THEN h.created_at + interval '1 hour'
                  ELSE x.changed_at END)
           FROM h
          WHERE x.sequence = h.sequence`,
        [org.id, idsOrdens]
      );
      await c.query(
        `WITH d AS (
           SELECT sequence, changed_at - lag(changed_at) OVER (PARTITION BY work_order_id ORDER BY sequence) AS dur
             FROM aurora.work_order_status_history
            WHERE organization_id = $1 AND work_order_id = ANY($2::uuid[])
         )
         UPDATE aurora.work_order_status_history x
            SET seconds_in_from = GREATEST(0, EXTRACT(EPOCH FROM d.dur))::bigint
           FROM d
          WHERE x.sequence = d.sequence AND d.dur IS NOT NULL`,
        [org.id, idsOrdens]
      );
      await c.query(
        `UPDATE aurora.work_orders w
            SET status_changed_at = (SELECT max(changed_at) FROM aurora.work_order_status_history h
                                      WHERE h.work_order_id = w.id)
          WHERE w.organization_id = $1 AND w.id = ANY($2::uuid[])`,
        [org.id, idsOrdens]
      );
      // O comentário do técnico é de quem está atendendo: 40 min depois do início,
      // ou, na OS concluída, perto da conclusão — que é quando ele relata o feito.
      await c.query(
        `UPDATE aurora.work_order_comments k
            SET created_at = LEAST(now() - interval '2 minutes',
                                   COALESCE(w.completed_at - interval '45 minutes',
                                            w.started_at + interval '40 minutes'))
           FROM aurora.work_orders w
          WHERE k.work_order_id = w.id AND k.organization_id = $1 AND w.id = ANY($2::uuid[])
            AND w.started_at IS NOT NULL`,
        [org.id, idsOrdens]
      );

      /*
       * 3. CHAMADOS: recuam até a abertura; a primeira resposta (a primeira
       *    passagem por triagem, que é o que a métrica lê) fica `respostaMin`
       *    depois, e cada passo seguinte meia hora depois do anterior.
       */
      for (const { id, aberturaMin, respostaMin } of envelhecer.chamados) {
        await recuar('service_requests', 'id = $3', [id], aberturaMin);
        await recuar('service_request_status_history', 'request_id = $3', [id], aberturaMin);
        await recuar('sla_pauses', relogios, [id], aberturaMin);
        await recuar(
          'sla_clocks',
          `document_type = 'service_request' AND document_id = $3`,
          [id],
          aberturaMin
        );
        await c.query(
          `WITH passos AS (
             SELECT h.ctid AS linha, row_number() OVER (ORDER BY h.changed_at) AS n
               FROM aurora.service_request_status_history h
              WHERE h.request_id = $1 AND h.to_status NOT IN ('draft', 'submitted')
           )
           UPDATE aurora.service_request_status_history h
              SET changed_at = LEAST(now() - interval '3 minutes',
                                     r.submitted_at + make_interval(mins => $2 + (p.n::int - 1) * 30))
             FROM passos p, aurora.service_requests r
            WHERE h.ctid = p.linha AND r.id = $1 AND r.organization_id = $3 AND r.submitted_at IS NOT NULL`,
          [id, respostaMin, org.id]
        );
        await c.query(
          `UPDATE aurora.service_requests
              SET first_response_at = submitted_at + make_interval(mins => $2)
            WHERE id = $1 AND organization_id = $3 AND first_response_at IS NOT NULL AND submitted_at IS NOT NULL`,
          [id, respostaMin, org.id]
        );
      }

      /*
       * 4. OS RELÓGIOS PARADOS são refeitos com as datas novas: a resposta
       *    para na primeira resposta, o atendimento no início da OS, e
       *    "cumprido" ou "violado" sai da comparação com o prazo — como o
       *    `stopSlaClock` faria se as coisas tivessem acontecido nessas horas.
       *    Calendário 24×7 (a política da massa), então útil = corrido.
       */
      const idsDocumentos = [...idsOrdens, ...envelhecer.chamados.map((x) => x.id)];
      await c.query(
        `UPDATE aurora.sla_clocks k SET stopped_at = w.started_at
           FROM aurora.work_orders w
          WHERE k.organization_id = $1 AND k.document_type = 'work_order' AND k.document_id = w.id
            AND k.kind = 'onsite' AND k.stopped_at IS NOT NULL AND w.started_at IS NOT NULL
            AND w.id = ANY($2::uuid[])`,
        [org.id, idsDocumentos]
      );
      await c.query(
        `UPDATE aurora.sla_clocks k SET stopped_at = r.first_response_at
           FROM aurora.service_requests r
          WHERE k.organization_id = $1 AND k.document_type = 'service_request' AND k.document_id = r.id
            AND k.kind = 'response' AND k.stopped_at IS NOT NULL AND r.first_response_at IS NOT NULL
            AND r.id = ANY($2::uuid[])`,
        [org.id, idsDocumentos]
      );
      await c.query(
        `UPDATE aurora.sla_clocks
            SET elapsed_minutes = GREATEST(0, EXTRACT(EPOCH FROM (stopped_at - started_at)) / 60)::int,
                elapsed_business_minutes = GREATEST(0, EXTRACT(EPOCH FROM (stopped_at - started_at)) / 60)::int,
                state = (CASE WHEN stopped_at <= due_at THEN 'met' ELSE 'breached' END)::aurora.sla_clock_state,
                breached_at = CASE WHEN stopped_at <= due_at THEN NULL ELSE due_at END
          WHERE organization_id = $1 AND document_id = ANY($2::uuid[])
            AND stopped_at IS NOT NULL AND state IN ('met', 'breached')`,
        [org.id, idsDocumentos]
      );

      // O fato analítico é mantido por gatilho — que esteve desligado acima.
      // A função de reconstrução é a mesma conta do gatilho (0035).
      await c.query(`SELECT aurora.rebuild_fact_work_order($1)`, [org.id]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  });

  /* ----------------------------------------------------------- o resumo */

  process.stdout.write(
    `\nmassa de demonstração criada nesta execução: ${resumo.chamados} solicitações, ${resumo.os} OS, ` +
      `${resumo.agenda} na agenda, ${resumo.apontamentos} apontamentos, ${resumo.comentarios} comentários.\n` +
      `\ntotais da organização:\n`
  );
  imprimirContagem(org, await contagem(org.id));
  process.stdout.write(
    `\npessoas fictícias (sem senha, e-mail em @${DOMINIO}):\n` +
      PESSOAS.map(
        ([, nome, localEmail, papel]) => `  ${nome.padEnd(16)} ${papel.padEnd(12)} ${localEmail}@${DOMINIO}`
      ).join('\n') +
      '\n'
  );

  if (falhas.length > 0) {
    process.stdout.write(
      `\n${falhas.length} passo(s) recusado(s) — a massa seguiu sem eles:\n  ${falhas.join('\n  ')}\n`
    );
  }
}

main()
  .catch((e) => {
    process.stderr.write(
      `\nFALHOU: ${mensagem(e)}\nA transação de negócio foi desfeita; rode de novo depois de corrigir.\n\n`
    );
    if (process.env.AURORA_DEBUG) console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
