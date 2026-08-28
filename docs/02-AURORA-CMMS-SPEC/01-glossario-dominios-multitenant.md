<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 2 de 13 — seções 03 a 05
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 03. Glossário oficial

Regra do produto: **um conceito, um nome técnico, um rótulo de interface**. Se um termo pt-BR aparece em duas telas, aponta para a mesma entidade. Se um nome técnico existe, ele não tem sinônimo no código.

| Nome técnico | Rótulo pt-BR | Definição | Entidade | Observações |
| --- | --- | --- | --- | --- |
| `organization` | Organização | A empresa que assina o Aurora. É o **tenant**: unidade de isolamento, faturamento e configuração. | `organizations` | Tenant e organização são a **mesma coisa**. Não existe camada intermediária. |
| `customer` | Cliente | Quem a organização atende. Um hospital, uma rede, um cliente interno. | `customers` | Sempre existe, mesmo quando a organização atende a si mesma (`is_internal = true`). |
| `location` | Local | Nó da árvore física de um cliente: unidade, bloco, andar, setor, sala. | `locations` | Hierarquia livre; o tipo é catálogo, não enum de código. |
| `location_type` | Tipo de local | Catálogo por organização que nomeia os níveis da árvore. | `location_types` | Define quais tipos podem ser pai de quais. |
| `supplier` | Fornecedor | Terceiro que vende peças ou executa serviço. | `suppliers` | Entidade separada de `customers`. Nunca compartilham tabela. |
| `asset` | Equipamento | Item gerenciado ao longo do ciclo de vida. | `assets` | "Ativo" no domínio, "Equipamento" na interface da vertical clínica. O rótulo é configurável por organização. |
| `asset_category` | Categoria | Classe funcional do ativo (Ventilador pulmonar, Autoclave). | `asset_categories` | Árvore rasa (2 níveis). Substitui os 651 "tipos" livres da referência. |
| `manufacturer` | Fabricante | Marca do ativo. | `manufacturers` | Entidade, não texto livre. |
| `asset_model` | Modelo | Modelo específico de um fabricante dentro de uma categoria. | `asset_models` | Carrega dados técnicos padrão herdados pelo ativo. |
| `service_request` | Solicitação | Pedido de atendimento feito por alguém do cliente. Pode virar 0, 1 ou N ordens de serviço. | `service_requests` | Entidade própria. Ver ADR-002. |
| `work_order` | Ordem de serviço | Unidade de trabalho executável, atribuível e mensurável. | `work_orders` | Abreviação aceita na interface: **OS**. |
| `work_order_type` | Natureza | Natureza do trabalho: corretiva, preventiva, calibração, teste elétrico, instalação, inspeção, treinamento… | `work_order_types` | Catálogo com `system_key` para os tipos que alimentam indicadores. |
| `work_order_status` | Situação | Estado operacional da OS, sempre pertencente a uma categoria fechada. | `work_order_statuses` | Nunca texto livre. Ver §10. |
| `wait_reason` | Motivo de espera | Por que a OS está parada quando a situação é "Aguardando". | `wait_reasons` | Dimensão separada. Ver ADR-003. |
| `failure_code` | Sintoma / causa | Taxonomia de falha em dois eixos: sintoma relatado e causa identificada. | `failure_codes` | Substitui os 360 "problemas relatados" e 344 "origens" livres. |
| `maintenance_plan` | Plano de manutenção | Programa recorrente que gera ordens de serviço por ciclo. | `maintenance_plans` | Não é contrato. Ver §12. |
| `plan_cycle` | Ciclo | Instância temporal de um plano, com janela e progresso. | `plan_cycles` | Base da conformidade. |
| `plan_task` | Tarefa do plano | Combinação alvo + natureza + procedimento + frequência dentro de um plano. | `plan_tasks` | Permite preventiva semestral e calibração anual no mesmo plano. |
| `procedure` | Procedimento | Instrução técnica reutilizável que reúne checklists e requisitos. | `procedures` | Camada entre checklist e OS, herdada da referência. |
| `checklist_template` | Checklist | Formulário versionado de inspeção. | `checklist_templates` / `_items` | Itens em tabela relacional, nunca JSON solto. |
| `checklist_response` | Execução de checklist | Preenchimento de um checklist dentro de uma OS. | `checklist_responses` / `_answers` | Congela a versão do template usada. |
| `sla_policy` | Política de SLA | Regras de prazo por prioridade, com calendário de cobertura. | `sla_policies` / `_targets` | Vinculada a contrato, cliente ou padrão da organização. |
| `sla_clock` | Relógio de SLA | Instância de contagem de um alvo sobre uma solicitação ou OS. | `sla_clocks` | Uma linha por alvo por documento. |
| `team` | Equipe | Grupo de execução, com cobertura e agenda. | `teams` | Substitui o "Quadro de trabalho" da referência. |
| `membership` | Vínculo | Relação entre um usuário e uma organização, com papéis e escopo. | `memberships` | Identidade é global; permissão é por organização. |
| `portal_scope` | Escopo do portal | Conjunto de locais que um usuário de cliente enxerga. | `membership_scopes` | Vale também para técnicos e coordenadores. |
| `inventory_item` | Item | Peça ou insumo controlado. | `inventory_items` | "Produto" não é usado, para evitar confusão com o ativo. |
| `warehouse` | Almoxarifado | Local de guarda de estoque, incluindo o "carro do técnico". | `warehouses` | Novo em relação à referência. |
| `stock_movement` | Movimento | Toda alteração de saldo, sempre com origem rastreável. | `stock_movements` | Livro-razão imutável. |
| `quote` | Orçamento | Proposta comercial de peças e serviços. | `quotes` / `quote_items` | Versionada. |
| `contract` | Contrato | Instrumento comercial com escopo, vigência, SLA e medição. | `contracts` | Diferente de plano de manutenção. |
| `document` | Documento | Peça documental emitida: certificado, laudo, relatório técnico. | `documents` | Motor único com `document_type`. Ver §18. |
| `document_type` | Tipo de documento | Certificado de calibração, teste de segurança elétrica, laudo de obsolescência, qualificação térmica, relatório de OS. | `document_types` | Define template, numeração, validade e campos obrigatórios. |
| `attachment` | Anexo | Arquivo vinculado a qualquer entidade. | `attachments` | Foto, PDF, vídeo, assinatura. |
| `automation_rule` | Automação | Regra gatilho → condição → ação. | `automation_rules` | Substitui os "Robôs". |
| `domain_event` | Evento | Fato ocorrido no domínio, publicado e persistido. | `domain_events` | Espinha dorsal de auditoria, notificação, automação e analytics. |
| `metric` | Indicador | Definição de cálculo registrada no catálogo de métricas. | registro em código | Não é linha de tabela editável pelo usuário. |
| `saved_view` | Visão salva | Combinação nomeada de filtros, colunas e ordenação. | `saved_views` | Compartilhável e usável como fonte de widget. |

