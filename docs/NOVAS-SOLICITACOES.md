# Novas Solicitações do Cliente

Este arquivo contém as solicitações recebidas **depois** da especificação e da
base original (os dois PDFs do cliente, `docs/AURORA-CMMS-SPEC-v0.2.md` e
`docs/AUDITORIA-GAP-BECARE-TECHNECARE-V2-2026-09.md`). É o **change request /
backlog oficial** do cliente: acompanha cada pedido do recebimento até a
entrega.

> **Ele NÃO representa funcionalidade implementada.**
> O estado real do produto está em **`docs/AI-HANDOFF.md`**. Um item aqui só
> passa a existir no produto quando estiver `IMPLEMENTADA` **com evidência** e
> a capacidade tiver sido promovida para o AI-HANDOFF.

**Criado em:** 01/10/2026 · **Auditoria de base:** HEAD `7e16baa` ·
**Origem dos pedidos NS-001 a NS-017:** Anderson (Be Care, cliente), em
conversas de setembro/2026 repassadas pelo responsável do projeto. Datas exatas de cada pedido: **A VALIDAR** — registrado
como "set/2026" quando não informado.

> **Revisão de 02/10/2026 (rodada do escopo atual contratado).** Nenhuma
> solicitação NS foi implementada nesta rodada, e nenhum status mudou. A rodada
> fechou só requisitos ANTERIORES (auditoria de gap V2, PDFs do cliente); onde
> isso mudou a base de uma NS, a linha **Revisão 02/10/2026** da solicitação diz
> o quê — e o que continua faltando. Detalhes: `RELATORIO-ESCOPO-ATUAL.md`.

> **Revisão de 09/10/2026 (rodada "overdelivery visual + operacional").**
> Pedidos novos desta rodada registrados como **NS-018** (Painel de Controle +
> Modo Exibição), **NS-019** (setores explícitos e Cliente → Setor →
> Equipamento) e **NS-020** (Planos de manutenção: criação orientada,
> procedimento, cronograma e gráficos) — as três **IMPLEMENTADAS**, com
> evidência. NS-006 passa de NOVA a **PARCIAL**; NS-001, 002, 003 e 004 ganham
> a linha **Revisão 09/10/2026** e continuam **PARCIAL**. Nada de Básico/
> Completo/Expert, FHEMIG, GPS, QR, depreciação, IA ou e-commerce foi feito.
> Branch `feat/overdelivery-painel` (commits `35b924d`, `fc4f2c6`, `87f44cf`,
> `1f334e4`, `1ba85dd`).

---

## Status permitidos

Use **somente** estes:

| Status | Significado |
| --- | --- |
| `NOVA` | Recebida; a base do sistema não atende o pedido |
| `EM ANÁLISE` | Sendo detalhada com o cliente ou auditada |
| `JÁ EXISTE` | O sistema já atende o pedido como foi feito |
| `PARCIAL` | Parte da base existe no código; o pedido ainda não está atendido |
| `APROVADA` | Escopo fechado com o cliente |
| `PLANEJADA` | Tem fase/rodada definida |
| `EM IMPLEMENTAÇÃO` | Em código |
| `IMPLEMENTADA` | Entregue, testada, com evidência registrada |
| `BLOQUEADA — CLIENTE` | Depende de algo que o cliente precisa enviar ou decidir |
| `BLOQUEADA — ESPECIALISTA` | Depende de norma, metrologista ou responsável técnico |
| `FUTURA FASE` | Registrada, fora do horizonte atual |
| `DESCARTADA` | Não será feita (registrar o porquê) |

Complexidade é **qualitativa**: `BAIXA` · `MÉDIA` · `ALTA`.

## Regra de implementação

Quando uma solicitação for implementada:

1. alterar o status para `IMPLEMENTADA`;
2. registrar o **commit**;
3. registrar a **migration**, se houver;
4. registrar a **API/rota**;
5. registrar os **testes**;
6. atualizar o `docs/AI-HANDOFF.md` com a capacidade **real**;
7. **não apagar** a solicitação do histórico.

Antes de implementar: auditar o código (o "o que já existe" abaixo envelhece),
mudar para `EM ANÁLISE`/`PLANEJADA`, planejar, implementar, testar.

---

## Resumo

| ID | Título | Status | Complexidade | Fase sugerida |
| --- | --- | --- | --- | --- |
| NS-001 | Cadastro de cliente enriquecido | PARCIAL | MÉDIA | Próxima |
| NS-002 | Ficha de vida do equipamento | PARCIAL | ALTA | Próxima (sem depreciação) |
| NS-003 | Checklist por cliente/equipamento | PARCIAL | MÉDIA | Próxima |
| NS-004 | Procedimentos técnicos | PARCIAL | ALTA | Após NS-003 |
| NS-005 | Ações em Ordem de Serviço | PARCIAL | MÉDIA | Próxima |
| NS-006 | Indicadores de ativos por cliente | PARCIAL | MÉDIA | Após NS-002 |
| NS-007 | Indicadores integrados (app, FHEMIG, robô) | BLOQUEADA — CLIENTE | ALTA | Quando o material chegar |
| NS-008 | Níveis de indicadores (Básico/Completo/Expert) | NOVA | MÉDIA | Após NS-006 |
| NS-009 | IA dentro do sistema | FUTURA FASE | ALTA | Futura |
| NS-010 | Automação de tarefas e relatórios | PARCIAL | ALTA | Após ligar o motor |
| NS-011 | Hierarquia / acessos | PARCIAL | MÉDIA | Próxima |
| NS-012 | Estoque Be Care × estoque do cliente | NOVA | ALTA | Média |
| NS-013 | Loja / e-commerce Be Care | FUTURA FASE | ALTA | Futura |
| NS-014 | Comprador hospitalar | NOVA | ALTA | Média (após NS-012) |
| NS-015 | QR Code do equipamento (etiqueta) | PARCIAL | BAIXA | Próxima |
| NS-016 | Check-in / check-out no hospital | NOVA | MÉDIA | Média |
| NS-017 | App / mobile (validação) | PARCIAL | MÉDIA | Próxima (demonstrar) |
| NS-018 | Painel de Controle + Modo Exibição (TV) | IMPLEMENTADA | MÉDIA | Entregue 09/10/2026 |
| NS-019 | Setores do hospital · Cliente → Setor → Equipamento | IMPLEMENTADA | MÉDIA | Entregue 09/10/2026 |
| NS-020 | Planos de manutenção: criação orientada, cronograma e gráficos | IMPLEMENTADA | ALTA | Entregue 09/10/2026 |

