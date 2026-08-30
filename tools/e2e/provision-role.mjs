#!/usr/bin/env node
/**
 * Aurora — cria o usuário de banco do ambiente de testes de ponta a ponta.
 *
 * POR QUE ISTO EXISTE
 *
 * A migration 0000 cria `aurora_app` como papel de GRUPO, sem LOGIN, de
 * propósito: "o usuário concreto de cada ambiente herda dele, o que mantém a
 * configuração portável entre local, Supabase e outros".
 *
 * O guarda de boot da API recusa subir se o papel da conexão tiver SUPERUSER
 * ou BYPASSRLS — e recusa com razão, porque qualquer um dos dois desativa o
 * isolamento entre organizações. Rodar o E2E como `postgres` seria testar um
 * sistema sem RLS, que não é o nosso.
 *
 * Então o E2E ganha o seu usuário concreto, exatamente como produção terá.
 *
 * A SENHA é de desenvolvimento local, num contêiner que só existe nesta
 * máquina, e vem do ambiente — nunca fica no repositório.
 *
 * ATENÇÃO — O PAPEL É DO CLUSTER, E NÃO DO BANCO.
 *
 * No PostgreSQL, papel é objeto do CLUSTER: rodar isto apontando para o banco de
 * desenvolvimento com uma senha diferente TROCA a senha que o ambiente de testes
 * usa, e a suíte inteira passa a falhar com "password authentication failed" —
 * num banco em que ninguém mexeu.
 *
 * Aconteceu exatamente assim, ao provisionar o papel para uma implantação de
 * homologação local. O sintoma aponta para o lugar errado: parece defeito da
 * suíte, e é o papel compartilhado.
 *
 * Se você precisa de dois ambientes na mesma instância, ou usam a MESMA senha,
 * ou usam papéis com nomes diferentes.
 *
 * Uso: DATABASE_URL=<superusuário> AURORA_E2E_DB_PASSWORD=... node tools/e2e/provision-role.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
const senha = process.env.AURORA_E2E_DB_PASSWORD;

if (!url) {
  console.error('DATABASE_URL não definido (precisa ser o superusuário).');
  process.exit(1);
}
/*
 * O PostgreSQL NÃO aceita parâmetro ligado em DDL — `CREATE ROLE ... PASSWORD
 * $1` é erro de sintaxe. A senha precisa entrar no texto do comando, e por
 * isso ela é validada contra uma lista fechada de caracteres ANTES: sem aspa,
 * sem barra, sem ponto e vírgula, sem espaço. Não é uma senha vinda de usuário
 * final; é uma variável de ambiente de máquina de desenvolvimento, e a
 * validação garante que ela não possa carregar comando.
 */
if (!senha || senha.length < 12) {
  console.error('AURORA_E2E_DB_PASSWORD não definido, ou com menos de 12 caracteres.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_.@#%+=-]+$/.test(senha)) {
  console.error(
    'AURORA_E2E_DB_PASSWORD só aceita letras, números e _.@#%+=- — para que ela não possa carregar comando SQL.'
  );
  process.exit(1);
}

const USUARIO = 'aurora_e2e_api';

const c = new Client({ connectionString: url });
await c.connect();

try {
  const { rows } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [USUARIO]);

  if (rows.length === 0) {
    // `NOBYPASSRLS NOSUPERUSER` explícitos: o padrão já é esse, mas dizer em
    // voz alta o que este usuário NÃO pode é o ponto dele existir.
    await c.query(
      `CREATE ROLE ${USUARIO} LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${senha}'`
    );
    console.log(`usuário ${USUARIO} criado`);
  } else {
    await c.query(`ALTER ROLE ${USUARIO} PASSWORD '${senha}'`);
    console.log(`usuário ${USUARIO} já existia; senha atualizada`);
  }

  await c.query(`ALTER ROLE ${USUARIO} NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`);

  // Herda o papel de grupo: os privilégios são os de `aurora_app`, e mais
  // nenhum. E precisa poder assumir `aurora_scheduler` e `aurora_publisher`
  // se um dia o worker rodar no E2E.
  await c.query(`GRANT aurora_app TO ${USUARIO}`);
  await c.query(`GRANT CONNECT ON DATABASE ${c.database} TO ${USUARIO}`);

  const { rows: conferido } = await c.query(
    `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`,
    [USUARIO]
  );
  const p = conferido[0];
  if (p.rolsuper || p.rolbypassrls) {
    throw new Error(`${USUARIO} ficou com privilégio indevido — abortando`);
  }

  console.log(`✓ ${USUARIO}: login=${p.rolcanlogin}, superuser=${p.rolsuper}, bypassrls=${p.rolbypassrls}`);
} finally {
  await c.end();
}
