# AURORA — RELATÓRIO DA SESSÃO DE 29/08/2026

**Branch:** `main` · **HEAD inicial:** `7b88baa` · **HEAD final:** `839ae75` · **Árvore:** limpa

Esta sessão levou o Aurora do backend pronto até a **primeira interface que funciona ponta a
ponta**, passando por PostgreSQL real, contratos compartilhados, fila durável e medição de
desempenho com cem mil ordens de serviço.

Os números abaixo foram **medidos**, não estimados. Onde a medição contradisse o que eu esperava,
está escrito o que a medição disse — inclusive uma atribuição errada que eu quase deixei no
relatório (seção 10).

---

## Resumo em uma tela

| | |
| --- | --- |
| Commits nesta sessão | **9** (40 no total) |
| Migrations | **42** (`0000` a `0041`), 4 novas |
| Testes verdes | **1.364** + **29** só contra PostgreSQL real |
| Cobertura de contratos | **27 de 136 rotas (20%)**, medida a cada geração |
| Lista de OS com 100 mil registros | **114,5 ms no p95** (meta: 400 ms) |
| Defeitos encontrados e corrigidos | **9** |
| Bloqueios ativos | **1** — acesso ao projeto Supabase |
| Push para remoto | **não feito** (sem autorização inequívoca) |

---

## 1. Estado do Git

| | |
| --- | --- |
| HEAD inicial | `7b88baa` |
| HEAD final | `839ae75` |
| Commits nesta sessão | 9 |
| Commits no total | 40 |
| Branch | `main` |
| Árvore de trabalho | limpa (0 arquivos modificados) |
| Push para remoto | **não feito** — não há autorização inequívoca no ambiente |

**Commits da sessão, do mais antigo ao mais novo:**

```
c2d6c33  docs: reconcile epic numbering against the SPEC
a8e17f7  feat(db): real PostgreSQL — validation, concurrency and a tenant FK fix
19f5bc9  feat(members): convite atômico com escopo, e o defeito que o impedia
7491c3a  feat(contracts): fonte única de contratos, OpenAPI gerado dos controllers
fd4f76a  feat(workers): pg-boss no lugar do agendador temporário
b4d6a18  feat(ui): design system próprio da Aurora
cb42ae8  feat(web): esqueleto da aplicação e o primeiro fluxo vertical
dbffb1c  perf(work-orders): mede com 100 mil OS, e corrige o que a medição mostrou
839ae75  docs: relatório medido da sessão
```

---

## 2. Migrations

**42** arquivos (`0000` a `0041`), idempotentes e reprodutíveis do zero. Quatro nasceram nesta
sessão:

| Migration | O que fecha |
| --- | --- |
| `0038_notification_event_fk_fix.sql` | A FK de notificação para evento de domínio não incluía `organization_id` |
| `0039_membership_scope_required.sql` | Gatilho de restrição diferido: vínculo sem escopo não sobrevive ao COMMIT |
| `0040_invite_flow.sql` | Chave estrangeira diferida + resolução de e-mail: o convite passa a funcionar sob o papel de produção |
| `0041_scheduler_role.sql` | `aurora_scheduler`, papel próprio para a dispersão dos trabalhos periódicos |

Todas aplicadas com sucesso num **PostgreSQL 16.14 real** e validadas por
`tools/db/validate.mjs`, que confere no catálogo do banco — não na intenção do código:

- **92 tabelas**, todas com `ENABLE` **e** `FORCE ROW LEVEL SECURITY`;
- todas pertencentes a `aurora_owner`;
- **160 chaves estrangeiras compostas** entre tabelas tenant-scoped;
- **50 gatilhos de auditoria**;
- `aurora_app` sem `BYPASSRLS`, sem `SUPERUSER`, sem `CREATEROLE`;
- `aurora_app` sem `UPDATE`/`DELETE` em `audit_logs` — a trilha continua append-only;
- 4 funções `SECURITY DEFINER`, todas nomeadas e justificadas.

---

## 3. Testes

| | |
| --- | --- |
| Arquivos de teste | 70 |
| Testes que rodam sempre | **1.364**, todos verdes |
| Testes que exigem PostgreSQL real | **29**, todos verdes |
| Testes de interface (jsdom) | 45 dos 1.364 |
| Testes de ponta a ponta com navegador | **0** — não implementados |

