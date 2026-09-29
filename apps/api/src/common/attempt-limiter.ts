/**
 * Aurora — limitador de tentativas em memória.
 *
 * É HONESTO SOBRE O QUE É: vale por processo. Com mais de uma instância, cada
 * uma tem a sua contagem. A defesa de verdade contra volume é da borda (WAF,
 * CDN); isto impede que uma única instância seja derrubada por um laço de shell,
 * e não pretende ser mais que isso.
 *
 * Nasceu dentro de `qr.controller.ts` e saiu de lá quando a rota de login
 * passou a precisar do mesmo. Duas cópias da mesma contagem divergiriam na
 * primeira correção — e a correção que importa aqui já foi feita uma vez: a
 * chave é o endereço do SOQUETE, nunca `x-forwarded-for`, que o próprio cliente
 * escreve. Ver o comentário de uso em cada chamador.
 *
 * O QUE ELE NÃO SUBSTITUI: no login, o contador por CONTA que vive no banco
 * (`aurora.user_credentials.failed_attempts`). Este segura a rajada de uma
 * origem; aquele segura a tentativa lenta e distribuída, que passa por baixo de
 * qualquer janela de um minuto. Os dois somam.
 */
export class AttemptLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 60,
    private readonly windowMs = 60_000
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const atual = this.hits.get(key);
    if (!atual || now >= atual.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      // Limpeza oportunista: sem ela o mapa cresce com cada origem já expirada.
      if (this.hits.size > 10_000) {
        for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
      }
      return true;
    }
    atual.count += 1;
    return atual.count <= this.max;
  }

  /** Quantos segundos até a janela virar. Para o `retry_after` da resposta. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const atual = this.hits.get(key);
    if (!atual || now >= atual.resetAt) return 0;
    return Math.max(1, Math.ceil((atual.resetAt - now) / 1000));
  }
}
