Especificação funcional e arquitetural · não implementar

# Aurora — plataforma de gestão de ativos e manutenção

**Especificação funcional e arquitetural · v0.2 · SOURCE OF TRUTH**

Especificação completa de um SaaS multitenant para engenharia clínica e manutenção de ativos, derivada da auditoria funcional do Arkmeds/TechneCare e reprojetada para eliminar suas dívidas estruturais. Este documento é a fonte de verdade para implementação.

**Status** rascunho para aprovação · **Base** auditoria TechneCare v2.69.0 · **Vertical inicial** engenharia clínica · **Horizonte** multi-vertical · **Código produzido** nenhum

> **COMO LER ESTE DOCUMENTO**
>
> **DECISÃO** marca escolhas já tomadas e justificadas — implemente conforme escrito. **HIPÓTESE** marca suposições que precisam de validação com o cliente antes da implementação do épico correspondente. **A VALIDAR** marca fórmulas ou regras que a auditoria não conseguiu confirmar no sistema de referência e que não devem ser inventadas. Toda entidade, evento, permissão e estado citado tem nome técnico estável em `snake_case`; o rótulo pt-BR da interface está sempre ao lado e pode mudar sem impacto no modelo.

## 00. Changelog — v0.1 → v0.2

Esta é a **v0.2**, e é a *source of truth* corrente. A v0.1 permanece em `docs/02-AURORA-CMMS-SPEC/` como registro histórico.

| # | Correção | Onde | Motivo |
|---|---|---|---|
| 1 | Contagem de personas corrigida de "oito" para **dez** (PER-01 a PER-10) | §02 | O texto contradizia a própria lista |
| 2 | Separação explícita **Core Operacional (F0–F6)** × **MVP Comercial (F0–F8)** | §38, §44, §25 | "MVP" significava duas coisas diferentes em seções diferentes |
| 3 | OQ-01, OQ-03, OQ-06, OQ-13 e OQ-15 reclassificadas com *defaults* conservadores | §46 | Estavam marcadas como bloqueantes sem de fato bloquear a escrita de código |
| 4 | Classificação A/B/C/D das open questions | §46 | Faltava critério para decidir quando parar e quando seguir |
| 5 | Hardening de RLS: `FORCE ROW LEVEL SECURITY` obrigatório | §37, §34 | Sem `FORCE`, o owner da tabela ignora a política |
| 6 | Papéis de banco separados (`owner`/`migrator`/`app`/`readonly`) | §37 | O papel da API não pode ser owner nem ter `BYPASSRLS` |
| 7 | Contexto **transaction-local** e teste obrigatório de reuso de pool | §37, §34 | Variável de sessão sobrevive ao `COMMIT` e vaza entre tenants no pool |
| 8 | Falha fechada sem contexto de tenant | §37, §34 | Ausência de contexto tem de negar acesso, não liberar tudo |
| 9 | `uuid v7` com fábrica única na aplicação | §32, §37, ADR-024 | Evita v4 silencioso e dependência de função inexistente no PostgreSQL 16/17 |
| 10 | Três espaços de numeração formalmente separados | §37 | Identificador técnico, número de OS e número de documento não podem compartilhar série |
| 11 | EPIC-001 expandido para escopo verificável | §39 | O escopo anterior era resumido demais para servir de contrato de implementação |
| 12 | ADR-021 a ADR-025 | §45 | Gerenciador de pacotes, banco de testes, isolamento, identificadores e bloqueio do Supabase remoto |
| 13 | Artefatos de conversão `****` corrigidos | vários | Ruído da conversão HTML → Markdown |

> **BLOQUEIO EXTERNO REGISTRADO**
>
> O projeto Supabase do Aurora **não pôde ser identificado**. A conta autenticada no CLI lista 28 projetos em cerca de 15 organizações, nenhum com nome compatível com Aurora, e nenhum vinculado (`linked: false`). Conforme a regra vigente, nenhuma operação remota foi executada. O desenvolvimento segue integralmente local, com migrations reprodutíveis, prontas para serem aplicadas ao projeto correto assim que o *project ref* for informado. Ver ADR-025 e §46 OQ-16.

## 01. Visão do produto

### O problema

Departamentos de engenharia clínica e empresas prestadoras de manutenção hospitalar administram parques de dezenas de milhares de ativos críticos sob pressão regulatória permanente (ANVISA, RDC 509, NBR 15943, ISO/IEC 17025, ONA). O trabalho real acontece em corredores sem sinal de celular, com o técnico segurando um analisador em uma mão e o celular na outra. O registro desse trabalho é o que sustenta o contrato, a acreditação e a segurança do paciente.

Os sistemas disponíveis hoje no Brasil resolvem o domínio — e a auditoria do Arkmeds mostra que resolvem com profundidade real, especialmente em metrologia. Mas carregam três décadas de dívida: modelos de dados que confundem cliente, unidade, setor e fornecedor na mesma tabela; "estados" que são texto livre e viram 42 rótulos incoerentes; automação que só sabe mandar e-mail; BI terceirizado para fora do produto; e uma interface em que três gerações visuais convivem na mesma sessão.

### A visão

Aurora é a plataforma onde uma equipe de manutenção registra, comprova e melhora o cuidado com ativos críticos — com um modelo de domínio correto, uma experiência que o técnico usa de pé e sem internet, e analytics nativo que transforma o registro em argumento contratual.

### Proposta de valor por público

| Para | Que sofre com | Aurora entrega | Diferente de |
| --- | --- | --- | --- |
| **Prestadora de engenharia clínica** | Provar contratualmente o que executou em 30 hospitais | Conformidade de planos por contrato, SLA medido, portal por cliente, relatórios agendados | Planilhas + PDF montado à mão |
| **Departamento interno de hospital** | Auditoria ONA/JCI e fila de corretivas sem controle | Prontuário completo do ativo, checklists versionados, trilha de auditoria com diff | Sistemas onde o histórico depende de campo de texto livre |
| **Gestor de manutenção** | Não saber onde o backlog trava | Estados com categoria e motivo de espera separados; "tempo por estado" nativo | 42 estados soltos sem semântica |
| **Técnico de campo** | Sem sinal, com as mãos ocupadas, digitando duas vezes | PWA offline-first, QR Code, checklist com foto, assinatura no dedo, sincronização com resolução de conflito visível | App que exige conexão para abrir a OS |
| **Cliente (hospital atendido)** | Não enxergar o que foi feito nos seus equipamentos | Portal com seus ativos, chamados, certificados e indicadores — desenhado, não improvisado por permissões | Portal que é um subconjunto de checkboxes |

### Escopo inicial (vertical de entrada)

Engenharia clínica e manutenção hospitalar, no modo **prestadora multicliente** e no modo **departamento interno**, usando o mesmo produto e o mesmo modelo de dados. Essa é a decisão de escopo mais importante: a auditoria mostrou que os dois modos exercitam quase os mesmos fluxos, e tratá-los como produtos diferentes duplicaria o domínio.

### Mercados futuros

O modelo é deliberadamente agnóstico de vertical: `asset`, `location`, `work_order`, `maintenance_plan` e `checklist` não contêm nada específico de saúde. O que é específico da vertical vive em **catálogos configuráveis** (tipos de local, categorias de ativo, tipos de serviço, tipos de documento) e em **módulos plugáveis** (metrologia, segurança elétrica, qualificação térmica). Mercados adjacentes viáveis sem reescrita: manutenção predial e facilities, frotas leves, laboratórios, indústria de pequeno e médio porte, assistência técnica autorizada.

### Nossos oito compromissos de produto

1. **O estado é uma máquina, não um texto.** Nenhuma transição acontece fora do grafo declarado.
2. **Espera tem motivo separado do estado.** "Aguardando" é um estado; "peça", "aprovação do cliente" e "liberação da sala" são motivos.
3. **Toda ação relevante emite um evento de domínio.** Auditoria, notificação, automação, integração e analytics consomem o mesmo evento.
4. **O offline é requisito, não recurso.** O técnico executa a OS inteira sem rede.
5. **Analytics é nativo.** Nenhuma métrica do produto depende de ferramenta externa.
6. **Papéis prontos primeiro, granularidade depois.** Ninguém deve precisar marcar 138 caixas para começar.
7. **Nada de exclusão silenciosa.** Arquivamento e *soft delete*; histórico de 10 anos não pode quebrar.
8. **Multitenancy no primeiro commit.** Nenhuma tabela de negócio existe sem `organization_id`.

> **NOME DO PRODUTO**
>
> **HIPÓTESE.** "Aurora" é usado neste documento como nome de trabalho, para dar identidade estável às referências (`aurora.app`, prefixos de evento, títulos de tela). Trocar o nome depois não afeta nenhuma decisão técnica aqui.

## 02. Personas

Dez personas (PER-01 a PER-10), derivadas dos cargos reais observados na auditoria (Engenheiro clínico, Engenheira clínica, Engenheiro eletricista, Técnico em Equipamentos Médicos, Técnico de Eletrônica, Gestor administrativo, Coordenação, Enfermeira) e dos dois tipos de conta do sistema de referência.

#### PER-01 · Owner — Proprietário da conta — Ana, sócia da prestadora

**Contexto.** Responde pelo contrato SaaS, pelo faturamento e pela conformidade da empresa. Entra no sistema poucas vezes por semana.

**Precisa.** Ver saúde comercial da operação (receita recorrente × avulsa, contratos a vencer), controlar assentos e faturamento, e ser a única pessoa capaz de excluir a organização ou transferir a titularidade.

**Métrica de sucesso.** Renovação de contratos e margem por cliente.

**Permissões distintivas**

`organization.manage`, `billing.manage`, `member.invite` sem limite, transferência de *ownership*.

#### PER-02 · Gestor — Gestor de manutenção — Anderson, engenheiro clínico responsável técnico

**Contexto.** Assina laudos e certificados com seu CREA. Responde por conformidade regulatória e pelo indicador entregue ao hospital.

**Precisa.** Conformidade de planos por contrato, vencimentos de calibração, backlog por criticidade, custo por ativo, e evidência auditável de tudo. Precisa saber, em uma tela, o que está fora do prazo e por quê.

**Dor atual.** "Tempo por estado" existe como métrica, mas os estados não têm categoria — então a análise de gargalo não fecha.

**Permissões distintivas**

Assinar documentos técnicos, liberar certificados, editar OS fechada, ver custos e indicadores financeiros.

#### PER-03 · Coordenador — Coordenador de campo — Sérgio, supervisor de equipe

**Contexto.** Faz triagem de chamados e distribui trabalho todos os dias, de manhã. É o usuário mais frequente do sistema.

**Precisa.** Fila de solicitações sem responsável, agenda com carga por técnico, arrastar-e-soltar para programar, e um Kanban que reflita a realidade do dia.

**Dor atual.** No sistema de referência há **2.950 serviços não agendados** — exatamente o total de OS ativas. A agenda existe e ninguém usa, porque programar custa mais do que ligar para o técnico.

**Permissões distintivas**

Triar solicitação, atribuir e reatribuir OS, reagendar, aprovar horas.

#### PER-04 · Técnico — Técnico de campo — Rafael, técnico em equipamentos médicos

**Contexto.** 6 a 12 atendimentos por dia, em corredores, UTIs e centros cirúrgicos. Celular na mão, sem sinal em subsolo e em salas blindadas de radiologia.

**Precisa.** Ver o dia dele, abrir a OS lendo o QR do equipamento, executar o checklist, fotografar antes e depois, apontar peças e horas, colher assinatura e fechar — tudo offline, sincronizando depois.

**Não precisa.** De 25 filtros, de Kanban, de relatório e de configuração.

**Permissões distintivas**

Executar apenas as OS atribuídas a ele ou à sua equipe; consumir estoque; criar ativo em campo (com aprovação posterior).

#### PER-05 · Metrologista — Especialista em calibração — Natália, engenheira

**Contexto.** Emite certificados que precisam resistir a auditoria de acreditação. Trabalha com padrões que têm validade própria.

**Precisa.** Cadeia de rastreabilidade íntegra, bloqueio de emissão com padrão vencido, cálculo de incerteza expandida, critério de aceitação e veredito por ponto.

**Permissões distintivas**

Emitir e liberar certificados, gerenciar padrões e perfis de incerteza, aprovar procedimentos metrológicos.

#### PER-06 · Estoque — Almoxarife — Wellington

**Contexto.** A maior causa de OS travada é peça. Na auditoria, **789 OS** estavam em "Aguardando peças".

**Precisa.** Entrada com nota fiscal e lote, reserva vinculada à OS, alerta de mínimo, inventário cíclico e rastreabilidade de quem consumiu o quê.

**Permissões distintivas**

Movimentar estoque, ajustar saldo com justificativa, gerenciar fornecedores.

#### PER-07 · Financeiro — Analista financeiro — Roger, gestor administrativo

**Contexto.** Fatura contratos recorrentes e serviços avulsos; controla o que foi aprovado e o que virou nota.

**Precisa.** Orçamentos por status, medição mensal do contrato, custo real (horas × custo/hora + peças) e faturamento com baixa de estoque.

**Permissões distintivas**

Ver e editar valores, faturar, gerenciar contratos e tabelas de preço.

#### PER-08 · Solicitante — Solicitante do cliente — Marília, enfermeira coordenadora de UTI

**Contexto.** Não é usuária de sistema de manutenção. Entra duas vezes por mês, quando um equipamento falha. Já usa o celular na mão.

**Precisa.** Abrir chamado em menos de 30 segundos (idealmente lendo o QR Code do equipamento), acompanhar, assinar e avaliar.

**Não pode ver.** Custos internos, observações internas, outros clientes, outros setores fora do seu escopo.

**Permissões distintivas**

Criar solicitação, assinar OS, aprovar/reprovar orçamento, avaliar atendimento — sempre restrito às localizações do seu escopo.

#### PER-09 · Gestor do cliente — Contato executivo do hospital — Cláudia, gerência de suprimentos

**Contexto.** Recebe o relatório mensal e decide renovação de contrato. Não abre chamados.

**Precisa.** Painel com disponibilidade, conformidade do plano, SLA cumprido e evolução do custo — sem precisar interpretar o sistema.

**Permissões distintivas**

Ver indicadores e documentos de todo o seu *customer*, sem restrição de setor; sem acesso a dados internos da prestadora.

#### PER-10 · Auditor — Auditor / qualidade — perfil eventual

**Contexto.** Acreditação ONA, auditoria interna, fiscalização. Precisa de leitura ampla e rastreabilidade, sem qualquer poder de escrita.

**Permissões distintivas**

Somente leitura em tudo, incluindo trilha de auditoria e documentos; exportação permitida; nenhuma escrita.

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

## 05. Arquitetura multitenant

### Os cinco níveis, e o que cada um significa

| Nível | Nome técnico | É | Não é | Isolamento |
| --- | --- | --- | --- | --- |
| 0 | **platform** | O Aurora. Toda a instalação. Existe apenas como conceito operacional (nossa equipe, nossos jobs, nosso suporte). | Uma tabela de negócio. | — |
| 1 | **organization** | A conta que assina. Fronteira de isolamento, faturamento, configuração, catálogos e assentos. **É o tenant.** | Um cliente atendido. | `organization_id` em toda tabela de negócio + RLS |
| 2 | **customer** | Quem a organização atende. | Um local. Um fornecedor. | `customer_id` + escopo de membership |
| 3 | **location** | Nó da árvore física do cliente. | Uma pessoa jurídica. | `location_path` (caminho materializado) + escopo |
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

## 06. Clientes e locais

### Customer

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` · `organization_id` | uuid | Tenant obrigatório |
| `name` · `trade_name` | text | `name` obrigatório; único por organização (case-insensitive, sem acento) |
| `code` | text | Código interno opcional, único por organização quando presente |
| `tax_id` | text | CNPJ/CPF; validado por formato, não bloqueante |
| `is_internal` | bool | `true` = a própria organização. No máximo um por organização |
| `status` | enum | `active` · `suspended` · `archived` |
| `segment` | text | Hospital, clínica, laboratório, indústria — livre, para segmentação analítica |
| `billing_*` | — | Endereço, contato financeiro, condição de pagamento padrão |
| `default_sla_policy_id` | uuid | Usada quando não há contrato ativo |
| `logo_asset_key` | text | Marca aplicada aos PDFs e ao portal deste cliente |
| `custom` | jsonb | Campos personalizados (§29) |

**Contatos** ficam em `customer_contacts` (nome, cargo, e-mail, telefone, papel: técnico/financeiro/executivo, `receives_reports`). Um contato pode ou não ter conta no portal — são coisas distintas.

### Location — árvore livre com tipos configuráveis

> **DECISÃO ADR-005**
>
> **A hierarquia não é fixada em código.** `location_types` é um catálogo por organização, e a validação de aninhamento é declarativa: cada tipo declara `allowed_parent_type_ids`. Isso permite Hospital → Unidade → Bloco → Andar → Setor → Sala na saúde e Rede → Filial → Galpão → Rua → Posição em logística, sem tocar no schema. Profundidade máxima configurável (padrão 8) para proteger consultas.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `customer_id` | uuid | Obrigatório. Toda localização pertence a um cliente |
| `parent_id` | uuid | Nulo para raízes. Ciclo é impedido por constraint |
| `location_type_id` | uuid | Deve ser permitido pelo tipo do pai |
| `path` | text | **Materializado**. Recalculado em cascata ao mover subárvore |
| `depth` | int | Derivado; usado para limitar e para indentação de UI |
| `name` · `code` | text | `code` único por cliente quando presente |
| `address` · `geo` | jsonb · point | Endereço herdado do ancestral mais próximo quando vazio |
| `timezone` | text | Herdado do ancestral; usado para SLA e agenda |
| `manager_user_id` | uuid | Responsável operacional |
| `calendar_id` | uuid | Calendário de cobertura (24×7, comercial, plantão) |
| `is_mobile` | bool | Para ambulâncias, viaturas e bases móveis — observadas na referência (SAMU) |
| `status` | enum | `active` · `archived` |
| `custom` | jsonb | Campos personalizados |

#### Regras de árvore

- **Mover subárvore** é operação transacional: recalcula `path` e `depth` de todos os descendentes, reindexa escopos materializados e emite `location.moved`.
- **Arquivar** um local exige que não haja ativo ativo nem OS aberta abaixo dele; caso haja, o sistema oferece a lista e o caminho de transferência.
- **Nunca excluir** local com histórico. Apenas arquivar.
- Um local pode ser marcado `allows_assets = false` (ex.: "Bloco") para impedir que ativos sejam pendurados em níveis intermediários por engano.

### Supplier

Entidade separada, com `name`, `tax_id`, contatos, `categories[]` (peças, calibração externa, assistência autorizada), `is_authorized_service`, condições comerciais e avaliação de desempenho (prazo médio, taxa de retrabalho — Fase 3). Um fornecedor pode ser referenciado por `stock_lots.supplier_id`, `work_orders.outsourced_to_supplier_id` e `documents.external_lab_id`.

### Team

Substitui o "Quadro de trabalho". Campos: `name`, `code`, `calendar_id`, `default_warehouse_id`, `coverage` (lista de `location_path` ou `customer_id`), `lead_user_id`. `team_members` liga usuários com `role_in_team` ∈ `lead` | `member` e `skills[]` (Fase 3, base para sugestão de atribuição).

## 07. Ativos

> **DECISÃO ADR-006**
>
> **`asset` é o conceito universal; "Equipamento" é apenas o rótulo pt-BR da vertical clínica.** Não haverá entidade `equipment`. `organization.asset_label` define o termo exibido ("Equipamento", "Ativo", "Máquina", "Veículo") e é usado em toda a interface, inclusive em mensagens de erro e em títulos de PDF.

### Cadeia de classificação

```

manufacturer  Mindray
      │
      └── asset_model  BeneHeart R3
                │  category = Eletrocardiógrafo
                │  specs padrão (tensão, potência, classe de risco ANVISA…)
                │  procedimentos sugeridos · vida útil de referência
                │  documentação do fabricante (manual, catálogo de peças)
                │
                └── asset  ns FK0C025472 · patrimônio 7737 · UTI II
                          herda specs do modelo, pode sobrescrever campo a campo

```

**Por que isso importa.** Na referência, fabricante e modelo são texto livre — o que impossibilita responder "quantos BeneHeart R3 temos e qual a taxa de falha desse modelo?", que é exatamente a pergunta que justifica troca de fornecedor. Normalizar custa um cadastro e devolve uma dimensão analítica inteira.

**Migração de dados livres:** a importação aceita texto e cria `manufacturer`/`asset_model` sob demanda em estado `unverified`, com uma fila de curadoria para fundir duplicatas ("Lider" × "LIDER" × "Líder").

### Campos do asset

| Grupo | Campos | Notas |
| --- | --- | --- |
| **Identificação** | `tag` · `serial_number` · `asset_number` (patrimônio) · `qr_token` · `barcode` | Três identificadores independentes, como na referência. `qr_token` é opaco e não sequencial. Unicidade configurável por campo (§ regras) |
| **Classificação** | `asset_model_id` → `manufacturer_id`, `asset_category_id` | Modelo opcional para ativos sem catálogo; categoria obrigatória |
| **Localização** | `customer_id` · `location_id` (denormaliza `location_path`) · `parent_asset_id` | Hierarquia pai/filho para conjuntos (ventilador → circuito, torre → câmera) |
| **Situação** | `status` ∈ `active` · `under_maintenance` · `standby` · `loaned` · `decommissioned` · `disposed` | Só `active` e `under_maintenance` contam para disponibilidade |
| **Risco** | `criticality_id` · `operational_risk` · `default_priority` · `risk_class` (I–IV ANVISA) | Criticidade é catálogo com `score` e `sla_multiplier` |
| **Regulatório** | `anvisa_registration` · `inmetro_ordinance` · `requires_calibration` · `requires_electrical_test` | Dirigem quais documentos são exigíveis |
| **Ciclo de vida** | `manufactured_at` · `acquired_at` · `installed_at` · `warranty_until` · `useful_life_years` · `decommissioned_at` | Base de depreciação e de plano de substituição |
| **Financeiro** | `purchase_value` · `residual_value` · `replacement_value` · `currency` | `replacement_value` é novo: alimenta o CMMS ratio sem depender de valor histórico |
| **Contrato** | `ownership` ∈ `owned` · `leased` · `loaned` · `rented` · `service_only` · `contract_id` · `owner_supplier_id` | Substitui os cinco "tipos de contrato" da referência |
| **SLA** | `sla_policy_id` (sobrescreve o do contrato) | Ver §11 para a cascata de resolução |
| **Técnico** | `specs` jsonb (herdado do modelo) · `custom` jsonb | Ver §29 |
| **Operacional** | `notes` · `internal_notes` · `show_on_work_order[]` | `show_on_work_order` reproduz o excelente "Mostrar na OS" da referência: lista de chaves de campo impressas no cabeçalho da OS |

#### Regras de negócio

- **Unicidade configurável.** `organization.asset_unique_fields` ⊂ {tag, serial_number, asset_number} define quais campos não podem repetir. Escopo da unicidade também é configurável: por organização ou por cliente. **Herdado da referência**
- **Transferência de local** é operação registrada (`asset_transfers`), nunca uma simples edição de `location_id`. Motivo: a referência avisa que "OS existentes não poderão ser editadas caso altere o proprietário" — sintoma de que a mudança de dono corrompe o histórico. Aqui, a OS congela `location_snapshot` no momento da abertura.
- **Descomissionar** exige documento de obsolescência ou justificativa, encerra planos ativos daquele ativo no próximo ciclo e emite `asset.decommissioned`.
- **QR Code**: `qr_token` resolve para uma rota pública `/q/{token}` que, sem sessão, oferece "abrir solicitação" (se o cliente permitir chamado anônimo autenticado por e-mail) e, com sessão, abre a ficha ou a OS conforme a permissão.
- **Medidores** (`meters` / `meter_readings`): horas de uso, ciclos de esterilização, quilometragem. Fase 4, mas o modelo entra no MVP para não travar manutenção por condição depois.

### Ficha do ativo — o que a tela deve mostrar

A ficha 360° é o melhor artefato do sistema de referência e deve ser superada, não copiada. Estrutura:

| Faixa | Conteúdo |
| --- | --- |
| **Cabeçalho** | Foto, identificação, categoria, modelo, localização em breadcrumb clicável, situação, criticidade, badges de conformidade (calibração vencida, TSE vencido, garantia ativa, plano atrasado) |
| **Indicadores** | Disponibilidade (12 m), MTTR, MTBF, nº de corretivas, custo acumulado, custo ÷ valor de reposição — cada um com *tooltip da fórmula* e link para o detalhamento |
| **Próximos eventos** | Planos que cobrem este ativo, com data prevista e natureza; vencimentos de documento; garantia |
| **Linha do tempo unificada** | Fluxo único e filtrável misturando OS, documentos, transferências, alterações de campo e comentários — em vez das seis tabelas separadas da referência |
| **Dados** | Abas Técnico · Financeiro · Contrato · Personalizado · Documentos do fabricante |
| **Ações** | Abrir OS · Abrir solicitação · Emitir documento · Transferir · Imprimir etiqueta QR · Descomissionar |

## 08. Solicitações — service_request

> **DECISÃO ADR-002 — A DECISÃO MAIS CONSEQUENTE DESTE DOCUMENTO**
>
> **Adotamos o Modelo B: `service_request` é entidade própria, distinta de `work_order`.** Uma solicitação pode gerar zero, uma ou várias ordens de serviço.

### Comparação formal dos modelos

| Critério | Modelo A — chamado é uma visão da OS | Modelo B — entidade própria | Vence |
| --- | --- | --- | --- |
| **Simplicidade inicial** | Uma tabela, um ciclo de vida, menos telas | Duas tabelas, conversão explícita | **A** |
| **Solicitações recusadas** | Vira "OS cancelada" e polui o denominador de todo indicador de OS | `rejected` vive no funil de solicitações e não contamina MTTR nem backlog | **B** |
| **Duplicidade** | Duas OS para o mesmo problema; fusão destrói uma das OS | `merged_into_id`: a duplicata é preservada, aponta para a original e ambas ficam auditáveis | **B** |
| **Uma solicitação, vários equipamentos** | Impossível sem criar N chamados manualmente | 1 solicitação → N OS, com rastreabilidade de origem | **B** |
| **SLA** | Um único relógio, que mistura "tempo até alguém olhar" com "tempo até consertar" | Relógios distintos: *resposta* na solicitação, *reparo* na OS | **B** |
| **Triagem** | A fila é um filtro de estado sobre 73 mil registros | A fila é uma tabela pequena e naturalmente limitada | **B** |
| **Portal do cliente** | O cliente escreve na mesma tabela que o técnico; toda permissão vira condicional de campo | O cliente só escreve em `service_requests`. Superfície de escrita do portal reduzida a uma tabela | **B** |
| **Auditoria** | A descrição original do solicitante é sobrescrita pelo técnico | O relato do cliente é imutável; o diagnóstico do técnico vive na OS | **B** |
| **Métricas** | "OS criadas" mistura demanda do cliente com trabalho programado | Demanda (solicitações), trabalho (OS) e conversão (taxa) são medíveis separadamente | **B** |
| **Trabalho sem solicitação** | Natural | Também natural: OS pode nascer de plano, de inspeção ou manualmente, com `source` ≠ `request` | empate |
| **Risco** | Baixo | Dupla escrituração se a conversão exigir muitos cliques | mitigado abaixo |

**Mitigação do único ponto fraco do Modelo B.** A conversão é barata por padrão: no *triage*, um botão "Aceitar" cria a OS com todos os campos herdados e mantém as duas telas costuradas — a OS mostra a solicitação de origem no topo, e a solicitação mostra o andamento da OS. Para organizações que não querem triagem, `organization.auto_convert_requests = true` cria a OS automaticamente na criação da solicitação, entregando a ergonomia do Modelo A sobre a estrutura do Modelo B.

### Campos

| Campo | Regra |
| --- | --- |
| `number` | Série própria (`SR-{ano}-{seq}`), separada da série de OS |
| `source` | `portal` · `qr_code` · `phone` · `email` · `walk_in` · `api` · `internal` |
| `requester_user_id` / `requester_name` / `requester_phone` | Usuário do portal quando autenticado; campos livres quando registrado por telefone (a referência já expõe telefone do solicitante na fila — mantemos) |
| `customer_id` · `location_id` · `asset_ids[]` | Ativo é opcional (pode ser pedido de serviço sem ativo); vários ativos permitidos |
| `summary` · `description` | `summary` gerado a partir do sintoma quando o solicitante não escreve título |
| `reported_failure_code_id` | Sintoma escolhido em lista curta e contextual (por categoria do ativo), não em combo de 360 itens |
| `requested_priority` / `priority` | O que o cliente pediu × o que a triagem definiu. Guardar os dois é o que permite medir superestimação de urgência |
| `attachments[]` | Fotos são o anexo dominante; upload direto do celular |
| `status` | Ver máquina abaixo |
| `rejection_reason_id` · `rejection_note` | Catálogo: fora de escopo, não é defeito, duplicada, equipamento de terceiro, uso incorreto |
| `merged_into_request_id` | Preserva duplicatas |
| `triaged_by` · `triaged_at` · `first_response_at` | Alimentam o SLA de resposta |
| `satisfaction_score` · `satisfaction_comment` | 1–5 + texto, como na referência. Pertence à solicitação, não à OS — quem avalia é quem pediu |

### Máquina de estados da solicitação

```

                                    ┌──→ rejected  (terminal, com motivo obrigatório)
                                    │
  draft ──→ submitted ──→ triage ──┼──→ duplicate  (terminal, exige merged_into)
   (rascunho      │           │      │
   do portal)      │           │      └──→ accepted ──→ in_service ──→ fulfilled ──→ closed
                    │           │                     │              │
                    │           └── info_needed ───┘              │
                    │                (aguardando o solicitante)      │
                    └──────────────→ cancelled ←──────────────────┘
                                     (pelo solicitante, até in_service)