O portão de qualidade (`npm run verify`) é:

```
auditoria da SPEC → typecheck → lint → conferência de contratos → testes
```

A conferência de contratos entrou nesta sessão e já encontrou dois defeitos reais.

---

## 4. Supabase — BLOQUEADO, e o bloqueio é preciso

O protocolo pedido foi seguido à risca, e parou no passo 2.

| Passo | Resultado |
| --- | --- |
| 1. Consultar o projeto | **Feito.** O CLI está autenticado e lista **28 projetos**. |
| 2. Confirmar que o ref é EXATAMENTE `egoajboqzhnvkpenrszw` | **Impossível.** Esse ref **não aparece** na listagem. |
| 3. Confirmar nome, organização e região | **Impossível** — não há projeto a confirmar. |
| 4. Registrar no relatório | **Feito**: é esta seção. |
| 5. Só então vincular | **Não feito.** |

A consulta direta ao ref informado devolve **403**:

> `Your account does not have the necessary privileges to access this endpoint.`

O **mesmo comando**, contra um projeto que está na listagem, funciona. Isso separa as duas
hipóteses que pedem soluções diferentes: **não é escopo de token — é acesso.** A conta
autenticada (`voceconectadigital@gmail.com`) não enxerga o projeto `egoajboqzhnvkpenrszw`.

**Nenhuma operação foi executada em nenhum dos outros 28 projetos.** Vincular sem conseguir
confirmar o ref seria exatamente a operação às cegas que a instrução proíbe.

### Para desbloquear

Dar a essa conta acesso ao projeto, **ou** informar em qual conta ele vive.

**Nada no código depende disso.** As migrations rodam em qualquer PostgreSQL 16+, e as decisões
ADR-026/027 removeram até a dependência de extensão. O bloqueio afeta **apenas** a Fase 3 —
aplicar as migrations no remoto e validar lá.

---

## 5. PostgreSQL real, no lugar do bloqueio

Um contêiner PostgreSQL **16.14** local (porta 15432) destravou tudo o que dependia de "banco de
verdade" — sem nenhuma operação remota.

O que ele provou, e que o PGlite não consegue provar por ter uma conexão só:

- **Reuso de pool.** O contexto do tenant A não sobrevive na conexão física quando ela volta para
  o tenant B.
- **Concorrência real.** Duas reservas simultâneas da última peça → exatamente **1 atendida e 1
  recusada**, com `reserved = 1` e `on_hand = 1`. Doze gerações concorrentes de número de
  documento → **12 números distintos**, de 1 a 12. Oito recebimentos concorrentes de 5 unidades →
  `on_hand = 40`.
- **`SKIP LOCKED`.** Dois publicadores do outbox pegam conjuntos com **interseção vazia**.
- **RLS sob o papel de aplicação real**, e não simulado.
- **Dois workers em conexões físicas distintas** disputando a mesma fila: **nenhum job entregue
  duas vezes**.
- **O papel do agendador recebe `permission denied`** ao tentar ler ordem de serviço — o
  privilégio dele é ler o identificador das organizações ativas, e mais nada.

Um contêiner Supabase preexistente de outro projeto (`supabase_db_ecommerce-template`, porta
54322) foi deliberadamente **deixado intacto**.

---

## 6. Defeitos encontrados e corrigidos

Nove nesta sessão. Os cinco que mais importam:

### A numeração dos épicos estava errada

Quatro épicos com número trocado em relação à SPEC e — o que importa — o **EPIC-019 (Metrologia)
constava como entregue e nunca foi implementado**: o número tinha sido tomado por notificações.
Encontrado por medição, não por leitura, porque a instrução era medir e não fazer os números
concordarem.

### O convite não podia funcionar sob o papel de produção

A política `users_visible_through_membership` exige um vínculo prévio para a linha de usuário
existir; o vínculo exige o usuário pela chave estrangeira. Ovo e galinha: `aurora_app` tinha
`GRANT INSERT` em `users` desde a migration 0003 e **nunca conseguiu usá-lo uma vez**.

Ninguém notou porque todo teste e todo seed criava usuário pelo caminho administrativo, que não
passa pela RLS. A operação mais comum de administração de uma organização nunca tinha sido
exercitada pelo papel que a executaria em produção.

