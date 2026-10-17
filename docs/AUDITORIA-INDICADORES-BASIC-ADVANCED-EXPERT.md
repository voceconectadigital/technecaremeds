# Auditoria de indicadores — Basic, Advanced e Expert

> **Rodada de AUDITORIA (17/10/2026).** Nada foi implementado. Não houve alteração de código, migration,
> API, UI, banco ou relatório. Este documento é a base para a rodada de refinamento dos relatórios.

**Fontes lidas.** As quatro primeiras são os documentos do cliente, em `Downloads` (não versionados).

| Sigla | Arquivo | O que é |
| --- | --- | --- |
| **PDF-B** | `básico - RT INDICADOR_SCLS Setembro.pdf` | 7 páginas. Santa Casa de Lagoa Santa, set/2026, referência **Basic** |
| **PDF-A** | `COMPLETO - Relatorio Técnico de Atividades TéchneCare SETEMBRO 2026.pdf` | Complexo Hospitalar Samuel Libânio, set/2026, referência **Advanced** ("Completo" na origem) |
| **IMR** | `Expert - HJXXIII-IMR-SETEMBRO-26.pdf` | 1 página: Instrumento de Medição de Resultados do HJXXIII, 16 itens |
| **DS** | `Technecare.pdf` | Export do Data Studio com 13 indicadores, referência **Expert** |

Código lido:

- `packages/db/src/metrics.ts`, `packages/db/src/painel.ts`, `packages/db/src/plan-board.ts` e `packages/db/src/relatorios.ts`;
- `packages/domain/src/metrics.ts`, `packages/domain/src/report-tiers.ts`, `packages/domain/src/work-orders.ts` e `packages/domain/src/contracts.ts`;
- as migrations `0013`, `0014`, `0018`, `0019`/`0023`, `0021`, `0027`, `0031` e `0035`;
- os documentos `AI-HANDOFF`, `NOVAS-SOLICITACOES` e `ROADMAP-ANDERSON-2026-10-16`.

**Decisão da reunião de 16/10.** Cada modelo tem uma referência:

| Modelo | Referência |
| --- | --- |
| BASIC | Lagoa Santa (PDF-B) |
| ADVANCED | Samuel Libânio (PDF-A) |
| EXPERT | FHEMIG + Data Studio/IMR |

**Classes usadas em todo o documento**

| Classe | Significado |
| --- | --- |
| **A** | FÓRMULA COMPROVADA: os componentes aparecem no documento e reproduzem o resultado |
| **B** | DERIVÁVEL COM ALTA CONFIANÇA: a descrição textual é inequívoca, mas faltam componentes para provar numericamente |
| **C** | IMPLEMENTAÇÃO ATUAL JÁ EXISTE: o sistema calcula com definição própria e documentada |
| **D** | FÓRMULA AMBÍGUA: há mais de uma leitura possível, ou os números se contradizem |
| **E** | DADO AUSENTE: o sistema não tem o dado |
| **F** | BLOQUEADO — CLIENTE/ESPECIALISTA |

---

## 1. Resumo executivo

- **31 indicadores únicos** foram mapeados, distribuídos assim:
  - Basic: 12;
  - Advanced: 11 próprios, mais os do Basic herdados;
  - Expert: 16 (os 13 do DS estão contidos nos 16 do IMR).
- **2 fórmulas comprovadas numericamente**, ambas no DS:
  - Índice de Chamados Realizados/Solicitados (ICRS): 1.713 / 1.967 = **87,087 %**, e o DS mostra 87,09 %;
  - Adesão ao Cronograma de Manutenção Preventiva (ACM): 1.699 / 1.741 = **97,588 %**, e o DS mostra 97,59 %.
- **6 deriváveis com alta confiança**, **6 já implementadas** com definição própria, **10 ambíguas** e **7 dependentes de dado ou definição inexistente**.
- **14 indicadores já são calculáveis** com os dados atuais. Outros 3 (MTTR, MTBF e TMPA) o sistema calcula, mas **com definição diferente ou não confirmada** pelo cliente.
- **Glosa/IMR: BLOQUEADO.** Todos os descontos do IMR são 0 e todas as glosas R$ 0,00, então o documento não revela faixa, percentual, peso, teto nem regra cumulativa.
- **Os documentos de referência têm inconsistências internas** (§2.3, §4.4). Elas impedem usar os números como gabarito em vários pontos:
  - totais divergentes;
  - competência trocada;
  - unidade "h meses";
  - formato `35:96h` (96 minutos não existe);
  - Global fora do intervalo entre Interno e Externo.
- **O MTTR do sistema é tempo corrido** (`completed_at − opened_at` das corretivas). O PDF-B define MTTR como "tempo em que a equipe técnica **esteve em atendimento**", o que lembra horas apontadas. **São coisas diferentes** e o cliente precisa escolher.
- **"Primeiro atendimento" no sistema = submissão → triagem** (`first_response_at` / `firstResponseTime`). Existem outros quatro marcos candidatos no modelo; ver §11 e P-03.
- **Metas não ficam hardcoded hoje**, mas também **não existe configuração de meta por indicador**. O que existe é: metas de SLA por política/contrato (`sla_targets`, `contract_sla_overrides`) e glosa por SLA violado (`contracts.penalty_percent_per_breach`, `penalty_cap_percent`), mas essa é outra regra, não a do IMR.

---

## 2. Basic — referência Lagoa Santa (PDF-B)

### 2.1 O que o PDF-B apresenta (mapeamento integral)

O PDF-B tem 7 páginas, cada uma com um texto e um painel em imagem. A fonte declarada é o Arkmeds; o período é 01/09 a 30/09/2026.

**Ind. 1 — Índice de OS Realizadas/Solicitadas**

| Item | Conteúdo |
| --- | --- |
| Resultado | Solicitadas 23, Atendidas 23, Índice **100,00 %** |
| Composição | Pizza "por tipo de manutenção realizada": Preventiva 14 (62 %) e Corretiva 9 (38 %) |
| Detalhe | Tabela por setor (9/6/4/2/1/1 = 23) |
| Figura 1 do texto | Outra distribuição: 1+1+11+1+7+2+2+24 = **49 OS**. O texto chama de "corretivas … entre os setores do **HIJPII**", nome de outro hospital |
| Meta | Não declarada |

**Ind. 2 — MTTR**

| Item | Conteúdo |
| --- | --- |
| Base | Total de OS no período 61; solucionadas 61 |
| Resultado | **13:43 h**, meta **72:00 h** |
| Detalhe | 8 setores |
| Definição escrita | "tempo médio em que a equipe técnica esteve em atendimento até a solução da chamada" |

**Ind. 3 — MTBF**

| Item | Conteúdo |
| --- | --- |
| Resultado | **1,76 "h meses"**, meta **48:00 "h meses"** |
| Detalhe | 8 setores |
| Definição escrita | "tempo médio transcorrido entre uma falha e outra do equipamento" |

**Ind. 4 — Adesão ao cronograma de MP, Calibração e TSE**

| Item | Conteúdo |
| --- | --- |
| Resultado | Regulares 1, Atrasadas 0, ACM **100 %**, meta 100 % |
| Pizza | 38 OS fechadas |
| Detalhe | Tabela com 5 OS listadas, total 38 |
| Texto | "1 plano de serviços recorrentes … 100 %" |
| Anomalias do painel | Marca **Hospital Lindouro Avelar**, gráfico **ago/2026**, "gerado em 31/08/2026" |