```

| Estado | Significado | Quem move | Efeitos |
| --- | --- | --- | --- |
| `draft` | Rascunho não enviado | Solicitante | Nenhum relógio |
| `submitted` | Recebida, sem responsável | Sistema | **Inicia SLA de resposta**; emite `service_request.created`; notifica a fila da equipe de cobertura |
| `triage` | Alguém assumiu a análise | Coordenador | Registra `first_response_at`; **pausa nada** — o relógio de resposta só para em `accepted`/`rejected` |
| `info_needed` | Falta informação do solicitante | Coordenador | **Pausa SLA de resposta**; notifica solicitante; retomada automática na resposta |
| `accepted` | Vai virar trabalho | Coordenador | **Encerra SLA de resposta**; cria 1..N `work_order`; emite `service_request.accepted` |
| `in_service` | Ao menos uma OS em andamento | Sistema | Derivado das OS filhas; visível no portal |
| `fulfilled` | Todas as OS concluídas | Sistema | Dispara pedido de avaliação e, se configurado, de assinatura |
| `closed` | Encerrada para o cliente | Sistema ou coordenador | Automático após avaliação ou após N dias (configurável) |
| `rejected` | Não vira trabalho | Coordenador | Motivo obrigatório; notifica solicitante com justificativa |
| `duplicate` | Já existe solicitação equivalente | Coordenador | `merged_into_request_id` obrigatório; o solicitante passa a acompanhar a original |
| `cancelled` | Desistência | Solicitante ou coordenador | Permitido até `in_service`; depois, só cancela a OS |

### Detecção de duplicidade

Na submissão, o sistema busca solicitações abertas dos últimos *N* dias (padrão 7) com o mesmo `asset_id` ou o mesmo `location_id` + `failure_code`, e exibe ao solicitante: *"Já existe uma solicitação aberta para este equipamento (SR-2026-0481, aberta há 2 dias). Deseja acompanhar essa ou abrir uma nova?"*. Não bloqueia — apenas informa. Regra derivada diretamente da auditoria, onde dois chamados idênticos do mesmo solicitante para o mesmo DEA aparecem em sequência na fila.

## 09. Ordens de serviço

A OS é o agregado raiz do domínio SERVICE. Tudo que a organização vende, mede, fatura e comprova passa por ela. Esta seção define o registro; a §10 define seu comportamento.

### Origem

| `source` | Como nasce | Campos herdados |
| --- | --- | --- |
| `request` | Aceite de uma solicitação | cliente, local, ativo, sintoma, prioridade, anexos, solicitante |
| `plan` | Geração automática de um ciclo de plano | plano, tarefa, natureza, procedimento, equipe, janela do ciclo |
| `manual` | Criação direta por staff | — |
| `inspection` | Item de checklist reprovado em outra OS gera OS derivada | OS de origem, ativo, item reprovado **novo** |
| `quote` | Orçamento aprovado que exige execução adicional | orçamento, itens aprovados |
| `api` / `automation` | Integração ou regra de automação | conforme payload |
| `mobile` | Criada em campo pelo técnico, inclusive offline | local por GPS/QR, técnico como executor |

### Campos

| Grupo | Campos | Regra |
| --- | --- | --- |
| **Identidade** | `number` · `organization_id` · `source` · `service_request_id` · `plan_cycle_id` · `parent_work_order_id` | `number` vem de `number_series`, gerado transacionalmente, imutável após emissão de documento |
| **Classificação** | `work_order_type_id` · `priority` · `criticality_id` | Prioridade herda do ativo e pode ser sobrescrita com registro de quem mudou |
| **Sujeito** | `customer_id` · `location_id` · `asset_id` · `location_snapshot` · `asset_snapshot` | **Snapshots congelados** na abertura: nome do local, TAG, série, patrimônio, modelo. Impede que transferência futura reescreva o histórico |
| **Estado** | `status_id` · `wait_reason_id` · `status_changed_at` · `substatus_note` | `wait_reason_id` obrigatório quando a categoria do estado é `waiting` |
| **Atribuição** | `team_id` · `assignee_user_id` · `assignees[]` · `outsourced_to_supplier_id` | `assignee_user_id` é o responsável; `assignees[]` são executores adicionais |
| **Responsabilidade técnica** | `technical_manager_user_id` | Quem assina tecnicamente. Pode diferir do executor. Exigido para documentos regulados |
| **Tempo** | `opened_at` · `scheduled_start` · `scheduled_end` · `started_at` · `completed_at` · `closed_at` · `due_at` | `due_at` é derivado do SLA; nunca editado à mão sem permissão |
| **Conteúdo** | `summary` · `reported_description` · `diagnosis` · `resolution` | `reported_description` é cópia imutável do relato; `diagnosis` e `resolution` são do técnico |
| **Falha** | `reported_failure_code_id` · `cause_failure_code_id` · `action_code_id` | Trinca sintoma → causa → ação. É o que torna possível análise de causa raiz |
| **Financeiro** | `contract_id` · `billable` · `labor_cost` · `parts_cost` · `travel_cost` · `outsourced_cost` · `total_cost` | Custos são **derivados e materializados** no fechamento; nunca digitados |
| **Notas** | `internal_notes` · `customer_notes` | Separação explícita. `internal_notes` nunca sai em PDF do cliente nem aparece no portal |
| **Extensão** | `custom` jsonb | Definições por organização e por natureza de OS |

### Coleções filhas

| Coleção | Conteúdo | Regra |
| --- | --- | --- |
| `work_order_assignees` | usuário, papel (executor, apoio, aprendiz) | Notificação individual por atribuição |
| `time_entries` | usuário, início, fim, minutos, tipo (`labor`, `travel`, `waiting`), nota, `cost_snapshot` | Cronômetro no PWA ou lançamento manual. `cost_snapshot` congela o custo/hora vigente. Lançamento futuro só com permissão (a referência tem exatamente essa preferência) |
| `work_order_parts` | item, quantidade, lote, almoxarifado, preço, `status` ∈ `requested` · `reserved` · `consumed` · `returned` | Consumo gera `stock_movement`; devolução gera movimento inverso |
| `work_order_services` | item do catálogo, quantidade, preço, garantia | Base do orçamento e do faturamento |
| `checklist_responses` | execução de checklist, com versão congelada | Ver §14 |
| `work_order_comments` | autor, corpo, `visibility` ∈ `internal` · `customer`, menções, anexos | **Novo em relação à referência.** Substitui o WhatsApp |
| `attachments` | foto, documento, áudio | `purpose` ∈ `before` · `after` · `evidence` · `document` · `signature` |
| `signatures` | nome, documento, papel, imagem, código de validação, hash do conteúdo assinado | Até duas por OS (executor e cliente), configurável |
| `custody_protocols` | recolhimento, entrega, serviço | Herdado da referência; usado quando o ativo sai do setor |
| `sla_clocks` | um por alvo (resposta, início, resolução) | Ver §11 |
| `status_history` | de, para, motivo, ator, timestamp, duração no estado anterior | Fonte da métrica "tempo por estado" |

### Naturezas de OS (`work_order_type`)

Catálogo por organização, mas com `system_key` obrigatório para as naturezas que alimentam indicadores. O `system_key` é o que permite calcular "preventiva × corretiva" mesmo quando a organização renomeia tudo.

| `system_key` | Rótulo padrão | Efeitos automáticos |
| --- | --- | --- |
| `corrective` | Manutenção corretiva | Conta como falha para MTBF; exige sintoma; conta tempo de parada |
| `preventive` | Manutenção preventiva | Não conta como falha; alimenta conformidade de plano |
| `predictive` | Manutenção preditiva | Não conta como falha |
| `calibration` | Calibração | Habilita emissão de certificado de calibração; exige padrões |
| `electrical_safety` | Teste de segurança elétrica | Habilita certificado de TSE |
| `qualification` | Qualificação | Habilita laudo de qualificação térmica |
| `inspection` | Inspeção / ronda | Checklist obrigatório; pode gerar OS derivadas |
| `installation` | Instalação | Pode alterar `asset.installed_at` |
| `decommission` | Descomissionamento | Exige laudo de obsolescência; muda situação do ativo |
| `training` | Treinamento | Não conta tempo de parada |
| `logistics` | Movimentação / empréstimo / devolução | Vincula transferência de ativo |
| `other` | Outro | Neutro nos indicadores |

**O que sai do catálogo de naturezas:** "Rodas travadas", "Teclado com defeito" (viram `failure_code`), "Locação", "Venda de produto/serviço" (viram itens do `service_catalog`), "Garantia Magnamed" (vira `work_order.warranty_claim = true` + `supplier_id`).

### Impressão e PDF

Um template por natureza e por organização, versionado. Configurável por organização, herdado da referência: imprimir tabela de horas, imprimir checklist vazio, imprimir anexos, imprimir peças reservadas, imprimir registros automáticos, rótulo da coluna de valor do checklist, campo extra. Toda impressão registra `document.printed` com ator e destino.

## 10. Máquina de estados da OS

> **DECISÃO ADR-003**
>
> **Situação e motivo de espera são dimensões separadas.** A referência tem 42 estados porque codificou o motivo dentro do estado: "Aguardando peças", "Aguardando aprovação do orçamento", "Aguardando liberação da unidade", "Aguardando empresa externa", "Aguardando NF para envio"… Ao separar, os 42 viram **9 situações** e **~14 motivos**, e o produto ganha três coisas de graça: (a) pausa de SLA decidida pelo motivo, não pelo nome do estado; (b) a métrica "tempo por motivo de espera" — que responde *"onde meu backlog trava?"* — passa a existir; (c) o Kanban tem 9 colunas legíveis em vez de 42.

### Categorias — fixas na plataforma, nunca editáveis

| `status_category` | Semântica | Ativa? | SLA de resolução | Parada do ativo |
| --- | --- | --- | --- | --- |
| `draft` | Ainda não é trabalho | não | não iniciado | não |
| `open` | Trabalho reconhecido, sem execução | sim | correndo | conforme natureza |
| `scheduled` | Programado com data e responsável | sim | correndo | conforme natureza |
| `in_progress` | Execução em curso | sim | correndo | sim |
| `waiting` | Bloqueado por dependência externa | sim | **depende do motivo** | sim |
| `review` | Executado, aguardando validação interna ou assinatura | sim | parado | não |
| `done` | Concluído tecnicamente | não | encerrado | não |
| `closed` | Encerrado administrativamente (imutável) | não | encerrado | não |
| `cancelled` | Não será executado | não | descartado | não |

### Situações padrão de fábrica

A organização pode renomear, recolorir, reordenar e **acrescentar** situações — mas toda situação nova declara obrigatoriamente uma categoria. Situações com `is_system = true` não podem ser removidas.

| Chave | Rótulo | Categoria | Significado | Entrada típica | Saída típica |
| --- | --- | --- | --- | --- | --- |
| `draft` | Rascunho | draft | Criada e não publicada; inclui OS vinda de sincronização offline pendente de revisão | criação manual/mobile | publicar |
| `open` | Aberta | open | Na fila, sem responsável ou sem data | aceite de solicitação, geração de plano | atribuir / agendar |
| `scheduled` | Agendada | scheduled | Tem responsável e janela | agendamento | iniciar |
| `in_progress` | Em execução | in_progress | Técnico trabalhando; cronômetro pode estar ativo | iniciar atendimento | pausar / concluir |
| `waiting` | Aguardando | waiting | Bloqueada — **o motivo diz por quê** | bloqueio | desbloquear |
| `paused` | Pausada | waiting | Interrupção sem dependência externa (fim de turno, prioridade maior) | pausa do técnico | retomar |
| `completed` | Concluída | review | Trabalho técnico terminado, aguardando validação e/ou assinatura | concluir | validar / reprovar |
| `validated` | Validada | done | Aprovada internamente; pronta para faturar e para o cliente | validação | fechar |
| `closed` | Fechada | closed | Encerrada. Somente leitura, salvo permissão especial | fechamento | reabrir (com permissão) |
| `cancelled` | Cancelada | cancelled | Não executada; motivo obrigatório | cancelamento | — |

### Motivos de espera padrão

| Chave | Rótulo | Pausa SLA? | Responsável pela liberação | Substitui na referência |
| --- | --- | --- | --- | --- |
| `parts` | Aguardando peça | não ^1 | Estoque / Compras | Aguardando peças (789) · Aguardando chegada das peças (44) · AGUARDANDO PRODUTO · PEÇA DISPONÍVEL P/ COLETA |
| `quote_approval` | Aguardando aprovação de orçamento | **sim** | Cliente | Aguardando aprovação do orçamento (175) · Orçamento Reprovado (128) |
| `quote_preparation` | Aguardando elaboração de orçamento | não | Interno | Análise concluída — Gerar orçamento (328) · Aguardando envio do orçamento (106) |
| `customer_response` | Aguardando o cliente | **sim** | Cliente | Aguardando liberação da unidade · Aguardando Liberação do setor |
| `asset_release` | Aguardando liberação do equipamento | **sim** | Cliente | Equipamento parado para manutenção |
| `external_service` | Em serviço externo | não | Fornecedor | Reparo externo (182) · MANUTENÇÃO EXTERNA (45) · Aguardando empresa externa · CALIBRAÇÃO EXTERNA |
| `external_quote` | Aguardando orçamento do fornecedor | não | Fornecedor | Aguardando orçamento pelo fornecedor · Encaminhado para Orçamento Externo |
| `warranty` | Em acionamento de garantia | não | Fornecedor | VERIFICANDO ACIONAMENTO DE GARANTIA |
| `internal_approval` | Aguardando aprovação interna | não | Interno | Aguardando aprovação interna |
| `scheduling` | Aguardando janela de agendamento | **sim** | Cliente | Atendimento programado |
| `transport` | Em deslocamento / transporte | não | Interno | EM DESLOCAMENTO |
| `documentation` | Aguardando documento fiscal | não | Interno | Aguardando NF para envio |
| `calibration` | Aguardando calibração | não | Interno | Aguardando Calibração |
| `unrepairable` | Sem reparo viável | **sim** | Gestor | Equipamento Sem Reparo (232) |

^1 **Decisão deliberada:** falta de peça é responsabilidade da organização, não do cliente — o relógio de resolução continua correndo. A organização pode inverter isso por política (`wait_reason.pauses_sla` é configurável), mas o padrão de fábrica não perdoa o próprio atraso. Regra geral: **pausa o SLA apenas quando a dependência é do cliente ou de terceiro por decisão do cliente.**

### Tabela de transições

| De | Para | Guarda / campos obrigatórios | Permissão | Efeitos colaterais |
| --- | --- | --- | --- | --- |
| draft | open | cliente, local, natureza e (se natureza exige ativo) ativo | `work_order.update` | Gera `number`; **inicia SLA**; evento `work_order.opened`; notifica equipe de cobertura |
| open | scheduled | `assignee_user_id` ou `team_id`, `scheduled_start` | `work_order.assign` | Cria entrada de agenda; notifica executor; evento `work_order.scheduled` |
| open · scheduled | in_progress | executor é o usuário atual ou tem `work_order.execute_any` | `work_order.execute` | Grava `started_at`; **encerra SLA de início**; abre `time_entry` se cronômetro automático; ativo → `under_maintenance` se a natureza causa parada; evento `work_order.started` |
| in_progress | waiting | `wait_reason_id` **obrigatório**; nota obrigatória se motivo = `other` | `work_order.execute` | Fecha `time_entry` aberta; pausa SLA se o motivo assim determinar; evento `work_order.blocked`; notifica o responsável pela liberação |
| waiting | in_progress | — | `work_order.execute` | Retoma SLA; evento `work_order.unblocked` |
| in_progress | paused | — | `work_order.execute` | Fecha `time_entry`; SLA continua |
| in_progress | completed | **Bloco de conclusão** (ver abaixo) | `work_order.complete` | Grava `completed_at`; **encerra SLA de resolução**; calcula custos; ativo volta a `active`; solicita assinatura se exigida; evento `work_order.completed` |
| completed | in_progress | motivo da reprovação obrigatório | `work_order.validate` | Reabre SLA de resolução; notifica executor; evento `work_order.rework_requested` |
| completed | validated | assinaturas exigidas presentes; documentos obrigatórios emitidos | `work_order.validate` | Evento `work_order.validated`; libera faturamento; libera visibilidade no portal |
| validated | closed | — | `work_order.close` | Congela o registro; consolida fatos analíticos; dispara pesquisa de satisfação na solicitação de origem; evento `work_order.closed` |
| closed | in_progress | justificativa obrigatória | `work_order.reopen` | Cria nova revisão; mantém histórico; evento `work_order.reopened`; recalcula fatos |
| qualquer ativo | cancelled | motivo obrigatório | `work_order.cancel` | Libera reservas de peça; cancela agenda; descarta SLA; evento `work_order.cancelled` |

#### Transições proibidas — explicitamente

- `draft → completed`, `open → closed`, `waiting → completed`: não se conclui o que não foi executado nem desbloqueado.
- `cancelled → *`: cancelamento é terminal. Retomar exige nova OS, que herda o histórico por `parent_work_order_id`.
- `closed → closed` ou qualquer edição de OS fechada sem `work_order.edit_closed`.
- Transição para `waiting` sem `wait_reason_id`: rejeitada na camada de domínio **e** por constraint no banco.

#### Bloco de conclusão — o guarda mais importante do sistema

Ao concluir, o sistema valida um conjunto configurável por **natureza de OS** (`work_order_type.completion_requirements`):

```gherkin
GIVEN uma OS em in_progress de natureza preventive
AND  a natureza exige: checklist completo · ao menos 1 h apontada · resolução preenchida · foto "depois"
WHEN  o técnico solicita a conclusão
THEN  o sistema verifica cada requisito
AND   se algum falhar, retorna a lista nomeando o que falta e onde — nunca "Erro!"
AND   se todos passarem, muda para completed, grava completed_at e ator
AND   emite work_order.completed com o payload da OS

```

Requisitos disponíveis: checklist obrigatório completo · nenhum item de checklist reprovado sem foto de evidência · horas apontadas > 0 · `resolution` preenchida · `cause_failure_code_id` preenchido · foto antes e depois · assinatura do cliente · peças consumidas confirmadas · documento obrigatório emitido (ex.: certificado para natureza `calibration`).

#### Validação — quando existe e quando não

`organization.requires_validation` ∈ `never` · `always` · `by_type` · `by_criticality`. Quando `never`, a transição `completed → validated` é automática e invisível — o produto não impõe burocracia a quem não a quer, mas o estado existe no modelo para que ligá-la depois não seja migração.

### Kanban derivado da máquina

```

 Aberta        Agendada      Em execução    Aguardando            Concluída     Validada
   12            34             8         ┌── peça          19      6            21
                                          ├── orç. cliente   7
  colunas = situações visíveis           ├── externo        4
  arrastar = executar transição         └── liberação      3
  solto inválido = recusado com o motivo   agrupamento secundário por motivo

```

## 11. SLA

A referência coloca `tempo_atendimento` e `tempo_fechamento` em minutos **no equipamento** e mede "% de chamados cumpridos dentro do prazo". É um começo correto, mas não suporta contrato, horário comercial nem feriado. Aqui o SLA é um objeto de primeira classe.

### Estrutura

```

sla_policy   nome · calendar_id · timezone_source
    │
    └── sla_target  (uma linha por prioridade × tipo de alvo)
             priority ∈ emergency · very_urgent · urgent · low · none
             kind     ∈ response · onsite · resolution
             duration_minutes
             business_hours_only  (bool)

calendar  janelas semanais + exceções
    └── calendar_exception  feriado, plantão especial, parada programada

```

### Cascata de resolução — qual política vale

| # | Origem | Vence quando |
| --- | --- | --- |
| 1 | `asset.sla_policy_id` | O ativo tem política própria (equipamento crítico com acordo específico) |
| 2 | `contract.sla_policy_id` do contrato que cobre o ativo | Existe contrato ativo cobrindo o ativo na data de abertura |
| 3 | `customer.default_sla_policy_id` | Cliente tem padrão |
| 4 | `organization.default_sla_policy_id` | Sempre existe — é criada no onboarding |

A política resolvida é **congelada** na OS (`sla_policy_snapshot`) no momento da abertura. Trocar o contrato amanhã não pode reescrever se o atendimento de ontem cumpriu ou não o prazo.

### Os três relógios

| Alvo | Mede | Inicia | Encerra | Documento |
| --- | --- | --- | --- | --- |
| `response` | Tempo até alguém assumir | `service_request.submitted` | `service_request.triage` (primeiro contato humano) | Solicitação |
| `onsite` | Tempo até o técnico começar | `work_order.opened` | `work_order.started` | OS |
| `resolution` | Tempo até o problema resolvido | `work_order.opened` | `work_order.completed` | OS |

### Ciclo do relógio

| Evento | Efeito |
| --- | --- |
| Abertura | Cria `sla_clock` por alvo; calcula `due_at` aplicando calendário, fuso do local e feriados |
| Entrada em `waiting` com motivo que pausa | Fecha um `sla_pause` aberto; acumula tempo pausado; recalcula `due_at` |
| Saída de `waiting` | Encerra a pausa; retoma contagem |
| Fora do calendário | O relógio não corre em horário não coberto; `due_at` "pula" para a próxima janela útil |
| 80 % do prazo | Evento `sla.warning` → notificação ao responsável e ao coordenador |
| 100 % do prazo | Evento `sla.breached` → notificação com escalonamento; marca `breached_at` |
| Conclusão | Fecha o relógio; grava `met` (bool), `elapsed_business_minutes` e `paused_minutes` |
| Reabertura de OS fechada | Abre um **novo** relógio de resolução; o anterior permanece para histórico. Reincidência é medida por isso |
| Mudança de prioridade | Recalcula `due_at` com o novo alvo, **a partir do início original**; registra o recálculo na trilha |

#### Regras que evitam armadilhas conhecidas

- **Todo cálculo em minutos úteis**, nunca em horas corridas, quando `business_hours_only = true`. Armazenar sempre os dois (`elapsed_minutes` e `elapsed_business_minutes`) para não precisar recalcular histórico ao mudar calendário.
- **Fuso vem do local**, não da organização. Uma prestadora de Belo Horizonte atendendo uma base em Manaus precisa disso.
- **Feriado municipal** é exceção de calendário associável a uma subárvore de locais.
- **Sem política = sem relógio.** Nunca inventar prazo. Se a organização não configurou, a OS não tem `due_at` e não entra em nenhum indicador de SLA — melhor um denominador honesto do que uma meta fictícia.

## 12. Planos de manutenção preventiva

O modelo de plano da referência é bom: ciclos, janela, progresso, conformidade, geração automática. Corrigimos três limitações reais: frequência única por plano, flags fixas de serviço (P/C/E) e ausência de gatilho por uso.

### Estrutura em quatro níveis

```

maintenance_plan          "Preventiva HNSC — UTI 2"
   nome · cliente · contrato · equipe responsável · ativo/inativo
   política de geração · janela de tolerância · descrição
   │
   ├── plan_task            o que fazer, em que ritmo, sobre quem
   │      target: asset | asset_category | location_subtree | saved_view
   │      work_order_type_id  (preventive · calibration · electrical_safety …)
   │      procedure_id        (traz os checklists)
   │      trigger: calendar | meter | condition
   │      frequency + interval  (dia · semana · mês · trimestre · … · quadriênio)
   │      lead_time_days · tolerance_days · estimated_duration_min
   │      default_team_id · default_assignee_id · required_parts[]
   │
   ├── plan_cycle           uma instância temporal
   │      seq · starts_at · ends_at · status · expected_count · done_count
   │
   └── plan_cycle_item      um trabalho previsto do ciclo
          plan_task_id · asset_id · due_at · work_order_id (quando materializado)
          status ∈ pending · generated · done · skipped · overdue

```

> **CORREÇÃO ESTRUTURAL Nº 1**
>
> **Frequência é da tarefa, não do plano.** Na referência, para ter preventiva semestral e calibração anual no mesmo equipamento é preciso criar dois planos — e o tenant auditado tem **826 planos**, muitos deles duplicatas do mesmo escopo com natureza diferente ("CEPAI — PLANO DE PREV/CAL — BALANÇA", "CEPAI — PLANO DE PREV/CAL/TSE — CARDIOVERSOR"). Com `plan_task`, um plano por setor cobre tudo.

> **CORREÇÃO ESTRUTURAL Nº 2**
>
> **Alvo é uma expressão, não uma lista de checkboxes.** As flags P/C/E são substituídas por alvos declarativos: "todos os ativos da categoria *Ventilador pulmonar* na subárvore *UTI*". Um ativo novo que entre nesse escopo passa a ser coberto automaticamente no próximo ciclo — sem ninguém marcar caixa. A lista explícita de ativos continua disponível como tipo de alvo, para casos que exigem controle manual.

### Geração de ciclo e de OS

```gherkin
GIVEN um plano ativo com auto_generate = true
WHEN  o job diário detecta que hoje >= próximo_ciclo.starts_at - lead_time_days
THEN  cria plan_cycle com janela calculada
AND   resolve cada plan_task contra seu alvo, produzindo os plan_cycle_item
AND   materializa uma work_order por item, em situação open
AND   emite plan.cycle_started e um work_order.opened por OS
AND   notifica o responsável pelo plano com o resumo "N OS geradas"

```

- **Ativos incluídos após o início do ciclo** entram só no ciclo seguinte, salvo se `include_late_assets = true`. Comportamento herdado de uma preferência que a referência acertou.
- **Ativos descomissionados ou arquivados** são excluídos da resolução do alvo. Se já havia OS gerada, ela é cancelada automaticamente com motivo `asset_decommissioned`.
- **Ciclo anterior incompleto**: as OS pendentes não são apagadas. Ficam marcadas `overdue` e continuam contando contra a conformidade histórica. Ver §42.
- **Geração manual**: sem `auto_generate`, o ciclo cria apenas os `plan_cycle_item` (previsão), e o coordenador materializa as OS em lote quando quiser.

### Conformidade

| Situação do item | Definição |
| --- | --- |
| **Em dia, não iniciada** | `due_at` no futuro e OS ainda em `open`/`scheduled` |
| **Em dia, iniciada** | `due_at` no futuro e OS em execução ou além |
| **Atrasada, não iniciada** | `due_at` passado + tolerância e OS não iniciada |
| **Atrasada, iniciada** | `due_at` passado e OS iniciada |
| **Concluída** | OS em `done`/`closed` |
| **Dispensada** | `skipped` com justificativa registrada (ativo em empréstimo, sala interditada) |

**Taxa de conformidade do ciclo** = concluídas ÷ (previstas − dispensadas). A tolerância (`tolerance_days`) evita que uma preventiva executada com um dia de atraso conte como não conformidade — algo que na prática destrói a credibilidade do indicador.

### Gatilhos por uso e por condição

**Fase 4** `plan_task.trigger = meter` dispara quando `meter_reading.value − last_service_value ≥ interval` (horas de ventilação, ciclos de autoclave, quilometragem). `trigger = condition` dispara por regra de automação (ex.: três corretivas do mesmo sintoma em 90 dias). O modelo entra no MVP; a execução é posterior.

## 13. Agenda

Na referência há 2.950 serviços não agendados — a agenda existe e não é usada. O diagnóstico é ergonômico: programar custa mais do que ligar para o técnico. A meta desta seção é tornar a programação mais barata do que a ligação.

### Superfície única, três lentes

| Lente | Para quem | Eixo |
| --- | --- | --- |
| **Calendário** | Coordenador | Tempo (dia/semana/mês) |
| **Recursos** | Coordenador | Técnico ou equipe × tempo, com carga e capacidade |
| **Lista** | Coordenador e gestor | Tabela filtrável do que está por agendar |

Painel lateral persistente com três baldes: **Atrasadas** · **Não agendadas** · **Reagendar** (OS cuja janela foi invalidada). Arrastar de qualquer balde para o calendário agenda; arrastar de volta desagenda.

### Modelo

Não existe entidade "agendamento" separada. A programação vive na própria OS (`scheduled_start`, `scheduled_end`, `assignee_user_id`, `team_id`), e a agenda é uma **projeção**. **DECISÃO ADR-011** — justificativa: um evento de agenda que existe fora da OS gera duas fontes de verdade e a necessidade de sincronizá-las; a referência já faz isso corretamente e não há motivo para divergir.

Exceção: `availability_blocks` é entidade própria — férias, treinamento, atestado, reunião, bloqueio de sala. Não é OS e não deve virar uma.

### Capacidade e conflito

| Regra | Comportamento |
| --- | --- |
| Jornada | `user.daily_hours` × calendário da equipe define a capacidade diária. A barra de carga mostra ocupação em % e fica vermelha acima de 100 % |
| Sobreposição | Aviso, não bloqueio. Duas OS no mesmo horário é legítimo em ronda; três não é. O sistema informa, o humano decide |
| Férias e ausências | **Bloqueio** em `vacation` e `leave` — a pessoa não está disponível de forma alguma. **Aviso** em `training` e `other`: há compromisso, mas a pessoa está presente e o coordenador pode decidir o contrário |
| Fora do calendário do local | Aviso com o motivo ("UTI só libera equipamento entre 14 h e 16 h") |
| Deslocamento | **Fase 3** Sugestão de agrupamento por local: "mais 6 preventivas pendentes neste mesmo setor — agendar juntas?" |

### Reagendamento e notificação

Toda mudança de `scheduled_start` emite `work_order.rescheduled` com valores anterior e novo, notifica o executor e — se o cliente tem visibilidade de agenda e a mudança é maior que *N* horas — notifica também o solicitante. Reagendamentos são contados por OS: mais de três é sinal operacional exibido ao coordenador.

## 14. Motor de checklists

A referência guarda o checklist como um array JSON de `{tipo, desc, appr[]}` — simples e barato, mas impossível de versionar, de consultar e de agregar. Aqui o checklist é relacional e versionado, porque a resposta de um checklist é evidência regulatória.

### Modelo

```

