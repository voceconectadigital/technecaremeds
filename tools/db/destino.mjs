#!/usr/bin/env node
/**
 * Aurora — a porta por onde todo comando de banco passa.
 *
 * Carrega `aurora.destinos.json`, confere o destino com
 * `packages/config/src/destino.ts`, e ENCERRA COM 1 em qualquer recusa.
 *
 * A regra decisiva está no módulo de configuração, e não aqui, por dois
 * motivos: ela é testável sem processo filho, e é o mesmo código para quem
 * chamar de dentro da aplicação. Este arquivo só faz a ponte com o sistema de
 * arquivos e com o código de saída.
 *
 * CONFERE TAMBÉM DE ONDE FOI DISPARADO. Um comando do Aurora executado a partir
 * de outro projeto é o começo de todo acidente de destino: o `cwd` muda, o
 * `.env` muda junto, e o operador não percebe. Fora do repositório, nada
 * acontece.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.TSX_TSCONFIG_PATH ??= join(raiz, 'tsconfig.base.json');

/** Recusa uniforme: uma linha de título, o motivo, e saída 1. */
function recusar(titulo, detalhe) {
  process.stderr.write(`\n✗ ${titulo}\n\n${detalhe}\n\n`);
  process.exit(1);
}

/**
 * Confere que o comando está sendo executado DE DENTRO do Aurora.
 *
 * O QUE SE CONFERE É O `cwd`, E NÃO A RAIZ DO SCRIPT.
 *
 * A primeira versão disto lia o `package.json` da pasta do próprio arquivo —
 * que é sempre a do Aurora, por construção. A conferência nunca poderia falhar:
 * era decorativa, o mesmo defeito do `AURORA_CONFIRM_REMOTE` que ela veio
 * substituir. Um teste disparado de outro diretório mostrou isso na hora.
 *
 * O que interessa é de ONDE o comando foi disparado, porque é o `cwd` que
 * decide qual `.env` é lido, quais caminhos relativos resolvem, e qual projeto
 * a pessoa acha que está operando.
 *
 * O nome da PASTA não serve como critério: o repositório do Aurora se chama
 * `technecaremeds` no disco, e essa decisão é do cliente.
 */
function exigirRepositorioAurora() {
  const aqui = resolve(process.cwd());
  const base = resolve(raiz);
  if (aqui !== base && !aqui.startsWith(base + sep)) {
    recusar(
      'este comando é do Aurora e foi disparado de fora do repositório.',
      `  diretório atual : ${aqui}\n  repositório     : ${base}\n\n` +
        'Nada foi tentado. O diretório de trabalho decide qual .env é lido e\n' +
        'quais caminhos relativos resolvem — operar o Aurora de fora dele é o\n' +
        'começo de um acidente de destino.'
    );
  }

  let nome;
  try {
    nome = require(join(raiz, 'package.json')).name;
  } catch {
    recusar('não consegui ler o package.json da raiz.', `Raiz calculada: ${raiz}`);
  }
  if (nome !== 'aurora') {
    recusar('a raiz encontrada não é o Aurora.', `  package.json name : ${nome}\n  raiz : ${raiz}`);
  }
}

export function conferirOuSair(url) {
  exigirRepositorioAurora();

  if (!url) {
    recusar('DATABASE_URL não definido.', 'Consulte .env.example. Este comando não descobre banco sozinho.');
  }

  let lista;
  try {
    lista = JSON.parse(readFileSync(join(raiz, 'aurora.destinos.json'), 'utf8'));
  } catch (e) {
    recusar(
      'não consegui ler aurora.destinos.json.',
      'Sem a lista de destinos não há como conferir para onde este comando vai,\n' +
        'e um comando de banco sem destino conferido não roda.\n\n' +
        (e instanceof Error ? e.message : String(e))
    );
  }

  require('tsx/cjs');
  const { conferirDestino } = require(join(raiz, 'packages', 'config', 'src', 'destino.ts'));

  try {
    const r = conferirDestino({ url, ambiente: process.env.AURORA_AMBIENTE, lista });
    const onde = r.destino.remoto
      ? `REMOTO ${r.destino.host}${r.destino.ref ? ` (projeto ${r.destino.ref})` : ''}`
      : `local ${r.destino.host}`;
    process.stderr.write(
      `  destino conferido · ambiente "${r.ambiente}" · ${onde} · banco ${r.destino.banco}\n`
    );
    return r;
  } catch (e) {
    recusar('DESTINO RECUSADO — nada foi tentado no banco.', e instanceof Error ? e.message : String(e));
  }
}

/* Uso direto: `node tools/db/destino.mjs` confere e sai. Serve à CI e ao humano. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  conferirOuSair(process.env.DATABASE_URL);
  process.stderr.write('\n✓ destino permitido.\n\n');
}