**Ind. 5 — Treinamentos Realizados/Solicitados**

| Item | Conteúdo |
| --- | --- |
| Resultado | Solicitadas 0, Realizadas 0, ITRS **100 %**, meta 100 % |
| Detalhe | "Sem dados" |
| Anomalia | Marca Lindouro Avelar |

**Ind. 6 — Avaliação da qualidade dos serviços**

| Item | Conteúdo |
| --- | --- |
| Resultado | **4,7** sobre 64 avaliações |
| Distribuição | 5★ 56 · 4★ 5 · 3★ 3 · 2★ 2 · 1★ 1 |
| Resumo | Positivas 56 · Neutras 5 · Negativas 3 |

### 2.2 Reunião de 16/10 × PDF-B × sistema

| Indicador | PDF-B | Reunião | Sistema hoje (`report-tiers.ts`) | Diferença registrada |
| --- | --- | --- | --- | --- |
| Chamados realizados/solicitados | ✓ Ind. 1 | — | — (não há indicador de razão) | **Está no PDF e não está na reunião** |
| Chamados abertos | — | ✓ | ✓ `work_orders_opened` | Está na reunião e não está no PDF |
| Chamados concluídos | — | ✓ | ✓ `work_orders_completed` | Está na reunião e não está no PDF |
| MTTR | ✓ | (implícito) | ✓ `mttr` | **Definição diverge** (§2.3, P-01) |
| MTBF | ✓ | (implícito) | ✓ `mtbf` | **Unidade diverge** (min × meses × "h meses") |
| Adesão preventiva | ✓ (junto com cal./TSE) | ✓ separada | ✓ `compliance_preventive` | O PDF agrega MP+CAL+TSE em **um** índice; o sistema separa |
| Adesão calibração | ✓ (agregada) | ✓ | ✓ `compliance_calibration` | idem |
| Adesão TSE | ✓ (agregada) | ✓ | ✓ `compliance_electrical_safety` | idem |
| Conformidade qualificação | — | ✓ | ✓ `compliance_qualification` | Está na reunião e não está no PDF |
| Disponibilidade do parque | — | ✓ | ✓ fotografia (`park_availability_snapshot`) | **Está na reunião e não está no PDF**; "parado" está indefinido |
| Treinamentos realizados/solicitados | ✓ Ind. 5 | — | — | **Está no PDF e não está na reunião** |
| Avaliação da qualidade | ✓ Ind. 6 | — | — (o dado existe: `service_requests.rating`) | **Está no PDF e não está na reunião** |

Nenhuma diferença foi resolvida silenciosamente: o cliente decide (P-10).

### 2.3 Testes numéricos do PDF-B

| Teste | Resultado | Leitura |
| --- | --- | --- |
| Ind. 1: 23/23 | 100 % | Trivial; não prova a fórmula |
| Ind. 1, pizza 14/23 e 9/23 | 60,87 % / 39,13 % | O painel mostra **62 % / 38 %**: arredondamento inconsistente |
| Ind. 1 × Figura 1 × MTTR | 23 × 49 × 61 OS no mesmo mês | **Três populações diferentes** sem explicação |
| Ind. 6: soma das notas | 56+5+3+2+1 = **67** | O painel diz **64** |
| Ind. 6: média | Σ(nota×qtde)/67 = **4,687 → 4,7** ✓; sobre 64 daria 4,906 | A média bate com **67** avaliações, não com 64 |
| Ind. 6: "positivas (4 e 5)" | 56+5 = 61 (95,3 %) | O painel mostra 56 (87,5 %) e põe as notas 4 em "neutras" |
| Ind. 3 | "1,76 h meses", meta "48:00 h meses" | Unidade sem sentido; impossível testar |

**Conclusão:** o PDF-B serve como referência **visual e de escopo**, não como gabarito numérico.

---

## 3. Advanced — referência Samuel Libânio (PDF-A)

### 3.1 O que o PDF-A apresenta

Centro de custo HCSL020, competência set/2026, documento datado de "21 de setembro".

| # | Indicador (sigla) | Resultado | Meta | Série | Observação |
| --- | --- | --- | --- | --- | --- |
| 1 | Avaliação do atendimento/relacionamento (**IAR**) | 4,6 | 3 | 12 meses | Média de notas, com a mesma escala do Arkmeds |
| 2 | Disponibilidade do Parque Tecnológico (**DPT**) | 98,0 % | 92 % | 12 meses (eixo "HORAS") | "disponibilidade para uso dos equipamentos cadastrados" |
| 3 | **MTTR** | 13:49 h | 72 h | 12 meses; o ponto de setembro aparece como **"13,49"** | Ambiguidade h:mm × decimal |
| 4 | **MTBF** | 5,10 meses | 3 meses | 12 meses | **Em meses** |
| 5 | Regularidade dos planos / Performance de Manutenção Programada (**IMP**; a legenda diz "IAC") | 100 % | 96 % | 12 meses | Provavelmente ≡ adesão ao cronograma (P-07) |
| 6 | Chamados abertos × encerrados (**AxF**) | 97 % | 95 % | 12 meses (há meses com **125 % e 117 %**) | "considerando todos os tipos de serviço (MC, MP, CAL, TSE)" |

Nenhum componente (numerador ou denominador) aparece no PDF-A; só resultados e séries. **Nenhuma fórmula do Advanced é comprovável numericamente.**

**Valores acima de 100 % no AxF** são evidência forte de que o indicador é **encerrados no mês ÷ abertos no mês** (fluxos do mês) e não uma coorte. Isso o classifica como **B**.

### 3.2 Requisitos da reunião para o Advanced

| Indicador | No PDF-A? | Sistema | Status |
| --- | --- | --- | --- |
| SLA | **REQUISITO DA REUNIÃO — NÃO PRESENTE NESTE PDF DE EXEMPLO** | ✓ `slaCompliance` (`sla_clocks` met/breached) | C |
| Evolução dos chamados | **REQUISITO DA REUNIÃO — NÃO PRESENTE NESTE PDF DE EXEMPLO** (o AxF é parente próximo) | ✓ `workOrderSeries` | C |
| Backlog em tempo real | **REQUISITO DA REUNIÃO — NÃO PRESENTE NESTE PDF DE EXEMPLO** | ✓ `backlog` | C |
| Obsolescência | **REQUISITO DA REUNIÃO — NÃO PRESENTE NESTE PDF DE EXEMPLO** | — | F (critério do cliente) |
| OS por situação | **REQUISITO DA REUNIÃO — NÃO PRESENTE NESTE PDF DE EXEMPLO** | ✓ `openWorkOrdersSnapshot` | C |

**Herança.** O Advanced herda o Basic de forma coerente: MTTR, MTBF, disponibilidade e adesão estão nos dois.

O PDF-A **não** traz treinamentos nem chamados realizados/solicitados. Em vez deles traz o **AxF**, que é outro indicador: abertos × encerrados.

---

## 4. Expert — Data Studio (DS) e IMR

### 4.1 Os 13 indicadores do DS

Características comuns a todas as 13 páginas:

| Característica | Valor no DS |
| --- | --- |
| Período | 01/01–31/12/2026 |
| Filtros | **Empresa**, **Setor** e **Meta** (campo digitável); nos indicadores 11–13, também **Tipo Problema Relatado** |
| Série | Mensal, de jan a out/2026 |
| Detalhamento | Tabela por setor, ou lista de OS |
| Dimensão empresa | Hospitais da rede FHEMIG e outros: HJXXIII, HIJPII, HMAL, CSSFA, MOV, IRS, HRAD, HCM |