**Contagem:** 20 no total · JÁ EXISTE 0 · PARCIAL 10 · NOVA 4 · FUTURA FASE 2 ·
BLOQUEADA 1 (cliente) · EM IMPLEMENTAÇÃO 0 · IMPLEMENTADA 3.

---

## NS-001 — Cadastro de cliente enriquecido

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-001 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Cliente com dados completos, tipo de contrato, SLA geral, configuração de indicadores e vínculo com equipamentos |
| **Interpretação funcional** | Uma ficha de cliente navegável e editável que reúne cadastro, contratos vigentes (e seu tipo), SLA padrão, perfil de indicadores (NS-008) e os equipamentos do cliente |
| **Status** | **PARCIAL** |
| **O que já existe** | Tabela `customers` (`migrations/0008`): razão social, nome fantasia, código, CNPJ (`tax_id`), interno/externo, segmento, situação, e-mail e endereço de cobrança, logo, campos personalizados. `customer_contacts`. `customers.default_sla_policy_id` (`0027`). Tipo de contrato existe **no contrato** (`contracts.contract_kind`: full_service, preventive_only, on_demand, rental, loan, warranty — `0031`), com SLA e metas. Vínculo com equipamentos: `assets.customer_id` obrigatório. API: só `GET /v1/customers` |
| **O que falta** | Rota de criar/editar cliente (a função `createCustomer` existe em `packages/db/src/directory.ts`, sem rota; permissões `customer.create/update` sem uso); tela `/clientes` e ficha de cliente (a busca global já aponta para `/clientes/:id`, que não existe); exibir contratos/SLA/equipamentos agregados; configuração de indicadores (não existe em lugar nenhum) |
| **Impacto** | Alto — é a entidade-raiz que o cliente enxerga em todas as conversas |
| **Complexidade** | MÉDIA |
| **Dependências** | NS-008 (perfil de indicadores) para a parte de indicadores |
| **Fase sugerida** | Próxima |
| **Arquivos / domínios** | `packages/db/src/directory.ts` · `apps/api/src/directory/customers.controller.ts` · `packages/contracts/src/operations/directory.ts` · `apps/web/src/shell/global-search.tsx` · `migrations/0008`, `0027`, `0031` |
| **Revisão 02/10/2026** | Busca global: resultado de cliente deixou de levar a `/clientes/:id` (rota inexistente) e leva a `/contratos`; a ficha de cliente continua **não existindo**. `customers.external_source/external_id` (0048) existem para migração. Status **inalterado**. |
| **Revisão 09/10/2026** | **Existe agora:** ficha de cliente `/clientes/$id` com SETORES (criar, renomear, atalhos de nome) e equipamentos agrupados por setor (NS-019); cadastro de cliente (`POST /v1/customers`, rodada anterior). **Continua faltando:** editar o cliente, contratos/SLA agregados na ficha, configuração de indicadores (NS-008). Status **PARCIAL**. |
| **Evidência de implementação** | — |
| **Observações** | "Tipo de contrato" deve continuar morando no **contrato** (um cliente pode ter mais de um); a ficha mostra, não duplica |

## NS-002 — Ficha de vida do equipamento

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-002 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Dados do equipamento, histórico, indicadores, disponibilidade e depreciação em tempo real |
| **Interpretação funcional** | Uma ficha completa do ativo ao longo da vida: cadastro, todas as intervenções, indicadores do próprio equipamento (MTTR, MTBF, custo), disponibilidade e valor depreciado atual |
| **Status** | **PARCIAL** |
| **O que já existe** | Ficha de leitura `/ativos/$id` (`apps/web/src/features/ativos/ficha.tsx`): cabeçalho, histórico de OS (até 50), datas de ciclo de vida, valores de aquisição/residual/reposição (com `asset.read_financials`), especificações, QR como texto, transferências. API `GET /v1/assets/:id` (garantia e idade calculadas no servidor) e `GET /v1/assets/:id/contract`. Colunas para depreciação existem: `purchase_value`, `residual_value`, `acquired_at`, `useful_life_years` (`0014`), `asset_models.default_useful_life_years` (`0013`). Tabelas `meters`/`meter_readings` existem |
| **O que falta** | **Depreciação**: nenhum cálculo (só o texto de uma permissão); método de depreciação **A VALIDAR com o cliente/contabilidade** — não inventar. **Disponibilidade**: nenhuma métrica; `causes_asset_downtime` e `countsForAvailability()` existem sem uso. **Indicadores por ativo**: nenhum. Edição do ativo (sem PATCH). Medidores sem rota/tela. Documentos do ativo na ficha (`GET /v1/documents/by-asset` existe, a ficha não usa) |
| **Impacto** | Alto — pedido central de engenharia clínica |
| **Complexidade** | ALTA |
| **Dependências** | Definição de disponibilidade (o que conta como parado) e do método de depreciação, pelo cliente |
| **Fase sugerida** | Próxima para histórico/indicadores; depreciação após definição |
| **Arquivos / domínios** | `apps/web/src/features/ativos/ficha.tsx` · `apps/api/src/assets/assets.controller.ts` · `packages/domain/src/assets.ts` · `packages/db/src/metrics.ts` · `migrations/0013`, `0014`, `0026`, `0035` |
| **Revisão 02/10/2026** | Base nova do escopo atual (gap V2 P1.3/P1.5): `GET /v1/assets/:id/timeline` — linha do tempo unificada (ciclo de vida, transferências, OS, sessões de medição, documentos, substituição), e `assets.replaced_by_asset_id` (0056). A **ficha web não usa** a linha do tempo ainda; depreciação, disponibilidade e indicadores por ativo continuam **não existindo**. Status **inalterado (PARCIAL)**. |
| **Revisão 09/10/2026** | **Existe agora:** edição dos dados cadastrais (`PATCH /v1/assets/:id`; mudar de setor = transferência com motivo, pela tela) e a ficha mostra Cliente e Setor. **Continua faltando:** depreciação, disponibilidade, indicadores por equipamento. Status **PARCIAL**. |
| **Evidência de implementação** | — |
| **Observações** | "Em tempo real" = calculado na leitura, não gravado; não é processamento contínuo |