checklist_template   título · versão · status(draft|published|archived) · categoria
   └── checklist_section   agrupamento visual (Inspeção física · Testes elétricos · Testes funcionais)
          └── checklist_item
                 kind · label · help_text · required · position
                 options[] · min · max · unit · expected_value · tolerance
                 requires_photo_when ∈ never | always | on_fail
                 fail_action ∈ none | flag | block_completion | create_work_order
                 condition  (mostrar se item X = valor Y)

procedure  →  N checklist_template  +  natureza de OS  +  categoria de ativo  +  padrões exigidos

checklist_response   work_order_id · template_id · template_version · started_at · finished_at
   └── checklist_answer   item_id · value · verdict(pass|fail|na) · photo_ids[] · measured_by · measured_at

```

### Tipos de campo

| `kind` | Uso | Validação | MVP |
| --- | --- | --- | --- |
| `text` | Observação livre | tamanho máximo | ✔ |
| `number` | Medição | `min`/`max`; veredito automático fora da faixa | ✔ |
| `boolean` | Sim/Não | valor esperado | ✔ |
| `option` | Aprovado/Reprovado/NA e listas curtas | opções com veredito associado | ✔ |
| `multi_option` | Múltipla escolha | mín./máx. de seleções | ✔ |
| `photo` | Evidência obrigatória | quantidade mínima | ✔ |
| `date` | Data de validade de insumo, por exemplo | intervalo | ✔ |
| `signature` | Assinatura dentro do checklist | — | Comercial |
| `measurement` | Medição com padrão, unidade e incerteza | vincula `standard_id` | Fase 2 |
| `auto_test` | Resultado importado de analisador | somente leitura para o técnico | Fase 4 |

### Regras

- **Versionamento imutável.** Publicar cria uma versão nova; respostas antigas continuam apontando para a versão que foi usada. Editar um template publicado é impossível — só criar a próxima versão.
- **Lógica condicional**: um item pode depender da resposta de outro. Itens ocultos não são obrigatórios e não entram no cálculo de completude.
- **Veredito automático**: para `number`, valor fora de `[min, max]` marca `fail` e, conforme `fail_action`, exige foto, bloqueia a conclusão ou gera uma OS corretiva derivada — mecanismo que transforma a ronda em geradora de demanda, algo que a referência não faz.
- **Resolução automática**: ao abrir uma OS, o sistema busca os procedimentos aplicáveis por (natureza × categoria do ativo × ativo específico × local) e anexa seus checklists. Comportamento herdado e confirmado na documentação pública da referência.
- **Offline**: o template inteiro, com opções e faixas, é sincronizado para o dispositivo; respostas e fotos ficam na fila de saída.
- **Impressão**: configurável — imprimir vazio, template alternativo para preenchimento à mão, ocultar coluna de avaliação, renomear a coluna de valor. Todas herdadas da referência.

## 15. Estoque

Falta de peça é a maior causa de OS travada — 789 registros na referência. O estoque não é módulo acessório: é o desbloqueador do fluxo principal.

### Modelo

```

inventory_item   sku · nome · categoria · unidade · fabricante · código do fabricante
                   modelo · imagem · tracking ∈ none | lot | serial
                   is_stockable · min_qty (por almoxarifado) · lead_time_days
   │
   ├── customer_item_alias   nomenclatura e preço de venda por cliente  (herdado da referência)
   │
   ├── stock_lot       almoxarifado · lote · NF · fornecedor · validade · custo unitário · qty_on_hand
   │
   ├── stock_balance   projeção materializada: item × almoxarifado → on_hand · reserved · available
   │
   └── stock_movement  livro-razão imutável
             kind ∈ receipt | issue | adjustment | transfer_out | transfer_in
                    | consumption | return | scrap
             qty (com sinal) · lot_id · unit_cost
             ref_type/ref_id (work_order · quote · transfer · count)
             actor · reason · created_at

```

### Almoxarifados

Novo em relação à referência, que segrega estoque apenas por "Quadro de trabalho". `warehouse.kind` ∈ `central` · `satellite` (posto avançado no hospital) · `van` (carro do técnico) · `consignment` (consignado do fornecedor). O carro do técnico como almoxarifado é o que permite apontar consumo em campo com saldo correto.

### Regras

| Regra | Comportamento |
| --- | --- |
| **Saldo negativo** | Proibido por padrão. `warehouse.allow_negative` pode liberar, e cada movimento que gere negativo exige justificativa e emite `stock.negative_balance` |
| **Reserva** | Reservar em uma OS reduz `available` e não `on_hand`. Cancelar a OS libera a reserva automaticamente |
| **Consumo** | Ocorre na conclusão da OS ou no apontamento do técnico, gerando movimento com `ref = work_order` |
| **Custo** | Média móvel ponderada por almoxarifado. FIFO por lote quando `tracking = lot`. O custo do movimento é congelado no momento da saída |
| **Devolução** | Peça não usada volta ao lote de origem quando rastreado; senão, entra como ajuste positivo com referência à OS |
| **Estoque mínimo** | Por item × almoxarifado. Cruzar o mínimo emite `stock.below_minimum` — evento consumido por automação, não uma "automação" fixa como na referência |
| **Inventário cíclico** | `stock_counts` com contagem às cegas, divergência calculada e ajuste em lote com aprovação. **Fase 3** |
| **Nunca excluir movimento** | Correção é sempre um movimento inverso com referência ao original |

## 16. Orçamentos

### Máquina de estados

```

 draft ──→ sent ──→ viewed ──┬──→ approved ──→ in_execution ──→ invoiced ──→ closed
   │           │           │      │
   │           │           │      ├──→ rejected   (motivo obrigatório · terminal)
   │           │           │      └──→ expired    (automático em valid_until · terminal)
   │           │           │
   │           └───────────┴──→ revised ──→ nova versão em draft
   │                             (a versão anterior fica superseded)
   └──→ cancelled

```

| Transição | Guarda | Permissão | Efeitos |
| --- | --- | --- | --- |
| draft → sent | ≥ 1 item, `valid_until` preenchido, total > 0 | `quote.send` | Gera PDF versionado; notifica contato do cliente; OS → `waiting` / `quote_approval`; evento `quote.sent` |
| sent → viewed | — | automático | Registra quem abriu e quando; evento `quote.viewed` |
| viewed → approved | Aprovador com permissão no portal; aceite registrado com IP e carimbo | `quote.approve` | Reserva peças; OS volta a `in_progress`; evento `quote.approved` |
| viewed → rejected | `rejection_reason_id` obrigatório | `quote.approve` | OS → decisão do coordenador; evento `quote.rejected` (alimenta análise de perda) |
| * → revised | — | `quote.update` | Cria versão N+1 em `draft`; a anterior vira `superseded`; **exige nova aprovação** |
| approved → invoiced | Itens de peça conferidos | `quote.invoice` | Debita estoque dos lotes selecionados; grava `invoiced_at`; evento `quote.invoiced` |

### Estrutura

- **Cabeçalho:** número (série própria), versão, cliente, contato aprovador, OS de origem, natureza (`parts` · `services` · `parts_and_services`), validade, moeda, condição de pagamento, observações ao cliente, observações internas.
- **Itens:** tipo (`part` | `service`), referência, descrição, quantidade, unidade, preço unitário, desconto de linha, total, garantia em dias, prazo de entrega. Peça pode indicar lote e fornecedor.
- **Totais:** subtotal, desconto geral (valor ou %), acréscimos, impostos, total. **Ausente na referência**
- **Preço:** resolvido pela cascata `customer_item_alias` → `price_list` do contrato → catálogo padrão.
- **Versionamento real** em vez do "Modificar" destrutivo da referência: o histórico de propostas é argumento comercial.

## 17. Contratos

Na referência, contrato é cadastro documental (nome, apelido, contratante, datas). Aqui é o instrumento que governa SLA, escopo, preço e medição — e é o que sustenta a renovação.

| Bloco | Conteúdo |
| --- | --- |
| **Identificação** | número, cliente, tipo (`full_service` · `preventive_only` · `on_demand` · `rental` · `loan` · `warranty`), vigência, renovação automática, aviso prévio, índice de reajuste, documento anexo |
| **Escopo** | `contract_coverage`: expressão de ativos cobertos (por cliente, subárvore de local, categoria ou lista). Um ativo pode estar em um contrato por vez em uma dada data — regra validada na criação |
| **Serviços incluídos** | Naturezas de OS cobertas; o que é faturado à parte |
| **SLA** | `sla_policy_id`; opcionalmente política diferente por criticidade de ativo |
| **Comercial** | Modelo (`fixed_monthly` · `per_asset` · `per_call` · `hybrid`), valor, tabela de preço, franquias (N chamados/mês, N horas/mês incluídas), excedente |
| **Medição** | `billing_period` mensal: OS executadas, horas, peças, conformidade de plano, SLA cumprido, franquia consumida, excedente a faturar |
| **Penalidade** | Regra de glosa por SLA violado (registrada, calculada, nunca aplicada automaticamente) |

**Alertas:** vencimento em 90/60/30 dias, franquia consumida acima de 80 %, SLA do mês abaixo da meta, conformidade de plano abaixo do contratado.

## 18. Documentos — motor único

A referência tem seis módulos documentais separados (calibração, rascunho de calibração, certificado de padrão, TSE, laudo de obsolescência, qualificação térmica) com estrutura 90 % comum. Um motor único com tipos elimina cinco implementações e torna trivial adicionar o sétimo tipo.

### Núcleo comum

```

document_type   chave · rótulo · série de numeração · template · validade padrão
                  campos obrigatórios · exige responsável técnico · exige assinatura
                  módulo de dados especializado (opcional)
   │
   └── document   number · version · status · asset_id · work_order_id · customer_id
             issued_at · valid_until · issued_by · technical_manager_id
             verdict ∈ conforme | não conforme | conforme com restrição | n/a
             released_to_customer_at · pdf_key · content_hash
             └── document_signature  signatário · papel · método · carimbo · hash
             └── document_payload    dados específicos do tipo (jsonb validado por schema)

```

### Ciclo de vida

```

draft ──→ under_review ──→ issued ──→ released ──→ expired
   │                            │           │
   │                            └──→ cancelled  (com motivo, mantém o número queimado)
   └──→ superseded  (substituído por versão nova; o antigo permanece acessível)

```

### Tipos previstos

| Tipo | Payload especializado | Regras próprias | Fase |
| --- | --- | --- | --- |
| `work_order_report` | — | Relatório da OS; o único do MVP | MVP |
| `calibration_certificate` | condições ambientais, pontos de medição, padrões, incertezas, fator k, critério de aceitação, correção de erro sistemático | **Bloqueia emissão se algum padrão estiver com certificado vencido na data da medição.** Liberação ao cliente manual ou automática | Fase 2 |
| `electrical_safety_test` | correntes de fuga, resistência de aterramento, classe do equipamento, limites da norma | Veredito automático contra limites; aceita importação de analisador | Fase 2 |
| `standard_certificate` | laboratório externo, incerteza, faixa, rastreabilidade | Fecha a cadeia metrológica; alimenta o bloqueio acima | Fase 2 |
| `obsolescence_report` | motivo, parecer técnico, valor de reparo × valor do bem, fundamentação legal | Exige responsável técnico com registro profissional; muda situação do ativo | Fase 3 |
| `thermal_qualification` | sensores, curvas, distribuição térmica | Geração assíncrona do PDF (a referência leva até 1 h) | Fase 3 |

### Numeração

`number_series`: escopo (organização ou cliente), tipo de documento, prefixo, sufixo, padrão (`{prefix}{YYYY}{seq:6}`), próximo valor, reinício anual, ativo. Alocação transacional com *advisory lock*. Números emitidos **nunca** são reaproveitados; documento cancelado mantém o número queimado com o motivo — requisito de auditoria.

### Assinatura

| Método | Como funciona | Prova |
| --- | --- | --- |
| `drawn` | Assinatura no dedo, coletada no PWA | Imagem + nome + documento + carimbo + hash do conteúdo |
| `email_code` | Código de 6 dígitos enviado por e-mail e validado | Código, e-mail, IP, carimbo, hash |
| `portal` | Aceite explícito por usuário autenticado do portal | Usuário, sessão, IP, carimbo, hash |
| `icp_brasil` | Certificado digital | **Futuro** — modelar campos desde já |

O `content_hash` é calculado sobre o payload canônico antes da assinatura. Qualquer alteração posterior invalida a assinatura e exige nova versão do documento — não há edição silenciosa de documento assinado.

## 19. Portal do cliente

Na referência o portal é um conjunto de 21 permissões sobre as mesmas telas internas. Aqui é uma aplicação própria, com navegação, vocabulário e densidade próprios — e uma superfície de escrita mínima.

### Princípios

1. **O portal só escreve em três lugares:** `service_requests`, `quote_approvals` e `signatures`. Todo o resto é leitura.
2. **Nada interno vaza.** `internal_notes`, custos internos, margem, nome de fornecedor, outros clientes e comentários com `visibility = internal` são filtrados na camada de consulta, não escondidos na interface.
3. **Escopo por local.** A enfermeira da UTI II vê a UTI II. A gerência vê o hospital inteiro. Mesmo produto, escopos diferentes.
4. **Mobile primeiro.** A abertura de chamado precisa funcionar em 30 segundos, em pé, no corredor.

### Telas

| Tela | Conteúdo | Permissão |
| --- | --- | --- |
| **Início** | Minhas solicitações abertas, ações pendentes (assinar, aprovar orçamento, avaliar), próximas visitas programadas, alertas de vencimento | base |
| **Abrir solicitação** | Fluxo de 3 passos: equipamento (busca, QR ou lista do meu setor) → o que houve (sintomas contextuais + texto + foto) → confirmar. Detecção de duplicidade no envio | `request.create` |
| **Minhas solicitações** | Lista com situação em linguagem do cliente ("Recebido", "Técnico a caminho", "Aguardando sua aprovação"), não com o vocabulário interno | `request.read` |
| **Detalhe da solicitação** | Linha do tempo, OS vinculadas, comentários com `visibility = customer`, anexos públicos, ação de assinar | `request.read` |
| **Meus equipamentos** | Inventário do escopo, com situação, próxima manutenção, certificados válidos e histórico resumido | `asset.read` |
| **Documentos** | Certificados e laudos liberados, filtráveis por ativo e por validade; download em lote | `document.read` |
| **Orçamentos** | Pendentes de decisão em destaque; aprovar ou reprovar com motivo | `quote.approve` |
| **Agenda** | Visitas programadas no meu escopo, com janela e natureza | `schedule.read` |
| **Indicadores** | Disponibilidade do parque, conformidade do plano, SLA cumprido, chamados por setor, satisfação — apenas do escopo | `insight.read` |

### Tradução de vocabulário

| Interno | No portal |
| --- | --- |
| `submitted` / `triage` | Recebido |
| `accepted` + OS `scheduled` | Agendado para {data} |
| OS `in_progress` | Em atendimento |
| OS `waiting` / `parts` | Aguardando peça |
| OS `waiting` / `quote_approval` | **Aguardando sua aprovação** — com botão |
| OS `waiting` / `customer_response` | **Aguardando você** — com o que falta |
| `completed` / `validated` | Concluído |
| `rejected` | Não procede — com a justificativa |

O mapeamento é **dado** (`work_order_status.customer_label`), não código. Uma organização pode ajustar a linguagem que seus clientes veem sem tocar na máquina de estados.

## 20. PWA do técnico

O técnico é o usuário mais frequente e o menos servido. Aqui ele tem um aplicativo desenhado para uma mão, luvas, pressa e ausência de rede.

### Escopo funcional

| Tela | Função | Offline |
| --- | --- | --- |
| **Hoje** | Agenda do dia em cartões ordenados por horário e proximidade; contador de pendências de sincronização | total |
| **Minhas OS** | Atribuídas a mim ou à minha equipe, agrupadas por situação | total |
| **Ler QR** | Câmera → ativo → abrir OS existente ou criar nova | total (resolve no cache local) |
| **Execução da OS** | Iniciar · checklist · fotos antes/depois · peças · horas · diagnóstico · resolução · concluir | total |
| **Assinatura** | Coleta no dedo, com nome e documento do signatário | total |
| **Ficha do ativo** | Dados, histórico recente, documentos, manual do modelo | parcial (últimas 10 OS + documentos marcados) |
| **Novo ativo** | Cadastro em campo com foto e QR; entra como `unverified` | total |
| **Nova solicitação/OS** | Registro de demanda encontrada em campo | total |

### O que precisa estar no dispositivo

| Dado | Volume estimado | Política de sincronização |
| --- | --- | --- |
| OS atribuídas (próximos 7 dias + abertas) | dezenas | Completa, com todas as coleções filhas |
| Ativos referenciados por essas OS + ativos dos locais do dia | centenas | Campos de identificação e ficha resumida |
| Templates de checklist dos procedimentos aplicáveis | dezenas | Versão publicada, íntegra |
| Catálogos (naturezas, situações, motivos, códigos de falha, unidades) | pequeno | Completo, com *ETag* |
| Itens de estoque do almoxarifado do técnico | centenas | Saldo indicativo — a confirmação é no servidor |
| Locais do escopo | centenas | Árvore podada ao escopo |
| Fotos capturadas | grande | Fila de saída, com compressão e upload retomável |

### Sincronização e conflito

- **Outbox transacional.** Cada ação offline vira um comando com `client_operation_id` (UUID). O servidor é idempotente por esse id — reenviar nunca duplica.
- **Ordem garantida por OS.** Comandos da mesma OS são aplicados em sequência; comandos de OS diferentes podem ir em paralelo.
- **Resolução de conflito explícita e visível.** Se o estado mudou no servidor de forma incompatível (a OS foi cancelada enquanto o técnico executava), o comando falha, o registro entra em "Precisa da sua atenção" e o técnico vê o que aconteceu e o que fazer. **Nunca descartar trabalho em silêncio** — o pior defeito possível neste produto.
- **Campos de texto** usam última escrita vence, com o valor descartado preservado no histórico.
- **Numeração** nunca é gerada no cliente. OS criada offline recebe um identificador temporário e o número definitivo na sincronização.
- **Consumo de estoque** é sempre confirmado no servidor; o saldo local é indicativo e o técnico é avisado se a peça acabou.

## 21. Usuários e RBAC

> **DECISÃO ADR-007**
>
> **Papéis prontos primeiro; granularidade como camada avançada; escopo como dimensão independente.** A referência acerta na granularidade (138 permissões atômicas) e erra na entrega: grupos vazios, sem papéis padrão, sem descrição — o resultado observado foi um grupo "Técnico" com 101 das 138 permissões, incluindo *adicionar empresa* e *adicionar grupo*, e um grupo chamado ".". Nosso modelo entrega dez papéis testados; o editor granular existe, mas é o caminho da exceção.

### Estrutura em três eixos independentes

```

QUEM            user → membership(organization)
O QUE PODE      membership → roles[] → permissions[]   (+ grants/revokes individuais)
SOBRE O QUE     membership_scope: customers × locations × assignment

```

Autorização = `permissão concedida` **E** `registro dentro do escopo`. Os dois eixos são verificados sempre, em toda consulta e em toda mutação. Nenhum dos dois substitui o outro.

### Vocabulário de permissões

Formato: `{recurso}.{ação}`. Ações padrão: `read` · `create` · `update` · `delete` · `export` · `manage` (inclui as anteriores + configuração). Ações especiais por recurso, nomeadas pelo verbo do negócio.

| Recurso | Read | Create | Update | Delete | Ações especiais |
| --- | --- | --- | --- | --- | --- |
| `customer` | ✔ | ✔ | ✔ | arquivar | — |
| `location` | ✔ | ✔ | ✔ | arquivar | `move` |
| `asset` | ✔ | ✔ | ✔ | arquivar | `transfer` · `decommission` · `print_label` · `read_financials` |
| `service_request` | ✔ | ✔ | ✔ | — | `triage` · `accept` · `reject` · `merge` |
| `work_order` | ✔ | ✔ | ✔ | ✔ | `assign` · `schedule` · `execute` · `execute_any` · `complete` · `validate` · `close` · `reopen` · `cancel` · `edit_closed` · `edit_dates` · `read_costs` · `read_internal_notes` |
| `time_entry` | ✔ | ✔ | ✔ | ✔ | `create_for_others` · `create_future` · `approve` |
| `maintenance_plan` | ✔ | ✔ | ✔ | arquivar | `generate_cycle` · `skip_item` · `finish` |
| `procedure` / `checklist` | ✔ | ✔ | ✔ | arquivar | `publish` |
| `inventory` | ✔ | ✔ | ✔ | — | `move` · `adjust` · `count` · `read_costs` |
| `quote` | ✔ | ✔ | ✔ | ✔ | `send` · `approve` · `invoice` |
| `contract` | ✔ | ✔ | ✔ | — | `read_financials` · `close_period` |
| `document` | ✔ | ✔ | ✔ | cancelar | `issue` · `sign` · `release_to_customer` |
| `insight` | ✔ | — | — | — | `read_financial_metrics` · `manage_dashboards` |
| `automation` | ✔ | ✔ | ✔ | ✔ | `run_now` |
| `audit` | ✔ | — | — | — | — |
| `organization` | ✔ | — | ✔ | — | `manage_members` · `manage_roles` · `manage_catalogs` · `manage_billing` · `manage_integrations` |

Total de aproximadamente **95 permissões** — menos que as 138 da referência, porque motivos de espera, tipos de documento e relatórios não geram permissões individuais: são governados por recurso e por escopo.

### Permissões de campo

Um conjunto pequeno e explícito, aplicado na serialização da resposta — nunca apenas no front-end:

`work_order.read_costs` · `work_order.read_internal_notes` · `asset.read_financials` · `inventory.read_costs` · `contract.read_financials` · `insight.read_financial_metrics` · `user.read_hourly_cost`

Não haverá permissão para "esconder campo X da tela Y" como na referência (que tem nove permissões só de ocultação). Ocultação puramente visual é **preferência de layout**, não permissão — e vive em `organization.form_layouts`.

### Papéis padrão de fábrica

| Papel | Escopo típico | Núcleo de permissões | Assento |
| --- | --- | --- | --- |
| **Owner** | tudo | Tudo + `organization.manage_billing` + transferência de titularidade. Um por organização, não removível | staff |
| **Administrador** | tudo | Tudo exceto faturamento e titularidade | staff |
| **Gestor de manutenção** | tudo | Leitura ampla; gestão de planos, procedimentos, contratos; `work_order.validate/edit_closed/reopen`; `document.sign/release`; custos e indicadores financeiros; auditoria | staff |
| **Coordenador** | clientes/equipes atribuídos | Triagem, atribuição, agenda, execução, conclusão, validação; leitura de custos; sem configuração | staff |
| **Técnico** | `assignment_scope = team` | `work_order.execute/complete`, `time_entry.create`, consumo de estoque, criação de ativo *unverified*, criação de solicitação. **Sem** custos, sem configuração, sem cadastro de cliente | staff |
| **Metrologista** | tudo ou por cliente | Técnico + `document.issue/sign/release` para tipos metrológicos + gestão de padrões e perfis de incerteza | staff |
| **Almoxarife** | almoxarifados atribuídos | `inventory.*` incluindo ajuste e contagem; leitura de OS para atender requisições; sem execução | staff |
| **Financeiro** | tudo | Orçamentos, contratos, faturamento, custos, indicadores financeiros; leitura de OS; sem execução | staff |
| **Auditor** | tudo | Somente leitura em tudo + `audit.read` + `export`. Nenhuma escrita | staff |
| **Solicitante** | locais do seu setor | `service_request.create/read`, `quote.approve`, `document.read` (liberados), assinatura, avaliação | **portal** |
| **Gestor do cliente** | todo o seu *customer* | Solicitante + `insight.read` do escopo + `asset.read` ampliado | **portal** |

### Regras de governança

- Papéis de fábrica são **somente leitura**. Para ajustar, o administrador duplica ("Técnico Sênior — cópia de Técnico") e edita a cópia. Isso impede que uma atualização nossa sobrescreva customização e que uma customização quebre o papel padrão.
- Um `membership` pode ter vários papéis; permissões são unidas. **Revogações individuais** (`membership_permission_overrides` com `effect = deny`) vencem sobre qualquer concessão.
- Nenhum papel pode conceder permissão que o concedente não possui (*no privilege escalation*).
- Toda alteração de papel, escopo ou vínculo é evento de auditoria de alta severidade.
- **Acesso de suporte** (nosso): concedido pelo Owner, com prazo máximo, banner permanente na interface, e toda ação marcada `actor_kind = support` na trilha. Melhora o "Permitir login do usuário suporte" da referência, que não tem prazo nem marcação visível.

## 22. Auditoria

A trilha com diff campo a campo é o melhor acerto do sistema de referência. Mantemos e acrescentamos três coisas: IP e agente, eventos de domínio além de CRUD, e imutabilidade real.

### Duas camadas complementares

| Camada | O que registra | Origem | Uso |
| --- | --- | --- | --- |
| **`audit_logs`** | Mutação de dado: quem mudou o quê, de qual valor para qual | *Trigger* de banco em todas as tabelas de negócio | Perícia, conformidade, "quem mexeu nisso?" |
| **`domain_events`** | Fato de negócio: "OS concluída", "SLA violado", "orçamento aprovado" | Camada de aplicação, na transação | Notificação, automação, integração, analytics, linha do tempo |

**Por que as duas.** Um evento não captura a edição de um campo qualquer; um diff não sabe que "a OS foi concluída" é diferente de "o campo `status_id` mudou". Registrar só um dos dois obriga a inventar o outro depois.

### Campos de `audit_logs`

| Campo | Conteúdo |
| --- | --- |
| `organization_id` | Sempre presente; a trilha é tenant-scoped |
| `actor_user_id` · `actor_kind` | `user` · `system` · `automation` · `api` · `support` · `import` |
| `occurred_at` | Timestamp com fuso |
| `entity_type` · `entity_id` · `entity_label` | O rótulo legível é congelado para que o log continue compreensível se o registro for arquivado |
| `action` | `create` · `update` · `delete` · `restore` |
| `changes` jsonb | `{campo: {from, to}}` — apenas campos alterados |
| `ip` · `user_agent` · `request_id` | Propagados da aplicação via variável de sessão do Postgres |
| `source` | `web` · `pwa` · `portal` · `api` · `job` |

### Regras

- A trilha é **append-only**: sem `UPDATE` nem `DELETE`, garantido por permissão de banco. Purga apenas por rotina administrativa registrada, respeitando a retenção contratada.
- **Campos sensíveis** (senha, token, chave de API) são registrados como `[redacted]` — o fato da mudança é auditado, o valor não.
- **Retenção**: 24 meses on-line (consultável na interface) e arquivamento frio configurável, mínimo de 5 anos para organizações reguladas.
- **Visualização**: trilha global filtrável (entidade, ação, ator, período) e trilha por registro, embutida na linha do tempo do ativo e da OS — o usuário não deve precisar sair da tela para ver o histórico dela.

## 23. Notificações

### Arquitetura

```

domain_event ──→ notification_router ──→ resolve destinatários ──→ aplica preferências
                                                              │
                          ┌───────────────────────────────────┼──────────────────┐
                          ▼                ▼                  ▼                  ▼
                      in_app          email            push            whatsapp
                     (MVP)            (MVP)            (Fase 3)          (Fase 3)

```

### Catálogo inicial

| Notificação | Destinatário | Canais | Fase |
| --- | --- | --- | --- |
| Solicitação recebida | Equipe de cobertura | in-app, e-mail | MVP |
| OS atribuída a você | Executor | in-app, push | MVP |
| OS reagendada | Executor, solicitante | in-app, e-mail | MVP |
| Menção em comentário | Mencionado | in-app, e-mail | MVP |
| SLA em 80 % | Responsável e coordenador | in-app, push | MVP |
| SLA violado | Responsável, coordenador, gestor | in-app, e-mail | MVP |
| Sua solicitação mudou de situação | Solicitante | e-mail, in-app | MVP |
| Aprovação de orçamento pendente | Aprovador do cliente | e-mail | Fase 2 |
| Estoque abaixo do mínimo | Almoxarife | in-app, e-mail | Fase 2 |
| Calibrações vencendo em 30 dias | Gestor, metrologista | e-mail (digest mensal) | Fase 2 |
| Certificado liberado | Contatos do cliente | e-mail | Fase 2 |
| Início de ciclo de plano | Responsável pelo plano | in-app, e-mail | Fase 2 |
| Contrato vencendo | Financeiro, gestor | e-mail | Fase 3 |

### Preferências

`notification_preferences` por usuário × tipo × canal, com padrões por papel. Três controles adicionais que evitam o abandono do canal: **digest** (agrupar em resumo diário ou semanal), **silêncio** (horário e dias em que não notificar, respeitando o fuso do usuário) e **de-duplicação** (a mesma OS não gera dez e-mails em uma hora — o roteador agrupa por janela).

**Verificação de e-mail obrigatória antes de notificar**, com lista de bloqueio e fluxo de reenvio — comportamento maduro observado na referência e que merece ser copiado literalmente.

## 24. Automações

Os "Robôs" da referência têm 2 modelos, 2 gatilhos e 1 ação real. O nosso motor é um *rules engine* declarativo sobre o barramento de eventos.

### Anatomia

```

