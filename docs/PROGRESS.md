# Aurora — progresso do desenvolvimento

Fonte de verdade de negócio: `docs/AURORA-CMMS-SPEC-v0.2.md`.
Fonte de verdade de código: este repositório e o Git.

---

## Estado atual

| Item                             | Situação                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ |
| SPEC                             | **v0.2**, auditada automaticamente (0 erros, 0 avisos), 49 seções, 28 ADRs      |
| Fase                             | **F9 — interface**                                                                            |
| Épicos concluídos                | EPIC-001 (fundação), EPIC-002 (RBAC), EPIC-003 (diretório), EPIC-004 (catálogos), EPIC-005 (ativos), EPIC-006 (QR Code), EPIC-007 (solicitações), EPIC-008 (ordens de serviço), EPIC-011 (execução), EPIC-010 (SLA), EPIC-013 (planos preventivos), EPIC-015 (estoque), EPIC-017 (contratos), EPIC-016 (orçamentos), EPIC-012 (agenda), EPIC-018 (documentos), EPIC-021 (indicadores), EPIC-023 (notificações), EPIC-024 (automações), EPIC-025 (busca global), EPIC-022 (auditoria) |
| Épico seguinte                   | EPIC-009 (interface de OS), EPIC-014 (PWA), EPIC-019 (metrologia), EPIC-020 (portal)   |
| Testes                           | **1364** (68 arquivos) + **29** só contra PostgreSQL real, todos verdes |
| Migrations                       | 42 (`0000` a `0041`), idempotentes, reprodutíveis do zero                       |
| Supabase remoto                  | **BLOQUEADO** — projeto do Aurora não identificado (ADR-025, OQ-16)             |
| Banco de desenvolvimento e teste | PGlite (PostgreSQL 16.4 em processo) — ADR-022; PostgreSQL 16.14 em Docker para pool, concorrência e RLS sob papel real |

Portão de qualidade (`npm run verify`): auditoria da SPEC → typecheck → lint → conferência de contratos → testes.
No CI acrescentam-se `format:check` e varredura de segredos.

### Reconciliação de 29/08/2026 — a numeração estava errada

Uma conferência entre o Git, este documento e a SPEC encontrou **quatro épicos rotulados com o número errado**, e um número usado por engano. A SPEC (§39 e §43) é a fonte de verdade da numeração, e ela diz:

| Implementado como | É, na SPEC | Módulo |
| --- | --- | --- |
| EPIC-012 | **EPIC-013** | Planos de manutenção preventiva |
| EPIC-013 | **EPIC-012** | Agenda |
| EPIC-019 | **EPIC-023** | Notificações |
| EPIC-023 | **EPIC-025** | Busca global |

Nada de comportamento muda — o que muda é o rótulo. Mas rótulo errado num sistema de 27 épicos é o que faz alguém procurar a metrologia dentro do módulo de notificações: **o EPIC-019 da SPEC é "Metrologia: calibração, padrões e segurança elétrica", e nunca foi implementado**. O relatório anterior o dava como concluído por causa dessa troca.

Corrigido em 24 arquivos de implementação (comentários de cabeçalho, migrations e testes). A SPEC não foi tocada.

**Sobre o EPIC-009.** Ele não é um épico separado: a SPEC o agrupa como "EPIC-008 · EPIC-009 — Ordens de serviço e máquina de estados", e a parte que leva o número 009 é a **interface** — lista virtualizada com filtros em chips, visões salvas, Kanban com validação de transição no *drop*, PDF da OS. O motor está pronto (EPIC-008); a interface não. Está aberto, e é o primeiro alvo do trabalho de frontend.

**Contagem real:** 21 épicos concluídos por identificador da SPEC. O relatório anterior dizia "vinte" no texto e listava 21 na própria tabela.



---

## EPIC-001 — Fundação multitenant · **concluído**

**Monorepo e tooling**

- npm workspaces (ADR-021), lockfile versionado
- TypeScript `strict` + `noUncheckedIndexedAccess`, project references, `tsc -b` limpo
- ESLint 9 + typescript-eslint, Prettier
- Regra de lint que barra `unsafeCrossTenant` e `db.query` direto fora da infraestrutura de dados — **verificada com probe: dispara de verdade**
- CI (GitHub Actions): auditoria da SPEC, typecheck, lint, formatação, testes, varredura de segredos
- `.env.example` sem nenhum valor real; `tools/ci/check-secrets.mjs` bloqueia segredo versionado

**Banco**

- Papéis separados: `aurora_owner`, `aurora_migrator`, `aurora_app`, `aurora_readonly`, `aurora_publisher`, `aurora_identity`
- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** em 100 % das tabelas tenant-scoped
- `aurora.current_organization_id()` e demais funções de contexto, com **falha fechada**
- Migrator com checksum: detecta migration alterada depois de aplicada
- Trilha de auditoria com diff por campo, redação de colunas sensíveis, somente-inserção
- Outbox transacional (`domain_events`) + publicador sob `aurora_publisher`

**Plataforma e API**

- `withTenant` como caminho único para tabela de tenant; contexto sempre transaction-local
- UUID v7 gerado na aplicação, monotônico dentro do milissegundo, sem regressão em relógio para trás
- NestJS com DI por token explícito (sem `emitDecoratorMetadata`), middleware funcional
- Erros RFC 9457, sem stack trace no corpo; logs estruturados com redação
- `organization_id` **nunca** aceito do cliente como autorização

### Pendente do EPIC-001

- Geração de OpenAPI a partir dos controllers
- ~~pg-boss como agendador durável — adiado~~ **feito.** O pg-boss roda também em PGlite (adaptador `fromPglite`), então a suíte inteira dos trabalhos não depende de Docker. O `IntervalScheduler` foi REMOVIDO, e não deixado ao lado: `setInterval` não sobrevive a reinício, não coordena duas instâncias do worker e engole a falha num `catch`. Um substituto ruim deixado por perto é um substituto que alguém usa.

---

## EPIC-002 — Papéis e permissões · **concluído**

- Catálogo de **107 permissões** como fonte única em código (`packages/domain/src/permissions.ts`); o banco é espelho e um teste garante que não divergem
- **11 papéis de fábrica**, `is_system` e não editáveis: customizar é duplicar
- `deny` individual vence qualquer concessão de papel; revogação exige justificativa e aceita expiração
- `escalationCheck`: ninguém concede o que não tem
- `isOverPermissive`: sinaliza papel com mais de 70 % das permissões — o defeito que a auditoria encontrou no grupo "Técnico" da referência
- `PermissionsGuard` global + `@RequirePermissions`; **403 nomeia a permissão que falta**, na API e não só na interface

---

## EPIC-003 — Diretório · **concluído**

Clientes, contatos, tipos de local, árvore de locais, fornecedores, equipes, calendários e bloqueios de disponibilidade.

**A decisão que organiza o épico:** a aplicação escreve intenção, o banco mantém a estrutura.
`path` e `depth` nunca aparecem em um `INSERT` ou `UPDATE` do código de aplicação — são derivados por gatilho (`0009`). Criar um local é dizer quem é o pai; mover é dizer quem passa a ser o pai. Cascata, ausência de ciclo, limite de 8 níveis e regra de aninhamento ficam por conta do PostgreSQL, e continuam valendo para importação, correção manual e migração futura.

**Critérios de aceite do épico, verificados**

- Mover uma subárvore de **500 locais** atualiza todos os caminhos e profundidades em uma transação (~0,6 s no PGlite)
- Tipo inválido para o pai é recusado com mensagem que **nomeia os tipos permitidos**
- Arquivar local com estrutura ativa abaixo é recusado com a **lista de pendências**

**Casos de borda cobertos:** ciclo ao mover; profundidade acima do limite, na criação e no movimento; clínica com um único local raiz; local móvel sem endereço; nome de fornecedor repetido ignorando caixa e acento; janelas de calendário encostadas versus sobrepostas.

**Escopo por local** (`aurora.accessible_location_ids`): consulta por prefixo de caminho, indexada, sem CTE recursiva por requisição. Testado na borda HTTP: um vínculo restrito não vê a árvore inteira **nem pedindo `?root=` de um ramo fora do escopo**.

### Adiado deliberadamente

- **Rotas de escrita de equipe e fornecedor.** Só a leitura foi exposta. Escrita entra com as telas que a usam — superfície pública sem consumidor é superfície sem teste de uso real.
- **Bloqueio de arquivamento por ativo alocado.** A função `archiveLocation` hoje protege a árvore, não o inventário; a verificação de ativos entra no EPIC-005, junto com a tabela `assets`. Está documentado no próprio código, não implícito.
- **Importação de árvore por planilha** (parte de BL-014): depende do motor de importação do EPIC-005.

---

## EPIC-004 — Catálogos governados e campos personalizados · **concluído**

O problema, medido pela auditoria: 651 tipos de equipamento, 360 problemas, 344 origens; "fechada" convivendo com "Fechada" em 312 OS; "Emprestimo" ao lado de "Empréstimo de equipamento". Indicador fragmentado e combo inoperável não foram descuido de quem cadastrou — foram ausência de governança.

**As três peças**

1. Chave técnica estável (`key`, imutável) separada do rótulo (`label`, livre)
2. Unicidade sobre o rótulo **normalizado** — sem acento, sem pontuação, sem caixa
3. Arquivar e mesclar, para que a lista suja de hoje tenha conserto

`aurora.normalize_label` é `IMMUTABLE`, alimenta uma coluna gerada e um índice único, e **não usa `unaccent`** (extensão, ADR-026). Um teste compara a implementação SQL com a de TypeScript sobre 15 entradas: duas implementações da mesma regra divergem sozinhas se ninguém comparar.

**ADR-028 — catálogos planos em uma tabela só.** `catalog_items` com discriminador `catalog_key`. Isto **não** é a `Empresa` polimórfica: lá, conceitos com atributos diferentes foram forçados numa tabela e nenhum podia ter campo próprio. A regra aqui é explícita — mesma forma, mesma tabela; forma diferente, tabela diferente. `wait_reasons` continua tabela própria por ter `pauses_sla`.

**Campos personalizados (ADR-009).** Definições tipadas em tabela; valores em `jsonb`. Validação pura em `packages/domain`, usada pelo servidor e pelo formulário — uma implementação só, porque duas não concordariam. Chave e **tipo** imutáveis (mudar `text` para `number` invalidaria de uma vez todo valor já gravado). Limite de 50 por entidade aplicado por gatilho, não só por código.

**Governança por papel.** `organization.manage_catalogs` foi para o gestor de manutenção, não só para o administrador: manter a curadoria de taxonomia longe de quem entende do domínio é parte do que produziu os 360 "problemas relatados" que ninguém podia arrumar. Campos personalizados continuam com o administrador — mudam a estrutura do formulário para todo mundo.

### Adiado deliberadamente

- **Índice GIN em `custom`** só nas tabelas que existem hoje (customers, locations, suppliers). Ativos, OS e solicitações ganham o seu na migration que os criar.
- **Promoção de campo personalizado a coluna nativa** (§29): é métrica de produto, não código.

---

## EPIC-005 — Ativos e classificação · **concluído**

Cadeia fabricante → modelo → ativo. Na referência, fabricante e modelo são texto livre, o que impede responder "quantos BeneHeart R3 temos e qual a taxa de falha desse modelo?" — a pergunta que justifica trocar de fornecedor.

**Duas regras da SPEC que viraram estrutura, e não convenção**

1. **Unicidade configurável.** A organização escolhe quais de {tag, série, patrimônio} não repetem, e em que escopo. Um gatilho que lesse a configuração e consultasse antes de inserir teria corrida entre a leitura e a escrita — duas importações simultâneas passariam as duas. Aqui a unicidade é um **índice único de verdade** sobre a projeção `asset_identifiers`: o gatilho decide quais linhas existem, o índice decide se elas coexistem. Configurabilidade na projeção, garantia no índice.
2. **Transferência é operação, não edição.** Um gatilho recusa qualquer `UPDATE` que mexa em `location_id` ou `customer_id` fora de uma transferência declarada. A marca é uma configuração local de transação: morre no COMMIT e não pode ficar ligada por engano. A API não poderia oferecer o atalho nem se quisesse.

**Critérios de aceite, verificados**