**Correção:** a chave estrangeira passou a ser diferida (0040) e o convite insere o **vínculo
primeiro** — aí a política de `users` aprova sem abrir exceção nenhuma.

### A notificação podia apontar para o evento de outra organização

`notifications.event_id` referenciava `domain_events(id)` sem `organization_id`. A verificação de
chave estrangeira roda como dona da tabela e **ignora a RLS**: nada impedia um alerta de apontar
para o evento de outro tenant — justamente pelo elo que existe para explicar a origem do alerta.

Nenhuma suíte pegou porque **todo teste de isolamento verifica leitura**.

### Escrita de notificação guardada por permissão de LEITURA

`POST /notifications/outbox/:id/sent` e `/failed` exigiam `audit.read` — chave que o papel
**Auditor** tem, e sobre quem a SPEC §21 diz *"somente leitura em tudo. Nenhuma escrita"*. Um
auditor podia marcar como enviada uma notificação que nunca saiu, e a mensagem sumia da fila.

Encontrado pela conferência automática de contratos, que agora acusa toda rota que altera dado
exigindo apenas `algo.read`. As quatro rotas em que isso é legítimo — as transições, cuja
permissão é a da aresta do grafo — declaram a exceção no próprio controller.

### Os dois vínculos da consultora, no seed, nasciam cegos

A persona que existe justamente para exercitar o seletor de organização entrava nas duas
organizações **sem enxergar nada**. Quem apontou foi o gatilho novo da 0039; até então, ninguém —
porque vínculo cego não dá erro, dá tela vazia.

### O padrão por trás dos cinco

Quatro deles só apareceram quando alguma **garantia estrutural passou a ser verificada por
máquina**: um gatilho no banco, uma validação de catálogo, uma conferência de contratos no portão
de qualidade. Nenhum teria sido achado relendo o código.

Os outros quatro defeitos da sessão estão na tabela do `PROGRESS.md`, que já soma **49 linhas**.

---

## 7. Contratos e OpenAPI

`packages/contracts` é a fonte compartilhada entre backend e frontend: um campo é decidido **uma
vez**, em Zod, e três coisas passam a concordar por construção:

1. a validação do corpo no controller;
2. o documento OpenAPI;
3. o cliente tipado do frontend.

`npm run openapi` lê os **controllers de verdade** — os metadados que o NestJS grava nos
decoradores, os mesmos que o roteador usa em produção. Não existe uma segunda lista de rotas
escrita à mão para o documento sair bonito.

**Cobertura: 27 de 136 rotas (20%)**, impressa a cada execução. O número é baixo de propósito:
contrato nasce quando a tela que o usa nasce. Escrever os 136 de uma vez produziria esquemas que
ninguém exercita, e esquema não exercitado erra no campo opcional.

A conferência acusa quatro coisas, e entra no `npm run verify`:

- rota sem contrato (contada, nunca escondida);
- contrato sem rota correspondente;
- permissão divergente entre o contrato e o guard;
- **escrita guardada por permissão de leitura** — que encontrou dois defeitos reais.

O cliente tipado **não é código gerado**: os tipos saem do próprio contrato por inferência.
`call(membersInvite, { body })` já sabe o formato dos dois lados, e errar um campo é erro de
compilação.

---

## 8. Trabalhos periódicos (pg-boss)

Cinco varreduras **por organização** e uma **de plataforma**:

| Trabalho | Frequência | Escopo |
| --- | --- | --- |
| `aurora.sla.sweep` | a cada 5 min | tenant |
| `aurora.plans.sweep` | de hora em hora | tenant |
| `aurora.quotes.expire` | diária, de madrugada | tenant |
| `aurora.contracts.alerts` | diária, de madrugada | tenant |
| `aurora.documents.expiry` | diária, de madrugada | tenant |
| `aurora.outbox.publish` | a cada minuto | plataforma |

**A garantia central: nunca duas execuções concorrentes do mesmo trabalho lógico.** Toda fila usa
política `exclusive` com `singletonKey` igual à organização — existe UM job por (fila,
organização), enfileirado ou ativo. Cron sobreposto, worker lento, duas instâncias do processo:
em nenhum caso a varredura da mesma organização roda duas vezes ao mesmo tempo.

Isso importa porque as varreduras **abrem ciclo e geram ordem de serviço**: duas execuções
concorrentes produziriam a mesma OS preventiva duas vezes, e quem descobriria seria o técnico, na
agenda dele.

