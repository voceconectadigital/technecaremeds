# Auditoria pente-fino — 17/10/2026

> **Escopo:** sistema inteiro (monorepo `apps/*` e `packages/*`), em modo autônomo.
> **Branch:** `audit/pente-fino-2026-10-17` · **HEAD inicial:** `511ec1f` (igual ao esperado — merge da PR #26).
> **Restrições respeitadas:** nenhuma migration remota, nenhum deploy de backend, nenhuma mudança em VPS,
> Supabase remoto, DNS ou segredos remotos. Código na `main` **não** autoriza deploy.
> **Estado final:** ver §9 (resumo executivo).

---

## 1 · Como a auditoria foi feita

1. **Baseline.** `main` em `511ec1f`. CI da `main` para esse commit: Estático ✅, Ponta a ponta ✅, PostgreSQL 16 em
   andamento no início (resultado registrado no PR). Gates locais: typecheck ✅, OpenAPI ✅, segredos ✅, SPEC ✅.
   `lint`, `format:check` e `marca:check` **falham só nesta máquina** — o checkout Windows usa `core.autocrlf=true`
   (CRLF no disco) e a pasta local ignorada `capturas/` entra no ESLint. No CI (Linux, LF) os três passam. Não é
   defeito de código (INFO, §8).
2. **Oito frentes de auditoria em paralelo**, somente leitura: autenticação; RLS/migrations; RBAC/escopo; integridade de
   domínio (OS, solicitações, check-in, planos, metrologia); estoque/Store/orçamento/dinheiro; indicadores/metas/
   relatórios/automações; segurança/workers/pool/arquivos/segredos/dependências; frontends/offline.
3. **Toda conclusão foi conferida no código antes de virar correção.** Achado que não se confirmou está marcado
   (ex.: o "índice de cronômetro aberto inexistente" existia — PF-35).
4. **Correções por frente, com dono de arquivo** (sem dois escritores no mesmo arquivo), cada uma com teste adversarial.
5. **Suíte em shards** (a suíte inteira estoura a memória desta máquina): domain, db, api (em lotes), workers, interface.
   PostgreSQL 16 real, RLS sob papel `NOBYPASSRLS` e Playwright rodam **no CI** (Docker indisponível nesta máquina).

---

## 2 · Legenda

Severidade: **P0** crítico · **P1** alto · **P2** médio · **P3** baixo · **INFO**.
Estado: **CORRIGIDO** (com teste) · **VALIDADO** (conferido, sem defeito) · **BLOQUEADO — CLIENTE / ESPECIALISTA /
INFRA** · **ACEITO / BY DESIGN** · **ABERTO — PRÓXIMA RODADA** (defeito real, P2/P3, não corrigido nesta rodada por
risco ou escopo — listado para não ficar escondido).

Commits: os achados corrigidos estão nos commits temáticos da branch (ver `git log` da PR). A coluna "Commit" usa o
tema: **acesso**, **auth**, **banco**, **estoque**, **os**, **campo**, **infra**, **indicadores**, **web**,
**apresentacao**.

---

## 3 · Acesso: RBAC, escopo e autenticação

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-01 | **P0** | `organization.manage_members` (GESTOR, Coordenador) concedia **qualquer** papel — inclusive Proprietário e Administrador — no convite e em `PUT /memberships/:id/roles`. `escalationCheck` existia e ninguém chamava. O teste que deveria pegar chamava rota inexistente e passava no 404. | `memberships.ts` (inviteMember), `roles.ts` (setMemberRoles), `permissions.ts` | `assertCanGrantRoles` (lê `role_permissions`, cobre papel próprio) + `administrativeEscalationCheck`: quem concede ou **retira** papel precisa ter toda permissão **administrativa** (`organization.*` exceto leitura) dele. Delegar trabalho operacional (Operador, Solicitante) continua com quem gerencia pessoas — é o fluxo desenhado. Exceção pontual `grant` exige a própria chave. | `pente-fino-acesso` (escalada owner/admin → 403; operador/solicitante → 201; retirar admin → 403; override → 403), `api-usuarios-perfis` (teste falso-positivo corrigido), `permissions.test` | acesso | CORRIGIDO |
| PF-02 | P1 | `ScopeGuard` contornável: comparava `originalUrl` cru, sensível a caixa e sem decodificar; o Express 5 roteia sem caixa e decodifica. `/v1/Work-Orders/<id>` ou `%30…` liam/escreviam OS, solicitação, ativo e orçamento de outro cliente. | `common/scope.guard.ts` | `normalizarCaminho` (decodifica por segmento, minúsculas, colapsa `//`; codificação malformada de usuário restrito → 404) e regras com `i`. | `pente-fino-acesso` (maiúsculas, `%XX`, `//`, controles positivos 200) | acesso | CORRIGIDO |
| PF-03 | P1 | Rotas internas sem escopo de cliente/setor, alcançáveis por SOLICITANTE ou GESTOR restrito: documentos (lista, detalhe, PDF, por ativo, versões, assinaturas), contratos, linha do tempo de auditoria (com campos financeiros crus), busca (documento, orçamento, pessoa), **lista de orçamentos e preço negociado**. | `documents.controller.ts`, `contracts.controller.ts`, `audit.controller.ts`, `search.ts`, `quotes.controller.ts` | Filtros de escopo nas consultas + regras no guard para `documents/:id`, `contracts/:id`, `opportunities/:id`, `measurement-sessions/:id`, `audit/timeline/:tipo/:id`. A linha do tempo remove campos financeiros/observação interna sem a permissão de campo. Documento sem cliente some para restrito (mesma regra do portal). | `pente-fino-acesso`, `pente-fino-orcamento` | acesso, estoque | CORRIGIDO |
| PF-04 | P1 | GESTOR ampliava o próprio escopo e o de outros além do seu (`PATCH members/:id/scope`). | `memberships.ts` (setMembershipScope) | Ninguém altera o próprio escopo; restrito não concede "todos" nem cliente/local fora do seu (também no convite). | `pente-fino-acesso` | acesso | CORRIGIDO |
| PF-05 | P1 | `AURORA_AUTH_PROVIDER` tem padrão `local` (entra **sem senha**). As travas dependiam de `NODE_ENV`/`AURORA_AMBIENTE`; um processo subido fora do Dockerfile sem as três variáveis, apontado para o banco conectado, aceitava `local:<sujeito>:<email>`. | `packages/config/src/env.ts` | Provedor `local` só é aceito com banco em `localhost`/`127.0.0.1`/`::1`; banco remoto exige `password`. Produção conectada não cai mais em provedor local em silêncio. | `env.test` | auth | CORRIGIDO |
| PF-06 | P2 | Bloqueio por conta **perpétuo**: depois do 10º erro, cada erro novo (inclusive o primeiro após vencer o bloqueio) fechava a conta por mais 15 min; a vítima nunca zerava o contador. | `0045` `registrar_tentativa_de_senha` | Migration **0073**: vencido o bloqueio, a contagem recomeça. | `credenciais.test` (sem bloqueio perpétuo) | auth | CORRIGIDO |
| PF-07 | P2 | `scryptSync` (~100 ms) no laço de eventos travava a API inteira a cada login; rajada paralela passava pelo limite por IP antes de a primeira falha contar. | `senha.ts`, `auth.controller.ts`, `attempt-limiter.ts` | `senhaConfere` assíncrona (pool do libuv); a tentativa conta **antes** da ida ao banco e é devolvida no acerto. | `senha.test`, `api-auth` | auth | CORRIGIDO |
| PF-08 | P3 | Enumeração de conta: mensagem própria de "conta bloqueada" (só existe para e-mail com conta) e resposta 1 ms mais rápida. | `auth.controller.ts`, `credenciais.ts` | Mensagem única; o caminho bloqueado também paga o `scrypt`. | `api-auth`, `credenciais.test` | auth | CORRIGIDO |
| PF-09 | P3 | IP da trilha de auditoria lido de `x-forwarded-for` cru (forjável). | `context.resolver.ts` | `req.ip` (respeita a lista de proxies confiáveis). | — (comportamento coberto por `api-auth`) | auth | CORRIGIDO |
| PF-10 | P3 | Lista de caminhos públicos não ancorada (`/v1/assets/health` pulava o contexto; hoje falhava fechado). | `context.middleware.ts` | Âncora no início. | `caminho-publico.test` | auth | CORRIGIDO |
| PF-11 | P2 | Escopo ausente em planos (tarefas, ciclos, materializar, dispensar), locais (criar com qualquer cliente, mover, arquivar), oportunidades e sessões de medição. | controllers correspondentes | Regras no guard + conferência de cliente/pai em criar/mover local. | `pente-fino-acesso` | acesso | CORRIGIDO |
| PF-12 | P2 | Papel OPERADOR herdava `asset.create`, contra a própria descrição ("não cadastra equipamentos"). | `permissions.ts` | Retirado do papel de fábrica; migration **0070** retira das organizações existentes (só papel `is_system`). | `pente-fino-acesso` (`POST /assets` → 403) | acesso | CORRIGIDO |
| PF-13 | P3 | Rotas do portal sem `@RequirePermissions` (qualquer membro abria solicitação). | `portal.controller.ts` | Permissões explícitas (Solicitante e Gestor do cliente já as têm). OpenAPI regenerado. | `api-portal*` | acesso | CORRIGIDO |
| PF-14 | P2 | `work_order.execute` é descrito como "só OS atribuída a mim", mas é tratado igual a `execute_any`: Operador executa qualquer OS do seu escopo. | `execucao-guiada.controller.ts`, `context.resolver.ts` (`assignmentScope` não usado) | **Não corrigido:** restringir pode travar a operação de equipe (OS atribuída a equipe, substituição de técnico). Precisa da regra do cliente. | — | — | BLOQUEADO — CLIENTE |
| PF-15 | P3 | `ALL_READ` inclui `audit.read`: GESTOR/Coordenador leem a trilha inteira da organização. | `permissions.ts` | Decisão de produto (o Gestor pode precisar da trilha). | — | — | BLOQUEADO — CLIENTE |
| PF-16 | P3 | `platform_list_tenants`/`is_platform_admin` confiam no `p_user_id` recebido (a API passa `ctx.actorId`; defesa em profundidade). | `0068` | Documentado; troca para `current_actor_id()` exige migration de função de plataforma — próxima rodada. | — | — | ABERTO — PRÓXIMA RODADA |
| PF-17 | P2 | `aurora_app` podia **apagar** `aurora.users` (global); o `CASCADE` de vínculo corre por fora da RLS — um defeito no tenant A apagaria vínculos da mesma pessoa no tenant B. | `0003` grants | Migration **0073**: `REVOKE DELETE ON aurora.users FROM aurora_app` (nenhum código da aplicação apaga pessoa). | suíte db/api (nenhuma regressão) | auth | CORRIGIDO |

**Validado sem defeito (Auth):** logout revoga no servidor; sessão 12 h ociosa / 30 dias absoluta; token 256 bits
guardado só como SHA-256; `timingSafeEqual`; usuário desativado e vínculo suspenso/bloqueado perdem acesso na próxima
requisição; `x-aurora-organization` só escolhe entre vínculos ativos (403 fora); sem cookie (Bearer) → sem CSRF;
erro 500 genérico sem pilha; admin global conferido no banco a cada chamada; **profissão não concede papel**
(`job_title` e registros são só dado).

---

## 4 · Banco: RLS, migrations e funções

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-18 | P1 | `db:migrate` e `admin:criar` não sincronizavam as **definições de catálogo** (só os seeds faziam). Desde a rodada de 16/10 o provisionamento semeia tipos de OS (`catalog_items` → FK em `catalog_definitions`): num banco preparado só com `db:migrate` + `admin:criar`, **criar a primeira organização ou um Novo Negócio falhava**; e a 0064 falhava sobre banco com organização e sem definições. | `tools/db/run.mjs`, `tools/admin/criar.mjs`, `provisioning.ts`, `0064` | `migrateAndSyncCatalogs` (`schema-sync.ts`): permissões e definições sincronizadas **antes** das migrations pendentes (se as tabelas existem) e **depois**. `db:migrate` usa; `admin:criar` sincroniza as duas. | `migrations-upgrade.test` (banco novo provisiona a 1ª organização; banco legado sem definições sobe) | banco | CORRIGIDO |
| PF-19 | P1 | Migrations de dado rodadas por papel **sem BYPASSRLS** (ex.: `aurora_owner`) enxergam zero linhas sob FORCE RLS e são registradas como aplicadas **sem efeito** (deriva irreversível). | `migrator.ts` | O migrator recusa, antes de tudo, papel sem `SUPERUSER`/`BYPASSRLS`, com o motivo. | `migrations-upgrade.test` | banco | CORRIGIDO |
| PF-20 | P2 | 0063/0064: se a organização tiver item **arquivado** com a mesma chave (`preventiva`) ou subcategoria com o nome da família, a família/tipo de sistema não é criada (o `ON CONFLICT DO NOTHING` engole). | `0064:59-66`, `0063:240-248` | Migrations aplicadas são imutáveis (checksum). Mitigação: o provisionamento em runtime cria o que falta. Correção estrutural (sufixo de chave + verificação final) fica para migration nova. | — | — | ABERTO — PRÓXIMA RODADA |
| PF-21 | INFO | Upgrade de banco **com dado** (0059 → 0073) nunca tinha sido testado. | — | Novo `migrations-upgrade.test.ts`: banco nasce na 0059 com dado legado (segmento de cliente a traduzir, família existente, situações sem "Negada", regra ativa, estoque) e recebe a rodada nova; confere tradução, idempotência e recusa de papel sem BYPASSRLS. | `migrations-upgrade.test` (3) | banco | VALIDADO |

**Validado sem defeito (RLS):** as 110 tabelas têm ENABLE + **FORCE** RLS, dono `aurora_owner` e política; nenhuma
política de escrita sem `WITH CHECK`; contexto `aurora.organization_id` transaction-local que falha fechado; todas as
tabelas novas de 0060–0073 com FK composta `(x, organization_id)`; nenhuma FK de tenant de coluna única; 16 funções
`SECURITY DEFINER` com `search_path` fixo e `EXECUTE` revogado de `PUBLIC`; `aurora_app` e papéis de serviço
`NOBYPASSRLS`, `NOSUPERUSER`, sem dono de objeto, sem `TRUNCATE/REFERENCES/TRIGGER`. Upgrade 0060–0069 sobre dado:
colunas `NOT NULL` novas têm `DEFAULT`; `CHECK`/únicos novos só sobre colunas novas.

**0069 (metas):** sobreposição barrada por gatilho com trava consultiva (correto em READ COMMITTED, o padrão);
precedência contrato → cliente → organização em `resolveTarget`; meta de contrato só vale no contexto daquele
contrato; contrato de outro cliente/organização barrado por gatilho, escopo de escrita, FK composta e RLS. **VALIDADO.**

**Migrations novas desta rodada (locais, NÃO aplicadas remotamente):**

| Migration | O quê |
| --- | --- |
| `0070_endurecimento_de_acesso.sql` | retira `asset.create` do Operador de fábrica |
| `0071_integridade_de_estoque_e_orcamento.sql` | `stock_reservations.quote_id` (+ FK composta, índice, vínculo do legado só quando inequívoco); estorno único (índice criado só se não houver duplicata — o razão é imutável e a implantação não trava); totais do orçamento congelados fora de rascunho |
| `0072_integridade_da_ordem_de_servico.sql` | OS só aceita local/ativo do próprio cliente; fechar cronômetro aberto é permitido em OS encerrada/cancelada |
| `0073_endurecimento_de_autenticacao.sql` | bloqueio por conta com teto real; `REVOKE DELETE` em `users` |

---

## 5 · Domínio: OS, solicitação, execução, estoque, orçamento

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-22 | P1 | **Dupla baixa de estoque:** orçamento aprovado reservava a peça; o técnico lançava a mesma peça em campo (nova reserva + consumo); o faturamento consumia a reserva do orçamento de novo. | `quotes.ts`, `inventory.controller.ts` | `consumeForWorkOrder`: o lançamento de campo consome primeiro a reserva aberta da OS (mesmo item/almoxarifado). Faturamento consome só as reservas **daquele** orçamento (`quote_id`). | `pente-fino-estoque` (aprova 2 → campo 2 → fatura → saldo cai 2) | estoque | CORRIGIDO |
| PF-23 | P1 | Transição de orçamento sem serialização: aprovação dupla (duplo clique no portal) → reserva dupla; aprovar × reprovar simultâneos. | `quotes.ts` (loadQuote/transitionQuote) | `FOR UPDATE` + `UPDATE … WHERE status = de`; perdedor recebe 409. | `pente-fino-estoque` (sequencial; concorrência real no CI PG16) | estoque | CORRIGIDO |
| PF-24 | P1 | Revisar orçamento aprovado deixava as reservas da versão anterior (v2 aprovada reservava de novo). | `quotes.ts` (reviseQuote) | Revisar aprovado libera as reservas daquele orçamento; revisar `in_execution` → 409. (Revisar aprovado é fluxo suportado — "O que foi aprovado continua como era".) | `pente-fino-estoque` | estoque | CORRIGIDO |
| PF-25 | P1 | Aprovação reservava (e o faturamento consumia) **estoque privado de outro cliente** (almoxarifado com `customer_id`, 0066). Ajuste, transferência, estorno, mínimos e peça de OS não conferiam visibilidade do almoxarifado; a sincronização de campo mandava saldo de todos. | `quotes.ts`, `inventory.controller.ts`, `field-sync.ts` | Só almoxarifado sem cliente ou do cliente do orçamento/OS; `assertWarehouseVisible` em toda escrita; campo recebe só almoxarifados visíveis. | `pente-fino-estoque`, `pente-fino-orcamento` | estoque | CORRIGIDO |
| PF-26 | P1 | Desconto, acréscimo e imposto mudavam **depois** de enviado/aprovado (o total aceito pelo cliente deixava de bater com a evidência). | `setQuoteDiscount`, `0032 fn_quote_guard` | 409 fora de rascunho + gatilho na 0071. Enviar só `additions` não zera mais o desconto. | `pente-fino-orcamento` | estoque | CORRIGIDO |
| PF-27 | P1 | `GET /inventory/ledger` devolvia `unit_cost` sem `inventory.read_costs` e sem conferir o almoxarifado. | `inventory.controller.ts` | Custo nulo sem a permissão; visibilidade conferida. | `pente-fino-estoque` | estoque | CORRIGIDO |
| PF-28 | P2 | Estorno duplo sob concorrência (confere-e-insere). | `inventory.ts` | Índice único parcial em `reverses_id` (0071) → 409. | `pente-fino-estoque` | estoque | CORRIGIDO |
| PF-29 | P2 | Orçamento de um cliente ligado à OS de outro (preço do contrato errado; aprovação retomava a OS errada); contato aprovador de outro cliente. | `createQuote` | 422. | `pente-fino-orcamento` | estoque | CORRIGIDO |
| PF-30 | P2 | `removeQuoteItem` apagava por id do item, ignorando o orçamento da URL (o guard confere o orçamento, não o item). | `quotes.ts` | `AND quote_id = $2`. | `pente-fino-orcamento` | estoque | CORRIGIDO |
| PF-31 | P2 | Reservar sem linha de saldo "funcionava" sem reservar nada. | `inventory.ts` (reserve) | 422 "não há saldo deste item neste almoxarifado". | `pente-fino-estoque` | estoque | CORRIGIDO |
| PF-32 | P2 | Multa e excedente de contrato calculados com float em reais + `toFixed(2)` (201 × 0,5 % dava 1,00 em vez de 1,01). | `domain/contracts.ts`, `db/contracts.ts`, `domain/checklists.ts` | `roundedMoneyProduct`: centavos inteiros, arredondamento meio-para-cima explícito. | `pente-fino-estoque-dinheiro` (8 casos de meio centavo) | estoque | CORRIGIDO |
| PF-33 | P3 | `money()` numérico arredondava 1,005 para baixo; quantidade com > 3 casas truncada no banco; valor grande demais → 500. | `quotes.controller.ts` | Meio-para-cima pela forma decimal; quantidade ≤ 3 casas e ≤ 9 dígitos; estouro → 422. | `pente-fino-orcamento` | estoque | CORRIGIDO |
| PF-34 | P2 | Peça lançada em campo **antes** da aprovação do orçamento: a aprovação reserva de novo e o faturamento baixa de novo. | `quotes.ts` | Precisa decidir se a peça já lançada "abate" o orçamento ou se o orçamento é sobre o que falta — regra de negócio. | — | — | BLOQUEADO — CLIENTE |
| PF-35 | P1 | **OS misturava clientes:** criar OS (manual ou da solicitação) aceitava ativo/setor de outro cliente; o contrato do outro cliente era carimbado na OS e o portal de A via o equipamento de B. Solicitação e ativo já tinham a guarda; a OS não. | `work-orders.ts`, migrations 0022/0031 | Migration **0072** (`fn_work_order_scope`, só quando cliente/local/ativo mudam) + conferência dos alvos da solicitação com mensagem clara. Seeds e fixtures conferidos: nenhum cria OS misturada. | `pente-fino-os` (db e api) | os | CORRIGIDO |
| PF-36 | P1 | Cronômetro órfão: OS negada/cancelada/encerrada com cronômetro aberto recusava o check-out, e o aberto bloqueava todo apontamento futuro da pessoa. (O índice "um aberto por pessoa" **existia** — o 2º check-in já era barrado, com erro ilegível.) | `0025` guarda, `execucao-guiada.ts` | 0072: fechar cronômetro é permitido em OS encerrada/cancelada; transição para cancelada/negada/encerrada fecha os abertos; 409 legível no 2º cronômetro; parar cronômetro de outra pessoa exige permissão. | `pente-fino-os` | os | CORRIGIDO |
| PF-37 | P2 | Transições "derivadas" da solicitação (`em atendimento`, `concluída`, `encerrada`, `cancelar aceita`) sem permissão: o Solicitante as forçava; cancelar aceita deixava OS órfãs. | `domain/service-requests.ts` | Exigem `service_request.accept`; cancelar aceita com OS viva → 409. | `pente-fino-os` | os | CORRIGIDO |
| PF-38 | P2 | Conversão dupla de solicitação e transições de OS sem trava (dois coordenadores aceitando juntos geravam dois conjuntos de OS). | `service-requests.ts`, `work-orders.ts` | `FOR UPDATE` + estado conferido no `UPDATE` → 409. | `pente-fino-os` (sequencial; concorrência real no CI) | os | CORRIGIDO |
| PF-39 | P2 | Checklist/medição editável depois de OS validada/encerrada/cancelada, sem motivo. | `execution.ts` | 409, salvo `work_order.edit_closed` com motivo de correção. (Motivo em toda revisão continua opcional — a 0047 o decidiu assim para não travar a fila offline.) | `pente-fino-os` | os | CORRIGIDO |
| PF-40 | P3 | Check-in/out fora da garantia de reenvio offline (reenvio do mesmo check-out → 409); precisão sem teto. | `execucao-guiada.ts` | `runFieldOperation` (mesmo `x-aurora-client-operation` devolve o resultado original); precisão 0–100 000 m. | `pente-fino-os` | os | CORRIGIDO |
| PF-41 | INFO | Parecer LIBERADO/PARADO **não** é exigido para concluir a OS. | `execucao-guiada.ts` | Nem o ROADMAP nem NOVAS-SOLICITACOES dizem que é obrigatório — não foi inventado. | — | — | BLOQUEADO — CLIENTE |

**Validado sem defeito:** saldo negativo impossível sob concorrência (gatilho com `FOR UPDATE`; saldo negativo só em
almoxarifado que o autoriza, com motivo); reserva nunca excede o físico; razão de estoque imutável; peça do cliente
em tabela própria, sem custo e sem movimento; **Store ≠ estoque interno** (catálogo sem saldo, sem custo, sem preço
negociado; autenticada, sem checkout/pagamento); dinheiro de orçamento em `bigint` centavos, sem float em coluna
nenhuma; checklist executado congela `template_id`/versão e versão publicada é imutável; **metrologia N0** sem
incerteza, TSE, tolerância ou aceitação automática inventadas, revisões só por acréscimo; QR público desligado por
padrão, com limite e só nome/categoria/setor; `domain` e `contracts` não importam outros pacotes; sem ciclo de import.
**Contrato (Básico/Completo/Expert) × modelo de relatório (Basic/Advanced/Expert):** nenhuma mistura semântica
encontrada — o tipo de contrato não é modelado (`contract_kind` é natureza: serviço completo, só preventiva…) e nada
mapeia contrato → modelo de relatório.

---

## 6 · Indicadores, metas, relatórios e automações

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-42 | P1 | A definição impressa nas conformidades dizia "realizados **no prazo**", mas a conta inclui o item feito com atraso — e "o atraso conta?" é exatamente a pergunta aberta P-06/P-07. O PDF decidia a pergunta ao contrário do código. | `relatorios.ts:320`, `report-tiers.ts:248` | Texto descreve o que a conta faz ("realizados ÷ (programados − dispensados)"), sem mudar a fórmula. | `api-relatorios` | indicadores | CORRIGIDO |
| PF-43 | P1 | Disponibilidade do parque: o **Painel** dividia por (operação + reserva + manutenção + emprestados) e o **relatório** pelo total cadastrado (com baixados e descartados). 90/10/50 dava 90 % numa tela e 60 % no PDF. | `relatorios.ts`, `painel/dados.ts` | Relatório usa a base do Painel. Continua PROVISIONAL (P-09). | `api-relatorios` (2 em operação, 1 manutenção, 1 descomissionado → 66,7 %, base 3) | indicadores | CORRIGIDO |
| PF-44 | P2 | Painel/TV mostravam MTTR e MTBF sem marca de provisório (P-01, P-02). | `painel.tsx`, `tv.tsx` | "Provisório" na dica (rótulos do E2E preservados) e no TV. | `apps/web` | indicadores | CORRIGIDO |
| PF-45 | P2 | "Preventivas vencidas"/"Preventivas em dia" somavam todos os tipos de plano (calibração, TSE, qualificação). | `painel.tsx`, `tv.tsx` | Rótulos "Itens de plano vencidos"/"Planos em dia". | `apps/web` | indicadores | CORRIGIDO |
| PF-46 | P2 | Regra com duas ações "criar tarefa" falhava em **toda** execução (unicidade regra + horário). | `0067`, `automations.ts` | Recusada ao salvar ("no máximo uma tarefa por execução"). | `automations.test` | indicadores | CORRIGIDO |
| PF-47 | P2 | Relatório agendado que não chegava a ninguém era registrado como sucesso. | `automations.ts` (enviarRelatorio) | Zero gerados com destinatários pulados → execução `failed` com o motivo. | suíte de automações | indicadores | CORRIGIDO |
| PF-48 | P3 | Setor de **outro cliente** (ou fora do escopo) aceito no relatório: os números ficavam no escopo, mas o nome ia para o cabeçalho. | `relatorios.ts` | 422 (outro cliente) / 404 (fora do escopo). | `api-relatorios` | indicadores | CORRIGIDO |
| PF-49 | P3 | Data impossível (`2026-02-30`) → 500. | `pg-errors.ts` | SQLSTATE 22007/22008 → 422. | `pool-resiliente.test` | indicadores | CORRIGIDO |
| PF-50 | P2 | Vínculo restrito a UM cliente, sem escolher cliente, é medido contra a meta da **organização**. | `relatorios.ts:372` | **Não alterado:** o comportamento atual está fixado em teste (`api-metas-indicadores` — "enxerga a meta da organização e a de A"). Mudar é decisão de regra. | — | — | BLOQUEADO — CLIENTE |
| PF-51 | P2 | Dia de referência da meta e períodos pré-definidos em UTC (31/10 21h30 em Brasília vira 01/11). | `indicator-targets.ts:56`, `rotulos.ts` | Exige fuso por organização em toda a cadeia de períodos — mudança transversal. | — | — | ABERTO — PRÓXIMA RODADA |
| PF-52 | P2 | Relatório mensal agendado = "slot − N dias", não o mês civil (pode usar a meta do mês seguinte). | `automations.ts:819` | Modo "mês civil anterior" é decisão de produto. | — | — | BLOQUEADO — CLIENTE |
| PF-53 | P2 | Filtro de categoria de equipamento ignorado em parque, evolução, OS em aberto e quadro de planos. | `painel.ts`, `relatorios.ts` | Próxima rodada (quatro consultas). | — | — | ABERTO — PRÓXIMA RODADA |
| PF-54 | P2 | Tela de relatório agendado não mostra PROVISIONAL nem "SEM META CONFIGURADA". | `automacoes/tarefas.tsx` | Próxima rodada (tela). | — | — | ABERTO — PRÓXIMA RODADA |
| PF-55 | P2 | Cores do Painel (SLA 90/75, disponibilidade 95/85) são limiares fixos, não as metas configuradas. | `painel.tsx`, `tv.tsx`, `planos/modulo.tsx` | Ligar o Painel a `indicator_targets` é trabalho de tela; não é meta em relatório (o relatório não tem meta fixa — VALIDADO). | — | — | ABERTO — PRÓXIMA RODADA |
| PF-56 | P2 | E-mail de automação ignora preferências de notificação (descadastro, e-mail bloqueado). Latente: não há transporte. | `automations.ts:753` | Entra junto com o transporte de e-mail. | — | — | BLOQUEADO — INFRA |

**Validado sem defeito:** nenhum indicador PENDING_DEFINITION entra em relatório (422 se pedido; sem ramo de cálculo);
PROVISIONAL só com pedido explícito e marcado na API e no PDF; nenhuma meta fixa em relatório; Advanced contém todo
indicador seguro do Basic; Expert tem lista explícita e não herda o Basic; nenhuma fórmula de MTTR/MTBF/TMPA/ICRS/
glosa apresentada como definitiva; agendador reivindica a ocorrência (`ON CONFLICT (rule_id, schedule_slot)`) antes de
qualquer efeito; **nenhum e-mail é simulado como enviado** (fica `pending`/`awaiting_email_transport`); Novo Negócio
conferido contra a tabela de admins de plataforma em toda chamada, provisionamento numa transação no contexto da nova
organização, marca guardada por organização.

Pendências do Anderson preservadas (nada inventado): **P-01** MTTR · **P-02** MTBF · **P-03** TMPA · **P-04** população
ICRS · **P-05** Global · **P-06** ACM (atraso conta?) · **P-07** IMP · **P-08** interno × externo · **P-09**
disponibilidade · **P-10** escopo Basic/agregação · **P-11** crítico · **P-12** formato de tempo · **P-13** competência
do IMR · **P-14** glosa/IMR · **P-15** qualidade/assiduidade · **P-16** obsolescência.

---

## 7 · Campo offline, portal, web e apresentação

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-57 | **P0** | **"Tentar de novo agora" apagava o comando recusado** (só destravava os seguintes). O texto do técnico sumia sem confirmação; foto recusada deixava a assinatura presa para sempre. O teste da fila afirmava o defeito. | `apps/field/src/fila.ts` (resolverAtencao) | A pendência guarda o comando original; tentar de novo reenfileira com o **mesmo id** (idempotência) e a posição original, à frente dos que esperavam. Itens antigos são reconstruídos. | `fila.test` (reenvio com mesmo id e ordem; item antigo) | campo | CORRIGIDO |
| PF-58 | **P0** | Sessão expirada (401) jogava **toda a fila** em "Atenção" — com PF-57, um toque apagava o dia de trabalho de quem ficou offline mais de 12 h. | `fila.ts`, `sincronizacao.ts` | 401 mantém o comando, não conta tentativa, pausa o envio e pede "Sessão expirada — entre de novo". | `fila.test`, `sincronizacao.test` | campo | CORRIGIDO |
| PF-59 | P1 | Gravação no IndexedDB confirmava **antes** do commit (`onsuccess`); sem espaço, o comando "gravado" não existia e o rascunho era apagado. | `armazenamento/indexeddb.ts` | Escrita resolve em `oncomplete`, rejeita em `onerror/onabort`; durabilidade estrita. | `indexeddb-consolidacao.test` | campo | CORRIGIDO |
| PF-60 | P1 | Fila e marca de sincronização sem dono: no aparelho compartilhado, o trabalho de A era enviado com o token de B; a sincronização incremental de B continuava com as OS de A (LGPD). | `fila.ts`, `campo.tsx` | Comando carimbado com organização + e-mail; de outra sessão fica na fila (não enviado, não apagado); troca de pessoa/organização limpa o dia baixado e força sincronização completa. Comando antigo sem carimbo = sessão atual. | `fila.test`, `sincronizacao.test` | campo | CORRIGIDO |
| PF-61 | P1 | Mudança de situação offline não refletia na OS local: "Concluir" nunca aparecia offline; tocar "Iniciar" de novo gerava duplicata (409 → Atenção). | `telas/ordem.tsx` | A tela usa a última mudança ainda na fila; mudança já enfileirada não é tocada de novo. | `fila.test` | campo | CORRIGIDO |
| PF-62 | P2 | "Já resolvi de outro jeito" deixava comandos bloqueados sem tela nenhuma. | `telas/atencao.tsx` | Lista dos bloqueados com "Soltar para enviar" e "Descartar" (com confirmação). | `fila.test` | campo | CORRIGIDO |
| PF-63 | P2 | Concorrência na fila: dois `enfileirar` recebiam o mesmo `seq`; `sincronizar` sem execução única. | `fila.ts`, `campo.tsx` | Enfileirar serializado; envio e sincronização uma de cada vez (`uma-por-vez.ts`). | `uma-por-vez.test`, `fila.test` | campo | CORRIGIDO |
| PF-64 | P3 | "Failed to fetch" cru; UUID/hash na tela de Atenção; armazenamento não persistente. | `telas/*` | Mensagens em português; ids técnicos ocultos; `navigator.storage.persist()`. | `sincronizacao.test` | campo | CORRIGIDO |
| PF-65 | P2 | Cronômetro do campo: só "iniciar", sem parar; horário do servidor no reenvio; o app de campo não tem check-in/out (está no assistente "Executar" da web). | `telas/ordem.tsx`, `execution.ts` | Feature incompleta, não defeito pontual: precisa de desenho (parar, horário do aparelho validado). | — | — | ABERTO — PRÓXIMA RODADA |
| PF-66 | P3 | Bytes de foto na fila ainda não são carimbados com a identidade (o servidor recusa com o token de outra pessoa; o aparelho não protege). | `apps/field/src/arquivos` | Próxima rodada. | — | — | ABERTO — PRÓXIMA RODADA |
| PF-67 | P2 | Portal mostrava erro de carga como "Nada aguardando você"/"Nenhum chamado aberto" e não tratava 401. | `portal/telas/inicio.tsx`, `equipamentos.tsx`, `app.tsx` | Estado de falha com "Tentar de novo"; 401 descarta a sessão e volta à entrada (igual à web). | `portal/inicio.test` | web | CORRIGIDO |
| PF-68 | P2 | Mesmo defeito nos quatro cartões do início da web. | `web/routes/hoje.tsx` | Mesmo estado de falha. | suíte web | web | CORRIGIDO |
| PF-69 | P2 | Enum cru na tela (`full_service`) na ficha do contrato. | `comercial/contratos.tsx:335` | Rótulo da natureza do contrato. | suíte web | web | CORRIGIDO |
| PF-70 | P2 | "Aurora Campo" como nome do app instalado (padrão do `capacitor.config.ts`) e no `aria-label` do ícone do PWA. | `capacitor.config.ts`, `public/icone.svg` | "Téchne Care Campo" (marca). | — | campo | CORRIGIDO |
| PF-71 | P2 | Orçamento gerado da OS em várias chamadas sem atomicidade (falha no meio deixa orçamento parcial; "Gerar" de novo cria outro) e sem invalidar a lista. | `ordens/orcamento-da-os.tsx` | Precisa de endpoint único (contrato novo). | — | — | ABERTO — PRÓXIMA RODADA |
| PF-72 | P3 | "Hoje" calculado em UTC em oito telas (após 21 h em Brasília vira amanhã). | `orcamentos.tsx:188` e outras | Junto com PF-51 (fuso). | — | — | ABERTO — PRÓXIMA RODADA |

**Validado sem defeito (frontends):** web, portal e campo não acessam banco/Supabase — tudo pela API; nenhum
`console.log`/`debugger` (só o `console.error` do error boundary); todo link aponta para rota existente; nenhum botão
sem ação (os sem `onClick` são gatilhos Radix); menu Ferramentas rotulado como vitrine; diálogos Radix com foco e Esc;
`prefers-reduced-motion` tratado globalmente; fila do campo grava antes de enviar, mantém o id em todas as tentativas,
espera crescente sem limite (8 h offline não perdem nada) e fotos em fatias retomáveis.

**Página pública de apresentação (complemento prioritário):** ver §7-A.

### 7-A · `/apresentacao`

- **Auditoria:** não existia página pública/institucional. Rotas públicas eram só `/entrar`, `/login` e `/organizacoes`.
- **Rota:** `/apresentacao` na aplicação web, fora da casca autenticada, sem `beforeLoad` de sessão, componente
  carregado sob demanda (chunk de 37,5 kB / 10,8 kB gzip). A raiz da aplicação **não** consulta `GET /v1/me/session`
  nessa rota — sem isso, o 401 mandaria a pessoa para `/entrar` no meio da apresentação.
- **Conteúdo:** as 10 seções pedidas. Capacidades conferidas contra o código e este documento: Store sem checkout,
  e-mail não enviado, modelos Basic/Advanced/Expert sem prometer PDF final, nenhuma fórmula pendente nem nome de
  indicador provisório, check-in como parte do assistente "Executar" da web, marca por organização descrita como "nome
  de exibição e cor registrados". "Ecossistema em evolução": Geolocalização e Simuladores **EM DESENVOLVIMENTO** (há ponto
  de partida no produto); temperatura/umidade, CME, gases medicinais, integrações com hardware e IA **FUTURO**; seção de
  IA marcada **ROADMAP**. Nenhum "Aurora", nenhum "clone".