automation_rule
   nome · descrição · ativo · prioridade de execução
   │
   ├── trigger   ∈ event | schedule | condition_watch
   │        event:            work_order.status_changed, sla.warning, stock.below_minimum …
   │        schedule:         cron + fuso (ex.: todo dia 07:00)
   │        condition_watch:  "documento vence em N dias", "OS parada há N horas"
   │
   ├── conditions  árvore booleana (AND/OR) sobre campos do payload e do registro
   │        ex.: prioridade = emergency AND cliente ∈ [X, Y] AND natureza = corretiva
   │
   └── actions  lista ordenada
            notify(destinatário, canal, template)
            assign(usuário | equipe | round-robin da equipe)
            change_status(situação, motivo)
            set_field(campo, valor)
            add_comment(texto, visibilidade)
            create_work_order(natureza, ativo, procedimento)
            create_service_request(...)
            issue_document(tipo)
            call_webhook(endpoint)
            escalate(para papel, após N minutos)

```

### Exemplos que a organização deve conseguir montar sem ajuda

| Gatilho | Condição | Ação |
| --- | --- | --- |
| `service_request.created` | prioridade = emergência | notificar coordenador por push + atribuir ao plantonista |
| `sla.warning` | — | notificar responsável; se não houver responsável, notificar a equipe |
| `sla.breached` | cliente tem contrato com penalidade | notificar gestor + registrar comentário interno + marcar para a medição do mês |
| `condition_watch`: documento vence em 30 dias | tipo = certificado de calibração | criar OS de calibração e agendar na próxima janela do plano |
| `work_order.status_changed` | para = `waiting` e motivo = `parts` | notificar almoxarife com a lista de peças requisitadas |
| `stock.below_minimum` | — | notificar compras e abrir solicitação interna |
| `schedule`: toda segunda 07:00 | — | enviar digest de OS atrasadas por equipe |
| `work_order.completed` | natureza = corretiva e mesmo ativo teve ≥ 3 corretivas em 90 dias | criar OS de análise de causa raiz + notificar gestor **Fase 3** |

### Salvaguardas

- **Sem recursão.** Ação de automação emite evento com `caused_by_rule_id`; regras não disparam sobre eventos causados por elas mesmas, e há limite de profundidade em cadeia (padrão 3).
- **Limite de execução** por regra e por janela; regra que estoura entra em quarentena e notifica o administrador.
- **Simulação obrigatória** antes de ativar: "esta regra teria disparado 412 vezes nos últimos 30 dias" — impede a regra que inunda a caixa de entrada de toda a equipe.
- **Log de execução** (`rule_runs`): evento de entrada, condições avaliadas, ações executadas, resultado, erro. Sem isso a automação é uma caixa-preta.
- **Automação nunca contorna permissão.** Executa sob um ator de sistema com escopo declarado na regra.

## 25. Analytics e indicadores

Analytics é funcionalidade de primeira classe, nativa, dentro do RBAC. Na coluna de fase: **✔** = Core Operacional · **Comercial** = MVP Comercial (F7–F8) · **Fase 2/3** = expansão. As 13 métricas confirmadas na auditoria formam a base; acrescentamos as que faltavam e marcamos explicitamente o que não pôde ser confirmado.

### Matriz de indicadores

| Indicador | Objetivo | Dados necessários | Dimensões | Origem | MVP |
| --- | --- | --- | --- | --- | --- |
| **OS abertas / concluídas** | Volume de demanda e de entrega | `work_orders.opened_at`, `closed_at`, natureza | todas | Arkmeds | ✔ |
| **Backlog** | Trabalho acumulado não concluído | OS em categorias ativas na data de corte | cliente, local, equipe, natureza, prioridade, idade | Proposta | ✔ |
| **Idade do backlog** | Envelhecimento da fila | `now − opened_at` das OS ativas | faixas (0–7, 8–30, 31–90, 90+ dias) | Proposta | ✔ |
| **MTTR** — tempo médio de reparo | Velocidade de resolução | `completed_at − opened_at` de OS corretivas concluídas | ativo, categoria, modelo, cliente, local, técnico, período | Arkmeds ("Tempo médio de serviços") | ✔ |
| **MTBF** — tempo médio entre falhas | Confiabilidade do ativo | Intervalos entre OS corretivas do mesmo ativo | ativo, categoria, modelo, fabricante | Arkmeds ("Tempo médio entre serviços") | ✔ |
| **Disponibilidade** | % do tempo em que o ativo esteve operável | Tempo em situações que caracterizam parada, sobre o período | ativo, categoria, local, cliente | Arkmeds | Comercial |
| **Tempo de parada** | Horas de indisponibilidade | Somatório dos intervalos de parada | idem | Derivado | Comercial |
| **Cumprimento de SLA** | Aderência contratual | `sla_clocks.met` por alvo | cliente, contrato, prioridade, alvo, período | Arkmeds | ✔ |
| **Tempo por situação** | Onde o fluxo trava | `status_history` com duração | situação, motivo de espera, cliente, equipe | Arkmeds | ✔ |
| **Tempo por motivo de espera** | Causa raiz do travamento | idem, agrupado por `wait_reason` | motivo, responsável pela liberação | **Novo** | ✔ |
| **Preventiva × corretiva** | Maturidade da manutenção | Contagem por `work_order_type.system_key` | cliente, local, categoria, período | **Novo** | ✔ |
| **Conformidade de plano** | Aderência ao programa preventivo | `plan_cycle_items` por situação | plano, ciclo, cliente, natureza | Arkmeds | ✔ |
| **Reincidência** | Qualidade do reparo | Nova OS corretiva no mesmo ativo com mesmo sintoma dentro de N dias | ativo, modelo, técnico, sintoma | **Novo** | Fase 2 |
| **Produtividade** | Entrega por técnico | OS concluídas e horas apontadas por usuário | técnico, equipe, natureza, período | Arkmeds | ✔ |
| **Taxa de utilização** | Horas apontadas ÷ horas de jornada | `time_entries` × `user.daily_hours` × calendário | técnico, equipe, período | **Novo** | Fase 2 |
| **Horas gastas** | Capacidade consumida | `time_entries.minutes` | todas | Arkmeds | ✔ |
| **Custo de manutenção** | Gasto no período | mão de obra + peças + deslocamento + terceiros | cliente, ativo, categoria, contrato, período | Arkmeds | Comercial |
| **Custo de substituição do parque** | Valor para repor o inventário | Σ `asset.replacement_value` | cliente, local, categoria | Arkmeds | Fase 2 |
| **CMMS ratio** | Custo de manutenção ÷ valor do parque | as duas métricas acima | cliente, período | Arkmeds | Fase 2 |
| **Custo por ativo** | Candidatos a substituição | Custo acumulado ÷ valor de reposição, com vida útil e criticidade | ativo, modelo | **Novo** | Fase 3 |
| **Satisfação (CSAT)** | Percepção do cliente | `satisfaction_score` 1–5 | cliente, local, técnico, natureza, período | Arkmeds | Comercial |
| **Taxa de conversão de solicitação** | Qualidade da demanda | aceitas ÷ total; rejeitadas por motivo | cliente, local, solicitante | **Novo** | Fase 2 |
| **Tempo de primeira resposta** | Percepção de atendimento | `triaged_at − submitted_at` | cliente, equipe, período | **Novo** | ✔ |

> **A VALIDAR — NÃO INVENTAR FÓRMULAS**
>
> A auditoria **não conseguiu confirmar** as fórmulas usadas pelo sistema de referência para **Disponibilidade**, **MTTR**, **MTBF** e **TMAC** — a interface não exibe definição e os botões de ajuda não retornam conteúdo. Três consequências obrigatórias para o nosso produto:

> 1. **Cada métrica exibe sua própria definição** em um *tooltip*, com numerador, denominador, filtros aplicados e período. Sem exceção.

> 2. **As definições acima são a nossa decisão**, não uma cópia da referência. Se o objetivo for comparar números com o sistema antigo em uma migração, a fórmula da referência precisa ser obtida com o fornecedor primeiro.

> 3. **TMAC** não será implementado com esse nome. A auditoria só pôde inferir "Tempo Médio de Atendimento de Chamado" pela sigla e pelo formato de duração. Usaremos **Tempo de primeira resposta** e **MTTR**, ambos definidos explicitamente.

### Cuidados com dados incompletos

- **Denominador honesto.** OS sem política de SLA não entram no indicador de SLA; ativos sem `replacement_value` não entram no CMMS ratio. O widget informa a cobertura ("calculado sobre 78 % dos ativos") em vez de fingir completude.
- **Primeira falha não gera MTBF.** Um ativo com uma única corretiva não tem intervalo. Excluir do cálculo e informar.
- **OS reabertas** contam como um novo ciclo de resolução; o MTTR original é preservado e a reincidência é registrada.
- **Migração de dados históricos** marca registros com `data_quality = imported`, e os widgets oferecem alternar entre "tudo" e "apenas dados nativos".

### Como é calculado

| Camada | O quê | Latência |
| --- | --- | --- |
| **Consulta direta** | Contagens e listas do dia (backlog, fila, agenda) | tempo real |
| **Tabelas de fato** | `fact_work_order`, `fact_time_entry`, `fact_status_period`, `fact_sla`, `fact_plan_item` — populadas de forma incremental a partir dos eventos de domínio | minutos |
| **Agregados materializados** | Séries mensais por cliente/categoria/técnico, para painéis longos | diária + sob demanda |

**Regra de ouro:** o domínio transacional nunca é consultado diretamente por um painel de 12 meses. Foi exatamente esse acoplamento que produziu telas de 30 segundos no sistema de referência.

## 26. Dashboard

Nativo, dentro do RBAC, sem dependência de ferramenta externa. Substitui o link para o Looker Studio da referência.

| Recurso | Comportamento | Fase |
| --- | --- | --- |
| **Dashboards por papel** | Cada papel abre em um painel de fábrica pensado para ele: Gestor (conformidade, SLA, custo), Coordenador (fila, agenda, atrasos), Técnico (meu dia), Financeiro (orçamentos, medição), Cliente (seu escopo) | MVP |
| **Filtros globais** | Período, cliente, local (subárvore), equipe, natureza — aplicados a todos os widgets do painel e refletidos na URL | MVP |
| **Comparação** | Período anterior e mesmo período do ano anterior, com delta e direção | Comercial |
| **Drill-down** | Clicar em qualquer número abre a lista filtrada que o originou. **Requisito obrigatório** — um indicador que não se explica não é confiável | MVP |
| **Widgets** | KPI com tendência, série temporal, barras por dimensão, distribuição, tabela, funil, medidor de meta | MVP |
| **Personalização** | Adicionar, remover, redimensionar e reordenar widgets; salvar como painel pessoal ou compartilhado | Fase 3 |
| **Visões salvas como fonte** | Qualquer `saved_view` de lista pode virar widget de contagem ou tabela | Fase 3 |
| **Metas** | Alvo por indicador, por cliente e por período, com semáforo | Fase 3 |
| **Exportação e agendamento** | PDF e planilha do painel; envio periódico por e-mail — sem o limite de 5 relatórios da referência | Fase 3 |
| **Permissão** | Widget financeiro só renderiza com `insight.read_financial_metrics`; sem a permissão, o widget não aparece (não aparece vazio) | MVP |

## 27. Busca global

A ausência de busca global é uma das lacunas mais custosas do sistema de referência: para achar "patrimônio 7737" é preciso saber em qual lista procurar. Aqui a busca é a primeira tecla.

| Aspecto | Definição |
| --- | --- |
| **Atalho** | `⌘K` / `Ctrl K` em qualquer tela; `/` foca a busca da lista atual |
| **Escopos indexados** | Ativos (TAG, série, patrimônio, modelo, fabricante), clientes, locais, OS (número, resumo, sintoma), solicitações, orçamentos, documentos (número), itens de estoque, usuários, procedimentos e checklists |
| **Ranqueamento** | Correspondência exata de identificador vem sempre primeiro; depois recência de interação do usuário; depois relevância textual |
| **Ações** | A paleta também executa: "Nova OS", "Abrir solicitação", "Ir para agenda", "Trocar de organização", "Alternar tema" — filtradas por permissão |
| **Busca contextual** | Digitar `#` restringe a OS, `@` a pessoas, `>` a comandos |
| **Permissão e escopo** | Aplicados no índice, não na exibição. Um resultado fora do escopo do usuário **não existe** para ele |
| **Tecnologia** | Postgres `tsvector` + `pg_trgm` no MVP (busca por similaridade cobre erro de digitação em série e patrimônio). Motor dedicado apenas quando o volume ou a latência exigirem |
| **Offline** | No PWA, a busca cobre o cache local e sinaliza claramente que o resultado é parcial |

## 28. Arquivos e anexos

| Campo | Conteúdo |
| --- | --- |
| `owner_type` · `owner_id` | Vínculo polimórfico com validação por lista fechada de tipos permitidos |
| `purpose` | `photo_before` · `photo_after` · `evidence` · `document` · `manual` · `signature` · `avatar` · `logo` · `import` |
| `storage_key` · `bucket` | Caminho com `organization_id` no prefixo — isolamento também no armazenamento |
| `mime` · `size_bytes` · `checksum` | `checksum` permite deduplicar e detectar corrupção |
| `width` · `height` · `duration_s` | Metadados de mídia |
| `thumbnails` | Geradas de forma assíncrona em 2 tamanhos; nunca servir o original em lista |
| `visibility` | `internal` · `customer` — controla o que o portal enxerga |
| `captured_at` · `captured_by` · `geo` | Para foto de campo; geo apenas com consentimento |
| `version` · `replaces_id` | Versionamento para manuais e documentos, não para fotos |

#### Regras

- **Upload direto** do cliente para o armazenamento por URL pré-assinada; a aplicação nunca faz proxy de binário.
- **Download sempre por URL assinada de curta duração** gerada após verificação de permissão e escopo. Nenhum bucket público.
- **Limites**: 25 MB por imagem, 100 MB por documento, 500 MB por vídeo — configuráveis por plano.
- **Antivírus** assíncrono; arquivo fica em quarentena até liberação.
- **Compressão de foto no cliente** antes do upload (largura máxima 2.048 px) — economiza dados móveis do técnico, que é quem paga a franquia.
- **Exclusão** é lógica; a remoção física ocorre em rotina, respeitando retenção legal do documento vinculado.

## 29. Campos personalizados

> **DECISÃO ADR-009**
>
> **Coluna `custom` jsonb + tabela de definições tipadas.** Alternativas recusadas: (a) **EAV puro** — uma linha por valor: destrói a legibilidade das consultas e multiplica junções; (b) **jsonb livre sem definição** — o que a referência faz com o checklist: barato de escrever, impossível de validar, de listar em coluna e de usar em relatório; (c) **colunas reais por tenant** — inviável com centenas de organizações.

### Modelo

```

custom_field_definition
   organization_id · entity_type (asset | work_order | customer | location | service_request …)
   applies_when   (ex.: apenas para asset_category = Ventilador; apenas para natureza = calibração)
   key (snake_case, imutável) · label · help_text · group · position
   kind ∈ text | number | boolean | date | select | multi_select | user | asset | currency | url
   options[] · min · max · unit · regex · required · default
   searchable (bool) · reportable (bool) · visible_to_portal (bool)

entidade.custom  jsonb   → { "tensao_v": 220, "classe_risco": "III" }

```

#### Regras

- `key` é imutável após a criação; renomear é criar novo campo e migrar.
- Validação por esquema derivado das definições, aplicada no servidor — nunca só no formulário.
- Campos marcados `searchable` entram no índice de busca; marcados `reportable` viram dimensão disponível no construtor de relatórios.
- Índice GIN em `custom`, mais índices de expressão para os campos mais consultados por organização.
- Limite de 50 definições por entidade por organização — proteção contra o formulário de 200 campos.
- **Promoção a campo nativo:** se um campo personalizado aparece em muitas organizações, ele é candidato a virar coluna de verdade em uma versão futura. Registrar isso como métrica de produto.

## 30. API e webhooks

Produto API-first: a aplicação web e o PWA consomem exatamente a mesma API pública. Isso impede a existência de "endpoints privilegiados" que a integração não alcança — problema que a referência tem, já que o webhook existe mas a documentação de integração está vazia.

| Aspecto | Decisão |
| --- | --- |
| **Estilo** | **REST** com OpenAPI 3.1 gerado a partir dos esquemas de validação. Recusado GraphQL: o consumo previsto é integração de sistema (previsível, cacheável), não montagem dinâmica de tela por terceiros |
| **Versionamento** | `/v1/` no caminho; mudanças incompatíveis geram `/v2/`. Campos novos nunca quebram versão |
| **Autenticação** | MVP: **API key** por organização, com escopos e escopo de dados próprios (uma chave é um *membership* de máquina). Fase 3: OAuth 2.0 *client credentials* para parceiros |
| **Autorização** | Exatamente o mesmo motor de permissões e escopo da interface. Sem exceção, sem *backdoor* |
| **Rate limit** | Por chave e por organização, com `X-RateLimit-*` e `429` com `Retry-After` |
| **Idempotência** | `Idempotency-Key` obrigatório em `POST` que cria recurso; resposta original repetida por 24 h |
| **Paginação** | Cursor (`after`/`limit`), nunca *offset* — a referência pagina 2.954 páginas por *offset* |
| **Erros** | RFC 9457 (*problem details*), com código estável, mensagem em pt-BR e apontamento de campo |
| **Webhooks** | `webhook_endpoints` por organização, com seleção de eventos, segredo, assinatura HMAC-SHA256 no cabeçalho, *timestamp* contra *replay* |
| **Entrega** | Fila com *retry* exponencial (1 m, 5 m, 30 m, 2 h, 6 h, 24 h), *dead letter*, reenvio manual, log completo de tentativas com corpo e resposta |
| **Ordem** | Sem garantia global; cada evento leva `sequence` por agregado para o consumidor ordenar |
| **Integrações previstas** | ERP hospitalar (TOTVS, MV, Tasy, SAP) para centro de custo, patrimônio e nota fiscal; SSO corporativo; e-mail transacional; WhatsApp Business **Fase 3+** |

## 31. Catálogo de eventos de domínio

Um único barramento alimenta auditoria, notificação, automação, webhooks e analytics. Nome no formato `agregado.fato_no_passado`. Todo evento carrega `organization_id`, `actor`, `occurred_at`, `aggregate_id`, `sequence`, `payload` e `caused_by`.

| Domínio | Eventos |
| --- | --- |
| **Directory** | `customer.created` · `customer.archived` · `location.created` · `location.moved` · `location.archived` · `supplier.created` · `team.member_added` · `team.member_removed` |
| **Assets** | `asset.created` · `asset.updated` · `asset.transferred` · `asset.status_changed` · `asset.decommissioned` · `asset.warranty_expiring` · `asset.qr_generated` · `meter.reading_recorded` |
| **Service requests** | `service_request.created` · `service_request.triaged` · `service_request.info_requested` · `service_request.accepted` · `service_request.rejected` · `service_request.merged` · `service_request.cancelled` · `service_request.fulfilled` · `service_request.rated` |
| **Work orders** | `work_order.opened` · `work_order.assigned` · `work_order.scheduled` · `work_order.rescheduled` · `work_order.started` · `work_order.status_changed` · `work_order.blocked` · `work_order.unblocked` · `work_order.completed` · `work_order.rework_requested` · `work_order.validated` · `work_order.closed` · `work_order.reopened` · `work_order.cancelled` · `work_order.commented` · `work_order.signed` |
| **Time & parts** | `time_entry.recorded` · `time_entry.approved` · `work_order.part_requested` · `work_order.part_consumed` · `work_order.part_returned` |
| **SLA** | `sla.started` · `sla.paused` · `sla.resumed` · `sla.warning` · `sla.breached` · `sla.met` |
| **Planning** | `plan.activated` · `plan.cycle_started` · `plan.cycle_closed` · `plan.item_generated` · `plan.item_skipped` · `plan.item_overdue` · `plan.finished` · `checklist.completed` · `checklist.item_failed` · `procedure.published` |
| **Inventory** | `stock.received` · `stock.reserved` · `stock.consumed` · `stock.returned` · `stock.adjusted` · `stock.transferred` · `stock.below_minimum` · `stock.negative_balance` · `stock.count_closed` |
| **Commerce** | `quote.created` · `quote.sent` · `quote.viewed` · `quote.approved` · `quote.rejected` · `quote.expired` · `quote.revised` · `quote.invoiced` · `contract.activated` · `contract.expiring` · `contract.expired` · `contract.terminated` · `contract.period_closed` |
| **Documents** | `document.issued` · `document.signed` · `document.released` · `document.expiring` · `document.expired` · `document.cancelled` · `document.superseded` · `document.printed` |
| **Platform** | `member.invited` · `member.joined` · `member.role_changed` · `member.scope_changed` · `member.removed` · `support_access.granted` · `support_access.expired` · `api_key.created` · `api_key.revoked` · `automation.rule_fired` · `export.completed` |

#### Regras do barramento

- Evento é **persistido na mesma transação** do dado (padrão *outbox*) e publicado depois. Nunca "quase sempre chega".
- Evento é **imutável** e representa fato consumado; nunca intenção.
- **Payload versionado** (`schema_version`). Campos podem ser adicionados; nunca removidos ou ressignificados.
- Consumidores são **idempotentes** por `event_id`.
- O catálogo é parte do contrato público: adicionar evento é *minor*, remover é *breaking*.

## 32. Modelo de dados

Convenções obrigatórias, aplicadas sem exceção: chave primária `uuid v7` gerada pela fábrica única de `packages/domain` (§37); `organization_id` em toda tabela de negócio; `created_at`, `updated_at`, `created_by`, `updated_by` em toda tabela; `deleted_at` onde a coluna "Soft" indicar; *timestamps* em `timestamptz`; dinheiro em `numeric(14,2)` com `currency`; toda enumeração de negócio configurável é tabela, não `enum` de banco; toda enumeração estrutural (categorias de situação, tipos de movimento) é `enum` de banco; entidades que um ERP externo pode espelhar (`customers`, `assets`, `work_orders`, `inventory_items`) carregam `external_id` e `external_source`, ambos anuláveis, com unicidade por (`organization_id`, `external_source`, `external_id`) — reservados desde já para não exigir migração quando houver integração (OQ-09).

#### Legenda

**T** = tenant-scoped (`organization_id` obrigatório) · **S** = soft delete · **H** = histórico/auditoria com diff · **A** = append-only (sem update nem delete)

### PLATFORM

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `users` | Identidade global | email, name, avatar_key, locale, timezone, phone, status, last_seen_at, mfa_enabled | 1:N memberships | `email` único global (citext) | — S H |
| `organizations` | Tenant | name, slug, tax_id, logo_key, locale, timezone, asset_label, plan, seat_limit, settings jsonb, status | 1:N tudo | `slug` único global | — S H |
| `memberships` | Vínculo usuário × organização | seat_type(staff\|portal), status, job_title, hourly_cost, daily_hours, council, registration_no, signature_key, on_vacation, invited_at, joined_at | N:1 user, N:1 organization, N:N roles | único (organization_id, user_id); `hourly_cost` só para staff | T S H |
| `membership_scopes` | Escopo de dados do vínculo | customer_scope, customer_ids[], location_paths[], assignment_scope, warehouse_ids[] | 1:1 membership | — | T — H |
| `membership_accessible_locations` | Escopo materializado | membership_id, location_id | N:N | Recalculado por trigger | T — — |
| `roles` | Papel | key, name, description, is_system, is_default_for | N:N permissions | `is_system` imutável; nome único por org | T S H |
| `permissions` | Catálogo de permissões | key, resource, action, description, is_field_level | — | Global, seed da plataforma | — — — |
| `role_permissions` | Ligação | role_id, permission_id | N:N | — | T — H |
| `membership_roles` | Papéis do vínculo | membership_id, role_id | N:N | — | T — H |
| `membership_permission_overrides` | Exceção individual | permission_id, effect(grant\|deny), reason, expires_at | N:1 membership | `deny` sempre vence | T — H |
| `support_access_grants` | Acesso temporário do suporte | granted_by, expires_at, reason, revoked_at | N:1 organization | `expires_at` ≤ 7 dias | T — H |
| `api_keys` | Credencial de máquina | name, prefix, hash, scopes[], scope_config, last_used_at, expires_at, revoked_at | N:1 organization | Segredo nunca legível após criação | T — H |
| `audit_logs` | Trilha de mutação | actor_user_id, actor_kind, entity_type, entity_id, entity_label, action, changes jsonb, ip, user_agent, request_id, source | — | Sem UPDATE/DELETE | T — — A |
| `domain_events` | Fatos de negócio | type, aggregate_type, aggregate_id, sequence, payload jsonb, schema_version, actor, caused_by_event_id, caused_by_rule_id, occurred_at, published_at | — | Outbox transacional | T — — A |

### DIRECTORY

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `customers` | Quem é atendido | name, trade_name, code, tax_id, is_internal, status, segment, billing_*, default_sla_policy_id, logo_key, custom | 1:N locations, contracts, service_requests | Máx. 1 `is_internal` por org; nome único por org | T S H |
| `customer_contacts` | Pessoas do cliente | name, role, email, phone, receives_reports, user_id | N:1 customer | — | T S H |
| `location_types` | Níveis da árvore | key, name, icon, allowed_parent_type_ids[], allows_assets, position | 1:N locations | Catálogo por org | T S H |
| `locations` | Árvore física | parent_id, location_type_id, name, code, path text, depth, address jsonb, geo, timezone, calendar_id, manager_user_id, is_mobile, status, custom | N:1 customer, self-FK, 1:N assets | Sem ciclo; tipo válido para o pai; `depth` ≤ 8; `code` único por cliente | T S H |
| `suppliers` | Terceiros | name, tax_id, categories[], is_authorized_service, contacts, payment_terms, rating | 1:N stock_lots, work_orders | — | T S H |
| `teams` | Equipes | name, code, calendar_id, default_warehouse_id, coverage jsonb, lead_user_id | N:N users | — | T S H |
| `team_members` | Composição | role_in_team, skills[] | N:N | — | T — H |
| `calendars` / `calendar_windows` / `calendar_exceptions` | Cobertura de horário | name, timezone; weekday, start, end; date, kind, note | usado por SLA e agenda | Janelas não sobrepostas no mesmo dia | T S H |
| `availability_blocks` | Indisponibilidade | membership_id, kind(vacation\|leave\|training\|other), starts_at, ends_at, note | N:1 membership | Bloqueia agendamento em `vacation` e `leave`; avisa em `training` e `other` | T S H |

### ASSETS

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `asset_categories` | Classe funcional | name, code, parent_id, default_criticality_id, requires_calibration, requires_electrical_test, icon | 1:N models, assets | Profundidade ≤ 2 | T S H |
| `manufacturers` | Marca | name, country, website, support_contact, verified | 1:N models | Nome único por org (normalizado) | T S H |
| `asset_models` | Modelo | manufacturer_id, category_id, name, code, specs jsonb, default_useful_life_years, default_procedures[], docs | 1:N assets | Único (manufacturer, name) | T S H |
| `criticality_levels` | Matriz de risco | name, score, color, sla_multiplier, position | 1:N assets | Catálogo por org | T S H |
| `assets` | Ativo gerenciado | tag, serial_number, asset_number, qr_token, barcode, asset_model_id, asset_category_id, customer_id, location_id, location_path, parent_asset_id, status, criticality_id, default_priority, operational_risk, anvisa_registration, inmetro_ordinance, manufactured_at, acquired_at, installed_at, warranty_until, useful_life_years, purchase_value, residual_value, replacement_value, ownership, contract_id, owner_supplier_id, sla_policy_id, specs, custom, show_on_work_order[], notes, internal_notes, verification_status | N:1 location/customer/model; 1:N work_orders, documents, meters; self-FK | Unicidade configurável em tag/serial/asset_number; `location.customer_id = asset.customer_id`; sem ciclo em `parent_asset_id` | T S H |
| `asset_transfers` | Movimentação de ativo | kind(transfer\|loan\|return), from_location_id, to_location_id, assets[], requested_by, approved_by, status, due_back_at, returned_at, note | N:N assets | Empréstimo exige `due_back_at` | T S H |
| `meters` / `meter_readings` | Contadores | asset_id, kind, unit, cumulative; value, read_at, source, work_order_id | N:1 asset | Leitura acumulada não pode regredir sem justificativa | T — H / A |

