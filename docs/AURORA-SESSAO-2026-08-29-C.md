# AURORA — RELATÓRIO DA SESSÃO DE 29/08/2026 (parte C)

**Branch:** `main` · **HEAD inicial:** `b781269` · **HEAD atual:** `8953415` · **Árvore:** limpa

Continuação. Esta parte fechou `apps/web` inteira, fez a auditoria visual e de acessibilidade, e
entregou a API do portal do cliente com as provas de não vazamento.

**Os números foram medidos.** Onde eu errei — e errei em quatro lugares nesta parte —, está
escrito o que eu errei e como apareceu.

---

## 1. Estado medido

| Métrica | Valor |
| --- | --- |
| Commits | **65** (12 nesta parte) · HEAD `8953415` · árvore limpa · **sem push** |
| Testes unitários e de HTTP | **1.486** verdes (74 arquivos, 2 pulados) |
| Testes de ponta a ponta | **128** verdes |
| Arquivos de teste | 91 |
| Migrations | **43** (`0000`–`0042`) |
| Rotas nos controllers | 174 |
| Rotas com contrato | **93 (53%)** — e **100% das rotas que a web usa** |
| Vulnerabilidades (`npm audit`) | **0** |
| Telas "em construção" | **0** |
| Pacote inicial da web | 583,13 kB (181,95 kB comprimido) |

---

## 2. `apps/web` fechada — 12 módulos

| Módulo | O que faltava | O que apareceu no caminho |
| --- | --- | --- |
| **Ficha da OS** (EPIC-009) | A API só escrevia: havia `POST` de anexo e nenhum `GET`; a tabela `work_order_comments`, com separação de nota interna em COLUNA, não tinha rota nenhuma | Contrato `.loose()` + `SELECT w.*` escondiam 20 campos; `STATUS_CATEGORIES` tinha 5 das 9; a escala de prioridade era inventada e **toda OS urgente renderizava um chip vazio** |
| **Ativos** (EPIC-005) | Contrato e tela | `SELECT a.*` devolvia observação interna e três valores financeiros para qualquer um com `asset.read` |
| **Acesso e permissões** (EPIC-002) | Nenhuma rota de papéis existia | — |
| **Estoque** (EPIC-015) | Modelo completo, **zero rotas** | O razão é imutável por gatilho, e o `--reset` do E2E esbarrou nele |
| **Contratos e orçamentos** (EPIC-016/017) | Contrato Zod e tela | `SELECT *` devolvia valor mensal e percentuais de glosa; `effectiveStatus` em camelCase no meio de uma resposta snake_case |
| **Planos preventivos** (EPIC-013) | Modelo completo, **zero rotas** | **Nada fecha um ciclo** — lacuna registrada em PROGRESS como A VALIDAR |
| **Indicadores** (EPIC-021) | 13 rotas existiam; o item de menu levava a "em construção" | — |
| **Notificações** (EPIC-023) | Contrato e tela | Duas corridas nos meus próprios testes |
| **Documentos** (EPIC-018) | Não havia lista — só por ativo e por id | Cópias LOCAIS de `uuidParam`/`oneOf` que escaparam da consolidação; `dt.name` numa tabela cuja coluna é `label` |
| **Automações** (EPIC-024) | A rota existia e **nada levava até ela** | — |
| **Meu perfil** | Última tela em construção | `<p>` irmão do `<dd>`; `<main>` rolável sem foco de teclado |

### As decisões que se repetiram

**O menu tem oito itens, por decisão escrita.** Módulos vizinhos dividem item, com um alternador
VISÍVEL no topo: Ordens↔Planos, Contratos↔Orçamentos, Ativos↔Documentos, Pessoas↔Automações. Um
nono item custaria mais do que ganha.

**O filtro do que é restrito acontece na CONSULTA.** Nota interna, custo, valor de ativo, valor de
contrato — todos saem do `SELECT` por permissão. Escondido na tela, o dado já viajou.

**Vazio explicado, e não área em branco.** Toda tela distingue "não há" de "não encontrei com esse
filtro", e a maioria diz por que o vazio é o caso normal.

---

## 3. Os quatro erros meus, e como apareceram

1. **Perdi um `$`** no marcador de parâmetro ao acrescentar o filtro `?asset=`: a condição virou
   `assignee_membership_id = 4`, uuid comparado com inteiro, **500 para quem filtrasse por
   responsável**. Passou porque, dos quatro filtros da rota, só `limit` tinha teste.

2. **Escrevi um acento grave dentro de um comentário SQL**, duas vezes — e ele fecha o template
   literal do TypeScript. Regra que fica: nada de acento grave dentro de SQL.

3. **Supus que gerar um segundo ciclo seria recusado.** Não é — e investigar por quê revelou a
   lacuna real: nada fecha um ciclo, então uma junção por `status = 'open'` duplica a tarefa a
   partir do segundo ciclo, e o indicador contaria cada equipamento duas vezes.

