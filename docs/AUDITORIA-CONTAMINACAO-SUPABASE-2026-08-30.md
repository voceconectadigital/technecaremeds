# Auditoria forense — contaminação do Supabase `egoajboqzhnvkpenrszw`

**Data:** 2026-08-30, 16:30 (UTC−3)
**Escopo:** somente leitura. Nenhuma escrita local ou remota.
**Executada a partir de:** `technecaremeds` (Aurora), com acesso de leitura ao
banco remoto e ao sistema de arquivos local.

---

## 1. Resumo executivo

**SIM. O projeto foi contaminado.**

O Supabase `egoajboqzhnvkpenrszw` ("Aurora CMMS", sa-east-1) contém a aplicação
**E-commerce Template** — schema, dados e jobs agendados. O Aurora **nunca foi
aplicado** nesse banco.

| Pergunta | Resposta | Confiança |
|---|---|---|
| Foi contaminado? | **Sim** | **CERTEZA** — prova estrutural exata |
| Por qual projeto? | **`ecommerce-template`** (`voceconectadigital/ecommerce-template`) | **CERTEZA** — 23/23 migrações e 49/49 tabelas |
| Quando? | **2026-08-30, 12:56:52–12:58:22 UTC** (09:56–09:58 local), ~90 s | **CERTEZA** — carimbos no próprio banco |
| De qual diretório? | **`.../Conecta Digital/ecommerce-template`** | **ALTA** — CLI executado ali a 2 s do primeiro registro |
| Por qual comando exato? | **NÃO TESTEMUNHADO** | — ver §14 |
| Foi uma sessão do Claude? | **Não** | **ALTA** — nenhuma sessão ativa na janela |
| Ainda está ativo? | **Sim** — 9 jobs de cron rodando | **CERTEZA** |
| Vazou dado real? | **Não** — 0 e-mails enviados, 12 contas fictícias | **ALTA** |

---

## 2. Projetos analisados

| Papel | Diretório | `package.name` | Remote | HEAD |
|---|---|---|---|---|
| Aurora / CMMS | `technecaremeds` | `aurora` | `voceconectadigital/technecaremeds` | `f8a4c11` |
| HostPanel | `hospedagem` | `hosting-orchestrator` | `voceconectadigital/hostpanel` | `5a19c56` |
| E-commerce Template | `ecommerce-template` | `ecommerce-template` | `voceconectadigital/ecommerce-template` | `b1a759b` |

Observações de identificação:

- A pasta `hostpanel/` **não é o HostPanel** — é um `git init` vazio, sem commits.
- `wellcomerce/` é um quarto projeto de e-commerce, com 104 migrações de padrão
  UUID (jan–abr/2026). **Não é a fonte** — nenhuma das 23 migrações remotas
  existe nele.

---

## 3. Refs encontrados

| Ref | Onde aparece | Natureza |
|---|---|---|
| `egoajboqzhnvkpenrszw` | Só em `technecaremeds`: 5 documentos de sessão + `supabase/.temp/*` | Escrito por mim nesta sessão e nas anteriores do Aurora |
| `egoajboqzhnvkpenrszw` | **Ausente** em `ecommerce-template` e em `hospedagem` — versionado e ignorado | — |
| `egoajboqzhnvkpenrszw` | **Ausente** de todo o histórico do PowerShell (1659 linhas) | Nunca foi digitado no console |
| `ikzpateoicbjxkapdtsd` | Estava em `technecaremeds/supabase/.temp/linked-project.json` | Ver §13 |
| `gvtsthcnhkenzeqwtkwj` | `hospedagem/supabase/.temp/project-ref` | Vínculo legítimo do HostPanel ("Sites Schema Gerais") |

---

## 4. Estado remoto

| Item | Valor |
|---|---|
| Postgres | 17.6.1.166 · `ACTIVE_HEALTHY` |
| Papel da conexão | `postgres` — `rolsuper=false`, `createrole=true`, **`bypassrls=true`** |
| Schemas | os 13 padrão do Supabase + `public` |
| Tabelas em `public` | **49** |
| Linhas de dado | **80** |
| `auth.users` | **12** |
| Migrações registradas | **23** |
| Jobs de cron ativos | **9** |
| Schema/papéis Aurora | **0** |

---

## 5. Migrações remotas × repositórios — 23/23 EXATO

Comparação versão a versão contra `ecommerce-template/supabase/migrations`:

