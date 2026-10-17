/**
 * Aurora — a CSP gerada no build para o Cloudflare Pages (PF-80).
 * O gerador mora em tools/lib; o teste fica aqui porque é a suíte de configuração.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
// @ts-expect-error — módulo .mjs sem declaração de tipos
import { origemDe, hashesDosScriptsInline, politica } from '../../../../tools/lib/cabecalhos-pages.mjs';

describe('CSP do Pages', () => {
  it('usa só a ORIGEM da API e nada se ela for relativa', () => {
    expect(origemDe('https://api.exemplo.com.br/v1')).toBe('https://api.exemplo.com.br');
    expect(origemDe('/v1')).toBeNull();
    expect(origemDe(undefined)).toBeNull();
  });

  it('hash exato de cada script inline; script com src não entra', () => {
    const corpo = '\n  (function(){ document.documentElement.dataset.theme = "light"; })();\n';
    const html = `<head><script>${corpo}</script><script type="module" src="/x.js"></script></head>`;
    const esperado = `'sha256-${createHash('sha256').update(corpo, 'utf8').digest('base64')}'`;
    expect(hashesDosScriptsInline(html)).toEqual([esperado]);
  });

  it('o hash é o do navegador também num checkout Windows (CRLF vira LF)', () => {
    const comLf = '\n  window.x = 1;\n';
    const comCrlf = comLf.replace(/\n/g, '\r\n');
    expect(hashesDosScriptsInline(`<script>${comCrlf}</script>`)).toEqual(
      hashesDosScriptsInline(`<script>${comLf}</script>`)
    );
  });

  it('sem unsafe-inline em script, sem moldura, API só onde precisa', () => {
    const p: string = politica({ apiOrigem: 'https://api.x.test', hashes: ["'sha256-abc'"] });
    expect(p).toContain("script-src 'self' 'sha256-abc'");
    expect(p).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(p).toContain("connect-src 'self' https://api.x.test");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
  });
});
