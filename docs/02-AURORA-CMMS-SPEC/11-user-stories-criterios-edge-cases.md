<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 12 de 13 — seções 40 a 42
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

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

---

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

---

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