| Versão | Nome remoto | Arquivo local | Match |
|---|---|---|---|
| `…0001` | `platform_baseline` | `00000000000001_platform_baseline.sql` | **EXATO** |
| `…0002` | `phase1_core_catalog` | `…_phase1_core_catalog.sql` | **EXATO** |
| `…0003` | `secure_stock_rpc` | `…_secure_stock_rpc.sql` | **EXATO** |
| `…0004` | `service_role_guard` | `…_service_role_guard.sql` | **EXATO** |
| `…0005` | `order_status_enum` | `…_order_status_enum.sql` | **EXATO** |
| `…0006` | `pdp_related_reviews` | `…_pdp_related_reviews.sql` | **EXATO** |
| `…0007` | `find_user_by_email` | `…_find_user_by_email.sql` | **EXATO** |
| `…0008` | `cancel_order_transaction` | `…_cancel_order_transaction.sql` | **EXATO** |
| `…0009` | `audit_logs_system_actor` | `…_audit_logs_system_actor.sql` | **EXATO** |
| `…0010` | `roles_enum` | `…_roles_enum.sql` | **EXATO** |
| `…0011` | `roles_capabilities` | `…_roles_capabilities.sql` | **EXATO** |
| `…0012` | `stock_reservations` | `…_stock_reservations.sql` | **EXATO** |
| `…0013` | `scheduled_jobs` | `…_scheduled_jobs.sql` | **EXATO** |
| `…0014` | `payment_providers` | `…_payment_providers.sql` | **EXATO** |
| `…0015` | `provider_credentials` | `…_provider_credentials.sql` | **EXATO** |
| `…0016` | `order_events_outbox` | `…_order_events_outbox.sql` | **EXATO** |
| `…0017` | `refunds_and_coupons` | `…_refunds_and_coupons.sql` | **EXATO** |
| `…0018` | `shipping_providers` | `…_shipping_providers.sql` | **EXATO** |
| `…0019` | `conversion_platform` | `…_conversion_platform.sql` | **EXATO** |
| `…0020` | `operations_returns` | `…_operations_returns.sql` | **EXATO** |
| `…0021` | `consolidate_shipping_methods` | `…_consolidate_shipping_methods.sql` | **EXATO** |
| `…0022` | `security_hardening_db` | `…_security_hardening_db.sql` | **EXATO** |
| `…0023` | `checkout_idempotency` | `…_checkout_idempotency.sql` | **EXATO** |

**EXATOS 23 · PARCIAIS 0 · AUSENTES 0 · extras locais 0.**

Contra `hospedagem` (37 migrações, prefixo `2026…`) e `wellcomerce`
(104 migrações, sufixo UUID): **zero correspondência**.

A tabela remota `supabase_migrations.schema_migrations` tem apenas
`version, statements, name` — **sem timestamp e sem checksum**. Ela não datou
a aplicação; a datação de §8 vem dos dados.

---

## 6. Comparação estrutural

- **49 de 49** tabelas remotas são criadas por migrações do `ecommerce-template`.
  **Cobertura 100 %.** Nenhuma tabela remota fica sem explicação.
- Proveniência conferida, por exemplo: `products`, `orders`, `order_items`,
  `variants`, `coupons`, `shipments` ← `00000000000001_platform_baseline.sql`;
  `wishlist_items` ← `…0002`; `payment_providers` ← `…0014`;
  `email_outbox` ← `…0016`; `returns` ← `…0020`;
  `cart_sessions` ← `…0019`; `checkout_attempts` ← `…0023`.

**Assinatura coluna a coluna** (remoto × DDL local):

| Tabela | Colunas remotas, em ordem | DDL local |
|---|---|---|
| `checkout_attempts` | `fingerprint, order_id, response, created_at, completed_at` | idêntico, mesma ordem |
| `returns` | `id, order_id, user_id, reference, status, …, resolved_at` | idêntico |
| `coupon_uses` | `id, coupon_id, order_id, discount_applied, created_at` | idêntico |

---

## 7. Linha do tempo

Todos os horários em **local (UTC−3)**. Relógios conferidos: banco em UTC,
máquina em UTC−3, diferença de 4 s.