| # | Nome (sigla) | Unidade | Meta exibida | Resultado anual | Componentes visíveis | Classe |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Tempo Médio para o Primeiro Atendimento (**TMPA**), corretiva | horas | 0 ("insira um valor") | **26,12 h** | por setor | D |
| 2 | Disponibilidade **Interna** | % | 98 % | **99,42 %** | por setor; meta × disp. × diferença | D/F |
| 3 | Disponibilidade **Externa** | % | 98 % | **99,82 %** | idem | D/F |
| 4 | Disponibilidade **Global** | % | 98 % | **98,87 %** | idem | D/F |
| 5 | **TMRG** Geral **Interno** | h | 0 | **86,48 h** | por setor (máx. 5.551,21 h) | D |
| 6 | **TMRG** Geral **Externo** | h | 0 | **44,1 h** | por setor | D |
| 7 | **TMRG** Geral **Global** | h | 72 h | **110,63 h**; a tabela mostra Int. **115,31** / Ext. **35,62** | int/ext/global por setor | D |
| 8 | Resolutividade **Crítica Interna** | h | 0 | **52,74 h** | por setor | D |
| 9 | Resolutividade **Crítica Externa** | h | 0 | **35,45 h** | por setor | D |
| 10 | Resolutividade **Crítica Global** | h | 72 h | **89,27 h**; a tabela mostra Int. **104,69** / Ext. **46,73** | int/ext/global | D |
| 11 | Chamados Realizados/Solicitados (**ICRS**) | % | 90 % | **87,09 %** | **Solicitadas 1.967, Realizadas 1.713**; pizza por tipo de problema; lista de OS com estado | **A** |
| 12 | Adesão ao Cronograma de MP (**ACM**) | % | 90 % | **97,59 %** | **"Regulares 1.741 / Atrasado 1.699"**; pizza por estado (97,2 % fechada) | **A** (rótulos ambíguos) |
| 13 | Treinamentos Realizados/Solicitados (**ITRS**) | % | — | "não há dados" | — | B |

### 4.2 O IMR (16 itens)

Estrutura: Item · Indicador · Resultado · Meta · Desconto % · Glosa R$, com o rodapé "Valor total do desconto" e "Faturamento mensal após IMR = **R$ 61.371,43**".

O cabeçalho diz **"HJXXIII AGOSTO.2026"**; o arquivo diz SETEMBRO. **Competência divergente** (P-13).

| Item | Indicador | Resultado | Meta |
| --- | --- | --- | --- |
| 1 | Tempo médio para o primeiro atendimento | 1:95h | 5h |
| 2 | Disponibilidade — Interno | 98,40 % | 98 % |
| 3 | Disponibilidade — Externo | 99,47 % | 98 % |
| 4 | Disponibilidade — Global | 98,47 % | 98 % |
| 5 | TMRG — Interno | 35:96h | 100h |
| 6 | TMRG — Externo | 45:57h | 100h |
| 7 | TMRG — Global | 17:41h | 72h |
| 8 | Crítica — Interno | 26:54h | 48h |
| 9 | Crítica — Externo | 14:07h | 48h |
| 10 | Crítica — Global | 24:22h | 48h |
| 11 | Chamados realizados/solicitados | 96,26 % | **"90h"** (unidade errada; deveria ser %) |
| 12 | Adesão às atividades propostas pela qualidade dentro do prazo | "----" | 0 |
| 13 | Adesão ao cronograma de manutenção preventiva | 100 % | 100 % |
| 14 | Treinamentos realizados/solicitados | "-" | 0 |
| 15 | Avaliação da qualidade dos serviços | "-" | 0 |
| 16 | Assiduidade nos postos de trabalho | 100 % | 95 % |

Os descontos são todos 0 e as glosas todas R$ 0,00.

### 4.3 Formato de tempo

`1:95h`, `35:96h`, `45:57h` e `26:54h` **não são h:mm válidos**: 95 e 96 minutos não existem. A leitura mais provável é **horas decimais escritas com dois-pontos** (1,95 h; 35,96 h).

O PDF-A tem o mesmo padrão: "13:49h" no texto e "13,49" no gráfico.

**Classe D** até o cliente confirmar (P-12). Afeta TMPA, TMRG, Crítica e MTTR em todos os modelos.

### 4.4 Testes Global × Interno × Externo

Se Global fosse média ponderada de Interno e Externo, o peso de Interno teria de cair entre 0 e 1. O peso é calculado como `w = (G − E) / (I − E)`.

| Fonte | Indicador | I | E | G | w (peso de I) | Leitura |
| --- | --- | --- | --- | --- | --- | --- |
| DS | Disponibilidade | 99,42 | 99,82 | 98,87 | **2,375** | **Impossível** como média; Global fica **abaixo** dos dois |
| IMR | Disponibilidade | 98,40 | 99,47 | 98,47 | 0,935 | Compatível com média ponderada |
| DS p.7 | TMRG | 115,31 | 35,62 | 110,63 | 0,941 | Compatível |
| DS p.5/p.6 vs p.7 | TMRG | 86,48 | 44,1 | 110,63 | 1,570 | **Interno diverge** entre as páginas 5 e 7 (86,48 × 115,31) |
| IMR | TMRG | 35,96 | 45,57 | 17,41 | **2,930** | **Impossível**; Global fica **abaixo** dos dois |
| DS p.10 | Crítica | 104,69 | 46,73 | 89,27 | 0,734 | Compatível |
| DS p.8/p.9 vs p.10 | Crítica | 52,74 | 35,45 | 89,27 | 3,113 | **Interno diverge** entre as páginas 8 e 10 (52,74 × 104,69) |
| IMR | Crítica | 26,54 | 14,07 | 24,22 | 0,814 | Compatível |

**Conclusão:** "Global" **não** é comprovadamente a média ponderada de Interno e Externo. Em três casos o resultado é matematicamente incompatível com isso, o que sugere **população diferente**: por exemplo, chamados sem classificação interno/externo, ou o Global computado direto sobre todos. Na amostra mensal e no anual, os totais da tabela não batem com as páginas individuais.

**Classe D**, pergunta P-05.

---

## 5. Correspondência Data Studio × IMR

| IMR | DS | Observação |
| --- | --- | --- |
| 1 Tempo médio p/ 1º atendimento | 1 TMPA | DS: anual, 26,12 h. IMR: 1:95h (mês, HJXXIII). Escopos diferentes |
| 2–4 Disponibilidade I/E/G | 2–4 | — |
| 5–7 Resolutividade geral I/E/G | 5–7 TMRG | — |
| 8–10 Resolutividade crítica I/E/G | 8–10 | O IMR diz "tempo médio de **atendimento e** resolutividade"; o título do DS também |
| 11 Chamados realizados/solicitados | 11 ICRS | IMR 96,26 % (mês), DS 87,09 % (ano, todas as empresas) |
| 13 Adesão ao cronograma de MP | 12 ACM | — |
| 14 Treinamentos realizados/solicitados | 13 ITRS | Sem dados nos dois |
| **12 Atividades propostas pela qualidade no prazo** | **— (não existe no DS)** | Dado inexistente no sistema |
| **15 Avaliação da qualidade dos serviços** | **— (não existe no DS)** | O dado existe no sistema (`service_requests.rating`) |
| **16 Assiduidade nos postos de trabalho** | **— (não existe no DS)** | Dado inexistente no sistema |