Mais três decisões que valem ser lidas:

- **o instante viaja com o job.** A organização enfileirada às 03:23 é medida contra 03:23, mesmo
  que o worker só a processe às 04:10. Sem isso, "vence em 30 dias" significaria uma coisa na
  tentativa que falhou e outra na que deu certo.
- **falha não some.** Retentativa com recuo exponencial; esgotada, o job vai para a fila de cartas
  mortas. Um trabalho que falha em silêncio é pior do que um que não existe.
- **papel próprio para a dispersão.** `aurora_app` não consegue enumerar organizações, e é assim
  que tem de ser.

O `IntervalScheduler` temporário foi **removido**, não deixado ao lado: não sobrevive a reinício,
não coordena duas instâncias e engole a falha num `catch`. Um substituto ruim deixado por perto é
um substituto que alguém usa.

**Sem trabalho agendado, e dito no próprio catálogo:** o *digest* de notificações (§26) e a
automação com gatilho de agenda (§29). Nos dois casos falta a **função de domínio**, não o
agendamento — a §26 diz "resumo diário ou semanal" e não diz a que hora, e escolher a hora seria
inventar requisito.

---

## 9. Interface

### `packages/ui` — o design system

Próprio, e tirado do assunto: um instrumento de trabalho para quem mantém equipamento crítico
funcionando. Neutros com **viés frio esverdeado** (vidro de instrumento), destaque em **teal
profundo** em vez do índigo que todo SaaS usa, e semânticas (bom / atenção / crítico)
**separadas** do destaque — se "crítico" e "botão principal" fossem a mesma cor, um alerta de SLA
estourado ficaria indistinguível de um botão.

Tokens para cor, tipografia, espaçamento, raio, sombra, movimento, foco, alvos de toque e pontos
de quebra. Claro e escuro, em três estados (claro, escuro e "o que o sistema disser").

As decisões que os 32 testes protegem:

- **estado nunca é só cor** (WCAG 1.4.1): o chip carrega tom, **forma** (o ponto muda de
  geometria por tom) e **texto**;
- **botão é `type="button"` por padrão** — o padrão do HTML é `submit`, e um "Cancelar" dentro de
  formulário envia o formulário;
- **carregando não vira `disabled`** — desabilitar tira o botão da tabulação e o leitor de tela
  para de anunciá-lo;
- **erro não desaparece sozinho** — a WCAG 2.2 (2.2.1) não aceita limite de tempo que a pessoa não
  controla;
- **o diálogo devolve o foco a quem abriu**, mesmo aberto por estado e não pelo gatilho.

Fonte do sistema, **e é decisão**: o aplicativo de campo funciona sem rede, e fonte baixada é
fonte que falta no subsolo do hospital. A indireção existe — trocar por uma face hospedada conosco
é mudar uma linha.

### `apps/web` — esqueleto e primeiro fluxo

O esqueleto completo: entrada, escolha de organização, barra lateral ciente de permissão (oito
itens, organizados pela pergunta que cada um responde durante o expediente), busca global com
Ctrl+K, trilha, avisos, menu de conta, gaveta no celular, e uma tela de erro que distingue **sem
permissão** de **não existe** de **quebrou** — as três pedem ações diferentes.

O primeiro fluxo vertical, contra a API de verdade:

```
SOLICITAÇÃO → TRIAGEM → CRIAÇÃO DE OS → QUADRO → TRANSIÇÃO → AGENDA
```

Não é painel ornamental: é o caminho que prova que backend, contratos, RBAC, máquina de estados e
agenda funcionam **juntos**.

**As quatro decisões que mais importam nessas telas:**

1. **Arrastar no Kanban nunca muda o estado só na tela.** Arrasta → pede → espera → move.
   Recusado, o cartão volta com a explicação; faltando campo, o aviso diz **qual**. Mover e
   desfazer depois parece mais rápido e mente: a pessoa vê a OS em "concluída", vira para o lado,
   e quando olha de novo ela voltou.
2. **A agenda confere antes de salvar**, enquanto a pessoa escolhe. Ausência **bloqueia** — não
   existe "marcar assim mesmo" para férias. Sobrecarga **avisa**, e a carga do responsável aparece
   junto.