- **Relatório de erro por linha** na importação: cada linha vai num `SAVEPOINT`, a que falha volta sozinha e as demais seguem. Medido: 3.000 ativos em 9,5 s no PGlite — 3,2 ms por linha, o que projeta ~85 s para as 27 mil do critério, cujo alvo é 10 minutos.
- Duplicidade em campo configurado bloqueada na importação **e** no formulário, pelo mesmo índice.
- Transferir não reescreve o passado: a movimentação é uma linha nova em `asset_transfers`.

**Casos de borda cobertos:** ativo sem modelo cadastrado; empréstimo para outro cliente (exige data de devolução); descomissionar conjunto com componente em operação; fabricante grafado de várias formas na planilha ("Mindray"/"MINDRAY" viram um, "Líder" vai para curadoria); horímetro que regride.

**Token do QR** — 26 caracteres, 130 bits, alfabeto sem `0/O` e `1/I/L`, porque a etiqueta vai ser lida por pessoa quando o leitor falhar.

**`asset.import` separada de `asset.create`** — o técnico cadastra o ativo que achou em campo, e isso é bom; importar planilha cria milhares de registros de uma vez e é o caminho mais rápido para duplicar um acervo inteiro.

### Adiado deliberadamente

- **Indicadores da ficha 360°** (MTTR, MTBF, disponibilidade): dependem de ordens de serviço — EPIC-021. A rota já devolve dados, specs resolvidas, garantia, idade e histórico de transferências.
- **Medidores**: o modelo e a invariante de regressão entram agora para não travar manutenção por condição; uso efetivo é da Fase 4.

---

## EPIC-006 — QR Code e etiquetas · **concluído**

`/q/{token}` é a **única rota do sistema que responde sem sessão**, e por isso a suíte inteira é escrita do ponto de vista de quem tenta abusar dela.

**Três decisões que a moldam**

1. **Fora do prefixo `/v1`.** O endereço vai impresso numa etiqueta que ficará colada num equipamento por anos; versão de API numa etiqueta física é uma promessa que não temos como cumprir.
2. **Resposta idêntica para token inexistente e para organização que não autorizou acesso anônimo.** Distinguir os dois faria da rota um oráculo: quem tivesse uma lista de tokens saberia quais existem. Um teste compara as duas respostas byte a byte.
3. **A consulta vai por função `SECURITY DEFINER`** de argumento fixo (migration 0017), pelo mesmo padrão da resolução de identidade — sem contexto de tenant, a RLS nega tudo, corretamente.

**O que a rota devolve, e o que não devolve.** Quem escaneia está fisicamente diante do equipamento, então nome e categoria não revelam nada que a pessoa não esteja vendo. Não saem daqui: número de série, patrimônio, caminho da árvore de locais, valores, observações internas, nem o id do ativo. Há teste que procura cada um deles no corpo da resposta.

**`allow_anonymous_requests` tem padrão falso.** Uma etiqueta fotografada e repassada não deve virar canal de descoberta de inventário alheio.

**Troca de token** (`rotate-qr`): invalida a etiqueta antiga na hora e devolve o token anterior, para quem operou identificar a etiqueta a recolher.

---

## EPIC-007 — Solicitações e triagem · **concluído**

ADR-002 é a decisão mais consequente da SPEC: `service_request` é entidade própria, distinta de `work_order`. O que a separação compra, concretamente:

- solicitação recusada **não** vira "OS cancelada" poluindo o denominador de todo indicador de ordem de serviço;
- duplicata é **preservada** apontando para a original, não destruída;
- o relato do cliente é **imutável**; o diagnóstico do técnico vive na OS;
- o portal escreve em **uma** tabela, por duas rotas — abrir e cancelar.

**A máquina de estados vive em código puro, e não em tabela configurável** — ao contrário da máquina de ordens de serviço, que é configurável por organização (ADR-003). Não é inconsistência: o ciclo da solicitação é o contrato com o cliente, e contrato que cada organização redesenha deixa de ser contrato.

**Três invariantes estruturais**

1. **Numeração sem colisão.** `SR-{ano}-{sequência}`, série própria por organização e ano, saindo de um contador com bloqueio de linha — não de `max(number) + 1`, que sob concorrência gera dois números iguais. Teste: cem criações seguidas, cem números distintos.
2. **Estado terminal carrega o que o terminal significa.** `rejected` sem motivo e `duplicate` sem original são estados que mentem. Restrição de tabela, não validação de formulário.
3. **O relato é imutável depois do envio.** Gatilho recusa a edição de `summary`/`description`. Na referência, a descrição do solicitante era sobrescrita pelo técnico, e com ela sumia a única evidência do que o cliente pediu.

**Concorrência otimista** por `version`: dois coordenadores triando a mesma solicitação não sobrescrevem a decisão um do outro em silêncio.

**Detecção de duplicidade avisa, não bloqueia** (§08). Os avisos vêm na resposta da criação, e não numa consulta anterior — entre "consultar" e "enviar" alguém pode ter aberto a mesma.

**Uma rota para todas as transições** (`POST /:id/transitions`), e não `/accept`, `/reject`, `/merge` separadas: o grafo é a fonte de verdade, e uma rota por transição criaria um segundo lugar onde elas estão listadas.

**O mapa estado → evento é explícito**, não derivado do nome: o estado é `duplicate` e o evento é `merged`; o estado é `info_needed` e o evento é `info_requested`. Derivar emitiria tipos que o catálogo recusa, e a recusa só apareceria em produção.

### Adiado deliberadamente

- **`accepted` → criação de 1..N ordens de serviço.** O critério de aceite "uma solicitação com 3 ativos gera 3 OS vinculadas em uma operação" depende de `work_orders`, que é o EPIC-008 — a SPEC declara EPIC-007 antes, mas o critério atravessa os dois. A transição para `accepted` já funciona e emite o evento; o efeito colateral entra junto com a OS, e o critério é verificado lá.
- **Avaliação 1–5 e conversão automática opcional**: colunas existem (`rating`, `rating_comment`), fluxo entra com o portal (EPIC-020).

---

## EPIC-008 — Ordens de serviço e máquina de estados · **concluído**

O registro central do produto. A referência tinha **42 estados** porque codificou o motivo dentro do estado: "Aguardando peças", "Aguardando aprovação do orçamento", "Aguardando liberação da unidade", "Aguardando empresa externa". Cada combinação de situação e causa virou um estado, e a lista explodiu combinatoriamente.

**Três eixos independentes (ADR-003, ADR-004)**

| Eixo | Quem controla | Para que serve |
| --- | --- | --- |
| **Categoria** | Fixa na plataforma, nunca editável | É o que o software sabe interpretar: se conta como ativo, se o relógio corre, se o equipamento está parado. É por isso que o produto continua funcionando quando a organização cria uma situação que ninguém previu. |
| **Situação** | Configurável, declarando uma categoria | É o vocabulário do cliente. Renomear é livre; mudar a categoria de uma situação de sistema não é, porque reinterpretaria toda OS já registrada nela. |
| **Motivo de espera** | Configurável, com `pauses_sla` e responsável | "Quanto tempo perdemos esperando peça" vira uma consulta indexada. |

**Falta de peça NÃO pausa o SLA por padrão.** É responsabilidade da organização, não do cliente, e um relógio que pausa aí perdoaria o próprio atraso. A coluna é configurável — mas o padrão de fábrica não perdoa.

**A tabela É a regra.** O grafo vive em `work_order_status_transitions`. Não existe `if` em código que decida se uma transição vale: o motor lê as linhas. E um gatilho recusa qualquer mudança de situação não declarada — o motor em TypeScript dá a mensagem boa, com a lista de saídas possíveis; o banco garante que ninguém pule o motor.

**Snapshot do ativo e do local**, tirado uma vez na abertura e não editável. Transferir um ativo de setor não reescreve onde o serviço aconteceu. A referência avisava que "OS existentes não poderão ser editadas caso altere o proprietário" — sintoma de que lá a mudança de dono corrompia o histórico.

**Critérios de aceite, verificados**

- Transição não declarada é recusada na API **e** no banco, com mensagem que nomeia as possíveis
- Ir para uma situação que exige motivo, sem motivo, é impossível — no domínio e por restrição de tabela
- Toda transição grava histórico com duração no estado anterior e emite o evento certo
- O quadro Kanban traz a **quebra por motivo** dentro da coluna de espera, agrupada no banco

**Fecha também o critério do EPIC-007**: uma solicitação com 3 ativos gera 3 OS vinculadas numa operação — e se a transição da solicitação não valer, nenhuma OS é criada.

### Adiado deliberadamente

- **Bloco de conclusão ligado aos fatos reais.** O motor (`checkCompletion`) está escrito e testado com todos os oito requisitos; o que falta é a fonte dos fatos — checklist, horas apontadas, fotos, assinatura — que é o EPIC-011. Hoje a transição para "Concluída" exige `resolution`, e os demais requisitos entram quando houver o que verificar.
- **Meta de 400 ms com 100 mil OS**: os índices estão desenhados para ela (`wo_customer_status_idx`), mas medir exige PostgreSQL real com volume — não PGlite em WASM. Registrado como pendência de infraestrutura, não de código.
- **PDF da OS** e **visões salvas**: dependem da camada de apresentação.

---

## EPIC-011 — Execução: checklists, horas e assinatura · **concluído**

**ADR-012 — o checklist é relacional e versionado.** A referência o guarda como array JSON numa coluna: simples de escrever, impossível de versionar, consultar ou agregar. "Quantos ventiladores reprovaram no teste de pressão no último trimestre?" não tem resposta a partir de um JSON solto.

Publicar uma versão a torna **imutável por gatilho** — template, seções e itens. Mudar exige criar a próxima versão, e as respostas antigas continuam apontando para a que foi de fato usada. Um teste muda a faixa na v2 e confere que a resposta da v1 não se mexe.

**O motor vive no domínio**, testado sem banco: veredito automático, visibilidade condicional e completude precisam valer igual na web, no aplicativo de campo e no servidor. Item oculto por condição não é obrigatório e não entra na completude — sem isso, um checklist condicional nunca fecharia.

**O veredito é do servidor, nunca do cliente.** Aceitar `verdict` no corpo permitiria marcar como aprovado um valor fora da faixa; há teste que envia `verdict: pass` com valor fora da faixa e confere que volta `fail`.

**Três decisões de execução**

1. **Custo/hora congelado no apontamento.** Reajustar a tabela não pode reescrever o custo de uma OS fechada mês passado.
2. **Um cronômetro aberto por pessoa**, e apontamentos que não se sobrepõem. Duas OS em execução pela mesma pessoa no mesmo minuto é impossível no mundo físico e, se aceito, dobra a hora faturada.
3. **A assinatura guarda o hash do que foi assinado.** O produto não impede alterar uma OS assinada — impede fingir que a assinatura ainda cobre o texto novo.

**O bloco de conclusão passou a valer.** Roda dentro da transição para "Concluída", com os requisitos configurados por natureza, e devolve **412 com a lista do que falta, item a item, com o detalhe**. Natureza sem requisitos não impõe burocracia nenhuma.

---

## EPIC-010 — SLA · **concluído**

A referência põe `tempo_atendimento` e `tempo_fechamento` em minutos **no equipamento** e mede "% de chamados cumpridos dentro do prazo". É um começo correto e não suporta contrato, horário comercial nem feriado.

**O cálculo de tempo útil é a peça mais fácil de errar do produto**, e o erro é silencioso: um SLA que diz "cumprido" quando estourou não avisa ninguém. Por isso o motor é puro, percorre dia a dia no fuso do calendário, e tem 33 testes com fusos e feriados reais — incluindo a semana da virada do horário de verão em Nova York e o caso da SPEC: uma prestadora de Belo Horizonte atendendo uma base em **Manaus**, que não tem horário de verão.

**Sem dependência de biblioteca de fuso**: `Intl.DateTimeFormat` com `timeZone` já resolve, e vem no Node.

**Três decisões estruturais**

1. **A política resolvida é congelada no relógio** — alvo em minutos e calendário inteiro. Trocar o contrato amanhã não reescreve se o atendimento de ontem cumpriu o prazo.
2. **Os dois tempos são gravados sempre**: corridos e úteis. Guardar só o segundo obrigaria a recalcular o histórico ao mudar um calendário, e histórico recalculado deixa de ser histórico.
3. **Reabrir cria um relógio novo**; o anterior permanece. Reincidência se mede exatamente por isso.

**O ADR-004 provado de ponta a ponta**: falta de peça **não** pausa o relógio (o atraso é da organização); espera por aprovação de orçamento pausa. A retomada empurra o prazo pelo tempo **útil** perdido — uma pausa de sexta 18 h a segunda 8 h não consome prazo nenhum.

