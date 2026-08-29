# Aurora — progresso do desenvolvimento

Fonte de verdade de negócio: `docs/AURORA-CMMS-SPEC-v0.2.md`.
Fonte de verdade de código: este repositório e o Git.

---

## Estado atual

| Item                             | Situação                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ |
| SPEC                             | **v0.2**, auditada automaticamente (0 erros, 0 avisos), 49 seções, 28 ADRs      |
| Fase                             | **F3 — Trabalho**                                                               |
| Épicos concluídos                | EPIC-001 (fundação), EPIC-002 (RBAC), EPIC-003 (diretório), EPIC-004 (catálogos), EPIC-005 (ativos), EPIC-006 (QR Code), EPIC-007 (solicitações), EPIC-008 (ordens de serviço) |
| Épico seguinte                   | EPIC-011 — Execução: checklists, horas, peças e assinatura                                            |
| Testes                           | **545**, todos verdes                                                           |
| Migrations                       | 24 (`0000` a `0023`), idempotentes, reprodutíveis do zero                       |
| Supabase remoto                  | **BLOQUEADO** — projeto do Aurora não identificado (ADR-025, OQ-16)             |
| Banco de desenvolvimento e teste | PGlite (PostgreSQL 16.4 em processo) — ADR-022                                  |

Portão de qualidade (`npm run verify`): auditoria da SPEC → typecheck → lint → testes.
No CI acrescentam-se `format:check` e varredura de segredos.

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
- pg-boss como agendador durável — adiado com motivo: exige PostgreSQL real, indisponível enquanto o remoto estiver bloqueado. O `IntervalScheduler` atual cobre o publicador do outbox e não sobrepõe execuções.

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

---

## Decisões tomadas nesta sessão (além das ADRs da SPEC)

- **Package manager**: npm workspaces (ADR-021) — `pnpm`/`corepack` ausentes no ambiente
- **Banco de teste**: PGlite (ADR-022) — Docker indisponível e remoto bloqueado
- **ADR-026 · sem `ltree`**: a extensão não existe no PGlite e não é garantida em PostgreSQL gerenciado. A árvore usa caminho materializado em `text` com índice `text_pattern_ops`. A SPEC foi corrigida em todas as seções afetadas.
- **ADR-027 · sem `pg_trgm`**: mesma razão. Busca no núcleo com `tsvector` nativo e forma normalizada indexada; trigrama vira otimização opcional. A degradação é de qualidade de resultado, não de funcionalidade.
- **ADR-028 · catálogos planos em `catalog_items`**: onde a SPEC v0.1 nomeia `work_order_types`, `failure_codes` e `rejection_reasons`, leia-se `catalog_items` com o `catalog_key` correspondente.
- **Módulos**: CommonJS no backend por ora; o frontend consumirá os pacotes via bundler. Revisar quando `apps/web` entrar.

---

## Lacunas conhecidas, ditas por extenso

- **Vínculo sem linha em `membership_scopes` não enxerga nenhum local.** É falha fechada, e está correto como comportamento — mas o fluxo de convite precisa criar a linha de escopo junto com o vínculo. Hoje só os auxiliares de teste garantem isso. Entra no fluxo de convite (EPIC-002 estendido) ou no primeiro épico que criar vínculo por interface.
- **`aurora.fn_calendar_window_no_overlap` usa advisory lock** porque `EXCLUDE` exigiria `btree_gist` (extensão). Corretude sob concorrência depende desse lock; está comentado na migration.
- **Sem PostgreSQL real ainda.** Tudo passa em PGlite, que é PostgreSQL 16.4 de verdade compilado para WASM, com uma conexão só. Isso é mais severo para vazamento de contexto e mais fraco para concorrência: nada aqui exercita pool, `SKIP LOCKED` sob disputa real ou advisory lock disputado.

---

## Bloqueio externo ativo

**Supabase remoto.** O CLI está autenticado e lista 28 projetos em ~15 organizações; nenhum identificável como Aurora e nenhum vinculado. Conforme a regra vigente, nenhuma operação remota foi executada. Para desbloquear é preciso o **project ref** do projeto correto (OQ-16). Nada no código depende disso: as migrations rodam em qualquer PostgreSQL 16+, e a escolha do ADR-026/027 removeu até a dependência de extensão.
