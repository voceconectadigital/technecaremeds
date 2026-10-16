# Roadmap — reunião com Anderson de 16/10/2026

Controle da rodada. **Este arquivo acompanha a rodada inteira**: cada item nasce
`PENDENTE`, e só vira `IMPLEMENTADO`/`VALIDADO` com commit e teste registrados.
O estado real do produto continua sendo `docs/AI-HANDOFF.md`; o histórico de
pedidos, `docs/NOVAS-SOLICITACOES.md`.

**HEAD inicial:** `5207188` (main) · **Migration mais recente na partida:** `0059` ·
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
| U-01 | Menu explícito **USUÁRIOS**; "Convidar" → "Adicionar usuário" | PARCIAL (tela "Pessoas") | PENDENTE | | | | | |
| U-02 | Três perfis de negócio OPERADOR / SOLICITANTE / GESTOR sobre o RBAC existente (sem 2º sistema) | PARCIAL | PENDENTE | | | | | |
| U-03 | Profissão ≠ perfil de acesso (nenhum hardcode profissão→permissão) | PARCIAL (`job_title`) | PENDENTE | | | | | |
| U-04 | Cadastro: nome, CPF, profissão, registros profissionais (tipo + número, 0..N), e-mail, telefone, empresa, hospital/cliente, setor(es) | PARCIAL (CPF/empresa/registros N novos) | PENDENTE | | | | | |
| U-05 | Restrição organização → cliente → setor(es) na UI | PARCIAL (API sim, UI não) | PENDENTE | | | | | |
| U-06 | Escopo aplicado no **backend** em OS, solicitações, agenda, execução e ativos por id | PARCIAL (buracos) | PENDENTE | | | | | |
| U-07 | ATIVO / SUSPENSO / BLOQUEADO, bloquear/desbloquear/suspender/reativar; sessão recusada/invalidada | PARCIAL | PENDENTE | | | | | |
| U-08 | Solicitante sem acesso geral a cadastros/estoque/planos/checklists; Gestor ≠ superadmin | PARCIAL | PENDENTE | | | | | |
| U-09 | Usuário adicionado consegue entrar (credencial inicial) | NOVO (convite não cria senha) | PENDENTE | | | | | |
| U-10 | Bug `stockkeeper` → `storekeeper` na tela | PARCIAL | PENDENTE | | | | | |
| U-11 | Testes: 3 perfis, cliente/setor, bloqueado, suspenso, cross-tenant, requester restrito, gestor, operador | PARCIAL | PENDENTE | | | | | |

## Fase 2 — Clientes e setores (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Separar **EAS** × **Empresa corporativa** (+ subtipo: hospital, clínica, consultório, laboratório, imagem, home care, outros; corporativa: eng. clínica, assistência técnica, prestadora) | NOVO (`segment` texto livre) | PENDENTE | | | | | |
| C-02 | Editar cliente (`PATCH /customers/:id`) | NOVO | PENDENTE | | | | | |
| C-03 | Setores comuns (UTI, Bloco Cirúrgico, PA, Enfermaria, Imaginologia) + "Novo setor" livre | JÁ EXISTE (NS-019) | PENDENTE | | | | | |
| C-04 | Org nova nasce com tipo `setor` e escada de locais | NOVO | PENDENTE | | | | | |
| C-05 | Isolamento de setor entre tenants/clientes (testes) | PARCIAL | PENDENTE | | | | | |

## Fase 3 — Equipamentos (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Tipo/nome do equipamento ≠ categoria/família; catálogo de tipos | PARCIAL | PENDENTE | | | | | |
| E-02 | Cinco categorias: Suporte à vida, Diagnóstico, Terapia, Tratamento, Equipamentos de apoio (seed por org + provisionamento) | NOVO | PENDENTE | | | | | |
| E-03 | CRUD HTTP de categoria/modelo/fabricante | NOVO | PENDENTE | | | | | |
| E-04 | Campos: tipo, categoria, modelo, fabricante, criticidade, tag, série, patrimônio, cliente, setor | JÁ EXISTE | PENDENTE | | | | | |
| E-05 | QR: vincular QR existente, visualizar, (baixar/imprimir se seguro) — sem reconstruir engine | PARCIAL (sem imagem) | PENDENTE | | | | | |
| E-06 | Referência de **chip geolocalizador/tag** (cadastro/vínculo) + filtro por presença | NOVO | PENDENTE | | | | | |
| E-07 | Filtros da lista (categoria, modelo, fabricante, criticidade, cliente, chip) | PARCIAL | PENDENTE | | | | | |
| E-08 | Escopo em `GET /assets/:id`, timeline, transfer, decommission, labels, rotate-qr | PARCIAL | PENDENTE | | | | | |
| E-09 | Integração física de geolocalizador | NOVO | BLOQUEADO — INFRA | | | | | sem hardware/API definidos |