4. **Escrevi vocabulários que não existem:** seis estados de cumprimento viraram quatro no meu
   contrato, seis unidades de frequência viraram quatro, `merged` no lugar de `duplicate`,
   `location` no lugar de `location_subtree`. Todos pegos pelos testes de conformidade contra o
   contrato.

**Toda correção foi provada revertendo:** o teste correspondente falha antes de passar.

---

## 4. Acessibilidade — as dezessete telas reprovavam

`@axe-core/playwright` contra WCAG 2.1 A/AA e boas práticas, mais um teste do diálogo (que a
varredura de telas não alcança, porque ele só existe depois de um clique).

**O critério é "nenhuma violação", e não "poucas".** Uma lista de exceções toleradas cresce
sozinha: cada nova é justificada pela anterior, e em três meses ninguém sabe quais eram
intencionais.

| Violação | Causa | Efeito real |
| --- | --- | --- |
| `region` (16 telas) | Título, subtítulo e ações num `<div>` fora de qualquer marco | Atalhos de marco pulavam de `navigation` direto para `main`, por cima do título |
| `heading-order` | `CardHeader` era `<h3>` fixo, e h1 → h3 é salto | Nível pulado se lê como "há uma seção que eu não estou ouvindo" |
| `color-contrast` | `text-subtle` dava 4,02:1 sobre a superfície rebaixada | Abaixo dos 4,5:1 exigidos |
| `scrollable-region-focusable` | Faixa do Kanban e `<main>` rolam sem foco | Quem usa teclado não alcançava o conteúdo fora da dobra |
| `definition-list` | `<p>` irmão do `<dd>` | Leitor de tela deixa de emparelhar termo e definição |
| `landmark-no-duplicate-banner` | Meu primeiro conserto usou `<header>`, que fora de `section` vira um segundo `banner` | Dois "cabeçalho da página" anunciados |

O contraste foi corrigido com um **degrau novo na escala neutra**: escurecer até `muted`
resolveria e apagaria a hierarquia — os dois virariam a mesma cor. O degrau intermediário dá
4,95:1 no pior fundo e continua visivelmente mais claro.

**Resultado: 17 telas + o diálogo, sem uma única violação.**

### O que o verificador NÃO pega

Cerca de dois terços dos problemas reais de acessibilidade continuam sendo trabalho humano: se a
ordem de tabulação faz sentido, se o texto do erro explica o que fazer, se a leitura em voz alta
conta a mesma história que a visual. **Este trabalho não é certificado de conformidade.**

---

## 5. As cinco larguras, medidas

1440×900, 1280×800, 1024×768, 768×1024, 390×844 — contra quatro propriedades decidíveis por
máquina, e não por captura de tela: a página não rola de lado, nada visível ultrapassa a janela,
alvo de toque ≥ 24×24 no celular, e o menu continua alcançável.

Comparar imagens pixel a pixel falha numa sombra e passa com texto escondido atrás de um botão.

**Três defeitos encontrados**, o pior deles: o **`<h1>` desaparecia em 390px** na tela de ordens,
porque as ações eram `shrink-0` e esmagavam o contêiner do título a zero. Um título invisível é o
primeiro item do índice de quem usa leitor de tela e a única confirmação de onde a pessoa está.

---

## 6. Desempenho do frontend

| | Antes | Depois |
| --- | --- | --- |
| Pedaço inicial | 713,79 kB | **583,13 kB** (−18%) |
| Comprimido | 210,87 kB | **181,95 kB** (−14%) |
| Pedaços de rota | 1 | **21** (o maior com 19,75 kB) |

Antes, abrir a tela de login baixava o painel de indicadores, o quadro Kanban e as dezessete telas
que a pessoa talvez nunca abra. Três telas ficam ansiosas — entrar, escolher organização, Hoje —
porque toda sessão abre as três em sequência, e adiá-las trocaria um download grande por três
esperas encadeadas.

`@tanstack/react-table` era dependência de runtime e **nada a importava**. Removida.

**O que sobra no pedaço inicial, medido:** React, Router, Query, Radix, o design system — e o
registro INTEIRO de contratos, com 100 `operationId` embutidos. Os esquemas Zod das 93 operações só
são exercitados em desenvolvimento, onde o cliente confere a resposta contra o contrato; em
produção a conferência está desligada e eles viajam sem uso. A causa é o barril:
`defineOperation` registra num mapa de módulo, então importar UMA operação puxa todas. **Registrado
como próximo passo, não feito** — é refatoração ampla, e o portal tinha prioridade.

---

## 7. Portal do cliente — a API e as provas (EPIC-020, PORTAL-001..010)

**16 casos de teste, cada um montando um dado interno REAL antes de perguntar ao portal.** A
asserção é sempre sobre o CORPO da resposta: um campo escondido por CSS já viajou, já está no cache
do dispositivo, e já pode ser lido por quem abrir as ferramentas de desenvolvedor.

**A massa tem dois clientes de propósito.** Um teste de vazamento com um cliente só prova que o
dado chega a quem deve; a pergunta que importa precisa de um segundo cliente cujo chamado e
equipamento existam de verdade no mesmo banco, na mesma organização, sob a mesma conexão.

