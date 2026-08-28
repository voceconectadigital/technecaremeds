# Aurora — progresso do desenvolvimento

Fonte de verdade de negócio: `docs/AURORA-CMMS-SPEC-v0.2.md`.
Fonte de verdade de código: este repositório e o Git.

---

## Estado atual

| Item | Situação |
|---|---|
| SPEC | **v0.2**, auditada automaticamente (0 erros, 0 avisos) |
| Fase | **F0 — Fundação** |
| Épico corrente | **EPIC-001 — Fundação multitenant** |
| Supabase remoto | **BLOQUEADO** — projeto do Aurora não identificado (ADR-025, OQ-16) |
| Banco de desenvolvimento e teste | PGlite (PostgreSQL 16.4 em processo) — ADR-022 |

---

## EPIC-001 — Fundação multitenant

### Concluído

**Monorepo e tooling**
- npm workspaces (ADR-021), lockfile versionado
- TypeScript `strict` + `noUncheckedIndexedAccess`, project references, `tsc -b` limpo
- ESLint 9 + typescript-eslint, Prettier
- Regra de lint que barra `unsafeCrossTenant` e `db.query` direto fora da infraestrutura de dados — **verificada com probe: dispara de verdade**
- CI (GitHub Actions): auditoria da SPEC, typecheck, lint, formatação, testes, varredura de segredos
- `.env.example` sem nenhum valor real; `tools/ci/check-secrets.mjs` bloqueia segredo versionado

**Banco**
- 4 migrations versionadas, idempotentes, reprodutíveis do zero
- Papéis separados: `aurora_owner`, `aurora_migrator`, `aurora_app`, `aurora_readonly`, `aurora_publisher`
- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** em 100 % das tabelas tenant-scoped
- `aurora.current_organization_id()` e demais funções de contexto, com **falha fechada**
- Tabelas: `organizations`, `users`, `memberships`, `membership_scopes`, `audit_logs`, `domain_events`
- Migrator com checksum: detecta migration alterada depois de aplicada

**Plataforma**
- `RequestContext` imutável, resolvido no servidor (§05)
- `withTenant` como **único** caminho para tabela tenant-scoped; contexto sempre `set_config(..., is_local => true)`
- `unsafeCrossTenant` como escotilha explícita, exigindo justificativa e barrada por lint
- Trilha de auditoria por trigger, com diff campo a campo, ator, tipo de ator, IP, user agent, `request_id`, origem e redação de campos sensíveis
- Outbox transacional de eventos de domínio + catálogo com 100 tipos
- Publicador com papel próprio (`aurora_publisher`): lê todas as organizações, não altera dado de negócio
- Fábrica única de UUID v7 (ADR-024), com monotonicidade testada
- Validação de configuração que falha alto no boot, sem vazar segredo em diagnóstico

**Testes — 65, todos verdes**

| Suíte | Testes | Cobre |
|---|---|---|
| `domain/id` | 9 | formato, versão, variante, monotonicidade, colisão em 50 mil ids, relógio para trás |
| `domain/context` | 6 | imutabilidade, exigência de tenant e `request_id`, permissões |
| `domain/errors` | 6 | taxonomia, 404 em vez de 403, mensagem que ensina |
| `config/env` | 7 | falha alto, dependências condicionais, injeção em `SET ROLE`, diagnóstico sem segredo |
| `db/tenant-isolation` | 18 | A/B nos dois sentidos, `WITH CHECK`, reuso de conexão, falha fechada, papéis, `FORCE RLS` |
| `db/audit-and-outbox` | 14 | diff, redação, soft delete, append-only, outbox transacional, publicador |
| `db/migrations` | 5 | do zero, idempotência, detecção de alteração, schema esperado |

### Pendente do EPIC-001

- `apps/api` (NestJS): controllers finos, middleware de contexto, filtro de erro RFC 9457, health, OpenAPI
- Adaptador `AuthProvider` com implementação local
- pg-boss (fila) — modelo já previsto, integração ainda não feita
- Logs estruturados correlacionados por `request_id`
- Seeds determinísticos com 2+ organizações

---

## Bugs reais encontrados e corrigidos pela própria suíte

| # | Bug | Como apareceu | Correção |
|---|---|---|---|
| 1 | Trigger de auditoria bloqueado pelo próprio `FORCE RLS` | Suíte de isolamento falhou no arranjo | Policy `audit_logs_trigger_insert` restrita a `aurora_owner`; a aplicação segue só com `SELECT` |
| 2 | Trigger assumia PK chamada `id` | `membership_scopes` tem PK `membership_id` | Coluna de PK como argumento do trigger, com erro explícito se não existir |
| 3 | Auditor da SPEC com 3 falsos positivos | Contagem de colunas ignorava `\|` escapado; `****` e "lorem ipsum" em citação legítima | Auditor corrigido |
| 4 | `EPIC-009` sem definição detectável | Cabeçalho combinado `EPIC-008 · EPIC-009` | Auditor passou a ler todos os IDs do cabeçalho |

---

## Decisões tomadas nesta sessão (além das ADRs da SPEC)

- **Package manager**: npm workspaces (ADR-021) — `pnpm`/`corepack` ausentes no ambiente
- **Banco de teste**: PGlite (ADR-022) — Docker indisponível e remoto bloqueado
- **Módulos**: CommonJS no backend por ora; o frontend consumirá os pacotes via bundler. Revisar quando `apps/web` entrar

---

## Bloqueio externo ativo

**Supabase remoto.** O CLI está autenticado e lista 28 projetos em ~15 organizações; nenhum identificável como Aurora e nenhum vinculado. Conforme a regra vigente, nenhuma operação remota foi executada. Para desbloquear é preciso o **project ref** do projeto correto (OQ-16). Nada no código depende disso: as migrations rodam em qualquer PostgreSQL 16+.