## Fase 4 — Solicitações (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Fluxo Cliente → Equipamento → Detalhes → Urgência (web e portal) | PARCIAL (web sem equipamento) | PENDENTE | | | | | |
| S-02 | Equipamento filtrado por cliente e por setores autorizados; **backend valida** escopo | PARCIAL | PENDENTE | | | | | |
| S-03 | Remover **Sintoma** da UX (preservar dado histórico) | JÁ EXISTE (só web) | PENDENTE | | | | | |
| S-04 | Tipos restritos: Corretiva, Preventiva, Instrução Técnica, Treinamento, Calibração, TSE, Qualificação | PARCIAL | PENDENTE | | | | | |
| S-05 | Solicitante não usa tipo livre para pedir mudança de equipamento; movimentação = operação específica com permissão própria | NOVO | PENDENTE | | | | | |
| S-06 | Bugs: "Pedir informação", observação da recusa, rótulos de situação | PARCIAL | PENDENTE | | | | | |

## Fase 5 — Ordem de serviço, wizard e check-in (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O-01 | Remover **RASCUNHO** (conceito visual/operacional) de solicitação e OS | PARCIAL | PENDENTE | | | | | |
| O-02 | **NEGADO** para solicitação/OS recusada (semântica, grafo) | NOVO (hoje `rejected`/`cancelled`) | PENDENTE | | | | | |
| O-03 | Fluxo: abertura, triagem, agendamento, análise, execução, aguardando aprovação de orçamento, orçamento aprovado, aguardando peças, concluído, negado | PARCIAL | PENDENTE | | | | | |
| O-04 | Solicitante não vê "Assumir triagem" (e fecha a anomalia de transições abertas) | PARCIAL | PENDENTE | | | | | |
| O-05 | **▶ Executar** → wizard (Resumo, Check-in, Procedimento, Preencher OS, Anexos, Parecer, Revisão, Concluir) | NOVO | PENDENTE | | | | | |
| O-06 | **Check-in** geográfico (lat/lng/precisão/usuário/OS/cliente/timestamp) + fallback com justificativa; **Check-out** simétrico (NS-016) | NOVO | PENDENTE | | | | | |
| O-07 | Seção **Preencher Ordem de Serviço** (pré-preenchida; descrição, observações, peças, origem) | NOVO | PENDENTE | | | | | |
| O-08 | Origem da peça: estoque interno / da prestadora / do cliente (manual auditada); baixa vinculada à OS | PARCIAL | PENDENTE | | | | | |
| O-09 | Foto antes/depois (reaproveita attachments) | JÁ EXISTE (campo) | PENDENTE | | | | | |
| O-10 | Resultado operacional LIBERADO / PARADO (sem veredito metrológico) | NOVO | PENDENTE | | | | | |
| O-11 | Remover "Salvar rascunho" dos procedimentos, persistindo progresso com segurança | PARCIAL | PENDENTE | | | | | |
| O-12 | Aba **Conversa** fora do fluxo da OS (sem apagar histórico) | JÁ EXISTE | PENDENTE | | | | | |
| O-13 | E2E: solicitação → triagem → OS → play → check-in → checklist → OS → peças → fotos → parecer → conclusão | NOVO | PENDENTE | | | | | |
| O-14 | Mapa/reverse geocoding (Google Maps) | NOVO | BLOQUEADO — INFRA | | | | | sem chave de API |

