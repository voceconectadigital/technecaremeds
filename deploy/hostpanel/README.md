# Implantação no HostPanel — PostgreSQL VPS

O HostPanel (backend **PostgreSQL VPS**, tipo de projeto **Sistema**) constrói a imagem deste repositório
no commit fixado e sobe, num node dedicado:

| Serviço             | Comando                                                                 | Rede                               |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `db`                | PostgreSQL 16 dedicado (imagem fixada pelo HostPanel)                   | só rede interna, sem porta pública |
| `migrate` (one-off) | `node tools/db/run.mjs migrate` como **superusuário do banco dedicado** | interna                            |
| `api`               | `node apps/api/dist/main.js`                                            | interna + borda (Traefik, HTTPS)   |
| `workers`           | `node apps/workers/dist/main.js` (pg-boss)                              | interna, sem exposição             |

- **Imagem:** `Dockerfile` — `npm ci` → `tsc -b apps/api apps/workers` → pacotes apontados para `dist/`
  (`tools/imagem/apontar-dist.mjs`) → `npm prune --omit=dev`. Em runtime não há `tsx`: as ferramentas de banco
  carregam `dist/` com `AURORA_COMPILADO=1` (`tools/lib/fonte.mjs`).
- **Banco:** as migrations criam as 8 roles, FORCE RLS, triggers e SECURITY DEFINER exatamente como no repositório.
  O HostPanel cria só o login `aurora_api_login` — `NOSUPERUSER NOBYPASSRLS`, herdando `aurora_app`, com `CREATE`
  no database (o pg-boss cria o schema `aurora_jobs`). A API recusa subir com papel privilegiado (§37).
- **Destino:** `aurora.destinos.json` libera em `homologacao` só o serviço interno `db` / banco `aurora`
  (`hostsInternos`). Host com ponto continua exigindo `ref`; produção continua fechada.
- **Arquivos:** volume persistente `arquivos` em `/data/arquivos` (`AURORA_ARQUIVOS_DIR`), dentro do backup.
- **Saúde:** `GET /v1/health/ready` só é saudável com `"status":"ok"` no corpo — o endpoint responde 200 também
  quando degradado.

Manifesto registrado no HostPanel: [`technecare-preview.manifest.json`](technecare-preview.manifest.json).
Massa de homologação (opcional, recusa produção): `node tools/homologacao/semear.mjs` no container `migrate`.
