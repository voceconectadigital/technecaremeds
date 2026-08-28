<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 8 de 13 — seções 25 a 31
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 25. Analytics e indicadores

Analytics é funcionalidade de primeira classe, nativa, dentro do RBAC. As 13 métricas confirmadas na auditoria formam a base; acrescentamos as que faltavam e marcamos explicitamente o que não pôde ser confirmado.

### Matriz de indicadores

| Indicador | Objetivo | Dados necessários | Dimensões | Origem | MVP |
| --- | --- | --- | --- | --- | --- |
| **OS abertas / concluídas** | Volume de demanda e de entrega | `work_orders.opened_at`, `closed_at`, natureza | todas | Arkmeds | ✔ |
| **Backlog** | Trabalho acumulado não concluído | OS em categorias ativas na data de corte | cliente, local, equipe, natureza, prioridade, idade | Proposta | ✔ |
| **Idade do backlog** | Envelhecimento da fila | `now − opened_at` das OS ativas | faixas (0–7, 8–30, 31–90, 90+ dias) | Proposta | ✔ |
| **MTTR** — tempo médio de reparo | Velocidade de resolução | `completed_at − opened_at` de OS corretivas concluídas | ativo, categoria, modelo, cliente, local, técnico, período | Arkmeds ("Tempo médio de serviços") | ✔ |
| **MTBF** — tempo médio entre falhas | Confiabilidade do ativo | Intervalos entre OS corretivas do mesmo ativo | ativo, categoria, modelo, fabricante | Arkmeds ("Tempo médio entre serviços") | ✔ |
| **Disponibilidade** | % do tempo em que o ativo esteve operável | Tempo em situações que caracterizam parada, sobre o período | ativo, categoria, local, cliente | Arkmeds | MVP+ |
| **Tempo de parada** | Horas de indisponibilidade | Somatório dos intervalos de parada | idem | Derivado | MVP+ |
| **Cumprimento de SLA** | Aderência contratual | `sla_clocks.met` por alvo | cliente, contrato, prioridade, alvo, período | Arkmeds | ✔ |
| **Tempo por situação** | Onde o fluxo trava | `status_history` com duração | situação, motivo de espera, cliente, equipe | Arkmeds | ✔ |
| **Tempo por motivo de espera** | Causa raiz do travamento | idem, agrupado por `wait_reason` | motivo, responsável pela liberação | **Novo** | ✔ |
| **Preventiva × corretiva** | Maturidade da manutenção | Contagem por `work_order_type.system_key` | cliente, local, categoria, período | **Novo** | ✔ |
| **Conformidade de plano** | Aderência ao programa preventivo | `plan_cycle_items` por situação | plano, ciclo, cliente, natureza | Arkmeds | ✔ |
| **Reincidência** | Qualidade do reparo | Nova OS corretiva no mesmo ativo com mesmo sintoma dentro de N dias | ativo, modelo, técnico, sintoma | **Novo** | Fase 2 |
| **Produtividade** | Entrega por técnico | OS concluídas e horas apontadas por usuário | técnico, equipe, natureza, período | Arkmeds | ✔ |
| **Taxa de utilização** | Horas apontadas ÷ horas de jornada | `time_entries` × `user.daily_hours` × calendário | técnico, equipe, período | **Novo** | Fase 2 |
| **Horas gastas** | Capacidade consumida | `time_entries.minutes` | todas | Arkmeds | ✔ |
| **Custo de manutenção** | Gasto no período | mão de obra + peças + deslocamento + terceiros | cliente, ativo, categoria, contrato, período | Arkmeds | MVP+ |
| **Custo de substituição do parque** | Valor para repor o inventário | Σ `asset.replacement_value` | cliente, local, categoria | Arkmeds | Fase 2 |
| **CMMS ratio** | Custo de manutenção ÷ valor do parque | as duas métricas acima | cliente, período | Arkmeds | Fase 2 |
| **Custo por ativo** | Candidatos a substituição | Custo acumulado ÷ valor de reposição, com vida útil e criticidade | ativo, modelo | **Novo** | Fase 3 |
| **Satisfação (CSAT)** | Percepção do cliente | `satisfaction_score` 1–5 | cliente, local, técnico, natureza, período | Arkmeds | MVP+ |
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

---

## 26. Dashboard

Nativo, dentro do RBAC, sem dependência de ferramenta externa. Substitui o link para o Looker Studio da referência.

| Recurso | Comportamento | Fase |
| --- | --- | --- |
| **Dashboards por papel** | Cada papel abre em um painel de fábrica pensado para ele: Gestor (conformidade, SLA, custo), Coordenador (fila, agenda, atrasos), Técnico (meu dia), Financeiro (orçamentos, medição), Cliente (seu escopo) | MVP |
| **Filtros globais** | Período, cliente, local (subárvore), equipe, natureza — aplicados a todos os widgets do painel e refletidos na URL | MVP |
| **Comparação** | Período anterior e mesmo período do ano anterior, com delta e direção | MVP+ |
| **Drill-down** | Clicar em qualquer número abre a lista filtrada que o originou. **Requisito obrigatório** — um indicador que não se explica não é confiável | MVP |
| **Widgets** | KPI com tendência, série temporal, barras por dimensão, distribuição, tabela, funil, medidor de meta | MVP |
| **Personalização** | Adicionar, remover, redimensionar e reordenar widgets; salvar como painel pessoal ou compartilhado | Fase 3 |
| **Visões salvas como fonte** | Qualquer `saved_view` de lista pode virar widget de contagem ou tabela | Fase 3 |
| **Metas** | Alvo por indicador, por cliente e por período, com semáforo | Fase 3 |
| **Exportação e agendamento** | PDF e planilha do painel; envio periódico por e-mail — sem o limite de 5 relatórios da referência | Fase 3 |
| **Permissão** | Widget financeiro só renderiza com `insight.read_financial_metrics`; sem a permissão, o widget não aparece (não aparece vazio) | MVP |

---

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

---

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

---

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

---

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

---

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
| **Commerce** | `quote.created` · `quote.sent` · `quote.viewed` · `quote.approved` · `quote.rejected` · `quote.expired` · `quote.revised` · `quote.invoiced` · `contract.activated` · `contract.expiring` · `contract.period_closed` |
| **Documents** | `document.issued` · `document.signed` · `document.released` · `document.expiring` · `document.expired` · `document.cancelled` · `document.superseded` · `document.printed` |
| **Platform** | `member.invited` · `member.joined` · `member.role_changed` · `member.scope_changed` · `member.removed` · `support_access.granted` · `support_access.expired` · `api_key.created` · `api_key.revoked` · `automation.rule_fired` · `export.completed` |

#### Regras do barramento

- Evento é **persistido na mesma transação** do dado (padrão *outbox*) e publicado depois. Nunca "quase sempre chega".
- Evento é **imutável** e representa fato consumado; nunca intenção.
- **Payload versionado** (`schema_version`). Campos podem ser adicionados; nunca removidos ou ressignificados.
- Consumidores são **idempotentes** por `event_id`.
- O catálogo é parte do contrato público: adicionar evento é *minor*, remover é *breaking*.
