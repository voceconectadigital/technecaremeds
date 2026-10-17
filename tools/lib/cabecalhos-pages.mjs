/**
 * Aurora — política de conteúdo (CSP) dos apps no Cloudflare Pages, GERADA NO
 * BUILD (pente-fino 17/10/2026, PF-80).
 *
 * POR QUE NO BUILD
 *
 * A CSP precisa nomear a origem da API, e essa origem muda por implantação —
 * ela só existe como `VITE_API_URL` na hora do build. Um `_headers` estático
 * erraria em toda implantação menos uma. Pelo mesmo motivo os scripts inline do
 * `index.html` (o tema aplicado antes de o React montar) entram por HASH,
 * calculado sobre o HTML que de fato foi publicado — nunca `'unsafe-inline'`.
 *
 * POR QUE REPORT-ONLY
 *
 * Uma CSP errada derruba a aplicação inteira, em produção, sem que nenhum teste
 * daqui perceba (o servidor de desenvolvimento e o E2E não leem `_headers`). A
 * política sai como `Content-Security-Policy-Report-Only`: o navegador avisa o
 * que bloquearia e não bloqueia nada. Depois de uma navegação limpa no ambiente
 * publicado, trocar para `Content-Security-Policy` é mudar `REPORT_ONLY` abaixo.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPORT_ONLY = true;

/** Origem (`https://host:porta`) de uma URL absoluta; `null` para caminho relativo. */
export function origemDe(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Hashes `sha256-…` dos `<script>` inline (sem `src`) de um HTML. */
export function hashesDosScriptsInline(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const corpo = m[1];
    if (!corpo.trim()) continue;
    hashes.push(`'sha256-${createHash('sha256').update(corpo, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export function politica({ apiOrigem, hashes }) {
  const api = apiOrigem ? ` ${apiOrigem}` : '';
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.length ? ' ' + hashes.join(' ') : ''}`,
    // React aplica `style=` em atributos; sem isto, toda tela quebraria.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${api}`,
    "font-src 'self' data:",
    `connect-src 'self'${api}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Plugin do Vite: acrescenta a CSP ao `_headers` copiado de `public/`. */
export function cabecalhosDoPages({ apiUrl } = {}) {
  let saida = null;
  return {
    name: 'technecare-cabecalhos-pages',
    apply: 'build',
    configResolved(config) {
      saida = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!saida) return;
      const html = join(saida, 'index.html');
      const cabecalhos = join(saida, '_headers');
      if (!existsSync(html) || !existsSync(cabecalhos)) return;
      const csp = politica({
        apiOrigem: origemDe(apiUrl),
        hashes: hashesDosScriptsInline(readFileSync(html, 'utf8')),
      });
      const nome = REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
      const atual = readFileSync(cabecalhos, 'utf8').replace(/\s+$/, '');
      writeFileSync(cabecalhos, `${atual}\n  ${nome}: ${csp}\n`);
    },
  };
}