**Cascata de resolução** (§11): ativo → cliente → organização, com o degrau do contrato deixado pronto para o EPIC-017. Sem calendário configurado, o padrão é 24×7: SLA que funciona, não SLA que explode.

### Adiado deliberadamente

- **Degrau do contrato** na cascata: depende do EPIC-017. O `COALESCE` já está escrito para receber a coluna sem mudar a ordem.
- **A varredura roda sob demanda**, não em cron: o agendador durável depende de PostgreSQL real (pendência do EPIC-001). A função está pronta e testada; falta quem a chame de minuto em minuto.

---

## EPIC-013 — Planos de manutenção preventiva · **concluído**

O modelo da referência é bom — ciclos, janela, progresso, conformidade, geração automática. Duas limitações reais foram corrigidas.

**Correção 1 — a frequência é da tarefa, não do plano.** Lá, ter preventiva semestral e calibração anual no mesmo equipamento exige dois planos; o tenant auditado tem **826 planos**, muitos deles duplicatas do mesmo escopo com ritmos diferentes — e cada duplicata é um lugar a mais onde alguém pode esquecer de incluir o equipamento novo.

**Correção 2 — o alvo é uma expressão, não uma lista de caixas marcadas.** "Todos os ativos da categoria Ventilador pulmonar na subárvore UTI" continua valendo para o ventilador que chegar amanhã. Há teste que cria um ativo depois do plano e confere que ele entra sozinho no escopo.

**Detalhes que decidem se o indicador é levado a sério**

- **Tolerância**: uma preventiva executada um dia depois do previsto não é não conformidade. Contá-la como tal faz as pessoas ignorarem o relatório em vez de agir sobre ele.
- **O denominador exclui as dispensadas**: um ativo emprestado a outro hospital não podia receber a preventiva. Mas dispensar **exige justificativa de 10 caracteres**, registrada com autor e data — é isso que impede a dispensa de virar a saída fácil para melhorar o número.
- **A âncora do ciclo é o fim do anterior, nunca "hoje"**: ancorar em hoje faria a data escorregar a cada geração atrasada, e em dois anos a preventiva de janeiro estaria acontecendo em março.
- **31 de janeiro + 1 mês = 28 de fevereiro**, não 3 de março. Somar ingenuamente faria a preventiva de fim de mês escorregar até sair do mês.
- **O item acompanha a OS por gatilho**: fechar a OS marca o item como concluído. Sem isso, a conformidade mediria a disciplina de marcar, não a de executar. Cancelar a OS devolve o item para pendente — deixá-lo como "gerado" o faria parecer resolvido.

### Adiado deliberadamente

- **Gatilho por uso e por condição** (`trigger = meter | condition`): Fase 4 na SPEC. As colunas existem e a varredura já filtra por `trigger = calendar`.
- **`include_late_assets`**: a coluna existe e o comportamento padrão (entrar só no ciclo seguinte) é o implementado; a inclusão tardia entra quando houver tela que a configure.

---

## EPIC-015 — Estoque · **concluído**

Falta de peça é a maior causa de OS travada: **789 registros de "aguardando peça"** na referência auditada. O estoque não é módulo acessório aqui — é o desbloqueador do fluxo principal, e três decisões estruturais sustentam isso.

**1 — O movimento é um livro-razão imutável.** Não se apaga nem se edita um movimento; há gatilho que recusa `UPDATE` e `DELETE` na tabela. Correção é sempre um movimento inverso com elo para o original. Um estoque cujo histórico pode ser reescrito não explica a diferença que o inventário encontrou — e diferença inexplicada é o que faz o almoxarife parar de confiar no sistema e voltar para a planilha.

**2 — O saldo é projeção; a proibição de negativo é restrição, não leitura prévia.** `stock_balances` é mantido por gatilho a partir do razão, e saldo negativo é recusado por `CHECK`. Duas baixas simultâneas do último item passariam as duas por uma verificação prévia; nenhuma passa por um `CHECK`. O erro devolvido diz **quanto há**, porque "saldo insuficiente" sem o número obriga a uma segunda consulta.

**3 — Reserva reduz o disponível, não o físico.** Reservar peça para uma OS não tira nada da prateleira. É a diferença entre "tem" e "posso usar", e é ela que impede duas OS de contarem com a mesma peça — o defeito que trava as duas em vez de uma. O disponível (`on_hand − reserved`) é calculado na consulta de saldo, num lugar só, para ninguém repetir a subtração e errar o sinal.

**Outras decisões**

- **Custo médio móvel só se move na entrada.** Recalcular na saída faria o custo derivar a cada baixa, e o valor do acervo passaria a depender do ritmo de consumo. Há teste que fixa isso.
- **Almoxarifado que aceita negativo ainda exige justificativa** em cada movimento que a gere (consignado, por exemplo). Liberar o negativo é decisão da organização; deixar de dizer por quê, não.
- **Cancelar OS libera as reservas.** Sem isso a peça fica presa a um trabalho que não vai acontecer, e o próximo técnico recebe "não tem" de um item que está na prateleira.
- **Peça pendente entra no bloco de conclusão** (`partsPending`): não se conclui OS com reserva aberta sem consumo nem devolução, porque dali em diante o saldo mentiria.
- **O carro do técnico é um almoxarifado com dono** (`kind = 'van'` exige `owner_membership_id`), não um lugar sem contabilidade.

### Adiado deliberadamente

- **Lotes e números de série** (`item_tracking = lot | serial`): as tabelas e a coluna existem, e `stock_lots` já é escrita; exigir o rastreio na baixa entra com o épico de rastreabilidade, que é onde isso tem consumidor.
- **Requisição de compra a partir do mínimo**: `setMinimum` e `checkMinimum` já sinalizam a ruptura; a compra em si é o EPIC-016 (orçamentos e suprimento).

---

## EPIC-017 — Contratos · **concluído**

Na referência auditada, contrato é cadastro documental: nome, apelido, contratante, datas. Aqui é o instrumento que governa SLA, escopo, preço e medição — e é o que sustenta a conversa de renovação. A diferença prática aparece quando o cliente pergunta "o que eu paguei e o que eu recebi neste mês": lá a resposta é montada à mão numa planilha, com números que ninguém reproduz três meses depois.

**A cobertura é expressão, não lista.** "Todos os ativos da categoria Ventilador na subárvore UTI" continua valendo para o ventilador que chegar amanhã — e há teste que cadastra um ativo depois do contrato e confere que ele entra sozinho. Uma lista marcada a mão envelhece no dia seguinte, e o ativo que ficou de fora é justamente o que gera a discussão sobre quem paga o conserto.

**O preço dessa escolha, dito por extenso.** Dois contratos podem passar a disputar o mesmo ativo sem ninguém ter feito nada: basta o ativo novo casar com as duas expressões. A validação na escrita pega o conflito entre os ativos que existem hoje — e lista quais, com o número do outro contrato, porque "conflito" sem o onde faz o operador desistir e cadastrar o escopo errado. O conflito que nasce depois é resolvido por **especificidade**: vence quem nomeia mais de perto, com a profundidade da subárvore no desempate. Devolver os dois e deixar a aplicação escolher faria a política de SLA de uma OS depender da ordem de leitura do banco — pior que uma regra discutível, porque seria uma regra invisível.

**O degrau que faltava na cascata de SLA.** A migration 0027 tinha deixado o `COALESCE` escrito para receber o contrato entre o ativo e o cliente; a 0031 cumpre isso sem mexer em quem já dependia da ordem, e o refinamento por criticidade entra DENTRO do degrau do contrato, por ser refinamento do mesmo acordo. A OS nasce carimbada com o contrato **por gatilho**, e não pela aplicação: OS nasce por três caminhos — manual, a partir de solicitação e gerada por plano — e carimbar num só lugar da aplicação seria descobrir meses depois que as preventivas não tinham contrato.

**A medição sai dos fatos e depois congela.** Todos os números vêm das linhas que operaram o mês — OS, apontamentos, movimentos de estoque, relógios, itens de ciclo. Nenhum é digitado, e é isso que permite ao cliente conferir qualquer total descendo até a OS que o gerou. Enquanto o período está aberto ele se recalcula; fechado, o gatilho recusa escrita e exclusão. Sem isso, reabrir uma OS de março mudaria a fatura de março que o cliente já pagou, e existiriam dois relatórios do mesmo mês, ambos emitidos por nós.

**Sobre a glosa: não há fórmula padrão, e isso é deliberado.** A auditoria não confirmou nenhuma regra de glosa na referência. Inventar uma escreveria no sistema uma cláusula que não está em contrato nenhum — o tipo de número que vira discussão jurídica com o cliente. Sem `penalty_percent_per_breach` configurado, o cálculo devolve **nulo**, não zero, e a medição mostra os SLA violados sem atribuir valor a eles. E `applied` é `false` no TIPO, não no valor: desconto em fatura de cliente é ato comercial, alguém assina embaixo.

**Outras decisões**

- **Contrato sem cobertura não se ativa.** Ativá-lo produziria o pior estado possível: a interface diz "vigente", o cliente acredita que está coberto, e a cascata não encontra nada.
- **Expirar é derivado da data, não da varredura.** Um contrato que só expira quando o cron roda continua cobrindo ativo depois de vencido toda vez que o cron falha.
- **Três respostas para cobertura de serviço**, não duas: incluído, incluído mas faturado à parte, e fora do escopo. Colapsar as duas últimas perderia de vista o serviço que o contrato prevê e cobra — que é o que entra na fatura como excedente.
- **`GET` de período mede sem gravar**; fechar é rota própria com permissão própria (`contract.close_period`). A varredura de alertas é `POST` porque muda estado — um `GET` que expira contrato é armadilha para qualquer pré-carregamento de link.
- **O alerta de renovação diz se a janela de aviso já fechou.** Num contrato com renovação automática e 60 dias de aviso prévio, faltando 45 dias a decisão já foi tomada por omissão. Avisar "vence em 30 dias" sem dizer isso convida o coordenador a uma negociação que ele já perdeu.

### Adiado deliberadamente

- **Tabela de preço do contrato** (a cascata `customer_item_alias` → `price_list` → catálogo): o primeiro degrau existe desde o EPIC-015; a tabela de preço nasce com o EPIC-016, que é quem a consome.
- **Reajuste por índice**: `adjustment_index` guarda qual índice, mas aplicar o reajuste exige série histórica de índice econômico, que não existe no sistema e não se inventa.
- **Franquia por natureza de OS**: hoje a franquia é de chamados e de horas, como a SPEC descreve. Franquia por natureza entra quando algum contrato real pedir.

---

## EPIC-016 — Orçamentos · **concluído**

Este épico fecha um elo aberto desde o EPIC-008: o motivo de espera "aguardando aprovação de orçamento" existia na máquina de estados da OS, e não havia o que aprovar. Agora a proposta sai, a OS entra em espera com o SLA pausado, e a aprovação devolve a OS ao trabalho reservando as peças.

**Revisar cria versão; não sobrescreve.** A referência tem "Modificar", que reescreve a proposta no lugar. O histórico de propostas é argumento comercial — saber que a primeira versão custava 40 % mais é o que sustenta a conversa de desconto — e sobrescrever apaga exatamente isso. Aqui a versão anterior fica `superseded` e visível, as linhas vêm junto para a nova (obrigar a redigitar trinta linhas por causa de um preço é o que faz as pessoas preferirem o sobrescrever), e um índice único parcial garante **uma versão viva por número**: duas versões vivas seriam duas propostas diferentes com o mesmo nome na mão do cliente.

**Dinheiro é inteiro, em centavos, do banco ao domínio.** `0.1 + 0.2` não é `0.3` em ponto flutuante, e trinta linhas acumulam a diferença até o total não bater com a calculadora do cliente. As colunas são `bigint`; a conversão de reais acontece uma vez, na borda HTTP. O arredondamento também acontece uma vez: na linha, nunca depois — assim a soma das linhas impressas bate com o total impresso, no mesmo papel.

**Os totais são mantidos pelo banco.** Gatilho recalcula o cabeçalho a cada escrita de item, e o guarda do cabeçalho recalcula quando o desconto geral, o acréscimo ou o imposto mudam. Deixar isso para a aplicação significaria que qualquer caminho novo — importação, ajuste em lote, correção manual — poderia deixar o cabeçalho dizendo um número e as linhas outro, e o cliente recebe os dois no mesmo PDF.