## Fase 6 — Planos de manutenção e checklists (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | Visão geral com filtros combináveis tipo + cliente + setor (+ outros úteis) | PARCIAL (tipo só no cronograma) | PENDENTE | | | | | |
| P-02 | **▶ Executar** plano: cliente → plano → setor → equipamento → procedimento/checklist | NOVO | PENDENTE | | | | | |
| P-03 | Tipos de item no Field (multi-opção, data, foto) | PARCIAL | PENDENTE | | | | | |
| P-04 | OS do plano traz procedimento + checklist da versão correta | JÁ EXISTE (P1.4) | PENDENTE | | | | | |
| P-05 | Gráficos de conformidade por plano/cliente/setor/período/procedimento (dado real) | PARCIAL | PENDENTE | | | | | |
| P-06 | Fórmulas, incerteza, limite TSE, arredondamento, decisão automática | NOVO | BLOQUEADO — ESPECIALISTA | | | | | aguardando fórmula do Anderson |

## Fase 7 — Orçamentos na OS (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 | Gerar orçamento a partir da OS (serviço, hora técnica, peças, totais; centavos) | PARCIAL (sem UI de criar) | PENDENTE | | | | | |
| Q-02 | AGUARDANDO APROVAÇÃO / APROVADO / REPROVADO refletidos na OS (sem estado redundante) | PARCIAL | PENDENTE | | | | | |
| Q-03 | Aprovar/reprovar por perfil autorizado com trilha; corrige "Recusar" | PARCIAL (bug) | PENDENTE | | | | | |

## Fase 8 — Estoque interno e Store (P0/P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Estoque interno por organização/cliente: entrada, saldo, mínimo, **máximo**, valor, movimentações | PARCIAL | PENDENTE | | | | | |
| ST-02 | Saída **somente vinculada à OS** (sem baixa silenciosa) | JÁ EXISTE | PENDENTE | | | | | |
| ST-03 | **Curva ABC** real (mês, semestre, ano, personalizado) com regra convencional documentada | NOVO | PENDENTE | | | | | |
| ST-04 | Relatório por período | NOVO | PENDENTE | | | | | |
| ST-05 | Cadastro de item/depósito por HTTP | NOVO | PENDENTE | | | | | |
| ST-06 | Menu **STORE** separado: ver, consultar, solicitar proposta (sem checkout) | NOVO | PENDENTE | | | | | |
| ST-07 | Privacidade: saldo interno nunca visível a outro tenant | PARCIAL | PENDENTE | | | | | |
| ST-08 | Aplicar `inventory.read_costs` (hoje não aplicada) | PARCIAL | PENDENTE | | | | | |

## Fase 9 — Relatórios do Painel (P0)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Botão **Gerar relatório** no Painel (métricas/widgets existentes, filtros período/cliente/setor/preventiva/tipo/categoria) | NOVO | PENDENTE | | | | | |
| R-02 | Fundação do nível **BASIC** (seleção de métricas reais: MTTR, MTBF, abertos, concluídos, conformidades). Layout/PDF final: AGUARDANDO MODELO PDF OFICIAL | NOVO | PENDENTE | | | | | |
| R-03 | Fundação do nível **ADVANCED** (+ SLA, evolução, backlog, OS por situação; obsolescência só com dado real). Layout/PDF final: AGUARDANDO MODELO PDF OFICIAL | NOVO | PENDENTE | | | | | |
| R-04 | Nível **EXPERT** — só a estrutura; indicadores não formalizados marcados AGUARDANDO MODELO PDF OFICIAL | NOVO | BLOQUEADO — CLIENTE | | | | | fórmulas FHEMIG não entregues |
| R-05 | Disponibilidade no tempo | PARCIAL (fotografia) | BLOQUEADO — CLIENTE | | | | | definição de "parado" |
| R-06 | PDF/engine de relatório (reutiliza escritor próprio) | PARCIAL | PENDENTE | | | | | |

> **Decisão do cliente (16/10/2026, mensagem posterior à reunião):** "Refinamento dos relatórios Basic / Advanced / Expert será realizado em rodada dedicada após análise dos PDFs oficiais fornecidos pelo cliente." Nesta rodada só a **fundação**: níveis, estrutura de geração, filtros, seleção de métricas, dados reais já disponíveis, arquitetura de PDF, permissões, UI e contratos. **Não** reproduzir layout final, fórmulas, gráficos inexistentes, composição de páginas nem indicadores Expert não formalizados. Onde faltar definição: `AGUARDANDO MODELO PDF OFICIAL`.

