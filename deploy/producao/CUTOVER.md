# Cutover de produção — Téchne Care (EXECUTADO)

**Executado — conferido em 2026-10-09 à noite** (front em `99b42f2`/`dc4c6c4`; a API está atrás do `main` — ver AI-HANDOFF §27): `technecaremeds.voceconecta.com.br` serve o projeto Pages
`technecare-web` (produção conectada); portal e campo nos seus domínios; API em
`https://api-technecaremeds.voceconecta.com.br/v1` (`80.190.72.199`) com `ambiente: producao` e banco ok. O demo
segue em `technecaremeds.pages.dev`. Estado atual e como publicar o front: `docs/AI-HANDOFF.md` §27. Os passos 4
(conta titular), 8 (smoke autenticado) e 9 (backup + restore drill) não são verificáveis de fora — confirmar com o
responsável.

Estado anterior (2026-10-09, antes do cutover): preview PostgreSQL VPS validado
(`technecare-preview.80-190-72-199.sslip.io`, runtime `pgv-70gvxl2n` no node `apps-us-east-01`), e o domínio
principal servindo o DEMO. O roteiro abaixo é o que trocou isso pela produção.

## Arquitetura de produção

| Peça                 | Onde                                                                 | Endereço                                           |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| API (NestJS)         | HostPanel PostgreSQL VPS, `apps-us-east-01`, Traefik + Let's Encrypt | `https://api-technecaremeds.voceconecta.com.br/v1` |
| Workers (pg-boss)    | mesmo runtime, rede interna, login próprio                           | —                                                  |
| PostgreSQL 16        | mesmo runtime, rede interna, sem porta pública                       | `db:5432` (só interno)                             |
| Web (equipe)         | Cloudflare Pages `technecare-web` (novo)                             | `https://technecaremeds.voceconecta.com.br`        |
| Portal (cliente)     | Cloudflare Pages `technecare-portal` (novo)                          | `https://portal-technecaremeds.voceconecta.com.br` |
| Campo (técnico, PWA) | Cloudflare Pages `technecare-field` (novo)                           | `https://campo-technecaremeds.voceconecta.com.br`  |

Manifesto do runtime: [`../hostpanel/technecare-producao.manifest.json`](../hostpanel/technecare-producao.manifest.json)
(`AURORA_AMBIENTE=producao`, `AURORA_PROXY_CONFIAVEL=rede-privada`, CORS só das três origens acima).
O demo NÃO é apagado: o projeto Pages `technecaremeds` fica intacto e é o rollback.

## Pré-requisitos (ação humana)

1. **Token Cloudflare para Pages** — API token na conta `7b7ce518846bdc2f6f3bdf476cbd053b` com
   `Account → Cloudflare Pages → Edit` (criar projetos e publicar) e `Zone → DNS → Edit` na zona
   `voceconecta.com.br` (registros dos domínios). Guardar fora do chat, como variável de ambiente local
   `CLOUDFLARE_API_TOKEN` (o token de deploy do HostPanel NÃO tem Pages: erro 10000).
2. **Janela e responsável** definidos; usuários avisados de que o demo sai do ar no domínio principal.

## Passos

| #   | Ação                                                                                                                                                                                                                                                                                                                                                                     | Quem         | Tempo                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------- |
| 0   | Backup final do preview (opcional, não migra dado: produção nasce vazia)                                                                                                                                                                                                                                                                                                 | operador     | 2 min                      |
| 1   | DNS `api-technecaremeds` A → `80.190.72.199`, **DNS only** (HTTP-01 do Traefik)                                                                                                                                                                                                                                                                                          | humano/token | 5 min + propagação         |
| 2   | HostPanel → Sistemas: registrar `voceconectadigital/technecaremeds` no commit da `main`, node `apps-us-east-01`, hostname `api-technecaremeds.voceconecta.com.br`, manifesto de produção, propósito **project**                                                                                                                                                          | operador     | 6 min (build + migrations) |
| 3   | Conferir `https://api-technecaremeds.voceconecta.com.br/v1/health/ready` → `{"status":"ok"}`                                                                                                                                                                                                                                                                             | operador     | 1 min                      |
| 4   | Conta titular real: `ssh` no node e, no diretório do runtime, `docker compose -f compose.yml -p hp-<slug> --profile tools run --rm migrate node tools/admin/criar.mjs --nova-org` — nome/identificador da organização, e-mail, nome e **senha digitados pela pessoa** (eco desligado; nunca em argumento)                                                                | humano       | 3 min                      |
| 5   | Builds e Pages (com o token): para cada `app` em `web`, `portal`, `field`: `VITE_API_URL=https://api-technecaremeds.voceconecta.com.br/v1 npx vite build --config apps/<app>/vite.config.ts` → `npx wrangler pages project create technecare-<app> --production-branch main` → `npx wrangler pages deploy apps/<app>/dist --project-name technecare-<app> --branch main` | operador     | 10 min                     |
| 6   | Domínios: `portal-` e `campo-technecaremeds` como custom domain de `technecare-portal`/`technecare-field`                                                                                                                                                                                                                                                                | operador     | 5 min                      |
| 7   | **Troca do domínio principal**: remover `technecaremeds.voceconecta.com.br` do projeto `technecaremeds` (demo) e adicioná-lo a `technecare-web`                                                                                                                                                                                                                          | operador     | 5 min (+ certificado)      |
| 8   | Smoke pós-cutover (abaixo)                                                                                                                                                                                                                                                                                                                                               | operador     | 10 min                     |
| 9   | Backup VERIFIED + restore drill do runtime de produção pelo HostPanel                                                                                                                                                                                                                                                                                                    | operador     | 5 min                      |

**Janela estimada: 60 min** (passos 1–6 podem ser feitos antes, sem afetar o demo; o impacto visível é só o passo 7, ~5 min).

## Smoke pós-cutover

- `GET /v1/health/ready` → `{"status":"ok"}`; `GET /v1/health/live` → `{"status":"ok"}`.
- Web, portal e campo abrem nos três domínios, sem erro de CORS no console; o web NÃO mostra "Demonstração".
- Login com a conta titular → `/v1/me/session` 200; logout → o mesmo token devolve 401.
- Login errado repetido (11×/min) → 429 para essa origem; outra rede continua recebendo 401.
- Abrir um chamado de teste e anexar um arquivo; reiniciar o runtime pelo HostPanel; o anexo continua lá.
- HostPanel: saúde 100%, workers sem jobs `failed` no pg-boss, backup VERIFIED com offsite.

## Rollback

- **Frontend:** mover `technecaremeds.voceconecta.com.br` de volta para o projeto Pages `technecaremeds` (demo, intacto). ~5 min.
- **API:** o runtime de produção pode ser parado (`stop`) pelo HostPanel sem perder dado; destruir só com backup VERIFIED < 24 h.
- **DNS:** remover os registros `api-`, `portal-` e `campo-technecaremeds` se a produção for abortada.
- Nada no demo é alterado em nenhum passo, então o rollback é sempre a reatribuição do domínio.
