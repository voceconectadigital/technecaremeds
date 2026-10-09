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
import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const require = createRequire(import.meta.url);
// Fonte TypeScript via tsx em desenvolvimento; `dist/` na imagem (tools/lib/fonte.mjs).
const { carregarFonte } = await import('../lib/fonte.mjs');
const { fileURLToPath } = await import('node:url');
const raiz = fileURLToPath(new URL('../..', import.meta.url));

/* -------------------------------------------------------------- o destino */

const { conferirOuSair } = await import('../db/destino.mjs');
const url = process.env.DATABASE_URL;
conferirOuSair(url);

const { Pool } = require('pg');
const db = carregarFonte(raiz, 'packages', 'db', 'src', 'index.ts');
const { pgPoolAdapter } = carregarFonte(raiz, 'packages', 'db', 'src', 'adapters.ts');
const dominio = carregarFonte(raiz, 'packages', 'domain', 'src', 'index.ts');

/* ------------------------------------------------------------- a conversa */

/*
 * O `readline` É CRIADO TARDE, e isso nasceu do segundo defeito desta função.
 *
 * `createInterface` começa a CONSUMIR o fluxo de entrada no instante em que
 * existe. Com a entrada vindo de um pipe e todas as respostas já dadas por
 * argumento, ele engolia as linhas antes de qualquer `question` e disparava
 * `close` — o comando morria com "readline was closed" depois de já ter escrito
 * na tela, o que faz o erro parecer de banco.
 *
 * Criando-o só na primeira pergunta de verdade, o caminho sem perguntas nunca o
 * cria, e o caminho interativo se comporta como sempre.
 */
let rl = null;
function linha() {
  rl ??= createInterface({ input: stdin, output: stdout });
  return rl;
}
function fecharLeitura() {
  rl?.close();
  rl = null;
}

/*
 * UMA SÓ FORMA DE LER A ENTRADA, E ISSO NASCEU DE UM DEFEITO.
 *
 * A primeira versão lia as perguntas comuns pelo `readline` e a senha
 * diretamente de `stdin` em modo cru. As duas competem pelo MESMO fluxo: com a
 * entrada vindo de um pipe, o `readline` consome o buffer inteiro na primeira
 * pergunta e a leitura crua nunca recebe nada — o comando morria com "readline
 * was closed" depois de já ter escrito na tela, o que faz o erro parecer de
 * banco.
 *
 * Agora tudo passa pelo `readline`, e o silêncio do campo de senha é obtido
 * desligando o eco DELE (`_writeToOutput`), que é o único lugar por onde o que
 * se digita chegaria à tela.
 */
function perguntar(texto) {
  return new Promise((resolve) => linha().question(texto, (r) => resolve(r.trim())));
}

/**
 * Lê sem eco.
 *
 * `mudo` faz o `readline` continuar aceitando a linha e parar de escrevê-la. O
 * prompt em si precisa passar, senão a pergunta não apareceria — daí a
 * comparação com o texto do prompt.
 *
 * NÃO faz `trim()`: espaço no começo ou no fim de uma senha é significativo, e
 * cortá-lo aqui gravaria um resumo de uma senha diferente da que a pessoa
 * digitou. Quem quiser recusar espaço é a regra de força, que recusa e explica.
 */
function perguntarSegredo(texto) {
  return new Promise((resolve) => {
    const leitor = linha();
    let mudo = false;
    const escritaOriginal = leitor._writeToOutput?.bind(leitor);
    leitor._writeToOutput = (cadeia) => {
      if (!escritaOriginal) return;
      if (mudo && !cadeia.includes(texto)) return;
      escritaOriginal(cadeia);
    };
    leitor.question(texto, (r) => {
      mudo = false;
      if (escritaOriginal) leitor._writeToOutput = escritaOriginal;
      stdout.write('\n');
      resolve(r);
    });
    mudo = true;
  });
}

/**
 * A senha por `--senha-stdin`, como `docker login --password-stdin`.
 *
 * Existe para automação e para esta validação: um pipe não tem como "digitar
 * duas vezes", e pedir confirmação de algo que veio de um arquivo seria teatro.
 *
 * Continua NÃO sendo argumento de linha de comando: argumento fica no histórico
 * do shell e na lista de processos, onde qualquer outro usuário da máquina o lê.
 * O fluxo de entrada não fica em nenhum dos dois.
 */
function senhaDoFluxoDeEntrada() {
  const bruto = readFileSync(0, 'utf8');
  // Só a primeira linha, e o `\r` do Windows fora — um `\r` invisível no fim
  // gravaria o resumo de uma senha que ninguém consegue digitar depois.
  return bruto.split('\n')[0].replace(/\r$/, '');
}

/** `--org=slug --email=... --nome="..."`. A SENHA NUNCA vem por argumento. */
const argumentos = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
    })
);