**Uma rota de transição, e a permissão sai do grafo.** `POST /quotes/:id/transitions` é o único caminho; rotas `/approve`, `/reject` e `/send` separadas seriam três caminhos para o mesmo ato, e o terceiro é sempre o que esquece uma verificação. A permissão exigida vem da tabela de transições do domínio — aprovar pede `quote.approve`, faturar pede `quote.invoice` — em vez de um decorador fixo que obrigaria a repetir a tabela na borda. Há teste com o coordenador, que lê a proposta e não a envia, provando que a checagem é por destino.

**Outras decisões**

- **Proposta enviada não se edita.** Trocar um preço depois do envio faria o sistema e o PDF que está na caixa de entrada dizerem números diferentes — e o cliente aprovaria o que leu, não o que está gravado.
- **Reservar na aprovação, não no envio.** Uma proposta enviada pode nunca ser aprovada, e prender a peça enquanto o cliente decide travaria a OS do vizinho por um trabalho que talvez não aconteça. Sem saldo, a reserva é pulada em silêncio: recusar a aprovação por falta de peça transformaria uma boa notícia comercial em erro de sistema, e a falta aparece na OS, que é onde alguém age.
- **Recusar exige motivo do catálogo.** "Recusado" sem porquê não alimenta análise de perda nenhuma, e é a análise de perda que faz a proposta seguinte ser melhor.
- **Vencer não depende da varredura.** `currentStatus` corrige a situação gravada pela validade, então uma proposta vencida não é aprovável mesmo antes de a varredura rodar. Se a varredura nunca rodar, só o relatório fica velho — que é a falha certa para uma tarefa de fundo ter.
- **A evidência do aceite é registro, não afirmação jurídica.** Ficam gravados quem, quando e de qual endereço — e o endereço vem do soquete, nunca de cabeçalho que o próprio interessado escreve. O sistema **não** afirma nada sobre valor jurídico ou validade legal de assinatura: isso depende de norma e de instrumento fora do escopo, que a auditoria não confirmou.
- **Desconto geral em valor OU em percentual, nunca os dois.** Aceitar ambos obrigaria a escolher uma ordem de aplicação, e qualquer ordem surpreenderia metade dos usuários — sem contar que quem preenche os dois quase sempre queria só um.
- **A cascata de preço devolve a ORIGEM junto com o valor.** Um preço vindo da tabela do contrato não se negocia como um vindo do catálogo, e sem a origem à vista o vendedor dá desconto sobre o preço que já era o descontado. Preço zero é resposta legítima (cortesia acordada), então a cascata testa por nulo, não por falsidade.

### Adiado deliberadamente

- **PDF versionado da proposta**: o motor de documentos é o EPIC-018, e gerar PDF aqui seria a sétima implementação que aquele épico existe para eliminar.
- **Aprovação pelo portal do cliente**: o fluxo e a evidência já estão prontos; falta a superfície, que é o EPIC-020. Hoje a aprovação entra pela API com a mesma gravação de evidência.
- **Escolha de lote na baixa**: a coluna `lot_id` existe na linha; escolher lote ao faturar entra com a rastreabilidade, junto com o rastreio por série do EPIC-015.

---

## EPIC-012 — Agenda · **concluído**

Na referência auditada há **2.950 serviços não agendados**. A agenda existe e não é usada, e o diagnóstico é ergonômico: programar custa mais do que ligar para o técnico. Tudo neste épico serve a uma meta só — inverter essa conta.

**Não existe entidade "agendamento" (ADR-011).** A programação vive na própria OS e a agenda é uma projeção. Um evento de agenda fora da OS criaria duas fontes de verdade e a obrigação de sincronizá-las — e é sempre a sincronização que falha calada. A migration é pequena de propósito: acrescenta a contagem de reagendamentos, o carimbo de janela invalidada e a frase da janela do local. A exceção é `availability_blocks`, que é entidade própria: férias não é OS e não deve virar uma.

**Conferir antes de soltar o cartão.** `POST /schedule/check` devolve os conflitos sem gravar nada. Descobrir o conflito só depois de salvar é precisamente o custo que faz o coordenador desistir — e há teste que confirma que conferir não escreve.

**Bloqueia o que é erro; avisa o que é decisão.** Esta é a decisão central do §13 e ela é de produto, não de implementação. Ausência bloqueia: agendar trabalho para quem está de férias não é escolha difícil, é engano. Sobreposição avisa: duas OS no mesmo horário são legítimas numa ronda, três não são, e o sistema não sabe que aquelas duas ficam no mesmo andar. Capacidade e janela do local também avisam. A lista de conflitos volta **inteira**, nunca o primeiro: quem descobre o segundo problema depois de resolver o primeiro tem duas tentativas por OS, e a terceira faz por telefone.

**Quem entra de férias arrasta consigo o que estava marcado.** É o caso que a agenda da referência não cobre e que produz o telefonema: o técnico entra de férias e as OS marcadas para aquela semana continuam marcadas, sem ninguém saber. Aqui um gatilho joga essas OS no balde "Reagendar" no mesmo instante, **com o motivo escrito** ("a pessoa entrou em férias de 07/04 a 20/04"). E a janela **não** é apagada: é ela que o coordenador usa para remarcar perto da data original.

**Outras decisões**

- **A primeira marcação não é reagendamento.** Marcar a janela pela primeira vez é agendar. Somar a primeira faria toda OS programada nascer com um reagendamento no histórico, e o sinal de "mais de três" perderia o sentido.
- **A contagem é por gatilho**, porque a janela muda por vários caminhos — tela, arrasto, geração de ciclo preventivo, correção em lote. Contar em um deles é contar em alguns, e um número que conta "alguns" é pior que número nenhum: parece confiável.
- **Sem jornada cadastrada, a ocupação é `null`, não zero.** Um técnico sem jornada não está com o dia livre, está com o cadastro incompleto — e mostrar 0 % faria o coordenador empilhar trabalho justamente em quem o sistema conhece menos.
- **"Reagendar" vem antes de "atrasada" na ordem dos baldes.** Uma OS cuja janela caiu sobre férias não está atrasada por culpa de ninguém; misturar as duas junta o problema de programação com o de execução, que são conversas diferentes com pessoas diferentes.
- **Registrar ausência é operação de agenda**, e por isso exige `work_order.schedule` e não `team.manage`. Quem entra e sai da equipe é assunto do gestor; férias são o insumo de que a programação depende, e exigir aqui uma permissão que o coordenador não tem garantiria agenda marcada por cima de férias — a falha que o épico existe para impedir.
- **A janela cabe no local? Reaproveita o motor de tempo útil do EPIC-010.** Uma segunda leitura de calendário divergiria da primeira no primeiro feriado municipal. Sem calendário no local a resposta é `null` e não `false`: não saber é diferente de não caber, e o aviso falso é o que faz os avisos verdadeiros serem ignorados.
- **O intervalo do calendário é limitado a 62 dias.** Sem limite, um `from`/`to` de um ano devolveria a agenda inteira da organização numa resposta só.

### Adiado deliberadamente

- **Sugestão de agrupamento por deslocamento** ("mais 6 preventivas neste mesmo setor — agendar juntas?"): a SPEC a coloca em Fase 3 e ela depende de dado de rota que não existe.
- **Notificação de fato**: o evento `work_order.rescheduled` já sai com valores anterior e novo e com a decisão de avisar o solicitante calculada (limiar de 4 h). Quem entrega o aviso é o EPIC-019.
- **Bloqueio de sala**: `availability_blocks` prende-se ao vínculo da pessoa. Bloquear um recurso físico exige outro alvo, e nenhum cliente pediu.

---

## EPIC-018 — Motor único de documentos · **concluído**

A referência tem **seis módulos documentais separados** — calibração, rascunho de calibração, certificado de padrão, TSE, laudo de obsolescência, qualificação térmica — com estrutura 90 % comum. Cada um com a sua tela, a sua numeração, a sua assinatura e o seu jeito de expirar; as diferenças entre eles são acidentais, nasceram de terem sido escritos em épocas diferentes. Um motor com tipos elimina cinco implementações e torna o sétimo tipo uma linha de configuração.

**Número emitido nunca é reaproveitado.** Documento cancelado mantém o número **queimado**, com o motivo (mínimo de 10 caracteres, porque alguém vai perguntar por quê). É requisito de auditoria: uma série com buraco explicado é auditável; uma série sem buracos porque os números voltaram a circular não é — ninguém consegue provar depois qual documento tinha aquele número. O índice único cobre inclusive os cancelados, e o gatilho recusa alterar número já emitido.

**Documento assinado não se edita — por caminho nenhum.** O gatilho do banco recusa a alteração de payload ou veredito quando existe assinatura, e a assinatura em si não se altera nem se apaga. A verificação `verifyDocumentSignatures` confere o conteúdo de hoje contra o que foi assinado, apesar de o banco já impedir: o impedimento vale para o futuro, a verificação vale para o presente — se algum caminho escapar, aparece ali em vez de nunca.

**O hash é canônico, e o conteúdo canônico é ordenado.** `JSON.stringify` preserva a ordem de inserção das chaves, o que faria o MESMO documento montado por dois caminhos produzir dois hashes — e a assinatura de um pareceria inválida para o outro. A canonicalização ordena as chaves em toda profundidade, preserva a ordem das listas (lista é sequência), distingue "não informado" de "explicitamente vazio", e recusa número não finito em vez de deixá-lo virar `null` calado.

**Sobre assinatura, o que o sistema NÃO afirma.** Cada método exige a sua prova de origem — desenhada precisa da imagem, por código precisa do e-mail, pelo portal precisa do usuário autenticado —, e o endereço vem do soquete, nunca de cabeçalho que o próprio interessado escreve. `icp_brasil` tem os campos modelados e é **recusado**: aceitar uma assinatura por certificado digital sem validar a cadeia seria afirmar uma validade que o sistema não apurou. Em nenhum lugar o produto afirma valor jurídico de assinatura.

**Outras decisões**

- **Os seis tipos são provisionados, o payload especializado de nenhum.** Ter o tipo cadastrado sem uso custa uma linha; descobrir na Fase 2 que o motor não o comporta custaria o épico de novo. Mas os campos de cada um dependem de norma técnica que a auditoria não confirmou, e inventar os pontos de medição de um certificado escreveria no sistema uma exigência metrológica que ninguém verificou.
- **A alocação de número usa trava de aconselhamento por série**, serializando a mesma série sem bloquear as outras. Sem ela, duas transações leriam o próximo valor antes de qualquer uma escrever, e o mesmo número sairia em dois laudos.
- **A série tem PADRÃO**, e por isso é tabela própria e não o contador do EPIC-007: número de documento vai impresso em laudo e o formato às vezes é acordado por escrito com o cliente.
- **Cancelar e substituir são coisas diferentes**, e o grafo mostra isso: cancelar diz que o documento não deveria ter existido, substituir diz que existiu e foi trocado. Só o segundo sai de "vencido" — cancelar um documento vencido reescreveria o passado.
- **O veredito é obrigatório na emissão, ainda que seja "não se aplica".** Um documento emitido sem veredito é um documento que não conclui nada.

### Adiado deliberadamente

- **Geração do PDF**: `pdf_key` existe na tabela. A composição do PDF (e a geração assíncrona que a qualificação térmica exige, porque na referência leva até uma hora) entra com o serviço de renderização.
- **Payload especializado dos cinco tipos de Fase 2/3**, pela razão dita acima. Entram com a norma na mão.
- **Bloqueio de emissão por padrão vencido** (o certificado de calibração não deve ser emitido se algum padrão estava com certificado vencido na data da medição): depende do payload de `standard_certificate`, que é Fase 2.

---

## EPIC-021 — Indicadores · **concluído**

A auditoria **não conseguiu confirmar** as fórmulas do sistema de referência para disponibilidade, MTTR, MTBF e "TMAC": a interface não exibe definição e os botões de ajuda não retornam conteúdo. Esse fato governou o épico inteiro.

**Todo número viaja com a sua definição.** Numerador, denominador, exclusões, período, filtros e cobertura vêm no mesmo objeto que o valor — não como enfeite de interface, mas como contrato: nenhum cliente da API consegue exibir o número sem ter recebido como ele foi calculado. A primeira pergunta diante de um número ruim é "como isso foi feito", e sem resposta o gestor para de usar o relatório, que é o estado em que a referência está.

