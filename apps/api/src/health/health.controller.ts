/**
 * Aurora — saúde da aplicação (EPIC-001).
 * `live`  não toca no banco: responde enquanto o processo estiver de pé.
 * `ready` verifica a dependência crítica; é o que o balanceador deve olhar.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import type { Database } from '@aurora/db';
import { DATABASE } from '../common/tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    let status = 'ok';
    try {
      await this.db.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'unavailable';
      status = 'degraded';
    }
    return { status, checks };
  }
}