## NS-003 — Checklist por cliente/equipamento

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-003 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Cadastro de checklist atrelável a equipamento, cliente, preventiva, preditiva, calibração e TSE |
| **Interpretação funcional** | Tela para criar e versionar modelos de checklist, classificá-los por tipo de serviço e vinculá-los a cliente, equipamento (ou categoria/modelo) e plano, para que a OS já nasça com o checklist certo |
| **Status** | **PARCIAL** |
| **O que já existe** | Motor completo (`migrations/0024`, `packages/domain/src/checklists.ts`, `packages/db/src/execution.ts`): modelo versionado e imutável após publicação; itens texto, número com unidade e faixa, booleano, opção, múltipla opção, foto, data; critérios de falha, foto obrigatória na falha, visibilidade condicional, ação na falha (sinalizar, bloquear conclusão, abrir OS); resposta congela a versão. Execução no Field. Vínculos por chave de texto em `plan_tasks.checklist_template_key` e `work_order_type_settings.default_checklist_key` |
| **O que falta** | API e tela para criar/editar/publicar modelos (permissões `procedure.*` sem rota); tipo de modelo (preventiva, preditiva, calibração, TSE); vínculo com cliente, ativo, categoria ou modelo de equipamento; **acionar** os vínculos existentes (`materializeCycle` cria a OS sem anexar o checklist; `default_checklist_key` nunca é lido); exibir checklist na ficha web da OS |
| **Impacto** | Alto |
| **Complexidade** | MÉDIA |
| **Dependências** | Itens de calibração/TSE com limites → NS-004 e fronteira metrológica (AI-HANDOFF §17) |
| **Fase sugerida** | Próxima |
| **Arquivos / domínios** | `packages/domain/src/checklists.ts` · `packages/db/src/execution.ts` · `packages/db/src/maintenance-plans.ts` · `apps/api/src/work-orders/execution.controller.ts` · `migrations/0024`, `0026`, `0029` |
| **Revisão 02/10/2026** | Base nova do escopo atual: a OS da preventiva passa a nascer com o checklist da tarefa do plano anexado (`materializeCycle`, P1.4); modelos ganharam `procedure_kind` só para protocolos metrológicos (calibração, TSE, qualificação, aceite). Continuam **não existindo**: rota/tela de criar e publicar modelo, tipo preventiva/preditiva, vínculo com cliente/equipamento, `default_checklist_key`. Status **inalterado (PARCIAL)**. |
| **Revisão 09/10/2026** | **Existe agora:** API e tela para criar (com itens), revisar (versão seguinte) e publicar checklists — `GET/POST /v1/checklist-templates`, `/:id`, `/:id/revisions`, `/:id/publish` — com tipo (preventiva = sem `procedure_kind`; calibração, TSE, qualificação, aceite) e os tipos de item do motor; vínculo com cliente/setor/equipamento **pelo plano** (NS-020). **Continua faltando:** tipo "preditiva", vínculo direto checklist ↔ modelo/categoria de equipamento, `default_checklist_key`, ver o checklist respondido na ficha web da OS. Status **PARCIAL**. |
| **Evidência de implementação** | — |
| **Observações** | Não criar um segundo motor: estender o existente |

## NS-004 — Procedimentos técnicos

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-004 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Procedimentos de calibração, TSE, qualificação, manutenção preventiva e educação continuada, que podem gerar cronograma. Futuramente: campos administrativos, numéricos, unidades, conforme/não conforme, questionários, regras por tipo de equipamento |
| **Interpretação funcional** | Uma entidade "procedimento" (por tipo e por tipo de equipamento) que define o conteúdo do serviço (checklist/medições) e a periodicidade, e alimenta planos e agenda |
| **Status** | **PARCIAL** |
| **O que já existe** | Planos preventivos com tarefas, frequência, tolerância e geração automática de OS por calendário (`migrations/0029`, job `plans.sweep`); checklist com número + unidade + faixa e veredito conforme/não conforme (NS-003); tipos de documento `calibration_certificate`, `electrical_safety_test`, `thermal_qualification` provisionados (payload vazio); módulo `metrologia.ts` com a fronteira (validade de padrão na data) |
| **O que falta** | Entidade "procedimento" (só existem permissões `procedure.*` e o evento `procedure.published`); tipo de procedimento; regras por tipo de equipamento; questionários; educação continuada (nada); rota para criar plano/tarefa; gatilhos por medidor/condição |
| **Impacto** | Alto — base de metrologia e qualificação |
| **Complexidade** | ALTA |
| **Dependências** | NS-003. **Regras metrológicas (incerteza, critério de aceitação, correção, arredondamento, limites TSE) → `BLOQUEADA — ESPECIALISTA`** até procedimento escrito + casos de referência + metrologista (AI-HANDOFF §17) |
| **Fase sugerida** | Após NS-003; a parte metrológica só após o especialista |
| **Arquivos / domínios** | `packages/domain/src/maintenance-plans.ts` · `packages/domain/src/metrologia.ts` · `docs/AURORA-METROLOGIA-FRONTEIRA.md` · `packages/domain/src/documents.ts` · `migrations/0029`, `0034` |
| **Revisão 02/10/2026** | Base nova do escopo atual (metrologia N0, 0050–0053): protocolo = checklist versionado com tipo de procedimento, responsável técnico, instrumentos exigidos por categoria e ponto `measurement` (unidade, nominal, tolerâncias e leituras **como dado**, sem veredito); instrumentos, certificados externos e sessão de medição. Preventiva por modelo/fabricante/criticidade (0055). Continuam **não existindo**: entidade/tela de procedimento, rota de criar plano/tarefa, educação continuada, cronograma por procedimento, regras metrológicas (BLOQUEADA — ESPECIALISTA). Status **inalterado (PARCIAL)**. |
| **Revisão 09/10/2026** | **Existe agora:** tela de procedimentos (o checklist com `procedure_kind`) com nominal/tolerância como dado; **rota de criar plano** (`POST /v1/maintenance-plans`, criação orientada); **cronograma por procedimento** (`GET /v1/maintenance-plans/schedule`, reais + previstos) — NS-020. **Continua faltando:** educação continuada (não existe no domínio; o assistente a mostra desabilitada), regras por tipo de equipamento, questionários, gatilhos por medidor/condição, natureza de OS própria para TSE/qualificação (hoje `inspection`, A VALIDAR), e as regras metrológicas (**BLOQUEADA — ESPECIALISTA**). Status **PARCIAL**. |
| **Evidência de implementação** | — |
| **Observações** | Há um teste que **falha** se alguém adicionar função de cálculo a `metrologia.ts`. Não inventar fórmula |

