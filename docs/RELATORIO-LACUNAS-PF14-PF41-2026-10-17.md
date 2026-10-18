# Relatório — lacunas da rodada de pendências: PF-14, PF-41 e capturas da demo (17/10/2026)

> **Pedido:** fechar as lacunas de engenharia deixadas pela rodada de pendências
> (`docs/RELATORIO-RODADA-PENDENCIAS-2026-10-17.md` §6).
> **Branch:** `fix/lacunas-pf14-pf41-demo`, saindo da `main` `f68b66d` (merge da PR #30).
> **Remoto:** nenhuma migration nova, nenhuma migration aplicada, nenhum deploy. Só PR. O CI do GitHub ficou
> bloqueado por cobrança e foi reproduzido localmente, sem custo, com PostgreSQL 16 real (§6).
> **Fora do escopo, de propósito:** P-01…P-16 (fórmulas do Anderson) e critérios metrológicos. Nada foi inventado.

---

## 1 · Resumo

| Lacuna (§6) | Situação | O que mudou |
| --- | --- | --- |
| PF-14: peça da OS sem a regra de atribuição | **Fechada** | `POST /inventory/work-orders/:id/parts` chama `assertCanExecuteWorkOrder` |
| PF-14: sessão de medição sem a regra | **Fechada** | As 4 rotas de escrita da metrologia conferem a OS (`assertCanExecuteMeasurementSession`) |
| PF-14: sem API para a equipe da OS | **Fechada** | `PATCH /v1/work-orders/:id/team` (+ OS da equipe no pacote do campo) |
| PF-41: sem tela na web | **Fechada** | Configurações → **Organização** (`/configuracoes/organizacao`) |
| PF-41: sem campo no app de campo | **Fechada** | LIBERADO/PARADO na conclusão, enfileirado offline antes da transição |
| Demo: fatias à meia-noite UTC | **Fechada** | Captura no dia de Brasília e `capturas.json` regenerado sem banco remoto |

---

## 2 · PF-14 residual — quem lança peça e quem mede

### 2.1 Consumo de peça (`POST /v1/inventory/work-orders/:id/parts`)

A rota é guardada por `inventory.move`, e essa permissão é dada a dois perfis, por motivos diferentes:

- **Técnico/Operador**, que também tem `work_order.execute`. Para ele, lançar a peça que usou é **executar a OS**.
  Vale a mesma regra do check-in e da conclusão: só na OS atribuída a ele ou à equipe dele, salvo
  `work_order.execute_any`. Sem isso, um técnico baixaria peça na OS de outro e o custo iria para a OS errada.
- **Almoxarife/Gestor**, que não têm `work_order.execute`. Para eles, o lançamento é um movimento de estoque feito
  no balcão, em nome da OS. `executionRestrictedToAssignment` não os alcança, então **não são afetados**.

**Decisão sobre quem acumula os dois papéis:** as permissões se somam, então a pessoa é tratada como executora e
fica com a regra mais estreita. Para lançar no balcão em qualquer OS, ela precisa de `work_order.execute_any`, que é
como o coordenador já faz. A justificativa está no comentário da rota (`apps/api/src/inventory/inventory.controller.ts`).

A conferência roda **dentro** de `runFieldOperation`, na mesma transação do movimento. Assim, a recusa vale também
para o comando que chega pela fila do campo, e o reenvio devolve o mesmo 403 sem baixar o estoque.

### 2.2 Sessões de medição (`apps/api/src/metrology`)

Abrir sessão, registrar leitura, anexar dado bruto e encerrar já exigiam `work_order.execute`. Agora seguem também a
regra de atribuição:

- `POST /work-orders/:id/measurement-sessions` usa `assertCanExecuteWorkOrder(woId)`;
- `POST /measurement-sessions/:id/{measurements,raw-data,finish}` usa o novo `assertCanExecuteMeasurementSession`
  (`packages/db/src/execution.ts`). A OS é lida de `measurement_sessions.work_order_id` (0053), que é imutável.

Sessão inexistente continua dando 404, e não 403. O metrologista tem `execute_any` e mede em qualquer OS. As
leituras (GET) não mudaram.

### 2.3 Equipe da OS — `PATCH /v1/work-orders/:id/team`

**Avaliação.** Não existe `PATCH` genérico de OS. O responsável é definido pela transição (a aresta "atribuir") e
pela agenda. A coluna `work_orders.team_id` existia desde a 0021, já era lida pela agenda, pelos indicadores e pelo
PF-14, mas nenhuma rota a escrevia. Pôr a equipe dentro da transição a misturaria com a mudança de situação. Por isso
criei uma **rota própria, pequena e com contrato**:

| Regra | Resposta |
| --- | --- |
| Permissão `work_order.assign`, a mesma de atribuir o responsável | sem ela, 403 |
| OS fora do escopo de quem pede (`ScopeGuard` já cobre `/work-orders/:id/…`) | 404 |
| Equipe de outra organização (escondida pela RLS) | 404 |
| Equipe inativa, arquivada ou apagada | 422 em `team_id` |
| OS validada, fechada ou cancelada (o mesmo corte do relatório de serviço) | 409 |
| `version` diferente da atual | 409 com as duas versões |
| `team_id: null` | tira a equipe; o responsável individual não muda |
| Corpo fora do contrato (`.strict()`) | 422 |

- **`version`** é a da **situação**. O gatilho da 0022 só a incrementa em transição, e mantive assim: trocar a equipe
  não muda a versão. Isso evita que um coordenador arrastando o cartão ao mesmo tempo receba um conflito falso.
- **Auditoria:** o gatilho `work_orders_audit` registra `team_id` antes e depois. Não emiti evento de domínio:
  `work_order.assigned` avisa o **responsável**, e avisar a equipe inteira é uma decisão de produto que ninguém tomou.
- **Pacote do campo:** `/field/sync` passou a trazer também as OS da equipe da pessoa, dentro do escopo dela. Sem
  isso, quem é da equipe poderia executar a OS pela web e não pelo aparelho.

---

## 3 · PF-41 — a exigência do parecer, com tela e com campo

### 3.1 Web — Configurações → Organização

Configurações não tinha uma tela para regras da organização: existiam Usuários, Metas e Automações. Por isso o
interruptor não coube "numa tela existente". Criei a aba **Organização** no mesmo alternador
(`apps/web/src/features/configuracoes/organizacao.tsx`, rota `/configuracoes/organizacao`). Ela tem um cartão,
"Execução da OS", com o interruptor `role="switch"`:

- lê `GET /organizations/current` e grava em `PATCH /organizations/current/configuration`;
- só quem tem `organization.update` muda; os demais veem o estado e o motivo de não poderem mudar;
- na demonstração, a escrita é recusada ("Disponível na versão conectada") e o interruptor continua desligado
  (conferido no navegador).

### 3.2 App de campo — LIBERADO/PARADO na conclusão

- O **pacote do dia** traz `settings.require_operational_result`, sempre inteiro, inclusive na descida
  incremental, e `work_orders[].operational_result`. O aparelho guarda a regra em `meta/configuracao`. Ao trocar de
  organização ou de pessoa, a regra antiga é apagada antes de baixar a nova.
- Na tela da OS, acima dos botões de situação, aparece **"Parecer do equipamento"** sempre que há uma conclusão
  possível (categoria `review`). O campo diz se é obrigatório ou opcional. A escolha é rascunho, como a resolução, e
  sobrevive ao aplicativo ser fechado.
- Ao concluir, `planoDeConclusao` (`apps/field/src/parecer.ts`) decide:
  - com parecer escolhido, enfileira `PATCH /work-orders/:id/service-report` com `operational_result` **antes** da
    transição e no mesmo agregado. A fila manda em ordem, e o servidor encontra o parecer gravado quando o "concluir"
    chega;
  - com a exigência ligada e sem parecer em lugar nenhum (nem escolhido, nem gravado, nem na fila), **recusa no
    aparelho, na hora**, com a mensagem em `role="alert"`, e não enfileira nada. A recusa não vai mais parar na
    tela "Atenção" horas depois;
  - com a exigência desligada, o parecer é opcional e vai junto se tiver sido escolhido.

---

## 4 · Demonstração — capturas no dia de Brasília

**Causa.** `tools/demo/capturar.test.ts` pedia os períodos com `T00:00:00.000Z`. As fatias do Painel começavam às 21h
do dia anterior em Brasília, e o gráfico rotulava cada dia com a data de ontem.

**Correção.** A captura pede o período como a tela pede: meia-noite e último milissegundo de Brasília, com fuso fixo
−03:00, a mesma convenção da semeadura (sem horário de verão desde 2019). "Últimos 30 dias" passou a ser hoje e os 29
dias anteriores, igual a `intervaloDe('30d')`. A captura também passou a gravar `organizations.current`, para a aba
nova ter o que mostrar.

**Regenerado sem banco remoto.** `npm run demo:capturar` sobe a API em processo sobre um **PGlite em memória**. Nada
toca rede, Supabase ou banco remoto. Foram 446 respostas: as 445 anteriores mais `organizations.current`.

**Conferido no navegador** (`demo-web`, fuso America/Sao_Paulo, 17/10 às 23h20): o eixo do Painel vai de **18/09 a
17/10**. Antes ia de 16/09 a 16/10.

**Trava:** `apps/web/src/demo/__tests__/capturas-fuso.test.ts` falha se alguém regenerar as capturas com o período em
UTC. As contas usam `timeZone: 'America/Sao_Paulo'` explicitamente, então o teste vale em qualquer fuso.

**Observação, não corrigida (fora do escopo):** os `due_at` dos planos na demonstração ainda ficam à meia-noite UTC.
Eles vêm da âncora `2026-01-01T00:00:00Z` da semeadura, e não do período pedido. O agrupamento por mês da tela usa
`slice(0, 7)` e não é afetado. A data curta do item pode aparecer um dia antes em Brasília. Não verifiquei se o
mesmo acontece com dados reais.

---

## 5 · Testes adversariais

Cada regra foi provada pelo lado que recusa **e** pelo lado que passa.

| Suíte | Novos | O que prova |
| --- | --- | --- |
| `apps/api/src/__tests__/pente-fino-lacunas.test.ts` (nova) | 19 | **Peça:** operador não atribuído → 403 e nenhum movimento; responsável → 201; almoxarife → 201, inclusive em OS sem responsável; almoxarife + técnico → 403 na OS de outro e 201 na própria; da equipe mas fora do escopo → 404; reenvio pela fila → mesmo 403, estoque intacto. **Equipe:** técnico → 403 (`work_order.assign`); coordenador → 200, cabe no contrato, a ficha mostra a equipe e o responsável continua; membro passa a executar, e tirar a equipe tira o direito; equipe de outra organização → 404; inativa ou apagada → 422; OS cancelada → 409; versão velha → 409; corpo inválido → 422; coordenador de outro escopo → 404; trilha de auditoria com `team_id`. **Pacote:** o membro recebe a OS da equipe, quem está fora do escopo e quem não é da equipe não recebem; `settings` e `operational_result` descem e cabem no contrato, inclusive na descida incremental; parecer (PATCH) seguido de concluir, na ordem da fila, com a exigência ligada. |
| `apps/api/src/__tests__/api-metrologia.test.ts` | 1 | Operador não atribuído → 403 ao abrir sessão, registrar leitura, anexar dado bruto e encerrar, sem mudar nada; sessão inexistente → 404; o metrologista (`execute_any`) registra. |
| `apps/api/src/__tests__/api-estoque-store.test.ts` | — | O operador da suíte passou a ter a OS atribuída (efeito esperado do PF-14). |
| `apps/field/src/__tests__/parecer.test.ts` (nova) | 12 | Plano de conclusão nos 6 casos (recusa, escolhido, gravado/na fila, troca de ideia, desligado, destino que não é conclusão); valores aceitos; parecer na fila por OS; regra guardada pela sincronização, mantida quando o servidor é anterior e limpa ao trocar de organização. |
| `apps/web/src/demo/__tests__/capturas-fuso.test.ts` (nova) | 5 | Fatias à meia-noite de Brasília; 30 fatias; nenhum período de indicador ou estoque à meia-noite UTC; `organizations.current` capturado. |
| `e2e/specs/organizacao-parecer.spec.ts` (nova) | 2 | O interruptor liga, persiste ao recarregar e desliga, e volta a desligado mesmo se falhar no meio; a aba está no alternador. |

### Execução local (só testes direcionados, `--maxWorkers=1`)

| Lote | Arquivos | Testes | Falhas |
| --- | --- | --- | --- |
| lacunas + metrologia + campo (5 arquivos) | 7 | 120 | 0 |
| estoque-store, field-sync, orçamento, pente-fino-campo | 4 | 68 | 0 |
| paridade de contratos, inventory, documento-sessão, execution, OS, pente-fino-os, orçamento-da-OS | 7 | 100 | 0 |
| tenant-isolation, execução guiada, pente-fino-acesso, fundações, contracts | 5 | 93 | 0 |
| web (inclui demo) | 8 | 59 | 0 |

**Gates locais neste checkout:** typecheck ✅, `openapi:check` ✅ (274 rotas, 216 com contrato), `spec:audit` ✅,
segredos ✅, ESLint e Prettier nos arquivos alterados ✅. Os gates completos estão na §6.

O app de campo não tem modo de demonstração, então a tela nova do campo **não foi vista no navegador**. Ela está
coberta pelos testes de `parecer.ts` e pelo E2E `campo.spec.ts`, que roda só com PostgreSQL real (§6).

---

## 6 · CI — sem cobrança

PR [#31](https://github.com/voceconectadigital/technecaremeds/pull/31). Run do Actions: `39090329493` (commit
`f9f56b7`).

### 6.1 Por que o GitHub Actions não rodou

Os três jobs (Estático, Testes contra PostgreSQL 16 e Ponta a ponta) terminaram em 3 s sem executar nenhum passo. A
anotação do GitHub diz:

> *The job was not started because recent account payments have failed or your spending limit needs to be increased.*

O repositório é **privado**. Em repositório privado, os minutos de Actions vêm da cota da conta. Quando essa cota
acaba com limite de gasto zero, ou quando há um pagamento recusado, o GitHub não inicia o job. **Não consegui ver qual
dos dois casos é**: a leitura de cobrança exige o escopo `user` no token, e o token desta máquina não o tem. O check
do **Cloudflare Pages** não depende do Actions e **passou**.

Como você não quer pagar, **não mexi em cobrança, plano nem limite de gasto**. Em vez disso, rodei aqui, sem custo, o
mesmo que o CI roda.

### 6.2 O CI reproduzido localmente, sem custo

Usei um checkout temporário da branch (`7e9ec01`) com finais de linha **LF**, como o checkout Linux do CI. Neste
checkout Windows normal, com CRLF, o `format:check` e o `marca:check` acusam arquivos que não foram tocados.

**Job "Estático"** — os 7 passos do `ci.yml`, na mesma ordem:

| Passo | Resultado |
| --- | --- |
| `npm run spec:audit` | ✅ consistente, 0 erro |
| `npm run typecheck` | ✅ |
| `npm run lint` (repositório inteiro) | ✅ |
| `npm run format:check` (repositório inteiro) | ✅ |
| `npm run openapi:check` | ✅ em dia |
| `npm run marca:check` | ✅ em dia |
| `node tools/ci/check-secrets.mjs` | ✅ 874 arquivos, nenhum segredo |

**Job "Testes"** — a suíte inteira (`npm test`), em lotes com `--maxWorkers=1` porque de uma vez estoura a memória.
Roda sobre **PGlite**, não sobre o PostgreSQL 16 do CI:

| Lote | Arquivos | Aprovados | Pulados | Falhas |
| --- | --- | --- | --- | --- |
| domain + contracts + config + events | 34 | 641 | 0 | 0 |
| db (2 lotes) | 37 | 729 | 27 | 0 |
| api (8 lotes) | 59 | 875 | 0 | 0 |
| workers | 3 | 30 | 5 | 0 |
| interface (ui, app-kit, web, portal, field) | 20 | 196 | 0 | 0 |
| **Total** | **153** | **2 471** | **32** | **0** |

Os 32 pulados são os que só rodam com PostgreSQL real.

**"Ponta a ponta", parte sem banco** — `npm run demo:e2e`: o Playwright sobre o build da demonstração, em mesa e
celular. **22 aprovados**, 6 pulados de propósito (variações que só valem em uma das larguras), **0 falhas**.

**Cloudflare Pages** — ✅ no próprio PR.

### 6.3 Os dois jobs que precisam de PostgreSQL real — com o PostgreSQL 16 portátil

Com a sua autorização de 18/10, baixei o **PostgreSQL 16.15 portátil oficial**, gratuito, da EDB:

- arquivo: `postgresql-16.15-5-windows-x64-binaries.zip`, de `get.enterprisedb.com`, pelo link da página oficial
  "Download PostgreSQL Binaries";
- tamanho: 373 254 386 bytes, igual ao anunciado pelo servidor;
- SHA-256: `43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281`.

Os executáveis desse pacote não têm assinatura Authenticode; só o instalador da EDB é assinado. A procedência fica
pelo HTTPS do domínio oficial e pelo tamanho conferido. O pacote foi extraído na pasta temporária da sessão, fora do
repositório e do OneDrive. O servidor rodou só em `localhost:5432` e foi **desligado** no fim. Nada foi instalado no
sistema: nenhum serviço do Windows e nenhuma alteração de PATH.

Os dois jobs rodaram como no `ci.yml`: bancos novos, as mesmas URLs e as mesmas senhas de teste do CI, e
`npm run db:migrate` do zero. Usei um checkout LF temporário da branch (`1aa6f36`), **fora do OneDrive**, com o
`node_modules` copiado do checkout principal. Sem `node_modules` próprio, o Vite recusa servir a fonte (403), e o
vigia de console do E2E reprovaria todos os testes por esse motivo local.

**Job "Testes contra PostgreSQL 16"** — `npm run db:migrate` aplicou as **78 migrations do zero**. Depois rodei as
duas suítes que só existem com banco real (`AURORA_TEST_PG_URL`):

| Suíte | Testes | Resultado |
| --- | --- | --- |
| `packages/db/src/__tests__/real-postgres.test.ts` (RLS sob papel sem BYPASSRLS, pool, concorrência) | 27 | ✅ |
| `apps/workers/src/__tests__/jobs-real-postgres.test.ts` | 5 | ✅ |

Com isso, os **32 pulados** da §6.2 também passaram. O total da suíte fica em **2 503 de 2 503**.

**Job "Ponta a ponta"** — migrations no `aurora_e2e` e o papel `aurora_e2e_api` criado por
`tools/e2e/provision-role.mjs` (login sim, superuser não, BYPASSRLS não, conferido pelo script). Depois,
`npm run e2e` completo: API, web, portal e app de campo, 1 worker, **sem nova tentativa**. O CI tem 1.

| Resultado | Quantos |
| --- | --- |
| Aprovados | **210** de 212 |
| Pulado | 1 (`fluxo.spec.ts` "a transição que exige campo PEDE o campo", o pulo condicional que já existia) |
| Falha | 1 — intermitente, fora desta branch (abaixo) |

- **Os dois specs novos passaram:** `organizacao-parecer.spec.ts`, com o interruptor ligando, persistindo e
  desligando, e a aba no alternador.
- **`campo.spec.ts` passou inteiro**, inclusive "os vinte passos" sem rede, com a tela nova do parecer na OS.
- **A falha:** `comercial.spec.ts`, "a ficha mostra a versão atual e a linha do tempo das versões". O seletor
  `getByText('Versões')` também casa com o texto de leitor de tela "Carregando versões…" enquanto a lista ainda
  carrega. É uma **corrida no próprio teste**, num arquivo que esta branch não tocou. Rodei o arquivo de novo,
  isolado, **3 vezes: 12/12 aprovados**. No CI, a nova tentativa (`retries: 1`) absorveria. A correção é trocar
  para `getByRole('heading', { name: 'Versões' })`, e ficou como pendência (§7).

### 6.4 Placar final, sem custo

| Check do CI | Onde rodou | Resultado |
| --- | --- | --- |
| Estático | local, checkout LF | ✅ 7/7 |
| Testes contra PostgreSQL 16 | local: PGlite para a suíte e PostgreSQL 16.15 real para as 2 suítes de banco | ✅ 2 503/2 503 |
| Ponta a ponta | local, PostgreSQL 16.15 real | ✅ 210 aprovados, 1 pulo condicional; 1 intermitente fora da branch, que passa isolado |
| Cloudflare Pages | GitHub (externo ao Actions) | ✅ |

O **GitHub Actions continua bloqueado por cobrança**, então o PR não mostra os três checks verdes. A validação está
neste relatório. **Não paguei nada, não mudei plano nem limite de gasto e não tornei o repositório público.**

Para repetir sem custo nas próximas rodadas, o caminho é este mesmo: o PostgreSQL portátil mais os comandos acima.
O pacote ficou na pasta temporária desta sessão. Se quiser reusá-lo, ele pode ser movido para um lugar fixo, por
exemplo `C:\tools\pgsql16`.

## 7 · O que continua aberto

- **Tela para definir a equipe da OS na web.** A API existe e está testada, mas a ficha da OS ainda não tem o
  seletor. Hoje só se define a equipe pela API.
- **Equipe nova no aparelho:** quem **entra** numa equipe recebe as OS dela na próxima descida completa, ou quando a
  OS mudar. O corte incremental é por `updated_at` da OS, e entrar numa equipe não altera OS nenhuma.
- **`due_at` dos planos na demo** à meia-noite UTC (§4).
- **Teste intermitente** `e2e/specs/comercial.spec.ts:105` — `getByText('Versões')` → `getByRole('heading', { name: 'Versões' })` (§6.3).
- Continua fora da engenharia, sem mudança: P-01…P-16, critérios metrológicos, migrations 0060–0077 no banco remoto,
  deploy do backend, transporte de e-mail e CSP em modo de bloqueio.