| Quando | O quê | Fonte |
|---|---|---|
| 08-28 18:51 | Projeto "Aurora CMMS" **criado** | API Supabase (`created_at`) |
| 08-28 20:06 | `.env.example` do e-commerce | mtime |
| 08-28 23:03 | `.env.local` do e-commerce (aponta `127.0.0.1`) | mtime |
| 08-28 23:06–23:19 | `supabase start` local do e-commerce | `.temp/start-secrets` |
| 08-29 23:37 | e-commerce commita a guarda `travar o destino dos testes em host local` | `0158601` |
| 08-30 01:28 | Último commit do e-commerce | `b1a759b` |
| **08-30 09:56:52** | **Primeiro registro gravado no banco do Aurora** | `min(created_at)` |
| **08-30 09:56:54** | **CLI do Supabase executado a partir de `ecommerce-template`** | `.temp/cli-latest` |
| 08-30 09:57:56 | `webhook_error` | `audit_logs` |
| 08-30 09:58:00–09:58:13 | **12 contas criadas em 13 s** | `auth.users` |
| 08-30 09:58:20–09:58:22 | `payment_error`, `webhook_error` | `audit_logs` |
| 08-30 09:59:20 | Suíte Playwright do e-commerce termina, `"status":"passed"` | `test-results/.last-run.json` |
| 08-30 11:00:00 | `stock_error` — **job de cron**, não ação humana | `audit_logs` |
| 08-30 12:34 | `npx supabase login` (última linha do histórico) | PSReadLine |
| 08-30 12:36 | **Eu** re-vinculo `technecaremeds` ao ref correto | `.temp/*` |
| 08-30 16:11→ | Esta auditoria (somente leitura) | — |

**Janela de escrita humana/ferramenta: ~90 segundos.** Tudo depois é cron.

---

## 8. Evidência Git

- `ecommerce-template`: árvore limpa, último commit 08-30 01:28 — **8,5 h antes**
  da contaminação. Nenhum commit na janela.
- `technecaremeds`: árvore limpa, `f8a4c11`.
- Nenhum dos três repositórios contém o ref do Aurora em arquivo versionado.
- O commit `add6574 "fix(db): make migrations apply from scratch, add demo seed"`
  e o `0158601 "fix(e2e): travar o destino dos testes em host local"` mostram que
  o e-commerce **já tinha consciência do risco** de destino remoto.

---

## 9. Histórico de comandos

**Disponível:** PSReadLine, arquivo único, 1659 linhas, mtime 08-30 12:34.
**Sem carimbo de tempo por linha** — o PSReadLine não os grava.

| Busca | Resultado |
|---|---|
| `egoajboqzhnvkpenrszw` | **Nenhuma ocorrência** |
| `supabase db push` | 34 ocorrências, **todas sem `--project-ref`** |
| `supabase link --project-ref ikzpateoicbjxkapdtsd` | 2 ocorrências |
| Últimas linhas | `cd .../ecommerce-template` → buscas por e-mail → `npx supabase login` |

`.bash_history`: 1 linha, de 2025-12-17. **Irrelevante.**

**Limitação registrada:** só existe o histórico do host `ConsoleHost`. Comandos
executados em `cmd.exe`, no terminal integrado do VS Code/Cursor, ou colados em
outra ferramenta **não aparecem aqui**.

---

## 10. Sessões do Claude

| Projeto | Sessão existe? | Ativa na janela 09:00–11:30? |
|---|---|---|
| `technecaremeds` | Sim | **Não** |
| `hospedagem` | Sim | **Não** |
| `wellcomerce` | Sim | **Não** |
| `ecommerce-template` | **Não existe diretório de sessão** | — |

Os únicos três transcritos tocados hoje foram modificados às **16:21–16:22** —
as três auditorias paralelas rodando agora.

**Nenhuma sessão do Claude Code estava ativa quando a contaminação ocorreu.**

Nota: o ref do Aurora aparece num transcrito de `wellcomerce`, mas apenas como
texto do **prompt de auditoria enviado hoje**, não como comando executado.

---

## 11. `auth.users` — apenas metadados

Nenhum endereço, telefone, token ou hash foi lido ou registrado.

| Métrica | Valor |
|---|---|
| Total | 12 |
| Dias distintos de criação | **1** (2026-08-30) |
| Intervalo entre a primeira e a última | **13 segundos** |
| Já fizeram login | 2 |
| Casam com padrão de teste | **12 de 12** |
| Correspondem às fixtures do e2e | `cliente.e2e@…` (1), `admin.e2e@…` (1), `@exemplo.test` (11) |

**Conclusão: são contas fictícias de teste automatizado. Nenhuma pessoa real.**

`email_outbox`: **16 mensagens, todas `pending`. Nenhuma enviada.**

---

## 12. O Aurora chegou a ser aplicado?

**Resposta: (A) NUNCA FOI APLICADO.**

| Verificação | Resultado |
|---|---|
| Schema `aurora` | 0 |
| Papéis `aurora_*` | 0 |
| Registro de migrações do Aurora | 0 |
| Tabelas fora dos schemas conhecidos | 0 |

O `0000_bootstrap.sql` do Aurora criaria `aurora_owner`, `aurora_migrator`,
`aurora_app` e `aurora_readonly`. **Nenhum existe.**

---

## 13. O vínculo do projeto Renato

