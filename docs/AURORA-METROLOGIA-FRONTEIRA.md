# Aurora — metrologia: o que foi feito, e o que espera um metrologista

> **Leia primeiro.** Este documento existe para que ninguém precise adivinhar
> uma fórmula. Ele separa o que o sistema já decide sozinho — porque não há nada
> a decidir — do que ele **se recusa** a decidir, e diz exatamente o que falta
> para destravar cada item.

---

## 1 · A fronteira

A metrologia do Aurora tem duas partes que moram no mesmo certificado e parecem
uma só. Confundi-las é o erro que custa uma acreditação.

| | O que é | Quem decide |
| --- | --- | --- |
| **Aritmética de calendário** | O padrão estava válido no dia da medição? A cadeia de rastreabilidade está preenchida? | O sistema. Não há grau de liberdade. |
| **Ciência de medição** | Incerteza, correção, critério de aceitação, veredito, arredondamento | **Um metrologista.** O sistema não inventa. |

A própria SPEC diz por quê, em EPIC-019:

> *Erro de cálculo metrológico tem consequência regulatória — exige suíte de
> testes com casos de referência validados por um metrologista antes do
> lançamento.*

Um campo vazio a pessoa preenche. Um número errado com cara de certo vai para um
certificado, o certificado vai para uma auditoria, e ninguém confere a conta de
um sistema que sempre respondeu.

---

## 2 · O que já está feito

Em `packages/domain/src/metrologia.ts`, com provas em
`packages/domain/src/__tests__/metrologia.test.ts`.

### 2.1 · A validade do padrão é avaliada **na data da medição**

É a US-DOC-002, AC1 e AC2. A razão é física, e não administrativa: o que o
certificado afirma é o que o instrumento fazia **naquele dia**, comparado com um
padrão que naquele dia era rastreável.

- Padrão vencido **antes** da medição → **emissão recusada**, nomeando o padrão,
  o número do certificado, o laboratório e a data.
- Padrão que vence **entre** a medição e a emissão → **emissão permitida**.
  Recusar aqui invalidaria trabalho correto.
- **O dia do vencimento ainda vale.** Um certificado "válido até 15/03" cobre o
  dia 15 inteiro.

Três detalhes que o teste fixa porque são onde esta regra costuma nascer errada:

1. **A comparação é de texto**, em `YYYY-MM-DD`. `new Date('2026-03-15')` é
   meia-noite UTC — no Brasil, o dia 14. Passando por `Date`, o mesmo padrão
   seria válido em Manaus e vencido em Brasília na mesma medição, e a diferença
   apareceria como defeito intermitente de madrugada.
2. **Uma data mal formada é recusada**, e não comparada. `'15/03/2026' <=
   '2026-03-15'` é uma comparação de texto perfeitamente válida — e
   perfeitamente errada.
3. **Todos os padrões reprovados são listados de uma vez.** Uma recusa por vez
   transforma um problema em três idas ao laboratório.

### 2.2 · A cadeia de rastreabilidade é conferida por preenchimento

Padrão sem número de certificado, ou sem o laboratório que o emitiu, quebra a
cadeia — e a cadeia é a única coisa que faz um certificado de calibração valer
mais do que uma planilha. Isto é conferência de campo preenchido, não de
ciência.

---

## 3 · O que está **BLOQUEADO**

Cada item abaixo é uma decisão técnica com consequência regulatória. Nenhuma
delas foi implementada, nem será sem validação.

A lista vive em código (`DECISOES_METROLOGICAS_BLOQUEADAS`) e não só neste
documento, e há um teste que **falha** se alguém acrescentar uma função de
cálculo ao módulo. Não é burocracia: o modo de esta fronteira apodrecer não é
alguém decidir violá-la — é alguém acrescentar "só uma fórmula simples" num dia
de pressa, com boa intenção, e ninguém notar até uma auditoria.

| # | Decisão | Por que não dá para inventar | O que um metrologista precisa fornecer |
| --- | --- | --- | --- |
| 1 | **Incerteza expandida** | Compor contribuições, apurar graus de liberdade efetivos e escolher o fator de abrangência *k* são decisões técnicas com consequência regulatória | O procedimento do laboratório, e casos de referência com resultado conhecido |
| 2 | **Correção de erro sistemático** | Aplicar ou não a correção, e com que sinal, muda o veredito do ponto medido | A política do laboratório, por escrito |
| 3 | **Critério de aceitação e veredito por ponto** | O limite aceitável vem da norma aplicável ao equipamento, não do sistema que registra a medição | A norma, a faixa e a tolerância de cada tipo de equipamento |
| 4 | **Limites normativos de segurança elétrica** | Os limites vêm de norma e mudam por classe e tipo de parte aplicada; inventá-los **aprovaria equipamento reprovado** | A norma vigente e a classificação de cada equipamento |
| 5 | **Arredondamento e algarismos significativos** | Arredondar antes de comparar com a tolerância pode transformar reprovado em aprovado — e o inverso | A regra do laboratório, e casos de referência **no limite** |

### O que destrava cada um

Para qualquer item desta lista, o caminho é o mesmo e tem três passos:

1. **O procedimento escrito**, de quem responde tecnicamente pelo laboratório.
2. **Casos de referência**: entradas com resultado já conhecido e conferido,
   incluindo pelo menos um no limite da tolerância — que é onde toda regra de
   arredondamento se revela.
3. **A validação do resultado** pelo metrologista, contra esses casos, antes de
   qualquer certificado sair.

Sem os três, o item continua aqui.

---

## 4 · O que ainda não existe, e não é bloqueio de conhecimento

Estas peças de EPIC-019 são trabalho normal de produto, sem decisão científica
envolvida. Elas não estão feitas porque EPIC-019 é **fase 10** e o trabalho
atual é pôr a homologação de pé — não porque haja dúvida sobre como fazê-las:

- tabela de padrões (ativos em modo padrão) e seus certificados;
- perfis de incerteza por sensor e faixa — o **cadastro** deles, não o cálculo;
- condições ambientais e pontos de medição no certificado;
- liberação ao cliente, manual ou automática.

O motor de documentos (§18) já é genérico, e a própria SPEC observa que
antecipar metrologia é "adicionar um `document_type`, não remodelar".

---

## 5 · Situação

**BLOQUEADO — A VALIDAR.** O que está implementado é aritmética de calendário e
conferência de preenchimento, e está provado. Nenhum cálculo metrológico foi
escrito, e nenhum será sem um metrologista e casos de referência.
