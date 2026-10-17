# Téchne Care — rodada "reunião com Anderson de 16/10/2026"

Relatório de entrega. Controle item a item (arquivos, migration, testes, commit, bloqueio):
`docs/ROADMAP-ANDERSON-2026-10-16.md`. Estado do produto: `docs/AI-HANDOFF.md`.
Pedidos: `docs/NOVAS-SOLICITACOES.md` (NS-021).

## Resumo

| | |
| --- | --- |
| HEAD inicial | `5207188` (main) |
| Branch / PR | `feat/anderson-2026-10-16` · https://github.com/voceconectadigital/technecaremeds/pull/22 (MERGED) + #23 |
| Main | `27a5e8c` — CI verde (estático, PostgreSQL 16 real, navegador 205/205) |
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
| 9 Relatórios | PASS — FUNDAÇÃO (refinamento aguardando PDFs) | Basic/Advanced/Expert; layout AGUARDANDO MODELO PDF OFICIAL |
| 10 Automações | PASS | relatório agendado, lembrete, tarefa, 5W2H, PDCA; agendador idempotente; e-mail em fila |
| 11 Novo Negócio | PASS | provisionamento pelo admin global de plataforma; 2 tenants isolados |
| 12 Ferramentas | PASS | vitrine com 7 ferramentas rotuladas; sem backend |
| 13 Produção | BLOQUEADA | verificada só por leitura; sem deploy nesta rodada (decisão de 16/10) |

## Bloqueios que continuam

- **Cliente:** PDFs oficiais (layout e indicadores Expert/FHEMIG); definição de "parado"
  (disponibilidade no tempo).
- **Especialista:** fórmulas, incerteza, limites de TSE, decisão metrológica.
- **Infra:** transporte de e-mail (automação e convite com senha), mapa/geocodificação, leitura
  do chip, domínio ainda não confirmado ("htec.b" não existe), VPS definitiva e backup/restore
  da futura infraestrutura.

## Infraestrutura — decisão vigente

Decisão vigente (16/10/2026, responsável do projeto): **sem deploy no HostPanel nesta rodada** e sem tocar a VPS antiga; o **PostgreSQL remoto atual permanece no Supabase Online** da Téchne Care até a infraestrutura definitiva; **VPS dedicada fica para fase posterior**; autenticação **continua própria da aplicação** (sem Supabase Auth). Código na `main` não autoriza migration remota nem deploy de backend.

- Backend **não** publicado; migrations `0060`–`0068` **não** aplicadas em banco remoto.
- Front de produção continua na versão de 15/10: o front novo depende do backend desta rodada →
  **AGUARDANDO DEPLOY CONECTADO**.
- Demo pública (`technecaremeds.pages.dev`, Cloudflare Pages ligado ao GitHub) publica a `main`
  automaticamente em modo demonstração (sem backend).
- Admin global de plataforma (Novo Negócio): concessão por DBA, quando houver deploy conectado.