Antes de eu re-vincular, `technecaremeds/supabase/.temp/` continha **um único
arquivo**: `linked-project.json` → `ikzpateoicbjxkapdtsd`.

A prova está no contraste: quando **eu** rodei `supabase link` hoje às 12:36,
foram criados **8 arquivos em 5 segundos** (`postgres-version`, `pooler-url`,
`storage-migration`, `rest-version`, `gotrue-version`, `storage-version`,
`project-ref`, `linked-project.json`). O HostPanel tem os mesmos 8, de 19/jul.

**O estado anterior tinha 1 de 8.**

`linked-project.json` vem da API de gerenciamento; `postgres-version` e
`pooler-url` vêm da conexão ao banco. Ter só o primeiro é a assinatura de um
**`supabase link` que completou a etapa de API e falhou na etapa de banco**.

O histórico confirma o comando e o contexto de falha:

```
supabase link --project-ref ikzpateoicbjxkapdtsd
Test-NetConnection api.supabase.com -Port 443
supabase projects list --dns-resolver https
npx supabase@latest link --project-ref ikzpateoicbjxkapdtsd
Get-Content .\supabase\.temp\project-ref      ← procurava um arquivo que não foi criado
```

**Classificação: `cwd` errado.** Um `supabase link` para o projeto do Renato foi
executado a partir do diretório do Aurora, falhou antes da etapa de banco, e
deixou o vínculo parcial para trás. **Não houve escrita** — apenas um vínculo
órfão, que teria mandado um `db push` futuro para o projeto errado.

**Nenhuma ação foi tomada sobre o projeto do Renato.**

---

## 14. Hipótese por hipótese

### H1 — Prompt/comando do E-commerce executado com o CLI vinculado ao Aurora
**POSSÍVEL — mecanismo não testemunhado.**

A favor: o CLI **foi** executado a partir de `ecommerce-template` a 2 segundos
do primeiro registro (`cli-latest`, 09:56:54). O que entrou no banco é
exatamente aquele repositório.

Contra: `ecommerce-template/supabase/.temp` **não contém nenhum artefato de
vínculo**, e o mtime do diretório é de 28/08 23:19. Criar ou apagar arquivo ali
teria atualizado esse mtime — logo, **nada foi vinculado nem desvinculado ali em
30/08**. Um `supabase db push` sem vínculo falha com *"Cannot find project ref"*.

### H2 — Script recebeu `DATABASE_URL` / ref do Aurora
**FORTEMENTE PROVÁVEL — é a única forma compatível com todas as evidências.**

Um `--db-url` (ou `SUPABASE_DB_URL` no ambiente do comando) escreve no projeto
remoto **sem exigir vínculo, sem exigir login e sem criar nenhum artefato** — o
que explica simultaneamente: o CLI ter rodado ali, o banco ter sido escrito, e
`.temp` não ter mudado.

Precedente de hábito no próprio histórico: o operador usa exatamente essa forma —
`supabase db dump --db-url "postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"`.

Contra: o ref do Aurora não aparece no histórico do PowerShell. **Compatível**
com o comando ter sido executado noutro terminal (VS Code, Cursor, `cmd.exe`) ou
com a string ter sido colada.

### H3 — Sessão do Claude no diretório errado
**REFUTADA.** Nenhuma sessão ativa entre 09:00 e 11:30. Não existe sequer
diretório de sessão para `ecommerce-template`.

### H4 — Projeto reutilizado/renomeado externamente
**REFUTADA.** O projeto foi criado em 28/08 18:51 e a primeira escrita é de
30/08 09:56 — **39 horas depois**. Um projeto reaproveitado teria dado anterior
à sua própria criação como "Aurora CMMS", ou dado espalhado no tempo. Todo o
dado cabe em 90 segundos de um único dia.

### H5 — Outra origem
**PARCIALMENTE CONFIRMADA — provisionamento do HostPanel REFUTADO.**

`ecommerce-template/hostpanel.json` declara, sim, um passo
`"command": "npx supabase db push"`. Mas:

- `hospedagem/lib/` e `hospedagem/app/api/` **não contêm nenhuma execução de
  `supabase db push`**;
- `siteSchemaProvisioning.ts` deriva o `projectRef` **sempre** de
  `NEXT_PUBLIC_SUPABASE_URL` — o HostPanel só consegue mirar o **próprio**
  projeto (`gvtsthcnhkenzeqwtkwj`), nunca um arbitrário;
- o provisionamento do HostPanel cria **schema dedicado por site**; o remoto tem
  tudo em `public`, com `supabase_migrations` populada — assinatura de CLI.

