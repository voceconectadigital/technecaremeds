# Relatório de conclusão final — rodada Anderson (29–30/10/2026)

**Repositório:** `voceconectadigital/technecaremeds` · **PR #42** · branch `feat/rodada-2026-10-29`
**Base:** `main` em `a852e7c` · **Último commit:** `b064f60`
**Inventário item a item:** `docs/auditoria/technecare-status-requisitos.json` (os 177 IDs originais preservados)
**Ampliações e decisões (uso interno, sem valores):** `docs/auditoria/AMPLIACOES_ESCOPO_ANDERSON.md`

Nada foi publicado e nada foi mergeado. Nenhuma migration remota foi aplicada.

---

## 1. Requisitos por status

| Status | Antes (29/10) | Agora (30/10) |
|---|---|---|
| Implementado e testado | 95 | **139** |
| Implementado sem teste | 8 | **0** |
| Parcial | 40 | **3** |
| Pendente de definição (Anderson) | 3 | 4 |
| Bloqueado por dependência externa | 6 | 6 |
| Exige aprovação comercial | 2 | 2 |
| Decisão comercial registrada | 2 | 2 |
| Evolução futura | 8 | 8 |
| Reservado para V2 | 13 | 13 |
| **Total** | 177 | 177 |

**Por fase**

| Fase | Testado | Parcial | Pendente | Bloqueado | Comercial | Outros |
|---|---|---|---|---|---|---|
| ATUAL (128) | 118 | 2 | 4 | 4 | — | — |
| ATUAL_VITRINE (11) | 11 | — | — | — | — | — |
| OPERACIONAL_VALIDAR (11) | 8 | 1 | — | 2 | — | — |
| AVALIAR_ESCOPO (4) | 2 | — | — | — | 2 | — |
| DECISAO_COMERCIAL (2) | — | — | — | — | — | 2 registradas |
| EVOLUCAO_FUTURA (8) | — | — | — | — | — | 8 futuras |
| V2 (13) | — | — | — | — | — | 13 V2 |

"Implementado e testado" = código + teste automatizado que cobre o critério de aceite, verde na suíte local e/ou no CI do PR. Não equivale à aceitação de uso pelo cliente.

## 2. O que esta execução concluiu

**Ordens de serviço**
- **OS-16 / ATV-16:** o parecer LIBERADO/PARADO passou a ser obrigatório por padrão em toda OS de equipamento; a organização pode desligar.
  - PARADO põe o ativo "em manutenção" e LIBERADO o devolve à operação.
  - A mudança fica na auditoria e gera um evento.
  - O **app de campo** pede o parecer antes de concluir. Sem isso, a conclusão pelo celular voltaria recusada.
- **OS-17:** o botão Concluir só habilita quando os mesmos critérios que o servidor exige estão cumpridos, e mostra o que falta.
- **OS-20 / OS-26:** folha única de impressão da OS e do laudo, com check-in, checklist, parecer, peças, anexos e assinaturas.
- **OS-12:** pergunta "Há anexos?", além de documento e manual.
- **OS-01:** aba "Negados" na lista de OS.
- **OS-03 / ORC-01 / CLI-07:** orçamento só quando a organização usa o recurso; a API recusa a criação quando ele está desligado.
- **OS-24:** a validação do laudo grava a assinatura de quem valida.
- **OS-07 / OS-08 / OS-18:** testes novos.

**Planos**
- **PLN-01:** ativar e desligar plano, com motivo e auditoria (0087).
- **PLN-09:** botão "Executar plano" com assistente cliente → plano → equipamento.
- **PLN-10:** percentual de conformidade por plano.
- **PLN-11:** vários setores no mesmo filtro.
- **REL-12:** ranking de conformidade com Excel.
- **OS-15:** vários procedimentos na mesma OS, sem misturar respostas.
- **ORC-05:** listas de espera por peças e por orçamento, filtradas.
- **PLN-02/03/04/08/12:** testes novos. PLN-02 também foi corrigido: só respeitava o filtro de cliente.

**Relatórios e automações**
- **REL-13:** o nível contratado vale também nos relatórios agendados, ao criar e ao executar.
- **REL-03:** setor, tipo de manutenção e família no próprio gerador, e página `/relatorios`.
- **REL-14:** avaliação das OS no Painel.
- **REL-15:** atalho do relatório para a automação.
- **REL-07:** versão da fórmula de cada indicador.
- **AUT-07:** corrigido um defeito em produção. As automações por evento nunca rodavam, porque o publicador só registrava o evento em log. Agora o worker entrega o evento uma vez (0088).