3. **As ações possíveis vêm do servidor**, com os campos que exigem. A tela não deduz o grafo de
   estados; deduzir criaria um segundo grafo, e os dois divergiriam na primeira mudança.
4. **Filtro mora na URL** — removível, compartilhável, sobrevive ao recarregamento. Filtro
   escondido em modal é filtro que a pessoa esquece que aplicou e depois jura que o sistema perdeu
   registros.

A build de produção passa: **606 kB de JS** (187 kB comprimido) e **32 kB de CSS**.

---

## 10. Desempenho, com 100 mil ordens de serviço

`tools/bench/seed.mjs` gera **100 mil OS** em duas organizações (85 mil e 15 mil), com 4 mil
ativos, 768 locais em árvore de três níveis e **distribuição torta** — 20% dos ativos concentram a
maior parte, porque dados uniformes fazem qualquer índice parecer bom.

`tools/bench/run.mjs` mede sob `aurora_app`, com contexto de tenant, como a API roda. Trinta
repetições por cenário, cinco de aquecimento descartadas.

| Cenário | p50 | p95 | meta |
| --- | ---: | ---: | ---: |
| lista de OS, filtrada por situação (filtro montado) | 42,7 ms | **114,5 ms** | 400 ms |
| lista de OS, filtrada por situação (catch-all, forma antiga) | 58,4 ms | 131,9 ms | 400 ms |
| lista de OS, filtrada por cliente e situação | 6,7 ms | 9,0 ms | 400 ms |
| lista de OS, página 50 (OFFSET 5000) | 59,8 ms | 146,5 ms | 400 ms |
| busca por patrimônio exato | 1,2 ms | 1,7 ms | 300 ms |
| busca textual por título | 67,0 ms | 103,9 ms | 400 ms |
| quadro por estado, com quebra de motivo | 41,8 ms | 94,6 ms | 400 ms |
| agenda da semana | 0,6 ms | 0,9 ms | 400 ms |
| ficha de OS com histórico | 1,1 ms | 1,4 ms | 200 ms |
| indicador: OS abertas por mês (12 meses) | 9,5 ms | 10,4 ms | 1000 ms |

**A meta da §41 — lista filtrada em menos de 400 ms com 100 mil OS — é cumprida, com folga de três
vezes no p95.**

### O número que quase saiu errado

A **primeira** execução, imediatamente após a carga em massa, deu p95 de **1.086 ms** na lista
filtrada e **665 ms** na rolagem profunda — as duas acima da meta.

Encontrei o padrão pega-tudo na consulta — `WHERE ($1 IS NULL OR coluna = $1)`, que impede o
planejador de estimar a seletividade e faz `status_category::text = $2` tornar o índice inútil —,
corrigi, e o número caiu para 186 ms. A conclusão fácil estava pronta: *"a correção resolveu, dez
vezes melhor"*.

**Não foi.** Medindo as **duas formas lado a lado**, na mesma sessão e com o mesmo aquecimento, a
diferença entre elas é de **15% no p95** — real, consistente, e muito menor que 10×. O que
explicava o 1.086 ms era **cache frio logo após a carga em massa**, não a forma da consulta.

A correção continua certa: o plano é melhor, as estimativas do planejador deixam de errar por duas
ordens de grandeza, e o padrão pega-tudo é o mesmo que produziu o defeito nº 40 do `PROGRESS.md`.
Mas atribuir a ela uma melhora de dez vezes seria mentira — e é o tipo de mentira que ninguém
confere, porque o número final está bonito.

**A forma antiga ficou no benchmark de propósito**, para que a comparação continue sendo medida e
não afirmada.

### Limites desta medição

- **Contêiner local**, não infraestrutura de produção. Serve para comparar decisões e pegar
  regressão; não prevê a latência de um servidor gerenciado com disco de rede.
- **Mede o banco**, não a rota inteira. Falta o custo de HTTP, serialização e resolução de
  contexto — que a suíte de API cobre em correção, e não em tempo.
- **Um cliente por vez.** Não há medição sob concorrência de dezenas de sessões, que é onde o pool
  e os bloqueios aparecem.

---

## 11. Épicos: o que está realmente pronto

### Entregues, com domínio, dados, borda HTTP e testes