### SERVICE

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `service_requests` | Demanda do cliente | number, source, status, requester_user_id, requester_name, requester_phone, customer_id, location_id, summary, description, reported_failure_code_id, requested_priority, priority, rejection_reason_id, merged_into_request_id, triaged_by, triaged_at, first_response_at, satisfaction_score, satisfaction_comment, custom | N:N assets; 1:N work_orders | `rejected` exige motivo; `duplicate` exige `merged_into`; sem ciclo em merge | T S H |
| `work_order_types` | Natureza | key, system_key, name, color, icon, requires_asset, completion_requirements jsonb, default_procedure_id, counts_as_failure, causes_downtime, position | 1:N work_orders | `system_key` imutável | T S H |
| `work_order_statuses` | Situação | key, name, customer_label, category (enum), color, position, is_system, requires_wait_reason, is_default_for_category | 1:N work_orders | `category` obrigatória; `is_system` não removível | T S H |
| `work_order_status_transitions` | Grafo permitido | from_status_id, to_status_id, required_permission, guard_expression, side_effects jsonb | N:N statuses | Sem transição para si mesmo | T — H |
| `wait_reasons` | Motivo de espera | key, name, customer_label, pauses_sla, responsible_party(internal\|customer\|supplier), requires_note, position | 1:N work_orders | Catálogo por org com seed | T S H |
| `failure_codes` | Sintoma e causa | kind(symptom\|cause\|action), name, code, asset_category_ids[], parent_id, position | N:1 work_order | Árvore rasa | T S H |
| `work_orders` | Trabalho | ver §09 na íntegra | N:1 asset/location/customer/type/status; 1:N filhas | `status.category = waiting` ⇒ `wait_reason_id NOT NULL`; `number` único por org; `closed` ⇒ imutável sem permissão | T S H |
| `work_order_assignees` | Executores | user_id, role | N:N | — | T — H |
| `work_order_status_history` | Trajetória | from_status_id, to_status_id, wait_reason_id, actor, note, changed_at, duration_in_previous_s | N:1 work_order | Append-only | T — — A |
| `time_entries` | Horas | user_id, kind(labor\|travel\|waiting), started_at, ended_at, minutes, note, cost_snapshot, approved_by, approved_at | N:1 work_order | `ended_at > started_at`; sem sobreposição do mesmo usuário salvo permissão | T S H |
| `work_order_parts` | Peças | inventory_item_id, warehouse_id, lot_id, qty, unit_price, status | N:1 work_order | Consumo gera `stock_movement` | T S H |
| `work_order_services` | Serviços | service_catalog_id, qty, unit_price, warranty_days | N:1 work_order | — | T S H |
| `work_order_comments` | Conversa | author_id, body, visibility, mentions[], edited_at | N:1 work_order | Edição preserva original no histórico | T S H |
| `signatures` | Assinatura | owner_type, owner_id, signer_name, signer_document, role, method, image_key, code_verified_at, ip, content_hash | polimórfico | Hash obrigatório | T — — A |
| `custody_protocols` | Custódia física | kind(collection\|delivery\|service), handled_by, signed_by, signed_at, note, related_protocol_id | N:1 work_order | Entrega referencia recolhimento | T S H |
| `sla_policies` / `sla_targets` | Política de prazo | name, calendar_id; priority, kind(response\|onsite\|resolution), duration_minutes, business_hours_only | 1:N clocks | Único (policy, priority, kind) | T S H |
| `sla_clocks` / `sla_pauses` | Contagem | owner_type, owner_id, target_kind, started_at, due_at, stopped_at, met, elapsed_minutes, elapsed_business_minutes, paused_minutes, breached_at; pause: reason, from, to | N:1 work_order/request | Um clock por alvo por documento | T — — A |

### PLANNING

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `maintenance_plans` | Programa | name, customer_id, contract_id, owner_user_id, team_id, status, auto_generate, include_late_assets, description | — | T S H |
| `plan_tasks` | O que, quando, sobre quem | target_type, target_ref, work_order_type_id, procedure_id, trigger, frequency, interval, lead_time_days, tolerance_days, estimated_duration_min, default_team_id, required_parts[] | Alvo deve resolver ≥ 0 ativos; frequência obrigatória se `trigger = calendar` | T S H |
| `plan_cycles` | Instância temporal | seq, starts_at, ends_at, status, expected_count, done_count, skipped_count | Ciclos não se sobrepõem | T — H |
| `plan_cycle_items` | Trabalho previsto | plan_task_id, asset_id, due_at, status, work_order_id, skip_reason | Único (cycle, task, asset) | T — H |
| `procedures` | Instrução técnica | title, work_order_type_id, scope_type, scope_ref, summary, scope, content, attachments, required_standards[], version, status | Publicação congela versão | T S H |
| `checklist_templates` / `_sections` / `_items` | Formulário | ver §14 | Publicado é imutável | T S H |
| `checklist_responses` / `_answers` | Execução | work_order_id, template_id, template_version, started_at, finished_at; item_id, value, verdict, photo_ids[], measured_by | Resposta referencia versão congelada | T — H |

### COMMERCE

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `contracts` / `contract_coverage` / `contract_slas` | Instrumento comercial | ver §17 | Um ativo em um contrato por data | T S H |
| `billing_periods` | Medição | contract_id, period, status, metrics jsonb, closed_by, closed_at | Fechado é imutável | T — H |
| `service_catalog` | Serviços vendáveis | work_order_type_id, name, description, unit, warranty_days, price | — | T S H |
| `price_lists` / `price_list_items` | Tabela de preço | name, customer_id, contract_id, valid_from, valid_to; ref_type, ref_id, price, discount | Sem sobreposição de vigência | T S H |
| `quotes` / `quote_items` | Proposta | ver §16 | `rejected` exige motivo; versão N+1 supersede N | T S H |
| `warehouses` | Local de estoque | name, kind, location_id, owner_user_id, allow_negative | — | T S H |
| `inventory_items` | Item | sku, name, category_id, unit_id, manufacturer_id, manufacturer_code, model, image_key, tracking, is_stockable, lead_time_days | `sku` único por org | T S H |
| `customer_item_aliases` | Nome e preço por cliente | customer_id, alias, sale_price | Único (item, customer) | T S H |
| `stock_lots` | Lote | warehouse_id, item_id, lot_code, invoice_number, supplier_id, expires_at, unit_cost, qty_on_hand | `qty_on_hand ≥ 0` | T — H |
| `stock_balances` | Projeção | item_id, warehouse_id, on_hand, reserved, available, min_qty | Derivada dos movimentos | T — — |
| `stock_movements` | Razão | kind, qty, item_id, lot_id, warehouse_id, unit_cost, ref_type, ref_id, reason, actor | Sem UPDATE/DELETE; correção por movimento inverso | T — — A |
| `stock_reservations` | Reserva | work_order_id, item_id, warehouse_id, qty, status, expires_at | Liberada ao cancelar OS | T — H |
| `stock_counts` / `_items` | Inventário | warehouse_id, status, counted_by, approved_by; item, expected, counted, variance | Ajuste só após aprovação | T — H |

### DOCUMENTS · AUTOMATION · INSIGHT

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `document_types` | Tipo documental | key, name, number_series_id, template_id, default_validity_months, requires_technical_manager, requires_signature, payload_schema | Seed da plataforma + customizável | T S H |
| `documents` | Documento emitido | ver §18 | Número imutável; assinado ⇒ conteúdo imutável | T S H |
| `document_payloads` | Dados do tipo | jsonb validado por `payload_schema` | — | T — H |
| `number_series` | Numeração | scope, document_type, prefix, suffix, pattern, next_value, reset_yearly, active | Alocação com advisory lock | T — H |
| `standards` / `uncertainty_profiles` | Metrologia | asset_id, ranges, uncertainty, resolution; sensor, range, value, expires_at | Padrão vencido bloqueia emissão | T S H |
| `attachments` | Arquivos | ver §28 | Prefixo de storage por organização | T S H |
| `automation_rules` / `rule_runs` | Regras | ver §24 | Profundidade de cadeia ≤ 3 | T S H / A |
| `notifications` / `notification_preferences` | Entrega | user_id, type, channel, payload, read_at, sent_at, failed_reason; user × type × channel | De-duplicação por janela | T — — |
| `webhook_endpoints` / `webhook_deliveries` | Integração | url, secret, events[], active; event_id, attempt, status, response_code, response_body | Assinatura HMAC obrigatória | T S H / A |
| `saved_views` | Visão salva | owner_id, entity, filters, columns, sort, visibility | — | T S H |
| `dashboards` / `dashboard_widgets` | Painéis | name, owner, visibility, layout; metric_key, viz, group_by, filters, size, position | Widget financeiro exige permissão | T S H |
| `export_jobs` | Processamento assíncrono | kind, params, status, progress, file_key, requested_by, expires_at | Arquivo expira em 7 dias | T — — |
| `custom_field_definitions` | Campos personalizados | ver §29 | `key` imutável; máx. 50 por entidade | T S H |
| `fact_*` | Tabelas analíticas | `fact_work_order`, `fact_status_period`, `fact_time_entry`, `fact_sla`, `fact_plan_item`, `fact_stock_movement` | Somente escrita pelo pipeline | T — — A |

## 33. ERD conceitual

```

PLATFORM
  users ─1:N─ memberships ─N:1─ organizations
                  │
                  ├─N:N─ roles ─N:N─ permissions
                  ├─1:1─ membership_scopes
                  └─1:N─ membership_permission_overrides

  organizations ─1:N─ TUDO ABAIXO   (organization_id obrigatório)

DIRECTORY
  customers ─1:N─ locations (self-FK, caminho materializado)
      │              └─1:N─ assets
      ├─1:N─ customer_contacts
      ├─1:N─ contracts
      └─1:N─ service_requests

  suppliers ─1:N─ stock_lots
            └─1:N─ work_orders (outsourced_to)

  teams ─N:N─ users        calendars ─1:N─ calendar_windows / exceptions
        └─1:N─ availability_blocks

ASSETS
  manufacturers ─1:N─ asset_models ─1:N─ assets
  asset_categories ─1:N─ asset_models
                   └─1:N─ assets
  criticality_levels ─1:N─ assets
  assets ─self-FK─ assets (componente)
         ├─N:N─ asset_transfers
         ├─1:N─ meters ─1:N─ meter_readings
         ├─1:N─ work_orders
         ├─1:N─ documents
         └─N:N─ plan_cycle_items

SERVICE
  service_requests ─1:N─ work_orders          (source = request)
                   └─self-FK─ merged_into

  work_order_types ─1:N─ work_orders
  work_order_statuses ─1:N─ work_orders
                      └─N:N─ work_order_status_transitions
  wait_reasons ─1:N─ work_orders
  failure_codes ─1:N─ work_orders  (symptom · cause · action)

  work_orders
      ├─1:N─ work_order_assignees ─N:1─ users
      ├─1:N─ work_order_status_history
      ├─1:N─ time_entries
      ├─1:N─ work_order_parts ─N:1─ inventory_items / stock_lots
      ├─1:N─ work_order_services ─N:1─ service_catalog
      ├─1:N─ work_order_comments
      ├─1:N─ checklist_responses ─1:N─ checklist_answers
      ├─1:N─ custody_protocols
      ├─1:N─ signatures
      ├─1:N─ attachments
      ├─1:N─ documents
      ├─1:N─ quotes
      ├─1:N─ sla_clocks ─1:N─ sla_pauses
      ├─N:1─ plan_cycle_items
      └─self-FK─ parent_work_order (derivada / reabertura)

  sla_policies ─1:N─ sla_targets
               ─1:N─ contracts / customers / assets  (cascata de resolução)

PLANNING
  maintenance_plans ─1:N─ plan_tasks ─N:1─ procedures ─N:N─ checklist_templates
                    └─1:N─ plan_cycles ─1:N─ plan_cycle_items ─1:1─ work_orders
  checklist_templates ─1:N─ checklist_sections ─1:N─ checklist_items

COMMERCE
  contracts ─1:N─ contract_coverage → assets
            ─1:N─ contract_slas ─N:1─ sla_policies
            ─1:N─ billing_periods
            ─1:N─ price_lists ─1:N─ price_list_items

  quotes ─1:N─ quote_items → inventory_items | service_catalog
         ─N:1─ work_orders
         ─self-FK─ supersedes

  warehouses ─1:N─ stock_lots ─N:1─ inventory_items
             ─1:N─ stock_balances
             ─1:N─ stock_movements  (ref → work_order | quote | count | transfer)
             ─1:N─ stock_counts ─1:N─ stock_count_items
  inventory_items ─1:N─ customer_item_aliases ─N:1─ customers

DOCUMENTS
  document_types ─1:N─ documents ─1:N─ document_signatures
                 └─N:1─ number_series      └─1:1─ document_payloads
  standards ─N:N─ documents (calibração)
  standards ─1:N─ uncertainty_profiles

AUTOMATION & INSIGHT
  domain_events ──→ automation_rules ─1:N─ rule_runs
                ──→ notifications ─N:1─ notification_preferences
                ──→ webhook_endpoints ─1:N─ webhook_deliveries
                ──→ fact_* ──→ dashboards ─1:N─ dashboard_widgets
                          └─→ saved_views
  audit_logs ←── triggers de todas as tabelas de negócio

```

### Índices e desempenho — decisões que precisam existir no dia 1

| Alvo | Índice / estratégia | Motivo |
| --- | --- | --- |
| Lista de OS | Composto `(organization_id, status_category, opened_at DESC)` + parcial `WHERE deleted_at IS NULL` | A consulta mais frequente do produto |
| Escopo por local | B-tree `text_pattern_ops` em `locations.path` (subárvore por prefixo) + tabela materializada de locais acessíveis | Evita CTE recursiva por requisição |
| Busca | `tsvector` gerado + GIN; forma normalizada indexada em série, TAG e patrimônio (`pg_trgm` opcional, ADR-027) | Erro de digitação em número de série é a regra, não a exceção |
| Campos personalizados | GIN em `custom` + índices de expressão sob demanda | Filtro por campo personalizado sem varredura |
| Histórico de situação | `(work_order_id, changed_at)`; particionamento por mês quando passar de ~50 M linhas | Base da métrica de tempo por situação |
| Eventos e auditoria | Particionamento mensal por `occurred_at` | Retenção e purga baratas |
| Contagens de painel | Tabelas de fato, nunca `COUNT(*)` sobre a tabela transacional | Causa raiz das telas lentas na referência |

## 34. Requisitos não funcionais

| Área | Requisito | Meta | Como verificar |
| --- | --- | --- | --- |
| **Segurança** | Isolamento entre organizações | Zero vazamento | Suíte automatizada que tenta acessar dados de outro tenant em cada endpoint; falha do teste bloqueia o deploy |
| **Segurança** | Criptografia | TLS 1.3 em trânsito; AES-256 em repouso | Configuração auditada |
| **Segurança** | Senhas e segredos | Argon2id; segredos em cofre; nada em variável de ambiente de build | Revisão + varredura de segredo no CI |
| **Segurança** | Dependências | Sem vulnerabilidade crítica conhecida em produção | SCA no CI, correção em 7 dias para crítico |
| **Segurança** | Sessão | Expiração por inatividade (staff 12 h, portal 30 dias); revogação imediata ao remover vínculo | Teste de integração |
| **Segurança** | Papel de banco da API | Sem `BYPASSRLS`, sem `SUPERUSER`, não é owner das tabelas tenant-scoped | Teste que consulta `pg_roles` e `pg_class.relowner` e falha se violado |
| **Segurança** | `FORCE ROW LEVEL SECURITY` | Ativo em 100 % das tabelas tenant-scoped | Teste que varre `pg_class` e falha se alguma tabela tiver `relforcerowsecurity = false` |
| **Segurança** | Contexto transaction-local | Zero vazamento de contexto entre requisições que compartilham conexão | Teste de reuso de pool (A → devolve → B) |
| **Segurança** | Falha fechada | Consulta sem contexto de tenant retorna zero linhas | Teste de integração no banco |
| **Performance** | Listas com filtro | p95 < 400 ms com 100 mil OS por organização | Teste de carga com base semeada em volume realista |
| **Performance** | Ficha de ativo / OS | p95 < 600 ms | idem |
| **Performance** | Painel | p95 < 1,5 s para 12 meses | Sobre tabelas de fato |
| **Performance** | PWA — abrir OS offline | < 300 ms | Medição no dispositivo |
| **Escalabilidade** | Volume por organização | 500 mil ativos, 5 milhões de OS, 50 mil documentos | Particionamento e índices projetados para isso |
| **Escalabilidade** | Organizações por instância | ≥ 500 sem degradação | Teste de multiempresa |
| **Escalabilidade** | Jobs | Geração de 5 mil OS de ciclo em < 5 min, sem impacto na latência transacional | Fila separada, prioridade baixa |
| **Disponibilidade** | Uptime | 99,9 % mensal para a aplicação | Monitoramento sintético externo |
| **Disponibilidade** | Degradação graciosa | Indisponibilidade de analytics, PDF ou notificação não impede operar OS | Filas desacopladas |
| **Disponibilidade** | Manutenção | Migrações sem downtime (expandir → migrar → contrair) | Política de migração |
| **Backup** | RPO | ≤ 5 min (PITR) | Teste trimestral de restauração |
| **Backup** | RTO | ≤ 4 h | Ensaio documentado |
| **Backup** | Retenção | Diário 30 dias, mensal 12 meses; arquivos com versionamento | Política de bucket |
| **Privacidade e LGPD** | Base legal e finalidade | Registro de tratamento por categoria de dado | Documento de *data mapping* |
| **Privacidade e LGPD** | Direitos do titular | Exportar e anonimizar dados de um usuário sem quebrar o histórico operacional | Anonimização substitui nome e contato, preserva o vínculo por id |
| **Privacidade e LGPD** | Minimização | Não coletar CPF de solicitante; geolocalização só com consentimento explícito e revogável | Revisão de formulário |
| **Observabilidade** | Rastreamento | `request_id` propagado da interface ao banco e ao log de auditoria | Traço distribuído |
| **Observabilidade** | Erros | Captura em servidor e cliente, com organização e usuário anonimizados | Painel de erros |
| **Observabilidade** | Negócio | Métricas de fila, taxa de sincronização do PWA, entregas de webhook, disparo de automações | Painel operacional interno |
| **Acessibilidade** | Conformidade | WCAG 2.2 AA | Auditoria automatizada no CI + revisão manual das telas críticas |
| **Acessibilidade** | Teclado | Toda ação alcançável sem mouse; foco sempre visível | Teste manual por tela |
| **Acessibilidade** | Contraste e alvo de toque | 4.5:1 em texto; alvo ≥ 44 px no PWA (técnico de luva) | Design tokens |
| **Responsividade** | Web | Funcional de 1280 px a 1920 px; utilizável em tablet | Testes de viewport |
| **Responsividade** | PWA | Projetado para 360–430 px; uma mão; alto contraste em ambiente claro | Teste em campo |
| **Offline** | Autonomia | 8 h de trabalho sem rede, incluindo fotos | Teste de campo simulado |
| **Offline** | Integridade | Zero perda silenciosa de trabalho; conflito sempre visível ao usuário | Teste de conflito determinístico |
| **Internacionalização** | Estrutura | Todo texto em catálogo desde o MVP, mesmo com um idioma só | Sem literal em componente |
| **Internacionalização** | Formato | Data, número, moeda e fuso por organização e por usuário | Biblioteca de formatação centralizada |

## 35. Princípios de UX / UI

### Os sete princípios

01

#### Densidade com hierarquia

Tabelas profissionais mostram muito, mas com um único ponto de entrada visual por linha. Truncamento com *tooltip* é derrota — a coluna importante recebe espaço, as demais são configuráveis.

02

#### Estado é cor e forma

Cada categoria de situação tem cor e forma consistentes em toda a aplicação — lista, Kanban, agenda, portal e PDF. O usuário aprende uma vez.

03

#### Filtro é visível e reversível

Filtros ativos aparecem como chips removíveis acima da tabela e no endereço. Nunca escondidos em painel modal, como na referência.

04

#### Gaveta em vez de página

Ver um detalhe a partir de uma lista abre uma gaveta lateral, preservando o contexto. Página inteira só quando o registro é o assunto.

05

#### Formulário em etapas

Nada de 39 campos numa tela. Progressão por seções, com rascunho salvo automaticamente e validação no momento certo.

06

#### Erro que ensina

Toda mensagem diz o que aconteceu, por que e qual é o próximo passo, apontando o campo. "Erro!" é defeito, não mensagem.

07

#### Teclado é cidadão de primeira classe

`⌘K` para tudo. Atalhos para as cinco ações mais frequentes de cada tela, descobríveis por `?`.

### Padrões definidos

| Padrão | Regra |
| --- | --- |
| **Navegação** | Barra lateral com no máximo 8 itens de primeiro nível, sem submenu de terceiro nível. O que não couber vai para "Configurações" ou para a busca. |
| **Ações** | Uma ação primária por tela. Secundárias em menu *overflow*. Ações destrutivas exigem confirmação com o nome do registro digitado apenas quando irreversíveis. |
| **Modais** | Nunca modal dentro de modal. Fluxo que precisa de dois passos vira gaveta com etapas. |
| **Tabelas** | Colunas configuráveis e persistidas por usuário; ordenação no servidor; seleção múltipla com barra de ações contextual; virtualização acima de 100 linhas; densidade confortável e compacta. |
| **Vazio** | Estado vazio explica o que aquilo é e oferece a ação de criar ou de importar. Nunca uma tabela em branco. |
| **Carregamento** | *Skeleton* com a forma do conteúdo; nunca *spinner* de página inteira em navegação interna. |
| **Números** | Sempre tabulares e alinhados à direita; unidade explícita; duração em formato humano ("2 d 4 h", não "0.093 anos"). |
| **Cor** | Um acento de marca; semântica (sucesso, atenção, crítico) separada do acento; nunca cor como única portadora de informação. |
| **Tema** | Claro e escuro desde o início, por tokens. O técnico trabalha em UTI com luz baixa. |
| **Idioma** | Um vocabulário só (§03). O rótulo da tela é o rótulo do PDF é o rótulo do e-mail. |

### Antipadrões proibidos

Modal dentro de modal · Combo com 651 opções sem busca · Filtro que some ao aplicar · Paginação por *offset* com 2.954 páginas · Ícone de ação sem rótulo acessível · Formulário de 39 campos em tela única · Mensagem "Erro!" · Placeholder *lorem ipsum* em produção · Dois nomes para o mesmo conceito · Limite comunicado sem caminho de solução · Widget que abre outro domínio

## 36. Arquitetura técnica

### Avaliação das necessidades reais

| Necessidade | Exigência que ela impõe | Implicação |
| --- | --- | --- |
| Multitenancy com escopo hierárquico | Filtro por subárvore em toda consulta, com desempenho | Postgres com caminho materializado + escopo materializado (ADR-026); RLS como segunda barreira, não como única |
| Máquina de estados com guardas e efeitos | Transação com validação, emissão de evento e efeitos colaterais | Lógica em serviço próprio, não em política de banco nem em função de borda |
| Numeração transacional | Sequência sem buraco e sem colisão sob concorrência | *Advisory lock* no Postgres dentro da mesma transação |
| Jobs (ciclos, PDF, exportação, webhooks, digest) | Fila durável, com retentativa, agendamento e visibilidade | Fila baseada em Postgres para enfileirar na mesma transação do dado |
| Offline-first | Sincronização idempotente, ordenada por agregado, com resolução de conflito | API de comandos com `client_operation_id`; não é resolvível por CRUD genérico |
| PDF fiel a template versionado | Renderização controlada | Worker com Chromium *headless*, isolado da API |
| Analytics de 12 meses | Leitura pesada sem afetar a operação | Tabelas de fato e réplica de leitura |
| Busca tolerante a erro | Trigrama e ranqueamento | Postgres `pg_trgm` + `tsvector` antes de motor dedicado |
| API pública com webhooks assinados | Contrato estável e entrega confiável | OpenAPI gerado + fila de entrega com *dead letter* |

> **DECISÃO ADR-010 — ARQUITETURA RECOMENDADA**
>
> **Monólito modular em TypeScript sobre PostgreSQL, com BaaS usado apenas para identidade e armazenamento.** Recusamos "aplicação direto no Supabase com RLS como camada de autorização": as regras deste domínio (guardas de transição, requisitos de conclusão por natureza, numeração, cálculo de SLA com calendário, sincronização offline) não cabem em políticas de banco, e tentar espremê-las ali produz um sistema que ninguém consegue testar nem depurar. Usamos o BaaS pelo que ele é bom — autenticação, armazenamento, Postgres gerenciado — e mantemos o domínio no nosso código.

### Stack

| Camada | Escolha | Por quê | Alternativa considerada |
| --- | --- | --- | --- |
| **Frontend** | React + TypeScript + Vite; TanStack Query/Table/Router; Tailwind + design system próprio sobre primitivos acessíveis; Zod compartilhado com o backend | Listas virtualizadas e formulários complexos são o coração do produto | Next.js — recusado: não precisamos de SSR para uma aplicação autenticada, e o custo de complexidade não se paga |
| **Portal do cliente** | Mesma base, rotas e layout próprios, *bundle* separado | Reaproveita componentes sem herdar a densidade interna | Aplicação separada — recusado no MVP |
| **PWA do técnico** | Mesma base; Service Worker; IndexedDB (Dexie); fila de saída própria | Uma base de código; instalável; sem loja de aplicativos | React Native — reconsiderar se push confiável e leitura de NFC virarem requisito |
| **Backend** | NestJS (TypeScript), monólito modular com um módulo por domínio da §04; Drizzle ORM; REST com OpenAPI gerado | Fronteiras explícitas, tipos compartilhados com o front, caminho de extração futura sem reescrita | Microsserviços — prematuro; Python/Django — perde o compartilhamento de tipos |
| **Banco** | PostgreSQL 16+ sem dependência de extensão (ADR-026, ADR-027), `uuid v7` gerado na aplicação, particionamento em eventos e histórico; réplica de leitura para analytics | Um banco resolve relacional, árvore, JSON, busca e fila | ClickHouse para analytics — só quando o volume exigir |
| **Autenticação** | Provedor gerenciado (Supabase Auth ou equivalente): senha, *magic link* para o portal, MFA; OIDC/SAML na Fase 3 | Identidade é problema resolvido; não construir | Auth próprio — recusado |
| **Armazenamento** | S3-compatível, prefixo por organização, URLs assinadas curtas, versionamento | Isolamento e custo | Blob no banco — recusado |
| **Filas e jobs** | pg-boss (fila no próprio Postgres): enfileiramento transacional, cron, retentativa, prioridade | Zero infra extra e garantia de que o job só existe se a transação existiu | Redis/SQS — quando o volume justificar |
| **PDF** | Worker isolado com Chromium *headless*, templates HTML versionados por organização | Fidelidade tipográfica e reuso do design system | Bibliotecas de PDF — perdem qualidade e reuso |
| **E-mail** | Provedor transacional com *webhooks* de entrega, *bounce* e reclamação alimentando a lista de bloqueio | Entrega e reputação | SMTP próprio — recusado |
| **Tempo real** | SSE a partir da API para o feed e para o Kanban | Simples, atravessa proxies, suficiente | WebSocket — só se houver colaboração simultânea |
| **Infra** | Contêineres gerenciados, IaC, ambientes dev/stg/prod, migrações versionadas e reversíveis | Previsibilidade | — |

### Organização do código

```

apps/
  web/        aplicação interna
  portal/     portal do cliente
  field/      PWA do técnico
  api/        NestJS (módulos por domínio)
  workers/    jobs, PDF, sincronização, pipeline de fatos
packages/
  contracts/  esquemas Zod + tipos + cliente OpenAPI  ← fonte única de verdade dos DTOs
  domain/     máquinas de estado, cálculo de SLA, recorrência, regras puras e testáveis
  ui/         design system
  events/     catálogo de eventos e tipos de payload
  db/         schema, migrações, seeds

```

`packages/domain` não conhece HTTP nem banco. As regras de transição, o cálculo de minutos úteis e a recorrência de planos são funções puras com testes exaustivos — é a parte do sistema que não pode ter defeito.

## 37. Segurança multitenant

Regra inegociável: **nenhum dado de uma organização pode alcançar outra**. A garantia é obtida por camadas independentes, de modo que a falha de uma não produza vazamento.

### Defesa em profundidade

| # | Camada | Mecanismo | O que pega |
| --- | --- | --- | --- |
| 1 | **Sessão** | Token carrega `user_id`; a organização ativa é resolvida no servidor a partir do *membership*, nunca aceita do cliente | Troca de tenant por manipulação de cabeçalho ou de URL |
| 2 | **Contexto de requisição** | `organization_id`, `membership_id`, permissões e escopo resolvidos uma vez e propagados imutáveis | Esquecimento de filtro em um serviço |
| 3 | **Camada de dados** | O construtor de consultas **injeta `organization_id` automaticamente**; consultar sem escopo exige uma chamada explicitamente nomeada `unsafeCrossTenant()`, proibida por lint fora de tarefas administrativas | Consulta escrita à mão sem `WHERE` |
| 4 | **RLS no Postgres** | `ENABLE` **e** `FORCE ROW LEVEL SECURITY` em toda tabela de negócio, com política comparando `organization_id` à variável **transaction-local** `aurora.organization_id`. O papel usado pela API não é dono das tabelas e não tem `BYPASSRLS` | Bug na aplicação, injeção, acesso direto ao banco, consulta esquecida |
| 5 | **Escopo de negócio** | Filtro por cliente, subárvore de local e atribuição, aplicado na consulta | Usuário legítimo vendo dado de outro setor |
| 6 | **Serialização** | Campos sob permissão de campo removidos na resposta | Custo vazando para o portal |
| 7 | **Armazenamento** | Prefixo `{organization_id}/…`; URL assinada emitida só após verificação; nenhum bucket público | Enumeração de arquivos |
| 8 | **Jobs e automações** | Todo job carrega `organization_id` e roda sob ator de sistema com escopo declarado; a conexão de serviço abre com a variável de sessão do tenant | Job que processa "todos" e mistura tenants |
| 9 | **API** | Chave é sempre de uma organização; mesmo motor de permissão e escopo | Integração privilegiada |
| 10 | **Testes** | Suíte que, para cada endpoint, cria dois tenants e verifica que A não alcança B — e falha o *build* | Regressão |

### Hardening de banco — obrigatório desde a primeira migration

#### Papéis de banco separados

