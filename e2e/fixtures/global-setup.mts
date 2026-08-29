/**
 * Aurora — estado conhecido antes de cada execução da suíte.
 *
 * SEM ISTO, A SUÍTE MENTE.
 *
 * Registros criados por uma execução sobrevivem para a seguinte, e um teste
 * que procura "OS para o quadro" encontra duas — a de agora e a de ontem. O
 * sintoma é falha por ambiguidade, e a tentação é usar `.first()` e seguir em
 * frente: aí o teste passa a olhar um registro de outra execução, e para de
 * testar o que diz que testa.
 *
 * A massa é apagada e recriada. É rápido porque é pequena, e é determinística
 * porque os identificadores são fixos.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const DATABASE_URL =
    process.env.AURORA_E2E_DATABASE_URL ?? 'postgres://postgres:aurora_dev_local@localhost:15432/aurora_e2e';

  execFileSync(process.execPath, [join(raiz, 'e2e', 'fixtures', 'seed.mjs'), '--reset'], {
    cwd: raiz,
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  });
}
