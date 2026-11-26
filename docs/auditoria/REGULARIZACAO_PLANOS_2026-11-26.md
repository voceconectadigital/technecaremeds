# Téchne Care — preparação da regularização de OS e planos (26/11/2026)

Nada foi alterado em produção. Leitura do banco em 26/11, ~12h UTC, com API, sistema, portal e campo em `cb71295` e o contrato
de demonstração vigente até 23/11/2027. Clientes, planos e OS estão codificados (Cliente A–D, P1–P9, OS-01–13); o mapa com os
identificadores reais fica fora do repositório.

## 1. O que a leitura confirmou

- **As 9 OS abertas com procedimento errado (OS-01 a OS-09) seguem intocadas:** nenhuma resposta, visita, hora, anexo,
  assinatura, comentário, reserva, peça, avaliação, técnico ou agenda.
- **Preservar:** OS-10 (concluída, 3 respostas e 1 reserva), OS-11 (agendada para 09/10, com técnico, ainda não iniciada),
  OS-12 e OS-13 (em execução).
- **Nada mudou desde o deploy** além da renovação do contrato: nenhum ciclo novo, nenhuma OS nova, nenhum item retido pelo contrato.
- **Procedimentos publicados: só 3.** Preventiva de bomba de infusão (título com erro de digitação), preventiva de incubadora e
  calibração de ventilador pulmonar. Não há incubadora em nenhum plano.
- **Quem pode dispensar item:** Administrador e Coordenador (1 pessoa ativa em cada).

## 2. Planos que ainda podem gerar OS errada

| Plano | Modelo | Gera sozinho? | Próxima abertura | Risco |
|---|---|---|---|---|
| **P4** (mensal) | setor, 1 equipamento | sim | **12/12/2026** | **alto: gera outra OS de incubadora em ultrassom** |
| P2 | setor, 2 equipamentos | sim | 04/04/2027 | procedimento de incubadora em desfibrilador e ventilador |
| P7 | setor, 0 equipamento | sim | 04/04/2027 | procedimento de bomba para qualquer equipamento que entrar no setor |
| P3 | equipamento | sim | 16/04/2027 | incubadora em desfibrilador |
| P1 | setor, 5 equipamentos | sim | 28/04/2027 | calibração de ventilador em bomba e monitor |
| P6 | equipamento | sim | 29/03/2027 | OS sem procedimento |
| P5 | categoria | não | ciclo já aberto, 2 itens pendentes | "Gerar OS" cria OS sem procedimento |
| P8 | categoria | não | ciclo já aberto, 1 item pendente | idem |
| P9 | setor | desligado | — | nenhum |

## 3. Decisão por plano

| Plano | Ação | Por quê |
|---|---|---|
| P1, P2, P4 | **substituir**: desligar, dispensar os itens das OS intocadas e criar o plano novo por equipamento | o plano por setor tem um procedimento só para equipamentos de tipos diferentes |
| P7 | **desligar** | não alcança equipamento e tem o procedimento errado |
| P3 | **corrigir na tarefa**: trocar o procedimento, cancelar a OS-08 e "Gerar OS deste ciclo" | já é por equipamento; o item volta a ter uma OS, a certa |
| P5, P6, P8 | **corrigir na tarefa**: só trocar o procedimento | as OS em andamento ficam; os próximos itens já saem certos |
| P9 | nada | desligado |

**Por que dispensar e não cancelar:** cancelar devolve o item a "pendente", e "Executar" ou "Gerar OS deste ciclo" recriaria a OS
errada. A dispensa cancela a OS com o motivo e marca o item como dispensado, com autor e data. Na P3 o cancelamento é intencional,
porque a tarefa é corrigida antes e a OS é gerada de novo, já certa.

Efeitos da dispensa que vale saber:
- O item perde o vínculo direto com a OS cancelada. Esse vínculo continua no motivo do cancelamento e na trilha de auditoria.
- A OS cancelada mantém o histórico.
- A conformidade do ciclo passa a excluir o item.

## 4. O que o contratante precisa fazer

**Publicar os procedimentos** (tela Planos → Procedimentos):

