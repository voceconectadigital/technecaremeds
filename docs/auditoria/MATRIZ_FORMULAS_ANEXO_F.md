# Matriz das fórmulas do Anexo F (IMR) × indicadores do Téchne Care

**Rodada:** ajustes de Anderson, 06/11/2026 (branch `feat/ajustes-anderson-2026-11-06`) · **Data da análise:** 08/11/2026
**Fonte:** `AnexoF (1).pdf`, "Anexo F – Instrumento de Medição de Resultados (IMR)", SEI 2270.01.0007370/2022-76, pp. 104–111.
A fonte é a literal do PDF, sem correções. Os símbolos (∑∆T, ≥, ≤) foram lidos por extração UTF-8 (`pdftotext -enc UTF-8`).
**Cruzamento:** com o catálogo `packages/domain/src/report-tiers.ts`, as 16 linhas do IMR em
`apps/api/src/insights/relatorio-oficial.ts` (`ITENS_IMR`) e as perguntas P-01…P-16 de
`docs/AUDITORIA-INDICADORES-BASIC-ADVANCED-EXPERT.md` §15.

## Conclusão

**Nesta rodada não entra nenhum cálculo novo.** Nenhum dos 16 indicadores reúne as três condições
exigidas: regra inequívoca, dados registrados no sistema e escopo autorizado. Cada linha abaixo diz o
que falta. O Anexo F **informa** várias perguntas P-xx, mas não as encerra, e por isso nenhuma foi
reclassificada como resolvida. Glosa e desconto contratual continuam **sem cálculo**, porque são
financeiros, comerciais e dependem do contrato. As telas comerciais genéricas seguem sem citar a FHEMIG.

Duas divergências entre o IMR atual do sistema e o Anexo F pedem decisão do Anderson (D-1 e D-2, no fim).

## Legenda

- **Situação no sistema:** a situação do indicador no catálogo atual. `ACTIVE` = calculado; `PROVISIONAL` = calculado e marcado como provisório; `PENDING_DEFINITION` = sem número.
- **Classificação:** `DEPENDENCIA_CLIENTE` = falta uma regra ou um dado do cliente; `AVALIAR_ESCOPO` = exige dado ou fluxo novo, fora da fase atual; `V2_FUTURO` = pertence à V2.
- **Interno, externo e global:** sentido do Anexo F. Interno são os equipamentos "SERVIÇOS 1–4" dos Anexos A–D, sob cobertura total do contrato. Externo são os "SERVIÇO 5", de outros contratos. Global é o parque inteiro. **Os Anexos A–D não foram fornecidos.**

## Os 16 indicadores