---

## 6. Matriz geral dos indicadores

Legenda: ✓ incluído · — não incluído · ? definição pendente.

**Origem** indica de onde vem a exigência:

| Código | Fonte |
| --- | --- |
| P-B | PDF-B |
| P-A | PDF-A |
| R | Reunião de 16/10 |
| DS | Data Studio |
| IMR | IMR |

| # | Indicador | BASIC | ADVANCED | EXPERT | Origem | Classe | Calculável hoje? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Chamados realizados/solicitados (ICRS) | ✓ | ? | ✓ | P-B, DS, IMR | A (pop. D) | **Sim** (pop. a confirmar) |
| 2 | Adesão ao cronograma de preventiva (ACM) | ✓ | ✓ | ✓ | P-B, P-A, R, DS, IMR | A | **Sim** |
| 3 | Conformidade de calibração | ✓ | ✓ | ? | P-B (agregado), R | B | **Sim** |
| 4 | Conformidade de TSE | ✓ | ✓ | ? | P-B (agregado), R | B | **Sim** |
| 5 | Conformidade de qualificação | ✓ | ✓ | ? | R | B | **Sim** |
| 6 | Treinamentos realizados/solicitados | ✓ | ? | ✓ | P-B, DS, IMR | B | **Sim** (tipo `training`) |
| 7 | Avaliação da qualidade | ✓ | ✓ (IAR) | ✓ (IMR 15) | P-B, P-A, IMR | B | **Sim** (`rating`) |
| 8 | Chamados abertos | ✓ | ✓ | ? | R | C | **Sim** |
| 9 | Chamados concluídos | ✓ | ✓ | ? | R | C | **Sim** |
| 10 | Abertos × encerrados (AxF) | ? | ✓ | — | P-A | B | **Sim** |
| 11 | SLA | — | ✓ | ? | R | C | **Sim** |
| 12 | Evolução dos chamados | — | ✓ | ? | R | C | **Sim** |
| 13 | Backlog | — | ✓ | ? | R | C | **Sim** |
| 14 | OS por situação | — | ✓ | ? | R | C | **Sim** |
| 15 | MTTR | ✓ | ✓ | — | P-B, P-A | D | Definição do sistema ≠ PDF-B |
| 16 | MTBF | ✓ | ✓ | — | P-B, P-A | D | Unidade e população a confirmar |
| 17 | Regularidade/performance de manutenção programada (IMP) | ? | ✓ | — | P-A | D | Se ≡ ACM: sim |
| 18 | TMPA | — | — | ✓ | DS, IMR | D | Definição do sistema não confirmada |
| 19–21 | TMRG Interno / Externo / Global | — | — | ✓ | DS, IMR | D | **Não** (interno/externo e relógio) |
| 22–24 | Resolutividade crítica I / E / G | — | — | ✓ | DS, IMR | D | **Não** ("crítica" + interno/externo) |
| 25 | Disponibilidade do parque (fotografia/tempo) | ✓ | ✓ (DPT) | — | R, P-A | F | Só fotografia; no tempo: **não** |
| 26–28 | Disponibilidade Interna / Externa / Global | — | — | ✓ | DS, IMR | F/E | **Não** |
| 29 | Atividades da qualidade no prazo | — | — | ✓ | IMR | E | **Não** (sem dado) |
| 30 | Assiduidade nos postos de trabalho | — | — | ✓ | IMR | E | **Não** (sem dado) |
| 31 | Obsolescência | — | ✓ | ? | R | F | **Não** (sem critério) |
| — | Glosa / desconto IMR | — | — | ✓ | IMR | F | **BLOQUEADO** |

**O Expert não herda o Basic por completo.** O DS e o IMR **não** trazem MTTR, MTBF, calibração, TSE nem qualificação. Trata-se de outro conjunto de indicadores, contratual (FHEMIG).

### Dashboard × PDF

| Elemento | Dashboard interativo (DS) | Relatório PDF (B/A/IMR) |
| --- | --- | --- |
| Filtros | Período, empresa, setor, meta, tipo de problema | — (competência fixa) |
| Drill-down | Tabela por setor, lista de OS com estado | Tabela por setor só no PDF-B |
| Série temporal | Mensal, ano corrente | 12 meses (PDF-A); só o mês (PDF-B) |
| Meta | Campo editável | Fixa no texto |
| Narrativa | — | Texto por indicador ("tendência positiva") e conclusão |
| Evidências | Lista de OS | Painel-imagem por indicador |
| Assinatura | — | Engenheiro(a) clínico(a) e diretor técnico |
| IMR / glosa | — | Só o Expert/IMR |

---

## 7. Fórmulas comprovadas (classe A)

| Indicador | Fórmula | Evidência | Confiança |
| --- | --- | --- | --- |
| ICRS (DS 11) | Realizadas ÷ Solicitadas × 100 | 1.713 / 1.967 = 87,0869 % → **87,09 %** (DS p.11) | Alta para a **razão**. A **população** ("solicitada" e "realizada": tipo de OS, estado "Fechada"?) não é comprovada (P-04) |
| ACM (DS 12) | 1.699 ÷ 1.741 × 100 = 97,5876 % → **97,59 %** | DS p.12 | Alta para a razão; **rótulos invertidos ou ambíguos**: o painel diz "Regulares 1.741 / Atrasado 1.699". A leitura coerente é *programadas = 1.741* e *no prazo = 1.699* (equivalente a 1 − 42/1.741). P-06 |

Um único par de números por indicador: confiança **alta, não absoluta**.

---

## 8. Fórmulas deriváveis com alta confiança (classe B)

| Indicador | Fórmula derivada | Evidência textual |
| --- | --- | --- |
| Treinamentos (ITRS) | Treinamentos realizados ÷ solicitados × 100 no período | PDF-B Ind. 5: "porcentagem de treinamentos realizados em relação aos solicitados no período"; mesma família do ICRS |
| Adesão de calibração / TSE / qualificação | Itens do cronograma realizados ÷ programados × 100, por tipo | PDF-B Ind. 4: "percentual de MP, calibrações e TSE realizadas conforme o cronograma planejado" |
| Avaliação da qualidade | Média das notas 1–5 das avaliações do período | PDF-B Ind. 6: a média 4,687 → 4,7 bate com Σ/67 (§2.3) |
| AxF | Encerrados no mês ÷ abertos no mês × 100, todos os tipos (MC, MP, CAL, TSE) | PDF-A §6: valores >100 % só são possíveis com fluxos do mês |

---

## 9. Fórmulas ambíguas (classe D)

| Indicador | Ambiguidade | Evidência |
| --- | --- | --- |
| MTTR | (a) tempo corrido abertura→conclusão, como faz o sistema; (b) horas em atendimento, ou seja, apontamento; (c) com ou sem pausas | Texto do PDF-B: "tempo em que a equipe técnica esteve em atendimento". O sistema usa `fact_work_order.resolution_minutes = completed_at − opened_at` (migration `0035`), só corretivas |
| MTBF | Unidade: minutos (sistema), meses (PDF-A), "h meses" (PDF-B). População: por ativo dentro do período (sistema) ou ano móvel | `failureIntervals` (domínio) mede minutos entre aberturas de corretivas do mesmo ativo **dentro do período**: um mês mal tem intervalo |
| IMP (PDF-A) | É a mesma coisa que ACM ou outra fórmula (a legenda diz "IAC") | PDF-A §5 |
| TMPA | Qual marco é o "primeiro atendimento" (§11) | DS 1, IMR 1 |
| TMRG I/E/G | Início e fim do relógio, pausas, "interno/externo", relação do Global | DS 5–7, IMR 5–7; §4.4 |
| Crítica I/E/G | Definição de "crítica"; "atendimento **e** resolutividade" (um tempo ou dois?) | DS 8–10, IMR 8–10 |
| Formato de tempo | `35:96h` = 35,96 h? | §4.3 |

