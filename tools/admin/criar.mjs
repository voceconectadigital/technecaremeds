#!/usr/bin/env node
/**
 * Aurora — cria (ou redefine a senha de) uma conta administrativa REAL.
 *
 * Uso:  npm run admin:criar
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE COMANDO EXISTE, E POR QUE É UM COMANDO E NÃO UMA ROTA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A primeira conta de um sistema é o problema do ovo e da galinha: criar conta
 * exige permissão, e a permissão vem de uma conta. As duas saídas usuais são
 * péssimas:
 *
 *   · uma rota pública de "primeiro cadastro" — que fica aberta para sempre, e
 *     numa homologação exposta é a porta por onde entra quem achar a URL;
 *   · um usuário embutido no seed com senha no código — que vai para o Git, vai
 *     para o histórico, e continua valendo depois de o repositório ser clonado.
 *
 * A saída certa é um comando que só roda com acesso ao BANCO e ao TERMINAL. Quem
 * tem os dois já podia fazer qualquer coisa; nada é concedido a quem não tinha.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE COMANDO NUNCA FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  · NÃO aceita a senha por argumento nem por variável de ambiente. Argumento
 *    fica no histórico do shell; variável fica no ambiente de todo processo
 *    filho e vaza em qualquer despejo de diagnóstico. A senha é digitada, com
 *    eco desligado, e existe em memória pelo tempo de derivar o resumo.
 *  · NÃO imprime a senha, nem o resumo, nem o comprimento dela.
 *  · NÃO inventa organização. Ele LISTA as que existem e pede para escolher —
 *    criar uma segunda "[HOMOLOGAÇÃO] Prestadora" por engano é como se descobre,
 *    três dias depois, que metade do dado foi para o lugar errado.
 *  · NÃO escolhe destino. `AURORA_AMBIENTE` + `aurora.destinos.json` decidem, e
 *    a recusa encerra com 1.
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const require = createRequire(import.meta.url);
require('tsx/cjs');

/* -------------------------------------------------------------- o destino */

const { conferirOuSair } = await import('../db/destino.mjs');
const url = process.env.DATABASE_URL;
conferirOuSair(url);

const { Pool } = require('pg');
const db = require('../../packages/db/src/index.ts');
const { pgPoolAdapter } = require('../../packages/db/src/adapters.ts');
const dominio = require('../../packages/domain/src/index.ts');

/* ------------------------------------------------------------- a conversa */

const rl = createInterface({ input: stdin, output: stdout });

function perguntar(texto) {
  return new Promise((resolve) => rl.question(texto, (r) => resolve(r.trim())));
}

/**
 * Lê sem eco.
 *
 * `readline` não oferece isso, então o caractere é consumido cru e nada é
 * escrito de volta. O `\r` do Windows conta como fim de linha tanto quanto o
 * `\n` — sem isso, a senha digitada num terminal do Windows nunca terminaria.
 *
 * Ctrl+C durante a digitação encerra o processo, e não cai no `catch` como uma
 * senha vazia: uma desistência não pode virar uma tentativa.
 */
function perguntarSegredo(texto) {
  return new Promise((resolve, reject) => {
    stdout.write(texto);
    const eraRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    let valor = '';
    const aoReceber = (bloco) => {
      const s = bloco.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          stdin.removeListener('data', aoReceber);
          if (stdin.isTTY) stdin.setRawMode(Boolean(eraRaw));
          stdout.write('\n');
          return resolve(valor);
        }
        if (ch === '\u0003') {
          // Ctrl+C
          stdin.removeListener('data', aoReceber);
          if (stdin.isTTY) stdin.setRawMode(Boolean(eraRaw));
          stdout.write('\n');
          return reject(new Error('cancelado'));
        }
        if (ch === '\u007f' || ch === '\b') {
          valor = valor.slice(0, -1);
          continue;
        }
        valor += ch;
      }
    };
    stdin.on('data', aoReceber);
  });
}

