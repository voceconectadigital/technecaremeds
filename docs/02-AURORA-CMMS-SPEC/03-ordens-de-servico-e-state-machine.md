<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 4 de 13 — seções 09 a 10
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

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

---

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
