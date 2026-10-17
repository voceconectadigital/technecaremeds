# Téchne Care — rodada "reunião com Anderson de 16/10/2026"

Relatório de entrega. Controle item a item (arquivos, migration, testes, commit, bloqueio):
`docs/ROADMAP-ANDERSON-2026-10-16.md`. Estado do produto: `docs/AI-HANDOFF.md`.
Pedidos: `docs/NOVAS-SOLICITACOES.md` (NS-021).

## Resumo

| | |
| --- | --- |
| HEAD inicial | `5207188` (main) |
| Branch / PR | `feat/anderson-2026-10-16` · https://github.com/voceconectadigital/technecaremeds/pull/22 |
| Migrations novas | `0060` → `0068` (9) |
| Testes de unidade/HTTP (local, PGlite) | 2104 passando, 32 pulados (sem PostgreSQL real) |
| Testes de navegador | 121 (32 arquivos) — rodam só no CI |

## Fases

| Fase | Resultado | Destaques |
| --- | --- | --- |
| 1 Usuários | PASS | perfis OPERADOR/SOLICITANTE/GESTOR, CPF e registros, ATIVO/SUSPENSO/BLOQUEADO, escopo no backend (404) |
| 2 Clientes | PASS | EAS × corporativa + subtipo, edição, base de fábrica por organização |
| 3 Equipamentos | PASS | família × tipo, chip (cadastro), vincular QR existente, filtros |
| 4 Solicitações | PASS | Cliente → Equipamento → Tipo (7) → Urgência, sem Sintoma, escopo validado |
| 5 OS / assistente | PASS | sem rascunho, Negada, ▶ Executar, check-in/out, peças, fotos, LIBERADO/PARADO |
| 6 Planos | PASS | filtro de tipo, executar item, gráficos por plano/procedimento |
| 7 Orçamentos | PASS | gerado da OS, centavos, aprovar/reprovar com trilha |
| 8 Estoque / Store | PASS | dono, máximo, ABC, relatório de período; Store sem checkout |
| 9 Relatórios | PASS (fundação) | Basic/Advanced/Expert; layout AGUARDANDO MODELO PDF OFICIAL |
| 10 Automações | PASS | relatório agendado, lembrete, tarefa, 5W2H, PDCA; agendador idempotente; e-mail em fila |
| 11 Novo Negócio | PASS | provisionamento pelo admin global de plataforma; 2 tenants isolados |
| 12 Ferramentas | PASS | vitrine com 7 ferramentas rotuladas; sem backend |
| 13 Produção | BLOQUEADA | verificado só por leitura; deploy exige autorização explícita; backup sem prova |

## Bloqueios que continuam

- **Cliente:** PDFs oficiais (layout e indicadores Expert/FHEMIG); definição de "parado"
  (disponibilidade no tempo); autorização de deploy no HostPanel.
- **Especialista:** fórmulas, incerteza, limites de TSE, decisão metrológica.
- **Infra:** transporte de e-mail (automação e convite com senha), mapa/geocodificação, leitura
  do chip, domínio "htec.b" (não existe), backup/restore comprovado, restart/logs no HostPanel.

## Próximos passos de publicação

1. Backup do PostgreSQL de produção com prova (antes das migrations `0060`–`0068`).
2. Deploy da API no HostPanel (com autorização) → conferir `/v1/health/version`.
3. Front (web, portal, campo) por `wrangler pages deploy` → smoke remoto.
4. DBA concede o admin global de plataforma (Novo Negócio) a quem a operação indicar.