**Cadastros** (0089)
- **ATV-04:** tag única por organização e que não pode ser apagada.
- **ATV-11:** ANVISA pesquisável e com a opção "não se aplica".
- **ATV-13:** ficha de vida com planos, procedimentos e histórico de campos.
- **ATV-10:** valor residual e metodologia da depreciação explícitos.
- **SOL-01:** setor na nova solicitação.
- **USR-04:** telefone validado e conselho profissional conforme a profissão.
- **USR-05:** CNPJ da empresa.
- **CLI-02:** "Outro" fora do cadastro novo.
- **CLI-03:** setores padrão ao criar um EAS.
- **QUA-04:** procedimento no certificado de qualificação.
- **OPS-07:** logs sem CPF, telefone, registro profissional nem coordenadas.

**Defeitos achados na inspeção visual dos PDFs (pdf.js) e corrigidos**
1. O nome interno "Aurora" aparecia para o cliente. Agora sai "Téchne Care", lido de um único lugar.
2. Legenda de gráfico sozinha no pé da página.
3. Eixo de série toda zero indo de −1 a 1.
4. Eixos com rótulos repetidos ou pulados ("0, 0, 1, 1, 1" e "0, 1, 2, 3, 5"). Agora as marcas são redondas.
5. Jargão de código ("firstResponseTime") no texto do Expert.
6. Cabeçalho estourando a coluna no Patrimonial.

**OPS-04:** varredura E2E de todos os links do menu, por perfil (admin, técnico e auditora), com recarga da rota e checagem de celular sem rolagem horizontal.

## 3. Itens ainda parciais

| ID | Pronto | Falta | Quem fornece |
|---|---|---|---|
| REL-05 | SLA, evolução, backlog e OS por situação (Advanced) ativos e testados | Indicador de obsolescência | Anderson: definição P-16 |
| AUT-05 | Recorte por contrato e por destinatário nos agendados | Quais indicadores vão ao financeiro; envio por e-mail | Anderson (lista) e provedor de e-mail |
| OPS-08 | Branch, PR, commits e CI rastreados; CI e suíte verdes | Deploy efetivo e conferência em produção | Ordem expressa de publicação (responsável pelo projeto) |

## 4. Pendências exclusivas de Anderson

| ID | Informação necessária | Impacto |
|---|---|---|
| REL-04, REL-06, OPS-10 (+ REL-16) | As fórmulas prometidas em 22/10 (P-01…P-16) | MTTR, MTBF, disponibilidade e conformidade seguem "provisórios"; 15 dos 17 indicadores do Expert, "pendentes"; "17+ indicadores em tempo real" não pode ser anunciado |
| USR-09, USR-11 | Quais campos exigem aprovação de engenheiro ou gestor | O controle por perfil já vale na API (Operador recebe 403 em 13 cadastros gerenciais); falta o fluxo de aprovação |
| OS-03 | Confirmar o padrão "hospital próprio = sem orçamento" | Hoje o modo hospital nasce sem orçamento, e dá para ligar |
| OS-23 | Se a assinatura por sessão basta ou se precisa de ICP-Brasil | A assinatura por sessão está pronta |
| OPS-07 | Prazo de retenção da geolocalização do check-in (o cliente é o controlador dos dados) | Sem prazo, não há rotina de expurgo; política registrada em `docs/PRIVACIDADE-LOGS-E-GEOLOCALIZACAO.md` |
| ATV-04 | Corrigir as tags repetidas antigas (se houver) | Ficam marcadas e fora do índice único até alguém trocá-las; nenhum dado foi apagado |
| Quadro de OS | O que a seta verde da foto de 29/10 aponta | Nada foi mudado sem saber o pedido |

## 5. Dependências de infraestrutura ou terceiros

- **Provedor de e-mail** (USR-02, ORC-03, AUT-02, AUT-03, AUT-05): hoje tudo chega pela caixa de entrada do sistema. Nenhum envio é simulado.
- **Domínio e VPS** (OPS-05): "htec.b" não existe.
- **Deploy:** depende de ordem expressa.

## 6. V2 — não implementado

V2Q-01 a V2Q-13 (gestão da qualidade completa, matrizes, ONA operacional, tarefas com cronômetro, checklists ONA). Nesta fase ficaram só o tópico Qualidade com os certificados e a ONA como vitrine.