---

## 10. Fontes de dados existentes (código real)

| Indicador | Tabela / entidade | Campo / evento | Função | Disponibilidade |
| --- | --- | --- | --- | --- |
| Chamados abertos | `fact_work_order` | `opened_at` | `metrics.workOrdersOpened` | ✓ |
| Chamados concluídos | `fact_work_order` | `completed_at`, `cancelled` | `metrics.workOrdersCompleted` | ✓ |
| ICRS | `service_requests` (status, `submitted_at`) + `work_orders` (via `from-request`) + `fact_work_order.completed_at` | — | **não existe função**; dá para compor | ✓ dado; ? população |
| Backlog | `fact_work_order` | `opened_at`, `completed_at` | `metrics.backlog` | ✓ |
| OS por situação | `work_orders` + `work_order_statuses` | situação atual | `painel.openWorkOrdersSnapshot` | ✓ |
| Evolução | `fact_work_order` | séries por fatia | `painel.workOrderSeries` | ✓ |
| MTTR (sistema) | `fact_work_order` | `resolution_minutes` (corrido) | `metrics.mttr` | ✓ (definição própria) |
| MTTR (apontado) | `time_entries` | `started_at`/`ended_at`/`minutes` por OS | `metrics.laborHours` (outro indicador) | ✓ dado |
| MTBF | `fact_work_order` | `asset_id`, `opened_at` (corretivas) | `metrics.mtbf` | ✓ (definição própria) |
| SLA | `sla_clocks` (`response`, `onsite`, `resolution`), `sla_pauses`, `sla_targets` (`business_hours_only`) | met/breached | `metrics.slaCompliance` | ✓ |
| Adesão preventiva/cal./TSE/qualif. | `plan_cycle_items` (`due_at`, `status` done/skipped) + tipo do plano | — | `metrics.planCompliance`, `plan-board.byKind` (done/pending/late/skipped) | ✓ |
| Treinamentos | `service_requests.requested_type = 'training'`; catálogo `work_order_type` com `training` | — | **não existe função** | ✓ dado (desde `0064`) |
| Avaliação | `service_requests.rating` (1–5), `rating_comment` | — | **não existe função** | ✓ dado (portal "avaliar atendimento") |
| TMPA (sistema) | `service_requests.first_response_at` (gatilho: 1ª entrada em `triage`, `0019`/`0023`) | `service_request_status_history` | `metrics.firstResponseTime` = submissão → triagem | ✓ (definição própria) |
| Disponibilidade (fotografia) | `assets.status` (`active`, `under_maintenance`, `standby`, `loaned`, `decommissioned`, `disposed`) | — | `painel.parkSnapshot` | ✓ só o "agora" |
| Disponibilidade (no tempo) | evento `asset.status_changed` em `domain_events`; motivos de espera da OS | — | **não existe** | Parcial: dá para reconstruir o histórico de status, mas "parado" está indefinido |
| Interno × externo | motivos de espera `external_service` ("Em serviço externo") e `external_quote` (`domain/work-orders.ts`) | — | **não existe** | Parcial: marca **espera**, não classifica a OS |
| "Crítica" | `service_requests.priority` (`emergency`, `very_urgent`, `urgent`, `low`, `none`) **ou** `criticality_levels` do ativo | — | **não existe** | Parcial: duas fontes candidatas |
| Obsolescência | `asset_models.default_useful_life_years`, `assets.warranty_until` | — | **não existe** | Parcial |
| Glosa | `contracts.penalty_percent_per_breach`, `penalty_cap_percent`, `monthly_value`; `domain/contracts.penaltyForBreaches` | — | Glosa **por SLA violado**, nunca aplicada sozinha | ≠ IMR |

---

## 11. "Primeiro atendimento": marcos possíveis

| Candidato | Onde está | Observação |
| --- | --- | --- |
| Submissão da solicitação | `service_requests.submitted_at` | Início natural do relógio |
| **Triagem** | `service_requests.first_response_at` (gatilho) / `status_history.to_status='triage'` | **É o que o sistema usa hoje** (`firstResponseTime`) |
| Aceite / geração da OS | `work_orders.created_at` / `opened_at`; evento `work_order.created` | — |
| Primeira atribuição | `work_orders.assignee_membership_id` + auditoria (`audit_logs`) | Sem timestamp próprio; só pela trilha |
| Check-in no local | `work_order_visits` (`kind='check_in'`, `occurred_at`) — desde `0065` | Só existe para OS executadas pelo assistente |
| Início da execução | `work_orders.started_at`; primeiro `time_entries.started_at` | — |
| SLA de resposta / no local | `sla_clocks.kind = 'response'` / `'onsite'` | Relógio com calendário e pausas |

**Ambiguidade:** cada marco dá um número diferente. O DS diz "manutenção corretiva" e "horas trabalhadas", o que sugere horário útil. **Pergunta P-03.**

---

## 12. Dados faltantes

| Dado | Para quê | Existe? |
| --- | --- | --- |
| Classificação **interno × externo** da OS/atendimento | Disponibilidade I/E, TMRG I/E, Crítica I/E | Parcial (motivo de espera) |
| **Registro de parada do equipamento** (início e fim do "parado") | Disponibilidade no tempo | Parcial (`asset.status_changed`); a definição falta |
| Definição de **"crítica"** | Resolutividade crítica | Parcial (prioridade × criticidade) |
| **Atividades propostas pela qualidade** (prazo, conclusão) | IMR 12 | **Não** |
| **Assiduidade nos postos** (escala, presença) | IMR 16 | **Não** |
| **Educação continuada / treinamento** com "solicitado" e "realizado" distintos | ITRS | Parcial (tipo `training`; falta o vínculo solicitado→realizado) |
| **Equipamento enviado externamente / retorno** | Disp. externa, TMRG externo | Parcial (`external_service` como espera) |
| **Centro de custo** do cliente (ex.: HCSL020) | Cabeçalho do PDF-A | Não verificado como campo |
| **Metas por indicador e por contrato** | Todos | **Não** (§13) |
| **Faixas de desconto do IMR** | Glosa | **Não** (§14) |

Nenhum desses campos foi criado; o mapeamento é só para a próxima rodada.

---

## 13. Metas e configuração contratual

- **Fórmula ≠ meta.** As metas variam por cliente e pelo mesmo indicador:

| Indicador | Meta PDF-B | Meta PDF-A | Meta DS | Meta IMR |
| --- | --- | --- | --- | --- |
| MTTR | 72 h | 72 h | — | — |
| Disponibilidade | — | **92 %** | **98 %** | **98 %** |
| Adesão | **100 %** | **96 %** | **90 %** | **100 %** |
| ICRS | — | — | **90 %** | **90** ("h") |

