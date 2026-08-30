# Plano de recuperação — Supabase `egoajboqzhnvkpenrszw`

**Data:** 2026-08-30 · **Estado:** preparação concluída, **limpeza NÃO executada**.

Este documento é a preparação exigida antes de qualquer operação destrutiva.
Nada remoto foi alterado. O que segue é inventário, prova, backup, plano exato e
o portão que aguarda autorização.

---

## 1. Identidade do projeto

| Campo | Valor |
|---|---|
| Project Name | **Aurora CMMS** |
| Project Ref | **`egoajboqzhnvkpenrszw`** |
| Region | **sa-east-1** |
| Host | `db.egoajboqzhnvkpenrszw.supabase.co` |
| Pooler | `aws-0-sa-east-1.pooler.supabase.com` |
| Postgres | 17.6.1.166 · `ACTIVE_HEALTHY` |
| Organização | `srgohxsjjvfpippdmcnl` |
| Papel da conexão | `postgres` — `rolsuper=false`, `createrole=true`, **`bypassrls=true`** |

---

## 2. Inventário (somente leitura)

| Objeto | Quantidade |
|---|---|
| Tabelas em `public` | 49 |
| Views em `public` | 3 |
| Materialized views | 0 |
| Funções em `public` | 119 — **88 próprias + 31 da extensão `pg_trgm`** |
| Triggers em `public` | 14 |
| Policies RLS em `public` | 138 |
| Enums em `public` | 2 |
| Jobs `pg_cron` | 9 — **todos ativos** |
| `auth.users` | 12 |
| Buckets de storage | 2 (`logos`, `products`) |
| Objetos em storage | **0** |
| Segredos no vault | 2 |
| Migrações no ledger | 23 |
| Linhas de dado em `public` | **153** |
| Schema `aurora` | **0 — nunca aplicado** |
| Papéis `aurora_*` | **0** |
| Tabelas fora dos schemas conhecidos | **0** |

Extensões: `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`,
`supabase_vault`, `uuid-ossp` (todas padrão do Supabase) e **`pg_trgm` instalada
em `public`** — esta pelo e-commerce.

---

## 3. Classificação dos objetos

**Regra:** um objeto é ECOMMERCE quando seu nome aparece no corpo das 23
migrações de `ecommerce-template/supabase/migrations`.

| Categoria | Total | ECOMMERCE | SUPABASE PADRÃO | **DESCONHECIDO** |
|---|---|---|---|---|
| Tabelas | 49 | **49** | 0 | **0** |
| Views | 3 | **3** | 0 | **0** |
| Funções | 119 | **88** | 31 (`pg_trgm`) | **0** |
| Enums | 2 | **2** | 0 | **0** |
| Triggers | 14 | **14** | 0 | **0** |
| Cron jobs | 9 | **9** | 0 | **0** |
| Buckets | 2 | **2** | 0 | **0** |
| Vault | 2 | **2** | 0 | **0** |
| Papéis de banco | 2 não padrão | 0 | 2 | **0** |
| **TOTAL** | **202** | **169** | **33** | **0** |

Provas de fechamento:

- As 31 funções "sem correspondência" pertencem, **por `pg_depend`**, à extensão
  `pg_trgm` — a conta fecha exata: 31 da extensão + 88 próprias = 119.
- `pg_trgm` é instalada por
  `00000000000002_phase1_core_catalog.sql:38` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
  → **ECOMMERCE**.
- Buckets `logos` e `products` são inseridos por
  `00000000000001_platform_baseline.sql` → **ECOMMERCE**, e estão **vazios**.
- Os 2 segredos do vault chamam-se `provider_test_sandbox_secret_key` e
  `provider_test_webhook_secret`, criados em 2026-08-30 → **sandbox de teste**.
- Nenhuma migração do e-commerce cria papel de banco; `supabase_functions_admin`
  e `supabase_privileged_role` são do Supabase.

> **ZERO objetos DESCONHECIDOS.** O critério de parada da Fase 2 não foi
> acionado.

---

## 4. Backup e checksum