EPIC-001 (fundação multitenant) · EPIC-002 (RBAC) · EPIC-003 (diretório) · EPIC-004 (catálogos) ·
EPIC-005 (ativos) · EPIC-006 (QR Code) · EPIC-007 (solicitações) · EPIC-008 (ordens de serviço) ·
EPIC-010 (SLA) · EPIC-011 (execução) · EPIC-012 (agenda) · EPIC-013 (planos preventivos) ·
EPIC-015 (estoque) · EPIC-016 (orçamentos) · EPIC-017 (contratos) · EPIC-018 (documentos) ·
EPIC-021 (indicadores) · EPIC-022 (auditoria) · EPIC-023 (notificações) · EPIC-024 (automações) ·
EPIC-025 (busca global)

### Parciais

- **EPIC-009 (interface de OS)** — lista, quadro com validação de arrasto e ficha com transições
  existem. Falta lista virtualizada para volume grande e PDF da OS.
- **EPIC-002 (RBAC)** — a tela de pessoas existe; a de papéis e a de escopo detalhado, não.

### Não implementados

- **EPIC-014 (PWA de campo)** — nenhuma linha.
- **EPIC-019 (Metrologia)** — nenhuma linha. Constava como entregue por causa da numeração
  trocada.
- **EPIC-020 (portal do cliente)** — nenhuma linha.

---

## 12. O que NÃO foi feito

Dito por extenso, porque o que falta importa tanto quanto o que existe.

| Item | Situação |
| --- | --- |
| EPIC-019 (Metrologia) | **zero** — constava como entregue por erro de numeração |
| `apps/portal` (EPIC-020) | **zero** |
| `apps/field` (EPIC-014) | **zero** |
| Teste de ponta a ponta com navegador (Playwright) | **zero** |
| Telas de ativos, estoque, contratos, indicadores, notificações, perfil | API pronta, tela não — cada rota responde dizendo isso |
| Auditoria de acessibilidade com ferramenta | não rodada |
| Digest de notificações (§26) | falta a função de domínio |
| Automação com gatilho de agenda (§29) | falta a função de domínio |
| Suíte de PostgreSQL real na integração contínua | depende de contêiner que só existe na máquina de desenvolvimento |
| Vulnerabilidades de dependência | 8 (`npm audit`), 2 altas em `multer` via `@nestjs/platform-express` |

Notas sobre três desses:

**Acessibilidade.** As regras da WCAG 2.2 estão implementadas e testadas uma a uma — foco visível,
alvo de 44 px, estado nunca só por cor, erro que não evapora, foco que volta a quem abriu o
diálogo, abas com navegação por setas, combobox com `aria-activedescendant`. Isso **não substitui**
uma varredura com ferramenta.

**Suíte de PostgreSQL real.** Enquanto não houver serviço de banco no fluxo de CI, ela é uma
verificação manual — e verificação manual é verificação que alguém apressado pula.

**Vulnerabilidades.** A correção do `multer` exige atualização com quebra de compatibilidade do
`@nestjs/platform-express`, que não cabia no meio desta sessão sem risco de derrubar as 1.364
provas.

---

## 13. Bloqueios ativos

**Um só:** o acesso ao projeto Supabase `egoajboqzhnvkpenrszw` (seção 4).

Ele bloqueia **apenas** a Fase 3 — aplicar migrations no remoto e validar lá. Todo o resto seguiu,
inclusive tudo o que dependia de PostgreSQL real, que passou a rodar localmente.

---

## 14. O que eu faria em seguida, nesta ordem

1. **Portal do cliente (EPIC-020)** — experiência própria, superfície de escrita mínima, e um
   teste de API provando que nota interna, custo interno, margem e fornecedor **não vazam** — não
   escondidos na interface, ausentes na resposta.
2. **PWA de campo (EPIC-014)** — tela "HOJE", fila offline idempotente, e o teste real de 13
   passos com a rede desligada. Existir Service Worker não é o critério; nenhum dado desaparecer
   é.
3. **Playwright** — login, troca de organização, isolamento, triagem, OS completa, agenda,
   orçamento, portal, offline.
4. **EPIC-019 (Metrologia)** — o épico inteiro, do zero.
5. **Telas restantes** — ativos, estoque, contratos, indicadores.

---

*Relatório gerado a partir de medição direta do repositório, do banco e das suítes de teste.
Detalhe adicional em `docs/PROGRESS.md`, que traz a tabela de 49 defeitos com o que cada um
custaria se tivesse chegado a um cliente.*
