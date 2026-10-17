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

## 4. Estratégia de infraestrutura vigente

Decisão vigente (16/10/2026, responsável do projeto): **sem deploy no HostPanel nesta rodada** e sem tocar a VPS antiga; o **PostgreSQL remoto atual permanece no Supabase Online** da Téchne Care até a infraestrutura definitiva; **VPS dedicada fica para fase posterior**; autenticação **continua própria da aplicação** (sem Supabase Auth). Código na `main` não autoriza migration remota nem deploy de backend.

Consequência: o front de produção (upload direto) e a API publicada continuam na versão de
15/10. O front novo depende das rotas e das migrations desta rodada — publicá-lo sem o backend
atualizado quebraria telas. Situação: **AGUARDANDO DEPLOY CONECTADO**.

## 5. Plano FUTURO de publicação (não executar sem autorização)

Mantido como registro da estratégia; nada abaixo está autorizado agora.

1. CI verde e código em `main` — **feito** (`27a5e8c`).
2. **Autorização explícita** para publicar o backend no destino escolhido (hoje HostPanel; futuramente a VPS dedicada).
3. Backup do PostgreSQL de produção **antes** das migrations `0060`–`0068` (com prova:
   arquivo, tamanho, horário, restore descartável).
4. Deploy da API no destino autorizado com o SHA de `main` → conferir `/v1/health/version`
   (`impressao` = `npm run versao` do mesmo commit).
5. Só então o front (web, portal, campo) por `wrangler pages deploy`, e smoke remoto.
6. Conceder o admin global de plataforma (Fase 11) é ato de DBA, com motivo — não há rota.

## 6. Bloqueios desta fase

- I-02 domínio "htec.b": BLOQUEADO — INFRA.
- I-04 backup/restore comprovado: BLOQUEADO — INFRA (sem acesso/prova).
- I-05 publicação: AGUARDANDO DEPLOY CONECTADO (sem autorização nesta rodada).
- I-06 VPS dedicada: FUTURO — fase posterior, por decisão de 16/10. A API publicada hoje responde
  num node do HostPanel nos EUA (`apps-us-east-01`).
