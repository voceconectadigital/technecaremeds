# Aurora

Plataforma multitenant de gestão de ativos e manutenção — engenharia clínica,
manutenção hospitalar e, adiante, outros mercados de gestão de ativos.

> **Status:** fundação em desenvolvimento (F0 / EPIC-001).
> Nada em produção. Nenhum deploy. Ver `docs/PROGRESS.md`.

## Documentação

| Documento                                                            | O que é                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| [`docs/AURORA-CMMS-SPEC-v0.2.md`](docs/AURORA-CMMS-SPEC-v0.2.md)     | **Source of truth** de negócio e arquitetura — 49 seções |
| [`docs/01-AUDITORIA-TECHNECARE.md`](docs/01-AUDITORIA-TECHNECARE.md) | Auditoria funcional do sistema de referência             |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)                               | Estado do desenvolvimento, bugs corrigidos, bloqueios    |

## Estrutura

```
packages/
  domain/    regras puras — sem HTTP, sem banco, sem SDK. UUID v7, contexto, erros
  events/    catálogo de eventos de domínio
  db/        migrations, unidade de trabalho com tenant, outbox, harness de teste
  config/    validação de ambiente e identidade do produto
docs/        especificação e auditoria
tools/       pipeline da SPEC e verificações de CI
```

## Comandos

```bash
npm install
npm run verify      # auditoria da SPEC + typecheck + lint + testes
npm test            # apenas os testes
npm run spec:audit  # consistência da especificação
```

## Princípios inegociáveis

1. **Nenhum dado de uma organização alcança outra.** Defesa em profundidade em
   10 camadas (§37). A suíte de isolamento é bloqueante no CI.
2. **`withTenant` é o único caminho** para tabela tenant-scoped. Contexto sempre
   transaction-local — nunca variável de sessão, que vazaria pelo pool.
3. **Falha fechada.** Sem contexto de tenant, a consulta devolve zero linhas.
4. **Migrations imutáveis** depois de aplicadas, verificadas por checksum.
5. **Auditoria e evento na mesma transação do dado.** Outbox, nunca best-effort.

## Banco em desenvolvimento

Testes usam PGlite (PostgreSQL 16.4 em processo) — sem Docker, sem serviço
externo. Para rodar contra um PostgreSQL real, defina `AURORA_TEST_PG_URL`.