- **Sem backend:** teste de componente confirma zero `fetch` (inclusive com a aplicação inteira montada na rota).
- **Deep link / refresh no Cloudflare Pages:** o build não tem `404.html` nem `_redirects` → o Pages devolve
  `index.html` para qualquer caminho (o E2E da demonstração já depende disso).
- **Validação:** `apresentacao.test` (8), servidor de demonstração no navegador sem chamadas `/v1` e sem erro de console,
  largura da página = largura da janela em 1440 e 375 px; E2E `e2e/specs/apresentacao.spec.ts` roda no CI.
- **Capturas:** `docs/relatorios/apresentacao/apresentacao-desktop.png`, `…-desktop-primeira-dobra.png`,
  `…-mobile.png`, `…-mobile-primeira-dobra.png`.
- **URL pública:** depois do merge, a demonstração ligada ao GitHub (`technecaremeds.pages.dev`) publica
  automaticamente: `https://technecaremeds.pages.dev/apresentacao`. O front de produção
  (`technecaremeds.voceconecta.com.br`) é por upload direto e **não** foi publicado (sem autorização de deploy).

---

## 8 · Infraestrutura, segurança e dependências

| ID | Sev. | Achado | Evidência | Correção | Teste | Commit | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PF-73 | P1 | `pg.Pool` da API e do worker **sem ouvinte de `error`**: queda de conexão ociosa (reinício do pooler, NAT, `pg_terminate_backend`) derrubava o processo inteiro. | `apps/api/src/main.ts`, `apps/workers/src/main.ts` | `protegerPool` (registra e segue) nos dois. | `pool-resiliente.test` (emitir `error` não lança) | infra | CORRIGIDO |
| PF-74 | P2 | Pool sem `connectionTimeoutMillis` (padrão: esperar para sempre) nem `idleTimeoutMillis`. | idem | `OPCOES_DE_POOL` (10 s / 30 s). `statement_timeout` **não** entra: iria como parâmetro de inicialização, que o pooler do Supabase em modo transação recusa. | `pool-resiliente.test` | infra | CORRIGIDO (parcial) |
| PF-75 | P2 | `statement_timeout`/`idle_in_transaction_session_timeout` no banco. | — | Configurar no papel do banco (`ALTER ROLE … SET`) quando o destino definitivo existir. | — | — | BLOQUEADO — INFRA |
| PF-76 | P3 | `ROLLBACK` que falha escondia o erro original e devolvia a conexão quebrada ao pool. | `adapters.ts` | Erro original preservado; `release(true)` descarta a conexão. | `pool-resiliente.test` | infra | CORRIGIDO |
| PF-77 | P2 | Publicador do outbox: 100 eventos esgotados ocupavam todo lote para sempre; nenhum evento novo saía. | `outbox.ts`, `outbox-publisher.ts` | Esgotados ficam fora do lote (continuam no outbox para inspeção). | `outbox-publisher.test` | infra | CORRIGIDO |
| PF-78 | P2 | `check-secrets` pulava `docs/`, só via `postgresql://` (não `postgres://`) e não tinha `github_pat_`. | `tools/ci/check-secrets.mjs` | `docs/` entra; os dois esquemas; PAT fino; senha de exemplo (`<…>`, `${…}`, `**`) não conta. | execução (811 arquivos, 0 achado) | infra | CORRIGIDO |
| PF-79 | P2 | Apps no Cloudflare Pages sem cabeçalhos de segurança (clickjacking; token em `localStorage`). | `apps/*/public` | `_headers` com `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS. **CSP fica fora:** a origem da API muda por implantação. | — (efeito só no Pages) | infra | CORRIGIDO (parcial) |
| PF-80 | P2 | CSP dos três apps. | — | Definir com o destino da API. | — | — | BLOQUEADO — INFRA |
| PF-81 | P2 | `npm audit --omit=dev`: 3 **críticas** — `proxy-addr` 2.0.7 (falsificação de IP via IPv4 mapeado em IPv6; afeta o limite por IP do login) e `@capacitor/android`/`ios` 8.5.0. | `package-lock.json` | `proxy-addr` 2.0.8 e Capacitor 8.5.2 (patch; publicados há > 2 semanas). Restam 3 **moderadas** (`multer` sem uso, `qs` com parser simples) — sem upgrade major. | `npm audit` | infra | CORRIGIDO |
| PF-82 | P3 | `GET /v1/search?limit=abc` → `LIMIT NaN` → 500. | `search.ts` | Limite inválido vira o padrão. | `search.test` | infra | CORRIGIDO |
| PF-83 | P3 | Arquivo-lixo versionado `null.lnk` (atalho do Windows, sem segredo). | raiz | Removido. | — | infra | CORRIGIDO |
| PF-84 | P3 | Fatias de upload conferem só a organização (técnico com o id de anexo de outra OS escreveria nele, sem `sha256` registrado); `contentMatchesDeclaredType` sem chamador (latente: nenhuma rota serve bytes hoje). | `field-upload.controller.ts`, `attachments.ts` | Próxima rodada, antes de qualquer rota de download de anexo. | — | — | ABERTO — PRÓXIMA RODADA |
| PF-85 | INFO | `lint`/`format:check`/`marca:check` falham **só no checkout Windows** (CRLF por `core.autocrlf`, pasta local `capturas/`). | — | Nada a corrigir no código; no CI passam. | CI Estático | — | ACEITO / BY DESIGN |

**Validado sem defeito:** contexto de tenant por job (`withTenant` com `SET LOCAL ROLE` + `set_config(…, true)`);
retentativa com espera, fila morta por fila, política exclusiva por organização, parada graciosa; outbox com `FOR
UPDATE SKIP LOCKED`; SQL sempre parametrizado (colunas dinâmicas de listas fechadas); caminho de arquivo montado no
servidor a partir de UUID, adaptador de disco recusa `..`/absoluto; limites de MIME e tamanho por finalidade; portal só
baixa documento liberado e no escopo; sem `dangerouslySetInnerHTML`/`eval`; sem `fetch` no servidor (sem SSRF); sem
redirecionamento aberto; CORS por lista explícita; nenhum segredo real versionado (senhas de banco são placeholders de
CI/local); uma versão só de `pg`, `zod` e `react`.

---

## 9 · Resumo executivo

| | |
| --- | --- |
| HEAD inicial | `511ec1f` |
| HEAD final | ver PR / `git log` da `main` após o merge (registrado em `docs/AI-HANDOFF.md`) |
| Achados | **P0: 3 encontrados / 3 corrigidos** (PF-01, PF-57, PF-58) · **P1: 20 / 20** · **P2: 42 / 28 corrigidos** (PF-74 e PF-79 parcialmente; os 14 restantes estão como BLOQUEADO — CLIENTE/INFRA ou ABERTO, com motivo) · **P3: 17 / 12 corrigidos** · INFO: 3 |
| Migrations | 0000–0073 (74). Novas, **locais**: 0070–0073. Upgrade 0059 → 0073 sobre dado: PASS (PGlite). Do zero no PostgreSQL 16: CI |
| Migration remota | **NÃO EXECUTADA** |
| Backend deploy remoto | **NÃO EXECUTADO** |

Contagens de teste, CI da PR e CI da `main`: §10.

**Pendências Anderson (cliente):** P-01, P-02, P-03, P-04, P-05, P-06, P-07, P-08, P-09, P-10, P-11, P-12, P-13, P-14,
P-15, P-16 · regras de negócio desta rodada: PF-14 (executar só OS atribuída?), PF-15 (Gestor lê auditoria?),
PF-34 (peça lançada antes do orçamento), PF-41 (parecer obrigatório?), PF-50 (meta do cliente único), PF-52 (relatório
mensal = mês civil?).
**Pendências especialista:** fórmulas metrológicas, incerteza, TSE, tolerância e aceitação (inalterado — nada inventado).
**Pendências infra:** transporte de e-mail (fila sem envio, PF-56); `statement_timeout` no papel do banco (PF-75); CSP
(PF-80); destino definitivo de banco/API; aplicação das migrations 0060–0073 no banco remoto.

---

## 10 · Evidência de testes

### 10.1 Local (PGlite, em shards — a suíte inteira de uma vez estoura a memória desta máquina)

| Shard | Arquivos | Testes | Pulados | Falhas |
| --- | --- | --- | --- | --- |
| domain + contracts + config + events + tools | 31 | 619 | 0 | 0 |
| db | 35 | 697 | 27 (só com PostgreSQL real) | 0 |
| api (6 lotes de 9 arquivos) | 54 | 815 | 0 | 0 |
| workers | 3 | 30 | 5 (só com PostgreSQL real) | 0 |
| interface (ui, app-kit, web, portal, field) | 15 | 154 | 0 | 0 |
| **Total** | **138** | **2 315** | **32** | **0** |

Os 32 pulados são as suítes que exigem `AURORA_TEST_PG_URL` — rodam no job "Testes contra PostgreSQL 16" do CI.
Gates locais: typecheck ✅ · OpenAPI ✅ · segredos ✅ · SPEC ✅ · ESLint ✅ (fora a pasta local ignorada `capturas/`)
· Prettier ✅ nos arquivos alterados (`--end-of-line auto`, por causa do CRLF do checkout Windows).

### 10.2 CI

PR [#27](https://github.com/voceconectadigital/technecaremeds/pull/27), run `39006955970` (commit `9a6db9e`):

| Check | Resultado |
| --- | --- |
| Estático (SPEC, typecheck, lint, formatação, OpenAPI, marca, segredos) | ✅ |
| Testes contra PostgreSQL 16 | ✅ migrations **0000–0073 do zero (74 aplicadas)** · **139 arquivos, 2 357 testes, 0 pulados, 0 falhas** (RLS sob papel sem BYPASSRLS) |
| Ponta a ponta (Playwright) | ✅ **209 passaram**, 1 pulado (condicional pré-existente em `fluxo.spec.ts:203`, "estado de espera não disponível"), 0 falhas — inclui `apresentacao.spec` |
| Cloudflare Pages | ✅ |

A primeira execução do PR falhou em dois pontos, ambos corrigidos no commit `9a6db9e`: formatação de um teste novo e o
E2E da apresentação contando "EM DESENVOLVIMENTO" também na frase de abertura (`getByText` sem `exact`).
O CI da `main` depois do merge é conferido e registrado no relatório entregue ao final da rodada.