## NS-005 — Ações em Ordem de Serviço

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-005 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Na OS: ver, editar, baixar, imprimir, enviar |
| **Interpretação funcional** | Cinco ações na ficha da OS, cada uma independente |
| **Status** | **PARCIAL** |
| **O que já existe** | **Ver:** ✅ `/ordens/$id` + `GET /v1/work-orders/:id` e abas (comentários, horas, anexos, peças). Transições de estado ✅ |
| **O que falta** | **Editar:** ⬜ sem PATCH (a ficha registra que foi deliberado; permissões `work_order.update/edit_closed/edit_dates` sem uso). **Baixar:** ⬜ sem PDF (o tipo `work_order_report` existe com payload vazio; `pdf_key` nunca é escrito). **Imprimir:** ⬜ sem `@media print`/`window.print`. **Enviar:** ⬜ sem transporte de e-mail/WhatsApp |
| **Impacto** | Alto — uso diário |
| **Complexidade** | MÉDIA (editar + imprimir BAIXA; PDF MÉDIA; envio depende de transporte) |
| **Dependências** | Escolha de renderizador de PDF; canal de envio (pendências técnicas do AI-HANDOFF §32) |
| **Fase sugerida** | Próxima (editar, imprimir); PDF e envio em seguida |
| **Arquivos / domínios** | `apps/web/src/features/ordens/ficha.tsx` · `apps/api/src/work-orders/work-orders.controller.ts` · `packages/domain/src/documents.ts` · `packages/db/src/notifications.ts` |
| **Revisão 02/10/2026** | Base nova do escopo atual (P2.8): PDF de **documento técnico** (`GET /v1/documents/:id/pdf`, renderizador próprio, determinístico). O PDF/impressão/envio **da OS** continuam **não existindo**. Status **inalterado (PARCIAL)**. |
| **Evidência de implementação** | — |
| **Observações** | Edição deve respeitar a máquina de estados e a auditoria; OS fechada só com `work_order.edit_closed` |

## NS-006 — Indicadores de ativos por cliente

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-006 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Gráficos de ativo × inativo por mês, período e cliente; disponibilidade individual por equipamento; geração de relatórios |
| **Interpretação funcional** | Indicadores sobre a **base instalada** (não sobre OS), filtráveis por cliente e período, com série mensal e exportação |
| **Status** | **PARCIAL** |
| **O que já existe** | Base indireta: `assets.status` (active, under_maintenance, standby, loaned, decommissioned, disposed), `decommissioned_at`; a API de insights aceita `customerId`; componentes `BarChart`/`DonutChart`/`Sparkline` |
| **O que falta** | Métrica de ativo × inativo (não existe); histórico de status do ativo para série mensal (só há `decommissioned_at`); disponibilidade por equipamento (não existe); filtro por cliente na tela; séries temporais na API; relatório/exportação |
| **Impacto** | Médio-alto |
| **Complexidade** | MÉDIA |
| **Dependências** | Definição de "inativo" e de disponibilidade pelo cliente; NS-002 (disponibilidade) |
| **Fase sugerida** | Após NS-002 |
| **Arquivos / domínios** | `packages/domain/src/metrics.ts` · `packages/db/src/metrics.ts` · `apps/api/src/insights/insights.controller.ts` · `apps/web/src/features/indicadores/painel.tsx` · `migrations/0014`, `0035` |
| **Revisão 09/10/2026** | **Existe agora (NS-018):** fotografia do parque AGORA por situação cadastrada e por setor, filtrável por cliente e setor, dentro do escopo (`GET /v1/insights/control-panel` → `park`), e séries por período das métricas de OS. **Continua faltando:** série mensal de ativo × inativo (não há histórico de status do ativo — não se inventa), disponibilidade por equipamento (sem definição do cliente), relatório/exportação. Status **NOVA → PARCIAL**. |
| **Evidência de implementação** | Parcial: commit `35b924d` · `packages/db/src/painel.ts` (`parkSnapshot`) · teste `api-painel-planejamento.test.ts` |
| **Observações** | Toda métrica nova precisa viajar com definição (padrão do módulo) |

## NS-007 — Indicadores integrados

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-007 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | O cliente enviará outro app já desenvolvido, o modelo FHEMIG e o link de um robô que capta indicadores |
| **Interpretação funcional** | Integrar ou reproduzir indicadores já usados pelo cliente; formato e fonte desconhecidos |
| **Status** | **BLOQUEADA — CLIENTE** |
| **O que já existe** | Motor de indicadores (AI-HANDOFF §15-A). Nenhuma integração externa |
| **O que falta** | **Receber** o app, o modelo FHEMIG e o link do robô; depois, analisar |
| **Impacto** | A avaliar |
| **Complexidade** | ALTA (provisória) |
| **Dependências** | Material do cliente — **ainda não recebido** |
| **Fase sugerida** | Reavaliar quando o material chegar |
| **Arquivos / domínios** | — |
| **Evidência de implementação** | — |
| **Observações** | Não acessar sistema do cliente nem robô sem autorização explícita |

