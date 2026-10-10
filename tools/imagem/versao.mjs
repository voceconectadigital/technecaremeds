#!/usr/bin/env node
/**
 * Aurora — a versão do código que está rodando (`GET /v1/health/version`).
 *
 * POR QUE EXISTE: em 09/10/2026 um front novo foi publicado sobre uma API de
 * produção que se acreditava estar no `main` e não estava — o Painel de
 * Controle respondeu 404. A API não tinha como dizer o que rodava, e sem login
 * não dá para sondar rota (o guard responde 401 para tudo).
 *
 * DUAS RESPOSTAS, porque o commit nem sempre chega à imagem:
 *
 *   commit     — `AURORA_VERSAO` (argumento de build ou ambiente) ou, na falta,
 *                o `.git/HEAD` do contexto do build. Pode ser nulo: o HostPanel
 *                pode montar a imagem a partir de um pacote sem `.git`.
 *   impressao  — sha-256 (12 hex) do CÓDIGO que define o comportamento da API:
 *                `apps/api/src`, `apps/workers/src`, o `src` dos pacotes que a
 *                API carrega (domain, events, config, db, contracts) e
 *                `packages/db/migrations`, sem testes, com fim de linha
 *                normalizado. Sai igual em Linux e no Windows (autocrlf), então
 *                dá para comparar a imagem com qualquer commit local:
 *
 *                  git switch --detach <commit> && node tools/imagem/versao.mjs
 *
 * Uso:
 *   node tools/imagem/versao.mjs                       → imprime o JSON
 *   node tools/imagem/versao.mjs --gravar <arquivo>    → grava (o Dockerfile usa)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(fileURLToPath(import.meta.url), '..', '..', '..');

function arquivos(dir) {
  if (!existsSync(dir)) return [];
  const saida = [];
  for (const nome of readdirSync(dir)) {
    if (nome === '__tests__' || nome === 'node_modules' || nome === 'dist') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (!/\.test\.[cm]?[jt]sx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

export function impressao(base = raiz) {
  // Só o que muda o comportamento da API e dos workers: mexer na interface
  // (ui, app-kit, apps/web) não muda a impressão.
  const pastas = [
    'apps/api/src',
    'apps/workers/src',
    'packages/db/migrations',
    ...['domain', 'events', 'config', 'db', 'contracts'].map((p) => `packages/${p}/src`),
  ].map((p) => join(base, p));
  const lista = pastas
    .flatMap(arquivos)
    .map((a) => ({ a, rel: relative(base, a).split(sep).join('/') }))
    .sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const { a, rel } of lista) {
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(a, 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

function commitDoGit(base = raiz) {
  try {
    const head = readFileSync(join(base, '.git/HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return null;
    const solto = join(base, '.git', ref);
    if (existsSync(solto)) return readFileSync(solto, 'utf8').trim();
    const empacotados = join(base, '.git/packed-refs');
    if (existsSync(empacotados)) {
      const linha = readFileSync(empacotados, 'utf8')
        .split('\n')
        .find((l) => l.endsWith(` ${ref}`));
      if (linha) return linha.split(' ')[0];
    }
  } catch {
    /* sem .git no contexto: o commit fica nulo, e a impressão responde */
  }
  return null;
}

export function versao() {
  const doAmbiente = (process.env.AURORA_VERSAO ?? '').trim();
  return {
    commit: /^[0-9a-f]{7,40}$/.test(doAmbiente) ? doAmbiente : commitDoGit(),
    impressao: impressao(),
    construido_em: new Date().toISOString(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const v = versao();
  const i = process.argv.indexOf('--gravar');
  if (i > 0 && process.argv[i + 1]) {
    writeFileSync(process.argv[i + 1], JSON.stringify(v, null, 2) + '\n');
    console.log(`versão gravada em ${process.argv[i + 1]}:`, v);
  } else {
    console.log(JSON.stringify(v, null, 2));
  }
}