| Item | Valor |
|---|---|
| Caminho | `C:\Users\Desktop\aurora-backup-2026-08-30\` |
| Fora do Git | sim — nenhum repositório acima dele |
| Fora do OneDrive | sim — não é sincronizado |
| Arquivos | 27 (26 tabelas + metadados de `auth.users`) |
| Linhas | **153 de 153** |
| Tamanho | 152 KB |
| Manifesto | `MANIFEST.sha256` |
| SHA-256 do manifesto | `e88bacf8c55f06a7064503b70a881fd2dd47df3c05e87e21f8a5fdc48288fa3f` |

### Impedimento registrado

**`supabase db dump` NÃO funciona nesta conta.** Ele falha com
`403 — Your account does not have the necessary privileges to access this
endpoint` no endpoint de *login role*, embora `supabase db query` funcione.

O backup foi produzido por outra via: **exportação linha a linha via `SELECT`**,
uma tabela por arquivo JSON. Isso cobre **os dados**. Não cobre o DDL — que
**não precisa de backup**, porque é reproduzível byte a byte a partir de
`voceconectadigital/ecommerce-template@b1a759b`, e essa equivalência foi provada
migração a migração (23/23) e tabela a tabela (49/49).

### O que o backup NÃO contém, e por quê

- **Hashes de senha de `auth.users`.** Exportá-los seria mover credenciais para
  disco sem necessidade. As 12 contas são fixtures do e2e, recriáveis por
  `ecommerce-template/e2e/global-setup.ts`. Estão guardados: id, e-mail,
  datas, papel e metadados.
- **Valores do vault.** São credenciais. Ficaram onde estão.
- **Objetos de storage.** Não há nenhum.

> **Rollback só é possível para o DADO**, não para os segredos do vault. Se
> alguém precisar deles, precisa exportá-los **antes** da limpeza — e isso é uma
> decisão que não tomo sozinho.

---

## 5. Os 9 jobs de cron

| Job | Agenda |
|---|---|
| `dispatch-email-outbox` | `*/2 * * * *` |
| `expire-stock-reservations` | `*/5 * * * *` |
| `mark-abandoned-carts` | `*/10 * * * *` |
| `send-cart-recovery` | `*/15 * * * *` |
| `track-shipments` | `15 * * * *` |
| `purge-rate-limit-events` | `7 * * * *` |
| `purge-checkout-attempts` | `23 * * * *` |
| `process-abandoned-orders` | `0 * * * *` |
| `process-scheduled-deletions` | `0 3 * * *` |

Todos criados por `00000000000013_scheduled_jobs.sql`. **Todos ativos agora.**
`dispatch-email-outbox` tenta despachar a cada 2 minutos e falha — as 16
mensagens seguem `pending`, nenhuma foi enviada.

**São a primeira coisa a parar**, e por dois motivos: escrevem no banco enquanto
a limpeza acontece, e continuam consumindo execução no plano gratuito.

---

## 6. As 12 contas

| Métrica | Valor |
|---|---|
| Criadas | todas em 2026-08-30, num intervalo de **13 segundos** |
| Já fizeram login | 2 |
| Padrão de e-mail de teste | **12 de 12** |
| Fixtures identificadas | `cliente.e2e@…` (1), `admin.e2e@…` (1), `@exemplo.test` (11) |

Correspondem às fixtures declaradas em `ecommerce-template/e2e/global-setup.ts`.
**Nenhuma pessoa real.**

---

## 7. Storage

2 buckets (`logos`, `products`), ambos criados pela migração 0001 do e-commerce,
ambos **públicos**, **0 objetos**. Nada a preservar. O critério de parada da
Fase 6 não foi acionado.

---

## 8. Sequência exata de limpeza

> **NÃO EXECUTADA.** Escrita aqui para revisão.

A ordem não é arbitrária: para a escrita primeiro, depois remove o que escreve,
depois o que identifica, e por último o registro — para que uma interrupção no
meio deixe um estado legível, e não um meio-termo silencioso.

**Passo 1 — parar os jobs** (9 comandos)
`SELECT cron.unschedule('<job>')` para cada um dos 9 da §5.
*Depois deste passo o banco para de mudar sozinho.*

**Passo 2 — conferir que parou**
`SELECT count(*) FROM cron.job` → deve ser 0.

**Passo 3 — remover o schema da aplicação**
`DROP SCHEMA public CASCADE;` seguido de `CREATE SCHEMA public;`
Leva junto: 49 tabelas, 3 views, 88 funções próprias, 14 triggers, 138 policies,
2 enums e 153 linhas.
**Cuidado obrigatório:** leva também a extensão `pg_trgm`, que vive em `public`.
Isso é desejável — ela é do e-commerce.

**Passo 4 — restaurar as concessões padrão de `public`**
`GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;`
mais `GRANT ALL ON SCHEMA public TO postgres, service_role;` e os
`ALTER DEFAULT PRIVILEGES` equivalentes.
**Sem este passo o projeto fica quebrado** — é o erro clássico de quem dropa
`public` no Supabase.

**Passo 5 — remover as 12 contas**
Preferir a **Auth Admin API** (`DELETE /auth/v1/admin/users/{id}`) a `DELETE FROM
auth.users`: a API remove identidades, sessões e refresh tokens pelo caminho que
o Supabase mantém consistente. O `DELETE` direto depende de cascatas internas que
não são contrato público.

**Passo 6 — remover os 2 buckets**
`DELETE FROM storage.buckets WHERE id IN ('logos','products');`
Seguro: 0 objetos dentro.

**Passo 7 — remover os 2 segredos do vault**
`SELECT vault.delete_secret(id)` para cada.
**Só depois de decidido** se alguém precisa deles (§4).

**Passo 8 — limpar o ledger de migrações**
`DELETE FROM supabase_migrations.schema_migrations;` (23 linhas)
Sem isso, o Supabase continua acreditando que as 23 migrações do e-commerce
estão aplicadas.

**Passo 9 — conferência final**
Tabelas em `public` = 0 · cron jobs = 0 · `auth.users` = 0 · buckets = 0 ·
ledger = 0 · schema `aurora` = 0.

**Passo 10 — só então liberar o destino**
Preencher `ref` de `homologacao` em `aurora.destinos.json` e **remover
`egoajboqzhnvkpenrszw` da lista de bloqueados** — as duas coisas, de propósito
(§10). Só aí `npm run db:migrate` aceitará este projeto.

---

## 9. Rollback

| Cenário | Recuperável? | Como |
|---|---|---|
| DDL do e-commerce | **Sim** | `ecommerce-template@b1a759b` → `supabase db push` |
| Dados (153 linhas) | **Sim** | 26 arquivos JSON em `C:\Users\Desktop\aurora-backup-2026-08-30\` |
| 12 contas | **Sim** | `e2e/global-setup.ts` recria as fixtures |
| Buckets | **Sim** | migração 0001 |
| Jobs de cron | **Sim** | migração 0013 |
| **Segredos do vault** | **NÃO** | valores não foram exportados — decidir antes |
| Backup nativo do Supabase | **A VALIDAR** | plano gratuito tem retenção diária curta; **não verifiquei** |

---

## 10. Guard rails implementados

Independentes da limpeza, já no repositório, já provados.

### `aurora.destinos.json` — lista fechada, versionada

Enumera os destinos permitidos por ambiente. `homologacao` e `producao` têm
`ref: null` — **hoje, todo destino remoto é recusado**, que é o correto. E uma
lista de bloqueados com motivo, incluindo os três refs que já se aproximaram
deste repositório por engano.

### `packages/config/src/destino.ts` — a regra

Substitui o guard anterior, que era **pior do que nenhum porque parecia
proteção**:

```js
if (/supabase\.co/.test(url) && !process.env.AURORA_CONFIRM_REMOTE) …
```

Ele conferia se a variável **estava definida** — não o valor.
`AURORA_CONFIRM_REMOTE=sim` liberava qualquer projeto do mundo.

O novo:

1. **extrai o ref das DUAS formas** — do host (`db.<ref>.supabase.co`) **e do
   nome de usuário do pooler** (`postgres.<ref>@…`). Ler só o host deixaria
   passar justamente a forma que a interface do Supabase oferece primeiro, e que
   por isso é a que se cola num terminal às pressas;
2. **bloqueia antes de permitir** — um ref bloqueado é recusado mesmo que alguém
   o acrescente à lista de permitidos. Liberar exige editar **duas** listas:
   editar duas coisas é uma decisão, editar uma é um deslize;
3. **exige `AURORA_AMBIENTE` para destino remoto** e confronta a intenção com o
   destino, mostrando os dois quando divergem;
4. **dispensa `AURORA_AMBIENTE` para destino local conhecido** — um guard que
   atrapalha o trabalho de todo dia é um guard que alguém desliga;
5. **não lê `process.env` para decidir.** A superfície é `{url, ambiente, lista}`.
   **Não existe variável de escape**, e é de propósito: uma saída de emergência
   vira o caminho normal na primeira pressa.

### `tools/db/destino.mjs` — a porta

Carrega a lista, chama a regra, **encerra com 1** em qualquer recusa. Confere
também **de onde o comando foi disparado**: fora do repositório do Aurora, nada
acontece — é o `cwd` que decide qual `.env` é lido.

Ligado em `tools/db/run.mjs` (`migrate`/`seed`/`status`) e em
`tools/homologacao/semear.mjs`. Disponível avulso como `npm run db:destino`.

> **Defeito encontrado no próprio guard, durante os testes:** a primeira versão
> conferia o `package.json` da pasta do próprio script — que é sempre a do
> Aurora, por construção. **Nunca poderia falhar.** Era o mesmo defeito do
> `AURORA_CONFIRM_REMOTE` que ela veio substituir. Um teste disparado de outro
> diretório mostrou isso na hora. Corrigido para conferir o `cwd`.

---

## 11. Testes

| Prova | Resultado |
|---|---|
| `packages/config/src/__tests__/destino.test.ts` | **16 casos, todos passam** |
| Projeto contaminado por conexão direta | recusa, **saída 1** |
| Projeto contaminado **pelo pooler** | recusa, **saída 1** |
| Projeto do Renato (bloqueado) | recusa, **saída 1** |
| Remoto desconhecido sem ambiente | recusa, **saída 1** |
| Remoto desconhecido com ambiente | recusa, **saída 1** |
| `AURORA_CONFIRM_REMOTE=sim` não libera mais nada | recusa, **saída 1** |
| Banco local desconhecido | recusa, **saída 1** |
| Disparado de `ecommerce-template` | recusa, **saída 1** |
| `localhost/aurora` (dia a dia) | **passa**, saída 0 |
| `localhost/aurora_e2e` + `AURORA_AMBIENTE=teste` | **passa**, saída 0 |
| Suíte completa | **1 648 provas · 85 arquivos** |
| Ponta a ponta | **147 provas** |
| `spec:audit`, `typecheck`, `lint`, `marca`, `openapi` | verdes |

---

## 12. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Dropar `public` sem restaurar as concessões | **Alta** | Passo 4 é obrigatório e está explícito |
| Segredos do vault perdidos sem volta | **Média** | Decidir **antes** do Passo 7 |
| `DELETE FROM auth.users` deixar resíduo | Média | Usar a Auth Admin API (Passo 5) |
| Job de cron escrever durante a limpeza | Média | Passo 1 vem primeiro, Passo 2 confere |
| Backup incompleto por falta do `db dump` | **Registrada** | DDL reproduzível do Git; dado exportado 153/153 |
| Retenção do backup nativo do Supabase | **A VALIDAR** | Não verificado — plano gratuito |
| Reaplicar Aurora antes de liberar o destino | Baixa | O guard recusa até as duas listas mudarem |

---

## 13. O portão — aguarda autorização

```
PROJECT NAME  : Aurora CMMS
PROJECT REF   : egoajboqzhnvkpenrszw
HOST          : db.egoajboqzhnvkpenrszw.supabase.co
REGION        : sa-east-1
```

**TOTAL DE OBJETOS A REMOVER: 202**

> 49 tabelas · 3 views · 88 funções próprias · 14 triggers · 138 policies ·
> 2 enums · 1 extensão (`pg_trgm`) · 9 jobs de cron · 12 contas · 2 buckets ·
> 2 segredos de vault · 23 registros de migração · **153 linhas de dado**

Os três dados exigidos conferem: **`egoajboqzhnvkpenrszw` · Aurora CMMS ·
sa-east-1**.

### O que este prompt autorizou, e foi feito

auditoria · inventário · classificação · backup · plano · guard rails · testes ·
commit e push das proteções.

### O que aguarda uma nova autorização, e **não** foi feito

`DROP` remoto · `DELETE FROM auth.users` · remoção dos jobs de cron · remoção
das migrações remotas · reset remoto · remoção de buckets · remoção de segredos
do vault.

**Antes de autorizar, duas decisões são suas:**

1. **Os 2 segredos do vault** — descartáveis, ou exportar antes?
2. **Os 9 jobs de cron** — parar agora, separadamente, ou só junto com a
   limpeza? Eles escrevem a cada 2 minutos enquanto isso não acontece.