| Papel | Usado por | Privilégios | Nunca |
|---|---|---|---|
| `aurora_owner` | Dono do schema e das tabelas | `OWNER` de tudo; alvo das migrations | Ser usado pela API em runtime |
| `aurora_migrator` | Pipeline de migrations | `SET ROLE aurora_owner`; DDL | Rodar em processo de requisição |
| `aurora_app` | **A API, em runtime** | `SELECT/INSERT/UPDATE/DELETE` nas tabelas de negócio, conforme as policies | Ser owner · ter `BYPASSRLS` · ter `SUPERUSER` · ter DDL |
| `aurora_readonly` | Analytics e suporte | `SELECT` sujeito a RLS | Escrever |

Regra estrutural: **o dono da tabela ignora RLS por padrão no PostgreSQL.** Por isso duas coisas são obrigatórias e não opcionais: (1) `ALTER TABLE … FORCE ROW LEVEL SECURITY`, que submete inclusive o owner às policies; (2) `aurora_app` **não** ser o owner. Uma sem a outra deixa uma porta aberta.

```sql
-- padrão aplicado a TODA tabela tenant-scoped
ALTER TABLE <t> ENABLE  ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE   ROW LEVEL SECURITY;

CREATE POLICY <t>_tenant_isolation ON <t>
  USING      (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
```

A função `aurora.current_organization_id()` é `STABLE`, marcada `SECURITY INVOKER`, e lê a variável transaction-local. Se a variável não estiver definida, **retorna NULL** — e a comparação `organization_id = NULL` é falsa, de modo que a ausência de contexto **fecha o acesso** em vez de abri-lo. Falha fechada, nunca aberta.

#### Contexto transaction-local e reuso de pool

O contexto **nunca** é definido com `SET`, apenas com `set_config(..., is_local => true)`, dentro da transação:

```sql
SELECT set_config('aurora.organization_id', $1, true);  -- true = transaction-local
SELECT set_config('aurora.actor_id',        $2, true);
SELECT set_config('aurora.request_id',      $3, true);
```

Motivo: com `pgBouncer`/pool de conexões, uma variável de **sessão** sobrevive ao `COMMIT` e volta para o pool junto com a conexão — o próximo tenant herdaria o contexto do anterior. Variável transaction-local morre no `COMMIT`/`ROLLBACK`.

Consequências de projeto, todas obrigatórias:

- **Nenhuma consulta de negócio fora de transação.** O repositório só expõe execução dentro de uma unidade de trabalho que abriu o contexto.
- **Toda transação abre definindo o contexto**; não existe caminho que consulte tabela tenant-scoped sem ele.
- **Teste obrigatório de reuso de pool** (`EPIC-001`): tenant A executa uma requisição, a conexão volta ao pool, tenant B reutiliza **a mesma conexão física** e o teste afirma `current_setting('aurora.organization_id', true) IS NULL` no início e que B não enxerga nenhuma linha de A.
- **Teste obrigatório de falha fechada**: consulta a tabela tenant-scoped **sem** contexto definido retorna zero linhas — nunca todas.

#### Espaços de numeração — três, e nunca se misturam

| Espaço | Para quê | Formato | Quem gera | Visível ao usuário |
|---|---|---|---|---|
| **Identificador técnico** | Chave primária e referência entre tabelas | `uuid v7` | Aplicação, na criação | Não — nunca em URL de negócio como identificador semântico |
| **Número de documento de trabalho** | OS e solicitação | `number_series` (prefixo + sequência) | Servidor, transacional | Sim |
| **Número de documento emitido** | Certificado, laudo, orçamento, contrato | `number_series` própria por `document_type` | Servidor, transacional | Sim, e com valor legal |

Regras: uma série **nunca** é compartilhada entre espaços; número alocado **nunca** é reaproveitado (documento cancelado mantém o número queimado com o motivo); a alocação usa *advisory lock* na mesma transação do registro, de modo que não existe número sem registro nem registro sem número; e o cliente **nunca** gera número — OS criada offline recebe identificador técnico local e o número definitivo na sincronização.

#### UUID v7 — uma única implementação

`uuid v7` é ordenável por tempo, o que evita fragmentação de índice B-tree em tabelas de alto volume (OS, eventos, auditoria). Decisões:

- **Uma única fábrica**, exportada por `packages/domain`, usada por todos os módulos e por todos os *seeds*. Nenhum módulo importa biblioteca de UUID diretamente.
- **Geração na aplicação**, não no banco. `gen_random_uuid()` é v4 e não ordena; `uuidv7()` nativo só existe a partir do PostgreSQL 18 e o alvo é 16+. Depender dele quebraria o ambiente de destino.
- A coluna é `uuid` puro; o banco **não** tem `DEFAULT` de geração para chaves de negócio, justamente para que uma inserção sem id falhe alto em vez de gerar um v4 silencioso.
- A fábrica é testada quanto a monotonicidade dentro do mesmo milissegundo e quanto ao formato (versão 7, variante RFC 9562).

### Regras adicionais

- **Chave de serviço nunca sai do servidor.** Nenhum cliente — web, portal ou PWA — recebe credencial que ignore RLS.
- **Identificadores opacos.** UUID v7 em toda parte; nada sequencial exposto, exceto os números de documento (que são de negócio e escopados).
- **Enumeração.** Registro fora do escopo retorna `404`, não `403` — não confirmar existência.
- **Exportação** é ação auditada, com marca d'água de organização e usuário nos PDFs sensíveis.
- **Acesso de suporte** com prazo, motivo, banner visível na interface e marcação `actor_kind = support` em toda ação.
- **Cache** sempre chaveado por organização e por escopo; nunca por id do recurso apenas.

## 38. Roadmap

Onze fases curtas. Critério de corte de cada fase: **existe algo demonstrável e utilizável ao final**. Nenhuma fase é "infraestrutura por três meses".

| Fase | Nome | Entrega demonstrável | Épicos | Duração alvo |
| --- | --- | --- | --- | --- |
| **F0** | Fundação | Repositório, CI, ambientes, esquema base, autenticação, uma organização criada, um usuário logado, trilha de auditoria funcionando | EPIC-001, EPIC-022 (parcial) | 3 semanas |
| **F1** | Acesso e diretório | Convidar equipe, papéis de fábrica, escopo por local; cadastrar cliente e árvore de locais; trocar de organização | EPIC-002, EPIC-003, EPIC-004 | 4 semanas |
| **F2** | Ativos | Inventário completo com categorias, modelos, criticidade; importação por planilha; ficha 360°; QR Code impresso e resolvível | EPIC-005, EPIC-006, EPIC-026 (ativos) | 4 semanas |
| **F3** | Trabalho | Abrir solicitação, triar, gerar OS, atribuir, executar, concluir, fechar — com máquina de estados e motivos de espera | EPIC-007, EPIC-008, EPIC-009 | 6 semanas |
| **F4** | Execução em campo | Checklists, horas, fotos, assinatura; PWA offline com sincronização | EPIC-011, EPIC-014 | 6 semanas |
| **F5** | Compromisso | SLA com calendário e feriados; agenda com arrastar-e-soltar e capacidade | EPIC-010, EPIC-012 | 4 semanas |
| **F6** | Preventiva | Planos com tarefas, ciclos, geração automática de OS e conformidade | EPIC-013 | 4 semanas |
| **F7** | Leitura | Painéis por papel, indicadores do MVP com drill-down e definição visível; busca global | EPIC-021, EPIC-025 | 4 semanas |
| **F8** | Cliente | Portal completo: solicitações, equipamentos, documentos, agenda, indicadores; notificações | EPIC-020, EPIC-023 | 4 semanas |
| **▲ Fim do CORE OPERACIONAL (F0–F6) — o produto já opera um contrato real** |   |   |   |   |
| **▲ Fim do MVP COMERCIAL (F0–F8) — o produto já pode ser vendido** |   |   |   |   |
| **F9** | Comercial | Estoque com lotes e reservas; orçamentos com aprovação no portal; contratos e medição | EPIC-015, EPIC-016, EPIC-017 | 7 semanas |
| **F10** | Prova | Motor de documentos; certificados de calibração com padrões e incertezas; teste de segurança elétrica | EPIC-018, EPIC-019 | 7 semanas |
| **F11** | Escala | Automações; API pública e webhooks; dashboards personalizáveis; relatórios agendados | EPIC-024, EPIC-027, EPIC-021 (avançado) | 6 semanas |

> **REGRA DE DÍVIDA**
>
> O **modelo de dados das fases futuras entra desde F0** naquilo que é estrutural: `organization_id`, categorias de situação, motivo de espera, `plan_task`, `document` genérico, `domain_events`, `custom` jsonb, `meters`. Adicionar tabela depois é barato; mudar a semântica de uma coluna com dois anos de dados não é.

## 39. Épicos

#### EPIC-001 · **F0** — Fundação multitenant

**Objetivo**

Estabelecer a espinha dorsal: uma organização isolada, com usuários, sessão, contexto de requisição e trilha de auditoria — de modo que nenhuma funcionalidade posterior precise pensar em isolamento.

**Escopo**

*Monorepo e tooling*
- Monorepo com workspaces, gerenciador de pacotes fixado e *lockfile* versionado
- TypeScript `strict` em todos os pacotes, com `noUncheckedIndexedAccess`
- Lint, formatter e regra de lint própria barrando `unsafeCrossTenant` fora de `tools/`
- CI executando typecheck, lint, testes e build
- Configuração de ambientes com validação de segredos no *boot* (falha alto se faltar variável)

*Banco*
- Schema PostgreSQL com `organizations`, `users`, `memberships`, `membership_scopes`
- Migrations versionadas, reprodutíveis do zero, com teste de "banco vazio → migrations → seeds → testes"
- Papéis `aurora_owner`, `aurora_migrator`, `aurora_app`, `aurora_readonly` (§37)
- `ENABLE` + `FORCE ROW LEVEL SECURITY` e policy de isolamento em toda tabela tenant-scoped
- `aurora.current_organization_id()` com falha fechada
- Drizzle como camada de acesso, com repositórios que só operam dentro de unidade de trabalho

*Plataforma*
- `RequestContext` resolvido **no servidor** (organização, membership, ator, permissões, escopo, `request_id`)
- `AuthProvider` como porta; implementação concreta isolada em infraestrutura
- `audit_logs` por *trigger*, com antes/depois, ator, tipo de ator, IP, agente, origem e `request_id`
- `domain_events` com *outbox* transacional (evento e dado na mesma transação)
- pg-boss para jobs, com enfileiramento transacional
- Tratamento de erro padronizado (`code`, `message`, `details`, `request_id`), sem *stack trace* para o cliente
- Logs estruturados correlacionados por `request_id`
- Endpoints de saúde (*liveness* e *readiness*)
- OpenAPI inicial gerado a partir dos esquemas de validação
- Fábrica única de `uuid v7`

*Testes*
- Unitários do domínio puro
- Integração de banco com migrations reais
- **Suíte de isolamento cross-tenant reutilizável** (A/B) aplicável a qualquer recurso
- Teste de reuso de pool, de falha fechada e de configuração de papéis

**Entidades**

`organizations` · `users` · `memberships` · `audit_logs` · `domain_events`

**Dependências**

nenhuma

**User stories**

US-PLT-001 a US-PLT-006

**Critérios de aceite**

- Suíte de isolamento cobre 100 % dos endpoints e quebra o *build* se um deles vazar
- Toda escrita gera linha em `audit_logs` com ator, IP e diff
- Job enfileirado dentro de transação revertida não é executado

**Casos de borda**

- Usuário sem *membership* ativo em nenhuma organização
- Usuário com vínculo em duas organizações e sessão sem organização escolhida
- Transação longa que expira com evento no outbox

**Fora do escopo**

Papéis, telas de negócio, cobrança

**Riscos**

RLS mal configurada dá falsa sensação de segurança — mitigado pela camada 3 e pela suíte automatizada

#### EPIC-002 · **F1** — Identidade, papéis e escopo

**Objetivo**

Convidar pessoas, atribuir papéis prontos e restringir o que cada uma enxerga, sem que ninguém precise entender 95 permissões.

**Escopo**

- Convite por e-mail, aceite, primeiro acesso, recuperação de senha, MFA opcional
- Papéis de fábrica (§21) semeados e imutáveis; duplicação para customizar
- Editor granular por recurso (avançado, colapsado por padrão)
- Escopo em três eixos + materialização de locais acessíveis
- Troca de organização; `seat_type` e contagem de assentos
- Acesso de suporte com prazo e banner

**Entidades**

`roles` · `permissions` · `role_permissions` · `membership_roles` · `membership_scopes` · `membership_permission_overrides` · `support_access_grants`

**Dependências**

EPIC-001

**Critérios de aceite**

- Usuário com escopo de dois setores não recupera nem por API um registro de um terceiro setor
- Revogação individual (`deny`) vence sobre concessão por papel
- Remover vínculo invalida a sessão em menos de 60 s
- Papel de fábrica não é editável; a duplicata é

**Casos de borda**

- Último Owner tentando sair da organização
- Convite para e-mail que já é usuário de outra organização
- Escopo apontando para local arquivado
- Limite de assentos atingido durante um convite pendente

**Riscos**

Repetir o erro da referência (grupo Técnico com quase tudo) — mitigado por papéis prontos e por alerta quando um papel customizado ultrapassa 70 % das permissões

#### EPIC-003 · **F1** — Diretório: clientes, locais e fornecedores

**Objetivo**

Representar corretamente *quem* e *onde*, com uma árvore livre que sirva a hospitais hoje e a outros mercados depois.

**Escopo**

- Clientes, contatos, cliente interno e modo *single-customer*
- Tipos de local configuráveis com regras de aninhamento
- Árvore com `path`, mover subárvore, arquivar, importar
- Fornecedores, equipes, calendários e feriados, bloqueios de disponibilidade

**Entidades**

`customers` · `customer_contacts` · `location_types` · `locations` · `suppliers` · `teams` · `calendars` · `availability_blocks`

**Dependências**

EPIC-002

**Critérios de aceite**

- Mover uma subárvore de 500 locais atualiza todos os caminhos e escopos em uma transação
- Tipo inválido para o pai é recusado com mensagem que nomeia os tipos permitidos
- Arquivar local com ativo ativo é recusado com a lista de pendências e o caminho de transferência

**Casos de borda**

- Tentativa de criar ciclo ao mover
- Profundidade acima do limite
- Cliente com um único local raiz (clínica pequena)
- Local móvel (ambulância) sem endereço fixo

#### EPIC-005 · **F2** — Ativos e classificação

**Objetivo**

Inventário confiável, com fabricante e modelo normalizados, pronto para análise por modelo — a pergunta que a referência não consegue responder.

**Escopo**

- Categorias, fabricantes, modelos, níveis de criticidade
- Cadastro completo de ativo (§07) com unicidade configurável
- Ficha 360° com linha do tempo unificada
- Hierarquia pai/filho; transferência registrada; descomissionamento
- Importação por planilha com criação assistida de fabricante/modelo e fila de curadoria
- `show_on_work_order`

**Entidades**

`asset_categories` · `manufacturers` · `asset_models` · `criticality_levels` · `assets` · `asset_transfers` · `meters`

**Dependências**

EPIC-003, EPIC-004

**Critérios de aceite**

- Importar 27 mil ativos em menos de 10 minutos, com relatório de erros por linha
- Duplicidade em campo configurado é bloqueada na importação e no formulário
- Transferir ativo não altera OS históricas (snapshots preservados)

**Casos de borda**

- Ativo sem modelo cadastrado
- Ativo em empréstimo para outro cliente
- Ativo descomissionado com plano ativo e OS futura
- Fabricante grafado de cinco formas na planilha de origem

**Fora do escopo**

Depreciação e plano de substituição (Fase 3)

#### EPIC-007 · **F3** — Solicitações e triagem

**Objetivo**

Capturar a demanda do cliente em menos de 30 segundos e transformá-la em trabalho com rastreabilidade — sem poluir os indicadores de OS.

**Escopo**

- Abertura em 3 passos (web e mobile), por busca, lista do setor ou QR Code
- Detecção de duplicidade no envio
- Fila de triagem com prioridade, idade e responsável
- Aceitar (gerando 1..N OS), rejeitar com motivo, marcar duplicata, pedir informação
- Conversão automática opcional
- Avaliação 1–5 com comentário

**Entidades**

`service_requests` · `failure_codes` · `rejection_reasons`

**Dependências**

EPIC-005

**Critérios de aceite**

- Uma solicitação com 3 ativos gera 3 OS vinculadas em uma operação
- Solicitação rejeitada não aparece em nenhum indicador de OS
- Duplicata preserva o registro original e redireciona o acompanhamento

**Casos de borda**

- Solicitante abre chamado para ativo fora do seu escopo
- Ativo não identificado (o solicitante não sabe qual é)
- Solicitação cancelada depois de já ter OS em execução
- Mesmo solicitante abre duas solicitações idênticas em 5 minutos

#### EPIC-008 · EPIC-009 · **F3** — Ordens de serviço e máquina de estados

**Objetivo**

O registro central do produto, com comportamento governado por um grafo declarado — nunca por texto livre.

**Escopo**

- CRUD de OS com snapshots de ativo e local
- Catálogos: naturezas com `system_key`, situações com categoria, motivos de espera, códigos de falha
- Motor de transições com guardas, permissões e efeitos colaterais
- Requisitos de conclusão por natureza
- Lista virtualizada com filtros em chips e visões salvas; Kanban com validação de transição no *drop*
- Comentários com visibilidade; notas internas separadas das do cliente
- Histórico de situação com duração
- PDF da OS

**Entidades**

`work_orders` · `work_order_types` · `work_order_statuses` · `work_order_status_transitions` · `wait_reasons` · `work_order_status_history` · `work_order_comments`

**Dependências**

EPIC-007

**Critérios de aceite**

- Transição não declarada é recusada na API, no Kanban e no PWA, com mensagem que nomeia as transições possíveis
- Ir para `waiting` sem motivo é impossível — barrado no domínio e por constraint
- Toda transição grava histórico com duração no estado anterior e emite evento
- Lista com 100 mil OS filtrada por cliente e situação responde em menos de 400 ms (p95)

**Casos de borda**

- Dois usuários movendo a mesma OS simultaneamente (concorrência otimista por versão)
- OS fechada há 6 meses reaberta — SLA e fatos recalculados
- Natureza alterada depois da abertura, mudando os requisitos de conclusão
- Ativo descomissionado com OS aberta

**Riscos**

Organizações querendo replicar seus 42 estados antigos — mitigado por assistente de migração que mapeia estado antigo → (situação, motivo)

#### EPIC-011 · **F4** — Execução: checklists, horas, peças, evidências e assinatura

**Objetivo**

Tornar o registro do trabalho completo, rápido e à prova de auditoria.

**Escopo**

- Construtor de checklist versionado com seções, tipos, faixas e lógica condicional
- Resolução automática de checklists por procedimento aplicável
- Veredito automático e `fail_action` (foto, bloqueio, OS derivada)
- Cronômetro e lançamento manual de horas, com custo congelado
- Apontamento de peças (reserva e consumo)
- Fotos com finalidade (antes/depois/evidência)
- Assinatura desenhada e por código de e-mail, com hash

**Entidades**

`procedures` · `checklist_templates` · `checklist_responses` · `time_entries` · `work_order_parts` · `attachments` · `signatures`

**Dependências**

EPIC-008

**Critérios de aceite**

- Publicar nova versão de checklist não altera respostas anteriores
- Item numérico fora da faixa marca reprovado e exige foto quando configurado
- Concluir sem cumprir os requisitos da natureza retorna a lista do que falta, com link para cada campo

**Casos de borda**

- Checklist alterado enquanto uma OS o executa
- Duas pessoas apontando horas na mesma OS ao mesmo tempo
- Peça apontada e depois devolvida
- Assinatura coletada e OS reaberta em seguida

#### EPIC-014 · **F4** — PWA offline do técnico

**Objetivo**

Oito horas de trabalho sem rede, com zero perda de dados e conflito sempre visível.

**Escopo**

- Instalação, cache do *shell*, sincronização inicial do escopo do dia
- Base local (IndexedDB) com OS, ativos, checklists, catálogos, itens do almoxarifado
- Fila de saída com `client_operation_id`, ordem por agregado e retentativa
- Captura, compressão e upload retomável de fotos
- Leitura de QR Code offline
- Tela "Precisa da sua atenção" para conflitos
- Indicador permanente de pendências de sincronização

**Dependências**

EPIC-011

**Critérios de aceite**

- Executar e concluir uma OS completa em modo avião, sincronizando depois sem intervenção
- Reenviar a mesma operação nunca duplica registro
- OS cancelada no servidor durante execução offline gera conflito visível, com o trabalho do técnico preservado e recuperável

**Casos de borda**

- Dispositivo sem espaço para as fotos
- Rede intermitente durante o envio de um lote
- Técnico removido da equipe enquanto está offline
- Relógio do dispositivo errado

**Riscos**

Perda silenciosa de trabalho é o defeito mais grave possível — exige testes determinísticos de conflito e telemetria de sincronização desde o primeiro dia

#### EPIC-013 · **F6** — Planos de manutenção preventiva

**Objetivo**

Transformar política de manutenção em ordens de serviço, e execução em conformidade demonstrável.

**Escopo**

- Plano com múltiplas tarefas, cada uma com alvo declarativo, natureza, procedimento e frequência própria
- Ciclos com janela, tolerância e antecedência
- Geração automática ou manual das OS
- Painel de conformidade do ciclo e histórico de ciclos
- Dispensa de item com justificativa
- Cronograma anual exportável

**Entidades**

`maintenance_plans` · `plan_tasks` · `plan_cycles` · `plan_cycle_items`

**Dependências**

EPIC-011, EPIC-012

**Critérios de aceite**

- Um plano com preventiva semestral e calibração anual sobre o mesmo escopo gera as OS nas datas corretas de cada tarefa
- Ativo que entra no escopo no meio do ciclo só é coberto no ciclo seguinte, salvo configuração contrária
- Ativo descomissionado tem a OS futura cancelada automaticamente com motivo

**Casos de borda**

- Ciclo anterior encerrando com itens pendentes
- Alvo que passa a resolver zero ativos
- Mudança de frequência com ciclo em andamento
- Plano de frequência diária gerando volume alto de OS

#### EPIC-019 · **F10** — Metrologia: calibração, padrões e segurança elétrica

**Objetivo**

Emitir certificados que resistam a auditoria de acreditação, com cadeia de rastreabilidade íntegra.

**Escopo**

- Padrões (ativos com `modo = padrão`), perfis de incerteza por sensor e faixa, certificados de padrão com laboratório externo
- Certificado de calibração: condições ambientais, pontos de medição, resolução, faixa, unidade, fator k, critério de aceitação, correção de erro sistemático, veredito
- Bloqueio de emissão com padrão vencido na data da medição
- Liberação ao cliente manual ou automática; e-mail de liberação
- Teste de segurança elétrica com limites normativos e veredito

**Dependências**

EPIC-018

**Critérios de aceite**

- Tentar emitir com padrão vencido é recusado, nomeando o padrão e a data de vencimento
- Recalcular a incerteza de um certificado emitido é impossível — gera nova versão
- O PDF apresenta rastreabilidade completa até o laboratório acreditado

**Casos de borda**

- Padrão que vence entre a medição e a emissão
- Certificado emitido para o ativo errado
- Ponto de medição com leituras insuficientes

**Riscos**

Erro de cálculo metrológico tem consequência regulatória — exige suíte de testes com casos de referência validados por um metrologista antes do lançamento

#### Demais · épicos — EPIC-004 · 006 · 010 · 012 · 015 · 016 · 017 · 018 · 020 · 021 · 022 · 023 · 024 · 025 · 026 · 027

Detalhados no mesmo formato no backlog (§43) e nas seções de domínio correspondentes. Resumo de objetivo:

| Épico | Objetivo | Fase |
| --- | --- | --- |
| **EPIC-004** — Catálogos e campos personalizados | Taxonomias governadas, com mesclagem assistida e arquivamento; motor de campos personalizados tipados | F1 |
| **EPIC-006** — QR Code e etiquetas | Token opaco, geração em lote, folha de etiquetas, rota pública de resolução | F2 |
| **EPIC-010** — SLA | Políticas, alvos, calendários, feriados, relógios com pausa, alertas de 80 % e violação | F5 |
| **EPIC-012** — Agenda | Três lentes, baldes, arrastar-e-soltar, capacidade, conflitos, reagendamento notificado | F5 |
| **EPIC-015** — Estoque | Almoxarifados, lotes, reservas, movimentos como razão imutável, mínimo, inventário | F9 |
| **EPIC-016** — Orçamentos | Versionamento, aprovação no portal, motivos de recusa, faturamento com baixa | F9 |
| **EPIC-017** — Contratos | Escopo, SLA, franquias, medição mensal, alertas de vencimento | F9 |
| **EPIC-018** — Motor de documentos | Tipos, numeração, templates, versão, assinatura com hash, validade, liberação | F10 |
| **EPIC-020** — Portal do cliente | Aplicação própria com vocabulário traduzido e superfície de escrita mínima | F8 |
| **EPIC-021** — Analytics | Tabelas de fato, catálogo de métricas com definição visível, painéis por papel, drill-down | F7 |
| **EPIC-022** — Auditoria e eventos | Trilha com diff e IP, barramento de eventos, linha do tempo por registro | F0/F7 |
| **EPIC-023** — Notificações | Roteador multicanal, preferências, digest, silêncio, de-duplicação, verificação de e-mail | F8 |
| **EPIC-024** — Automações | Gatilho, condição, ação; simulação antes de ativar; log de execução; salvaguardas | F11 |
| **EPIC-025** — Busca global | Paleta de comandos, índice por escopo, tolerância a erro de digitação | F7 |
| **EPIC-026** — Importação e migração | Planilhas de ativos, locais, itens e usuários; assistente de mapeamento de estados legados | F2/F9 |
| **EPIC-027** — API e webhooks | OpenAPI, chaves com escopo, idempotência, webhooks assinados com retentativa | F11 |

## 40. User stories

Prefixos: `PLT` plataforma · `DIR` diretório · `AST` ativos · `REQ` solicitações · `WO` ordens de serviço · `EXE` execução · `SLA` · `PLN` planos · `SCH` agenda · `FLD` campo/PWA · `INV` estoque · `QUO` orçamentos · `DOC` documentos · `POR` portal · `ANL` analytics · `AUT` automação. Cada história é implementável e testável isoladamente.

### Plataforma e acesso

#### US-PLT-001

**Como** pessoa convidada **quero** aceitar o convite e definir minha senha **para** acessar a organização que me convidou.

```gherkin
AC1 GIVEN um convite válido e não expirado WHEN abro o link e defino uma senha que atende à política THEN minha conta é criada, o membership fica active e sou levado ao painel do meu papel.
AC2 GIVEN um convite expirado THEN vejo a explicação e um botão para solicitar novo convite ao administrador.
AC3 GIVEN que meu e-mail já é usuário em outra organização WHEN aceito THEN um novo membership é criado e o seletor de organização passa a existir para mim.
AC4 O aceite emite member.joined e registra IP e agente na trilha.

```

#### US-PLT-004

**Como** administrador **quero** definir o escopo de dados de um membro **para** que ele só enxergue os clientes e setores sob sua responsabilidade.

```gherkin
AC1 GIVEN um membro com escopo em duas subárvores WHEN ele lista ativos, OS ou solicitações THEN só retornam registros dessas subárvores, inclusive via API.
AC2 GIVEN o mesmo membro WHEN ele acessa diretamente a URL de um registro fora do escopo THEN recebe 404, nunca 403.
AC3 GIVEN que um local é movido para outra subárvore THEN os escopos materializados são atualizados na mesma transação.
AC4 A alteração de escopo emite member.scope_changed com valores anterior e novo.

```

#### US-PLT-006

**Como** Owner **quero** conceder acesso temporário ao suporte **para** resolver um problema sem abrir mão da rastreabilidade.

```gherkin
AC1 A concessão exige motivo e prazo, com máximo de 7 dias.
AC2 GIVEN um acesso ativo THEN toda a interface exibe um banner permanente identificando a sessão de suporte.
AC3 Toda ação do suporte grava actor_kind = support na trilha.
AC4 Expirado o prazo, o acesso é revogado automaticamente e emite support_access.expired.

```

### Ativos

#### US-AST-001

**Como** gestor **quero** cadastrar um equipamento **para** manter o parque atualizado e rastreável.

```gherkin
AC1 Campos obrigatórios: categoria, cliente, local, situação. Modelo é opcional.
AC2 GIVEN que a organização configurou unicidade por número de série WHEN informo um número já existente THEN o cadastro é recusado, com link para o ativo existente.
AC3 GIVEN um modelo selecionado THEN os dados técnicos padrão e a vida útil são pré-preenchidos e podem ser sobrescritos campo a campo.
AC4 GIVEN um local com allows_assets = false THEN ele não aparece como destino selecionável.
AC5 A criação emite asset.created e gera qr_token.

```

#### US-AST-004

**Como** gestor **quero** importar o inventário por planilha **para** migrar do sistema anterior sem digitação.

```gherkin
AC1 O assistente permite mapear colunas da planilha para campos, com pré-visualização das 20 primeiras linhas.
AC2 GIVEN fabricantes grafados de formas diferentes THEN o sistema propõe agrupamento e cria os registros como unverified, listados em uma fila de curadoria.
AC3 GIVEN uma linha inválida THEN ela é reportada com número da linha, coluna e motivo, e as demais são importadas.
AC4 A importação roda como job com progresso visível e relatório final baixável.
AC5 Registros importados recebem data_quality = imported.

```

#### US-AST-007

**Como** coordenador **quero** transferir um equipamento de setor **para** refletir a realidade sem corromper o histórico.