## 7. Ampliações que exigem aprovação comercial

TEN-02 (domínio próprio por cliente) e TEN-04 (suspender, limitar e revogar negócio). Também ficam de fora, como evolução futura: ATF-01 (ANVISA automática), ATF-02 (IA nos planos), ATF-03 e FUT-01…05 (hardware). Detalhes em `AMPLIACOES_ESCOPO_ANDERSON.md`.

## 8. CI da PR #42

| Commit | Estático | PostgreSQL 16 | Ponta a ponta | Gate |
|---|---|---|---|---|
| `68ed145` (1ª passada) | verde | verde | **2 falharam** (spec da Store supôs o perfil errado) | — |
| `080520a` | verde | **2.651/2.651** | **223 passaram**, 1 pulado | verde |
| `e7d1b33` | verde | verde | **1 falhou, 1 instável**, 235 passaram (ver 8-A) | **reprovado** |
| **`62eb8c3` (HEAD de código)** | **verde** | **2.846/2.846** | **237 passaram**, 1 pulado, **0 falhas, 0 instáveis** | **verde** |

### 8-A. Falhas do CI em `e7d1b33` e correção (`62eb8c3`)

As duas falhas eram dos testes, não da tela. Nenhum critério foi afrouxado.

1. **`painel-planejamento.spec.ts:28` — falha.** O seletor `gráfico.or(texto "Sem dados no período.")` encontrou dois elementos.
   - **Causa:** o gráfico "Evolução dos chamados" estava desenhado, e o "Sem dados no período." vinha de **outro** cartão, o "Avaliação das OS", novo nesta rodada e vazio nos dados de teste.
   - **Correção na tela:** cada cartão de gráfico do Painel virou uma região com o nome do título. O leitor de tela passa a anunciar cada cartão.
   - **Correção no teste:** ele confere dentro do cartão "Evolução dos chamados" que existe **exatamente um** entre o gráfico e a mensagem de vazio desse cartão ("Sem dados suficientes para este período."), e que ele está visível.
2. **`navegacao-links.spec.ts:62` — instável** (passou só na repetição).
   - **Causa:** no celular, os links eram lidos logo depois do `goto('/')`, antes de o shell renderizar, e vinham zero links.
   - **Correção:** o teste espera a tela, abre a gaveta pelo botão **"Abrir menu"**, espera o menu e o primeiro link visíveis e lê só os links visíveis e acessíveis.
   - Ele exige `/ordens` e `/ativos` entre os destinos e, para cada um, que a tela abra sem "sem acesso" e sem rolagem horizontal a 375 px.
   - A leitura do menu no desktop ganhou a mesma espera.

Run do HEAD: `41048276925`, com Estático, PostgreSQL 16, Ponta a ponta e Gate verdes. Os E2E novos rodaram e passaram: varredura de links por perfil e no celular, folha de impressão da OS, Play de planos, parecer no app de campo e Store.

## 9. Testes desta execução

| Verificação | Resultado |
|---|---|
| Typecheck (`tsc -b`, Node 22) | 0 erros |
| Lint dos arquivos versionados | 0 erros |
| Prettier e marca (worktree LF, igual ao CI) | em dia (o `marca:check` acusou o arquivo novo de marca do servidor; foi corrigido, deixando-o fora do prettier como o da tela) |
| OpenAPI, auditoria da spec, varredura de segredos | em dia |
| Build de produção: web, portal, campo e demonstração | os quatro geraram |
| Suíte local completa (PGlite) | **2.813 passaram, 0 falharam**, 32 pulados (os que precisam de PostgreSQL real e rodam no CI) |
| Suítes do app de campo | 89/89 |
| PDFs (Basic, Advanced, Expert, Patrimonial) gerados pela API e abertos no pdf.js | conferidos visualmente; 6 defeitos achados e corrigidos (§2); refeitos e reconferidos |
| Excel (Basic, Advanced, Expert, Patrimonial) aberto por leitor independente (SheetJS) | abas certas; números tipados (`n`), datas tipadas (`d`), pendente como texto |
| Cálculo conferido à mão no Patrimonial | R$ 12.345,67 comprado em 01/01/2024, vida útil de 10 anos → 28,3% depreciado → R$ 8.853,57 ✔ |

