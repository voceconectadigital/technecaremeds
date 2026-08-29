# Aurora — progresso do desenvolvimento

Fonte de verdade de negócio: `docs/AURORA-CMMS-SPEC-v0.2.md`.
Fonte de verdade de código: este repositório e o Git.

---

## Estado atual

| Item                             | Situação                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ |
| SPEC                             | **v0.2**, auditada automaticamente (0 erros, 0 avisos), 49 seções, 28 ADRs      |
| Fase                             | **F1 — Acesso e diretório**                                                     |
| Épicos concluídos                | EPIC-001 (fundação), EPIC-002 (RBAC), EPIC-003 (diretório), EPIC-004 (catálogos e campos personalizados) |
| Épico seguinte                   | EPIC-005 — ativos e classificação                                               |
| Testes                           | **306**, todos verdes                                                           |
| Migrations                       | 13 (`0000` a `0012`), idempotentes, reprodutíveis do zero                       |
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

- Catálogo de **106 permissões** como fonte única em código (`packages/domain/src/permissions.ts`); o banco é espelho e um teste garante que não divergem
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
