/**
 * A validação no navegador não depende de `eval` (CSP sem 'unsafe-eval').
 *
 * O ambiente desta suíte é o jsdom — há `document` —, como no navegador.
 */
import { describe, it, expect } from 'vitest';

describe('validação sem eval no navegador', () => {
  it('carregar os contratos desliga a compilação (e a sonda) do Zod', async () => {
    await import('@aurora/contracts');
    const { globalConfig } = await import('zod/v4/core');
    expect(globalConfig.jitless).toBe(true);
  });

  it('nenhum contrato importa o Zod por fora do módulo que configura', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'src');
    const fora: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (/\.ts$/.test(nome) && nome !== 'zod.ts' && !caminho.includes('__tests__')) {
          if (/from 'zod(\/v4)?'/.test(readFileSync(caminho, 'utf8'))) fora.push(caminho);
        }
      }
    };
    varrer(raiz);
    expect(fora).toEqual([]);
  });
});