**Não verificado:**
- O Excel não foi aberto no Microsoft Excel; nesta máquina ele não abre.
- O E2E não roda localmente porque o Docker não sobe; roda só no CI.
- As telas novas não foram abertas contra a API real fora do E2E do CI.

## 10. Commits e arquivos

| Commit | O quê |
|---|---|
| `4318881` | Rodada de 29/10: Store do dono, prazos da OS, relatórios (Basic, Excel, patrimonial, trava de nível), cadastros (0084, 0085), vitrine |
| `3492258` | Formatação |
| `68ed145` | Auditoria dos 177 itens, relatório de 29/10, handoff, NS-023 |
| `080520a` | E2E da Store corrigido (perfil admin) |
| `db9b357` | Conclusão: parciais e itens sem teste (0087, 0088, 0089), parecer no app de campo |
| `22955c3` | Marca do servidor fora do prettier |
| `f199c50` | E2E de varredura de links; captura da demonstração |
| `b064f60` | Eixo dos gráficos do PDF |
| `e7d1b33` | Relatório de conclusão, inventário e handoff |
| `62eb8c3` | E2E do Painel com escopo no cartão; menu do celular lido depois de aberto; cartões do Painel como regiões nomeadas |

Ao todo, 181 arquivos foram alterados em relação à `main`.
- **Migrations novas:** 0084, 0085, 0087, 0088 e 0089. O número 0086 ficou sem uso, e o migrador aceita a lacuna: a suíte e o CI rodam todas.
- **Testes novos:** API de Store, cadastros, OS, planos, relatórios (filtros, agendados, PDF e Excel), automação por evento e logger; banco de planos e procedimentos; web de OS, planos, prazos e relatório→automação; E2E de OS, Play de planos, varredura de links e Store.

## 11. Riscos conhecidos antes do deploy

1. **Mudanças de comportamento em produção:**
   - O parecer passa a ser obrigatório para concluir OS de equipamento. Isso vale para automações que concluem OS e para aparelhos de campo com versão antiga em cache: essas conclusões voltam recusadas até o técnico atualizar o app.
   - O modo hospital passa a nascer sem orçamento.
   - Setor fora do escopo no quadro de planos agora responde 404, e não mais vazio.
2. **Automações por evento** passam a rodar de verdade depois do deploy do worker. Regras que estavam ligadas e caladas (ex.: "OS aguardando peça → avisar compras") vão começar a disparar. Vale revisar as regras ativas antes.
3. **Migrations 0084–0089:** a 0089 cria um índice único de tag e marca as tags repetidas existentes, sem renomear nem apagar nada. Rodar no banco remoto exige backup antes.
4. **Ordem de publicação:** backup → API (aplica as migrations) → conferir `/v1/health/version` → front (web, portal, campo) → atualizar o app de campo nos aparelhos.

## 12. Prontidão para publicação

**PRONTA COM RESSALVAS.**

- **CI completo verde no HEAD de código `62eb8c3`:**
  - Estático passou.
  - PostgreSQL 16: 2.846 de 2.846.
  - Ponta a ponta: 237 passaram, 0 falhas, 0 instáveis.
  - Gate passou.
- **Fora do CI:** a suíte local passou com 2.813 de 2.813, e os builds de produção de web, portal, campo e demonstração geraram.
- **Rodada atual:** não sobrou pendência executável. Os itens que faltam dependem só de Anderson (fórmulas, lista de campos, indicadores do financeiro, retenção da geolocalização), de serviço externo (e-mail, domínio) ou da sua ordem de deploy. Nenhum deles impede a operação dos recursos autorizados.
- **IDs pendentes:**
  - parciais: REL-05, AUT-05, OPS-08;
  - pendentes de definição: REL-04, REL-06, USR-09, USR-11;
  - dependência externa: USR-02, ORC-03, AUT-02, AUT-03, OPS-05, OPS-10;
  - aprovação comercial: TEN-02, TEN-04.
- **Bloqueios reais de produção:** os itens do §6 do checklist (`docs/auditoria/CHECKLIST_PRE_PUBLICACAO_PR42.md`), a conferir com consultas de leitura no banco antes do deploy:
  - duplicidade em `rule_runs`, que faria a 0088 falhar;
  - automações por evento ativas que não devem disparar;
  - organização em modo hospital que usa orçamento;
  - backup verificado.
- **Antes de publicar:** revisar as regras de automação ativas (risco 2), atualizar o app de campo (risco 1) e fazer o backup antes das migrations 0084–0089 (risco 3).