**As fórmulas aqui são nossa decisão, e dizem isso.** Cada métrica carrega um campo de comparabilidade; as quatro que a auditoria não conseguiu confirmar avisam por extenso que comparar com o sistema antigo exige obter a fórmula com o fornecedor primeiro. **"TMAC" não existe**: a sigla só pôde ser inferida pelo formato de duração, e no lugar dela há tempo de primeira resposta e MTTR, ambos definidos.

**Denominador honesto, em todo lugar.** OS sem política não entram no SLA e a cobertura diz quantas ficaram de fora. Ativo com uma única corretiva não produz intervalo e sai do MTBF — tratar a única falha como intervalo zero faria o equipamento que falhou uma vez em cinco anos aparecer como o menos confiável do parque. Mês sem corretiva concluída devolve MTTR **nulo**, não zero: zero afirmaria uma excelência que não aconteceu.

**A regra de ouro do §25, cumprida por gatilho.** "O domínio transacional nunca é consultado diretamente por um painel de 12 meses — foi esse acoplamento que produziu telas de 30 segundos na referência." A SPEC descreve as tabelas de fato como populadas a partir dos eventos, com latência de minutos; aqui `fact_work_order` é mantida por **gatilho**, e a diferença é deliberada:

- o publicador de eventos depende de agendador durável, que depende de PostgreSQL real — ainda em aberto (ADR-022);
- manter por gatilho não tem latência nenhuma: o fato nasce na mesma transação do dado, e não existe janela em que o painel discorde da lista;
- é o mesmo desenho de `stock_balances` desde o EPIC-015, então não é um segundo jeito de fazer a mesma coisa dentro do sistema.

O preço é o custo por escrita, que num CMMS é ordens de grandeza menor que o de leitura: uma OS é escrita algumas dezenas de vezes na vida e lida em todo painel, todo dia. E há **caminho de volta**: `rebuild_fact_work_order` reconstrói a projeção inteira, com teste que compara o resultado da reconstrução com o do gatilho — porque quando alguém desconfia do número, e alguém sempre desconfia, a resposta não pode ser "confie".

**Outras decisões**

- **Rascunho não é demanda aberta.** `opened_at` é a saída do rascunho, não a criação — e uma OS publicada e depois devolvida a rascunho continua tendo sido demanda naquele dia, então a data não se apaga.
- **As horas do fato são recalculadas por soma, não incrementadas.** Apontamento se corrige, se apaga e se reabre; um contador incremental erraria em cada um desses casos sem ninguém perceber.
- **Uma rota por indicador, não uma rota genérica com `?metric=`.** Cada um tem filtros próprios, e a permissão financeira precisa cair sobre alguns e não sobre outros — impossível numa rota só.
- **Há rota só de definições**, sem consultar nada, para a tela de configuração do painel exibir a ajuda antes de existir período escolhido.
- **O período de um indicador é limitado a 400 dias.** Acima disso é exportação, não painel.

### Adiado deliberadamente

- **Agregados materializados mensais** (a terceira camada do §25): a tabela de fato já responde os recortes do painel; a camada de agregado entra quando houver volume que a justifique, e medir isso exige PostgreSQL real.
- **Disponibilidade, tempo de parada, custo e CSAT**: marcados como Comercial ou Fase 2/3 na própria SPEC. Disponibilidade em particular depende de decidir quais situações caracterizam parada — decisão de produto que a auditoria não confirmou e que não se inventa.
- **Reincidência e taxa de utilização**: Fase 2 na SPEC; os dados já existem, falta a definição acordada.

---

## EPIC-023 — Notificações · **concluído**

Este épico tem um inimigo declarado, e não é a falta de aviso: é o **excesso**. Um canal que manda dez e-mails por hora sobre a mesma OS é um canal que o destinatário filtra para uma pasta — e o aviso que importava se perde junto com os nove que não importavam. Por isso os três controles do §23 não são refinamento posterior: são a condição para o canal continuar existindo.

**De-duplicação por janela.** Cada tipo declara quantos minutos silenciam o segundo aviso igual, e a chave é tipo + destinatário + agregado — **sem o canal**, de propósito: se a pessoa recebeu no aplicativo há dois minutos, mandar o mesmo por e-mail é repetir, não complementar.

**Silêncio no fuso de quem recebe.** A janela pode atravessar a meia-noite ("das 20 h às 7 h") e a comparação ingênua responderia errado a noite inteira. E o cálculo é no fuso do destinatário: quem está em Manaus e configurou "não me acorde depois das 22 h" não quer que isso comece a valer às 19 h locais porque o servidor está em UTC. **O aviso silenciado não some — vira resumo**: descartá-lo transformaria "não me acorde" em "não me conte", que é outra coisa.

**Só um aviso fura o silêncio no MVP.** SLA violado às três da manhã num hospital muda o que a pessoa de plantão faz; "OS atribuída a você" não muda, e acordar alguém com isso é o caminho mais curto para o silêncio ser desligado para sempre.

**E-mail não verificado não recebe** — regra que a referência acertou e que copiamos literalmente. Mandar para endereço não confirmado queima a reputação do remetente e pode entregar informação de manutenção hospitalar a quem digitou o endereço errado. Endereço bloqueado conta como não verificado, e a supressão é **definitiva para aquele aviso**, não pendência guardada: manter na fila faria o dia da verificação despejar meses de aviso velho.

**Outras decisões**

- **A caixa é sempre a de quem pede.** O vínculo vem do contexto autenticado, nunca do corpo ou da query — há teste que passa `membershipId` alheio e confirma que a resposta continua sendo a própria. Aceitar esse parâmetro transformaria a caixa num leitor de mensagens alheias.
- **Notificação e entrega são coisas diferentes.** Uma notificação vira N entregas, uma por canal. Colapsar as duas faria a caixa somar o mesmo aviso duas vezes quando ele também sai por e-mail.
- **Cada público é uma consulta própria**, e não uma tabela genérica de regras: o executor está na OS, os coordenadores estão no papel, os mencionados estão no texto. Uma tabela de regras esconderia essas diferenças atrás de um `jsonb` que ninguém depura.
- **A menção casa pela parte local do e-mail**, que é o que as pessoas digitam. Casar pelo nome exibido daria empate na primeira homonímia, e notificar a pessoa errada é pior que não notificar.
- **O envio de fato não está simulado em lugar nenhum.** A entrega fica `pending` até que um adaptador real a marque. Um "enviado" falso some sem deixar rastro, e é a pior mentira possível num sistema de notificação.
- **Marcar como lida é uma via só.** Deixar remarcar como não lida pareceria gentileza e faria a contagem deixar de significar "o que chegou desde a última vez que olhei".

### Adiado deliberadamente

- **O transporte** — SMTP, push, WhatsApp: são adaptadores externos, e a fila de saída existe justamente para recebê-los sem tocar no roteador.
- **A montagem do resumo diário e semanal**: as entregas já são carimbadas como `digested` com a modalidade; juntar e enviar depende do agendador durável, que depende de PostgreSQL real (ADR-022).
- **Contatos de cliente como destinatários**: não são vínculos, são pessoas de fora. Entram com o portal (EPIC-020), que é onde ganham identidade.
- **O fluxo de verificação de e-mail** (envio e conferência do código): o que existe agora é o **efeito** — enquanto não verificado, o canal é suprimido —, para o roteador poder respeitá-lo desde já.

---

## EPIC-024 — Automações · **concluído**

Os "Robôs" da referência têm 2 modelos, 2 gatilhos e **1 ação real**. O problema não é o tamanho: uma automação que só sabe fazer uma coisa obriga a organização a pedir desenvolvimento para cada regra nova — e o resultado é que ninguém pede, e o trabalho continua sendo feito à mão. Aqui a regra é **dado**: gatilho, árvore booleana de condições e lista ordenada de ações.

**As salvaguardas são o produto.** Um motor de regras sem freio é a maneira mais rápida de um sistema perder a confiança de quem o usa: basta uma regra mal escrita para a equipe inteira receber trezentos e-mails numa tarde, e depois disso ninguém liga automação nenhuma. As quatro do §24 estão implementadas e testadas:

- **Sem recursão.** A regra não reage ao evento que ela mesma causou, e cadeias acima de três degraus são cortadas. Sem isso, uma regra que comenta ao mudar de situação e outra que muda de situação ao comentar giram para sempre — e o primeiro sinal seria a fatura do banco.
- **Limite por janela, com quarentena.** Quem estoura entra em quarentena **com o motivo escrito**, em vez de ser barrado em silêncio. Uma regra barrada calada parece funcionar e não funciona; uma em quarentena aparece na tela e alguém decide se corrige ou desliga.
- **Simulação obrigatória antes de ativar.** A API **recusa** ativar sem simular, e a frase é o produto: "esta regra teria disparado 412 vezes nos últimos 30 dias". Uma validação que se pode pular não é validação, é sugestão — e a regra que inunda a equipe é sempre a que alguém ligou com pressa. A simulação não executa ação nenhuma, e há teste que confirma.
- **Log de execução.** Toda corrida fica registrada, inclusive as que NÃO casaram: entrada, resultado, ações e erro. Sem o log, automação é caixa-preta — e caixa-preta que age sozinha no dado de outra pessoa é o que faz o operador desconfiar do próprio sistema.

**Automação nunca contorna permissão.** Cada ação declara a permissão que exige, e o motor confere contra o contexto **antes** de agir. Uma automação capaz de fazer o que o ator não pode fazer seria uma escada de privilégio com interface amigável.

**Outras decisões**

- **A regra nasce em rascunho, sempre.** Nascer ligada tornaria a exigência de simulação decorativa: bastaria criar e esquecer.
- **Ordem por prioridade declarada.** Quando duas regras agem sobre a mesma OS, o resultado tem de ser previsível; sem ordenação, a mesma sequência de eventos produziria estados diferentes conforme o plano de consulta do banco.
- **A ação que falha PARA a lista.** As seguintes costumam depender do efeito da anterior, e seguir em frente produziria meia automação — o pior dos estados possíveis, porque parece que funcionou.
- **`all` vazio dispara sempre; `any` vazio nunca dispara.** São as identidades de cada operação, e a consequência prática é boa: a regra sem filtro funciona, e a regra incompleta fica inerte em vez de sair atirando.
- **Comparação de igualdade é por valor, não por tipo.** O payload chega do banco com números virando texto, e uma regra que dissesse `prioridade = 3` deixaria de funcionar em silêncio — a pior falha possível numa automação.
- **Campo ausente nunca satisfaz** (exceto `missing`): "cliente ∈ [X, Y]" não deve disparar para um evento sem cliente.

### Adiado deliberadamente

- **`call_webhook`**: faz chamada externa e exige lista de destinos autorizados e revisão de segurança própria. Declarar a ação sem isso faria a organização montar a regra e ela falhar calada — ou, pior, chamar um endereço que alguém digitou errado.
- **`escalate` (após N minutos)**: depende de agendador durável, que depende de PostgreSQL real (ADR-022).
- **Gatilhos `schedule` e `condition_watch`**: as colunas e as restrições existem, e a validação já exige o cron quando o gatilho é agendado; o disparo depende do mesmo agendador.
- **`issue_document` e `create_service_request`**: entram junto com o consumidor que as justifique.

---

## EPIC-025 — Busca global · **concluído**

A ausência de busca global é uma das lacunas mais custosas da referência: para achar "patrimônio 7737" é preciso saber em qual lista procurar. O técnico com o equipamento na frente sabe o número que está na etiqueta e **não sabe se aquilo é TAG, patrimônio ou série** — e não deveria precisar saber.

**Identificador exato vem sempre primeiro.** Quem digita "7737" está com a etiqueta na mão. Devolver primeiro a OS cujo texto menciona 7737 e só depois o ativo de patrimônio 7737 é tecnicamente defensável e praticamente inútil. A recência entra como fração de um ponto: desempata dentro da mesma classe e **nunca atravessa** — um ativo tocado hoje não passa na frente do patrimônio que a pessoa acabou de digitar.

**Permissão e escopo cortam na consulta, não na exibição.** Um resultado fora do escopo não existe para quem procura: o escopo sem permissão de leitura **não é consultado**. Filtrar depois de buscar vazaria a existência do registro — o contador diria "12" e a tela mostraria 3, e a diferença é informação sobre dados que a pessoa não deveria saber que existem.

**Não há índice próprio, e isso é decisão.** A busca consulta as tabelas de origem, uma por escopo, com os índices que cada uma já tem. Uma tabela de índice mantida por gatilho — como o fato do EPIC-021 — seria mais rápida, e não foi escolhida porque o risco é diferente: o fato de OS erra e o painel fica velho; o índice de busca erra e **o registro desaparece para quem procura**, que é exatamente o problema da referência de volta por outro caminho. O §27 já diz "motor dedicado apenas quando o volume ou a latência exigirem", e é a mesma disciplina.

