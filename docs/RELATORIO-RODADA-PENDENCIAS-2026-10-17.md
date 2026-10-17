# Relatório — rodada de pendências do pente-fino (17/10/2026)

> **Pedido:** resolver de forma autônoma todas as pendências dos 85 achados do pente-fino
> (`docs/AUDITORIA-PENTE-FINO-2026-10-17.md`), validando, auditando e corrigindo.
> **Estado:** **INCOMPLETA.** A rodada foi interrompida por limite de uso. Quatro itens foram resolvidos e
> commitados e um quinto foi decidido sem mudança. O restante está listado em §5, com o ponto exato em que parou.
> **Branch:** `fix/pendencias-pente-fino-2026-10-17` (enviada ao GitHub) · **Sem PR, sem merge.**
> **`main`:** continua em `6b7e391` (merge da PR #27), com CI verde 4/4.
> **Remoto:** nenhuma migration aplicada, nenhum deploy de backend.

---

## 1 · Ponto de partida

A rodada anterior (PR [#27](https://github.com/voceconectadigital/technecaremeds/pull/27), mergeada em `6b7e391`)
fechou o pente-fino técnico:

| | Encontrados | Corrigidos na PR #27 |
| --- | --- | --- |
| P0 | 3 | 3 |
| P1 | 20 | 20 |
| P2 | 42 | 28 (PF-74 e PF-79 só em parte) |
| P3 | 17 | 12 |
| INFO | 3 | — |

Evidência da PR #27: CI da PR e da `main` verdes. PostgreSQL 16 aplicou as 74 migrations do zero e rodou
2 357 testes sem falha; Playwright teve 209 aprovados e 1 pulo condicional que já existia.

Ficaram **24 itens** sem correção (BLOQUEADO — CLIENTE, BLOQUEADO — INFRA ou ABERTO), mais as perguntas
P-01…P-16 do Anderson e os critérios do especialista. Esta rodada atacou esses 24 itens.

---

## 2 · O que eu NÃO resolvi de propósito (e por quê)

| Item | Motivo |
| --- | --- |
| **P-01…P-16** (MTTR, MTBF, TMPA, população do ICRS, Global, ACM/atraso, IMP, interno × externo, disponibilidade, escopo do Basic, crítico, formato de tempo, competência do IMR, glosa/IMR, qualidade/assiduidade, obsolescência) | São definições de negócio do cliente. Se eu "resolvesse", o sistema imprimiria números como oficiais sem respaldo — exatamente o que a rodada anterior proibiu. Ficam como estão: pendentes, marcados como provisórios ou sem definição, e prontos para receber a resposta. |
| **Critérios metrológicos** (incerteza, TSE, tolerância, aceitação automática) | Definição científica do especialista. Nada foi inventado. |
| **Migration remota (0060–0077) e deploy do backend** | "Resolver tudo" não é autorização explícita com destino comprovado. Fica pronto e aguarda a sua autorização. |

---

## 3 · Resolvido nesta rodada (commitado e enviado)

Commits na branch `fix/pendencias-pente-fino-2026-10-17`, sobre `6b7e391`:

| Commit | Título |
| --- | --- |
| `8f2b2ea` | fix(db): per-transaction statement and idle timeouts (PF-75) |
| `834cef3` | fix(access,db): audit trail out of "all reads"; system catalogs always provisioned |
| `8a1b47b` | feat(web): build-time CSP for the Pages apps, report-only (PF-80) |

### PF-75 — tempo-limite de consulta e de transação ociosa (era BLOQUEADO — INFRA)

- **Problema:** o banco não tinha `statement_timeout` nem `idle_in_transaction_session_timeout`. Uma consulta
  presa segurava a conexão para sempre e podia esgotar o pool. A rodada anterior deixou o item para a
  infraestrutura, porque um parâmetro de inicialização da conexão é recusado pelo pooler do Supabase em modo
  transação.
- **Solução, sem depender da infraestrutura:** `withTenant` aplica os dois limites com
  `set_config(..., true)`, que vale **só dentro da transação**. O pooler aceita, e o valor não vaza para a
  transação seguinte na mesma conexão.
- **Configuração:** `AURORA_DB_TIMEOUT_MS` (padrão 60 000; `0` desliga). A API usa o valor; o worker usa 5×,
  porque varredura de organização grande é legitimamente mais longa. `.env.example` atualizado.
- **Arquivos:** `packages/db/src/client.ts` (`LimitesDeTransacao`), `packages/db/src/adapters.ts`
  (`pgPoolAdapter(pool, papel, limites)`), `packages/config/src/env.ts`, `apps/api/src/main.ts`,
  `apps/workers/src/main.ts`.
- **Teste:** `pool-resiliente.test.ts` confere que o limite vale dentro da transação (`1234ms`/`5678ms`) e que a
  transação seguinte volta a `0`.

### PF-15 — trilha de auditoria fora de "toda leitura" (era BLOQUEADO — CLIENTE)

- **Problema:** `audit.read` também termina em `.read` e entrava de carona em `ALL_READ`. Assim, Coordenador,
  Gestor e Financeiro liam a trilha global da organização inteira, sem recorte de escopo.
- **Por que decidi sem esperar o cliente:** o próprio código mostra a intenção. Os papéis que devem ler a trilha
  a listam **explicitamente** (Gestor de manutenção via `MANAGER_BASE`, Auditor); os três acima só a recebiam por
  acidente.
- **Correção:** `ALL_READ` exclui `audit.read`. A migration `0077` retira a permissão dos papéis de fábrica
  existentes (`coordinator`, `manager`, `finance`, só `is_system`). Papel próprio é decisão da organização.
- **Sem efeito colateral:** a linha do tempo de um registro não exige `audit.read`; nenhuma tela desses perfis
  usa a trilha global.
- **Teste:** `permissions.test.ts`: os três não leem a trilha; Gestor de manutenção, Auditor, Proprietário e
  Administrador leem.

### PF-20 — tipos de OS e famílias que não nasciam (era ABERTO)

O defeito era maior do que o registrado. Existia também **no provisionamento em runtime**, não só nas
migrations 0063/0064:

- a chave de catálogo é única **inclusive entre arquivados**: com um item aposentado usando a chave `preventiva`,
  o `ON CONFLICT DO NOTHING` engolia a inserção, e a organização ficava sem o tipo de OS de sistema, sem erro
  nenhum;
- uma **subcategoria** viva com o nome de uma família ("Terapia" debaixo de outra raiz) ocupava o nome: a
  migration pulava a família, e o provisionamento **falhava**.

**Correção:**

- `provisioning.ts` usa a chave livre seguinte (`preventiva_2`) e o nome qualificado ("Terapia (família)").
  Retirei o `ON CONFLICT DO NOTHING`, para que uma falha de verdade apareça.
- A migration `0077` repara as organizações existentes com a mesma lógica: marca a raiz de mesmo nome quando
  ela existe, senão cria; não toca organização que já está completa.

**Testes (`migrations-upgrade.test.ts`, +2):**

- banco legado na 0059 com o item arquivado e a subcategoria em conflito → depois da rodada nova, 7 tipos de
  sistema (preventivo = `preventiva_2`), 5 famílias ("Terapia (família)") e a subcategoria intacta;
- provisionamento em runtime com os mesmos conflitos → 5 famílias e 7 tipos.

### PF-80 — CSP dos apps no Cloudflare Pages (era BLOQUEADO — INFRA)

- **Problema:** a CSP precisa nomear a origem da API, que muda por implantação. Um `_headers` estático erraria.
- **Solução:** `tools/lib/cabecalhos-pages.mjs` é um plugin do Vite usado nas três builds (web, portal, campo).
  No fim do build, ele acrescenta a política ao `_headers` publicado, com:
  - a origem real de `VITE_API_URL` em `connect-src`/`img-src`;
  - o **hash SHA-256** do script de tema inline do `index.html` que foi de fato publicado — sem
    `'unsafe-inline'` para script;
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Publicada como `Content-Security-Policy-Report-Only`:** uma CSP errada derruba a aplicação inteira, e nem o
  servidor de desenvolvimento nem o E2E leem `_headers`. Para passar a bloquear, basta trocar `REPORT_ONLY`
  depois de uma navegação limpa no ambiente publicado.
- **Conferido:** build do portal com `VITE_API_URL=https://api-exemplo.test/v1` e build da demonstração; o
  cabeçalho saiu correto nos dois.
- **Teste:** `packages/config/src/__tests__/cabecalhos-pages.test.ts` (origem, hash exato, ausência de
  `unsafe-inline` em script).

Com PF-75 e PF-80, os itens **PF-74 e PF-79**, que estavam "corrigidos em parte", ficam completos (a CSP ainda
precisa da troca para modo de bloqueio).

### PF-16 — funções de plataforma confiam no `p_user_id` (ACEITO / BY DESIGN — decisão técnica)

Não alterei. Qualquer identidade passada ao banco, seja por parâmetro ou por GUC, é forjável pelo mesmo papel
(`aurora_app`) que hoje forja o parâmetro. A premissa do ataque exige injeção de SQL, e todo SQL do projeto é
parametrizado (conferido na rodada anterior). A fronteira real é a API, que passa `ctx.actorId` resolvido da
sessão. Trocar o mecanismo seria cerimônia, não proteção.

### Validação local dos commits

- Testes dos arquivos alterados: `pool-resiliente` (incluindo o tempo-limite), `migrations-upgrade` (5),
  `migrations` (5), `permissions`/`profiles` (29), `packages/config` (inclui `env` e `cabecalhos-pages`):
  **todos verdes**.
- Typecheck limpo; ESLint e Prettier limpos nos arquivos alterados.
- **CI desta branch não rodou** (não há PR).

---

## 4 · Como o trabalho estava organizado

Para as demais pendências, abri quatro frentes em paralelo, cada uma com arquivos próprios e um número de
migration reservado:

| Frente | Itens | Migration reservada |
| --- | --- | --- |
| Execução de campo | PF-14, PF-41, PF-65, PF-66, PF-84 | `0074` |
| Estoque e orçamento | PF-34, PF-71 | `0075` |
| Indicadores e fuso | PF-50…PF-56, PF-72 (+ validação de indicadores na regra agendada) | `0076` |
| Revisão adversarial (somente leitura) | regressões do diff `511ec1f..6b7e391` | — |
| Eu | PF-15, PF-16, PF-20, PF-75, PF-80 | `0077` |

**As quatro frentes foram interrompidas** pelo limite de uso antes de terminar.

---

## 5 · O que ficou pendente — estado exato

### 5.1 Alterações parciais NÃO commitadas no working tree

Ficaram 9 arquivos com edição pela metade, **não testados**. **Não devem ser commitados como estão.**
Na próxima sessão, cada um deve ser revisado e concluído, ou descartado:

| Arquivo | Frente | O que parece ter sido começado |
| --- | --- | --- |
| `packages/db/src/quotes.ts` (+141/−) | Estoque | PF-34: reservar só o que não foi consumido em campo antes da aprovação; a última ação registrada foi trocar `peca.` pela quantidade reduzida na reserva |
| `packages/db/src/inventory.ts` | Estoque | apoio ao PF-34 |
| `packages/db/migrations/0075_orcamento_e_peca_lancada.sql` (novo) | Estoque | migration do PF-34 |
| `packages/domain/src/dia-local.ts` (novo) | Indicadores | PF-51: dia civil no fuso da organização (`Intl`) |
| `packages/domain/src/indicator-targets.ts`, `packages/domain/src/index.ts` | Indicadores | uso do dia local na meta |
| `packages/db/src/indicator-targets.ts` | Indicadores | idem (era a próxima edição quando parou) |
| `packages/db/src/relatorios.ts` | Indicadores | PF-50/51: meta e dia de referência |
| `packages/domain/src/report-tiers.ts` | Indicadores | validação de indicadores por modelo |

A frente de **execução de campo** ainda não tinha gravado nada (estava lendo `anexos.ts` e `campo.tsx`). A
**revisão adversarial** foi interrompida antes do relatório, enquanto lia `roles.ts` e `memberships.ts`.

### 5.2 Itens ainda abertos

| ID | Sev. | Item | Decisão proposta (para a próxima sessão) |
| --- | --- | --- | --- |
| PF-14 | P2 | `work_order.execute` ("só OS atribuída a mim") tratado como `execute_any` | Aplicar no servidor: executa quem é responsável pela OS ou da equipe dela, ou quem tem `execute_any`. A própria descrição da permissão já define a regra. Conferir as personas do E2E. |
| PF-41 | INFO | Parecer LIBERADO/PARADO obrigatório na conclusão? | Configuração por organização, **desligada por padrão** (comportamento atual preservado). |
| PF-65 | P2 | Cronômetro do campo sem "parar" e com hora do servidor na reenviada | O aparelho gera o id do apontamento; "iniciar", "parar" e check-in/out aceitam a hora do aparelho entre 48 h no passado e 5 min no futuro, com idempotência. |
| PF-66 | P3 | Fotos na fila sem marca de sessão | Carimbar organização e pessoa, como já é feito com os comandos. |
| PF-84 | P3 | Envio de fatias de foto só confere a organização; tipo do arquivo não é conferido | Exigir que quem envia possa executar a OS; conferir os bytes contra o tipo declarado ao concluir. |
| PF-34 | P2 | Peça lançada antes da aprovação → baixa dupla | Reservar só o que falta (orçamento − consumido sem vínculo); o valor cobrado continua o orçado. **Em andamento** (§5.1). |
| PF-71 | P2 | Orçamento da OS criado em várias chamadas | Rota única e transacional, idempotente, invalidando as listas. |
| PF-50 | P2 | Vínculo restrito a um cliente medido pela meta da organização | Usar a meta do cliente (com fallback para a da organização) e ajustar o teste atual. **Em andamento.** |
| PF-51 / PF-72 | P2/P3 | Dia e períodos em UTC | Fuso da organização (padrão `America/Sao_Paulo`) no servidor; data local do navegador nas telas. **Em andamento.** |
| PF-52 | P2 | Relatório mensal = "slot − N dias" | Parâmetro "mês anterior (calendário)"; regras antigas inalteradas. |
| PF-53 | P2 | Filtro de categoria ignorado em 4 consultas | Aplicar nas quatro. |
| PF-54 | P2 | Tela de relatório agendado sem PROVISIONAL e sem meta | Mesmo tratamento da tela de relatório. |
| PF-55 | P2 | Cores do Painel com limiares fixos | A API devolve as metas resolvidas; sem meta, cor neutra. |
| PF-56 | P2 | E-mail de automação ignora preferências | Passar por `decideDelivery`. |
| — | — | Revisão adversarial do diff da PR #27 | Refazer do início (o resultado parcial foi perdido). |

### 5.3 Fora do alcance desta engenharia

- **Anderson:** P-01 · P-02 · P-03 · P-04 · P-05 · P-06 · P-07 · P-08 · P-09 · P-10 · P-11 · P-12 · P-13 · P-14 ·
  P-15 · P-16.
- **Especialista:** incerteza, TSE, tolerância, aceitação automática.
- **Infraestrutura / autorização:**
  - transporte de e-mail (a fila existe, sem envio);
  - destino definitivo de banco e API;
  - aplicação das migrations **0060–0077** no banco remoto e deploy do backend, que exigem autorização explícita
    com o destino comprovado;
  - troca da CSP para modo de bloqueio, depois de uma navegação limpa publicada.

---

## 6 · Próxima sessão — ordem recomendada

1. Revisar os 9 arquivos de §5.1: concluir PF-34 e PF-50/51 a partir deles, ou descartar com
   `git checkout -- <arquivo>` e refazer.
2. Execução de campo (PF-14, PF-65, PF-66, PF-84, PF-41), numa frente só, porque mexe em servidor e app.
3. Indicadores restantes (PF-52…PF-56) e orçamento atômico (PF-71).
4. Revisão adversarial do diff da PR #27.
5. Renumerar as migrations para ficarem contíguas (há `0074`/`0076` reservadas sem arquivo), suíte em shards,
   documentação (`AUDITORIA-PENTE-FINO`, `AI-HANDOFF`, `NOVAS-SOLICITACOES`), PR, CI 4/4, merge, CI da `main`.

---

## 7 · Resumo

| | |
| --- | --- |
| HEAD da `main` | `6b7e391` (inalterado nesta rodada) |
| Branch desta rodada | `fix/pendencias-pente-fino-2026-10-17` → `8a1b47b` (3 commits, enviada) |
| PR / CI / merge | **não feitos** |
| Resolvidos nesta rodada | PF-15, PF-20, PF-75, PF-80 (+ PF-74/PF-79 completos); PF-16 decidido como ACEITO |
| Abertos de engenharia | 14 itens (§5.2) + revisão adversarial |
| Pendências do cliente / especialista / infraestrutura | §5.3 |
| Migration remota | **NÃO EXECUTADA** |
| Deploy de backend | **NÃO EXECUTADO** |
| Estado | **INCOMPLETA — interrompida por limite de uso** |