- **O sistema hoje** tem metas de SLA por política (`sla_targets`) e por contrato (`contract_sla_overrides`), mas **não tem** tabela de meta por indicador × organização × cliente × contrato × vigência. As metas de relatório **não estão hardcoded**: `report-tiers.ts` não tem meta nenhuma.
- **Necessidade futura (não criada):** configuração `indicador × escopo (organização/cliente/contrato) × vigência × meta × sentido (≥ ou ≤) × unidade`.

---

## 14. Glosa / IMR

| Elemento | Evidência no IMR | Status |
| --- | --- | --- |
| Tabela de faixas (resultado → desconto %) | **Ausente**: todos os descontos são 0 | **BLOQUEADO — CLIENTE** |
| Percentual por indicador | Ausente | BLOQUEADO |
| Peso por indicador | Ausente | BLOQUEADO |
| Regra cumulativa (soma, máximo, por bloco) | Ausente; o layout agrupa I/E/G em blocos com uma só célula de desconto | BLOQUEADO |
| Teto | Ausente | BLOQUEADO |
| Valor base | Só o resultado: "Faturamento após IMR R$ 61.371,43" (base = valor mensal?) | BLOQUEADO |
| Arredondamento | Ausente | BLOQUEADO |
| Exceções (sem dados "----"/"-", meta 0) | Itens 12, 14 e 15 sem resultado e com meta 0 | BLOQUEADO |

A glosa existente no sistema (`penaltyForBreaches`) é **por SLA violado**, com percentual e teto **configurados por contrato**. É outra regra, e não serve como IMR. **Não se deriva regra de glosa de um exemplo com tudo zerado.**

---

## 15. Perguntas objetivas para o Anderson

Só as que bloqueiam cálculo.

**P-01 — MTTR (Basic e Advanced).**

- **Motivo:** o PDF-B define MTTR como "tempo em que a equipe técnica esteve em atendimento"; o sistema mede o tempo corrido entre a abertura e a conclusão da OS corretiva.
- **Decisão:** o MTTR é **(a)** o tempo corrido abertura→conclusão, **(b)** a soma das horas apontadas pelos técnicos na OS, ou **(c)** o tempo corrido descontando pausas (aguardando peça ou aprovação)?

**P-02 — MTBF.**

- **Motivo:** a unidade e a janela variam entre os documentos.
- **Decisão:** o MTBF é expresso em **meses** (como no PDF-A), e o intervalo entre falhas de um equipamento conta corretivas de **toda a vida do equipamento** ou só da **janela do relatório**? Qual é a unidade correta em "1,76 h meses" (PDF-B)?

**P-03 — TMPA.**

- **Motivo:** existem cinco marcos candidatos para o fim do relógio.
- **Decisão:** o "primeiro atendimento" termina na **triagem** da solicitação, na **geração da OS**, na **primeira atribuição a um técnico**, no **check-in no local** ou no **início da execução**? O relógio conta **horas corridas** ou **horas úteis** do calendário do contrato?

**P-04 — ICRS (realizados/solicitados).**

- **Motivo:** população indefinida.
- **Decisão:** "solicitado" é toda OS aberta no período (qualquer tipo) ou só a **corretiva**? "Realizado" é OS com estado **Fechada** no período ou também "concluída aguardando validação"? A OS aberta no mês e fechada no mês seguinte conta em qual competência?

**P-05 — Global (Disponibilidade, TMRG e Crítica).**

- **Motivo:** em três casos o Global fica fora do intervalo entre Interno e Externo (§4.4).
- **Decisão:** o Global é calculado **sobre todos os chamados e equipamentos**, inclusive os que não são nem internos nem externos? Ou é a média ponderada de Interno e Externo pelo número de chamados?

**P-06 — ACM.**

- **Motivo:** o DS rotula 1.741 como "Regulares" e 1.699 como "Atrasado".
- **Decisão:** confirmar que **1.741 = programadas** e **1.699 = executadas no prazo**. Uma preventiva executada **com atraso** dentro do mês conta como realizada?

**P-07 — IMP (Advanced).**

- **Motivo:** o PDF-A chama de "Regularidade dos planos" / "Performance de manutenção programada" e a legenda diz "IAC".
- **Decisão:** é exatamente o mesmo cálculo do ACM (programadas no prazo ÷ programadas), incluindo calibração e TSE?

**P-08 — Interno × Externo.**

- **Motivo:** o sistema só marca "Em serviço externo" como **espera** da OS.
- **Decisão:** um atendimento é "externo" quando o equipamento **sai para fornecedor/terceiro** (OS com envio externo), ou quando o atendimento é feito **fora da unidade**? Uma OS com uma parte interna e uma externa conta em qual?

**P-09 — Disponibilidade ("parado").**

- **Motivo:** a definição de "parado" segue pendente desde a reunião.
- **Decisão:** um equipamento está **indisponível** em quais situações? (a) "em manutenção" (OS corretiva aberta); (b) aguardando peça; (c) em serviço externo; (d) reserva/standby; (e) emprestado. O denominador é horas do período × equipamentos **ativos** ou × equipamentos **cadastrados**?

**P-10 — Escopo do Basic.**

- **Motivo:** a reunião e o PDF-B divergem (§2.2).
- **Decisão:** o Basic inclui **Treinamentos realizados/solicitados** e **Avaliação da qualidade** (estão no PDF-B e não na reunião)? E **Disponibilidade** e **Qualificação** (estão na reunião e não no PDF-B)? A adesão é **um índice agregado** (MP+CAL+TSE, como no PDF-B) ou **um por tipo**?

**P-11 — "Crítica".**

- **Motivo:** existem duas fontes candidatas.
- **Decisão:** uma solicitação é crítica pela **prioridade do chamado** (emergência ou muito urgente) ou pela **criticidade do equipamento** (ex.: suporte à vida)? "Atendimento **e** resolutividade" é **um** tempo (abertura → solução) ou a soma ou média de dois?

**P-12 — Formato de tempo.**

- **Motivo:** formatos como "35:96h" aparecem no IMR, no DS e no PDF-A.
- **Decisão:** "35:96h" no IMR (e "13:49h" × "13,49" no PDF-A) são **horas decimais** (35,96 h)? O PDF final deve exibir **h:mm** ou **decimal**?

**P-13 — Competência do IMR.**

- **Motivo:** o cabeçalho e o nome do arquivo divergem.
- **Decisão:** o IMR de exemplo é de **agosto** (cabeçalho) ou **setembro** (arquivo)?

**P-14 — Glosa do IMR.**

- **Motivo:** o exemplo tem tudo zerado.
- **Decisão:** fornecer a **tabela contratual de faixas**: resultado × desconto % por indicador, peso, regra cumulativa entre indicadores, teto, valor base (o faturamento mensal do contrato?), arredondamento e tratamento de "sem dados".

**P-15 — Itens 12 e 16 do IMR.**

- **Motivo:** o sistema não tem esses dados.
- **Decisão:** o que é uma "atividade proposta pela qualidade" (quem cria, qual prazo, o que a conclui) e como se mede a "assiduidade nos postos" (escala prevista × presença registrada)? De qual sistema vêm hoje?

**P-16 — Obsolescência (Advanced).**

- **Motivo:** não há critério definido.
- **Decisão:** um equipamento é obsoleto por **idade × vida útil do modelo**, por **fim de suporte do fabricante**, por **custo acumulado de manutenção** ou por avaliação técnica?

---

## 16. Plano recomendado de implementação

Implementar só depois das respostas.