O que **permanece** em H5: o dado remoto inclui as fixtures do e2e
(`cliente.e2e@`, `admin.e2e@`) e a suíte Playwright terminou às 09:59:20. Mas a
guarda `exigirDestinoLocal` (commitada 8 h antes) **lança exceção** para
qualquer URL que não seja local. **Como as fixtures do e2e chegaram ao remoto
com essa guarda em vigor é a única peça que não consegui fechar.**

---

## 15. Causa raiz provável e nível de confiança

**Uma execução manual da CLI do Supabase, a partir do diretório
`ecommerce-template`, em 2026-08-30 às 09:56:54 local, escrevendo no projeto
`egoajboqzhnvkpenrszw` por conexão direta (`--db-url` ou `SUPABASE_DB_URL`),
seguida da suíte de testes do próprio template.**

| Aspecto | Confiança |
|---|---|
| Que foi o `ecommerce-template` | **CERTEZA** |
| Quando | **CERTEZA** |
| De qual diretório | **ALTA** |
| Que não foi o Claude | **ALTA** |
| Que não foi o HostPanel | **ALTA** |
| **Comando exato** | **BAIXA — não testemunhado** |
| Como o e2e furou a guarda | **NÃO EXPLICADO** |

---

## 16. Impacto

**Sobre o Aurora:** nenhum dado do Aurora existe ou existiu ali. Nada foi
perdido. O projeto está **inutilizável como está** para o Aurora.

**Sobre terceiros:** nenhum. 12 contas fictícias, 0 e-mails enviados, nenhum
dado pessoal real, nenhum pagamento real.

**Ativo agora:** **9 jobs de cron rodando**, incluindo `dispatch-email-outbox`
a cada 2 minutos. Falham (nenhuma mensagem saiu), mas consomem execução no plano
gratuito continuamente.

**Achado colateral, fora do escopo — merece decisão sua:**
o histórico do PowerShell contém, **em texto claro**, a senha do banco Postgres
do projeto `mbnjjbtllzgatkjtsvrg`. Não a reproduzo aqui. Recomendo tratá-la como
**potencialmente comprometida**. **Não rotacionei nada.**

---

## 17. Opções de recuperação

**A — Criar projeto novo para o Aurora e preservar este.** Menor risco. O banco
contaminado fica intacto para quem precisar dele. Custo: um projeto a mais.

**B — Limpar este projeto e usá-lo para o Aurora.** Exige apagar 49 tabelas, 12
contas, 9 jobs de cron e 23 registros de migração. Reversível só por backup —
e o plano gratuito tem retenção curta. **Não recomendo sem confirmar que
ninguém depende desse conteúdo.**

**C — Manter como e-commerce.** Se essa loja for para existir, este projeto já
está pronto. O Aurora ganha outro.

**Recomendação: A.** É a única que não destrói nada e não depende de certeza
sobre quem usa o quê.

**Em qualquer cenário, antes:** decidir sobre os 9 jobs de cron e sobre a
credencial exposta em §16.

---

## 18. O que NÃO foi alterado

- Nenhuma migração aplicada, nenhum `db push`, `db reset`, `db pull`.
- Nenhum schema, tabela, linha, papel ou `auth.users` alterado.
- Nenhum job de cron mexido.
- Nenhum projeto Supabase criado, apagado, renomeado ou movido de organização.
- Nenhum seed, nenhum deploy.
- **Nenhum outro projeto Supabase acessado** — só `egoajboqzhnvkpenrszw`.
- Nenhum dos três repositórios modificado.
- Nenhuma credencial rotacionada, revogada ou impressa.
- TechneCare/Arkmeds: não acessado.

**Única mudança de estado local desta sessão** (feita antes desta auditoria, para
impedir que um comando futuro fosse ao projeto errado):
`technecaremeds/supabase/.temp/` re-vinculado de `ikzpateoicbjxkapdtsd` para
`egoajboqzhnvkpenrszw`. Arquivo local, ignorado pelo Git.

**Consequência forense registrada:** esse re-vínculo **sobrescreveu** o
`linked-project.json` original. Preservei o conteúdo dele (§13), mas o mtime
original se perdeu. Se soubesse do quadro, teria copiado antes.

---

## 19. Perguntas que continuam abertas

1. **Qual foi o comando exato**, e em qual terminal.
2. **Como as fixtures do e2e chegaram ao remoto** com `exigirDestinoLocal` em vigor.
3. **De onde veio a connection string** do Aurora, já que o ref nunca aparece em
   nenhum arquivo dos três repositórios nem no histórico do console.

Uma resposta sua a "o que você estava fazendo por volta das 09:56 de hoje"
provavelmente fecha as três.