## NS-008 — Níveis de indicadores

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-008 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Perfis BÁSICO, COMPLETO e EXPERT, configurados por cliente + tipo de contrato; futuramente gráficos, relatórios padrão e personalizados conforme o perfil contratado |
| **Interpretação funcional** | Um catálogo de perfis que define quais indicadores/relatórios cada cliente vê, derivado do contrato |
| **Status** | **NOVA** |
| **O que já existe** | Nada de perfil. Mais próximo: metas por contrato (`sla_target_percent`, `plan_target_percent`), medição congelada em `contract_periods`, permissão `insight.manage_dashboards` sem uso |
| **O que falta** | Modelo de perfil, vínculo com contrato/cliente, aplicação no web e no portal (o portal não tem indicadores) |
| **Impacto** | Comercial — vira produto em camadas |
| **Complexidade** | MÉDIA |
| **Dependências** | NS-001, NS-006; definição de quais indicadores compõem cada nível (cliente) |
| **Fase sugerida** | Após NS-006 |
| **Arquivos / domínios** | `migrations/0031`, `0035` · `packages/domain/src/metrics.ts` · `apps/portal` |
| **Evidência de implementação** | — |
| **Observações** | — |

## NS-009 — IA dentro do sistema

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-009 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Módulo de IA para relatórios em tempo real, análises críticas, sugestões, pareceres, notificações e gestão; módulos ativáveis por negócio/contrato |
| **Interpretação funcional** | Camada de assistência sobre os dados já existentes, ativável por contrato |
| **Status** | **FUTURA FASE** |
| **O que já existe** | Nada (nenhuma biblioteca ou chamada de IA no código). Dados estruturados e métricas com definição são a base |
| **O que falta** | Tudo |
| **Impacto** | Estratégico |
| **Complexidade** | ALTA |
| **Dependências** | Deploy do produto conectado; LGPD/consentimento; NS-008 (ativação por contrato) |
| **Fase sugerida** | Futura |
| **Arquivos / domínios** | AI-HANDOFF §30 |
| **Evidência de implementação** | — |
| **Observações** | **Não implementar agora.** Parecer técnico gerado por IA não substitui responsável técnico |

## NS-010 — Automação

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-010 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Criar tarefas, importar tarefas de cronogramas, executar tarefas periódicas, gerar relatórios sistemáticos, envio mensal/periódico, aprovação antes do envio |
| **Interpretação funcional** | Rotinas agendadas que criam trabalho e produzem/enviam relatórios, com etapa de aprovação humana |
| **Status** | **PARCIAL** |
| **O que já existe** | Motor de regras (`migrations/0037`, `packages/domain/src/automations.ts`, `packages/db/src/automations.ts`): gatilhos `event`/`schedule`/`condition_watch` modelados; ações `notify`, `assign`, `change_status`, `add_comment`, `create_work_order`; salvaguardas (anti-recursão, profundidade 3, quarentena por taxa, simulação obrigatória). API e tela para listar, simular, ativar, pausar e ver execuções. Tarefas periódicas de **preventiva** já existem pelo `plans.sweep` |
| **O que falta** | **Ligar o motor**: `runAutomations` só é chamado em teste e o `EventSink` do worker só escreve log; motor para gatilho `schedule`; ação de gerar relatório; envio (sem transporte); etapa de aprovação antes do envio; importar cronograma; formulário de criação de regra na tela |
| **Impacto** | Alto |
| **Complexidade** | ALTA |
| **Dependências** | NS-005 (PDF/relatório), transporte de e-mail, deploy dos workers |
| **Fase sugerida** | Após ligar o motor (pendência técnica do AI-HANDOFF §32) |
| **Arquivos / domínios** | `packages/db/src/automations.ts` · `apps/workers/src/main.ts` · `apps/workers/src/jobs/catalog.ts` · `apps/web/src/features/automacoes/lista.tsx` |
| **Evidência de implementação** | — |
| **Observações** | — |

## NS-011 — Hierarquia / acessos

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-011 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Configuração por cargo, função, permissões, criação e edição de usuários, acesso a módulos |
| **Interpretação funcional** | A administração define cargos com conjuntos de permissões e controla quem acessa o quê |
| **Status** | **PARCIAL** |
| **O que já existe** | RBAC completo no backend: 110 permissões, 11 papéis de fábrica, permissão/negação individual com motivo e validade, escopo por cliente/local (`migrations/0006`, `0039`, `0040`). API e tela para convidar, suspender, atribuir papéis e conceder/negar permissão (`/configuracoes`, `membros.tsx`, `acesso.tsx`). API de escopo |
| **O que falta** | Criar/editar/excluir **papel personalizado** (o schema aceita — `roles.copied_from_key` —, sem rota nem função); "cargo/função" como conceito (hoje papel = cargo); tela de escopo; edição de dados do usuário pela administração; "acesso a módulo" como agrupamento visível de permissões |
| **Impacto** | Alto |
| **Complexidade** | MÉDIA |
| **Dependências** | — |
| **Fase sugerida** | Próxima |
| **Arquivos / domínios** | `packages/domain/src/permissions.ts` · `packages/db/src/roles.ts` · `apps/api/src/platform/roles.controller.ts` · `members.controller.ts` · `apps/web/src/features/configuracoes/*` |
| **Evidência de implementação** | — |
| **Observações** | Não criar um segundo sistema de permissões — estender o atual |