#### Termos deliberadamente banidos

| Banido | Por quê | Use |
| --- | --- | --- |
| Empresa | Na referência significa seis coisas diferentes | `organization`, `customer`, `location` ou `supplier` — sempre o específico |
| Oficina / Quadro de trabalho | Dois rótulos para a mesma coisa | `team` — Equipe |
| Baixa patrimonial | Concorre com "Laudo de obsolescência" | `document_type = obsolescence_report` + `asset.status = decommissioned` |
| Chamado *como sinônimo de* OS | Fonte da confusão estrutural da referência | `service_request` (Solicitação) e `work_order` (OS) são coisas distintas |
| Tipo de serviço *como sintoma* | Gerou "Rodas travadas" e "Teclado com defeito" como tipos | `work_order_type` (natureza) × `failure_code` (sintoma) × `service_catalog` (o que foi vendido) |
| Solicitante *como classe de conta* | Cria dois modelos de identidade | `user` + `membership.seat_type = portal` |

---

## 04. Mapa de domínios

Oito domínios, definidos por **quem é dono da regra**, não por menu. Cada domínio tem um agregado raiz, publica eventos e só é acessado por outros domínios através de eventos ou de uma interface de leitura explícita. Isso permite que o monólito modular de hoje seja separável amanhã sem reescrita.

