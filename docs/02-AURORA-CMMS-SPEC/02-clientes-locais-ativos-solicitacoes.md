<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 3 de 13 — seções 06 a 08
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

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
| `path` | ltree | **Materializado**. Recalculado em cascata ao mover subárvore |
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

---

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

---

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