```gherkin
AC1 A transferência registra origem, destino, responsável e motivo, e emite asset.transferred.
AC2 GIVEN OS históricas do ativo THEN elas continuam exibindo o local em que o serviço foi feito, a partir do snapshot.
AC3 GIVEN OS abertas THEN o sistema pergunta se devem acompanhar o ativo, e aplica a escolha.
AC4 GIVEN transferência do tipo empréstimo THEN a data de retorno é obrigatória e gera lembrete.

```

### Solicitações

#### US-REQ-001

**Como** enfermeira de UTI **quero** abrir um chamado lendo o QR Code do equipamento **para** pedir manutenção em menos de 30 segundos.

```gherkin
AC1 GIVEN que estou autenticada no portal WHEN leio o QR THEN o equipamento já vem preenchido e vou direto ao passo "o que houve".
AC2 A lista de sintomas é filtrada pela categoria do equipamento, com no máximo 12 opções e busca.
AC3 Posso anexar fotos direto da câmera.
AC4 GIVEN que existe solicitação aberta para o mesmo equipamento nos últimos 7 dias THEN vejo o aviso com o número e a data e escolho entre acompanhar a existente ou abrir nova.
AC5 GIVEN que o equipamento está fora do meu escopo THEN ele não aparece e a leitura do QR informa que devo procurar o setor responsável.
AC6 Ao enviar, recebo o número da solicitação e o prazo previsto de resposta, se houver política de SLA.

```

#### US-REQ-003

**Como** coordenador **quero** triar uma solicitação **para** transformá-la em trabalho ou recusá-la com justificativa.

```gherkin
AC1 GIVEN uma solicitação em submitted WHEN a assumo THEN ela vai para triage, grava first_response_at e o relógio de resposta é encerrado.
AC2 GIVEN uma solicitação com 3 equipamentos WHEN aceito THEN escolho gerar 1 OS por equipamento ou 1 OS única, e a escolha é registrada.
AC3 GIVEN que recuso THEN o motivo é obrigatório e o solicitante recebe a justificativa.
AC4 GIVEN que marco como duplicata THEN devo indicar a solicitação original e o solicitante passa a acompanhá-la.
AC5 Solicitações rejeitadas ou duplicadas não aparecem em nenhum indicador de OS.

```

### Ordens de serviço

#### US-WO-002

**Como** coordenador **quero** mover uma OS entre situações **para** refletir o andamento real, sem inventar estados.

```gherkin
AC1 GIVEN uma OS em in_progress WHEN tento mover para closed THEN a ação é recusada e a mensagem lista as transições possíveis a partir de in_progress.
AC2 GIVEN que movo para waiting THEN o motivo de espera é obrigatório e, se o motivo exigir nota, a nota também.
AC3 GIVEN um motivo com pauses_sla = true THEN o relógio de resolução pausa e o painel mostra "SLA pausado desde {hora}".
AC4 Toda transição grava work_order_status_history com duração no estado anterior e emite work_order.status_changed.
AC5 GIVEN que não tenho a permissão exigida pela transição THEN a ação não é oferecida na interface nem aceita pela API.

```

#### US-WO-005

**Como** técnico **quero** concluir a OS **para** registrar que o trabalho terminou.

```gherkin
AC1 GIVEN uma OS de natureza preventiva cuja configuração exige checklist completo, horas e foto "depois"
AND falta a foto
WHEN solicito a conclusão
THEN recebo a lista do que falta, com link para cada pendência, e a OS permanece em in_progress.
AC2 GIVEN todos os requisitos cumpridos THEN a OS vai para completed, grava completed_at e o ator, encerra o relógio de resolução, calcula os custos e emite work_order.completed.
AC3 GIVEN que a natureza causa parada do ativo THEN o ativo volta de under_maintenance para active.
AC4 GIVEN que a organização não exige validação THEN a OS segue automaticamente para validated.

```

#### US-WO-009

**Como** gestor **quero** reabrir uma OS fechada **para** corrigir um registro, sem apagar a história.

```gherkin
AC1 A reabertura exige a permissão work_order.reopen e justificativa.
AC2 Um novo relógio de resolução é aberto; o anterior é preservado com seu resultado.
AC3 Os fatos analíticos são recalculados e a OS passa a contar como reincidência se a natureza for corretiva e o sintoma for o mesmo.
AC4 Emite work_order.reopened e registra na trilha com o texto da justificativa.

```

### Execução e campo

#### US-EXE-002

**Como** técnico **quero** preencher o checklist da preventiva **para** comprovar o que foi verificado.

```gherkin
AC1 GIVEN uma OS de natureza preventiva para um ativo da categoria X THEN os checklists dos procedimentos aplicáveis já vêm anexados.
AC2 GIVEN um item numérico com faixa 210–230 V WHEN informo 245 THEN o item é marcado reprovado e, se configurado, exige foto.
AC3 GIVEN um item com fail_action = create_work_order reprovado THEN ao concluir a OS o sistema propõe criar a OS corretiva derivada, já preenchida.
AC4 A resposta congela a versão do template; publicar nova versão não altera esta resposta.
AC5 Itens ocultos por condição não contam para a completude.

```

#### US-FLD-001

**Como** técnico **quero** ver e executar minhas OS sem internet **para** trabalhar em subsolo e sala blindada.

```gherkin
AC1 GIVEN sincronização feita e dispositivo em modo avião THEN abro "Hoje", vejo minhas OS e abro qualquer uma em menos de 300 ms.
AC2 GIVEN modo avião WHEN executo checklist, tiro 8 fotos, aponto 2 h e colho assinatura THEN tudo é armazenado localmente e o contador de pendências mostra as operações na fila.
AC3 GIVEN retorno da conexão THEN a fila é enviada em ordem por OS, com progresso visível, e nenhuma operação é aplicada duas vezes.
AC4 GIVEN que a OS foi cancelada no servidor durante a execução THEN a operação falha, a OS aparece em "Precisa da sua atenção" com a explicação, e o trabalho registrado fica preservado e exportável.
AC5 Nenhuma condição de erro descarta dados do técnico em silêncio.

```

### SLA, planos e agenda

#### US-SLA-002

**Como** gestor **quero** que o SLA respeite horário comercial e feriados **para** que a meta seja justa.

```gherkin
AC1 GIVEN política com 8 h úteis e calendário 08:00–18:00 de segunda a sexta WHEN a OS abre sexta às 16:00 THEN o vencimento é segunda às 14:00.
AC2 GIVEN um feriado municipal cadastrado para a subárvore do local THEN ele é descontado.
AC3 GIVEN local em fuso diferente do da organização THEN o cálculo usa o fuso do local.
AC4 GIVEN que não há política aplicável THEN a OS não tem due_at e é excluída dos indicadores de SLA, com a cobertura informada no widget.

```

#### US-PLN-003

**Como** gestor **quero** que o plano gere as OS do ciclo automaticamente **para** não depender de alguém lembrar.

```gherkin
AC1 GIVEN plano anual com lead_time_days = 15 e ciclo iniciando em 20/07 WHEN o job roda em 05/07 THEN o ciclo é criado e as OS são geradas em open.
AC2 GIVEN uma tarefa com alvo "categoria Ventilador na subárvore UTI" THEN são geradas tantas OS quantos ativos ativos resolverem o alvo.
AC3 GIVEN um ativo descomissionado THEN ele não gera OS, e OS já geradas para ele são canceladas com motivo asset_decommissioned.
AC4 A geração é idempotente: rodar o job duas vezes no mesmo dia não duplica OS.
AC5 Ao final, o responsável recebe uma notificação com o resumo "N OS geradas para o ciclo {período}".

```

#### US-SCH-001

**Como** coordenador **quero** arrastar uma OS não agendada para o calendário de um técnico **para** programar o dia em segundos.

```gherkin
AC1 GIVEN uma OS no balde "não agendadas" WHEN arrasto para terça 09:00 do técnico Rafael THEN a OS passa a scheduled, com assignee, scheduled_start e duração estimada da natureza.
AC2 GIVEN que Rafael tem férias nesse dia THEN o solto é recusado com a explicação.
AC3 GIVEN que a carga de Rafael passa de 100 % THEN o agendamento é aceito, com aviso visível na barra de capacidade.
AC4 Rafael recebe notificação e a mudança emite work_order.scheduled.

```

### Portal, analytics e comercial

#### US-POR-004

**Como** solicitante **quero** aprovar um orçamento pelo portal **para** destravar o conserto sem trocar e-mails.

```gherkin
AC1 GIVEN um orçamento enviado THEN ele aparece em destaque no meu início, com valor, itens, validade e prazo.
AC2 WHEN aprovo THEN o aceite registra usuário, IP e carimbo; as peças são reservadas; a OS sai de waiting/quote_approval; emite quote.approved.
AC3 WHEN reprovo THEN o motivo é obrigatório e vai para a análise de perda.
AC4 GIVEN orçamento vencido THEN as ações ficam indisponíveis e vejo a data em que expirou.
AC5 Em nenhum momento vejo custo interno, margem ou fornecedor.

```

#### US-ANL-002

**Como** gestor **quero** entender como cada indicador é calculado **para** defendê-lo em reunião com o cliente.

```gherkin
AC1 GIVEN qualquer indicador na tela THEN um ícone abre a definição com numerador, denominador, filtros aplicados, período e cobertura de dados.
AC2 GIVEN um indicador calculado sobre dados incompletos THEN a cobertura é exibida ("78 % dos ativos possuem valor de reposição").
AC3 WHEN clico no número THEN abre a lista dos registros que o compõem, com os mesmos filtros.
AC4 Nenhum indicador financeiro é renderizado sem insight.read_financial_metrics.

```

#### US-INV-003

**Como** técnico **quero** apontar as peças usadas **para** que o estoque e o custo fiquem corretos.

```gherkin
AC1 GIVEN o almoxarifado do meu carro THEN a busca de peça mostra o saldo local.
AC2 WHEN aponto 2 unidades THEN na sincronização é gerado stock_movement de consumo com referência à OS e custo congelado.
AC3 GIVEN que o saldo acabou entre a minha leitura e a sincronização THEN sou avisado, a operação fica pendente e escolho outro almoxarifado ou registro requisição.
AC4 GIVEN peça devolvida THEN é gerado movimento inverso, nunca exclusão do original.

```

#### US-DOC-002

**Como** metrologista **quero** que o sistema me impeça de emitir certificado com padrão vencido **para** não invalidar a acreditação.

```gherkin
AC1 GIVEN um padrão cujo certificado venceu antes da data da medição WHEN tento emitir THEN a emissão é recusada, nomeando o padrão, seu número de certificado e a data de vencimento.
AC2 GIVEN padrão que vence entre a medição e a emissão THEN a emissão é permitida, pois a validade é avaliada na data da medição, e o PDF registra ambas as datas.
AC3 O certificado emitido é imutável; correção gera nova versão que supersede a anterior, mantendo as duas acessíveis.
AC4 Emitir consome o próximo número da série de forma transacional, sem buraco e sem colisão.

```

## 41. Padrão de critérios de aceite

Toda história segue o mesmo formato, para que possa virar teste automatizado sem tradução.

| Regra | Descrição |
| --- | --- |
| **Formato** | `GIVEN` estado inicial · `AND` pré-condições · `WHEN` ação única · `THEN` resultado observável · `AND` efeitos |
| **Observável** | O `THEN` descreve algo verificável por API ou por interface. "O sistema processa corretamente" não é critério |
| **Efeitos completos** | Todo critério de mutação enumera: campo gravado, evento emitido, notificação disparada, relógio afetado, registro de auditoria |
| **Caminho negativo** | Toda história tem pelo menos um critério de recusa, com a mensagem esperada |
| **Permissão** | Toda história com ação sensível declara o comportamento sem a permissão: ação ausente na interface **e** recusada na API |
| **Escopo** | Toda história de leitura declara o comportamento fora do escopo: `404` |
| **Desempenho** | Histórias de lista declaram o alvo de p95 com o volume de referência |
| **Offline** | Histórias executáveis em campo declaram o comportamento sem rede e na sincronização |

#### Modelo canônico

```gherkin
US-XXX-000 — Como {persona} quero {ação} para {benefício}.

AC1  GIVEN {estado} AND {pré-condição} WHEN {ação} THEN {resultado} AND {efeito colateral}
AC2  GIVEN {estado inválido} WHEN {ação} THEN {recusa} AND {mensagem exata esperada}
AC3  GIVEN {usuário sem permissão} THEN {ação indisponível na UI} AND {403 na API}
AC4  GIVEN {registro fora do escopo} THEN {404}
AC5  {efeitos de auditoria e evento de domínio}

```

## 42. Edge cases

Situações excepcionais que precisam de decisão de produto antes da implementação. Cada uma tem tratamento definido — nenhuma fica para o desenvolvedor resolver no momento.

| Situação | Módulo | Tratamento definido |
| --- | --- | --- |
| Equipamento descomissionado com preventiva futura no plano | Planos | Ativo sai da resolução do alvo; OS futuras já geradas são canceladas com motivo `asset_decommissioned`; o item do ciclo fica `skipped` e não conta contra a conformidade |
| Técnico removido da equipe com OS agendada | Agenda | OS volta para `open`, mantém a janela, entra no balde "Reagendar" e o coordenador é notificado. A OS **não** perde o histórico do responsável anterior |
| Usuário responsável por histórico sendo excluído | Plataforma | Usuário nunca é excluído: é desativado. A anonimização LGPD substitui nome, e-mail e telefone por marcadores, preservando o vínculo por id e a integridade do histórico |
| Cliente inativado com OS abertas | Diretório | Inativação é recusada enquanto houver OS ativa; o sistema lista as pendências e oferece encerrá-las ou transferi-las |
| OS cancelada com peça reservada | Estoque | Reserva liberada automaticamente; se a peça já foi consumida, é gerado movimento de devolução e o técnico é notificado para confirmar a devolução física |
| Peça consumida offline que já não existe no estoque | Estoque / PWA | Operação entra em conflito visível; saldo não fica negativo; o técnico escolhe outro almoxarifado ou registra requisição |
| Equipamento transferido de local com OS histórica | Ativos | OS históricas preservam `location_snapshot`; a ficha do ativo mostra a linha do tempo com a mudança de local marcada |
| Local movido enquanto um usuário navega com escopo naquela subárvore | Diretório | Escopos materializados recalculados na transação; sessão do usuário revalida escopo na próxima requisição |
| Contrato expirado com OS em andamento | Contratos | A OS mantém o *snapshot* da política de SLA da abertura; novas OS caem na política do cliente ou da organização; alerta ao financeiro |
| SLA correndo durante feriado não cadastrado | SLA | Ao cadastrar o feriado retroativamente, os relógios **fechados** não são recalculados (o resultado é histórico); os abertos são recalculados e a mudança fica registrada |
| Mudança de prioridade com relógio em curso | SLA | Novo alvo aplicado a partir do início original; se o novo prazo já passou, marca violação imediata e registra o recálculo |
| Checklist alterado durante execução | Checklists | Impossível: publicado é imutável. A execução usa a versão congelada; uma nova versão só vale para OS futuras |
| Sincronização duplicada da mesma operação | PWA | Idempotência por `client_operation_id`; a segunda tentativa retorna o resultado da primeira |
| Aprovação concorrente do mesmo orçamento | Orçamentos | Concorrência otimista por versão; a segunda aprovação recebe erro informando quem aprovou e quando |
| Dois usuários movendo a mesma OS ao mesmo tempo | OS | Concorrência otimista; o perdedor recebe o estado atual e a opção de reaplicar |
| Ciclo de plano encerrando com itens pendentes | Planos | Itens ficam `overdue`, contam contra a conformidade do ciclo encerrado, e as OS permanecem abertas — nunca são apagadas |
| Plano diário gerando volume alto | Planos | Limite configurável de OS por execução de job, com aviso ao criar o plano e geração em lotes |
| Alvo de tarefa que passa a resolver zero ativos | Planos | Ciclo é criado vazio e sinalizado no painel do plano ("nenhum ativo resolveu o alvo") |
| Solicitante abre chamado para ativo de outro setor | Portal | Ativo não aparece; a leitura do QR informa o setor responsável e oferece contato |
| Número de documento já emitido em documento cancelado | Documentos | Número permanece queimado, com o motivo do cancelamento; nunca reutilizado |
| Assinatura coletada e OS reaberta depois | Documentos | A assinatura permanece vinculada à versão assinada; a reabertura gera nova versão que exige nova assinatura |
| Padrão vence entre a medição e a emissão | Metrologia | Emissão permitida; a validade é avaliada na data da medição e o PDF registra as duas datas |
| Migração de organização com 42 estados legados | Migração | Assistente obrigatório que mapeia cada estado antigo para (situação, motivo de espera), com pré-visualização da distribuição e possibilidade de fusão |
| Fabricante grafado de cinco formas na planilha | Importação | Agrupamento proposto por similaridade; criação como `unverified`; fila de curadoria com fusão em um clique |
| Último Owner tentando sair | Plataforma | Recusado; exige transferir a titularidade antes |
| Limite de assentos atingido com convites pendentes | Plataforma | Convite fica `waiting_seat`; ao liberar assento, o administrador escolhe qual convite ativar |
| Relógio do dispositivo do técnico errado | PWA | Carimbos do cliente são registrados, mas o servidor grava também o horário de recebimento; divergência acima de 15 min é sinalizada |
| Dispositivo sem espaço para fotos | PWA | Aviso antes da captura; compressão mais agressiva; upload prioritário das fotos quando houver rede |
| Anexo com vírus | Arquivos | Quarentena até a varredura; o anexo aparece como "em verificação" e não é baixável |
| Automação em laço | Automações | Eventos causados por regra carregam `caused_by_rule_id`; profundidade máxima 3; regra que estoura entra em quarentena |
| Webhook do cliente fora do ar por dias | API | Retentativa exponencial até 24 h; depois vai para *dead letter* com reenvio manual; endpoint desativado após N falhas consecutivas, com aviso |

## 43. Backlog funcional

Complexidade: **S** ≤ 2 dias · **M** ≤ 1 semana · **L** ≤ 3 semanas · **XL** > 3 semanas (candidato a quebrar).

| ID | Épico | Feature | US | Prio | Fase | Depende | Compl. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BL-001 | 001 | Esquema base, convenções e migrações | PLT-002 | **P0** | F0 | — | L |
| BL-002 | 001 | Contexto de requisição e injeção automática de tenant | PLT-003 | **P0** | F0 | BL-001 | M |
| BL-003 | 001 | RLS em todas as tabelas + suíte de isolamento no CI | PLT-003 | **P0** | F0 | BL-002 | L |
| BL-004 | 022 | Trigger de auditoria com diff, IP e agente | PLT-005 | **P0** | F0 | BL-001 | M |
| BL-005 | 022 | Outbox de eventos de domínio e publicador | PLT-005 | **P0** | F0 | BL-001 | M |
| BL-006 | 001 | Fila de jobs transacional e agendador | PLT-006 | **P0** | F0 | BL-001 | M |
| BL-007 | 002 | Autenticação, sessão, MFA opcional, recuperação | PLT-001 | **P0** | F0 | BL-002 | M |
| BL-008 | 002 | Convite, aceite e gestão de assentos | PLT-001 | **P0** | F1 | BL-007 | M |
| BL-009 | 002 | Papéis de fábrica + catálogo de permissões | PLT-004 | **P0** | F1 | BL-008 | L |
| BL-010 | 002 | Escopo em três eixos + materialização | PLT-004 | **P0** | F1 | BL-009 | L |
| BL-011 | 002 | Editor granular de papel customizado | PLT-004 | **P1** | F1 | BL-009 | M |
| BL-012 | 002 | Acesso de suporte com prazo e banner | PLT-006 | **P1** | F1 | BL-009 | S |
| BL-013 | 003 | Clientes, contatos e modo single-customer | DIR-001 | **P0** | F1 | BL-010 | M |
| BL-014 | 003 | Tipos de local e árvore com caminho materializado | DIR-002 | **P0** | F1 | BL-013 | L |
| BL-015 | 003 | Mover subárvore com recálculo de escopo | DIR-003 | **P0** | F1 | BL-014 | M |
| BL-016 | 003 | Fornecedores | DIR-004 | **P2** | F1 | BL-013 | S |
| BL-017 | 003 | Equipes, membros e cobertura | DIR-005 | **P0** | F1 | BL-010 | M |
| BL-018 | 003 | Calendários, janelas, feriados e ausências | DIR-006 | **P1** | F1 | BL-017 | M |
| BL-019 | 004 | Catálogos com arquivamento e mesclagem assistida | DIR-007 | **P0** | F1 | BL-013 | M |
| BL-020 | 004 | Campos personalizados tipados + validação no servidor | DIR-008 | **P1** | F1 | BL-019 | L |
| BL-021 | 005 | Categorias, fabricantes, modelos e criticidade | AST-002 | **P0** | F2 | BL-019 | M |
| BL-022 | 005 | Cadastro de ativo com unicidade configurável | AST-001 | **P0** | F2 | BL-021 | L |
| BL-023 | 005 | Ficha 360° com linha do tempo unificada | AST-003 | **P0** | F2 | BL-022 | L |
| BL-024 | 026 | Importação de ativos com curadoria de fabricantes | AST-004 | **P0** | F2 | BL-022 | L |
| BL-025 | 006 | QR token, rota pública e folha de etiquetas | AST-005 | **P0** | F2 | BL-022 | M |
| BL-026 | 005 | Hierarquia pai/filho de ativos | AST-006 | **P2** | F2 | BL-022 | S |
| BL-027 | 005 | Transferência e empréstimo de ativos | AST-007 | **P1** | F2 | BL-022 | M |
| BL-028 | 005 | Descomissionamento com efeitos em planos | AST-008 | **P1** | F2 | BL-022 | S |
| BL-029 | 007 | Abertura de solicitação em 3 passos (web e mobile) | REQ-001 | **P0** | F3 | BL-025 | L |
| BL-030 | 007 | Detecção de duplicidade | REQ-002 | **P1** | F3 | BL-029 | M |
| BL-031 | 007 | Fila de triagem e máquina de estados da solicitação | REQ-003 | **P0** | F3 | BL-029 | L |
| BL-032 | 007 | Conversão 1→N e conversão automática opcional | REQ-003 | **P0** | F3 | BL-031 | M |
| BL-033 | 007 | Avaliação 1–5 com comentário | REQ-005 | **P1** | F3 | BL-031 | S |
| BL-034 | 009 | Catálogos: naturezas, situações, motivos, códigos de falha | WO-001 | **P0** | F3 | BL-019 | M |
| BL-035 | 009 | Motor de transições com guardas e efeitos | WO-002 | **P0** | F3 | BL-034 | XL |
| BL-036 | 008 | CRUD de OS com snapshots | WO-003 | **P0** | F3 | BL-035 | L |
| BL-037 | 008 | Lista virtualizada com chips de filtro e visões salvas | WO-004 | **P0** | F3 | BL-036 | L |
| BL-038 | 008 | Kanban com validação de transição no drop | WO-006 | **P1** | F3 | BL-036 | M |
| BL-039 | 008 | Requisitos de conclusão por natureza | WO-005 | **P0** | F3 | BL-035 | M |
| BL-040 | 008 | Comentários com visibilidade e menções | WO-007 | **P0** | F3 | BL-036 | M |
| BL-041 | 008 | Histórico de situação com duração | WO-008 | **P0** | F3 | BL-035 | S |
| BL-042 | 008 | Reabertura com nova revisão | WO-009 | **P1** | F3 | BL-035 | S |
| BL-043 | 008 | PDF da OS com template versionado | WO-010 | **P1** | F3 | BL-036 | L |
| BL-044 | 011 | Construtor de checklist versionado | EXE-001 | **P0** | F4 | BL-036 | L |
| BL-045 | 011 | Procedimentos e resolução automática por contexto | EXE-002 | **P0** | F4 | BL-044 | M |
| BL-046 | 011 | Execução com veredito automático e fail_action | EXE-002 | **P0** | F4 | BL-045 | L |
| BL-047 | 011 | Horas: cronômetro, manual, custo congelado | EXE-003 | **P0** | F4 | BL-036 | M |
| BL-048 | 011 | Fotos com finalidade e compressão | EXE-004 | **P0** | F4 | BL-036 | M |
| BL-049 | 011 | Assinatura desenhada e por código de e-mail | EXE-005 | **P0** | F4 | BL-036 | M |
| BL-050 | 014 | Shell do PWA, instalação e sincronização inicial | FLD-001 | **P0** | F4 | BL-046 | L |
| BL-051 | 014 | Base local e fila de saída idempotente | FLD-001 | **P0** | F4 | BL-050 | XL |
| BL-052 | 014 | Tela de conflitos "Precisa da sua atenção" | FLD-002 | **P0** | F4 | BL-051 | M |
| BL-053 | 014 | Leitura de QR e criação de ativo em campo | FLD-003 | **P1** | F4 | BL-050 | M |
| BL-054 | 010 | Políticas, alvos e cascata de resolução | SLA-001 | **P0** | F5 | BL-036 | L |
| BL-055 | 010 | Relógio com calendário, feriado, fuso e pausa | SLA-002 | **P0** | F5 | BL-054 | XL |
| BL-056 | 010 | Alertas de 80 % e violação | SLA-003 | **P0** | F5 | BL-055 | M |
| BL-057 | 012 | Agenda: calendário, recursos, baldes, drag-and-drop | SCH-001 | **P0** | F5 | BL-036 | XL |
| BL-058 | 012 | Capacidade, conflitos e bloqueios de ausência | SCH-002 | **P1** | F5 | BL-057 | M |
| BL-059 | 013 | Plano com tarefas e alvos declarativos | PLN-001 | **P0** | F6 | BL-045 | L |
| BL-060 | 013 | Ciclos, tolerância e antecedência | PLN-002 | **P0** | F6 | BL-059 | L |
| BL-061 | 013 | Geração automática idempotente de OS | PLN-003 | **P0** | F6 | BL-060 | L |
| BL-062 | 013 | Painel de conformidade e ciclos anteriores | PLN-004 | **P0** | F6 | BL-061 | M |
| BL-063 | 013 | Cronograma anual exportável | PLN-005 | **P1** | F6 | BL-062 | M |
| BL-064 | 021 | Pipeline de fatos a partir de eventos | ANL-001 | **P0** | F7 | BL-005 | XL |
| BL-065 | 021 | Catálogo de métricas com definição visível | ANL-002 | **P0** | F7 | BL-064 | L |
| BL-066 | 021 | Painéis por papel com filtros globais e drill-down | ANL-003 | **P0** | F7 | BL-065 | L |
| BL-067 | 025 | Índice de busca e paleta de comandos | ANL-005 | **P0** | F7 | BL-036 | L |
| BL-068 | 020 | Portal: início, solicitações, equipamentos | POR-001 | **P0** | F8 | BL-031 | L |
| BL-069 | 020 | Portal: tradução de vocabulário por dado | POR-002 | **P0** | F8 | BL-068 | S |
| BL-070 | 020 | Portal: documentos, agenda e indicadores do escopo | POR-003 | **P1** | F8 | BL-068 | M |
| BL-071 | 023 | Roteador de notificações, preferências e digest | NOT-001 | **P0** | F8 | BL-005 | L |
| BL-072 | 023 | Verificação de e-mail e lista de bloqueio | NOT-002 | **P1** | F8 | BL-071 | M |
| BL-073 | 015 | Itens, almoxarifados, lotes e saldos | INV-001 | **P1** | F9 | BL-036 | L |
| BL-074 | 015 | Movimentos como razão imutável | INV-002 | **P1** | F9 | BL-073 | M |
| BL-075 | 015 | Reserva e consumo vinculados à OS | INV-003 | **P1** | F9 | BL-074 | M |
| BL-076 | 015 | Alerta de mínimo e inventário cíclico | INV-004 | **P2** | F9 | BL-074 | M |
| BL-077 | 016 | Orçamento versionado com itens e totais | QUO-001 | **P1** | F9 | BL-073 | L |
| BL-078 | 016 | Aprovação no portal com registro de aceite | QUO-002 | **P1** | F9 | BL-077 | M |
| BL-079 | 016 | Faturamento com baixa de estoque por lote | QUO-003 | **P2** | F9 | BL-078 | M |
| BL-080 | 017 | Contratos, cobertura e SLA contratual | CTR-001 | **P1** | F9 | BL-054 | L |
| BL-081 | 017 | Medição mensal e franquias | CTR-002 | **P2** | F9 | BL-080 | L |
| BL-082 | 018 | Motor de documentos, tipos, numeração e templates | DOC-001 | **P1** | F10 | BL-043 | XL |
| BL-083 | 018 | Assinatura com hash e versionamento | DOC-003 | **P1** | F10 | BL-082 | M |
| BL-084 | 019 | Padrões, perfis de incerteza e certificados de padrão | DOC-002 | **P1** | F10 | BL-082 | L |
| BL-085 | 019 | Certificado de calibração com pontos e fator k | DOC-002 | **P1** | F10 | BL-084 | XL |
| BL-086 | 019 | Teste de segurança elétrica com veredito | DOC-004 | **P2** | F10 | BL-082 | L |
| BL-087 | 024 | Motor de regras com simulação e log | AUT-001 | **P2** | F11 | BL-071 | XL |
| BL-088 | 027 | API pública com OpenAPI, chaves e idempotência | API-001 | **P2** | F11 | BL-036 | L |
| BL-089 | 027 | Webhooks assinados com retentativa e dead letter | API-002 | **P2** | F11 | BL-088 | M |
| BL-090 | 021 | Dashboards personalizáveis e relatórios agendados | ANL-004 | **P2** | F11 | BL-066 | L |
| BL-091 | 026 | Assistente de migração de estados legados | MIG-001 | **P1** | F9 | BL-035 | M |
| BL-092 | 005 | Medidores e leituras | AST-009 | **P3** | F11+ | BL-022 | M |
| BL-093 | 013 | Gatilho de plano por medidor | PLN-006 | **P3** | F11+ | BL-092 | L |
| BL-094 | 021 | Plano de substituição do parque | ANL-006 | **P3** | F11+ | BL-065 | L |
| BL-095 | — | IA: resumo de OS, sugestão de diagnóstico, higiene de taxonomia | IA-001..003 | **P3** | F11+ | BL-064 | XL |

