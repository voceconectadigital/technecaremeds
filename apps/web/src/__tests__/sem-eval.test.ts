/**
 * A validação no navegador não depende de `eval` (CSP sem 'unsafe-eval').
 */
import { describe, it, expect } from 'vitest';

describe('validação sem eval', () => {
  it('o módulo carregado primeiro desliga a compilação (e a sonda) do Zod', async () => {
    await import('../sem-eval');
    const { globalConfig } = await import('zod/v4/core');
    expect(globalConfig.jitless).toBe(true);
  });

  it('main.tsx importa o módulo antes de tudo', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const app of ['web', 'portal', 'field']) {
      const fonte = readFileSync(join(__dirname, '..', '..', '..', app, 'src', 'main.tsx'), 'utf8');
      const primeiroImport = fonte.split(/\r?\n/).find((l) => l.startsWith('import '));
      expect(primeiroImport, app).toBe("import './sem-eval';");
    }
  });
});
