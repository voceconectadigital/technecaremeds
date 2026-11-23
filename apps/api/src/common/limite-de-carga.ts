/**
 * Aurora — limite de CONCORRÊNCIA das rotas caras (auditoria 23/11/2026, SEG-10 / PERF).
 *
 * O PROBLEMA
 *
 * Relatório (PDF/xlsx com série de 12 meses), relatório patrimonial, conformidade dos planos e a
 * execução de uma importação seguram uma conexão do pool por segundos. O pool da API tem 10
 * conexões (`AURORA_DB_POOL_MAX`) e cada consulta pode durar até 60 s: uma pessoa que dispara uma
 * dúzia de relatórios de uma vez (ou um clique repetido num botão lento) ocupava o pool inteiro, e o
 * login e o resto da API esperavam 10 s e caíam com 500 — para todo mundo.
 *
 * A REGRA
 *
 * Por VÍNCULO, no máximo `porPessoa` simultâneas; no PROCESSO, no máximo `total` simultâneas entre
 * todas as rotas marcadas — sobra pool para o resto. Acima disso, 429 com `retry_after_seconds`,
 * que o cliente já trata. Não há cota por minuto: quem espera o relatório terminar pode pedir outro.
 *
 * Em memória e por processo, de propósito: a API roda numa instância só (HostPanel). Com mais de
 * uma réplica, o teto efetivo vira `total × réplicas` — ainda limitado, que é o que importa.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { RateLimitedError } from '@aurora/domain';
import { finalize, type Observable } from 'rxjs';
import type { AuroraRequest } from './context.middleware';

export class LimiteDeConcorrencia {
  private readonly emCurso = new Map<string, number>();
  private total = 0;

  constructor(
    readonly porPessoa: number,
    readonly maximo: number
  ) {}

  /** Reserva uma vaga; devolve a função que a libera, ou `null` se não há vaga. */
  reservar(chave: string): (() => void) | null {
    const daPessoa = this.emCurso.get(chave) ?? 0;
    if (daPessoa >= this.porPessoa || this.total >= this.maximo) return null;
    this.emCurso.set(chave, daPessoa + 1);
    this.total += 1;
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      this.total -= 1;
      const resta = (this.emCurso.get(chave) ?? 1) - 1;
      if (resta <= 0) this.emCurso.delete(chave);
      else this.emCurso.set(chave, resta);
    };
  }

  get emAndamento(): number {
    return this.total;
  }
}

/** Uma instância por processo, compartilhada por todas as rotas marcadas. */
export const LIMITE_DE_ROTAS_PESADAS = new LimiteDeConcorrencia(2, 4);

@Injectable()
export class RotaPesadaInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuroraRequest & { ip?: string }>();
    const chave = req.auroraContext?.membershipId ?? `ip:${req.ip ?? 'desconhecido'}`;
    const liberar = LIMITE_DE_ROTAS_PESADAS.reservar(chave);
    if (!liberar) {
      throw new RateLimitedError(
        'Há relatórios ou exportações demais em andamento. Aguarde terminar e tente de novo.',
        5
      );
    }
    try {
      return next.handle().pipe(finalize(liberar));
    } catch (e) {
      liberar();
      throw e;
    }
  }
}
