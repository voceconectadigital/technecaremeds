<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 7 de 13 — seções 21 a 24
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

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

---

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

---

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

---

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