1. **Sem depender de resposta.** Expor como indicadores os dados que já existem:
   - Avaliação (média de `rating`);
   - Treinamentos (tipo `training`);
   - AxF (encerrados ÷ abertos);
   - ICRS e ACM com a definição do DS, rotulados como "definição provisória".

   Tudo isso entra na fundação já publicada (`report-tiers.ts`), marcado como B ou C.
2. **Configuração de meta** por `indicador × organização/cliente/contrato × vigência`, sem meta global hardcoded.
3. Depois de **P-01, P-02 e P-12**: ajustar MTTR, MTBF e o formato de tempo nos três modelos.
4. Depois de **P-03, P-08 e P-11**: TMPA, TMRG I/E/G e Crítica I/E/G. Isso exige classificar a OS como interna/externa (dado novo).
5. Depois de **P-09 e P-05**: disponibilidade no tempo, a partir do histórico `asset.status_changed` e dos motivos de espera.
6. Depois de **P-15**: modelar atividades da qualidade e assiduidade (dados novos).
7. Depois de **P-14**: IMR com glosa (cálculo registrado, aplicação humana, como já faz `penaltyForBreaches`).
8. Por fim, o layout dos três PDFs sobre os documentos oficiais, com a narrativa e as assinaturas.

**Contagens desta auditoria**

| Medida | Total |
| --- | --- |
| Basic | 12 indicadores |
| Advanced | 11 indicadores próprios (+ Basic herdado) |
| Expert | 16 indicadores (DS 13 ⊂ IMR 16) |
| Únicos | 31 |
| A (comprovadas) | 2 |
| B (deriváveis) | 6 |
| C (já implementadas) | 6 |
| D (ambíguas) | 10 |
| E/F (dado ou definição faltando) | 7 |
| Calculáveis hoje | 14 |
| Exigem dado novo | 7 |
| Perguntas para o Anderson | 16 |

---

## 17. IMPLEMENTAÇÃO FASE 1 (17/10/2026)

> As conclusões das seções 1 a 16 **não foram alteradas**. Esta seção registra só o que foi construído
> depois, com o que a auditoria permitia construir sem esperar as respostas do Anderson (§15). Nada
> aqui fecha fórmula ambígua: o que dependia de P-01…P-16 continua pendente.

### 17.1 O que existe agora

| Item | Onde | Situação |
| --- | --- | --- |
| **Catálogo central de indicadores** (código estável, nome, descrição, unidade, categoria, modelos permitidos, situação, sentido da meta, fonte de cálculo) | `packages/domain/src/report-tiers.ts` (evoluído; não há segundo arquivo) | PASS |
| Situações `ACTIVE` · `PROVISIONAL` · `PENDING_DEFINITION` | idem | PASS |
| **Metas configuráveis** (indicador × organização × cliente × contrato × vigência × valor × unidade × sentido) | migration `0069_metas_de_indicadores.sql`, `packages/db/src/indicator-targets.ts`, `apps/api/src/insights/indicator-targets.controller.ts`, funções puras em `packages/domain/src/indicator-targets.ts` | PASS |
| **Avaliação da qualidade** (média, quantidade, distribuição 1–5) | `metrics.serviceRating` | PASS |
| **Chamados Abertos x Encerrados** (AxF), com numerador e denominador | `metrics.openedVsClosed` | PASS |
| Razão percentual genérica (`ratioPercent`) | `packages/domain/src/indicator-targets.ts` | PASS (sem população atribuída) |
| Relatório lê o catálogo e as metas | `packages/db/src/relatorios.ts`, `reports.controller.ts` | PASS |
| Fluxo "Gerar relatório": modelo → período → cliente (→ contrato) → indicadores | `apps/web/src/features/painel/relatorio.tsx` | PASS |
| Tela **Configurações › Metas** (leitura para todos; edição com `insight.manage_targets`) | `apps/web/src/features/configuracoes/metas.tsx`, rota `/configuracoes/metas` | PASS |
| Permissão nova `insight.manage_targets` (owner, admin, gestor de manutenção, gestor) | `packages/domain/src/permissions.ts`, migration `0069` | PASS |

### 17.2 Classificação final dos indicadores

| Código | Modelos | Situação | Por quê |
| --- | --- | --- | --- |
| `work_orders_opened`, `work_orders_completed` | Basic, Advanced | **ACTIVE** | Contagens do Painel |
| `opened_vs_closed` (AxF) | Advanced | **ACTIVE** | Classe B: encerradas no período ÷ abertas no período × 100; valores de 117 % e 125 % do PDF Advanced só são possíveis com fluxos. Reutiliza as duas contagens do Painel |
| `work_order_evolution`, `backlog`, `work_orders_by_status`, `preventive_vs_corrective`, `sla_compliance` | Advanced | **ACTIVE** | Funções do Painel, já testadas |
| `compliance_calibration`, `compliance_electrical_safety`, `compliance_qualification` | Basic, Advanced | **ACTIVE** | Definição do sistema, exigidas separadas na reunião; **não agregadas** (P-10) |
| `compliance_preventive` (ACM) | Basic, Advanced, Expert | **PROVISIONAL** | Razão comprovada (97,59 %), mas falta confirmar se preventiva com atraso conta como realizada (P-06, P-07) |
| `service_rating` | Basic, Advanced, Expert | **ACTIVE** | Classe B; a média 4,687 ≈ 4,7 bate com a soma das notas. A inconsistência 64 × 67 do PDF Basic não é reproduzida: média, quantidade e distribuição saem da mesma lista |
| `mttr`, `mtbf` | Basic, Advanced | **PROVISIONAL** | O sistema calcula (tempo corrido; minutos), mas a definição do cliente é outra ou ambígua (P-01, P-02, P-12). **Nenhum cálculo novo** |
| `park_availability_snapshot` | Basic, Advanced | **PROVISIONAL** | Fotografia de agora; disponibilidade no tempo aguarda P-09 |
| `requests_fulfilled_ratio` (ICRS) | Basic, Expert | **PENDING_DEFINITION** | A razão está provada, a **população não** (P-04). Só a calculadora genérica existe; nenhum registro foi mapeado |
| `training_ratio` (ITRS) | Basic, Expert | **PENDING_DEFINITION / DATA_MODEL** | Ver 17.4 |
| `obsolescence` | Advanced | **PENDING_DEFINITION** | P-16 |
| `first_response_time` (TMPA), `availability_*`, `tmrg_*`, `critical_resolution_*` (I/E/G), `quality_activities_on_time`, `attendance`, `imr_penalty` | Expert | **PENDING_DEFINITION** | P-03, P-05, P-08, P-09, P-11, P-14, P-15. Estrutura dos 16 itens do IMR registrada; **sem fórmula, sem número, sem desconto** |

**O Expert não herda o Basic nem o Advanced.** `tiers` é uma lista explícita por indicador. Os únicos
reportáveis hoje no Expert são `service_rating` (ACTIVE) e `compliance_preventive` (PROVISIONAL).

### 17.3 Regras de entrada no relatório

- Sem seleção explícita: **só `ACTIVE`**.
- `PROVISIONAL`: só com pedido explícito; sai marcado (`state`, "Provisório", e "(PROVISÓRIO)" no PDF).
- `PENDING_DEFINITION`: **nunca entra**. Pedi-lo é 422. A resposta lista o que ficou de fora em `pending`,
  com o motivo — sem número.
- Todo indicador reportável precisa ter cálculo ligado; um teste percorre o catálogo dos três modelos e
  falha se algum não tiver.