## Fase 10 — Automações (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Ação **Nova automação** (relatório agendado, lembrete, tarefa, 5W2H, PDCA) | PARCIAL (sem criar na UI) | PENDENTE | | | | | |
| A-02 | Scheduler do gatilho `schedule`, idempotência, logs, tenant | PARCIAL (não ligado) | PENDENTE | | | | | |
| A-03 | Destinatário, periodicidade, relatório, filtros, ativo/inativo | NOVO | PENDENTE | | | | | |
| A-04 | Envio real por e-mail | NOVO | BLOQUEADO — INFRA | | | | | sem provider SMTP; fila/outbox só |
| A-05 | Tarefas no Kanban existente | PARCIAL | PENDENTE | | | | | |

## Fase 11 — Novo negócio (P1)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Provisionar organização/tenant (hospital/EAS ou prestadora) por API/tela, base única de código | PARCIAL (só CLI) | PENDENTE | | | | | |
| T-02 | Admin global explícito da plataforma (única visão cross-tenant) | NOVO | PENDENTE | | | | | |
| T-03 | Branding por organização (nome, logo seguro, identidade permitida) | NOVO | PENDENTE | | | | | |
| T-04 | Domínio/subdomínio por organização | NOVO | BLOQUEADO — INFRA | | | | | DNS/domínio não controlado |
| T-05 | Testes adversariais com dois tenants (usuários, clientes, setores, ativos, OS, estoque, Store, orçamentos, relatórios, automações) | PARCIAL | PENDENTE | | | | | |
| T-06 | Limites/plano e nº de usuários ativos (sem preços, sem gateway) | PARCIAL | PENDENTE | | | | | |

## Fase 12 — Ferramentas (P0 em modo apresentação)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Menu **FERRAMENTAS** com Temperatura e Umidade, Geolocalização, Rastreabilidade CME, Gases Medicinais, Simuladores/Analisadores, Integrações de Eng. Clínica, IA — rotulado EM BREVE/FUTURO/INTEGRAÇÃO PLANEJADA, sem backend e sem dado fabricado | NOVO | PENDENTE | | | | | |
| F-02 | Integrações reais N1–N4, hardware, IA real | NOVO | FUTURO | | | | | |

## Fase 13 — Produção (P0 ambiente estável)

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Identificar inequivocamente o ambiente antes de qualquer ação remota | PARCIAL | PENDENTE | | | | | |
| I-02 | Domínio "htec.b" (não presumir; não comprar) | NOVO | BLOQUEADO — INFRA | | | | | sem registro/credencial verificável |
| I-03 | HTTPS, PG privado, firewall, restart, logs, healthcheck | PARCIAL | PENDENTE | | | | | |
| I-04 | Backup real de PostgreSQL/arquivos + restore test descartável | NOVO | PENDENTE | | | | | prova exigida; sem prova = não afirma |
| I-05 | Publicar build validado, smoke remoto | PARCIAL | PENDENTE | | | | | |
| I-06 | VPS dedicada nos EUA | NOVO | BLOQUEADO — INFRA | | | | | decisão/aquisição fora do repositório |

## Fase final — Inspeção funcional, a11y, performance, gates

| ID | Demanda | Anterior | Status | Arquivos | Migration | Testes | Commit | Bloqueio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Z-01 | Personas OPERADOR/SOLICITANTE/GESTOR/ADMIN GLOBAL DE TESTE e cenário ponta a ponta | NOVO | PENDENTE | | | | | |
| Z-02 | Tenant A × B em todos os módulos | PARCIAL | PENDENTE | | | | | |
| Z-03 | Responsividade, a11y, performance | PARCIAL | PENDENTE | | | | | |
| Z-04 | Todos os gates (spec, typecheck, lint, marca, openapi, unit, PG real, RLS, RBAC, contratos, build, Playwright, portal, field, a11y, secret scan, format) | PARCIAL | PENDENTE | | | | | PG real/Playwright: só no CI |
| Z-05 | Atualizar AI-HANDOFF, NOVAS-SOLICITACOES e este roadmap | — | PENDENTE | | | | | |

---

## Não inventar (registro)

Fórmula FHEMIG · critério metrológico · integração com hardware · geolocalização por
chip real · IA real · e-mail sem provider · domínio inexistente · dados de produção ·
preços · regras não definidas pelo cliente.