| Procedimento | Tipo | Usado em |
|---|---|---|
| Preventiva de monitor multiparamétrico | preventiva | P1 novo |
| Preventiva de ventilador pulmonar | preventiva | P5 e P2 novo (ver D2) |
| Preventiva de desfibrilador | preventiva | P2 novo e P3 |
| Preventiva de ultrassom | preventiva | P4 novo e P6 (ver D3) |
| Calibração de monitor multiparamétrico | calibração | P8 |
| Preventiva de bomba de infusão: nova versão só para corrigir o título | preventiva | P1 novo |

**Decidir:**
- **D1. Ventiladores do Cliente A:** hoje entram no P1 (semestral) e no P5 (trimestral). Proposta: deixar a preventiva só no P5,
  tirar os ventiladores do P1 novo e, se a calibração semestral que estava nas OS-04 e OS-05 for desejada, criar um plano de calibração
  separado com o procedimento que já existe.
- **D2.** O ventilador de transporte usa a mesma preventiva do ventilador de UTI ou uma própria?
- **D3.** O ultrassom mensal e o semestral usam o mesmo procedimento?
- **D4.** O P8 diz "monitores e desfibriladores", mas alcança só monitores. Falta incluir o desfibrilador?
- **D5.** A OS-11, agendada para 09/10, foi feita? Ela continua intocada aqui.

## 5. Procedimento exato (em produção, só com autorização)

**Antes de 12/12 (não depende do contratante):**
1. Desligar o **P4** e o **P7** na ficha do plano, com motivo. Reversível. Isso impede o ciclo de 12/12.
   Sem o procedimento de ultrassom, a preventiva de dezembro do ultrassom fica sem OS automática. A OS-09 continua visível até o passo 3.

**Depois dos procedimentos e das decisões, plano a plano e na ordem abaixo:**

2. **P1, P2, P4:** conferir que estão desligados; **dispensar** os itens das OS-01 a OS-07 e OS-09, com o motivo
   "Procedimento incompatível com o equipamento; substituído por plano por equipamento".
3. **Criar o plano novo** de cada um no assistente, por equipamento, **com a geração automática desmarcada**:

   | Novo | Início | 1º vencimento | Antecedência | Equipamentos |
   |---|---|---|---|---|
   | P1 novo | 13/11/2026, semestral | 13/05/2027 | 15 dias | 2 bombas e o monitor (ventiladores conforme D1) |
   | P2 novo | 19/10/2026, semestral | 19/04/2027 | 15 dias | desfibrilador e ventilador de transporte |
   | P4 novo | 22/11/2026, mensal | 22/12/2026 | 10 dias | ultrassom |

   Os vencimentos são os mesmos das OS dispensadas: nada é antecipado nem fica retroativo. Como o início já passou, os três abrem o
   ciclo na criação, com os itens pendentes e sem OS, porque a geração é manual.
4. Em cada plano novo, conferir na ficha o procedimento de cada equipamento, usar **"Gerar OS deste ciclo"** e conferir as OS geradas.
   Elas substituem as dispensadas, com o mesmo vencimento. Depois, ligar a geração automática em "Editar plano".
5. **P3:** na ficha do plano, editar o equipamento e trocar o procedimento para a preventiva de desfibrilador. Cancelar a OS-08 com motivo.
   Usar "Gerar OS deste ciclo". O vencimento fica em 21/04/2027.
6. **P5, P6, P8:** editar o equipamento e escolher o procedimento. Não tocar nas OS-11, OS-12 e OS-13.

**Verificar ao fim:**
- Uma única OS em aberto por equipamento e ciclo.
- Nenhuma OS aberta com procedimento de incubadora.
- As OS-10 a OS-13 iguais ao que eram antes.
- A partir de 12/12, nenhuma OS nova nos planos desligados.
- Repetir a consulta de leitura antes e depois.

**Ferramenta:**
- Desligar, criar, editar tarefa, cancelar OS e "Gerar OS" já existem na tela.
- **A dispensa existe só na API** (`POST /maintenance-plans/cycle-items/:id/skip`). Proposta: eu faço as 8 chamadas a partir do sistema
  aberto no Chrome com a sua sessão de administrador, sem exibir nem copiar a credencial, conferindo cada item.