### 17.4 Treinamentos (ITRS): por que ficou `PENDING_DEFINITION / DATA_MODEL`

Existe `service_requests.requested_type = 'training'` e `work_orders.service_request_id`, mas **não há
vínculo inequívoco solicitado → realizado**:

1. a solicitação de treinamento pode gerar OS de **qualquer tipo** (`POST /work-orders/from-request/:id` não
   força `work_order_type = training`), e a OS do tipo treinamento não aponta para o treinamento pedido;
2. não há critério de "realizado" (OS concluída? solicitação `fulfilled`? lista de presença?);
3. não há entidade de educação continuada (turma, participantes, carga horária).

Falta, para implementar: definir o critério de "realizado" com o cliente e **ou** forçar o tipo da OS gerada
de uma solicitação `training` **ou** criar a entidade de treinamento. Nada foi inferido.

### 17.5 Metas

- **Escopos e precedência:** contrato → cliente → organização. A mais específica **em vigor** vence.
  Meta de outro cliente nunca vaza para este contexto.
- **Vigência** em dias, inclusive nas pontas; `valid_to` nulo = aberta. Duas metas do mesmo escopo e do mesmo
  indicador **não se sobrepõem** (gatilho + trava consultiva; 409). Vigência futura convive com a atual.
- **Dia de referência no relatório:** o último dia do período, sem passar de hoje. Um relatório de março de
  2020 usa a meta que valia em março de 2020.
- **Sem meta:** `target = null` e `target_label = "SEM META CONFIGURADA"` — nunca zero. Indicador
  informativo (`INFORMATIONAL`) não tem meta e não mostra o rótulo.
- **Sentido e unidade** são do indicador (catálogo): configurar `≤` para uma disponibilidade, ou minutos para
  um percentual, é 422. A API aceita `unit` só para conferir.
- **Quem faz o quê:** `insight.read` lê; `insight.manage_targets` escreve. A meta da **organização inteira**
  exige vínculo com escopo sobre todos os clientes; quem vê só o Hospital A configura a meta do Hospital A e
  recebe 404 para o B. Backend é a autoridade; a tela só esconde os botões.
- **Arquivar, não apagar:** `deleted_at`; o papel da aplicação não tem `DELETE`. A trilha de auditoria
  (`fn_audit`) registra criação, alteração e arquivamento.
- **`contract_id` no relatório escolhe a META do contrato.** O recorte dos números segue cliente/setor: não
  existe ainda filtro de métrica por cobertura de contrato.
- **Metas pré-existentes no contrato** (`contracts.sla_target_percent`, `plan_target_percent`, usadas pela
  medição contratual) **não foram migradas nem ligadas** a esta tabela: converter por suposição está fora do
  escopo. Unificar é decisão futura.
- **Reaproveitamento:** `resolveTarget`, `evaluateTarget` e `loadVisibleTargets` são as mesmas para o Painel, o
  relatório e a automação. O Painel não foi redesenhado nesta rodada.

### 17.6 Correção declarada

O relatório rotulava o MTBF em **horas**, mas `metrics.mtbf` devolve **minutos** (a definição de domínio
sempre disse minutos). O catálogo e a seção agora declaram `minutes`. Nenhuma fórmula mudou.

### 17.7 Segurança e evidência

- RLS `FORCE` em `indicator_targets`; FKs compostas por `organization_id`; gatilho confere que o contrato é do
  cliente da meta mesmo com escrita direta na tabela.
- Testes adversariais: B não lê, não altera, não arquiva e não grava em nome de A; FK composta recusa cliente
  de A; `DELETE` negado ao papel da aplicação; meta de B não entra na resolução de A.
- Testes: `report-catalog.test.ts` (domínio, 36), `indicator-targets.test.ts` (banco, 16), `metrics.test.ts`
  (+9: avaliação e AxF <100 / =100 / >100 / sem dado), `api-relatorios.test.ts` (12), `api-metas-indicadores.test.ts`
  (21: organização, override de cliente e de contrato, vigência, sem meta, gestor × operador × solicitante ×
  vínculo restrito, isolamento entre organizações, PDF).

### 17.8 Continua bloqueado aguardando o Anderson

P-01 (MTTR) · P-02 (MTBF) · P-03 (TMPA) · P-04 (população do ICRS) · P-05 (Global) · P-08 (interno × externo) ·
P-09 (disponibilidade) · P-10 (escopo do Basic e agregação) · P-11 (crítica) · P-12 (formato dos tempos) ·
P-14 (glosa/IMR) · P-15 (atividades da qualidade e assiduidade) · P-16 (obsolescência). O layout final dos
três PDFs e a assinatura continuam em rodada posterior.

## 18. Pente-fino de 17/10/2026 (estado atual)

> Histórico acima preservado. Esta seção registra o que o pente-fino conferiu e corrigiu — detalhe e evidência em
> `docs/AUDITORIA-PENTE-FINO-2026-10-17.md` §6.

**Estado:** catálogo funcional · metas funcionais · avaliação (rating) funcional · AxF funcional · ICRS
PENDING_DEFINITION · ACM PROVISIONAL · treinamentos pendentes. Nenhuma fórmula pendente foi definida.

**Corrigido (sem mudar fórmula):**

- **Definição impressa das conformidades** (preventiva, calibração, TSE, qualificação): dizia "realizados **no
  prazo**", mas a conta inclui o item feito com atraso — e "o atraso conta?" é a pergunta aberta **P-06/P-07**. O PDF
  passou a descrever o que a conta faz ("itens de plano realizados ÷ (programados − dispensados)"); a nota de TSE diz
  que o atraso conta como realizado enquanto P-06/P-07 estiverem abertas.
- **Disponibilidade do parque:** relatório e Painel usavam bases diferentes (o relatório incluía baixados e
  descartados). O relatório adotou a base do Painel; o indicador continua PROVISIONAL (**P-09**).
- **Painel/TV:** MTTR e MTBF agora dizem "Provisório" (P-01, P-02); "Preventivas vencidas/em dia" passaram a "Itens de
  plano vencidos"/"Planos em dia", porque o quadro soma todos os tipos de plano.
- **Relatório:** setor de outro cliente ou fora do escopo é recusado; data impossível devolve 422.
- **Automações:** duas ações "criar tarefa" na mesma regra são recusadas ao salvar; relatório agendado que não chega a
  ninguém é registrado como falha.

**Conferido e mantido (VALIDADO):** precedência contrato → cliente → organização; vigência inclusiva nas duas pontas;
sobreposição barrada; futura/expirada/ausente corretas ("SEM META CONFIGURADA", nunca zero); isolamento entre
organizações; PENDING_DEFINITION nunca entra; PROVISIONAL só com pedido explícito e marcado; Advanced contém o Basic
seguro; Expert não herda o Basic; nenhuma meta fixa em relatório; e-mail só em fila.

**Decisões que dependem do cliente (não inventadas):** vínculo restrito a um cliente, sem escolher cliente, é medido
contra a meta da organização (comportamento atual fixado em teste); relatório mensal agendado usa "slot − N dias", e
não o mês civil; as cores do Painel usam limiares fixos, e não as metas configuradas (próxima rodada).

**Continua bloqueado aguardando o Anderson:** P-01 · P-02 · P-03 · P-04 · P-05 · P-06 · P-07 · P-08 · P-09 · P-10 ·
P-11 · P-12 · P-13 · P-14 · P-15 · P-16.
