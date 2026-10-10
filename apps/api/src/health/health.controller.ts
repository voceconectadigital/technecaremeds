/**
 * Aurora — saúde da aplicação (EPIC-001).
 * `live`    não toca no banco: responde enquanto o processo estiver de pé.
 * `ready`   verifica a dependência crítica; é o que o balanceador deve olhar.
 * `version` diz qual código está rodando — gravado no build da imagem por
 *           `tools/imagem/versao.mjs` em `apps/api/dist/versao.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Inject } from '@nestjs/common';
import { checkConnectivity, type Database } from '@aurora/db';
import { DATABASE } from '../common/tokens';

interface Versao {
  commit: string | null;
  impressao: string | null;
  construido_em: string | null;
}

/**
 * Lida uma vez, na subida. Fora da imagem (desenvolvimento, testes) o arquivo
 * não existe e tudo vem nulo — nulo é "não sei", e nunca um palpite.
 */
function lerVersao(): Versao {
  try {
    // Compilado, este arquivo está em apps/api/dist/health/; o build grava ao lado de dist/.
    const v = JSON.parse(readFileSync(join(__dirname, '..', 'versao.json'), 'utf8')) as Partial<Versao>;
    return {
      commit: typeof v.commit === 'string' ? v.commit : null,
      impressao: typeof v.impressao === 'string' ? v.impressao : null,
      construido_em: typeof v.construido_em === 'string' ? v.construido_em : null,
    };
  } catch {
    return { commit: null, impressao: null, construido_em: null };
  }
}

const VERSAO = lerVersao();

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('version')
  version(): Versao {
    return VERSAO;
  }

  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    const ok = await checkConnectivity(this.db);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: { database: ok ? 'ok' : 'unavailable' },
    };
  }
}