**Outras decisões**

- **Os prefixos são convenção de teclado, não sintaxe.** `#` restringe a OS, `@` a pessoas, `>` vira paleta de comandos — e quem não os conhece nunca os digita, com a busca funcionando igual.
- **A paleta filtra por existência, não por aparência.** O comando que a pessoa não pode executar não aparece desabilitado: não aparece. Mostrar cinzento ensina o que existe do outro lado da parede sem oferecer nada em troca.
- **A busca comum também sugere comandos.** Quem digita "agenda" quase sempre quer ir para a agenda, não achar um registro chamado agenda.
- **Empate técnico resolve pelo título**, para a lista não dançar entre consultas iguais: resultado que muda de ordem sozinho parece defeito.
- **Uma rota, sem permissão no decorador.** Um decorador exigiria uma permissão única para buscar, e quem não a tivesse perderia a busca inteira — inclusive nos escopos que pode ler.

### Adiado deliberadamente

- **Busca por similaridade** (erro de digitação em série e patrimônio): o §27 previa `pg_trgm`, que o ADR-027 já removeu por não existir no ambiente. A degradação é de qualidade de resultado, não de funcionalidade — "7737" continua achando "7737".
- **Recência por interação do usuário**: o desempate usa `updated_at` do registro, e não o histórico de quem abriu o quê. A tabela de interações entra quando houver superfície que a alimente.
- **Busca no cache local do PWA** (§27, offline): é do EPIC-014, junto com o aplicativo de campo.

---

## EPIC-022 — Auditoria · **concluído**

A trilha com diff campo a campo é o melhor acerto do sistema de referência, e ela existe aqui desde a **migration 0002**: gatilho em toda tabela de negócio, IP e agente propagados por variável de sessão, campos sensíveis gravados como `[redacted]`, e append-only garantido por permissão de banco.

O que faltava era o que este épico entrega: **como ler**. Uma trilha que ninguém consegue consultar tem exatamente o mesmo valor prático de trilha nenhuma na hora em que alguém pergunta "quem mexeu nisso?" — e é sempre nessa hora que se descobre.

**A linha do tempo junta as duas camadas.** O §22 explica por que elas existem separadas: um evento não captura a edição de um campo qualquer, e um diff não sabe que "a OS foi concluída" é diferente de "o campo `status_id` mudou". Mas quem lê quer **a história do registro**, não duas listas para conciliar de cabeça — então a linha do tempo mistura mudança e fato em ordem cronológica, preservando o que cada um traz: o diff de um lado, o conteúdo do fato do outro, sem confundir os dois.

**Duas permissões, porque são dois usos.** A história do próprio ativo ou da própria OS exige a permissão de LER AQUELE REGISTRO, resolvida por lista fechada de entidades — é o que permite embutir a linha do tempo na tela sem exigir perícia de quem opera o equipamento ("o usuário não deve precisar sair da tela para ver o histórico dela"). Já vasculhar a trilha inteira da organização atrás de quem fez o quê exige `audit.read`.

**O identificador da requisição amarra a chamada inteira.** É a consulta que transforma "salvei e sumiram três campos" numa lista concreta em vez de uma investigação — e ela só funciona porque o `request_id` atravessa a aplicação e chega à trilha pela variável de sessão do PostgreSQL, desde o EPIC-001.

**Outras decisões**

- **O append-only é verificado, não assumido.** Há teste que PERGUNTA ao banco se o usuário da aplicação pode alterar ou apagar a trilha, além dos que tentam e recebem recusa. A garantia é de permissão, e permissão se perde numa migration distraída sem que nada mais quebre: a aplicação continuaria funcionando, e só um perito descobriria anos depois que a trilha podia ter sido editada.
- **O corte da linha do tempo acontece DEPOIS da fusão.** Cortar antes traria as cem mudanças mais recentes e nenhum evento — ou o contrário —, e a história ficaria com um buraco que não se anuncia.
- **A lista de entidades com linha do tempo é fechada**, e não o nome da tabela vindo da URL: aceitar qualquer nome transformaria a rota num leitor genérico da trilha de qualquer tabela, e a permissão de ler a OS passaria a servir para ler a trilha de `users`.
- **O nome do ator vem resolvido na consulta.** "Quem mexeu nisso?" respondido com um uuid não é resposta.
- **Falta de permissão na linha do tempo é 403, não 422.** O pedido está bem formado; quem pede é que não pode. Devolver "dado inválido" mandaria a pessoa corrigir o que está certo.

### Adiado deliberadamente

- **Arquivamento frio e purga por rotina** (§22: 24 meses on-line, mínimo de 5 anos para reguladas): depende de política de retenção contratada e de destino de arquivo, e a rotina que apaga trilha é a última coisa que se escreve sem o destino definido.
- **Exportação da trilha** para perícia externa: entra com o motor de exportação, junto com o relatório do painel.

---

## Bugs reais encontrados e corrigidos pela própria suíte