function sair(mensagem, codigo = 1) {
  rl.close();
  stdout.write(`\n${mensagem}\n\n`);
  process.exit(codigo);
}

/* ----------------------------------------------------------------- começo */

const pool = new Pool({ connectionString: url, max: 2 });
/* Sem `SET ROLE`: este comando é administrativo e precisa escrever em
 * `user_credentials`, que o papel da aplicação deliberadamente não alcança. */
const admin = pgPoolAdapter(pool, null);

try {
  const aplicadas = await admin.query(
    `SELECT count(*)::int AS n FROM aurora.schema_migrations WHERE name >= '0045'`
  );
  if (!aplicadas[0] || aplicadas[0].n === 0) {
    sair(
      'A migration 0045 (credenciais e sessões) não está aplicada neste banco.\n' +
        'Rode `npm run db:migrate` antes de criar a conta.'
    );
  }

  stdout.write('\nAurora — conta administrativa\n');
  stdout.write('─'.repeat(64) + '\n\n');

  /* ------------------------------------------------------ a organização */

  const orgs = await admin.query(
    `SELECT id, slug, name FROM aurora.organizations
      WHERE deleted_at IS NULL AND status = 'active' ORDER BY created_at`
  );
  if (orgs.length === 0) {
    sair(
      'Não há organização neste banco.\n' +
        'Rode `npm run homolog:semear` (massa de homologação) ou `npm run db:seed` primeiro:\n' +
        'uma conta sem organização não enxerga tela nenhuma.'
    );
  }

  stdout.write('Organizações neste banco:\n\n');
  orgs.forEach((o, i) => stdout.write(`  ${i + 1}. ${o.name}   (${o.slug})\n`));
  stdout.write('\n');

  const escolha = await perguntar(`Em qual organização a conta entra? [1-${orgs.length}] `);
  const org = orgs[Number(escolha) - 1];
  if (!org) sair('Escolha inválida. Nada foi alterado.');

  /* ------------------------------------------------------------ a pessoa */

  const email = (await perguntar('E-mail: ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    sair('Endereço de e-mail inválido. Nada foi alterado.');
  }

  const existente = await admin.query(
    `SELECT id, name FROM aurora.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email]
  );

  let nome;
  if (existente[0]) {
    stdout.write(`\nEsta conta já existe: ${existente[0].name}\n`);
    const ok = await perguntar('Redefinir a senha dela e garantir o papel administrativo? [s/N] ');
    if (ok.toLowerCase() !== 's') sair('Nada foi alterado.', 0);
    nome = existente[0].name;
  } else {
    nome = await perguntar('Nome completo: ');
    if (nome.length < 2) sair('Nome muito curto. Nada foi alterado.');
  }

  /* -------------------------------------------------------------- a senha */

  stdout.write(
    `\nA senha precisa de pelo menos ${dominio.SENHA_MINIMA} caracteres. Comprimento vale mais\n` +
      'que símbolos: uma frase que só você saberia é melhor que "Senha@123".\n' +
      'Nada do que você digitar aparece na tela, no log ou no relatório.\n\n'
  );

  let senha;
  for (let tentativa = 1; ; tentativa++) {
    senha = await perguntarSegredo('Senha: ');
    const problemas = dominio.conferirForcaDaSenha(senha, { email });
    if (problemas.length > 0) {
      stdout.write('\nEsta senha não serve:\n');
      problemas.forEach((p) => stdout.write(`  · ${p.message}\n`));
      stdout.write('\n');
      if (tentativa >= 3) sair('Três tentativas. Nada foi alterado.');
      continue;
    }
    const confirmacao = await perguntarSegredo('Repita a senha: ');
    if (confirmacao !== senha) {
      stdout.write('\nAs duas digitações não são iguais.\n\n');
      if (tentativa >= 3) sair('Três tentativas. Nada foi alterado.');
      continue;
    }
    break;
  }

  /* ------------------------------------------------------------- a escrita */

  const { newId, buildContext, PERMISSION_KEYS } = dominio;

  // O catálogo de permissões é espelho do código (§21) e não vem por migração:
  // sem sincronizar, o papel de fábrica aponta para uma chave que o banco não
  // conhece, e a chave estrangeira recusa.
  await db.syncPermissionCatalog(admin);

  const userId = existente[0]?.id ?? newId();
  const membershipId = newId();

  let membroFinal = membershipId;

  await admin.transaction(async (tx) => {
    if (!existente[0]) {
      await tx.query(
        `INSERT INTO aurora.users (id, email, name, status, auth_provider)
         VALUES ($1, $2, $3, 'active', 'password')`,
        [userId, email, nome]
      );
    } else {
      // Quem já existia pode ter vindo do provedor local. Passa a ser 'password'.
      await tx.query(
        `UPDATE aurora.users SET auth_provider = 'password', updated_at = now() WHERE id = $1`,
        [userId]
      );
    }

    const vinculo = await tx.query(
      `SELECT id FROM aurora.memberships
        WHERE user_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [userId, org.id]
    );

    if (vinculo[0]) {
      membroFinal = vinculo[0].id;
      await tx.query(
        `UPDATE aurora.memberships SET status = 'active', is_owner = true, updated_at = now() WHERE id = $1`,
        [membroFinal]
      );
    } else {
      await tx.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', 'staff', true)`,
        [membershipId, org.id, userId]
      );
    }

    /*
     * O ESCOPO É OBRIGATÓRIO, e a ausência dele é uma lacuna conhecida do
     * projeto: vínculo sem linha em `membership_scopes` não enxerga local
     * nenhum — falha fechada, correta, e absolutamente invisível na tela. A
     * pessoa entraria e veria um sistema vazio.
     */
    await tx.query(
      `INSERT INTO aurora.membership_scopes (membership_id, organization_id)
       VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`,
      [membroFinal, org.id]
    );
  });

  /*
   * O papel é `owner`, que na definição de fábrica tem `permissions: '*'`.
   *
   * Não inventei um "superadmin": `owner` já é o papel que responde pela conta,
   * e é o único com `organization.manage_billing`. Um papel novo com as mesmas
   * permissões seria um segundo lugar para manter a mesma lista.
   */
  const conexaoApp = pgPoolAdapter(pool, 'aurora_app');
  await db.withTenant(
    conexaoApp,
    buildContext({
      organizationId: org.id,
      membershipId: membroFinal,
      actorKind: 'system',
      requestId: 'admin-criar',
      permissions: PERMISSION_KEYS,
    }),
    async (s) => {
      const papeis = await db.provisionFactoryRoles(s);
      await db.assignRole(s, membroFinal, papeis.get('owner'));
    }
  );

  await db.definirSenha(admin, { userId, senha });

  const permissoes = await db.loadEffectivePermissions(admin, membroFinal);

  rl.close();
  stdout.write(
    '\n' +
      '─'.repeat(64) +
      '\n' +
      'Conta pronta.\n\n' +
      `  e-mail        ${email}\n` +
      `  nome          ${nome}\n` +
      `  organização   ${org.name}  (${org.slug})\n` +
      `  papel         owner (Proprietário) — ${permissoes.length} permissões efetivas\n` +
      `  provedor      password\n\n` +
      'A senha não foi impressa em lugar nenhum e não pode ser recuperada do\n' +
      'servidor: o banco guarda só o resumo em scrypt. Esqueceu? Rode este\n' +
      'comando de novo e redefina — as sessões abertas caem junto.\n\n' +
      'Para a API aceitar esta conta, o processo precisa subir com:\n' +
      '  AURORA_AUTH_PROVIDER=password\n\n'
  );
} catch (e) {
  rl.close();
  const msg = e instanceof Error ? e.message : String(e);
  stdout.write(`\n${msg === 'cancelado' ? 'Cancelado. Nada foi alterado.' : `Falhou: ${msg}`}\n\n`);
  process.exitCode = 1;
} finally {
  await admin.close();
}
