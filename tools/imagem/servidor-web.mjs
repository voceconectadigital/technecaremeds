#!/usr/bin/env node
/**
 * Aurora — o portão HTTP do ambiente conectado num único host (HostPanel).
 *
 * Serve o build de `apps/web` (SPA: caminho desconhecido devolve index.html) e
 * repassa `/v1/*` para a API na rede interna (`AURORA_API_INTERNA`, padrão
 * http://api:3000). O navegador fala com UMA origem: o frontend usa `/v1` (o
 * padrão de `VITE_API_URL`), não há CORS a abrir e a API não precisa ser pública.
 *
 * Node puro, sem dependência. Não guarda nada, não reescreve corpo, não loga
 * cabeçalho de autorização.
 */
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const RAIZ = resolve(process.env.AURORA_WEB_DIR ?? '/app/web');
const API = new URL(process.env.AURORA_API_INTERNA ?? 'http://api:3000');
const PORTA = Number(process.env.AURORA_WEB_PORT ?? 8080);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

/** Arquivo dentro de RAIZ, ou null (nada de `..`). */
function arquivo(caminho) {
  let rel;
  try {
    rel = decodeURIComponent(caminho.split('?')[0]);
  } catch {
    return null;
  }
  const alvo = resolve(RAIZ, '.' + normalize('/' + rel));
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + sep)) return null;
  return existsSync(alvo) && statSync(alvo).isFile() ? alvo : null;
}

function servir(res, caminho, imutavel) {
  res.writeHead(200, {
    ...SEGURANCA,
    'content-type': TIPOS[extname(caminho)] ?? 'application/octet-stream',
    'cache-control': imutavel ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(caminho).pipe(res);
}

function repassar(req, res) {
  const saida = httpRequest(
    {
      protocol: API.protocol,
      hostname: API.hostname,
      port: API.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: API.host },
    },
    (resposta) => {
      res.writeHead(resposta.statusCode ?? 502, resposta.headers);
      resposta.pipe(res);
    }
  );
  saida.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'degraded', error: 'api_indisponivel' }));
  });
  req.pipe(saida);
}

createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/v1' || url.startsWith('/v1/')) return repassar(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SEGURANCA);
    return res.end();
  }
  const achado = arquivo(url);
  if (achado) return servir(res, achado, url.startsWith('/assets/'));
  return servir(res, join(RAIZ, 'index.html'), false);
}).listen(PORTA, () =>
  console.log(JSON.stringify({ nivel: 'info', mensagem: 'portão web no ar', porta: PORTA }))
);

for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => process.exit(0));
