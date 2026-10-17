# Produção — verificação da Fase 13 (16/10/2026)

> **Modo:** somente leitura. Nenhum deploy, migration, reinício ou alteração foi feito em
> produção, no HostPanel, no Cloudflare ou no DNS. Nenhum segredo foi lido ou reproduzido.

## 1. Identificação do ambiente (antes de qualquer ação remota)

| Item | Evidência (16/10/2026, ~22h BRT) |
| --- | --- |
| API | `https://api-technecaremeds.voceconecta.com.br` → resolve para `80.190.72.199` (node `apps-us-east-01` do HostPanel — **EUA**), runtime "Téchne Care — produção" |
| Versão publicada da API | `GET /v1/health/version` → `impressao: 60dcde92fd08`, `construido_em: 2026-10-15T18:24:44Z`, `commit: null` (imagem sem `.git`, como esperado) |
| Front | `technecaremeds.voceconecta.com.br`, `portal-technecaremeds…`, `campo-technecaremeds…` → HTTP 200 (Cloudflare Pages, upload direto) |
| Rodada 16/10 | **Não publicada.** A produção roda a imagem de 15/10 (anterior às migrations `0060`–`0068`) |

## 2. Requisitos de produção

| Requisito | Situação | Evidência / motivo |
| --- | --- | --- |
| HTTPS | ✅ verificado | TLS válido (`ssl_verify_result=0`); `http://` → `301` para `https://` |
| PostgreSQL não público | ✅ verificado (de fora) | TCP `80.190.72.199:5432` e `:6432` fechados/filtrados a partir da internet |
| Firewall | 🟡 parcial | Só as portas acima foram sondadas; `22` responde (SSH do node). Regras não lidas |
| Healthcheck | ✅ verificado | `/v1/health/live` → `ok`; `/v1/health/ready` → `ok`, `database: ok` |
| Restart / logs / monitoramento | 🔒 não verificado | Geridos pelo HostPanel; não acessado nesta rodada (sem autorização para operar o painel) |
| **Backup + teste de restore** | 🔒 **sem prova** | Nenhum backup ou restore foi demonstrado nesta rodada. **Não se afirma backup.** A auditoria de 07/10 (`AUDITORIA-VPS-TECHNECARE.md`) já apontava ausência de backup válido para a TéchneCare na VPS Contabo |
| Segredos fora do Git | ✅ verificado | `node tools/ci/check-secrets.mjs` → nenhum segredo em 759 arquivos versionados; só `.env.example` e `.env.demo` (sem segredo) versionados |
| Domain guards de migration | ✅ mantidos | `AURORA_AMBIENTE` + `aurora.destinos.json` intocados; nenhuma migration aplicada fora de teste |

## 3. Domínio "htec.b"

`htec.b` **não resolve** (sem registro DNS; `.b` não é TLD válido). Não foi presumido, não foi
comprado, não foi configurado. `htec.com.br` resolve para um IP de terceiro (`191.252.51.103`)
sem vínculo verificável com o projeto — **não usado**. Status: **BLOQUEADO — INFRA** até o
responsável indicar um domínio sob controle comprovado.

## 4. Publicação desta rodada — o que falta e em que ordem

1. CI verde no PR #22 e integração em `main`.
2. **Autorização explícita** para o deploy no HostPanel (regra do projeto).
3. Backup do PostgreSQL de produção **antes** das migrations `0060`–`0068` (com prova:
   arquivo, tamanho, horário, restore descartável).
4. Deploy da API pelo HostPanel com o SHA de `main` → conferir `/v1/health/version`
   (`impressao` = `npm run versao` do mesmo commit).
5. Só então o front (web, portal, campo) por `wrangler pages deploy`, e smoke remoto.
6. Conceder o admin global de plataforma (Fase 11) é ato de DBA, com motivo — não há rota.

## 5. Bloqueios desta fase

- I-02 domínio "htec.b": BLOQUEADO — INFRA.
- I-04 backup/restore comprovado: BLOQUEADO — INFRA (sem acesso/prova).
- I-05 publicação: aguardando autorização explícita de deploy.
- I-06 VPS dedicada: a API já roda em node nos EUA (HostPanel `apps-us-east-01`); uma VPS
  dedicada nova é decisão/aquisição fora do repositório.
