/**
 * Aurora — criação da aplicação (compartilhada entre runtime e testes).
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createAppModule, type AppDeps } from './app.module';
import { DomainErrorFilter } from './common/error.filter';
import { PermissionsGuard } from './common/permissions.guard';
import { ScopeGuard } from './common/scope.guard';
import { DATABASE } from './common/tokens';
import { Reflector } from '@nestjs/core';
import { createLogger } from './common/logger';
import { json, raw, urlencoded } from 'express';

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const logger = deps.logger ?? createLogger(deps.env.AURORA_LOG_LEVEL, { app: 'aurora-api' });
  const app = await NestFactory.create(createAppModule({ ...deps, logger }), { logger: false });
  // `req.ip` é a chave do limite de tentativas (login, QR). Só proxies em rede
  // privada de containers podem informar o cliente — ver AURORA_PROXY_CONFIAVEL.
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyPara(deps.env.AURORA_PROXY_CONFIAVEL));
  // O padrão do Express é 100 kB, que recusa a importação do EPIC-005 antes de
  // qualquer validação nossa — e recusa com 500, porque o erro nasce no
  // middleware. 12 MB cobre as 50 mil linhas que a rota aceita (§07) com folga,
  // e continua sendo um teto: acima dele o cliente recebe 413, não 500.
  /*
   * O CORPO CRU VEM ANTES DO JSON, e só neste caminho.
   *
   * A fatia de uma foto é `application/octet-stream`: `express.json` a
   * ignoraria, o corpo chegaria vazio e o servidor gravaria um arquivo
   * truncado com aparência de sucesso. O interpretador cru é montado no
   * endereço exato do envio — o resto da API continua sem aceitar binário, que
   * é uma porta que nada mais precisa.
   *
   * O teto de 8 MB é largo de propósito: o aparelho manda fatias de 256 kB, e
   * qualquer coisa perto deste número já é sinal de defeito, não de foto
   * grande.
   */
  /*
   * `inflate: false` EM TODOS OS INTERPRETADORES (auditoria 23/11/2026, SEG-01).
   *
   * O padrão do body-parser descompacta `Content-Encoding: gzip`, e o teto conta
   * o corpo JÁ descompactado: 30 kB enviados viravam 12 MB de JSON, antes de
   * qualquer login (o interpretador roda antes do middleware de contexto). Vinte
   * requisições dessas levavam o processo de 100 MB a mais de 1 GB — o limite do
   * contêiner. Nenhum dos três apps manda corpo compactado; o cliente que mandar
   * recebe 415, que é a resposta honesta.
   */
  const semDescompactar = { inflate: false } as const;
  app.use(
    '/v1/field/attachments',
    raw({ ...semDescompactar, type: 'application/octet-stream', limit: '8mb' })
  );
  // Certificados de qualidade: PDF e imagem, só neste caminho (conversa com o cliente, 21/10/2026).
  app.use(
    '/v1/quality-records',
    raw({
      ...semDescompactar,
      type: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      limit: '10mb',
    })
  );
  // Nota fiscal do pedido da Store: o mesmo corpo cru, só neste caminho.
  app.use(
    '/v1/store-orders',
    raw({
      ...semDescompactar,
      type: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      limit: '10mb',
    })
  );
  /*
   * JSON grande SÓ onde ele existe: a foto do ativo em base64 (até 8 MB → ~11 MB),
   * a logomarca da organização, a importação (até 5 mil linhas por envio) e o
   * pacote de sincronização do campo. O resto da API não tem corpo que passe de
   * 2 MB — e aceitar 12 MB em toda rota era dar a qualquer origem o direito de
   * ocupar 12 MB de memória por requisição.
   */
  for (const caminho of ['/v1/assets', '/v1/organizations', '/v1/imports', '/v1/field']) {
    app.use(caminho, json({ ...semDescompactar, limit: '12mb' }));
  }
  app.use(json({ ...semDescompactar, limit: '2mb' }));
  app.use(urlencoded({ ...semDescompactar, extended: false, limit: '1mb' }));
  /*
   * Cabeçalhos de segurança das respostas da API (SEG-09). A API só devolve JSON
   * e arquivos baixados: nada dela deve ser emoldurado, interpretado como outro
   * tipo ou guardado em cache compartilhado. Rotas de arquivo que já definem o
   * próprio `cache-control` sobrescrevem este padrão.
   */
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
    next();
  });
  /*
   * CORS por lista explícita, e nunca `*`.
   *
   * A interface e a API vivem em origens diferentes — em desenvolvimento por
   * porta, em produção por domínio. Sem CORS o navegador recusa a chamada e a
   * tela mostra "Failed to fetch", que não diz nada a ninguém.
   *
   * `credentials: true` combinado com `origin: '*'` é recusado pelo próprio
   * navegador, e com razão: seria autorizar qualquer site a agir em nome de
   * quem está logado. Por isso a lista é fechada.
   */
  const origens = deps.env.AURORA_CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origens.length > 0) {
    app.enableCors({
      origin: origens,
      // Sem cookies: a sessão vai no cabeçalho `Authorization` (token opaco).
      // Liberar credenciais só ampliaria o que uma origem da lista pode fazer.
      credentials: false,
      // Só o que a aplicação realmente manda. `x-aurora-organization` é a
      // escolha de organização; `x-request-id` correlaciona com o log.
      // `x-aurora-client-operation` carrega o identificador que o aparelho de
      // campo gera antes da primeira tentativa. Sem ele na lista, o navegador
      // recusa a requisição inteira no `preflight` — e a garantia de "no
      // máximo uma vez" simplesmente não chegaria ao servidor.
      allowedHeaders: [
        'authorization',
        'content-type',
        'x-aurora-organization',
        'x-request-id',
        'x-aurora-client-operation',
        /*
         * O envio retomável de fotos. Sem estes quatro na lista, o navegador
         * recusa a requisição inteira no `preflight` e a tela mostra "Failed
         * to fetch" — que foi exatamente o sintoma com que este defeito
         * apareceu, e que não aponta para lugar nenhum.
         */
        'x-aurora-offset',
        'x-aurora-sha256',
        'x-aurora-storage-key',
        'x-aurora-final',
        // Nome do arquivo do certificado de qualidade (PUT /v1/quality-records/:id/file).
        'x-aurora-file-name',
        'x-aurora-invoice-number',
      ],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    });
    logger.info('CORS habilitado', { origens });
  }

  app.useGlobalFilters(new DomainErrorFilter(logger));
  // Permissão primeiro (403 que nomeia a permissão), depois o escopo da entidade (404).
  app.useGlobalGuards(new PermissionsGuard(app.get(Reflector)), new ScopeGuard(app.get(DATABASE)));
  // A rota do QR fica fora de `/v1`: o endereço vai impresso numa etiqueta que
  // ficará colada num equipamento por anos, e versão de API numa etiqueta
  // física é uma promessa que não temos como cumprir.
  app.setGlobalPrefix('v1', { exclude: ['q/:token'] });
  return app;
}

/**
 * Valor do `trust proxy` do Express para cada modo. `false` = só o soquete.
 * `rede-privada` = loopback, link-local e faixas privadas (10/8, 172.16/12,
 * 192.168/16, fc00::/7): os saltos do HostPanel; nunca um endereço público.
 */
export function trustProxyPara(modo: 'nenhum' | 'rede-privada' | undefined): false | string[] {
  return modo === 'rede-privada' ? ['loopback', 'linklocal', 'uniquelocal'] : false;
}