```

PLATFORM            identidade, tenancy, cobrança, suporte
   users · organizations · memberships · roles · permissions
   plans & seats · support_access · audit_logs · domain_events

DIRECTORY           quem e onde            raiz: customer
   customers · locations · location_types · suppliers · contacts
   teams · team_members · calendars · holidays

ASSETS              o que cuidamos          raiz: asset
   assets · asset_categories · manufacturers · asset_models
   asset_documents · meters · meter_readings · asset_transfers

SERVICE             o trabalho              raiz: work_order
   service_requests · work_orders · statuses · transitions · wait_reasons
   failure_codes · time_entries · work_order_parts · comments · signatures
   sla_policies · sla_clocks · custody_protocols

PLANNING            o trabalho futuro       raiz: maintenance_plan
   maintenance_plans · plan_tasks · plan_cycles · schedules
   procedures · checklist_templates · checklist_responses

COMMERCE            o dinheiro              raiz: contract
   contracts · contract_slas · service_catalog · price_lists
   quotes · quote_items · billing_periods
   inventory_items · warehouses · stock_lots · stock_movements · reservations

DOCUMENTS           a prova                 raiz: document
   documents · document_types · document_templates · number_series
   calibration_data · standards · uncertainty_profiles · attachments

INSIGHT             a leitura               sem raiz transacional
   metric registry · fact tables · dashboards · widgets · saved_views
   report_definitions · report_runs · export_jobs

AUTOMATION          a reação                raiz: automation_rule
   automation_rules · rule_runs · notifications · notification_preferences
   webhook_endpoints · webhook_deliveries · templates

```

### Por que esta divisão e não a do menu da referência

| Decisão | Racional |
| --- | --- |
| **Estoque dentro de COMMERCE**, não como domínio isolado | Peça só existe no produto por dois motivos: consumo em OS e venda em orçamento. Mantê-la junto de preço, contrato e faturamento evita duplicar regra de custo em dois lugares. |
| **Checklists e procedimentos em PLANNING**, não em cadastros | São conhecimento aplicado ao trabalho futuro. Ficam ao lado de planos, que é quem os agenda. |
| **Certificados e laudos em DOCUMENTS**, unificados | A referência tem seis módulos separados com 90 % de estrutura comum (numeração, validade, responsável técnico, PDF, assinatura). Um motor único com tipos elimina cinco implementações. |
| **SLA dentro de SERVICE**, não em COMMERCE | O relógio corre sobre solicitação e OS. O contrato apenas *fornece* a política. |
| **INSIGHT sem raiz transacional** | Analytics só lê. Nunca escreve em tabela de negócio. Isso garante que relatórios pesados nunca travem a operação. |
| **AUTOMATION separado** | Consome eventos de todos os domínios e não pertence a nenhum. Isolá-lo impede que regra de negócio vire gatilho escondido dentro de um serviço. |

---

## 05. Arquitetura multitenant

### Os cinco níveis, e o que cada um significa

| Nível | Nome técnico | É | Não é | Isolamento |
| --- | --- | --- | --- | --- |
| 0 | **platform** | O Aurora. Toda a instalação. Existe apenas como conceito operacional (nossa equipe, nossos jobs, nosso suporte). | Uma tabela de negócio. | — |
| 1 | **organization** | A conta que assina. Fronteira de isolamento, faturamento, configuração, catálogos e assentos. **É o tenant.** | Um cliente atendido. | `organization_id` em toda tabela de negócio + RLS |
| 2 | **customer** | Quem a organização atende. | Um local. Um fornecedor. | `customer_id` + escopo de membership |
| 3 | **location** | Nó da árvore física do cliente. | Uma pessoa jurídica. | `location_path` (ltree) + escopo |
| 4 | **user** | Identidade global, única por e-mail na plataforma. | Um papel. Uma permissão. | Sem dado de negócio próprio |

> **DECISÃO ADR-001**
>
> **Tenant = organization. Não haverá camada "tenant" separada.** A auditoria mostrou que a referência resolve isso por subdomínio (`technecare.`, `ebserh.`, `cieng.`), o que sugere isolamento físico por instância. Nós adotamos **isolamento lógico**: uma base, `organization_id` obrigatório, RLS no Postgres, e a autorização de negócio na camada de aplicação. Justificativa: relatórios internos, suporte, migração de esquema e custo operacional ficam viáveis com centenas de organizações; isolamento físico é ofertável depois como plano *enterprise* sem mudar o modelo.