| #   | Bug                                                                      | Como apareceu                                                                    | Correção                                                                                              |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Trigger de auditoria bloqueado pelo próprio `FORCE RLS`                   | Suíte de isolamento falhou no arranjo                                            | Policy `audit_logs_trigger_insert` restrita a `aurora_owner`                                            |
| 2   | Trigger assumia PK chamada `id`                                           | `membership_scopes` tem PK `membership_id`                                       | Coluna de PK como argumento do trigger, com erro explícito se não existir                               |
| 3   | Auditor da SPEC com 3 falsos positivos                                    | Contagem de colunas ignorava `\|` escapado                                       | Auditor corrigido                                                                                       |
| 4   | `EPIC-009` sem definição detectável                                       | Cabeçalho combinado `EPIC-008 · EPIC-009`                                        | Auditor passou a ler todos os IDs do cabeçalho                                                          |
| 5   | **Resolução de identidade quebraria em produção**                         | Consulta direta a `memberships` sob `aurora_app` devolve zero linhas (falha fechada) — todo login viraria 403 | Função `SECURITY DEFINER` de `aurora_identity` (0004/0005). O teste não pegava porque `unsafeCrossTenant` não aplicava `SET LOCAL ROLE`; passou a aplicar, e 4 testes ficaram vermelhos antes da correção |
| 6   | **Referência cruzada entre tenants**                                      | Teste "A não consegue atribuir papel de B" passava quando deveria falhar         | Verificação de FK roda como dono da tabela e **ignora RLS**. Corrigido com FK compostas incluindo `organization_id` (0007) — o estado inválido deixou de ser representável |
| 7   | Teste infalsificável                                                      | "`aurora_app` não pode `SET ROLE aurora_identity`" passava sempre                | Trocado por asserção sobre `pg_auth_members`, independente do ambiente                                   |
| 8   | **Mensagem inalcançável no limite de profundidade**                       | `RAISE` vinha depois do `UPDATE`; o `CHECK` disparava antes, com texto genérico   | Verificação movida para antes da cascata (0009)                                                          |
| 9   | **Violação de integridade virava 500**                                    | Aninhamento inválido respondia "erro interno" em vez de explicar a regra          | `translatePostgresError`: só a classe 23 do SQLSTATE vira 4xx; o resto continua 500, porque é bug nosso   |
| 10  | **Mover subárvore reatribuía o cliente em silêncio**                      | Encontrado na autoauditoria, não por teste vermelho                              | Passou a recusar explicitamente: transferir local entre clientes é operação de negócio própria            |
| 11  | **Sugestão de mesclagem que nunca acharia nada**                          | Teste vermelho ao tentar criar o par "Empréstimo"/"Emprestimo" para exercitar a sugestão | O índice único sobre o rótulo normalizado impede esse par de existir — logo, sugerir por igualdade normalizada era código que parecia resolver e não resolvia. Reescrita para semelhança: contenção por tokens e distância de edição, com o motivo à vista |
| 12  | **`minScore` que não era mínimo**                                         | O par "Ventilador"/"Ventliador" passava com score 0,80 sob um mínimo declarado de 0,82 | O teto arredondado era usado como filtro; agora serve só ao corte antecipado do cálculo e quem filtra é o score |
| 13  | **Mudar a unicidade não reprojetava o acervo**                            | O teste "mudar a configuração passa a valer" passou quando deveria falhar                                     | A projeção nascia na gravação, com a configuração daquele momento. Ligar "patrimônio é único" valia só para o que viesse depois, e a interface dizia que a regra estava ativa. Migration 0016 reprojeta na mesma transação e recusa listando os conflitos                     |
| 14  | **Garantia expirava à meia-noite do último dia**                          | Teste de `isUnderWarranty`                                                                                    | `warranty_until` é DATA, não instante; comparar `Date` com `Date` acabava a cobertura de madrugada do próprio dia de vencimento                                                                                                                                              |
| 15  | **`2025-02-30` passava na validação de importação**                       | Teste de `validateImportRow`                                                                                  | `Date.parse` rola para 2 de março em silêncio. A verificação passou a ser de ida e volta                                                                                                                                                                                     |
| 16  | **Lote grande de importação respondia 500**                               | Teste de lote acima do limite                                                                                 | O limite padrão de corpo do Express é 100 kB e o erro nasce no middleware, antes de qualquer validação nossa. Limite explícito de 12 MB, documentado                                                                                                                         |
| 17  | **Rota de etiquetas em lote respondia 431**                               | Teste de lote acima de 500                                                                                    | Quinhentos uuid numa query string dão 18 mil caracteres e o Node recusa antes de qualquer código nosso. A lista passou para o corpo, em `POST` — a alternativa era estreitar o produto para caber numa URL                                                                    |
| 18  | **Limitador chaveado num cabeçalho que o cliente escreve**                | Autoauditoria da rota pública                                                                                 | `x-forwarded-for` é escrito pelo chamador: bastava trocá-lo a cada requisição. Passou a usar o endereço do soquete, e há teste que rotaciona o cabeçalho para provar que não escapa                                                                                           |
| 19  | **Situação que exige motivo confundida com categoria**                    | O grafo permitia pausar, mas a restrição de tabela exigia motivo                                              | "Pausada" e "Aguardando" compartilham a categoria `waiting`; só a segunda tem dependência externa a nomear. Exigir motivo virou propriedade da SITUAÇÃO. Exigir em pausar obrigaria a inventar motivo, e motivo inventado envenena o relatório que o ADR-004 produz |
| 20  | **Histórico embaralhado dentro de uma transação**                         | Teste do EPIC-008 leu quatro transições feitas no mesmo COMMIT e recebeu as linhas fora de ordem              | Dentro de uma transação `now()` é constante: `changed_at` ficava idêntico e o desempate caía no uuid, que é aleatório. Sequência monotônica + `clock_timestamp()`; migration 0023 aplica o mesmo ao histórico de solicitações |
| 21  | **Rota resolvida por ordem de declaração**                                | Autoauditoria, aplicando ao EPIC-008 o princípio enunciado no EPIC-006                                         | `/work-orders/board` casaria com `:id`. O parâmetro passou a ser restrito ao formato de uuid no próprio caminho, onde a decisão fica visível |
| 22  | **Rotas de recurso sob o prefixo errado**                                 | 404 no teste de execução                                                                                      | `checklist-responses` e `time-entries` são recursos próprios e estavam sob `@Controller('work-orders')`, virando `/work-orders/checklist-responses/...`. Controlador separado                                                        |
| 23  | **O guarda de OS fechada bloqueava a própria reabertura**                 | Teste de SLA que reabre para conferir o relógio novo                                                          | O guarda recusava qualquer update em OS fechada, inclusive a transição `closed → in_progress` que a SPEC descreve em detalhe. Passou a bloquear só edição de CAMPO; mudar de situação segue sendo assunto do grafo                        |
| 24  | **"Violado" tratado como estado terminal do relógio**                     | Restrição `sla_clocks_stopped_has_elapsed` recusou a varredura                                                | Estourar o prazo não encerra nada: o trabalho continua e o tempo real só se sabe na conclusão. `breached_at` virou carimbo, não estado — sem isso o relatório perderia a diferença entre "estourou e resolveu em três dias" e "estourou" |
| 25  | **Restrição de reserva quebrava no almoxarifado que aceita negativo**      | Teste do consignado com saldo abaixo de zero                                                                  | `reserved <= on_hand` recusava até a reserva zero quando o físico era negativo — travando a tabela inteira por causa de um saldo que a organização autorizou explicitamente. Passou a `reserved <= GREATEST(on_hand, 0)` |
| 26  | **Consumo baixava o físico antes da reserva**                             | Autoauditoria da ordem das escritas em `consume`                                                              | Por um instante `reserved` ficaria maior que `on_hand` e a restrição recusaria a operação inteira. A ordem inversa nunca produz estado inválido: reserva menor que o físico é sempre legítima |
| 27  | **O aviso de renovação anunciava sempre o marco mais distante**            | Teste de `renewalAlert` com 56 dias restantes                                                                  | `find` numa lista descendente devolvia 90 em vez de 60. Como a varredura só emite marco mais próximo que o último emitido, o contrato avisaria uma vez aos 90 dias e nunca mais — o aviso dos 30, que é o que faz alguém agir, jamais sairia |
| 28  | **Renovar calava o contrato para sempre**                                 | Autoauditoria da idempotência da varredura                                                                    | O último marco avisado era lido sem recorte de vigência: um contrato que avisou aos 30 dias e depois foi renovado por mais um ano carregaria esse 30 adiante, e nenhum aviso da vigência nova passaria pela comparação — ficaria silencioso justamente por ter sido bem administrado da primeira vez. O recorte passou a ser pela data de término, e há teste que renova e exige o aviso novo |
| 29  | **Buraco na convenção de chave composta, em `customer_contacts`**          | Falha ao criar a chave estrangeira do aprovador do orçamento                                                  | A tabela nasceu no EPIC-003 sem `UNIQUE (id, organization_id)` e ninguém percebeu porque nada apontava para ela. A convenção existe por um motivo concreto (ADR-011): a verificação de chave estrangeira roda como dona da tabela e IGNORA a RLS, então uma FK só por `id` aceitaria apontar para a linha de outro tenant — o aprovador poderia ser um contato de outra organização. Corrigido na 0032 |
| 30  | **O PROGRESS afirmava uma coluna gerada que não existe**                   | Consulta de reserva do orçamento quebrou em `column "available" does not exist`                               | O registro do EPIC-015 dizia que `available` era coluna gerada em `stock_balances`; na verdade o disponível é calculado na consulta de saldo. O texto foi corrigido: documento que descreve o que não existe é pior que documento ausente, porque o próximo leitor confia nele |
| 31  | **O balde "Reagendar" mostrava o quê sem o porquê**                        | Teste de borda leu a linha do painel e recebeu `window_invalidated_reason` indefinido                          | A consulta dos baldes trazia o carimbo da invalidação mas não o motivo. Mostrar que algo precisa ser remarcado sem dizer por que manda o coordenador para outra tela — e cada tela a mais é um passo na direção do telefonema que este épico existe para evitar |
| 32  | **A SPEC descrevia um tipo de ausência que o banco não tem**               | Encontrado ao implementar o bloqueio do §13                                                                   | O §13 e o dicionário falam em bloco de tipo `absence`; o enumerado criado no EPIC-003 é `vacation \| leave \| training \| other`. Em vez de inventar um valor novo, a SPEC foi corrigida (patch P19) para descrever o que existe, e a regra de bloqueio passou a ser dita pelos tipos reais. O vínculo também foi corrigido: o bloco aponta para `membership_id`, não para o usuário — a mesma pessoa pode ter vínculo em duas organizações |
| 33  | **Tipo que exige assinatura jamais poderia ser emitido**                   | Teste do certificado de calibração: exigia assinatura para emitir, e assinar exigia o hash, que só nascia na emissão | Impasse fechado, e do tipo que só aparece quando alguém percorre o fluxo inteiro. O hash passou a ser congelado na entrada em REVISÃO — "em revisão" significa candidato congelado —, e a emissão apenas CONFERE que o conteúdo não mudou. O número saiu do resumo (só existe na emissão) e a identidade passou a vir do `id`, que é estável desde a criação. Voltar para rascunho descongela, e é recusado se alguém já tiver assinado |
| 34  | **Dois jeitos de calcular o mesmo tempo**                                  | Teste do tempo por motivo de espera não encontrou o motivo "peça"                                              | As consultas de tempo por situação e por motivo recalculavam a duração por janela (`lead` sobre o histórico), enquanto o gatilho do EPIC-008 já grava `seconds_in_from` na linha que fecha cada permanência — e grava o motivo do estado que TERMINA, não do que começa. Duas maneiras de obter o mesmo número divergem no primeiro caso de borda, e o painel passaria a discordar do detalhe da OS sem ninguém perceber. Passou a ler a duração já gravada |
| 35  | **Endereço de e-mail no texto virava menção**                              | Teste de `extractMentions` com "avise ana@hospital.test"                                                       | A expressão casava o arroba em qualquer posição, então o domínio virava nome de usuário. O resultado seria uma busca que não acha ninguém no melhor caso e que acha a pessoa errada no pior. Passou a exigir que o arroba não venha colado em outra palavra |
| 36  | **O roteador aceitava "agora" e carimbava outro instante**                 | Teste "passada a janela, o aviso volta a sair" falhou: a de-duplicação nunca abria                             | A notificação era gravada com `now()` do banco enquanto a janela era medida contra o instante recebido por parâmetro. Um roteador que se contradiz assim tem de-duplicação que nunca fecha — e nenhum teste de tempo consegue ser determinístico. Passou a gravar o instante que recebeu |
| 37  | **Ação apontava para uma permissão que não existe**                        | Teste de fim a fim: a regra casava, a ação falhava, e o motor dizia faltar `work_order.comment`                 | Não existe permissão de comentário no RBAC — comentar é editar a OS. A ação `add_comment` estava permanentemente morta: recusada por falta de uma chave que ninguém podia conceder, porque não estava no catálogo para ser concedida. Passou a exigir `work_order.update`, e há agora um teste que percorre TODAS as ações conferindo que a permissão declarada existe no registro |
| 38  | **A busca por patrimônio dependia da configuração de unicidade**           | Teste da TAG e da série não achou o ativo                                                                      | A consulta lia `asset_identifiers`, que é a projeção de UNICIDADE do EPIC-005 e só contém os campos que a organização declarou como únicos. Numa organização que não exige patrimônio único, o patrimônio não estaria lá e "7737" não acharia nada — a lacuna da referência de volta, por um caminho mais sofisticado: fazer a busca depender de uma configuração que não tem nada a ver com busca. Passou a ler as colunas do próprio ativo |
| 39  | **O escopo de LOCAL não era aplicado à busca**                             | Autoauditoria do teste de escopo restrito                                                                     | Ativo, OS e solicitação eram filtrados só por cliente. O escopo de um vínculo tem duas dimensões independentes (§05), e um vínculo que enxerga o hospital inteiro mas só a UTI dele receberia o equipamento de qualquer setor. "O resultado fora do escopo não existe" deixaria de valer justamente para quem tem escopo restrito |
| 40  | **Parâmetro declarado e não usado derrubava a consulta**                   | `could not determine data type of parameter $1` na busca de orçamentos                                        | A consulta recebia dois parâmetros e usava um. O PostgreSQL não infere o tipo do que não aparece, e recusa a consulta inteira — com um erro que não diz qual das nove consultas é. Corrigido, e todos os parâmetros de texto passaram a ter `::text` explícito, porque dentro de `LIKE $1 \|\| '%'` os dois lados são desconhecidos |
| 41  | **O script de migration nunca tinha rodado uma vez sequer**                | Primeira aplicação num PostgreSQL real                                                                        | `tools/db/run.mjs` registrava `ts-node/register/transpile-only`, e `ts-node` nunca foi instalado. O `npm run db:migrate` do README falhava na primeira linha. Todo teste usava o migrador por dentro, então o CAMINHO documentado — o que um operador usaria — era o único que ninguém exercitava. Passou a usar `tsx`, que já é dependência |
| 42  | **A notificação apontava para o evento de outra organização**              | Validação estrutural de FKs compostas contra PostgreSQL real                                                  | `notifications.event_id` referenciava `domain_events(id)` sem `organization_id`. A verificação de FK roda como dona da tabela e IGNORA a RLS: nada impedia um alerta de apontar para o evento de outro tenant, justamente pelo elo que existe para explicar a origem do alerta. Nenhuma suíte pegou porque todo teste de isolamento verifica LEITURA. Migration 0038 |
| 43  | **O convite não podia funcionar sob o papel de produção**                  | Primeiro teste do módulo de convite: `new row violates row-level security policy for table "users"`            | A política `users_visible_through_membership` exige vínculo prévio para a linha de usuário existir; o vínculo exige o usuário pela chave estrangeira. Ovo e galinha: `aurora_app` tinha `GRANT INSERT` em `users` desde a 0003 e nunca conseguiu usá-lo. Passou despercebido porque todo teste e todo seed criava usuário pelo caminho administrativo. A chave passou a ser diferida (0040) e o convite insere o VÍNCULO primeiro |
| 44  | **Os dois vínculos da consultora nasciam cegos**                           | O gatilho da 0039 recusou o seed inteiro                                                                      | O seed criava sete vínculos e escopo para cinco. Justamente a consultora — a persona que existe para exercitar o seletor de organização — entrava nas duas organizações sem enxergar nada. Oito meses de desenvolvimento com esse seed e ninguém tinha notado, porque um vínculo cego não dá erro: dá tela vazia |
| 45  | **`deactivateMembership` gravava um estado que o enumerado não tem**       | Teste de encerramento: `invalid input value for enum aurora.membership_status: "inactive"`                    | O enumerado é `invited\|active\|suspended\|removed` e o evento emitido já se chamava `member.suspended`. A função escrevia `inactive` — nome que não existe em lugar nenhum. Renomeada para `suspendMembership`, com a mesma palavra nos três lugares: enumerado, evento e função |
| 46  | **Escrita de notificação guardada por permissão de LEITURA**               | Conferência automática de contratos: "escrita guardada por permissão de leitura"                              | `POST /notifications/outbox/:id/sent` e `/failed` exigiam `audit.read` — chave que o papel Auditor tem e sobre o qual a §21 diz "somente leitura em tudo. Nenhuma escrita". Um auditor podia marcar como enviada uma notificação que nunca saiu, e um "enviado" falso some da fila sem deixar rastro. Passou a exigir `notification.deliver`, que fica fora de todo papel de fábrica exceto Proprietário e Administrador |
| 47  | **Gravar a medição do contrato exigia só ver valores**                     | Mesma conferência                                                                                             | `POST /contracts/:id/periods/:period` GRAVA a medição e exigia apenas `contract.read_financials`. O papel Financeiro, descrito como leitura de valores, escrevia a medição do mês. Passou a exigir também `contract.update` |
| 48  | **O contrato do convite perdia as regras de escopo pelo caminho**          | Teste do próprio contrato                                                                                     | `InviteInput` espalhava `...MembershipScopeInput.shape` para reaproveitar os campos de escopo. Espalhar a FORMA de um esquema refinado copia os campos e deixa as REGRAS para trás, em silêncio: o convite passou a aceitar escopo "listed" com lista vazia enquanto o ajuste de escopo recusava. As duas regras viraram função aplicável aos dois esquemas |
| 49  | **A lista de OS usava o padrão "pega-tudo" e cegava o planejador**         | Medição com 100 mil OS                                                                                        | `WHERE ($1 IS NULL OR coluna = $1)` serve a todas as combinações de filtro com uma consulta só, e é caro de um jeito que só aparece com volume: o planejador não estima a seletividade através do `OR`, erra a contagem por duas ordens de grandeza e varre o índice filtrando linha a linha. Pior, `status_category::text = $2` converte a coluna para texto e torna o índice inútil. As condições passaram a ser montadas a partir de uma lista FECHADA de fragmentos escritos no código, com comparação no próprio tipo do enumerado — 15% mais rápido no p95, medido lado a lado com a forma antiga na mesma sessão |

---

## Decisões tomadas nesta sessão (além das ADRs da SPEC)

