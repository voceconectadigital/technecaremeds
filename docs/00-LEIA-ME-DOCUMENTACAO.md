# Aurora CMMS — Documentação para revisão

Pacote com dois documentos produzidos em sequência:

1. **Auditoria funcional** da plataforma Arkmeds/TechneCare (sistema de referência, em produção).
2. **Especificação funcional e arquitetural** do produto novo, derivada dessa auditoria.

Nenhum código, projeto, banco de dados ou migração foi criado. O conteúdo destes arquivos é **idêntico** ao dos documentos originais — houve apenas conversão de HTML para Markdown e divisão da especificação em partes.

---

## Ordem de leitura recomendada

| # | Arquivo | O que é | Quando ler |
|---|---|---|---|
| 1 | `01-AUDITORIA-TECHNECARE.md` | Engenharia reversa funcional do sistema de referência | Primeiro. Explica o domínio e origina todas as decisões da spec |
| 2 | `02-AURORA-CMMS-SPEC/00-visao-e-personas.md` | Visão do produto e personas | Segundo |
| 3 | `02-AURORA-CMMS-SPEC/01-…` até `12-…` | Especificação, em 13 partes, na ordem numérica | Sequencialmente |
| — | `02-AURORA-CMMS-SPEC/AURORA-CMMS-SPEC-COMPLETE.md` | As 48 seções da spec em arquivo único | Alternativa às 13 partes — mesmo conteúdo |

**Atalho para quem tem pouco tempo:** leia a seção 01 da auditoria (resumo executivo), depois as seções **45 (ADR / Decision log)**, **44 (Matriz MVP)** e **46 (Open questions)** da especificação. São elas que carregam as decisões e o que ainda depende de você.

---

## Conteúdo

### `01-AUDITORIA-TECHNECARE.md` — 31 seções

Auditoria somente leitura da instância `technecare.arkmeds.com` (v2.69.0), com 87 rotas de menu mapeadas, 42 estados de OS, 138 permissões e 13 métricas nativas catalogadas.

01. Resumo executivo · 02. Mapa completo do sistema · 03. Inventário de telas · 04. Entidades do sistema · 05. Campos identificados por entidade · 06. Relacionamentos · 07. Ordens de serviço · 08. Equipamentos · 09. Planos e manutenção preventiva · 10. Agendamentos · 11. Certificados e laudos · 12. Orçamentos · 13. Estoque · 14. Relatórios · 15. Indicadores de desempenho · 16. Robôs e automações · 17. Usuários e permissões · 18. BI · 19. Auditoria e histórico · 20. Auditoria de UX/UI · 21. Pesquisa externa · 22. Benchmark · 23. Modelo de dados conceitual · 24. Jornadas principais · 25. Matriz de permissões provável · 26. MVP recomendado · 27. Roadmap · 28. Arquitetura técnica recomendada · 29. Diferenciais do nosso produto · 30. Backlog funcional · 31. O que a auditoria não conseguiu responder

### `02-AURORA-CMMS-SPEC/` — 48 seções em 13 partes

| Parte | Arquivo | Seções |
|---|---|---|
| 1 | `00-visao-e-personas.md` | 01 Visão do produto · 02 Personas |
| 2 | `01-glossario-dominios-multitenant.md` | 03 Glossário · 04 Domínios · 05 Arquitetura multitenant |
| 3 | `02-clientes-locais-ativos-solicitacoes.md` | 06 Clientes e locais · 07 Ativos · 08 Solicitações |
| 4 | `03-ordens-de-servico-e-state-machine.md` | 09 Ordens de serviço · 10 Máquina de estados |
| 5 | `04-sla-preventivas-agenda-checklists.md` | 11 SLA · 12 Preventivas · 13 Agenda · 14 Checklists |
| 6 | `05-estoque-orcamentos-contratos-documentos-portal-pwa.md` | 15 Estoque · 16 Orçamentos · 17 Contratos · 18 Documentos · 19 Portal do cliente · 20 PWA do técnico |
| 7 | `06-rbac-auditoria-notificacoes-automacoes.md` | 21 Usuários e RBAC · 22 Auditoria · 23 Notificações · 24 Automações |
| 8 | `07-analytics-dashboard-busca-arquivos-campos-api-eventos.md` | 25 Analytics · 26 Dashboard · 27 Busca global · 28 Arquivos · 29 Campos personalizados · 30 API e webhooks · 31 Eventos de domínio |
| 9 | `08-modelo-de-dados-e-erd.md` | 32 Modelo de dados · 33 ERD conceitual |
| 10 | `09-requisitos-ux-arquitetura-seguranca.md` | 34 Requisitos não funcionais · 35 UX/UI · 36 Arquitetura técnica · 37 Segurança multitenant |
| 11 | `10-roadmap-e-epicos.md` | 38 Roadmap · 39 Épicos |
| 12 | `11-user-stories-criterios-edge-cases.md` | 40 User stories · 41 Critérios de aceite · 42 Edge cases |
| 13 | `12-backlog-mvp-adr-openquestions-antipatterns-diferenciais.md` | 43 Backlog · 44 Matriz MVP · 45 Decision log (ADR) · 46 Open questions · 47 Anti-patterns · 48 Diferenciais |

---

## Como usar em outra ferramenta

- **Revisão humana:** abra `AURORA-CMMS-SPEC-COMPLETE.md`. Tem tudo em um arquivo só.
- **Anexar em outro chat com limite de contexto:** anexe as partes relevantes. As mais densas são a 9 (modelo de dados), a 12 (user stories) e a 13 (backlog + ADRs).
- **Usar como fonte de verdade para implementação:** anexe `01-AUDITORIA-TECHNECARE.md` + a parte correspondente ao épico, e peça pelo identificador — por exemplo, *"implemente EPIC-001"*. Os identificadores (`EPIC-nnn`, `US-XXX-nnn`, `BL-nnn`, `ADR-nnn`, `OQ-nn`) são estáveis e cruzam entre as partes.

---

## Convenções dentro dos documentos

| Marcador | Significado |
|---|---|
| **DECISÃO** | Escolha tomada e justificada — implementar conforme escrito |
| **HIPÓTESE** | Suposição que precisa de validação antes do épico correspondente |
| **A VALIDAR** | Fórmula ou regra que a auditoria não conseguiu confirmar; não inventar |
| **ALTA / MÉDIA / BAIXA** | Confiança da evidência na auditoria: observado diretamente / evidência forte / hipótese |
| **P0 P1 P2 P3** | Prioridade no backlog |
| **S M L XL** | Complexidade estimada (≤2 dias / ≤1 semana / ≤3 semanas / >3 semanas) |
| **CORE MVP · MVP+ · FASE 2 · FASE 3 · FUTURO** | Classificação na matriz de MVP |

---

## Procedência

- Auditoria realizada em **28/08/2026** sobre `technecare.arkmeds.com` **v2.69.0**, em modo **somente leitura** — nenhum registro foi criado, alterado, excluído, assinado, aprovado, movimentado ou exportado no ambiente auditado.
- Especificação derivada dessa auditoria, sem acesso adicional ao sistema de referência.
- Conversão HTML → Markdown feita por script determinístico; tabelas, ADRs, épicos, user stories, critérios de aceite, ERD, backlog e open questions preservados na íntegra.
- Status da especificação: **rascunho v0.1, aguardando aprovação**.
