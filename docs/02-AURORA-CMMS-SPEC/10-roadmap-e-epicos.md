<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 11 de 13 — seções 38 a 39
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 38. Roadmap

Onze fases curtas. Critério de corte de cada fase: **existe algo demonstrável e utilizável ao final**. Nenhuma fase é "infraestrutura por três meses".

| Fase | Nome | Entrega demonstrável | Épicos | Duração alvo |
| --- | --- | --- | --- | --- |
| **F0** | Fundação | Repositório, CI, ambientes, esquema base, autenticação, uma organização criada, um usuário logado, trilha de auditoria funcionando | 001, 022 (parcial) | 3 semanas |
| **F1** | Acesso e diretório | Convidar equipe, papéis de fábrica, escopo por local; cadastrar cliente e árvore de locais; trocar de organização | 002, 003, 004 | 4 semanas |
| **F2** | Ativos | Inventário completo com categorias, modelos, criticidade; importação por planilha; ficha 360°; QR Code impresso e resolvível | 005, 006, 026 (ativos) | 4 semanas |
| **F3** | Trabalho | Abrir solicitação, triar, gerar OS, atribuir, executar, concluir, fechar — com máquina de estados e motivos de espera | 007, 008, 009 | 6 semanas |
| **F4** | Execução em campo | Checklists, horas, fotos, assinatura; PWA offline com sincronização | 011, 014 | 6 semanas |
| **F5** | Compromisso | SLA com calendário e feriados; agenda com arrastar-e-soltar e capacidade | 010, 012 | 4 semanas |
| **F6** | Preventiva | Planos com tarefas, ciclos, geração automática de OS e conformidade | 013 | 4 semanas |
| **F7** | Leitura | Painéis por papel, indicadores do MVP com drill-down e definição visível; busca global | 021, 025 | 4 semanas |
| **F8** | Cliente | Portal completo: solicitações, equipamentos, documentos, agenda, indicadores; notificações | 020, 023 | 4 semanas |
| **▲ Fim do MVP operável — a partir daqui, expansão comercial** |   |   |   |   |
| **F9** | Comercial | Estoque com lotes e reservas; orçamentos com aprovação no portal; contratos e medição | 015, 016, 017 | 7 semanas |
| **F10** | Prova | Motor de documentos; certificados de calibração com padrões e incertezas; teste de segurança elétrica | 018, 019 | 7 semanas |
| **F11** | Escala | Automações; API pública e webhooks; dashboards personalizáveis; relatórios agendados | 024, 027, 021 (avançado) | 6 semanas |

> **REGRA DE DÍVIDA**
>
> O **modelo de dados das fases futuras entra desde F0** naquilo que é estrutural: `organization_id`, categorias de situação, motivo de espera, `plan_task`, `document` genérico, `domain_events`, `custom` jsonb, `meters`. Adicionar tabela depois é barato; mudar a semântica de uma coluna com dois anos de dados não é.

---

## 39. Épicos

#### EPIC-001 · **F0** — Fundação multitenant

**Objetivo**

Estabelecer a espinha dorsal: uma organização isolada, com usuários, sessão, contexto de requisição e trilha de auditoria — de modo que nenhuma funcionalidade posterior precise pensar em isolamento.

**Escopo**

- Esquema base com `organization_id` e convenções da §32
- Contexto de requisição propagado (organização, membership, permissões, escopo, request_id)
- Construtor de consultas com injeção automática de tenant e `unsafeCrossTenant()` barrado por lint
- RLS em todas as tabelas de negócio
- *Trigger* de auditoria genérico com diff
- Outbox de eventos de domínio
- Fila de jobs, migrações versionadas, seeds, ambientes, CI com a suíte de isolamento

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
| **004** Catálogos e campos personalizados | Taxonomias governadas, com mesclagem assistida e arquivamento; motor de campos personalizados tipados | F1 |
| **006** QR Code e etiquetas | Token opaco, geração em lote, folha de etiquetas, rota pública de resolução | F2 |
| **010** SLA | Políticas, alvos, calendários, feriados, relógios com pausa, alertas de 80 % e violação | F5 |
| **012** Agenda | Três lentes, baldes, arrastar-e-soltar, capacidade, conflitos, reagendamento notificado | F5 |
| **015** Estoque | Almoxarifados, lotes, reservas, movimentos como razão imutável, mínimo, inventário | F9 |
| **016** Orçamentos | Versionamento, aprovação no portal, motivos de recusa, faturamento com baixa | F9 |
| **017** Contratos | Escopo, SLA, franquias, medição mensal, alertas de vencimento | F9 |
| **018** Motor de documentos | Tipos, numeração, templates, versão, assinatura com hash, validade, liberação | F10 |
| **020** Portal do cliente | Aplicação própria com vocabulário traduzido e superfície de escrita mínima | F8 |
| **021** Analytics | Tabelas de fato, catálogo de métricas com definição visível, painéis por papel, drill-down | F7 |
| **022** Auditoria e eventos | Trilha com diff e IP, barramento de eventos, linha do tempo por registro | F0/F7 |
| **023** Notificações | Roteador multicanal, preferências, digest, silêncio, de-duplicação, verificação de e-mail | F8 |
| **024** Automações | Gatilho, condição, ação; simulação antes de ativar; log de execução; salvaguardas | F11 |
| **025** Busca global | Paleta de comandos, índice por escopo, tolerância a erro de digitação | F7 |
| **026** Importação e migração | Planilhas de ativos, locais, itens e usuários; assistente de mapeamento de estados legados | F2/F9 |
| **027** API e webhooks | OpenAPI, chaves com escopo, idempotência, webhooks assinados com retentativa | F11 |