## NS-012 — Estoque Be Care / cliente

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-012 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Separar: (A) estoque Be Care; (B) estoque do cliente/hospital; (C) cliente com contrato que inclui peças; (D) cliente com estoque próprio gerenciado pela plataforma |
| **Interpretação funcional** | Propriedade do estoque (prestadora × cliente) e regra de cobrança/consumo de peça conforme o contrato |
| **Status** | **NOVA** |
| **O que já existe** | Estoque completo da prestadora (`migrations/0030`): depósitos (`central`, `satellite`, `van`, `consignment`), razão imutável, saldos, reservas por OS, lotes com fornecedor, imagem e categoria. Apelido e preço por cliente (`customer_item_aliases`). Custo de peças medido por período de contrato (`contract_periods.parts_cost`) |
| **O que falta** | Dono do depósito (cliente × prestadora) — não há `customer_id` em `warehouses`; cobertura de peças no contrato (`contract_coverages`/`contract_services` não falam de peça); regra de consumo por tipo (A–D); visão do cliente sobre o próprio estoque no portal |
| **Impacto** | Alto — muda faturamento |
| **Complexidade** | ALTA |
| **Dependências** | Decisão comercial do cliente sobre os 4 modelos |
| **Fase sugerida** | Média |
| **Arquivos / domínios** | `packages/db/src/inventory.ts` · `apps/api/src/inventory/inventory.controller.ts` · `migrations/0030`, `0031`, `0032` |
| **Evidência de implementação** | — |
| **Observações** | Base de NS-013 e NS-014 |

## NS-013 — Loja / e-commerce Be Care

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-013 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Produtos/estoque Be Care expostos ao cliente para compra, com experiência de e-commerce |
| **Interpretação funcional** | Vitrine no portal com catálogo, preço do cliente e pedido |
| **Status** | **FUTURA FASE** |
| **O que já existe** | Catálogo com imagem e categoria; preço por cliente e por lista; orçamento versionado (prestadora → cliente) |
| **O que falta** | Vitrine, carrinho, pedido, pagamento/faturamento, logística |
| **Impacto** | Novo canal de receita |
| **Complexidade** | ALTA |
| **Dependências** | NS-012; portal publicado; decisão comercial e fiscal |
| **Fase sugerida** | Futura |
| **Arquivos / domínios** | `apps/portal` · `packages/db/src/inventory.ts` · `migrations/0032` |
| **Evidência de implementação** | — |
| **Observações** | — |

## NS-014 — Comprador hospitalar

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-014 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Perfil de comprador do hospital: ver OS aguardando peça, solicitar, receber e comparar cotações, aprovar, acompanhar, histórico. A Be Care pode observar demanda/mercado conforme permissões e modelo comercial |
| **Interpretação funcional** | Módulo de compras do lado do hospital, com cotação de múltiplos fornecedores, ligado às OS paradas por peça |
| **Status** | **NOVA** |
| **O que já existe** | Motivo de espera "aguardando peça" (`wait_reasons` chave `parts`, rótulo ao cliente em `0042`) e `external_quote`/`quote_approval`; orçamento **da prestadora para o cliente** (`0032`) com aprovação interna; tabela `suppliers` (só leitura); papéis `storekeeper` e `finance` |
| **O que falta** | Papel de comprador; pedido de cotação a fornecedores; cotação de fornecedor; comparação; aprovação pelo cliente no portal (hoje o portal não aprova nem orçamento); acompanhamento e histórico de compra; visão agregada de demanda para a Be Care (com regra de privacidade) |
| **Impacto** | Alto — módulo relevante, segundo o cliente |
| **Complexidade** | ALTA |
| **Dependências** | NS-012; NS-011 (papel); modelo comercial |
| **Fase sugerida** | Média, após NS-012 |
| **Arquivos / domínios** | `migrations/0008` (suppliers), `0032` (quotes), `0042` · `apps/portal` · `packages/domain/src/permissions.ts` |
| **Evidência de implementação** | — |
| **Observações** | Visão de mercado pela Be Care exige regra explícita de anonimização/consentimento |

## NS-015 — QR Code do equipamento

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-015 |
| **Data** | set/2026 (A VALIDAR) — pedido mais recente |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Técnico/usuário autorizado consegue GERAR, VISUALIZAR, BAIXAR, IMPRIMIR e VINCULAR QR Code ao equipamento, para colar etiqueta física; depois o técnico lê o QR, o sistema identifica o equipamento e abre a ficha/ações |
| **Interpretação funcional** | Separar **identidade/leitura** (já existe) de **geração/etiqueta** (não existe) |
| **Status** | **PARCIAL** |
| **O que já existe** | **Identidade/token/leitura:** `assets.qr_token` único (`0014`); `GET /q/:token` público e sem oráculo (`0017`, `qr.controller.ts`); rotação `POST /v1/assets/:id/rotate-qr`; dados de etiqueta em lote `POST /v1/labels` (JSON, até 500); leitura no Field por câmera ou digitação, resolvendo na base local e abrindo o ativo. Testes em `api-qr.test.ts` |
| **O que falta** | **Geração/etiqueta:** gerar a imagem do QR (nenhuma biblioteca); visualizar na ficha web (hoje só texto); baixar (PNG/SVG/PDF); imprimir etiqueta (layout, tamanho); tela que use `labels` e `rotate-qr`; decidir o conteúdo do QR (URL pública `/q/:token` × token puro) e a página pública aberta por ele; "vincular" a uma etiqueta pré-impressa (se for o caso) |
| **Impacto** | Alto em campo; baixo risco |
| **Complexidade** | BAIXA |
| **Dependências** | Domínio público para a URL do QR (deploy); tamanho de etiqueta/impressora do cliente |
| **Fase sugerida** | Próxima |
| **Arquivos / domínios** | `apps/api/src/assets/qr.controller.ts` · `migrations/0017` · `apps/web/src/features/ativos/ficha.tsx` · `apps/field/src/telas/qr.tsx` · AI-HANDOFF §22-A |
| **Evidência de implementação** | — |
| **Observações** | Rotacionar o token invalida etiquetas já coladas — a tela precisa avisar |