- **Package manager**: npm workspaces (ADR-021) — `pnpm`/`corepack` ausentes no ambiente
- **Banco de teste**: PGlite (ADR-022) — Docker indisponível e remoto bloqueado
- **ADR-026 · sem `ltree`**: a extensão não existe no PGlite e não é garantida em PostgreSQL gerenciado. A árvore usa caminho materializado em `text` com índice `text_pattern_ops`. A SPEC foi corrigida em todas as seções afetadas.
- **ADR-027 · sem `pg_trgm`**: mesma razão. Busca no núcleo com `tsvector` nativo e forma normalizada indexada; trigrama vira otimização opcional. A degradação é de qualidade de resultado, não de funcionalidade.
- **ADR-028 · catálogos planos em `catalog_items`**: onde a SPEC v0.1 nomeia `work_order_types`, `failure_codes` e `rejection_reasons`, leia-se `catalog_items` com o `catalog_key` correspondente.
- **P18 · dois eventos de contrato**: o §17 pede alerta de vencimento e trata encerramento como fato de negócio, mas o catálogo declarava só `contract.activated`, `contract.expiring` e `contract.period_closed`. Sem `contract.expired`, "vai vencer" e "venceu" seriam o mesmo evento; sem `contract.terminated`, o encerramento por decisão humana só existiria na trilha de auditoria, invisível a qualquer automação. A SPEC foi corrigida pelo mesmo pipeline reproduzível dos demais patches.
- **P19 · ausências pelo nome certo**: o dicionário de dados descrevia `kind(absence|training|meeting|other)` e vínculo com usuário ou equipe; o que existe desde a 0008 é `vacation|leave|training|other` preso ao vínculo. A SPEC foi corrigida para descrever o esquema real, com a regra de bloqueio dita pelos tipos que existem.
- **Módulos**: CommonJS no backend por ora; o frontend consumirá os pacotes via bundler. Revisar quando `apps/web` entrar.

---

## Interface

Três pacotes novos, na ordem em que um depende do outro:

**`packages/contracts`** — a fonte compartilhada. Um campo é decidido uma vez,
em Zod, e três coisas passam a concordar por construção: a validação do
controller, o OpenAPI e o cliente tipado. O frontend NÃO redeclara DTO nenhum.

**`packages/ui`** — o design system, próprio e tirado do assunto: um
instrumento de trabalho para quem mantém equipamento crítico funcionando.
Neutros com viés frio esverdeado (vidro de instrumento), destaque em teal
profundo em vez do índigo de todo SaaS, semânticas separadas do destaque. A
leitura completa está em `packages/ui/src/styles/tokens.css`.

**`apps/web`** — o esqueleto e o primeiro fluxo vertical.

### O fluxo que já funciona ponta a ponta

SOLICITAÇÃO → TRIAGEM → CRIAÇÃO DE OS → QUADRO → TRANSIÇÃO → AGENDA, contra a
API de verdade. Não é painel ornamental: é o caminho que prova que backend,
contratos, RBAC, máquina de estados e agenda funcionam JUNTOS.

### As quatro decisões que mais importam nessas telas

- **arrastar no Kanban nunca muda o estado só na tela.** Arrasta → pede →
  espera → move. Recusado, o cartão volta com a explicação; faltando campo, o
  aviso diz QUAL. Mover e desfazer depois parece mais rápido e mente: a pessoa
  vê a OS em "concluída", vira para o lado, e quando olha ela voltou.
- **a agenda confere antes de salvar**, enquanto a pessoa escolhe. Ausência
  BLOQUEIA — não existe "marcar assim mesmo" para férias. Sobrecarga AVISA, e a
  carga do responsável aparece junto.
- **as ações possíveis vêm do servidor**, com os campos que exigem. A tela não
  deduz o grafo de estados; deduzir criaria um segundo grafo, e os dois
  divergiriam na primeira mudança.
- **filtro mora na URL.** Filtro escondido em modal é filtro que a pessoa
  esquece que aplicou e depois jura que o sistema perdeu registros.

### O que a interface AINDA NÃO tem, dito por extenso

- **telas de ativos, estoque, contratos, indicadores, notificações e perfil.**
  A API atende todas; o que falta é a tela. Cada uma responde com uma página que
  DIZ isso, em vez de sumir do menu — um menu que muda de tamanho a cada semana
  faz a pessoa perder a referência de onde as coisas ficam.
- **`apps/portal` e `apps/field`** não existem ainda.
- **teste de ponta a ponta com navegador** (Playwright) não existe. O que há é
  teste de componente e de esqueleto em jsdom, e teste de HTTP no backend.
- **auditoria de acessibilidade com ferramenta** não foi rodada. As regras da
  WCAG 2.2 estão implementadas e testadas uma a uma (foco visível, alvo de
  44px, estado nunca só por cor, erro que não evapora, foco que volta), mas
  isso não substitui uma varredura.

---

## Desempenho, medido

`tools/bench/seed.mjs` gera **100 mil ordens de serviço** em duas organizações
(85 mil e 15 mil), com 4 mil ativos, 768 locais em árvore de três níveis e
distribuição TORTA — 20% dos ativos concentram a maior parte das OS, porque
dados uniformes fazem qualquer índice parecer bom. `tools/bench/run.mjs` mede
sob `aurora_app`, com contexto de tenant, como a API roda.

**Resultado (PostgreSQL 16.14, contêiner local, 30 repetições, 5 de
aquecimento descartadas):**

| Cenário | p50 | p95 | meta |
| --- | ---: | ---: | ---: |
| lista de OS, filtrada por situação (filtro montado) | 42,7 ms | 114,5 ms | 400 ms |
| lista de OS, filtrada por situação (catch-all, forma antiga) | 58,4 ms | 131,9 ms | 400 ms |
| lista de OS, filtrada por cliente e situação | 6,7 ms | 9,0 ms | 400 ms |
| lista de OS, página 50 (rolagem profunda, OFFSET 5000) | 59,8 ms | 146,5 ms | 400 ms |
| busca por patrimônio exato | 1,2 ms | 1,7 ms | 300 ms |
| busca textual por título | 67,0 ms | 103,9 ms | 400 ms |
| quadro por estado, com quebra de motivo | 41,8 ms | 94,6 ms | 400 ms |
| agenda da semana | 0,6 ms | 0,9 ms | 400 ms |
| ficha de OS com histórico | 1,1 ms | 1,4 ms | 200 ms |
| indicador: OS abertas por mês (12 meses) | 9,5 ms | 10,4 ms | 1000 ms |

**A meta da §41 — lista filtrada em menos de 400 ms com 100 mil OS — é
cumprida**, com folga de três vezes no p95.

### O que a medição ensinou, e que eu quase reportei errado

A PRIMEIRA execução, imediatamente após a carga em massa, deu p95 de **1.086
ms** na lista filtrada e **665 ms** na rolagem profunda — as duas acima da
meta. Corrigi a consulta e o número caiu para 186 ms, e a conclusão fácil era
"a correção resolveu".

Não foi. Medindo as DUAS formas lado a lado, na mesma sessão e com o mesmo
aquecimento, a diferença entre elas é de **15% no p95** — real, consistente, e
muito menor que 10×. O que explicava o 1.086 ms era **cache frio logo após a
carga**, não a forma da consulta.

A correção continua certa: o plano é melhor, as estimativas do planejador
deixam de errar por duas ordens de grandeza, e o padrão pega-tudo é o mesmo
que produziu o defeito nº 40. Mas atribuir a ela uma melhora de dez vezes
seria mentira — e é o tipo de mentira que ninguém confere, porque o número
final está bonito.

### Limites desta medição

- **contêiner local**, não infraestrutura de produção. Serve para comparar
  decisões e pegar regressão; não prevê a latência de um servidor gerenciado
  com disco de rede.
- **mede o BANCO**, não a rota inteira. Falta o custo de HTTP, serialização e
  resolução de contexto — que a suíte de API cobre em correção, e não em
  tempo.
- **um cliente por vez.** Não há medição sob concorrência de dezenas de
  sessões, que é onde o pool e os bloqueios aparecem.

---

## Trabalhos periódicos

`apps/workers` roda em processo separado da API — uma varredura que percorre
cem mil OS não pode competir por conexão com quem está esperando a tela abrir.

**Cinco varreduras por organização** (SLA a cada 5 min; planos de hora em hora;
orçamentos, contratos e documentos de madrugada) e **uma de plataforma** (o
publicador do outbox, a cada minuto).

A garantia que o desenho existe para dar: **nunca duas execuções concorrentes do
mesmo trabalho lógico**. Toda fila usa política `exclusive` com `singletonKey`
igual à organização — existe UM job por (fila, organização), enfileirado ou
ativo. Cron sobreposto, worker lento, duas instâncias do processo: em nenhum
caso a varredura da mesma organização roda duas vezes ao mesmo tempo. Isso
importa porque as varreduras **abrem ciclo e geram ordem de serviço**: duas
execuções concorrentes produziriam a mesma OS preventiva duas vezes, e quem
descobriria seria o técnico, na agenda dele.

Mais três decisões que valem ser lidas:

- **o instante viaja com o job.** A organização enfileirada às 03:23 é medida
  contra 03:23, mesmo que o worker só a processe às 04:10. Sem isso, "vence em
  30 dias" significaria uma coisa na tentativa que falhou e outra na que deu
  certo.
- **falha não some.** Retentativa com recuo exponencial; esgotada, o job vai
  para a fila de cartas mortas. Um trabalho que falha em silêncio é pior do que
  um que não existe — cria a impressão de que a varredura aconteceu.
- **papel próprio para a dispersão** (migration 0041). `aurora_app` não
  consegue enumerar organizações, e é assim que tem de ser. A dispersão assume
  `aurora_scheduler`, que lê o identificador das organizações ativas e mais
  nada — há teste em PostgreSQL real provando que ele recebe `permission
  denied` ao tentar ler ordem de serviço.

**Sem trabalho agendado, e dito no próprio catálogo:** o *digest* de
notificações (§26) e a automação com gatilho de agenda (§29). Nos dois casos
falta a FUNÇÃO DE DOMÍNIO, não o agendamento — a §26 diz "resumo diário ou
semanal" e não diz a que hora, e escolher a hora aqui seria inventar requisito.

---

## Contratos e OpenAPI

`packages/contracts` é a fonte compartilhada entre backend e frontend: um campo é
decidido uma vez, em Zod, e três coisas passam a concordar por construção — a
validação do controller, o documento OpenAPI e o cliente tipado.

`npm run openapi` lê os **controllers de verdade** (os metadados que o NestJS
grava nos decoradores, os mesmos que o roteador usa) e cruza com o registro de
contratos. Não existe uma segunda lista de rotas escrita à mão para o documento
sair bonito. O que a conferência acusa, e que entra no `npm run verify`:

- **rota sem contrato** — contada e mostrada em porcentagem, nunca escondida;
- **contrato sem rota** — esquema que descreve um endereço que não existe mais;
- **permissão divergente** — o contrato diz uma coisa e o guard exige outra;
- **escrita guardada por permissão de leitura** — a classe de defeito que
  encontrou os itens 46 e 47 da tabela acima. As quatro rotas em que isso é
  legítimo (transições, cuja permissão é a da aresta do grafo) declaram a
  exceção no próprio controller, com `@PermissionsCheckedInHandler`.

**Cobertura atual: 8 de 135 rotas (6%).** Está dito de propósito. Contrato nasce
quando a tela que o usa nasce — escrever os 135 de uma vez produziria esquemas
que ninguém exercita, e esquema não exercitado erra no campo opcional. O número
sobe junto com `apps/web`.

---

## Lacunas conhecidas, ditas por extenso

- **`aurora.fn_calendar_window_no_overlap` usa advisory lock** porque `EXCLUDE` exigiria `btree_gist` (extensão). Corretude sob concorrência depende desse lock; está comentado na migration.
- **PGlite continua sendo o banco padrão dos testes**, e continua tendo uma conexão só. O que ele não prova agora tem suíte própria contra PostgreSQL 16.14 em Docker (`AURORA_TEST_PG_URL`): reuso de pool, concorrência, `SKIP LOCKED`, advisory lock disputado e RLS sob papel que não é dono das tabelas. São 24 testes que ficam PULADOS sem a variável — e dizem isso, em vez de passar em silêncio.
- **A suíte de PostgreSQL real não roda na integração contínua.** Depende de um contêiner que só existe na máquina de desenvolvimento. Enquanto não houver serviço de banco no fluxo de CI, ela é uma verificação manual — e uma verificação manual é uma verificação que uma pessoa apressada pula.

---

## Bloqueio externo ativo

**Supabase remoto.** O CLI está autenticado e lista 28 projetos em ~15 organizações; nenhum identificável como Aurora e nenhum vinculado. Conforme a regra vigente, nenhuma operação remota foi executada. Para desbloquear é preciso o **project ref** do projeto correto (OQ-16). Nada no código depende disso: as migrations rodam em qualquer PostgreSQL 16+, e a escolha do ADR-026/027 removeu até a dependência de extensão.
