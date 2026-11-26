# Conclusão das pendências do Anderson — 24/11/2026

**Branch:** `feat/conclusao-anderson-2026-11-24`, sobre `main` `d772b49`.
**Sem merge, sem deploy.** A migration `0092` **não foi aplicada em banco remoto**. Nenhum dado de produção foi lido
ou alterado nesta rodada.

**Fontes:**
- respostas do Anderson no WhatsApp (24/11/2026) às decisões D-1 a D-7 do relatório de 10/11
  (`RELATORIO_CONTRATOS_SLA_ANDERSON_2026-11-10.md`);
- o vídeo de 13/11/2026 (2 min 48 s) em que ele percorre o assistente de planos e narra os problemas —
  transcrito localmente (Whisper, sem serviço pago; transcrição automática, pode ter erro de palavra).

## 1. Estado de partida (conferido, não presumido)

| Item | Situação encontrada |
|---|---|
| PR #48 (segurança e performance) | **Mesclada** em `main`; o bloco do `AI-HANDOFF.md` ainda dizia "sem merge" (corrigido no bloco novo). |
| Migration `0091` | **Aplicada** em produção em 23/11 (confirmado no banco em 25/11, §7.1). |
| PRs #49 a #56 | Mescladas; front publicado em 23–24/11 (CSP bloqueante, olho na senha). |
| PRs abertas antigas (#31, #32, #33, #43) | Não tocadas. |

## 2. O que o vídeo de 13/11 mostrou (causa concreta das reclamações)

Transcrição resumida, nas palavras dele:

1. *"Eu vou escolher todos os equipamentos … aqui eu vou pôr um checklist do ventilador pulmonar, mas dentre os
   50 equipamentos que tem no setor tem outros tipos … então todos vão receber o checklist de ventilador pulmonar.
   Ele deveria obrigar a vir equipamento por equipamento … ter um maiszinho do lado de cada equipamento … e
   adicionava o procedimento."* — **Causa:** o passo "Procedimento" tinha UM checklist para o plano inteiro
   (`checklist_template_key` único em todas as tarefas). Não era falha de gravação: era o modelo do assistente.
2. *"Educação continuada … não deveria estar apagado … ele só gera um calendário, não atribui procedimento … é
   obrigado pôr a data por equipamento."* — **Causa:** o tipo estava desabilitado ("não suportado").
3. *"Se eu não selecionar [gerar OS automaticamente] eu tenho que vir na data do plano e clicar para abrir as
   ordens de serviço."* — **Causa:** esse botão **não existia** na web (a rota de materializar existia só na API).
   Plano manual nunca virava OS pela tela.
4. *"Sinto falta … clicar e visualizar o plano, editar o plano … depois esses planos vão para onde?"* — **Causa:**
   a página do plano não tinha edição, inclusão/retirada de equipamento nem histórico, e nada explicava o caminho
   plano → ciclo → OS. Além disso, o primeiro ciclo só abria na varredura horária: logo depois de criar, o plano
   aparecia "sem ciclo aberto".

Defeitos adicionais encontrados na auditoria do fluxo:

5. **Data inicial retroativa** gerava avalanche: um plano mensal com início há um ano abriria, uma por hora, doze
   OS já vencidas.
6. **Setor sem unidade** no seletor: dois setores de mesmo nome em unidades diferentes eram indistinguíveis.

## 3. Matriz — resposta do cliente → funcionalidade → correção → teste → situação

| ID | Resposta do Anderson | Funcionalidade | O que foi feito | Teste | Situação |
|---|---|---|---|---|---|
| D-1 | "Sim, são pacotes." Em 25/11: Equipe 1 = um técnico e acompanhamento de engenheiro com visitas programadas; Equipe 2 = dois técnicos e engenheiro fixo na unidade; 3 a 10 "seguem a mesma regra". | Equipe Fixa 1…10 no contrato | Descrições confirmadas no formulário, na lista e na ficha do contrato. Das Equipes 3 a 10 a tela diz "segue a mesma regra; composição detalhada a definir". Nada deduzido do número; pacotes combinados não se somam. | `contratos-do-cliente.test.tsx` (seleção combinada) | **Concluído** (1 e 2). Detalhe de 3 a 10 e valores = pendente |
| D-2 | "Cada contrato tem uma periodicidade, onde a equipe não [define] a periodicidade." | Periodicidade × pacote | Confirmado o modelo existente: `service_frequency` é do contrato, independente dos pacotes. Valores preservados. | testes de 10/11 seguem verdes | **Concluído** (sem mudança de dado) |
| D-3 | "Contrato por hora técnica é um tipo à parte … hora de preventiva e hora de corretiva … controladas pela hora de início e hora de término da OS, campo obrigatório em toda OS." | Horas reais na OS; apuração | `work_orders.service_started_at/service_ended_at` (0092). Concluir exige as duas (transição ou relatório), término > início, nada no futuro; laudo OBC isento; desligável por `settings.require_service_hours`. OS antiga concluída fica nula ("não informada", nunca zero). Apuração só leitura `GET /contracts/:id/technical-hours` (preventiva × corretiva × outras, OS a OS). "Hora técnica" segue como `billing_model = per_hour` — tipo de contrato ≠ periodicidade ≠ precificação. **Nenhuma cobrança.** | banco: 2 testes; HTTP: 1; telas: conclusão; E2E: jornada, campo, assistente, OS-17 | **Concluído** |
| D-4 | "Quando o contrato vence ou é apertado o botão suspender atendimento ou bloquear atendimento, tudo para e fica somente consulta, ninguém abre nem fecha chamado." | Bloqueio funcional | Botões Suspender / Bloquear / Reativar (motivo obrigatório, auditado). Regra única `aurora.service_block()` aplicada **na camada de dados**: abrir/mudar solicitação, abrir OS (manual, triagem, plano, automação), toda transição de OS, execução (checklist, início de cronômetro, anexo, assinatura, check-in, relatório), agendar/desagendar, baixa de peça, atribuição por automação e "Executar" do plano (exceções em §4.2). 409 com o motivo e o contrato. Consulta, edição e renovação do contrato seguem livres (regularizar). Plano: item do ciclo nasce **dispensado** com o motivo, sem OS. Outros clientes e contratos válidos não são afetados; encerrado não bloqueia. | banco: 7 testes; HTTP: 3; telas: 3; E2E: `contrato-atendimento.spec.ts` | **Concluído** |
| D-5 | "Todas as modalidades gerarão cálculos no futuro." | Base para cálculo | Só dados e vínculos: OS carimbada com o contrato, horas reais por OS, natureza, histórico de renovações, `billing_model`. **Nenhum motor financeiro, fatura ou boleto.** | — | **Preparado** (cálculo = ampliação) |
| D-6 | (sem resposta nova) | Fechamento mensal | Inalterado: a medição existente segue consultiva. | — | **Pendente** |
| D-7 | "No cadastro do cliente informamos data de início e data de término de cada contrato." "Se possuir renovação automática, renova o ciclo se ninguém bloquear ou suspender." | Vigência e renovação | Datas por contrato já existiam no cartão do cliente; agora com "Renovação automática" (só com término). Varredura diária renova **no último dia**, pelo prazo **original** (12 meses = 12 meses), **antes** de expirar; suspenso/bloqueado não renova; `expired` não renova sozinho (renovação manual regulariza); prazo indeterminado não tem ciclo (422). Histórico `contract_renewals` (único por contrato × fim anterior = sem duplicata; SAVEPOINT desfaz se criaria sobreposição de equipamento). Vigência do cadastro do cliente continua informativa, com o aviso de divergência de 13/11; SLA segue o contrato. | banco: 4; domínio: 5; HTTP: 1 | **Concluído** |
| PLN-V1 | "Todos vão receber o checklist de ventilador … deveria obrigar equipamento por equipamento … um maiszinho." | Procedimento por equipamento | Passo "Procedimentos" com um seletor por equipamento (obrigatório), "+ Procedimento" para os adicionais da mesma OS e "Aplicar a todos de <categoria>". API `items[]`; o servidor recusa equipamento sem procedimento e procedimento de outro tipo. | banco: OS do ventilador com `prev_ventilador+tse`, do monitor com `prev_monitor`; HTTP; tela; E2E | **Concluído** |
| PLN-V2 | "Educação continuada … só gera um calendário … data por equipamento." | Novo tipo no assistente | `kind: education` → natureza `training` (já no catálogo, 0064); sem procedimento (recusado se vier); data obrigatória por equipamento = vencimento do 1º ciclo (`plan_tasks.first_due_on`). | banco: datas exatas, sem checklist, OS de treinamento; HTTP | **Concluído** |
| PLN-V3 | "Tenho que vir na data do plano e clicar para abrir as OS." | Gerar OS do plano manual | Botão "Gerar OS deste ciclo (N)" na página do plano (`maintenance_plan.generate_cycle`). | banco: materializa 1. E2E `planos-gerar-os.spec.ts`: o botão gera a OS de cada equipamento com o checklist dele | **Concluído** |
| PLN-V4 | "Visualizar o plano, editar o plano … para onde vão?" | Ficha do plano | "Para onde vai este plano"; Editar plano; editar/retirar equipamento (motivo); Incluir equipamentos; Histórico; ciclo aberto já na criação. | banco: edição + histórico; HTTP: 403/404; E2E | **Concluído** |
| PLN-A1 | (auditoria) | Data retroativa | 1º vencimento no passado → 422 no assistente (planos existentes não mudam). | banco; tela | **Concluído** |
| PLN-A2 | (auditoria) | Unidade › Setor | Seletor mostra a cadeia de locais. | tela | **Concluído** |

## 4. Destaques

### 4.1 Contratos e renovação automática
- Renovação automática só existe com término; a tela desabilita a opção sem data.
- O ciclo renovado repete o prazo contratado; o histórico mostra cada renovação (automática ou manual, por quem).
- Contrato já vencido no dia da publicação **não** renova sozinho — a consulta 3 do arquivo de impacto lista os que
  a primeira varredura renovaria.

### 4.2 Bloqueio e suspensão de atendimento

Revisão de 25/11 de TODAS as rotas de escrita (a primeira versão deixava escapar várias):

| Operação ligada ao contrato parado | Situação |
|---|---|
| Solicitação (abrir, mudar, nota do portal) | recusada |
| OS: abrir, toda mudança de situação, agenda, comentário, avaliação/assinatura | recusada |
| Execução: check-in, hora, checklist, anexo, relatório, peça do estoque e do cliente | recusada |
| Metrologia: abrir sessão, medir, anexar dado bruto | recusada |
| Laudo/certificado (OS, equipamento ou cliente): criar, editar, emitir, assinar, substituir | recusada |
| Registro de qualidade com cliente: criar, anexar, excluir | recusada |
| Orçamento DE UMA OS: criar, editar, revisar, enviar, aprovar, executar | recusada |
| Automação: atribuir, comentar, mudar situação, criar OS | falha registrada com o motivo |
| Plano: Executar, gerar OS, dispensar item | recusada / item retido |
| **Encerramento seguro:** check-out, parar cronômetro, encerrar medição aberta, cancelar documento; orçamento recusado, cancelado, expirado, faturado ou fechado | permitida |
| **Regularização:** contrato (editar, renovar, reativar, encerrar), cadastros de cliente/equipamento/plano, orçamento avulso (sem OS), oportunidade, pedido da Store | permitida |
| Consulta, histórico, auditoria, relatórios | permitida |

- O guarda está nas funções de dados; outro contrato válido que cubra o equipamento libera, e outros clientes não são afetados.
- **Defeito corrigido:** um ciclo de plano aberto durante uma suspensão curta dispensava o equipamento pelo período
  inteiro (uma calibração anual se perderia). Agora a varredura horária devolve o item e gera a OS quando o contrato
  volta, se o ciclo ainda não venceu. Dispensa feita por pessoa não volta; ciclo vencido não vira obrigação retroativa.
- **Não alterado — decidir com o Anderson:** o relógio de SLA de OS já aberta continua correndo com o contrato parado.
- "Suspender" e "Bloquear" têm o mesmo efeito; contrato **encerrado** não bloqueia (o cliente vira "sem contrato").

### 4.3 Horas técnicas nas OS
- Obrigatórias em toda OS concluída a partir da publicação; a web pede no diálogo de conclusão e no passo
  "Parecer final" do assistente; o app de campo pede antes de liberar "Concluir" (botão "Agora").
- Apuração auditável por OS; sem tarifa, sem valor.

### 4.4 Funcionamento real dos planos
Comprovado em PGlite (testes de banco e HTTP) e, no servidor PostgreSQL 16, pelos E2E e por `real-postgres.test.ts`: criação por equipamento, OS
geradas com o checklist de cada equipamento e os adicionais, educação continuada com as datas exatas, plano
manual materializado pelo botão, edição/inclusão/retirada com histórico, contrato suspenso sem OS gerada.

## 5. Definições ainda necessárias (Anderson)

1. **Equipes Fixas 3 a 10:** composição detalhada de cada uma; e os valores de todas.
2. **Tarifas da hora técnica (D-3/D-5):** valores, vigência da tabela, arredondamento, franquia, deslocamento.
3. **Fechamento mensal (D-6):** consultivo ou faturável.
4. **Suspender × bloquear:** se há diferença de efeito.
5. **Contrato encerrado:** se também deve bloquear o atendimento.
6. **SLA com contrato parado:** se o relógio de OS já aberta deve pausar.
7. **Equipamento que chega depois ao setor:** se basta incluir pela página do plano.

## 6. Fora do escopo desta rodada (possíveis ampliações comerciais — não aprovadas)

- Motor de faturamento por hora técnica, fatura, boleto, nota (D-5).
- Composição e precificação dos pacotes de equipe (D-1).
- Sugestão automática de procedimento por categoria/modelo de equipamento.
- Notificação ("pop-up") de antecedência do plano — o Anderson a mencionou; hoje a antecedência abre o ciclo/OS.
- Tela para ligar/desligar a obrigatoriedade das horas por organização.
- Indicadores do Anexo F: **não alterados**.

## 7. Pré-publicação: 0091, 0092 e app de campo

### 7.1 Migration 0091
- A API de produção responde impressão `7fea2ba90690` (construída em 23/11, `GET /v1/health/version`), igual à calculada
  em `main` `d772b49`. O cálculo inclui a pasta de migrations, e o manifesto de produção roda `migrate` no deploy.
- **Confirmada no banco em 25/11/2026** (leitura autorizada, transação READ ONLY): aplicada em 23/11/2026 12:52 UTC; 91
  migrations; os três índices existem e são válidos. A `0092` não está aplicada.

### 7.2 Migration 0092
`0092_planos_por_equipamento_bloqueio_renovacao_horas.sql` — só aditiva. Roda no próprio deploy da API; a API anterior
funciona com ela, então voltar a API não exige desfazê-la. O `ALTER` e os `CHECK` em `work_orders` e `contracts` travam a
escrita por um instante.

Consultas: `docs/auditoria/consultas-pre-deploy-0092.sql` (transação READ ONLY; testadas no estado da 0091, no
PostgreSQL 16 real e contra a regra `service_block`). Executadas em produção em 25/11/2026, só leitura, com autorização:

| Consulta | Resultado em 25/11/2026 |
|---|---|
| 1, 2 | **1 contrato vencido (contrato de demonstração, fim 23/11, sem renovação automática) e 7 equipamentos param**; nenhum outro contrato válido do mesmo cliente |
| 3, 4 | 12 OS abertas (2 em execução, nenhum cronômetro aberto) e 6 solicitações ficam só consulta |
| 5, 5b, 5c, 5d | **nenhuma renovação na primeira varredura**; nenhuma renovação sem término; nada vence em 60 dias |
| 6 | 25 OS ainda não concluídas passam a pedir as horas (não exclui as 12 acima) |
| 7 | nenhuma operação do app de campo em 30 dias: risco de app antigo em uso é baixo |
| 8 | 4 planos ativos (2 automáticos) não geram OS até regularizar |
| 9 | nenhum contrato com Equipe Fixa 3 a 10 |

Consequência prática: o contrato afetado é o do cliente de demonstração, o que o Anderson usa para testar. Vencido não se edita na
API atual; depois de publicar, **Renovar** na ficha do cliente libera tudo. Planos criados pelo assistente antigo como "todos do
setor" **não são convertidos**: continuam com um procedimento só para todos; para ter um por equipamento, desligar e recriar.

| Impacto | Consulta | O que fazer |
|---|---|---|
| Contratos e equipamentos que param | 1, 2 | Renovar, ou encerrar o contrato (encerrado não bloqueia), antes de subir |
| OS, cronômetros e solicitações que ficam só consulta | 3, 4 | Concluir antes, ou regularizar o contrato |
| Renovados na primeira varredura (03:23 UTC) | 5 | Conferir um a um; quem não deve renovar: desligar a renovação automática antes |
| Vencidos com renovação automática | 5b | Não renovam sozinhos; decidir renovação manual |
| Renovação sem término; próximos 60 dias | 5c, 5d | Informar |
| OS que passam a pedir horas | 6 | Avisar a equipe |
| Uso do app de campo | 7 | Dimensiona o aviso de atualização |
| Planos que não gerarão OS; Equipes 3 a 10 | 8, 9 | Informar |

### 7.3 App de campo
- **App novo com API antiga: compatível** (a API antiga ignora as duas horas). Pode ser publicado **antes**.
- **App antigo com API nova:** concluir volta 422 e vai para "Precisa da sua atenção", sem perder o texto. "Tentar de novo"
  só passa depois de as horas serem gravadas na OS (pelo sistema, no passo Parecer final, ou reconcluindo no app novo).
- O app se atualiza ao abrir com rede; aparelho que ficar offline continua no antigo até abrir.
- Trabalho feito offline antes de um bloqueio chega depois e é recusado (409), também preservado em "Precisa da sua atenção".

### 7.4 Ordem

Ver §9.6 (ordem definitiva).

## 8. Testes e CI

### 8.1 Testes desta rodada

| Suíte | Resultado |
|---|---|
| Banco (`conclusao-anderson-2026-11-24.test.ts`, PGlite) | 23/23 |
| HTTP (`api-conclusao-anderson-2026-11-24.test.ts`) | 9/9 |
| Domínio (`contract-service.test.ts`) | 7/7 |
| Telas (`conclusao-anderson-2026-11-24.test.tsx`) | 7/7 |
| Consultas de impacto no estado da 0091 (`consultas-pre-deploy-0092.test.ts`) | 2/2 |
| PostgreSQL 16 real (`real-postgres.test.ts`): renovação concorrente, SAVEPOINT, RLS, plano, consultas | 5 novos (só rodam no CI) |
| E2E: `contrato-atendimento`, `planos-gerar-os` (novos); `jornada`, `campo`, `execucao-guiada`, `os-auditoria-29-10`, `painel-planejamento` (atualizados) | passaram no CI |

Nesta máquina, a suíte inteira em `c55f5be` (1 worker): 2.967 passaram, 37 pulados (pedem PostgreSQL real) e 1 falhou —
um teste antigo de log que casava "1.5" com o horário da linha; estabilizado sem mudar o que verifica.
Testes existentes foram ajustados às regras novas (horas na conclusão, `contract_renewals` na lista de tabelas,
educação continuada no formulário), sem afrouxar asserções.

### 8.2 CI do GitHub (PR #57)

Último commit com mudança de código do sistema: `2084ec8`. CI completo em `c55f5be` (só testes a mais): run 45649474414, **tudo verde**.

| Check | Resultado |
|---|---|
| Estático | passou |
| Testes contra PostgreSQL 16 | **195 arquivos, 3.005/3.005, nenhum pulado** |
| Ponta a ponta (Playwright, com API e PostgreSQL 16) | **240 passaram, 1 pulado** |
| Gate | passou |

**Correção:** versões anteriores deste relatório diziam que todos esses testes rodavam no servidor PostgreSQL 16. Nessa etapa
só **37** usam o servidor (`real-postgres` e `jobs-real-postgres`); os demais usam PGlite. Os E2E usam o servidor real.

Falhas corrigidas no caminho: 4 E2E (`48d54ad`), 1 E2E (`92fc6df`) e 4 testes no PostgreSQL real (`2084ec8`) — todas no próprio teste.

## 9. Preparação do deploy (25/11/2026) — nada executado

Leitura de produção em transação READ ONLY (`consultas-pre-deploy-0092.sql` e `consultas-pre-deploy-0092-detalhe.sql`).

### 9.1 Bloqueios operacionais

| # | Bloqueio | Como resolver |
|---|---|---|
| B1 | Contrato de demonstração vencido: ao subir a API, 7 equipamentos, 12 OS e 6 solicitações ficam só consulta | §9.2 |
| B2 | **Defeito conhecido:** "Incluir equipamentos" num plano antigo (por setor ou categoria) que já alcança o equipamento gera uma segunda OS. Reproduzido em teste (2 OS) | Corrigir antes (recusar equipamento já alcançado pela tarefa do plano), ou orientar a não usar esse botão em plano antigo |
| B3 | Não há procedimento de PREVENTIVA publicado para monitor nem para ventilador: só para bomba de infusão e incubadora. O assistente novo exige um por equipamento | Anderson publica os procedimentos antes de recriar |
| B4 | Prazo na renovação: 23/11/2025 a 23/11/2026 conta 366 dias, e "Renovar" sem data leva a **24/11/2027** | Informar a data na renovação, ou decidir se "mesmo dia do ano seguinte" conta como 12 meses |

### 9.2 Regularização do contrato de demonstração (só com autorização)

Estado: serviço completo, cobertura por setor (1), 23/11/2025 a 23/11/2026, sem renovação automática, com valor mensal, sem SLA
geral, sem periodicidade, pacote ou pagamento informados, sem período medido. Marcado vencido pela varredura de 24/11.

- **Opção A — renovar (depois da API):** ficha do cliente > Renovar > novo término **23/11/2027** e observação com o motivo.
  Muda só o término e a situação; número, início, cobertura e valor ficam; a renovação entra no histórico. Efeitos: a vigência
  fica contínua desde 23/11/2026 e a renovação automática continua desligada. Há bloqueio entre subir a API e renovar.
- **Opção B — contrato novo (antes da API):** ficha do cliente > Novo contrato, com a data real de início, a mesma cobertura e
  condições. Não há janela de bloqueio e o vencido fica como histórico. O formulário só cobre "todos os equipamentos";
  cobertura por setor só pela API.
- **Opção C — deixar vencido:** testar o bloqueio com o Anderson e depois aplicar A.

Nenhuma opção cria dado fictício. Datas e condições reais são do Anderson.

### 9.3 Planos do cliente afetado

| Plano | Modelo | Situação | Orientação |
|---|---|---|---|
| P1 — preventiva a cada 6 meses | **Antigo, por setor** | Sem principal; "calibração de ventilador" nos 5 equipamentos de 3 categorias. 5 OS abertas (OS-01 a OS-05), sem resposta, visita ou hora | Recriar |
| P7 — preventiva a cada 6 meses | **Antigo, por setor** | Procedimento de bomba; alcança 0 equipamento; nenhum ciclo | Desligar; recriar se houver equipamento |
| P5 — preventiva trimestral | Por categoria (2 equipamentos, 1 categoria) | Sem procedimento, manual; OS-11 e OS-12 abertas e 2 itens pendentes | Não mistura tipos; falta publicar e escolher o procedimento |
| Calibração anual — monitores e desfibriladores | Por categoria (1 equipamento) | Sem procedimento, manual; 1 item pendente | Idem, com procedimento de calibração |

Fora do cliente afetado há 3 planos automáticos com o procedimento de **incubadora** em outros equipamentos: P2
(desfibrilador e ventilador), P3 (desfibrilador) e P4 (ultrassom). Revisar com o Anderson.

**Recriação, sem apagar nada** (contrato regularizado):
1. Publicar os procedimentos que faltam (B3).
2. **Desligar** o plano antigo, com motivo. Ciclos e OS ficam como histórico.
3. Cancelar, com justificativa, as OS geradas com o procedimento errado que não foram iniciadas. No sistema atual dá para
   cancelar já; depois da API, só com o contrato regularizado.
4. Criar o novo: preventiva, 6 meses, início **13/11/2026** (mantém o vencimento em 13/05/2027), um procedimento por equipamento.
   Começar com a geração automática **desmarcada**, conferir, e gerar por equipamento.

Criar o novo antes de desligar o antigo duplica as OS.

### 9.4 App de campo antes da API: confirmado por leitura do código

- A única mudança do app é a tela da OS; ela acrescenta duas horas ao corpo da mudança de situação.
- A API em produção (mesma impressão de `main`) lê esse corpo campo a campo e ignora o que não conhece. Até a API subir, as horas
  digitadas no campo **não são gravadas**. Não foi ensaiado contra a API antiga em execução.
- Nenhum uso do app em 30 dias: risco baixo. A publicação sai de `main`, então depende do merge.

### 9.5 Migration 0092: pronta

Só aditiva, inalterada desde o primeiro commit da PR; aplicada no PostgreSQL 16 do CI (do zero). Roda como `migrate` no deploy da
API. Aplicá-la na cópia do `restore_drill` antes é o ensaio que falta. Voltar a API não exige desfazê-la, mas **a API antiga não
respeita suspensão nem bloqueio** feitos no intervalo.

### 9.6 Ordem definitiva

1. Decisões B1 a B4 e autorização. Merge da PR com CI verde.
2. Publicar o **campo** a partir de `main`; abrir com rede em um aparelho.
3. **Backup** novo, `restore_drill` verificado e, se possível, `0092` aplicada na cópia.
4. Rodar de novo as consultas de impacto (os números mudam a cada dia).
5. Deploy da **API** no SHA do merge (roda a `0092`). Conferir `health/ready`, impressão igual à de `npm run versao` e 92 migrations.
6. Publicar **sistema** e **portal**.
7. Regularizar o contrato (opção A), se for a escolhida.
8. Testes reais (§9.7). Volta: API no SHA anterior e front anterior.

### 9.7 Checklist de homologação

Sem gravar (quem publica):
- [ ] Login, Painel, OS, Contratos, Planos, Qualidade abrem sem erro no console nem violação de CSP
- [ ] Ficha do contrato mostra vencido; ficha de OS do cliente mostra o motivo e não oferece mudança de situação
- [ ] Formulário do contrato descreve as Equipes Fixas 1 e 2
- [ ] Assistente de plano abre e mostra um procedimento por equipamento (sem salvar)
- [ ] Portal e campo entram

Com gravação (Anderson, ou com autorização dele; registros reais):
- [ ] Abrir chamado no cliente vencido é recusado com o motivo
- [ ] Renovar: término 23/11/2027, aparece em Renovações, OS volta a aceitar mudança
- [ ] Suspender e reativar com motivo, num contrato combinado
- [ ] Concluir uma OS real no sistema e outra no campo: pede as duas horas; conferir em Horas técnicas
- [ ] Recriar o plano P1 (§9.3); "Gerar OS deste ciclo" traz o checklist de cada equipamento
- [ ] Editar, retirar equipamento e ver o histórico do plano
- [ ] Educação continuada com data por equipamento
- [ ] No dia seguinte: nenhuma renovação inesperada e nenhuma OS duplicada
