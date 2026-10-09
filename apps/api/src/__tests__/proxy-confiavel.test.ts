/**
 * Aurora — o IP do cliente atrás do HostPanel (Traefik → portão web → API).
 *
 * O limite de tentativas de entrada é por `req.ip`. Estes casos provam as três
 * coisas que importam: sem proxy confiável o cabeçalho é ignorado; com a rede
 * privada confiável o cliente real aparece; e um `x-forwarded-for` forjado na
 * internet nunca vira a identidade — nem para fugir do limite, nem para pôr
 * outra pessoa no limite.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { trustProxyPara } from '../bootstrap';
import { AttemptLimiter } from '../common/attempt-limiter';

function app(modo: 'nenhum' | 'rede-privada') {
  const limiter = new AttemptLimiter(10, 60_000);
  const a = express();
  a.set('trust proxy', trustProxyPara(modo));
  a.post('/login', (req, res) => {
    const origem = req.ip ?? 'desconhecida';
    if (limiter.bloqueado(origem)) return res.status(429).json({ origem });
    limiter.registrarFalha(origem);
    return res.status(401).json({ origem });
  });
  return a;
}

// Saltos do HostPanel: o Traefik (rede de containers) e o soquete do portão (loopback no teste).
const TRAEFIK = '172.18.0.5';

describe('IP real do cliente (AURORA_PROXY_CONFIAVEL)', () => {
  it('padrão `nenhum`: x-forwarded-for é ignorado, vale o soquete', async () => {
    const r = await request(app('nenhum')).post('/login').set('x-forwarded-for', `203.0.113.9, ${TRAEFIK}`);
    expect(r.body.origem).toMatch(/127\.0\.0\.1|::1/);
  });

  it('`rede-privada`: o primeiro endereço público da direita é o cliente', async () => {
    const r = await request(app('rede-privada'))
      .post('/login')
      .set('x-forwarded-for', `203.0.113.9, ${TRAEFIK}`);
    expect(r.body.origem).toBe('203.0.113.9');
  });

  it('cabeçalho forjado pelo cliente fica à esquerda e nunca é escolhido', async () => {
    const r = await request(app('rede-privada'))
      .post('/login')
      .set('x-forwarded-for', `6.6.6.6, 203.0.113.9, ${TRAEFIK}`);
    expect(r.body.origem).toBe('203.0.113.9');
  });

  it('dois clientes distintos não dividem o limite; o brute force de um é bloqueado', async () => {
    const a = app('rede-privada');
    const cliente = (ip: string) => request(a).post('/login').set('x-forwarded-for', `${ip}, ${TRAEFIK}`);
    for (let i = 0; i < 10; i++) expect((await cliente('198.51.100.1')).status).toBe(401);
    expect((await cliente('198.51.100.1')).status).toBe(429);
    // Outra pessoa, outro IP: continua podendo tentar.
    expect((await cliente('198.51.100.2')).status).toBe(401);
    // O atacante trocando o x-forwarded-for forjado não escapa: a identidade é o salto real.
    expect(
      (await request(a).post('/login').set('x-forwarded-for', `9.9.9.9, 198.51.100.1, ${TRAEFIK}`)).status
    ).toBe(429);
  });
});