## NS-016 — Check-in / Check-out no hospital

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-016 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) |
| **Descrição original (resumo)** | Técnico chega, o app pede localização, identifica o hospital provável ("Você está no Hospital X?"), técnico confirma o CHECK-IN, vê equipamentos/OS/tarefas/agenda daquele hospital, executa, faz CHECK-OUT. Dados: técnico, cliente, local, horários, localização, precisão, trabalhos e duração. Localização **pontual**, sem rastreamento contínuo; fallback manual com justificativa e auditoria |
| **Interpretação funcional** | Entidade "visita" com dois eventos de localização pontual, operando offline como o resto do Field |
| **Status** | **NOVA** |
| **O que já existe** | `locations.geo_lat`/`geo_lng`/`address`/`is_mobile` (`0008`) — **nunca lidos nem escritos** fora da migration e de um teste. Field offline com fila idempotente, base local e porta de recursos do aparelho — **compatível** com registrar check-in/out como operação de fila. OS e agenda já filtráveis por local/cliente na base local. O app **não pede localização** hoje |
| **O que falta** | Entidade de visita; geolocalização (`navigator.geolocation` / plugin Capacitor de geolocalização, não instalado); cadastro de coordenadas dos hospitais; sugestão por proximidade; check-in/out manual com justificativa auditada; tela "neste hospital"; relatório de visitas |
| **Impacto** | Médio-alto (produtividade e comprovação de presença) |
| **Complexidade** | MÉDIA |
| **Dependências** | Coordenadas dos hospitais; política de privacidade/LGPD (necessária também para as lojas) |
| **Fase sugerida** | Média |
| **Arquivos / domínios** | `apps/field/src/*` (fila, dispositivo, telas) · `migrations/0008` · `packages/db/src/field-sync.ts` · `docs/AURORA-FIELD-LOJAS.md` |
| **Evidência de implementação** | — |
| **Observações** | A auditoria original já previa "check-in por geolocalização, opcional, com consentimento e sem rastreamento contínuo" (`docs/01-AUDITORIA-TECHNECARE.md`, MOB-06, P2) |

## NS-017 — App / mobile

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-017 |
| **Data** | set/2026 (A VALIDAR) |
| **Origem** | Anderson (Be Care) — "versão app e mobile (navegadores no celular)" |
| **Descrição original (resumo)** | Validar a versão aplicativo e a versão mobile em navegador de celular |
| **Interpretação funcional** | Mostrar ao cliente, num celular, as três formas: web responsivo, PWA do técnico e app de loja |
| **Status** | **PARCIAL** |
| **O que já existe** | **Mobile web:** `apps/web` testado em 390 px (`viewports.spec.ts`), gaveta de menu; a **demo pública** roda no celular e tem E2E em Pixel 7. **Portal:** desenhado para celular, E2E em Pixel 7. **PWA/Field:** manifesto + service worker, offline-first, E2E em Pixel 7. **Capacitor:** projetos `android/` e `ios/` e plugins presentes |
| **O que falta** | Field e portal **não estão publicados** nem têm modo demo — o cliente não consegue abri-los hoje; lojas bloqueadas por: identificador definitivo, política de privacidade pública, ícones/splash/capturas, links profundos com domínio, push (FCM/APNs), keystore Android, conta Apple + Mac, teste em aparelho real (`docs/AURORA-FIELD-LOJAS.md`) |
| **Impacto** | Alto para a percepção do cliente |
| **Complexidade** | MÉDIA (demonstrar) · ALTA (lojas) |
| **Dependências** | Deploy da API (para field/portal conectados) **ou** modo demo para field/portal; nome comercial definitivo (para `appId`) |
| **Fase sugerida** | Próxima (demonstração); lojas depois |
| **Arquivos / domínios** | `apps/field` · `apps/portal` · `apps/web/src/demo` · `e2e/specs/viewports.spec.ts` · `docs/AURORA-FIELD-LOJAS.md` · `docs/adr/ADR-029-aurora-field-pwa-e-lojas.md` |
| **Evidência de implementação** | — |
| **Observações** | — |

## NS-018 — Painel de Controle e Modo Exibição (TV)

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-018 |
| **Data** | 09/10/2026 |
| **Origem** | Anderson (Be Care), rodada "overdelivery visual + operacional" |
| **Descrição original (resumo)** | Dashboard mais rico (MTTR, MTBF, backlog, abertos/concluídos, SLA, disponibilidade, preventivas, ativos, produtividade), com gráficos e filtros; botão "Modo Exibição" para monitor/TV, sem distrações, atualização automática |
| **Interpretação funcional** | Uma área "Painel de Controle" com os indicadores reais, gráficos de tendência/distribuição/realizado × pendente, filtros de período, cliente e setor dentro do escopo; uma tela cheia 16:9 para televisão com configuração fixa |
| **Status** | **IMPLEMENTADA** |
| **O que foi entregue** | `/painel`: 8 cartões (abertos, concluídos, backlog, equipamentos, MTTR, MTBF, SLA, preventivas em dia) com minitendência; gráficos abertos × concluídos, backlog no tempo, concluídos por natureza, taxas (SLA, conformidade, participação de preventivas), abertas agora por situação/prioridade, situação do parque, equipamentos por setor, produtividade, idade do backlog. Filtros de período (7/30/90 dias, 12 meses), cliente (só para quem vê mais de um) e setor — na URL. `/painel/tv`: sem barra lateral, números grandes, relógio/data, recorte atual, atualização a cada minuto, "atualizado há N min", tela cheia, Esc/botão para sair; cabe em 1920×1080 e 1280×720 sem rolagem |
| **Fora do entregue (deliberado)** | **Disponibilidade do parque** não é número: sem definição do cliente de "tempo parado" (AI-HANDOFF §15-A) — o painel mostra a situação cadastrada e diz que não é disponibilidade. Editor drag-and-drop, layouts salvos e widgets customizados: fora desta rodada |
| **Segurança** | As rotas de indicador passaram a respeitar o escopo do vínculo (`membership_scopes`, cliente e subárvore de local) — antes agregavam a organização inteira para qualquer vínculo com `insight.read`. Cliente fora do escopo ou de outra organização: 404 |
| **Evidência de implementação** | Commit `35b924d` · rota `GET /v1/insights/control-panel` (contrato `insights.controlPanel`) · `packages/db/src/painel.ts`, `packages/db/src/metrics.ts` (escopo) · `apps/web/src/features/painel/*` · `packages/ui/src/components/charts-tempo.tsx` · testes `apps/api/src/__tests__/api-painel-planejamento.test.ts`, `e2e/specs/painel-planejamento.spec.ts`, `e2e/demo/demonstracao.spec.ts` · **sem migration** |
| **Observações** | Nenhuma métrica nova: as séries aplicam as definições existentes por fatia (a soma das fatias de "abertas" é o cartão — há teste) |

