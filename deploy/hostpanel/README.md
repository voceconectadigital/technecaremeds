# Implantação no HostPanel — PostgreSQL VPS

O HostPanel (backend **PostgreSQL VPS**, tipo de projeto **Sistema**) constrói a imagem deste repositório
no commit fixado e sobe, num node dedicado:

| Serviço             | Comando                                                                 | Rede                               |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `db`                | PostgreSQL 16 dedicado (imagem fixada pelo HostPanel)                   | só rede interna, sem porta pública |
| `migrate` (one-off) | `node tools/db/run.mjs migrate` como **superusuário do banco dedicado** | interna                            |
| `api`               | `node apps/api/dist/main.js`                                            | interna, sem exposição             |
| `workers`           | `node apps/workers/dist/main.js` (pg-boss)                              | interna, sem exposição             |
| `web`               | `node tools/imagem/servidor-web.mjs` — frontend + `/v1` → `api:3000`    | interna + borda (Traefik, HTTPS)   |

O host do preview serve o frontend da equipe (`apps/web`, build conectado: `VITE_API_URL` vazio = `/v1` na
mesma origem) e repassa `/v1/*` à API interna. Sem CORS a abrir e sem a API exposta diretamente. O demo do
Cloudflare Pages (`build:demo`) continua independente e intocado.

- **Imagem:** `Dockerfile` — `npm ci` → `tsc -b apps/api apps/workers` → pacotes apontados para `dist/`
  (`tools/imagem/apontar-dist.mjs`) → `npm prune --omit=dev`. Em runtime não há `tsx`: as ferramentas de banco
  carregam `dist/` com `AURORA_COMPILADO=1` (`tools/lib/fonte.mjs`).
- **Banco:** as migrations criam as 8 roles, FORCE RLS, triggers e SECURITY DEFINER exatamente como no repositório.
  O HostPanel cria só os LOGINS, todos `NOSUPERUSER NOBYPASSRLS`: `aurora_api_login` (API) herda apenas
  `aurora_app`; `aurora_api_login_workers` (workers) herda `aurora_app`, `aurora_publisher` e `aurora_scheduler` —
  os papéis de varredura entre organizações ficam fora do alcance da API — e tem `CREATE` no database (o pg-boss
  cria o schema `aurora_jobs`). A API recusa subir com papel privilegiado (§37).
- **Destino:** `aurora.destinos.json` libera em `homologacao` só o serviço interno `db` / banco `aurora`
  (`hostsInternos`). Host com ponto continua exigindo `ref`; produção continua fechada.
- **Arquivos:** volume persistente `arquivos` em `/data/arquivos` (`AURORA_ARQUIVOS_DIR`), dentro do backup.
- **Saúde:** `GET /v1/health/ready` só é saudável com `"status":"ok"` no corpo — o endpoint responde 200 também
  quando degradado.
- **Versão:** `GET /v1/health/version` (pública) devolve `commit` e `impressao` gravados no build
  (`tools/imagem/versao.mjs`). O commit vem do argumento de build `AURORA_VERSAO` ou do `.git/HEAD` do contexto e
  pode vir nulo; a `impressao` (sha-256 do código da API) sai sempre e se compara com `npm run versao` rodado no
  commit candidato. **Antes de publicar um front, confira que a API do ambiente bate com o commit do front.**

Manifesto registrado no HostPanel: [`technecare-preview.manifest.json`](technecare-preview.manifest.json).
Massa de homologação (opcional, recusa produção): `node tools/homologacao/semear.mjs` no container `migrate`.