function sair(mensagem, codigo = 1) {
  fecharLeitura();
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

  let org;

  if (typeof argumentos.org === 'string') {
    /* `--org=slug`: exato, e a recusa diz o que existe. É o caminho de quem
     * automatiza, e o único que não depende de a lista caber na tela. */
    const achada = await admin.query(
      `SELECT id, slug, name FROM aurora.organizations
        WHERE slug = $1 AND deleted_at IS NULL AND status = 'active'`,
      [argumentos.org]
    );
    org = achada[0];
    if (!org) sair(`Não há organização ativa com slug "${argumentos.org}". Nada foi alterado.`);
  } else {
    /*
     * A LISTA É FILTRADA, e esse filtro nasceu de uma surpresa real: o banco de
     * desenvolvimento tinha 130 organizações com nomes como `jobs-a-mtf6xgyy`,
     * deixadas por suítes que rodaram contra ele. A lista virava rolagem e a
     * escolha "1" apontava para lixo.
     *
     * O filtro esconde o que tem cara de massa de teste — slug com sufixo
     * aleatório — e o total é dito por extenso, porque uma lista que esconde
     * linhas sem avisar é pior do que uma lista longa.
     */
    const todas = await admin.query(
      `SELECT id, slug, name FROM aurora.organizations
        WHERE deleted_at IS NULL AND status = 'active' ORDER BY created_at`
    );
    if (todas.length === 0) {
      sair(
        'Não há organização neste banco.\n' +
          'Rode `npm run homolog:semear` (massa de homologação) ou `npm run db:seed` primeiro:\n' +
          'uma conta sem organização não enxerga tela nenhuma.'
      );
    }

    const ruido = /^(jobs-[ab]-|pg[ab]|org-|t-|tenant-)/i;
    const candidatas = todas.filter((o) => !ruido.test(o.slug));
    const lista = candidatas.length > 0 ? candidatas : todas;

    stdout.write(`Organizações neste banco (${todas.length} no total`);
    stdout.write(
      todas.length !== lista.length
        ? `, ${todas.length - lista.length} com cara de massa de teste foram omitidas):\n\n`
        : '):\n\n'
    );
    lista.forEach((o, i) => stdout.write(`  ${i + 1}. ${o.name}   (${o.slug})\n`));
    stdout.write('\n');

    const escolha = await perguntar(`Em qual organização a conta entra? [1-${lista.length}] `);
    org = lista[Number(escolha) - 1];
    if (!org) sair('Escolha inválida. Nada foi alterado.');
  }

  /* ------------------------------------------------------------ a pessoa */

  const email = (typeof argumentos.email === 'string' ? argumentos.email : await perguntar('E-mail: '))
    .trim()
    .toLowerCase();
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
    /*
     * `--senha-stdin` IMPLICA a confirmação.
     *
     * Quem canaliza uma senha para dentro do comando já decidiu redefini-la —
     * parar para perguntar ali trava o processo, porque não há ninguém para
     * responder e o fluxo de entrada guarda a senha, não um "s". O padrão
     * interativo continua perguntando, que é onde a pergunta serve para algo.
     */
    if (argumentos['senha-stdin']) {
      stdout.write('Redefinindo a senha (confirmação implícita por --senha-stdin).\n');
    } else {
      const ok = await perguntar('Redefinir a senha dela e garantir o papel administrativo? [s/N] ');
      if (ok.toLowerCase() !== 's') sair('Nada foi alterado.', 0);
    }
    nome = existente[0].name;
  } else {
    nome = typeof argumentos.nome === 'string' ? argumentos.nome.trim() : await perguntar('Nome completo: ');
    if (nome.length < 2) sair('Nome muito curto. Nada foi alterado.');
  }

  /* -------------------------------------------------------------- a senha */

  let senha;
  let senhaFraca = null;

  if (argumentos['senha-stdin']) {
    senha = senhaDoFluxoDeEntrada();
    const problemas = dominio.conferirForcaDaSenha(senha, { email });
    if (problemas.length > 0) {
      /*
       * A DISPENSA EXISTE, É EXPLÍCITA, E GRITA.
       *
       * Uma conta de demonstração com senha combinada por escrito — "a senha da
       * demo é esta, e todo mundo sabe" — é um caso legítimo, e é o único. Sem
       * uma saída declarada, quem precisa dela afrouxa a REGRA, que vale para
       * todas as contas; e a regra afrouxada não volta.
       *
       * A forma é a do resto do projeto: a exceção é nomeada, exige um ato
       * deliberado de quem a usa, e aparece no que o comando imprime — para que
       * a próxima pessoa que ler a saída saiba que aquela conta é frágil de
       * propósito. O `docs/RELATORIO-HANDOFF-E-LOGIN.md` registra o mesmo.
       */
      if (!argumentos['aceitar-senha-fraca']) {
        stdout.write('\nA senha recebida pela entrada padrão não serve:\n');
        problemas.forEach((p) => stdout.write(`  · ${p.message}\n`));
        stdout.write(
          '\nSe esta é uma conta de DEMONSTRAÇÃO com senha combinada, e você aceita\n' +
            'que ela é fraca, repita o comando com --aceitar-senha-fraca.\n'
        );
        sair('Nada foi alterado.');
      }
      senhaFraca = problemas.map((p) => p.message);
      stdout.write('\n⚠ SENHA FRACA ACEITA DELIBERADAMENTE (--aceitar-senha-fraca):\n');
      problemas.forEach((p) => stdout.write(`  · ${p.message}\n`));
      stdout.write('  Esta conta NÃO serve para produção.\n');
    }
    stdout.write('\nSenha recebida pela entrada padrão.\n');
  } else {
    stdout.write(
      `\nA senha precisa de pelo menos ${dominio.SENHA_MINIMA} caracteres. Comprimento vale mais\n` +
        'que símbolos: uma frase que só você saberia é melhor que "Senha@123".\n' +
        'Nada do que você digitar aparece na tela, no log ou no relatório.\n\n'
    );

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
      await tx.query(`UPDATE aurora.users SET auth_provider = 'password', updated_at = now() WHERE id = $1`, [
        userId,
      ]);
    }

    const vinculo = await tx.query(
      `SELECT id FROM aurora.memberships
        WHERE user_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [userId, org.id]
    );

    /*
     * TITULARIDADE NÃO É PAPEL, e a primeira versão deste comando confundiu as
     * duas: ela marcava `is_owner = true` e batia no índice
     * `memberships_single_owner_uq` — só um titular por organização, ativo e não
     * excluído.
     *
     * O índice está certo e a tentativa estava errada. `is_owner` diz QUEM
     * RESPONDE pela conta; um administrador que entra depois recebe o PAPEL
     * administrativo, e não a titularidade de quem já a tem. Tomá-la seria
     * mudar, em silêncio, quem responde pela organização — por causa de um
     * comando que só queria criar um acesso.
     *
     * A titularidade só é concedida quando a organização não tem nenhuma, que é
     * o caso de uma organização recém-criada.
     */
    const jaTemTitular = await tx.query(
      `SELECT 1 FROM aurora.memberships
        WHERE organization_id = $1 AND is_owner AND deleted_at IS NULL AND status = 'active'
        LIMIT 1`,
      [org.id]
    );
    const titular = jaTemTitular.length === 0;

    if (vinculo[0]) {
      membroFinal = vinculo[0].id;
      await tx.query(`UPDATE aurora.memberships SET status = 'active', updated_at = now() WHERE id = $1`, [
        membroFinal,
      ]);
    } else {
      await tx.query(
        `INSERT INTO aurora.memberships (id, organization_id, user_id, status, seat_type, is_owner)
         VALUES ($1, $2, $3, 'active', 'staff', $4)`,
        [membershipId, org.id, userId, titular]
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
   * O PAPEL É `admin`, e nenhum papel novo foi inventado.
   *
   * Os dois papéis de fábrica com alcance total já existem e a diferença entre
   * eles é exatamente a que importa aqui:
   *
   *   owner — `permissions: '*'`. É quem responde pela conta, e o único com
   *           `organization.manage_billing` e titularidade.
   *   admin — `permissions: '*'` EXCETO `organization.manage_billing`. "Tudo,
   *           exceto faturamento e titularidade."
   *
   * Um administrador que entra numa organização que já tem titular é `admin`:
   * ele configura, opera e lê tudo, e não passa a responder pela fatura de
   * ninguém. `--papel=owner` existe para a organização que não tem titular.
   */
  const papelEscolhido = typeof argumentos.papel === 'string' ? argumentos.papel : 'admin';
  if (!['admin', 'owner'].includes(papelEscolhido)) {
    sair(`--papel aceita "admin" ou "owner", e veio "${papelEscolhido}". Nada foi alterado.`);
  }
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
      await db.assignRole(s, membroFinal, papeis.get(papelEscolhido));
    }
  );

  await db.definirSenha(admin, { userId, senha });

  const permissoes = await db.loadEffectivePermissions(admin, membroFinal);

  fecharLeitura();
  stdout.write(
    '\n' +
      '─'.repeat(64) +
      '\n' +
      'Conta pronta.\n\n' +
      `  e-mail        ${email}\n` +
      `  nome          ${nome}\n` +
      `  organização   ${org.name}  (${org.slug})\n` +
      `  papel         ${papelEscolhido} — ${permissoes.length} permissões efetivas\n` +
      `  provedor      password\n` +
      (senhaFraca
        ? `  senha         FRACA, aceita deliberadamente (${senhaFraca.join('; ')}).\n` +
          `                Conta de demonstração — NÃO use em produção.\n`
        : '') +
      `\n` +
      'A senha não foi impressa em lugar nenhum e não pode ser recuperada do\n' +
      'servidor: o banco guarda só o resumo em scrypt. Esqueceu? Rode este\n' +
      'comando de novo e redefina — as sessões abertas caem junto.\n\n' +
      'Para a API aceitar esta conta, o processo precisa subir com:\n' +
      '  AURORA_AUTH_PROVIDER=password\n\n'
  );
} catch (e) {
  fecharLeitura();
  const msg = e instanceof Error ? e.message : String(e);
  stdout.write(`\n${msg === 'cancelado' ? 'Cancelado. Nada foi alterado.' : `Falhou: ${msg}`}\n\n`);
  process.exitCode = 1;
} finally {
  await admin.close();
}