| Nº | Indicador (Anexo F) | Fórmula literal | Unid. · Meta · Período | Variáveis e fonte | Pág. | Chave no sistema · situação | Classificação e o que falta |
|---|---|---|---|---|---|---|---|
| 1 | TMPA — Tempo médio para o primeiro atendimento (corretiva) | `TMPA = ∑∆Ť / C` | h · "a definir pelo fiscal/gestor" · mensal | ∆T: abertura do chamado de corretiva → primeiro atendimento; C: nº de chamados de corretiva. Fonte: sistema de chamados | 104 | `first_response_time` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Só conta como primeiro atendimento o **presencial** ou o **telefônico com solução definitiva**, e o sistema não registra a solução por telefone. Meta não numérica. **A-1** e **A-5**. Informa P-03, sem encerrá-la |
| 2 | IDPT1 — Disponibilidade do parque interno | `THEF1 = (P1) * 24(horas) * 30(dias)`; `IDPT1 = [(THEF1 - THEM1) / THEF1] * 100` | % · 98% · mensal | THEM1: horas de corretiva (abertura → fechamento da OS); P1: equipamentos SERVIÇOS 1–4 | 104–105 | `availability_internal` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Falta a classificação SERVIÇOS 1–5 (Anexos A–D). **A-3**, **A-6** e **A-7** |
| 3 | IDPT2 — Disponibilidade do parque externo | `THEF2 = (P2) * 24 * 30`; `IDPT2 = [(THEF2 - THEM2) / THEF2] * 100` | % · 98% · mensal · **sem glosa** | P2: equipamentos SERVIÇO 5 | 105 | `availability_external` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Mesma falta do nº 2 (**A-6**, **A-7**) |
| 4 | IDPT — Disponibilidade global | `THEF = (P) * 24 * 30`; `IDPT = [(THEF – THEM) / THEF] * 100` | % · 98% · mensal · sem glosa | THEM: horas de corretiva de **todos** os equipamentos; P: total do parque | 105–106 | `availability_global` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. É o mais próximo de calcular, mas faltam regras: **A-7** (30 dias fixos, OS que atravessa o mês) e **A-8** (o que é "fechamento" e quais equipamentos contam em P). Informa P-05 e P-09 |
| 5 | TMRG1 — Resolutividade geral, interno | `TMRG1 = ∑∆t1 / c1` | h · a definir · mensal | t1: fim do primeiro atendimento → fechamento da OS (SERVIÇOS 1–4); c1: chamados | 106 | `tmrg_internal` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Depende do marco do primeiro atendimento (nº 1) e da classificação SERVIÇOS. **A-1** e **A-6** |
| 6 | TMRG2 — Resolutividade geral, externo | `TMRG2 = ∑∆t2 / c2` | h · a definir · mensal · sem glosa | t2, c2: SERVIÇO 5 | 106–107 | `tmrg_external` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE (**A-6**) |
| 7 | TMRG — Resolutividade geral, global | `TMRG = ∑∆t / C` | h · a definir · mensal · sem glosa | t: fim do primeiro atendimento → fechamento; C: total de chamados | 107 | `tmrg_global` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Marco do primeiro atendimento (P-03) |
| 8 | TMARSC1 — Atendimento e resolutividade crítica, interno | `TMARSC1 = ∑∆Tc1/ Cc1` | h · a definir · mensal | Tc1: abertura → fechamento da OS de equipamento crítico (SERVIÇOS 1–4); Cc1: chamados críticos | 107–108 | `critical_resolution_internal` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. **A-2** (sigla), **A-1** (sentido da glosa) e **A-9** (lista de críticos × cadastro). Informa P-11 (crítico pelo equipamento, não pela prioridade) |
| 9 | TMARSC2 — Crítica, externo | `TMARSC2 = ∑∆Tc2/ Cc2` | h · a definir · mensal · sem glosa | idem, SERVIÇO 5 | 108 | `critical_resolution_external` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE (**A-6**, **A-9**) |
| 10 | TMARSC — Crítica, global | `TMARSC = ∑∆Tc / Cc` | h · a definir · mensal · sem glosa | Tc: abertura → fechamento, críticos da unidade | 108–109 | `critical_resolution_global` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE (**A-9**) |
| 11 | ICRS — Chamados realizados / solicitados | `ICRS = (c / C)*100` | % · 90% · mensal | c: chamados concluídos; C: total de chamados | 109 | `requests_fulfilled_ratio` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. A descrição ("abertos no mês e concluídos em tempo satisfatório") e a fórmula (totais) divergem: **A-10**. P-04 continua aberta |
| 12 | AAPQ — Adesão às atividades da qualidade no prazo | `AAPQ = (q / Q)*100` | % · 90% · mensal | q: atividades realizadas no prazo; Q: atividades propostas. Fonte: e-mails, atas, sistema da qualidade | 109–110 | `quality_activities_on_time` · PENDING_DEFINITION | V2_FUTURO. O sistema não registra "atividade proposta pela qualidade" (gestão da qualidade = V2Q). Informa P-15 |
| 13 | ACM — Adesão ao cronograma de MP, CAL e TSE | `ACM = (m/M)*100` | % · 100% · mensal | m: MP, CAL e TSE realizadas **dentro do prazo**; M: total proposto no cronograma | 110 | `compliance_preventive` · PROVISIONAL (só MP; item feito com atraso conta como feito) | DEPENDENCIA_CLIENTE. Divergência **D-2**. Faltam o "prazo" (vencimento do item? vencimento + tolerância do plano?) e o tratamento dos itens dispensados em M. Informa P-06 e P-10 |
| 14 | ITRS — Treinamentos realizados / solicitados | `ITRS = (t / T)*100` | % · 90% · mensal | t: treinamentos concluídos; T: solicitados. Fonte: chamados, e-mail, planilha | 110–111 | `training_ratio` · PENDING_DEFINITION | DEPENDENCIA_CLIENTE. Mesma ambiguidade de população e competência do ICRS (**A-10**). A glosa cita "ICRS" (**A-4**) |
| 15 | AQS — Avaliação de qualidade dos serviços | `AQS = R` | pontos · **0** · mensal | R: pontuação total da **tabela 04 do item 9.3.5 do Termo de Referência** | 111 | **`service_rating` · ACTIVE** (média 1–5 das avaliações de OS) | DEPENDENCIA_CLIENTE. A tabela 04 não foi fornecida. Divergência **D-1** |
| 16 | APT — Assiduidade nos postos de trabalho | `APT = [(D - F) / D] * 100` | % · 95% · mensal | D: dias de trabalho do contrato; F: faltas. Fonte: espelho de ponto | 111 | `attendance` · PENDING_DEFINITION | AVALIAR_ESCOPO. O sistema não tem ponto nem escala. As faixas da glosa deixam 90–95% sem regra (**A-11**). Informa P-15 |

## Ambiguidades do documento (registradas e não "corrigidas")

- **A-1 · Sentido invertido nas glosas de tempo.** O PDF diz `TMPA ≥ META: Nenhum desconto`,
  `TMRG1 ≥ META` e `TMRSC ≥ META`, e as faixas seguintes falam em "X% abaixo da meta". Em indicador
  de tempo, quanto menor, melhor; ao pé da letra, um tempo pior que a meta não teria desconto. O
  sentido correto precisa vir do cliente ou do contrato.
