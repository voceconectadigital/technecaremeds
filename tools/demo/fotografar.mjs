/**
 * Fotografa telas da demonstração local (ou de DEMO_URL) em larguras fixas.
 *
 *   node tools/demo/fotografar.mjs <saida> <rota>[@LxA] [<rota>[@LxA] …]
 *
 * Sem rede além da própria demo. Reprova (código 1) se houver erro de console
 * ou rolagem lateral — é a mesma régua do `e2e/demo`, numa ferramenta de mão
 * para conferir telas novas antes de escrever o teste.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [saida, ...rotas] = process.argv.slice(2);
const base = process.env.DEMO_URL ?? 'http://localhost:5421';
mkdirSync(saida, { recursive: true });

const navegador = await chromium.launch();
let falhou = false;
for (const alvo of rotas) {
  const [rota, tamanho = '1440x900'] = alvo.split('@');
  const [w, h] = tamanho.split('x').map(Number);
  const pagina = await navegador.newPage({ viewport: { width: w, height: h } });
  const erros = [];
  pagina.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  pagina.on('pageerror', (e) => erros.push(e.message));
  // Link profundo entra na demonstração sozinho (routes/router.tsx).
  await pagina.goto(`${base}${rota}`);
  await pagina
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .catch(() => undefined);
  await pagina.waitForTimeout(800);
  const lateral = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const nome = `${rota.replace(/[^a-z0-9]+/gi, '_')}_${w}x${h}.png`.replace(/^_/, '');
  await pagina.screenshot({ path: join(saida, nome), fullPage: rota.includes('/tv') ? false : true });
  console.log(
    `${rota} ${w}x${h} → ${nome}${lateral ? ' · ROLAGEM LATERAL' : ''}${erros.length ? ` · ERROS: ${erros.join(' | ').slice(0, 300)}` : ''}`
  );
  if (lateral || erros.length) falhou = true;
  await pagina.close();
}
await navegador.close();
process.exit(falhou ? 1 : 0);