| Caso | O que prova |
| --- | --- |
| PORTAL-001 | Sem vínculo não há escopo, e a resposta é recusa — não "vejo tudo" |
| PORTAL-002 | Nota interna não sai; e a MESMA OS, pela rota interna, mostra a nota (prova de que ela existe) |
| PORTAL-003 | Nenhum valor de equipamento sai; nem observação interna |
| PORTAL-004 | Chamado, equipamento e documento de outro cliente não aparecem |
| PORTAL-005 | A situação chega traduzida; a chave interna não viaja |
| PORTAL-006 | A resolução só depois de validada |
| PORTAL-007 | Documento só depois de LIBERADO — emitido ainda é conferência interna |
| PORTAL-008 | O total sai; custo, margem e nota interna não |
| PORTAL-009 | A agenda não diz QUEM vai |
| PORTAL-010 | A escrita ignora `customer_id` do corpo; a origem é `portal` sempre |

### Duas decisões que o trabalho mudou

**"Não existe" e "não é seu" devolvem a MESMA coisa.** Um 404 e um 403 distinguíveis contam ao
cliente que o chamado do concorrente existe — e, iterando os números, quantos ele abriu. É
enumeração, e o custo é vazar o volume de operação de outra empresa.

**`packages/db/src/portal.ts` é uma fronteira.** Consultas escritas separadamente, colunas nomeadas
uma a uma. Reaproveitar as consultas internas e filtrar depois falha do jeito mais silencioso:
alguém acrescenta uma coluna seis meses depois, o portal passa a devolvê-la, e nada quebra. O tipo
de comentário do portal nem TEM o campo `visibility` — não há como vazar o que não se recebeu.

### O vocabulário (migration 0042)

`customer_label` em `work_order_statuses` e `wait_reasons` — **dado, e não código**, como a SPEC
§19 exige. A tradução da SOLICITAÇÃO é código, e a assimetria é o ADR-003: a máquina de estados da
OS é configurável por organização; a da solicitação não, porque o ciclo da solicitação é o contrato
com o cliente.

**Um achado:** a migration semeia o vocabulário das organizações que já existiam. Sem levar o
rótulo também para `FACTORY_STATUSES`, toda organização NOVA nasceria sem vocabulário de cliente, e
o portal dela mostraria a palavra da equipe. O rótulo passou a nascer na definição de fábrica.

**Nenhuma frase de motivo de espera NOMEIA fornecedor.** "Em serviço externo" diz que há um
terceiro, o que é verdade e é útil; quem é ele é informação comercial nossa.

---

## 8. Supabase — ainda BLOQUEADO

Sem mudança. A conta autenticada não enxerga a organização "Aurora CMMS"; o ref
`egoajboqzhnvkpenrszw` não aparece na listagem e devolve 403 na consulta direta; o CLI não
reautentica em ambiente não interativo.

**Nenhum outro projeto foi tocado. Nenhuma migration foi aplicada em lugar nenhum além dos bancos
locais.**

Para destravar, do seu lado: um **Personal Access Token** da conta dona da organização, exportado
como `SUPABASE_ACCESS_TOKEN` — ou aceitar o convite pendente na conta que o CLI já usa.

---

## 9. O que NÃO foi feito, e por quê

- **TechneCare/Arkmeds:** nenhum acesso, nenhuma navegação, nenhum request, nenhuma sessão.
- **Nenhum recurso pago, upgrade ou compra.**
- **Nenhum push.**
- **Nenhum e-mail, WhatsApp ou webhook real disparado.**
- **Nenhuma regra regulatória inventada.** Nada de metrologia foi implementado.
- **A regra de fechamento de ciclo de plano NÃO foi inventada** — três políticas possíveis, nenhuma
  decidida na SPEC. Registrada como **A VALIDAR**.

---

## 10. Pendente

**EPIC-020 — a aplicação do portal.** A API e as provas estão prontas; falta a interface (9 telas
da SPEC §19, mobile primeiro, abertura de chamado em 30 segundos).

**EPIC-014 — PWA de campo.** Oito horas sem internet sem perda de trabalho, o teste de 19 passos,
tratamento de conflito. Nunca descartar trabalho local em silêncio.

**EPIC-019 — Metrologia.** Zero hoje. Tudo que não estiver confirmado — fórmula, limite, critério
de aceitação, incerteza, regra regulamentar — será marcado **BLOQUEADO / A VALIDAR**.

**Transversal**
- CI com container de serviço PostgreSQL 16
- Expansão do benchmark: latência HTTP, 10/25/50 clientes simultâneos, saturação de pool, p50/p95/p99
- Divisão do registro de contratos, para os esquemas Zod não viajarem em produção
- Medição de lista em 1k/10k/100k, e paginação por cursor se o `OFFSET` degradar

---

*Relatório medido em 29/08/2026. Fonte de verdade de implementação: filesystem + Git.*