- A alternativa é um botão "Dispensar" na ficha do plano. Isso é uma tela nova, que precisa de aprovação de escopo e deploy do sistema.

## 6. Matriz de execução

| # | Alvo | Ação | Depende de | Risco | Como verificar |
|---|---|---|---|---|---|
| 1 | P4 | desligar (motivo) | sua autorização | baixo; reversível | ficha "Desligado"; após 12/12, sem ciclo 3 |
| 2 | P7 | desligar (motivo) | sua autorização | baixo; reversível | ficha "Desligado" |
| 3 | OS-09 | dispensar item | procedimento de ultrassom; passo 1 | médio: a OS é cancelada | OS cancelada com motivo; item dispensado |
| 4 | P4 novo | criar (manual), Gerar OS, ligar automático | 3 | baixo | uma OS, venc. 22/12/2026, procedimento de ultrassom |
| 5 | P1 | desligar | sua autorização | baixo | ficha "Desligado" |
| 6 | OS-01–05 | dispensar 5 itens | 5; D1 | médio | 5 OS canceladas; 5 itens dispensados |
| 7 | P1 novo | criar por equipamento (manual), Gerar OS, ligar automático | 6; procedimento de monitor; D1 | baixo | uma OS por equipamento, procedimento certo; venc. 13/05/2027 |
| 8 | P2 | desligar | sua autorização | baixo | ficha "Desligado" |
| 9 | OS-06–07 | dispensar 2 itens | 8; D2 | médio | 2 OS canceladas; itens dispensados |
| 10 | P2 novo | criar por equipamento (manual), Gerar OS, ligar automático | 9; procedimentos de desfibrilador e ventilador | baixo | uma OS por equipamento; venc. 19/04/2027 |
| 11 | P3 | trocar o procedimento da tarefa | procedimento de desfibrilador | baixo | ficha mostra o novo procedimento |
| 12 | OS-08 | cancelar e "Gerar OS deste ciclo" | 11 | médio | uma OS aberta, procedimento certo, venc. 21/04/2027 |
| 13 | P5 | trocar o procedimento da tarefa | procedimento de ventilador; D1 | baixo | OS-11/12 inalteradas; itens do ciclo 2 pendentes |
| 14 | P6 | trocar o procedimento da tarefa | procedimento de ultrassom; D3 | baixo | OS-13 inalterada |
| 15 | P8 | trocar o procedimento da tarefa | calibração de monitor; D4 | baixo | item de 10/08/2027 pendente |
| 16 | todos | consulta de leitura de antes e depois | — | nenhum | contagens da §5 |

Recomendado antes dos passos 3 a 15: um backup novo no HostPanel.

## 7. Validação feita (ambiente isolado, dados sintéticos)

Arquivo novo: `packages/db/src/__tests__/regularizacao-planos-2026-11-26.test.ts`, com 6 testes, todos passando, em PostgreSQL embutido (PGlite).
- Um plano mensal por setor gera OS com o procedimento errado. A OS em execução é preservada, com o comentário.
- Desligar o plano e dispensar os itens cancela as OS intocadas com motivo e deixa tudo na auditoria.
- Nada recria a OS errada: "Executar", "Gerar OS deste ciclo", a varredura na data da próxima abertura, nem suspender e reativar o contrato.
- O plano novo por equipamento, manual e com o mesmo vencimento, gera uma OS por equipamento com o procedimento certo e
  nenhuma duplicada. O equipamento com OS em execução começa no ciclo seguinte.
- No caso de plano por equipamento, trocar o procedimento, cancelar a OS e gerar de novo deixa uma OS só, a certa.
  A cancelada mantém a resposta antiga.

Também passaram os testes existentes de planos, procedimentos, conclusão de 24/11 e API de planos (67). Lint e tipos ok.

**Não coberto:**
- A execução real em produção.
- A tela do assistente com os procedimentos novos do contratante.
- A varredura agendada de verdade em 12/12.
