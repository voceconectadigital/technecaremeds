# Produção — publicação de 18/10/2026

> **Autorização:** dada pelo responsável em 18/10/2026, nesta ordem:
> 1. "coloca no ar, manda pra main, publique";
> 2. "Na produção conectada";
> 3. "Aprovo o plano inteiro";
> 4. "Seguir com o backup verificado".
>
> **O que foi publicado:** a `main` em `f68b66d4cb569395d801e6512b37ac3003245df5` (PRs #27–#30: pente-fino, pendências e
> CSP limpa), cujo CI ficou verde 4/4.

## 1. Destino comprovado (antes de qualquer ação)

| Item | Evidência |
| --- | --- |
| Runtime | HostPanel → Sistemas → **"Téchne Care — produção"** (`pgv-pe0b9asx`, id `aedb7e01-a8d9-43b9-a1db-88b5ce218453`), node `apps-us-east-01` |
| Banco | **PostgreSQL 16 dedicado do próprio runtime** (serviço `db`, rede interna, sem porta pública), banco `aurora`. Conferido pelo manifesto (`deploy/hostpanel/technecare-producao.manifest.json`), por `aurora.destinos.json` e pelo check `postgres_not_public`. A nota de 16/10 que punha o banco no Supabase **não correspondia** à produção real |
| Versão anterior | `current_commit_sha = 5207188…` (API com impressão `60dcde92fd08`, de 15/10); banco na migration **0059** |
| Front anterior | Cloudflare Pages (envio direto) `technecare-web` / `-portal` / `-field` no commit `5207188` |

## 2. Execução

| # | Passo | Resultado |
| --- | --- | --- |
| 1 | Backup do banco (`action: backup`) | job `af2df7f2-7c20-49fb-b68f-3188952485b3`, **backupId `14c29f55-1ca5-4925-96af-98b6d39698b9`**, marcado como **verificado** em 18/10, 13:39:41 UTC |
| 2 | Prova de restauração (`restore_drill` com esse backup) | aceita (job `6b2483f5-e019-427f-9f69-a44356a4cc00`). **O painel não expõe o resultado** de jobs de runtime PostgreSQL VPS: não há tela, endpoint nem registro em "Pontos de recuperação". O responsável decidiu seguir com base no backup verificado |
| 3 | Deploy da API (`action: deploy`, `ref: f68b66d4…`) | job `63a51a12-d974-465f-815f-55e348754f31` às 15:48 UTC. O HostPanel construiu a imagem, rodou `node tools/db/run.mjs migrate` (migrations **0060–0077** e sincronização dos catálogos do código) e trocou API e workers. Troca às ~15:51 UTC, sem nenhuma checagem de saúde falhar no intervalo |
| 4 | Conferência da API | `/v1/health/version` → impressão **`fa184d54979b`** (= `npm run versao` no mesmo commit), construída 18/10 15:50:42 UTC · `/v1/health/ready` → `ok`, banco `ok` · `/v1/auth/config` → `password`, `producao`. HostPanel: `current_commit_sha = f68b66d4…`, `running`, checks todos ok (postgres, postgres_not_public, api e workers sem reinício, endpoint público 200, login da aplicação sem privilégio) |
| 5 | Front (`wrangler pages deploy`, `--branch main --commit-hash f68b66d4…`, `VITE_API_URL=https://api-technecaremeds.voceconecta.com.br/v1`) | web `6be4dc53.technecare-web.pages.dev` · portal `18db75a5.technecare-portal.pages.dev` · campo `a62525c4.technecare-field.pages.dev`. Os domínios servem o build novo (web `index-CmzuAi9t.js`) |

## 3. Smoke em produção (somente leitura, sem login)

| Verificação | Resultado |
| --- | --- |
| `https://technecaremeds.voceconecta.com.br/apresentacao` | abre sem login, 10 seções, **nenhuma chamada à API**, nenhum "Aurora" |
| Web `/` | redireciona para `/entrar` (o `401` da sessão sem login é esperado); formulário de e-mail e senha |
| Portal e campo | abrem em `/entrar` **sem nenhum erro no console** |
| Campo offline | a base local nasceu como `aurora-campo@v3` (coleção `cronometros`, correção da PR #28) |
| Cabeçalhos | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, CSP Report-Only com a origem real da API |

**Achado da CSP (só em produção):** no domínio `voceconecta.com.br`, o **próprio Cloudflare injeta scripts** (beacon do
Web Analytics em `static.cloudflareinsights.com` e scripts inline). A CSP Report-Only registra esses scripts como
violações. Os scripts da aplicação passam: o hash do script de tema bate e não há violação de `unsafe-eval`. **Não
trocar para modo de bloqueio** antes de decidir uma destas saídas:
- desligar a injeção automática (Web Analytics e afins) na zona;
- incluir esses scripts na política.

É decisão de infraestrutura (BLOQUEADO — INFRA).

## 4. O que muda para quem usa

- O Operador executa só OS atribuída a ele ou à equipe dele (PF-14). O almoxarife não é afetado.
- Coordenador, Gestor e Financeiro deixam de ver a trilha de auditoria global (PF-15).
- O Gestor não concede mais Administrador nem Proprietário, e ninguém altera os próprios papéis ou o próprio escopo.
- O bloqueio de senha fica progressivo, com teto real (0077).
- O parecer LIBERADO/PARADO continua **opcional**: a configuração por organização nasce desligada.

## 5. Retorno, se for preciso

| Camada | Como |
| --- | --- |
| Front | `wrangler pages deploy` do build de `5207188` nos três projetos (o rebuild reproduz os mesmos arquivos) |
| API | `action: deploy` com `ref: 5207188b64e6b4e52d53729a360b995d72cb3c1e`. O esquema continua o novo, porque as migrations são aditivas |
| Banco | `action: restore` com `backupId 14c29f55-1ca5-4925-96af-98b6d39698b9`. **Perde tudo o que for gravado depois de 18/10 13:39 UTC** |

## 6. Fora desta publicação

- PR #31 (lacunas do PF-14 e PF-41, telas e capturas): **não está na `main`**. O CI do GitHub Actions está parado por
  cobrança ("recent account payments have failed or your spending limit needs to be increased").
- Validação funcional com login real (Painel, OS, campo) fica com o responsável. Eu não uso credenciais de produção.