## NS-019 — Setores do hospital e Cliente → Setor → Equipamento

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-019 |
| **Data** | 09/10/2026 |
| **Origem** | Anderson (Be Care), rodada "overdelivery visual + operacional" |
| **Descrição original (resumo)** | Seção SETORES explícita no cliente/hospital (listar, criar, editar nome; atalhos UTI, Bloco Cirúrgico, Enfermaria, Pronto Atendimento, Imaginologia; nome livre). No cadastro/edição do equipamento, Cliente* e Setor*, setor filtrado pelo cliente e validado no servidor |
| **Interpretação funcional** | Reutilizar `locations` (tipo `setor`) — sem tabela nova; tornar o setor visível na ficha do cliente e obrigatório no formulário de equipamento |
| **Status** | **IMPLEMENTADA** |
| **O que foi entregue** | Ficha `/clientes/$id` com a seção Setores (cartões com contagem, atalhos de nome, novo setor — criando a unidade no mesmo gesto quando falta —, renomear) e "Equipamentos por setor". Formulário Novo/Editar equipamento com Cliente/Hospital* e Setor* (setores do cliente escolhido; trocar o cliente descarta o setor); na edição, mudar de setor pede motivo e vira transferência registrada |
| **Validação no servidor** | `POST /v1/assets`: setor de outro cliente → 422 (`location_id`); setor de outra organização ou fora do escopo → 422; local que não recebe equipamento → 422; cliente fora do escopo → 404. `PATCH /v1/assets/:id` e `PATCH /v1/locations/:id` respondem 404 fora do escopo |
| **Banco** | `assets.location_id` **continua anulável** (importação, comodato em trânsito): a obrigatoriedade é da rota de cadastro, não do esquema. O gatilho da 0015 já recusava local de outro cliente |
| **Evidência de implementação** | Commit `fc4f2c6` · rotas `POST /v1/assets` (agora com contrato), `PATCH /v1/assets/:id`, `GET /v1/assets/form-options`, `PATCH /v1/locations/:id`, `GET /v1/assets?customer=` · `apps/web/src/features/clientes/ficha.tsx`, `apps/web/src/features/ativos/formulario.tsx` · testes em `api-painel-planejamento.test.ts` e `painel-planejamento.spec.ts` · **sem migration** |
| **Observações** | Setor = local do tipo `setor` da escada inicial; organização que renomear/remover esse tipo perde a seção (registrado) |

## NS-020 — Planos de manutenção: criação orientada, procedimento, cronograma e gráficos

| Campo | Conteúdo |
| --- | --- |
| **ID** | NS-020 |
| **Data** | 09/10/2026 |
| **Origem** | Anderson (Be Care), rodada "overdelivery visual + operacional" |
| **Descrição original (resumo)** | Módulo de Planos de Manutenção com criação orientada (Cliente → Setor → Equipamentos → Tipo → Checklist → Periodicidade → Revisão), tipos Preventiva/Calibração/TSE/Qualificação/Educação continuada conforme suporte real, checklist/procedimento sobre a engine existente, cronograma (próximas, vencidas, previstas, realizadas) e gráficos (programados, realizados, pendentes, vencidos, por tipo/cliente/setor/período) |
| **Interpretação funcional** | Expor o motor de planos (0029/0055) e de checklists (0024/0052) com telas de produto; nenhuma engine nova |
| **Status** | **IMPLEMENTADA** (educação continuada: ver observações) |
| **O que foi entregue** | Item "Planos de manutenção" no menu; abas Visão geral (cartões, realizado × pendente × vencido por mês, taxa, distribuição por tipo/cliente/setor, lista de planos), Cronograma (carga por mês e lista com data, equipamento, setor, cliente, plano, tipo e situação; filtros por situação e tipo; reais × previstos) e Procedimentos e checklists (criar, ver, revisar, publicar). Assistente de criação em sete passos com contexto contratual do cliente (informativo) |
| **Como o domínio suporta os tipos** | Preventiva = natureza `preventive` + checklist sem `procedure_kind`; Calibração = `calibration` + `procedure_kind=calibration`; TSE e Qualificação = natureza `inspection` + `procedure_kind` próprio (**A VALIDAR** se o cliente quer naturezas próprias). Tipo indisponível no catálogo da organização aparece desabilitado |
| **Fora do entregue** | **Educação continuada**: não existe no domínio (não é manutenção de ativo); aparece desabilitada e o gap segue em NS-004. Regras automáticas por Básico/Completo/Expert: fora (NS-008). Veredito de medição: continua `na` (BLOQUEADA — ESPECIALISTA) |
| **Evidência de implementação** | Commit `87f44cf` · rotas `POST /v1/maintenance-plans`, `GET /v1/maintenance-plans/form-options`, `/board`, `/schedule`, `GET/POST /v1/checklist-templates`, `GET /v1/checklist-templates/:id`, `POST /:id/revisions`, `POST /:id/publish` · `packages/db/src/plan-board.ts`, `packages/db/src/procedures.ts` · `apps/web/src/features/planos/{modulo,novo-plano,procedimentos}.tsx` · testes `api-painel-planejamento.test.ts` (recusas de setor/equipamento de outro cliente e de outro tenant, procedimento de outro tipo, escopo do hospital) e `painel-planejamento.spec.ts` · **sem migration** |
| **Observações** | "Programado" é item de ciclo que existe; o futuro é **previsto** pela frequência e marcado como tal — nada de histórico inventado. As OS geradas continuam na Agenda de sempre |