- **A-2 · Siglas inconsistentes.** A fórmula usa `TMARSC1/2/TMARSC`; a definição e a glosa usam `TMRSC1/2/TMRSC`.
- **A-3 · IDPT1 cita THEM2.** A observação do nº 2 manda "mensurar em THEM2", mas a fórmula do IDPT1 usa THEM1.
- **A-4 · A glosa do ITRS cita ICRS.** As faixas do nº 14 estão escritas como "ICRS…" e com
  percentuais diferentes dos do nº 11. É provável cópia, mas não está confirmado.
- **A-5 · O numerador do TMPA tem um glifo (`∑∆Ť`)** diferente do usado nos demais (`∑∆t`). Lido como somatório dos intervalos.
- **A-6 · Os Anexos A–D (SERVIÇOS 1–5) não foram fornecidos.** Sem eles não se separa interno de
  externo. Isso **não** é o "serviço externo" que o sistema registra como espera da OS.
- **A-7 · 30 dias fixos.** `THEF = P × 24 × 30` vale também para meses de 28, 29 e 31 dias. O
  documento não diz como tratar a OS que atravessa a virada do mês.
- **A-8 · "Fechamento da OS".** No sistema, a OS passa por Concluída (`review`), Validada (`done`) e Fechada (`closed`). O documento não diz qual delas fecha o relógio.
- **A-9 · Equipamentos críticos.** A lista nomeia ventiladores, aparelhos de anestesia, monitores
  cardíacos, camas elétricas, cardioversores, mesas e focos cirúrgicos, "e quaisquer outros que a
  unidade classifique". Falta mapear isso para as categorias e a criticidade do cadastro.
- **A-10 · ICRS e ITRS: descrição × fórmula.** A descrição fala em chamados "abertos dentro do mês"
  e "concluídos em tempo satisfatório"; a fórmula usa totais. A competência e o "tempo satisfatório" não estão definidos.
- **A-11 · APT.** A meta é 95% e a primeira faixa de desconto é 80–90%; a faixa de 90% a 95% fica sem regra.
- **A-12 · Referências à FHEMIG.** Os nº 3, 4, 6, 7, 9 e 10 são "apenas para controle da Engenharia
  Clínica da FHEMIG". O texto é específico daquele contrato e não vai para as telas comerciais.

## Divergências com o IMR atual do sistema (decisão do Anderson)

- **D-1 · Item 15.** O PDF do IMR gerado hoje (Expert) preenche a linha 15, "Avaliação da qualidade
  dos serviços", com `service_rating`: a média de 1 a 5 das avaliações das OS, que bate com o Data
  Studio do cliente. O Anexo F define o AQS como a **soma de pontos de um formulário próprio**, com
  meta **0** (quanto menor, melhor). São medidas diferentes. A linha **não foi alterada**: a escolha
  entre as duas fontes do próprio cliente cabe ao Anderson. Até lá, o número dessa linha não é o AQS do Anexo F.
- **D-2 · Item 13.** O sistema mostra "Adesão ao cronograma de manutenção preventiva" (só MP;
  PROVISIONAL; feito com atraso conta). O Anexo F agrega **MP + CAL + TSE** e conta só o realizado
  **dentro do prazo**. A conformidade de calibração e a de TSE existem separadas (Basic/Advanced,
  ACTIVE). O ACM agregado e "no prazo" pode ser implementado assim que o Anderson confirmar o que é
  "prazo" e se os itens dispensados entram em M.

## Perguntas objetivas para o Anderson (só as que destravam cálculo)

1. O Anexo F vale para o produto (todos os clientes Expert) ou só para o contrato FHEMIG?
2. **A-1:** nos indicadores de tempo (TMPA, TMRG, TMRSC), "sem desconto" é quando o resultado é **≤** a meta?
3. **A-6:** vão enviar os Anexos A–D? Se não vierem, o interno e o externo podem ser marcados por um campo novo no cadastro do equipamento ("cobertura total do contrato": sim ou não)?
4. **A-7/A-8:** a OS que atravessa o mês conta só as horas dentro do mês? O relógio fecha em "Concluída", "Validada" ou "Fechada"? Em P entram só os equipamentos ativos?
5. **D-2:** no ACM, "dentro do prazo" é até a data prevista do item, ou até a data prevista mais a tolerância do plano? Os itens dispensados saem de M?
6. **D-1:** no item 15 vale o formulário de pontos (tabela 04 do TR, que precisa ser enviada) ou a nota média das avaliações de OS?
7. **A-9:** a criticidade deve vir da categoria do equipamento (lista do Anexo F) ou da classificação feita pela unidade no cadastro?
8. **A-10:** no ICRS e no ITRS, qual é a competência (aberto no mês × concluído no mês) e o que é "tempo satisfatório"?

## O que o Anexo F não resolve

- **P-16 (obsolescência):** não aparece no Anexo F e continua pendente.
- **P-01 (MTTR), P-02 (MTBF), P-07 (IMP), P-10 (escopo do Basic), P-12 (formato h:mm) e P-13 (competência do exemplo):** também não são tratadas no documento.
- **Os 15 indicadores Expert pendentes continuam pendentes.**
