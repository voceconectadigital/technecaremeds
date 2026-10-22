# Validação: relatórios Completo e Expert (PDFs de setembro/2026) e transcrição × sistema

**Data:** 22/10/2026 · **Código conferido:** `main` (depois do PR #39) · **Método:** li os dois PDFs oficiais com `pdftotext`, abri o código que gera o relatório (`packages/db/src/relatorios.ts`, `apps/api/src/insights/reports.controller.ts`, `packages/domain/src/report-tiers.ts`, `apps/api/src/documents/pdf.ts`) e comparei item a item. Não gerei um relatório no navegador para comparar visualmente.

**Fontes**
- `COMPLETO - Relatorio Técnico de Atividades TéchneCare SETEMBRO 2026.pdf` (Complexo Hospitalar Samuel Libânio): 6 indicadores, gráficos de 12 meses, texto, assinaturas.
- `Expert - HJXXIII-IMR-SETEMBRO-26.pdf` (Instrumento de Medição de Resultados): 16 itens, desconto (%), glosa (R$), faturamento.
- O PDF **Básico** (Lagoa Santa) **não veio anexado desta vez**. A comparação do Básico segue a auditoria de 17/10 (`AUDITORIA-INDICADORES-BASIC-ADVANCED-EXPERT.md`), não os arquivos.

> **Atualização de 22/10/2026:** o layout oficial do Completo e a casca do IMR foram construídos depois desta validação (seção 5). As tabelas das seções 1 a 4 descrevem o estado **antes** dessa entrega.

## Resposta curta

| Pergunta | Resposta |
| --- | --- |
| Tudo da **transcrição** foi feito? | **Quase.** 34 de 39 itens feitos, 2 parciais, 3 dependem de decisão externa (senha inicial, provedor de e-mail, domínio/deploy). Detalhe em `VALIDACAO-REUNIAO-2026-10-16.md`. Depois dele, os pedidos do WhatsApp de 21/10 foram feitos (PRs #36–#39). |
| O **relatório Completo** (Advanced) está igual ao PDF oficial? | **Não.** Os números principais existem, mas o PDF que o sistema gera é provisório e não tem gráficos de 12 meses, linha de meta desenhada, texto explicativo, cabeçalho do hospital nem assinaturas. |
| O **relatório Expert** (IMR) foi feito? | **Não.** 2 dos 16 itens têm número; desconto, glosa e faturamento não são calculados. Falta o cliente definir as regras. |
| O **Básico**? | Os indicadores existem; o layout oficial não está feito (mesma limitação do Completo). Não pude conferir contra o PDF, que não veio. |

## 1. Relatório Completo (Advanced) × PDF do Samuel Libânio

O PDF oficial tem um **cabeçalho** (cliente, centro de custo, competência, local e data), um **parágrafo de abertura**, **seis seções** (cada uma com texto, valor do mês, meta e gráfico de 12 meses com linha de meta) e **duas assinaturas**.

| # | Seção do PDF | Valor no PDF | Indicador no sistema | Situação | O que falta |
| --- | --- | --- | --- | --- | --- |
| 1 | IAR, avaliação do atendimento | 4,6 (meta ≥ 3) | `service_rating` (ACTIVE) | **Número feito** | Série de 12 meses, gráfico, texto "subiu em relação ao mês anterior". |
| 2 | DPT, disponibilidade do parque | 98 % (meta 92 %) | `park_availability_snapshot` (PROVISIONAL) | **Parcial** | O sistema mede a **situação de agora** (em operação ÷ em uso), não a disponibilidade em horas ao longo do mês, que é o que o gráfico do PDF (eixo "HORAS") indica. Definição em aberto (P-09). |
| 3 | MTTR | 13:49h (meta ≤ 72h) | `mttr` (PROVISIONAL) | **Parcial** | O sistema calcula em minutos, em tempo corrido. A definição do cliente (tempo corrido × tempo em atendimento) e o formato `h:mm` não estão confirmados (P-01, P-02, P-12). O próprio PDF mistura "13:49h" no texto com 13,49 no gráfico. |
| 4 | MTBF | 5,10 meses (meta ≥ 3) | `mtbf` (PROVISIONAL) | **Parcial** | Mesmo problema de definição; o PDF usa meses, o sistema usa minutos. |
| 5 | IMP, regularidade dos planos | 100 % (meta ≥ 96 %) | `compliance_preventive` (PROVISIONAL) | **Parcial** | Falta confirmar se preventiva feita com atraso conta como realizada (P-06, P-07). O título do gráfico do PDF diz "IMP" e a legenda diz "IAC": o próprio cliente está inconsistente. |
| 6 | AxF, chamados abertos × encerrados | 97 % (meta ≥ 95 %) | `opened_vs_closed` (ACTIVE) | **Número feito** | Série de 12 meses e gráfico. O PDF avisa que conta MC, MP, CAL e TSE; o sistema usa todas as OS. |

**Elementos do documento**

| Elemento do PDF | No sistema |
| --- | --- |
| Cabeçalho com cliente, centro de custo (HCSL020), competência, cidade/data | **Não feito.** O PDF atual traz só "Período", "Cliente" e "Gerado em". O centro de custo não existe como campo. |
| Texto de abertura do contrato | **Não feito.** |
| Texto de cada seção com valor, meta e conclusão ("se manteve acima da meta") | **Parcial.** O PDF imprime "Meta ≥ X — cumprida / não cumprida", sem a frase narrativa. |
| Gráfico de 12 meses com linha de meta | **Não feito.** O escritor de PDF (`apps/api/src/documents/pdf.ts`) é só de texto e não desenha imagem nem gráfico. Existe série por período na API (`work_order_evolution`), mas não série mensal por indicador. |
| Meta como linha configurável | **Feito na regra** (metas por cliente/contrato/vigência, migration 0069); **não desenhada**. |
| Assinaturas (coordenadora e diretor técnico) | **Não feito.** |
| Faixa e rodapé | O PDF atual sai com a faixa "AGUARDANDO MODELO PDF OFICIAL" em toda página. |

**Conclusão do Completo:** a regra de metas e os seis números têm base, mas nenhum está igual ao PDF do cliente (três por definição em aberto), e o documento oficial (série de 12 meses, gráficos, texto, assinaturas) não foi construído. Agora que o PDF oficial chegou, o layout é construível; as definições de MTTR, MTBF, DPT e IMP continuam dependendo do cliente.

## 2. Relatório Expert (IMR do HJXXIII) × sistema

| Item | Indicador no PDF | Resultado / meta no PDF | Sistema | Situação |
| --- | --- | --- | --- | --- |
| 1 | Tempo médio para o primeiro atendimento | 1:95h · 5h | `first_response_time` | **Pendente.** Não há marco de "primeiro atendimento" definido (P-03). Note que "1:95h" não é uma hora válida. |
| 2–4 | Disponibilidade do parque, interno, externo, global | 98,40 % / 99,47 % / 98,47 % · 98 % | `park_availability_snapshot` (só global, de agora) | **Pendente.** Falta definir "interno" e "externo" e a disponibilidade no tempo (P-09). |
| 5–7 | Tempo médio de resolutividade, geral, I/E/G | 35:96h / 45:57h / 17:41h · 100h e 72h | `mttr` (provisório) | **Pendente.** As metas de 100h (interno/externo) e 72h (global) diferem; "35:96h" também não é hora válida. |
| 8–10 | Atendimento e resolutividade das críticas, I/E/G | 26:54h / 14:07h / 24:22h · 48h | sem cálculo | **Pendente.** Falta definir "solicitação crítica" (P-05/P-08). |
| 11 | Chamados realizados / solicitados | 96,26 % · "90h" | `requests_fulfilled_ratio` | **Pendente** (população da razão, P-04). A meta "90h" para um percentual é provável erro de digitação do cliente. |
| 12 | Adesão às atividades da qualidade no prazo | "----" | `quality_activities_on_time` | **Pendente.** Não há "atividade proposta pela qualidade" com prazo no modelo de dados; o módulo Qualidade (PR #38) guarda certificados, não atividades. |
| 13 | Adesão ao cronograma de manutenção preventiva | 100 % · 100 % | `compliance_preventive` (PROVISIONAL) | **Número existe, provisório** (P-06/P-07). |
| 14 | Treinamentos realizados / solicitados | "-" | `training_ratio` | **Pendente.** O PR #38 guarda certificado de treinamento, mas não há "treinamento solicitado" para formar a razão. |
| 15 | Avaliação da qualidade dos serviços | "-" | `service_rating` (ACTIVE) | **Feito.** |
| 16 | Assiduidade nos postos de trabalho | 100 % · 95 % | `attendance` | **Pendente.** O sistema não registra ponto/presença dos técnicos. |
| — | Desconto (%) por item | 0 em todas as linhas | `imr_penalty` | **Não feito, e sem como inferir:** o PDF de exemplo tem 0 em tudo, então não mostra faixas nem pesos. |
| — | Glosa (R$), valor total do desconto | R$ 0,00 | — | **Não feito**, pelo mesmo motivo. |
| — | Faturamento mensal após o IMR | R$ 61.371,43 | — | **Não feito.** O sistema não tem o valor do contrato mensal ligado ao relatório. |

**Conclusão do Expert:** 1 item pronto (15), 1 provisório (13) e 14 pendentes. A estrutura dos 16 itens está registrada no catálogo e o sistema se recusa a imprimir número sem definição (pedir um indicador pendente devolve 422). Isso é deliberado: inventar fórmula de glosa num documento que desconta valor do faturamento seria pior do que não entregar.

## 3. O que é decisão do cliente (e já tem pergunta pronta)

As perguntas P-01 a P-16 estão em `AUDITORIA-INDICADORES-BASIC-ADVANCED-EXPERT.md`. As que mais travam estes dois PDFs:
1. MTTR e MTBF: tempo corrido ou tempo em atendimento? Em horas `h:mm`? MTBF em meses?
2. Disponibilidade (DPT): em horas ao longo do mês, ou foto do parque?
3. IMP: preventiva feita com atraso conta como realizada?
4. "Interno" e "externo": o que separa os dois (equipe própria × terceirizada, ou local do equipamento)?
5. "Solicitação crítica": qual critério?
6. IMR: faixas, pesos e fórmula do desconto e da glosa; origem do valor de faturamento.
7. Valores inválidos no PDF de exemplo (1:95h, 35:96h, meta 90h num percentual): são erros de digitação?

## 4. O que dá para fazer agora, sem inventar regra do cliente

1. **Layout oficial do Completo:** cabeçalho (com centro de custo como campo do cliente), texto de cada seção, assinaturas e gráficos de 12 meses com linha de meta, usando os indicadores que já têm número. Precisa de um desenho de gráfico no PDF (hoje só há texto) e de uma série mensal por indicador.
2. **Layout do Básico:** igual, quando o PDF de Lagoa Santa for reenviado.
3. **Expert:** só a casca do IMR (16 linhas, colunas e totais), preenchendo apenas os itens 13 e 15 e deixando os demais como "aguardando definição", sem desconto nem glosa.

Nada disso foi iniciado, e nada foi publicado: as migrations 0060–0083 continuam sem aplicar no banco remoto.

## 5. Atualização de 22/10/2026: layout oficial do Completo e casca do IMR (feito)

Pedido do usuário: "construa o layout oficial do Completo (cabeçalho, textos, gráficos de 12 meses com meta, assinaturas) e a casca do IMR do Expert, sem inventar fórmulas".

| Item | Situação |
| --- | --- |
| Cabeçalho do Completo (cliente, centro de custo, competência, cidade, data) | **Feito.** Centro de custo, cidade e assinaturas são digitados no diálogo "Gerar relatório" (modelo Advanced); não são gravados. |
| Texto de abertura e texto de cada seção (valor, meta, "atendeu / não atendeu", "subiu / caiu / se manteve em relação ao mês anterior") | **Feito**, escrito a partir dos números que o relatório já calculou. |
| Gráfico de 12 meses com linha de meta tracejada | **Feito.** Vetorial no escritor de PDF; a meta de cada mês é a que estava em vigor naquele mês. Mês sem dado interrompe a linha. |
| Assinaturas | **Feito.** As informadas, ou duas linhas em branco ("Responsável pela Engenharia Clínica" e "Diretor Técnico"). |
| Disponibilidade do parque (DPT) | **Sem gráfico, de propósito.** É a situação de agora; repetir o número em 12 meses seria uma linha reta inventada. O PDF diz isso no lugar do gráfico. |
| MTTR em `h:mm` e MTBF em meses | **Só exibição.** Conversão de minutos (1 mês = 30 dias); o cálculo não mudou e os dois seguem marcados PROVISÓRIO (P-01, P-02, P-12). |
| Casca do IMR (16 itens na ordem e com os nomes do PDF do HJXXIII, colunas Resultado, Meta, Desconto, Glosa, totais) | **Feito.** Resultado só nos itens 13 (provisório) e 15; os outros 14 dizem "Aguardando definição", com o motivo listado depois da tabela. |
| Desconto (%), glosa (R$), total do desconto e faturamento do IMR | **Não calculados, de propósito.** Aparecem como "—" e "não calculado". |
| Básico | **Continua provisório** (faixa "AGUARDANDO MODELO PDF OFICIAL"): o PDF de Lagoa Santa não foi enviado. |

Código: `apps/api/src/insights/relatorio-oficial.ts` (texto e montagem), `apps/api/src/documents/pdf.ts` (gráfico, tabela, assinaturas), `buildReportSeries` em `packages/db/src/relatorios.ts`, helpers de mês em `packages/domain/src/dia-local.ts`. Testes: `relatorio-oficial.test.ts`, `api-relatorios.test.ts`, `meses-locais.test.ts`.

### O PDF "Technecare (1).pdf" (Memorial de Cálculo)

É a impressão de painéis do Data Studio, com os indicadores 1 a 13 do IMR (TMPA, disponibilidade interno/externo/global, TMRG geral e crítica por interno/externo/global, ICRS, ACM, treinamentos), por empresa/setor e por mês. **Não traz fórmula escrita.** Tira uma dúvida (ICRS = realizadas ÷ solicitadas: 1.743 ÷ 1.990 = 87,59 %) e deixa as outras sem resposta:

- não diz o que separa "interno" de "externo" (a divisão aparece por setor e empresa, sem regra);
- não define "solicitação crítica";
- os valores por setor chegam a 1.142 h no TMPA e 5.551 h no TMRG, sem a regra de relógio (corrido × útil, marco inicial e final);
- no ACM, "Regulares 1.743" é o mesmo número de "Realizadas" do ICRS, e com "Atrasado 1.700" não consegui reconstruir os 97,53 % (a extração do PDF é de painel, e posso estar lendo os rótulos trocados).

Por isso as perguntas P-01 a P-16 continuam necessárias, e nenhum item do IMR além do 13 e do 15 foi calculado.