### Os dois modos de operação, no mesmo modelo

```

MODO A — prestadora de serviço              MODO B — departamento interno

organization: "TechneCare Eng. Clínica"       organization: "Hospital Santa Marta"
   │                                              │
   ├── customer: "FHEMIG"                         └── customer: "Hospital Santa Marta"  is_internal = true
   │      └── location: Hospital João XXIII              └── location: Prédio A
   │            └── location: UTI II                           └── location: UTI
   │                  └── asset                                      └── asset
   ├── customer: "Santa Casa de Guaxupé"
   └── customer: "SAMU CISSUL"                   A interface entra em single-customer mode:
                                                  o seletor de cliente some, breadcrumbs começam
Seletor de cliente presente em toda parte.     em Local, e o portal vira "portal interno".

```

> **DECISÃO ADR-004**
>
> **Sempre existe um `customer`, mesmo no modo interno.** Alternativa avaliada e recusada: permitir `location` pendurada direto na `organization`. Recusada porque criaria dois caminhos de código em toda consulta de escopo, em todo relatório e em toda política de RLS — exatamente o tipo de bifurcação que gerou a "Empresa polimórfica" da referência. O custo é um registro artificial no *onboarding*; o benefício é um único caminho de dados. A interface esconde a camada quando `organization.customer_count = 1 AND customer.is_internal`.

### Identidade e vínculo

```

user  (identidade global — e-mail único na plataforma)
   │
   ├── membership → organization A   seat_type = staff    roles = [gestor]
   │        └── membership_scope: customer=*, location=*
   │
   ├── membership → organization B   seat_type = staff    roles = [tecnico]
   │        └── membership_scope: team = "Rota Sul"
   │
   └── membership → organization A   seat_type = portal   roles = [solicitante]
            └── membership_scope: customer = FHEMIG, locations = [UTI II, UTI III]

```

- Um mesmo e-mail pode participar de várias organizações — necessário para consultores, para grupos hospitalares e para o nosso suporte.
- `seat_type` ∈ `staff` | `portal`. **Só `staff` consome assento pago.** Portal é ilimitado — a referência já validou esse modelo (36 assentos internos contra 1.971 solicitantes).
- Trocar de organização é uma ação explícita na interface, nunca implícita por URL.

### Escopo de dados como dimensão de primeira classe

Todo `membership` carrega um **escopo** resolvido em três eixos, avaliados em conjunção:

| Eixo | Valores | Efeito |
| --- | --- | --- |
| `customer_scope` | `all` · lista de `customer_id` | Restringe clientes visíveis |
| `location_scope` | `all` · lista de subárvores (`location_path` prefixos) | Restringe locais e, por consequência, ativos e OS |
| `assignment_scope` | `all` · `team` · `own` | Restringe OS às da equipe ou às atribuídas ao próprio usuário |

O escopo é **materializado** em `membership_accessible_locations` a cada mudança de árvore ou de vínculo, para que nenhuma consulta precise de CTE recursiva em tempo de leitura. Essa é a diferença entre uma lista de 70 mil OS que abre em 200 ms e uma que trava por 30 segundos — comportamento efetivamente observado no sistema de referência.

### O que é por organização e o que é da plataforma

| Por organização (configurável) | Da plataforma (fixo) |
| --- | --- |
| Tipos de local, categorias de ativo, fabricantes, modelos | Categorias de situação de OS (`status_category`) |
| Naturezas de OS, motivos de espera, códigos de falha | Catálogo de métricas |
| Situações de OS (rótulo, cor, ordem) dentro das categorias fixas | Catálogo de eventos de domínio |
| Papéis customizados, políticas de SLA, calendários e feriados | Catálogo de permissões |
| Séries de numeração, templates de documento, checklists | Tipos de documento com lógica própria (calibração, TSE) |
| Campos personalizados, automações, preferências | Regras de integridade do grafo de transições |
| Rótulo de `asset` ("Equipamento", "Ativo", "Máquina") | Modelo de dados |
