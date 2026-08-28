<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 5 de 13 — seções 11 a 14
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

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

---

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

---

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
| Férias e ausências | **Bloqueio**. Agendar sobre um `availability_block` de tipo `absence` é recusado |
| Fora do calendário do local | Aviso com o motivo ("UTI só libera equipamento entre 14 h e 16 h") |
| Deslocamento | **Fase 3** Sugestão de agrupamento por local: "mais 6 preventivas pendentes neste mesmo setor — agendar juntas?" |

### Reagendamento e notificação

Toda mudança de `scheduled_start` emite `work_order.rescheduled` com valores anterior e novo, notifica o executor e — se o cliente tem visibilidade de agenda e a mudança é maior que *N* horas — notifica também o solicitante. Reagendamentos são contados por OS: mais de três é sinal operacional exibido ao coordenador.

---

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
| `signature` | Assinatura dentro do checklist | — | MVP+ |
| `measurement` | Medição com padrão, unidade e incerteza | vincula `standard_id` | Fase 2 |
| `auto_test` | Resultado importado de analisador | somente leitura para o técnico | Fase 4 |

### Regras

- **Versionamento imutável.** Publicar cria uma versão nova; respostas antigas continuam apontando para a versão que foi usada. Editar um template publicado é impossível — só criar a próxima versão.
- **Lógica condicional**: um item pode depender da resposta de outro. Itens ocultos não são obrigatórios e não entram no cálculo de completude.
- **Veredito automático**: para `number`, valor fora de `[min, max]` marca `fail` e, conforme `fail_action`, exige foto, bloqueia a conclusão ou gera uma OS corretiva derivada — mecanismo que transforma a ronda em geradora de demanda, algo que a referência não faz.
- **Resolução automática**: ao abrir uma OS, o sistema busca os procedimentos aplicáveis por (natureza × categoria do ativo × ativo específico × local) e anexa seus checklists. Comportamento herdado e confirmado na documentação pública da referência.
- **Offline**: o template inteiro, com opções e faixas, é sincronizado para o dispositivo; respostas e fotos ficam na fila de saída.
- **Impressão**: configurável — imprimir vazio, template alternativo para preenchimento à mão, ocultar coluna de avaliação, renomear a coluna de valor. Todas herdadas da referência.
