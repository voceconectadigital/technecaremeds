# Roadmap — reunião com Anderson de 16/10/2026

Controle da rodada. **Este arquivo acompanha a rodada inteira**: cada item nasce
`PENDENTE`, e só vira `IMPLEMENTADO`/`VALIDADO` com commit e teste registrados.
O estado real do produto continua sendo `docs/AI-HANDOFF.md`; o histórico de
pedidos, `docs/NOVAS-SOLICITACOES.md`.

**HEAD inicial:** `5207188` (main) · **Na main:** `27a5e8c` (PR #22 + #23, CI verde, run 38994905170) — fases 1–12 **VALIDADAS NA MAIN**; Fase 9 = **FUNDAÇÃO IMPLEMENTADA, REFINAMENTO AGUARDANDO PDFs**; Fase 13 **BLOQUEADA** · **CI verde do PR:** `ac20895` (run 38992481765) · **VALIDADO** = teste de API e/ou E2E passando no CI com PostgreSQL 16 real · **Migration mais recente na partida:** `0059` ·
**Próxima livre:** `0060` · Baseline: `npm run typecheck` verde.

Precedência em conflito: (1) decisão mais recente do cliente · (2) código/migrations
· (3) documentação anterior.

## Status e legenda

`PENDENTE` · `EM IMPLEMENTAÇÃO` · `IMPLEMENTADO` · `VALIDADO` ·
`BLOQUEADO — CLIENTE` · `BLOQUEADO — ESPECIALISTA` · `BLOQUEADO — INFRA` · `FUTURO`

Estado anterior: **JÁ EXISTE** / **PARCIAL** / **NOVO** (resultado da auditoria de
código da Fase 0, 16/10/2026). Colunas "arquivos", "migration", "testes" e
"commit" são preenchidas à medida que a fase fecha.

## Restrições do ambiente (afetam a evidência)

- Docker local não sobe: **PostgreSQL real e Playwright conectado só rodam no CI.**
  Localmente: vitest com PGlite (RLS real do PGlite) e typecheck/lint/openapi.
- Push/PR exigem o token da conta `voceconectadigital`.
- Deploy em produção: API → conferir `/v1/health/version` → front (memória do projeto).

## Achados da auditoria da Fase 0 que moldam a rodada

1. O recorte por cliente/setor (`membership_scopes`) **não vale** para OS,
   solicitações, agenda e execução do staff; em ativos falta em `GET /:id`,
   `timeline`, `transfer`, `decommission`, `labels`, `rotate-qr`.
2. Não existe papel OPERADOR; existem `requester` e `maintenance_manager`/`customer_manager`.
3. `suspendMembership` não revoga sessão (a recusa vem da resolução de vínculo a
   cada requisição, `find_memberships_for_email` filtra `active`); não existe
   BLOQUEADO nem reativar; convite não cria senha.
4. Organização nova (via `admin:criar`) não tem tipo de local `setor` nem categorias
   de equipamento — o cadastro de equipamento falha.
5. Bugs de UI existentes: chave `stockkeeper` (papel é `storekeeper`); "Pedir
   informação" sem `info_request`; recusa de orçamento sem `rejectionReasonId`;
   observação da recusa nunca enviada; rótulos de situação defasados.
6. Não existe: check-in/out, wizard de execução, curva ABC, estoque máximo, Store,
   "Gerar relatório", BASIC/ADVANCED/EXPERT, transporte de e-mail, criação de
   organização por API, admin global da plataforma, menu Ferramentas.

---

## Prioridades

P0: 1 Usuários/perfis · 2 Solicitações · 3 Equipamentos/setores · 4 OS + wizard +
check-in · 5 Planos/checklists · 6 Dashboard/relatórios principais · 7
Estoque/Store visível · 8 Ferramentas (apresentação) · 9 Ambiente publicado.
P1: orçamentos · automações · relatórios avançados · novo negócio.
P2/BLOQUEADOS: Expert (fórmulas) · hardware/geolocalizador · IA real · integrações.

---

## Fase 1 — Usuários, perfis e acesso escopado (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U-01 | Menu explícito **USUÁRIOS**; "Convidar" → "Adicionar usuário" | PARCIAL (tela "Pessoas") | VALIDADO | web `configuracoes/membros.tsx`, `shell/navigation.ts` | — | e2e `usuarios.spec` | 0fbe25e | |
| U-02 | Três perfis de negócio OPERADOR / SOLICITANTE / GESTOR sobre o RBAC existente (sem 2º sistema) | PARCIAL | VALIDADO | domain `profiles.ts`, `permissions.ts` (papéis operator/manager) | 0061 | `api-usuarios-perfis`, `profiles.test` | 0fbe25e | |
| U-03 | Profissão ≠ perfil de acesso (nenhum hardcode profissão→permissão) | PARCIAL (`job_title`) | VALIDADO | domain `profiles.ts` (profissão só sugestão de texto) | 0061 | `api-usuarios-perfis` | 0fbe25e | |
| U-04 | Cadastro: nome, CPF, profissão, registros profissionais (tipo + número, 0..N), e-mail, telefone, empresa, hospital/cliente, setor(es) | PARCIAL (CPF/empresa/registros N novos) | VALIDADO | db `memberships.ts`, contracts `members.ts` | 0061 | `api-usuarios-perfis`, e2e `usuarios.spec` | 0fbe25e | |
| U-05 | Restrição organização → cliente → setor(es) na UI | PARCIAL (API sim, UI não) | VALIDADO | web `membros.tsx` (cliente → setores) | — | e2e `usuarios.spec` | 0fbe25e | |
| U-06 | Escopo aplicado no **backend** em OS, solicitações, agenda, execução e ativos por id | PARCIAL (buracos) | VALIDADO | api `common/scope.guard.ts`, `scope-sql.ts` | — | `api-usuarios-perfis` (escopo OS/SR/agenda/ativo por id → 404) | 0fbe25e | |
| U-07 | ATIVO / SUSPENSO / BLOQUEADO, bloquear/desbloquear/suspender/reativar; sessão recusada/invalidada | PARCIAL | VALIDADO | db `setMembershipStatus`; rota `POST /members/:id/status` | 0060, 0061 | `api-usuarios-perfis` (suspenso/bloqueado recusados na requisição seguinte) | 0fbe25e | |
| U-08 | Solicitante sem acesso geral a cadastros/estoque/planos/checklists; Gestor ≠ superadmin | PARCIAL | VALIDADO | domain `permissions.ts` (gestor curado ≤ 70%) | 0061 | `permissions.test`, `api-usuarios-perfis` | 0fbe25e | |
| U-09 | Usuário adicionado consegue entrar (credencial inicial) | NOVO (convite não cria senha) | BLOQUEADO — INFRA | web `membros.tsx` (avisa que a senha é definida pela administração) | — | — | — | convite sem e-mail transacional; senha inicial só por `admin:criar` |
| U-10 | Bug `stockkeeper` → `storekeeper` na tela | PARCIAL | VALIDADO | web `membros.tsx` | — | `shell.test` | 0fbe25e | |
| U-11 | Testes: 3 perfis, cliente/setor, bloqueado, suspenso, cross-tenant, requester restrito, gestor, operador | PARCIAL | VALIDADO | — | — | `api-usuarios-perfis` (22 testes) | 0fbe25e | |

## Fase 2 — Clientes e setores (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Separar **EAS** × **Empresa corporativa** (+ subtipo: hospital, clínica, consultório, laboratório, imagem, home care, outros; corporativa: eng. clínica, assistência técnica, prestadora) | NOVO (`segment` texto livre) | VALIDADO | domain `customer-kinds.ts`; web `clientes/classificacao.tsx` | 0062 | `api-clientes-classificacao`, e2e `clientes.spec` | 12b3794 | |
| C-02 | Editar cliente (`PATCH /customers/:id`) | NOVO | VALIDADO | api `customers.controller` PATCH; web `editar-cliente.tsx` | 0062 | `api-clientes-classificacao` | 12b3794 | |
| C-03 | Setores comuns (UTI, Bloco Cirúrgico, PA, Enfermaria, Imaginologia) + "Novo setor" livre | JÁ EXISTE (NS-019) | VALIDADO | domain `COMMON_SECTORS` | — | `api-clientes-classificacao` | 12b3794 | |
| C-04 | Org nova nasce com tipo `setor` e escada de locais | NOVO | VALIDADO | db `provisioning.ts` (`provisionOrganizationBaseline`) | — | `api-clientes-classificacao`, `api-novo-negocio` | 12b3794 | |
| C-05 | Isolamento de setor entre tenants/clientes (testes) | PARCIAL | VALIDADO | — | — | `api-clientes-classificacao`, `tenant-isolation` | 12b3794 | |

## Fase 3 — Equipamentos (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Tipo/nome do equipamento ≠ categoria/família; catálogo de tipos | PARCIAL | VALIDADO | domain `asset-families.ts`; web `ativos/formulario.tsx` | 0063 | `api-equipamentos-catalogo`, e2e `equipamentos-catalogo.spec` | 38d13e3 | |
| E-02 | Cinco categorias: Suporte à vida, Diagnóstico, Terapia, Tratamento, Equipamentos de apoio (seed por org + provisionamento) | NOVO | VALIDADO | db `provisionAssetFamilies` | 0063 | `api-equipamentos-catalogo` | 38d13e3 | |
| E-03 | CRUD HTTP de categoria/modelo/fabricante | NOVO | VALIDADO | api `asset-catalog.controller.ts` | 0063 | `api-equipamentos-catalogo` | 38d13e3 | |
| E-04 | Campos: tipo, categoria, modelo, fabricante, criticidade, tag, série, patrimônio, cliente, setor | JÁ EXISTE | VALIDADO | web `ativos/formulario.tsx` | — | e2e `equipamentos-catalogo.spec` | 38d13e3 | |
| E-05 | QR: vincular QR existente, visualizar, (baixar/imprimir se seguro) — sem reconstruir engine | PARCIAL (sem imagem) | VALIDADO | api `qr.controller` `POST /assets/:id/qr`; web `ativos/ficha.tsx` | — | `api-equipamentos-catalogo` | 38d13e3 | |
| E-06 | Referência de **chip geolocalizador/tag** (cadastro/vínculo) + filtro por presença | NOVO | VALIDADO | assets `tracker_kind/tracker_tag` (cadastro/vínculo, sem hardware) | 0063 | `api-equipamentos-catalogo` | 38d13e3 | |
| E-07 | Filtros da lista (categoria, modelo, fabricante, criticidade, cliente, chip) | PARCIAL | VALIDADO | api `assets.controller` filtros; web `ativos/lista.tsx` | — | `api-equipamentos-catalogo` | 38d13e3 | |
| E-08 | Escopo em `GET /assets/:id`, timeline, transfer, decommission, labels, rotate-qr | PARCIAL | VALIDADO | api `scope.guard.ts` (`/assets/:id/*`) | — | `api-usuarios-perfis`, `api-assets` | 0fbe25e | |
| E-09 | Integração física de geolocalizador | NOVO | BLOQUEADO — INFRA | | | | | sem hardware/API definidos |

## Fase 4 — Solicitações (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Fluxo Cliente → Equipamento → Detalhes → Urgência (web e portal) | PARCIAL (web sem equipamento) | VALIDADO | web `solicitacoes/nova.tsx`; portal `abrir.tsx` | 0064 | `api-solicitacoes-fluxo`, e2e `solicitacoes-fluxo.spec` | 2f8e819 | |
| S-02 | Equipamento filtrado por cliente e por setores autorizados; **backend valida** escopo | PARCIAL | VALIDADO | api `common/alvo-da-solicitacao.ts` | — | `api-solicitacoes-fluxo` | 2f8e819 | |
| S-03 | Remover **Sintoma** da UX (preservar dado histórico) | JÁ EXISTE (só web) | VALIDADO | web `nova.tsx` (dado histórico preservado) | — | e2e `solicitacoes-fluxo.spec` | 2f8e819 | |
| S-04 | Tipos restritos: Corretiva, Preventiva, Instrução Técnica, Treinamento, Calibração, TSE, Qualificação | PARCIAL | VALIDADO | domain `request-types.ts` | 0064 | `api-solicitacoes-fluxo` | 2f8e819 | |
| S-05 | Solicitante não usa tipo livre para pedir mudança de equipamento; movimentação = operação específica com permissão própria | NOVO | VALIDADO | domain `request-types.ts` (movimentação não é tipo de manutenção) | 0064 | `api-solicitacoes-fluxo` | 2f8e819 | |
| S-06 | Bugs: "Pedir informação", observação da recusa, rótulos de situação | PARCIAL | VALIDADO | web `solicitacoes/ficha.tsx` | — | e2e `solicitacoes-fluxo.spec` | 2f8e819 | |

## Fase 5 — Ordem de serviço, wizard e check-in (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O-01 | Remover **RASCUNHO** (conceito visual/operacional) de solicitação e OS | PARCIAL | VALIDADO | domain `work-orders.ts`; api (sem rascunho) | 0065 | `api-execucao-guiada` | 7aa15c9 | |
| O-02 | **NEGADO** para solicitação/OS recusada (semântica, grafo) | NOVO (hoje `rejected`/`cancelled`) | VALIDADO | domain `denied` + transições | 0065 | `api-execucao-guiada` | 7aa15c9 | |
| O-03 | Fluxo: abertura, triagem, agendamento, análise, execução, aguardando aprovação de orçamento, orçamento aprovado, aguardando peças, concluído, negado | PARCIAL | VALIDADO | domain `FACTORY_STATUSES/TRANSITIONS`; web `AndamentoDaOs` | 0059, 0065 | `api-execucao-guiada`, `api-orcamento-da-os` | 7aa15c9, 32bd136 | |
| O-04 | Solicitante não vê "Assumir triagem" (e fecha a anomalia de transições abertas) | PARCIAL | VALIDADO | web `solicitacoes/ficha.tsx` (exige `service_request.triage`) | — | e2e `solicitacoes-fluxo.spec` | 2f8e819 | |
| O-05 | **▶ Executar** → wizard (Resumo, Check-in, Procedimento, Preencher OS, Anexos, Parecer, Revisão, Concluir) | NOVO | VALIDADO | web `ordens/executar.tsx` | — | e2e `execucao-guiada.spec` | 7aa15c9 | |
| O-06 | **Check-in** geográfico (lat/lng/precisão/usuário/OS/cliente/timestamp) + fallback com justificativa; **Check-out** simétrico (NS-016) | NOVO | VALIDADO | db `execucao-guiada.ts` (`work_order_visits`) | 0065 | `api-execucao-guiada`, e2e `execucao-guiada.spec` | 7aa15c9 | |
| O-07 | Seção **Preencher Ordem de Serviço** (pré-preenchida; descrição, observações, peças, origem) | NOVO | VALIDADO | db `updateServiceReport` | 0065 | `api-execucao-guiada` | 7aa15c9 | |
| O-08 | Origem da peça: estoque interno / da prestadora / do cliente (manual auditada); baixa vinculada à OS | PARCIAL | VALIDADO | db `addCustomerPart`; estoque `consume` | 0065 | `api-execucao-guiada` | 7aa15c9 | |
| O-09 | Foto antes/depois (reaproveita attachments) | JÁ EXISTE (campo) | VALIDADO | web `executar.tsx` (anexos antes/depois) | — | e2e `execucao-guiada.spec` | 7aa15c9 | |
| O-10 | Resultado operacional LIBERADO / PARADO (sem veredito metrológico) | NOVO | VALIDADO | WO `operational_result` released/stopped | 0065 | `api-execucao-guiada` | 7aa15c9 | |
| O-11 | Remover "Salvar rascunho" dos procedimentos, persistindo progresso com segurança | PARCIAL | VALIDADO | web `procedimentos.tsx` ("Salvar sem publicar") | — | e2e `execucao-guiada.spec` | 7aa15c9 | |
| O-12 | Aba **Conversa** fora do fluxo da OS (sem apagar histórico) | JÁ EXISTE | VALIDADO | web `ordens/ficha.tsx` (`?aba=conversa` antigo ainda abre) | — | e2e `ficha.spec`, `execucao-guiada.spec` | 7aa15c9 | |
| O-13 | E2E: solicitação → triagem → OS → play → check-in → checklist → OS → peças → fotos → parecer → conclusão | NOVO | VALIDADO | — | — | e2e `execucao-guiada.spec`, `jornada.spec` | 7aa15c9, 923974d | |
| O-14 | Mapa/reverse geocoding (Google Maps) | NOVO | BLOQUEADO — INFRA | | | | | sem chave de API |

## Fase 6 — Planos de manutenção e checklists (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | Visão geral com filtros combináveis tipo + cliente + setor (+ outros úteis) | PARCIAL (tipo só no cronograma) | VALIDADO | db `plan-board.ts` (filtro kind); web `planos/modulo.tsx` | — | `api-planos-executar` | 00ade81 | |
| P-02 | **▶ Executar** plano: cliente → plano → setor → equipamento → procedimento/checklist | NOVO | VALIDADO | `POST /maintenance-plans/cycle-items/:itemId/execute` | — | `api-planos-executar`, e2e `planos-executar.spec` | 00ade81 | |
| P-03 | Tipos de item no Field (multi-opção, data, foto) | PARCIAL | VALIDADO | field `ordem.tsx` (multi-opção, data, foto) | — | `api-planos-executar` | 00ade81 | |
| P-04 | OS do plano traz procedimento + checklist da versão correta | JÁ EXISTE (P1.4) | VALIDADO | (já existia; conferido) | — | `api-planos-executar` | 00ade81 | |
| P-05 | Gráficos de conformidade por plano/cliente/setor/período/procedimento (dado real) | PARCIAL | VALIDADO | db `plan-board.ts` (byPlan/byProcedure) | — | `api-planos-executar` | 00ade81 | |
| P-06 | Fórmulas, incerteza, limite TSE, arredondamento, decisão automática | NOVO | BLOQUEADO — ESPECIALISTA | | | | | aguardando fórmula do Anderson |

## Fase 7 — Orçamentos na OS (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 | Gerar orçamento a partir da OS (serviço, hora técnica, peças, totais; centavos) | PARCIAL (sem UI de criar) | VALIDADO | web `ordens/orcamento-da-os.tsx`; domain `centsFromDecimal` | — | `api-orcamento-da-os`, e2e `orcamento-da-os.spec` | 32bd136 | |
| Q-02 | AGUARDANDO APROVAÇÃO / APROVADO / REPROVADO refletidos na OS (sem estado redundante) | PARCIAL | VALIDADO | db `quotes.ts` (efeito na OS) | — | `api-orcamento-da-os` | 32bd136 | |
| Q-03 | Aprovar/reprovar por perfil autorizado com trilha; corrige "Recusar" | PARCIAL (bug) | VALIDADO | web `comercial/orcamento.tsx` (DialogoReprovar) | — | `api-orcamento-da-os` | 32bd136 | |

## Fase 8 — Estoque interno e Store (P0/P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Estoque interno por organização/cliente: entrada, saldo, mínimo, **máximo**, valor, movimentações | PARCIAL | VALIDADO | db `estoque-gestao.ts`; web `estoque/gestao.tsx` | 0066 | `api-estoque-store`, e2e `estoque-store.spec` | 957e2bd | |
| ST-02 | Saída **somente vinculada à OS** (sem baixa silenciosa) | JÁ EXISTE | VALIDADO | (já existia; conferido) | — | `api-estoque-store` | 957e2bd | |
| ST-03 | **Curva ABC** real (mês, semestre, ano, personalizado) com regra convencional documentada | NOVO | VALIDADO | db `abcCurve` (Pareto 80/95, ajustável) | — | `api-estoque-store` | 957e2bd | |
| ST-04 | Relatório por período | NOVO | VALIDADO | db `stockPeriodReport` | — | `api-estoque-store` | 957e2bd | |
| ST-05 | Cadastro de item/depósito por HTTP | NOVO | VALIDADO | api `estoque-gestao.controller.ts` | 0066 | `api-estoque-store` | 957e2bd | |
| ST-06 | Menu **STORE** separado: ver, consultar, solicitar proposta (sem checkout) | NOVO | VALIDADO | web `store/store.tsx`; db `storeItems/requestStoreQuote` | 0066 | `api-estoque-store`, e2e `estoque-store.spec` | 957e2bd | |
| ST-07 | Privacidade: saldo interno nunca visível a outro tenant | PARCIAL | VALIDADO | db `assertWarehouseVisible` | — | `api-estoque-store` | 957e2bd | |
| ST-08 | Aplicar `inventory.read_costs` (hoje não aplicada) | PARCIAL | VALIDADO | inventory balances (custo só com `read_costs`) | — | `api-estoque-store` | 957e2bd | |

## Fase 9 — Relatórios do Painel (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Botão **Gerar relatório** no Painel (métricas/widgets existentes, filtros período/cliente/setor/preventiva/tipo/categoria) | NOVO | VALIDADO | web `painel/relatorio.tsx` | — | `api-relatorios`, e2e `relatorios.spec` | 090bd84 | |
| R-02 | Fundação do nível **BASIC** (seleção de métricas reais: MTTR, MTBF, abertos, concluídos, conformidades). Layout/PDF final: AGUARDANDO MODELO PDF OFICIAL | NOVO | VALIDADO | domain `report-tiers.ts`; db `relatorios.ts` | — | `api-relatorios` | 090bd84, f2d58b5 | layout final: AGUARDANDO MODELO PDF OFICIAL |
| R-03 | Fundação do nível **ADVANCED** (+ SLA, evolução, backlog, OS por situação; obsolescência só com dado real). Layout/PDF final: AGUARDANDO MODELO PDF OFICIAL | NOVO | VALIDADO | domain `report-tiers.ts` | — | `api-relatorios` | 090bd84 | layout final: AGUARDANDO MODELO PDF OFICIAL |
| R-04 | Nível **EXPERT** — só a estrutura; indicadores não formalizados marcados AGUARDANDO MODELO PDF OFICIAL | NOVO | BLOQUEADO — CLIENTE | | | | | fórmulas FHEMIG não entregues |
| R-05 | Disponibilidade no tempo | PARCIAL (fotografia) | BLOQUEADO — CLIENTE | | | | | definição de "parado" |
| R-06 | PDF/engine de relatório (reutiliza escritor próprio) | PARCIAL | VALIDADO | api `reports.controller` (`?format=pdf`, escritor próprio) | — | `api-relatorios` | 090bd84 | PDF provisório com faixa |

> **Decisão do cliente (16/10/2026, mensagem posterior à reunião):** "Refinamento dos relatórios Basic / Advanced / Expert será realizado em rodada dedicada após análise dos PDFs oficiais fornecidos pelo cliente." Nesta rodada só a **fundação**: níveis, estrutura de geração, filtros, seleção de métricas, dados reais já disponíveis, arquitetura de PDF, permissões, UI e contratos. **Não** reproduzir layout final, fórmulas, gráficos inexistentes, composição de páginas nem indicadores Expert não formalizados. Onde faltar definição: `AGUARDANDO MODELO PDF OFICIAL`.

## Fase 10 — Automações (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Ação **Nova automação** (relatório agendado, lembrete, tarefa, 5W2H, PDCA) | PARCIAL (sem criar na UI) | VALIDADO | web `automacoes/nova.tsx`; domain `AUTOMATION_TEMPLATES` | 0067 | `api-automacoes-agendadas`, e2e `automacoes-agendadas.spec` | f2d58b5 | |
| A-02 | Scheduler do gatilho `schedule`, idempotência, logs, tenant | PARCIAL (não ligado) | VALIDADO | domain `automation-schedule.ts`; db `runScheduledAutomations`; worker `aurora.automations.schedule` | 0067 | `api-automacoes-agendadas`, `automation-schedule.test`, `jobs.test` | f2d58b5 | |
| A-03 | Destinatário, periodicidade, relatório, filtros, ativo/inativo | NOVO | VALIDADO | web `nova.tsx` (destinatários, periodicidade, modelo, cliente, ligar/desligar) | 0067 | `api-automacoes-agendadas` | f2d58b5 | |
| A-04 | Envio real por e-mail | NOVO | BLOQUEADO — INFRA | | | | | sem provider SMTP; fila/outbox só |
| A-05 | Tarefas no Kanban existente | PARCIAL | VALIDADO | tarefa operacional = ação `create_work_order` (quadro de OS existente); 5W2H/PDCA em `/tarefas` (lista, não Kanban paralelo) | 0067 | `api-automacoes-agendadas`, e2e `automacoes-agendadas.spec` | f2d58b5 | |

## Fase 11 — Novo negócio (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Provisionar organização/tenant (hospital/EAS ou prestadora) por API/tela, base única de código | PARCIAL (só CLI) | VALIDADO | db `tenants.ts`; api `platform/tenants.controller.ts`; web `configuracoes/negocios.tsx` | 0068 | `api-novo-negocio` | 7891ec7 | |
| T-02 | Admin global explícito da plataforma (única visão cross-tenant) | NOVO | VALIDADO | `aurora.platform_admins` (só DBA concede) + funções SECURITY DEFINER | 0068 | `api-novo-negocio`, e2e `novo-negocio.spec` | 7891ec7 | |
| T-03 | Branding por organização (nome, logo seguro, identidade permitida) | NOVO | VALIDADO | `organizations.settings.branding` (nome, cor, e-mail de suporte) em `/organizations/current` | 0068 | `api-novo-negocio` | 7891ec7 | logo e tema aplicado ao shell: não nesta rodada |
| T-04 | Domínio/subdomínio por organização | NOVO | BLOQUEADO — INFRA | | | | | DNS/domínio não controlado |
| T-05 | Testes adversariais com dois tenants (usuários, clientes, setores, ativos, OS, estoque, Store, orçamentos, relatórios, automações) | PARCIAL | VALIDADO | — | — | `api-novo-negocio` (2 tenants, cabeçalho forjado), `tenant-isolation`, testes A×B de cada fase | 7891ec7 | |
| T-06 | Limites/plano e nº de usuários ativos (sem preços, sem gateway) | PARCIAL | PENDENTE | `organizations.plan/seat_limit` já existem | — | — | — | sem decisão de plano; nada de preço |

## Fase 12 — Ferramentas (P0 em modo apresentação)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Menu **FERRAMENTAS** com Temperatura e Umidade, Geolocalização, Rastreabilidade CME, Gases Medicinais, Simuladores/Analisadores, Integrações de Eng. Clínica, IA — rotulado EM BREVE/FUTURO/INTEGRAÇÃO PLANEJADA, sem backend e sem dado fabricado | NOVO | VALIDADO | web `ferramentas/ferramentas.tsx`, `shell/navigation.ts` | — | `ferramentas.test`, e2e `ferramentas.spec` | c6c7d52 | |
| F-02 | Integrações reais N1–N4, hardware, IA real | NOVO | FUTURO | | | | | |

## Fase 13 — Produção (P0 ambiente estável)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Identificar inequivocamente o ambiente antes de qualquer ação remota | PARCIAL | VALIDADO | leitura: DNS, `/v1/health/version` (impressão `60dcde92fd08`, 15/10) | — | `docs/PRODUCAO-VERIFICACAO-2026-10-16.md` §1 | — | |
| I-02 | Domínio "htec.b" (não presumir; não comprar) | NOVO | BLOQUEADO — INFRA | — | — | `nslookup htec.b` sem registro | — | domínio inexistente/não controlado; não comprado |
| I-03 | HTTPS, PG privado, firewall, restart, logs, healthcheck | PARCIAL | BLOQUEADO — INFRA | HTTPS ✓, 5432/6432 fechados ✓, live/ready ✓ (verificado) | — | `PRODUCAO-VERIFICACAO` §2 | — | restart/logs/monitoramento no HostPanel não verificados |
| I-04 | Backup real de PostgreSQL/arquivos + restore test descartável | NOVO | BLOQUEADO — INFRA | — | — | — | — | nenhuma prova de backup/restore; não afirmado |
| I-05 | Publicar build validado, smoke remoto | PARCIAL | BLOQUEADO — CLIENTE | — | — | — | — | AGUARDANDO DEPLOY CONECTADO: sem deploy de backend nesta rodada (decisão de 16/10); migrations 0060–0068 não aplicadas em banco remoto; produção segue na versão de 15/10 |
| I-06 | VPS dedicada nos EUA | NOVO | FUTURO | | | | | fase posterior (decisão de 16/10); até lá o PostgreSQL remoto segue no Supabase Online; auth própria mantida |

## Fase final — Inspeção funcional, a11y, performance, gates

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Z-01 | Personas OPERADOR/SOLICITANTE/GESTOR/ADMIN GLOBAL DE TESTE e cenário ponta a ponta | NOVO | VALIDADO | personas em testes de API (`api-usuarios-perfis`: operador, solicitante, gestor; `api-novo-negocio`: admin global) | — | E2E: `jornada.spec` (coordenador, ponta a ponta), portal (solicitante), campo (técnico), `execucao-guiada.spec` | ac20895 (CI verde) | |
| Z-02 | Tenant A × B em todos os módulos | PARCIAL | VALIDADO | — | — | testes A×B em cada fase + `api-novo-negocio` (2 tenants) + `tenant-isolation`; E2E `automacoes-agendadas.spec` (A não vê B) | ac20895 | |
| Z-03 | Responsividade, a11y, performance | PARCIAL | PENDENTE | a11y (axe WCAG 2.1 AA) inclui as telas novas; viewports desktop/portal/campo; Ferramentas a 375 px | — | `acessibilidade.spec`, `viewports.spec`, `ferramentas.spec` | ac20895 | performance (`npm run bench`) não medida nesta rodada |
| Z-04 | Todos os gates (spec, typecheck, lint, marca, openapi, unit, PG real, RLS, RBAC, contratos, build, Playwright, portal, field, a11y, secret scan, format) | PARCIAL | VALIDADO | spec:audit, typecheck, lint, format, openapi:check, marca:check, segredos, unit, PG 16 real, Playwright (desktop/portal/campo), a11y | — | CI run 38992481765: Estático ✓ · PostgreSQL 16 ✓ · Ponta a ponta ✓ | ac20895 | |
| Z-05 | Atualizar AI-HANDOFF, NOVAS-SOLICITACOES e este roadmap | — | VALIDADO | `AI-HANDOFF.md`, `NOVAS-SOLICITACOES.md` (NS-021), este roadmap | — | — | (commit de docs) | |

---

## Não inventar (registro)

Fórmula FHEMIG · critério metrológico · integração com hardware · geolocalização por
chip real · IA real · e-mail sem provider · domínio inexistente · dados de produção ·
preços · regras não definidas pelo cliente.