## 44. Matriz MVP

Dois patamares distintos, deliberadamente separados — a confusão entre eles é a causa mais comum de escopo inflado:

| Patamar | Fases | Pergunta que responde | Critério de saída |
|---|---|---|---|
| **CORE OPERACIONAL** | F0–F6 | *A equipe consegue operar um contrato real só com isto?* | Um técnico executa uma OS de ponta a ponta, offline, com checklist e assinatura; um plano preventivo gera e mede o próprio ciclo |
| **MVP COMERCIAL** | F0–F8 | *Dá para vender e cobrar por isto?* | Core Operacional + indicadores que o gestor defende em reunião + portal que o cliente enxerga + notificações |
| **EXPANSÃO** | F9+ | *Dá para crescer o ticket?* | Comercial, metrologia, automação, integrações |

Regra: nada entra no Core Operacional por ser "importante". Entra por ser **indispensável para o trabalho acontecer**. Nada entra no MVP Comercial por ser bonito. Entra por ser **indispensável para o cliente perceber valor e pagar**.

| Classe | Features |
| --- | --- |
| **CORE OPERACIONAL**<br>F0–F6 | Multitenancy com isolamento testado · papéis de fábrica e escopo · clientes e árvore de locais · ativos com categoria, fabricante e modelo · importação · QR Code · solicitações com triagem · OS com máquina de estados e motivos de espera · atribuição e agenda simples · checklists versionados · horas · fotos · assinatura · PWA offline · planos com ciclos e conformidade · SLA com calendário · auditoria com diff · eventos de domínio |
| **MVP COMERCIAL**<br>F7–F8 | Painéis por papel com definição de métrica e drill-down · busca global · portal do cliente completo · notificações multicanal com preferências · disponibilidade e tempo de parada · CSAT · custo de manutenção · Kanban · PDF da OS |
| **FASE 2**<br>F9–F10 | Estoque com lotes e reservas · orçamentos versionados com aprovação no portal · contratos com SLA e medição · motor de documentos · certificados de calibração e padrões · teste de segurança elétrica · reincidência · taxa de utilização · CMMS ratio |
| **FASE 3**<br>F11 | Automações sem código · API pública e webhooks · dashboards personalizáveis · relatórios agendados · inventário cíclico · laudo de obsolescência · qualificação térmica · agenda com rota · SSO |
| **FUTURO** | Medidores e manutenção por condição · IA (resumo, diagnóstico, higiene de taxonomia, busca em linguagem natural) · plano de substituição do parque · integração com analisadores · conectores de ERP · marketplace de procedimentos · multi-idioma · verticais adjacentes |

> **DÍVIDAS QUE O MVP NÃO PODE CONTRAIR**
>
> Estas decisões precisam estar corretas no primeiro *commit*, porque corrigi-las depois exige migração de dados com risco: **(1)** `organization_id` em toda tabela; **(2)** separação cliente / local / fornecedor; **(3)** categoria de situação e motivo de espera como dimensões distintas; **(4)** `service_request` separado de `work_order`; **(5)** `system_key` nas naturezas de OS; **(6)** snapshots de ativo e local na OS; **(7)** eventos de domínio persistidos desde o dia 1 — sem eles, o analytics histórico não existe; **(8)** `plan_task` com frequência própria; **(9)** documento genérico com tipo; **(10)** `custom` jsonb com definições tipadas.

## 45. Decision log (ADR)

| ADR | Decisão | Alternativas consideradas | Escolha | Justificativa |
| --- | --- | --- | --- | --- |
| ADR-001 | Modelo de tenancy | (a) instância por cliente; (b) schema por tenant; (c) linha por tenant com RLS | **(c)** + isolamento físico como plano futuro | Centenas de organizações com migração única, suporte viável e custo previsível. Isolamento reforçado por 10 camadas (§37) |
| ADR-002 | Chamado × OS | (a) mesma entidade com visão; (b) `service_request` separado | **(b)** | Recusa, duplicidade, 1→N, SLA de resposta separado, superfície de escrita mínima no portal e denominadores limpos. O custo (dupla escrituração) é anulado pela conversão de um clique e pela conversão automática opcional |
| ADR-003 | Situação × motivo de espera | (a) estados livres como na referência; (b) estados fixos; (c) categoria fixa + situação configurável + motivo separado | **(c)** | Colapsa 42 rótulos em 9 situações e 14 motivos; habilita pausa de SLA por motivo e a métrica "tempo por motivo"; mantém flexibilidade sem perder analytics |
| ADR-004 | Cliente sempre presente | (a) local direto na organização no modo interno; (b) sempre um `customer`, com `is_internal` | **(b)** | Um único caminho de código em escopo, consulta, RLS e relatório. O custo é um registro no onboarding e uma interface que esconde a camada |
| ADR-005 | Hierarquia de locais | (a) níveis fixos; (b) árvore livre; (c) árvore com tipos configuráveis e regras de aninhamento | **(c)** com caminho materializado (ADR-026) | Serve saúde hoje e outros mercados depois, sem árvore anárquica |
| ADR-006 | Asset × Equipment | (a) duas entidades; (b) `asset` universal com rótulo configurável | **(b)** | "Equipamento" é vocabulário de vertical, não conceito de domínio |
| ADR-007 | RBAC | (a) papéis fixos; (b) só granular; (c) papéis de fábrica + granular + escopo separado | **(c)** | A referência prova que só granular leva a "Técnico com 101 permissões". Papéis prontos definem o caminho feliz; granular resolve a exceção |
| ADR-008 | Analytics | (a) BI externo; (b) consulta direta no transacional; (c) tabelas de fato nativas | **(c)** | BI externo sai do RBAC e da identidade do produto; consulta direta produz as telas de 30 s observadas na referência |
| ADR-009 | Campos personalizados | (a) EAV; (b) jsonb livre; (c) jsonb + definições tipadas; (d) colunas por tenant | **(c)** | Validação, busca, relatório e indexação sem explosão de junções nem de esquema |
| ADR-010 | Arquitetura de aplicação | (a) BaaS com lógica em RLS e funções de borda; (b) microsserviços; (c) monólito modular com BaaS para identidade e arquivos | **(c)** | As regras deste domínio não cabem em políticas de banco; microsserviços são prematuros. Fronteiras modulares preservam a opção de extrair |
| ADR-011 | Agendamento | (a) entidade de evento própria; (b) campos na OS com a agenda como projeção | **(b)** | Evita duas fontes de verdade. Ausências continuam sendo entidade própria |
| ADR-012 | Checklist | (a) JSON como na referência; (b) tabelas relacionais versionadas | **(b)** | Resposta de checklist é evidência regulatória; precisa de versão congelada, consulta e agregação |
| ADR-013 | Documentos | (a) um módulo por tipo; (b) motor único com tipos e payload validado | **(b)** | Seis módulos com 90 % de estrutura comum na referência; o motor único elimina cinco implementações |
| ADR-014 | Eventos | (a) só auditoria CRUD; (b) só eventos; (c) ambos | **(c)** | Diff não sabe o que é um fato de negócio; evento não captura toda edição. Auditoria, automação e analytics precisam de coisas diferentes |
| ADR-015 | Identidade do portal | (a) tabela `solicitantes` separada como na referência; (b) usuário + *membership* `portal` | **(b)** | Um modelo de identidade, um fluxo de autenticação, uma trilha de auditoria. Assento pago continua diferenciado por `seat_type` |
| ADR-016 | Estilo de API | (a) REST; (b) GraphQL; (c) RPC tipado | **(a)** com OpenAPI gerado | O consumo previsto é integração de sistema, previsível e cacheável, não montagem dinâmica de tela |
| ADR-017 | Fila de jobs | (a) Redis/SQS; (b) fila no Postgres | **(b)** no início | Enfileiramento na mesma transação do dado elimina toda uma classe de inconsistência; sem infra adicional |
| ADR-018 | Mobile | (a) app nativo; (b) PWA | **(b)** | Uma base de código, distribuição sem loja, atualização imediata. Reavaliar se push confiável ou NFC virarem requisito |
| ADR-019 | Exclusão | (a) exclusão física; (b) soft delete + arquivamento | **(b)** | Histórico regulado de 10 anos; a referência já usa "ocultar" e acerta |
| ADR-028 | Catálogos planos | (a) uma tabela por catálogo (`work_order_types`, `failure_codes`, `rejection_reasons`…); (b) uma tabela `catalog_items` com discriminador `catalog_key`; (c) EAV genérico | **(b)** | Os catálogos planos têm exatamente a mesma forma — chave técnica, rótulo, posição, cor, arquivado, mesclado — e nenhum deles tem campo próprio. Uma tabela por catálogo multiplicaria por seis o mesmo esquema, a mesma RLS, o mesmo gatilho de auditoria e a mesma função de mesclagem, e cada catálogo novo exigiria migration. **Isto não é a `Empresa` polimórfica da referência:** lá, conceitos com atributos e relacionamentos DIFERENTES foram forçados numa tabela, e por isso nenhum podia ter campo próprio. A regra aqui é o inverso e é explícita: mesma forma, mesma tabela; forma diferente, tabela diferente. Quem tem campo próprio continua separado — `customers`, `locations`, `suppliers`, e no EPIC-005 `manufacturers`, `asset_models`, `criticality_levels`. **Consequência:** onde a v0.1 nomeia `work_order_types`, `failure_codes` e `rejection_reasons`, leia-se `catalog_items` com o `catalog_key` correspondente. `wait_reasons` **permanece tabela própria**, por ter `pauses_sla` e responsável — campos que os demais não têm |
| ADR-026 | Representação da árvore de locais | (a) `ltree`; (b) caminho materializado em `text`; (c) tabela de fechamento | **(b)** | `ltree` é extensão, e extensão nem sempre está disponível: não existe no PGlite (ADR-022) e vários PostgreSQL gerenciados restringem quais podem ser criadas. Um caminho materializado `/uuid/uuid/` com índice `text_pattern_ops` responde consulta de subárvore por prefixo usando índice, funciona em qualquer PostgreSQL sem extensão e tem a mesma complexidade de leitura. O custo é reescrever prefixos ao mover subárvore — operação rara, já transacional, e que o modelo previa. Tabela de fechamento foi recusada por multiplicar linhas sem ganho na profundidade máxima de 8. **Consequência:** onde a v0.1 diz `ltree`, leia-se caminho materializado em `text` |
| ADR-027 | Busca textual | (a) `pg_trgm` + `tsvector`; (b) só `tsvector` nativo; (c) motor dedicado | **(b)** no núcleo, **(a)** como otimização opcional | Mesma razão do ADR-026: `pg_trgm` é extensão e não é garantida; `tsvector`/`to_tsquery` são nativos. A tolerância a erro de digitação em série e patrimônio (§27) passa a ser obtida por normalização na indexação — o índice guarda a forma sem pontuação, sem acento e em caixa baixa — e o trigrama entra como aceleração onde o ambiente permitir. A degradação é de qualidade de resultado, não de funcionalidade |
| ADR-021 | Gerenciador de pacotes | (a) pnpm; (b) yarn; (c) npm workspaces | **(c)** | `pnpm` e `corepack` não estão disponíveis no ambiente de desenvolvimento atual e instalar um gerenciador global adiciona uma dependência de máquina que o CI teria de replicar. `npm workspaces` é nativo do Node 25, suficiente para este monorepo e mantém um único `package-lock.json` versionado. Reversível: migrar para pnpm depois é troca de lockfile, não de arquitetura |
| ADR-022 | Banco para testes automatizados | (a) Postgres em Docker; (b) Postgres remoto; (c) PGlite (Postgres em WASM, em processo) | **(c)** como padrão, **(a)** opcional via `AURORA_TEST_PG_URL` | O daemon do Docker não está disponível no ambiente atual e o banco remoto está bloqueado (ADR-025). PGlite é PostgreSQL real, roda em processo, suporta RLS, papéis e `set_config`, e torna o teste de vazamento de contexto **mais** adversarial: como há uma única conexão persistente, qualquer contexto que vazasse apareceria imediatamente. O teste de pool com várias conexões físicas roda quando um Postgres real é apontado por variável de ambiente |
| ADR-023 | Isolamento no banco | (a) só filtro na aplicação; (b) RLS com owner; (c) RLS + `FORCE` + papel não-owner sem `BYPASSRLS` | **(c)** | O owner ignora RLS por padrão; sem `FORCE` e sem separação de papéis, a política é decorativa. Detalhes em §37 |
| ADR-024 | Geração de identificador | (a) `gen_random_uuid()` no banco; (b) `uuidv7()` nativo; (c) fábrica única na aplicação | **(c)** | v4 não ordena e fragmenta índice; `uuidv7()` nativo só existe no PostgreSQL 18 e o alvo é 16+. Fábrica única, testada, exportada por `packages/domain` |
| ADR-025 | Uso do Supabase remoto nesta fase | (a) aplicar migrations no projeto remoto; (b) desenvolver localmente | **(b)** — remoto **bloqueado** | Não foi possível **confirmar tecnicamente** qual projeto Supabase pertence ao Aurora: a conta autenticada lista 28 projetos em ~15 organizações, nenhum identificável como Aurora. A instrução vigente é explícita: havendo qualquer possibilidade de apontar para outro projeto, não executar operação remota. Toda a base é desenvolvida como migrations locais, reprodutíveis, e será aplicada ao projeto correto quando ele for identificado por *ref* |
| ADR-020 | Taxonomia de falha | (a) tipo de serviço acumulando tudo; (b) natureza × sintoma × causa × ação | **(b)** | A referência acabou com "Rodas travadas" como tipo de serviço. Separar habilita análise de causa raiz |

## 46. Open questions

Cada questão é classificada segundo o efeito real sobre a implementação, e não segundo o quanto ainda não sabemos:

| Classe | Significado | Conduta |
|---|---|---|
| **A** | Já resolvida na própria SPEC | Seguir o que está escrito |
| **B** | Reversível | Adotar o *default conservador* registrado abaixo, documentar e seguir |
| **C** | Externa, mas não bloqueia o trabalho atual | Registrar e continuar por outro item |
| **D** | Irreversível **e** bloqueia a implementação corrente | Marcar BLOCKED, não inventar, seguir para trabalho independente |

> **DECISÃO v0.2**
>
> Nenhuma open question é classe **D**. As cinco que a v0.1 marcava como "Bloqueia MVP: Sim" foram reclassificadas com defaults conservadores explícitos, porque nenhuma delas impede escrever código correto — todas afetam configuração, conteúdo ou branding, camadas que já são isoladas por projeto.

| # | Pergunta | Impacto | Quem responde | Classe e conduta |
| --- | --- | --- | --- | --- |
| OQ-01 | Vamos migrar dados do TechneCare/Arkmeds ou começar do zero? | Define se precisamos do assistente de migração de estados legados e da conciliação de indicadores históricos | Você / diretoria | **B** — *default: começar do zero.* O importador genérico de planilha (EPIC-026) atende os dois casos; o assistente de migração de estados fica em F9 e não é dependência de nada em F0–F8 |
| OQ-02 | Se houver migração, os números precisam bater com os do sistema antigo? | Se sim, precisamos das fórmulas exatas de Disponibilidade, MTTR, MTBF e TMAC — que a auditoria não conseguiu obter | Fornecedor Arkmeds | **C** — externa e não bloqueia. O catálogo de métricas é construído com definições próprias e visíveis (§25). Conciliar com o sistema antigo é tarefa de migração, não de plataforma |
| OQ-03 | O primeiro cliente é prestadora multicliente ou departamento interno? | Define qual modo é polido primeiro | Você | **B** — *default: construir para prestadora multicliente.* É o superset: exercita `customer`, escopo, portal e contrato. O modo interno é o mesmo código com `customer.is_internal = true` e *single-customer mode* na interface (ADR-004), logo construir o superset nunca é retrabalho |
| OQ-04 | Metrologia é obrigatória para o primeiro contrato? | Certificados de calibração são o item mais caro da especificação (XL). Se o piloto não calibra, F10 pode esperar | Cliente piloto | **B** — *default: metrologia permanece em F10.* O motor de documentos é genérico (§18), então antecipar é adicionar um `document_type`, não remodelar |
| OQ-05 | Qual o volume real do piloto (ativos, OS/mês, técnicos, clientes)? | Define metas de desempenho, particionamento e se réplica de leitura entra no MVP | Cliente piloto | **B** — *default: dimensionar para o volume observado na auditoria* (27 mil ativos e 74 mil OS por organização) e validar com seeds de escala crescente. Réplica de leitura fica fora do Core Operacional |
| OQ-06 | Quais estados o cliente piloto realmente usa hoje? | Valida o mapeamento 42 → 9 situações + 14 motivos | Coordenador do piloto | **C** — não bloqueia. Situações e motivos são **catálogo por organização** (§10); as 9 categorias são fixas e cobrem os 42 estados auditados um a um. Validar antes de F3 **entrar em produção**, não antes de implementar |
| OQ-07 | Falta de peça deve pausar o SLA? | Nossa decisão padrão é **não** (é responsabilidade nossa). Contratos podem exigir o contrário | Comercial / jurídico | **A** — já resolvida na SPEC: o padrão de fábrica é **não pausar**, e `wait_reason.pauses_sla` é configurável por organização (§10) |
| OQ-08 | Assinatura eletrônica simples é suficiente ou precisamos de ICP-Brasil? | Muda o custo e o fluxo de assinatura de laudos com valor legal (ART/CREA) | Responsável técnico / jurídico | **B** — *default: assinatura eletrônica simples com hash de conteúdo e trilha.* O campo `method` já prevê `icp_brasil` (§18); adicionar o provedor é aditivo, não migratório. **Não afirmamos validade jurídica** — isso depende de parecer externo |
| OQ-09 | Haverá integração com ERP hospitalar no primeiro ano? | Se sim, a API pública sobe de P2 para P1 e o modelo precisa de `external_id` em ativos, clientes e OS desde F2 | Você / cliente | **B** — *default: não integrar agora, mas reservar o campo.* `external_id` (nullable, único por organização + sistema de origem) entra em `customers`, `assets`, `work_orders` e `inventory_items` desde F2: custo desprezível agora, migração cara depois |
| OQ-10 | Modelo de cobrança: por assento, por ativo ou por contrato? | Define o que instrumentar em telemetria e se `seat_limit` é a métrica certa | Você | **C** — externa e não bloqueia. Instrumentar telemetria de assentos, ativos e OS desde F0 mantém qualquer modelo de cobrança viável |
| OQ-11 | WhatsApp é requisito comercial ou conveniência? | É o canal real de comunicação nesses hospitais. Se for requisito, sobe para F8 | Você / cliente piloto | **B** — *default: fora do Core Operacional.* O canal fica atrás da abstração de notificação (§23); adicionar WhatsApp é implementar um adaptador, não mudar o roteador |
| OQ-12 | Precisamos de PMOC (manutenção predial de climatização)? | A referência tem a preferência "Habilitar PMOC". É um módulo regulado próprio | Cliente piloto | **C** — módulo regulado próprio, fora do escopo atual. Não impacta o modelo de dados |
| OQ-13 | Qual o nome definitivo do produto e o domínio? | Afeta identidade visual, e-mails transacionais, PWA e URLs | Você | **B** — *default: `Aurora` é o nome de trabalho oficial.* Namespace técnico `aurora` (pacotes, prefixo de variáveis de sessão, chaves de config). Marca, domínio e textos visíveis ficam concentrados em `packages/config` para que a troca seja uma alteração de configuração, não uma refatoração |
| OQ-14 | Haverá integração com analisadores (nossos ou de terceiros)? | É o fosso competitivo da Arkmeds. Se quisermos competir nisso, o tipo de item `auto_test` e o protocolo de importação precisam de espaço no roadmap | Você | **C** — não bloqueia. `checklist_item.kind = auto_test` já está previsto (§14) e a importação por arquivo ou API é aditiva |
| OQ-15 | Onde hospedar (região, provedor) e há exigência de dado em território nacional? | Afeta latência, custo e conformidade contratual com hospitais públicos | Você / jurídico | **B** — *default: região brasileira (`sa-east-1`) e dado em território nacional.* Nenhuma linha de código pode depender de região ou provedor: banco por `DATABASE_URL`, arquivos por adaptador S3-compatível, identidade por `AuthProvider`. A escolha é de infraestrutura, não de arquitetura |

| OQ-16 | Qual é o **project ref** do projeto Supabase do Aurora? | Nenhuma operação remota pode ser executada sem essa confirmação. Não afeta o código: migrations, seeds e testes rodam localmente | Você | **C** — não bloqueia o desenvolvimento; **bloqueia apenas a aplicação remota**. Ver ADR-025 |

## 47. Anti-patterns do sistema de referência

O que observamos na auditoria, por que é problema, e o que faremos em lugar disso.

| Anti-pattern | Evidência | Consequência | Nossa solução |
| --- | --- | --- | --- |
| **Empresa polimórfica** | `empresa.tipo` ∈ Principal, Cliente Externo, Cliente Interno, Fornecedor, Local, Setor, com FK `superior` | Impossível dar campos próprios a cada conceito; consulta recursiva em toda parte; fornecedor e setor na mesma tabela | Separar `customers`, `locations` (árvore com tipos) e `suppliers` — ADR-005 |
| **Estados livres** | 42 estados; cadastro com um único campo (Descrição) | Sem categoria, cor, terminalidade nem transição; semântica "ativa/inativa" hardcoded; Kanban ilegível | Categoria fixa + situação configurável + grafo de transições — ADR-003 |
| **Motivo codificado no estado** | "Aguardando peças", "Aguardando aprovação do orçamento", "Aguardando liberação da unidade"… | Explosão combinatória; impossível pausar SLA por motivo; nenhuma métrica de causa de bloqueio | `wait_reason` como dimensão separada, com `pauses_sla` e responsável |
| **Inconsistência de capitalização** | "fechada" (312 OS) convivendo com "Fechada"; "Emprestimo" e "Empréstimo de equipamento"; "Reposição de Oxigênio" duplicado | Indicadores fragmentados; contagem errada de OS encerradas | Chave técnica estável separada do rótulo; unicidade normalizada (sem acento, case-insensitive); mesclagem assistida de duplicatas |
| **BI externo** | Menu "BI" apontando para o Looker Studio | Dado fora do RBAC, interface estranha, mudança de indicador vira consultoria | Analytics nativo com tabelas de fato e catálogo de métricas — ADR-008 |
| **RBAC sem papéis prontos** | 138 permissões, grupos vazios, "Técnico" com 101 delas, grupo chamado "." | Configuração impossível de auditar; privilégio excessivo por padrão | Dez papéis de fábrica testados; granular como exceção; alerta de papel excessivamente permissivo — ADR-007 |
| **Taxonomia sem governança** | 651 tipos de equipamento, 360 problemas, 344 origens, 37 tipos de serviço com sintomas dentro | Combos inoperáveis, relatórios fragmentados, dado não comparável | Catálogos normalizados (categoria/fabricante/modelo), taxonomia de falha em três eixos, listas contextuais e curadoria — ADR-020 |
| **Checklist como JSON solto** | `[{tipo, desc, appr[]}]` em uma coluna | Sem versão, sem consulta, sem agregação, sem faixa numérica com veredito | Tabelas relacionais versionadas com resposta congelada — ADR-012 |
| **Seis módulos documentais paralelos** | Calibração, rascunho, padrão, TSE, obsolescência, térmica | Cinco implementações da mesma numeração, validade, assinatura e PDF | Motor único com `document_type` e payload validado — ADR-013 |
| **Duas classes de identidade** | `usuarios` e `solicitantes` em tabelas distintas | Dois fluxos de autenticação, duas trilhas, duas telas de gestão | Um `user`, *membership* com `seat_type` — ADR-015 |
| **Automação anêmica** | 2 modelos, 2 gatilhos, ação de e-mail | Nada de SLA, escalonamento, data, ação interna ou condição composta | Motor gatilho → condição → ação sobre o barramento de eventos, com simulação e log |
| **Consulta transacional em painel** | Telas que excederam 30 s de renderização durante a auditoria; paginação de 2.954 páginas por *offset* | Produto inutilizável no volume real do próprio cliente | Tabelas de fato, cursor, virtualização e metas de p95 no CI |
| **Limite comunicado sem saída** | "Número máximo de relatórios (5) atingido"; "36 de 38" | Bloqueio sem caminho de resolução | Limite sempre acompanhado da ação ("gerenciar assentos", "arquivar relatório") |
| **Vazamento de vocabulário interno** | Rota de calibração `/calibracao/balanca/`; "Oficina" × "Quadro de trabalho"; "Model" e "Tópico" na tela de automação | O usuário aprende dois idiomas | Glossário único e obrigatório (§03), aplicado a tela, PDF e e-mail |
| **Erro que não ensina** | Modal de checklist exibindo apenas "Erro!"; *lorem ipsum* em produção | Erosão de confiança; chamado de suporte evitável | Mensagem com causa, campo e próximo passo; proibição de placeholder em produção no checklist de release |
| **Ausência de busca global** | Só busca dentro de cada lista | O usuário precisa saber onde procurar antes de procurar | Paleta ⌘K sobre todos os domínios, respeitando escopo |
| **Mudança de dono corrompendo histórico** | Aviso: "as OS não poderão ser editadas caso altere o proprietário do equipamento" | O histórico depende do estado atual do cadastro | Snapshots de ativo e local congelados na OS + transferência como operação registrada |

## 48. Diferenciais competitivos

| Capacidade | Classificação | Racional |
| --- | --- | --- |
| Inventário com QR Code e ficha 360° | **Paridade** | A referência já faz bem; não fazer é eliminatório |
| Planos com ciclos e conformidade | **Paridade** | Idem — é o que sustenta o contrato |
| Certificados de calibração com incerteza | **Paridade** | Barreira de entrada na vertical clínica |
| Trilha de auditoria com diff campo a campo | **Paridade** | Requisito regulatório |
| **Máquina de estados com transições e guardas** | **Melhoria** | Ninguém no mercado brasileiro entrega transições declaradas e requisitos de conclusão por natureza |
| **Motivo de espera separado da situação** | **Melhoria** | Colapsa 42 rótulos em 9+14 e cria a métrica "onde o backlog trava" |
| **Solicitação separada da OS** | **Melhoria** | Denominadores limpos, duplicidade tratada, portal com superfície mínima |
| **Analytics nativo com definição visível** | **Melhoria** | Indicador que se explica é indicador que o gestor defende na reunião |
| **Papéis prontos + escopo hierárquico** | **Melhoria** | Configuração em minutos, não em dias de consultoria |
| **Busca global ⌘K** | **Melhoria** | Muda a percepção de velocidade do produto inteiro |
| **Interface moderna, um só idioma visual, tema escuro** | **Melhoria** | É o primeiro argumento de venda em demonstração |
| **PWA offline-first com conflito visível** | **Diferencial** | O concorrente tem app offline; ter *zero perda silenciosa* com resolução explícita é outro patamar |
| **Thread colaborativa na OS** | **Diferencial** | Substitui o WhatsApp e traz de volta para o sistema a conversa que hoje se perde |
| **Portal do cliente desenhado, com vocabulário traduzido** | **Diferencial** | É o que o hospital vê; hoje é o mais negligenciado do mercado |
| **Automação por evento com simulação prévia** | **Diferencial** | "Esta regra teria disparado 412 vezes" evita o abandono do canal |
| **Checklist com veredito automático e OS derivada** | **Diferencial** | Transforma ronda em geradora de demanda qualificada |
| **SLA com calendário, feriado e fuso do local** | **Diferencial** | Torna a meta justa e defensável; hoje ninguém entrega isso no segmento |
| **API-first com webhooks assinados** | **Diferencial** | Integração com ERP hospitalar é decisão de compra em rede grande |
| **IA sobre o histórico do ativo** | **Moat futuro** | 73 mil descrições de serviço e a taxonomia de falha em três eixos são a matéria-prima; quanto mais tempo o cliente usa, melhor fica — e mais caro fica sair |
| **Plano de substituição do parque** | **Moat futuro** | Move a conversa de "manutenção" para "investimento", elevando o interlocutor e o ticket |
| **Marketplace de procedimentos e checklists** | **Moat futuro** | Efeito de rede: cada organização que publica um procedimento torna o produto mais valioso para as demais |
| **Manutenção por condição com IoT** | **Moat futuro** | Depende de sensores no parque; alto valor, horizonte longo |

> **ONDE NÃO VAMOS COMPETIR**
>
> **Hardware.** O fosso competitivo real da Arkmeds não é o software — são os analisadores proprietários (Tesla, Otto, Waller) que preenchem checklists automaticamente. Construir hardware é outro negócio. Nossa resposta é **abertura**: importar resultados de analisadores de qualquer fabricante por arquivo e por API, transformando o fosso deles em uma limitação de portfólio.

---

Especificação funcional e arquitetural · rascunho v0.1 para aprovação · derivada da auditoria TechneCare/Arkmeds v2.69.0 · nenhum código, projeto, banco ou migração foi criado.
