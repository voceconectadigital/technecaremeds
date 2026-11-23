# Relatório — auditoria corretiva de segurança, performance e escalabilidade

**Data:** 23/11/2026
**Branch:** `audit/seguranca-performance-2026-11-23`, a partir de `main` `c42d1d8`, que é a produção `186c748` mais a documentação da PR #47
**PR:** voceconectadigital/technecaremeds#48 (https://github.com/voceconectadigital/technecaremeds/pull/48)
**Backlog por ocorrência:** `docs/auditoria/BACKLOG_CORRECOES_SEGURANCA_PERFORMANCE.json`
**Medidas brutas:** `docs/auditoria/MEDIDAS_PERFORMANCE_2026-11-23.json`
**Classificação:** **APROVADA COM RESSALVAS** (ver §10)

Nesta rodada não houve merge, deploy nem migration aplicada em banco remoto. Os dados de produção não foram tocados e não houve teste de carga contra produção.

---

## 0. Como a auditoria foi feita

- **Ponto de partida.** A auditoria anterior (pente-fino de 17/10, `docs/AUDITORIA-PENTE-FINO-2026-10-17.md`, até a migration 0073) não foi refeita. O foco ficou no que entrou depois:
  - migrations 0074–0090;
  - Store, Qualidade, logomarcas, contratos e SLA;
  - foto do ativo, relatórios e automações por evento;
  - infraestrutura da API, dependências e performance, que o pente-fino não mediu.
- **Revisão.** Três revisões paralelas, todas só de leitura: autorização e multi-tenant; endurecimento da API e da infraestrutura; performance de SQL e dos workers. **Cada achado foi conferido no código antes de virar correção.** Os que não se confirmaram foram descartados. Os confirmados mas não corrigidos estão no backlog com o motivo.
- **Banco de teste.** O Docker desta máquina está travado em "stopping" e não foi forçado (ver memória do projeto). Por isso:
  - os testes locais rodaram em **PGlite**, que é PostgreSQL 16.4 em WASM;
  - a prova em **PostgreSQL 16 real** e o **Playwright** rodam no CI da PR (§4).
- **Performance.** Foi criada uma bancada de escala versionada, `tools/bench/escala-massa.cjs` + `escala-medir.cjs`:
  - **massa:** 10 organizações. A maior tem 50 mil OS, 5 mil ativos, 2.480 locais, 50 mil relógios de SLA e 150 mil transições de situação. No total são 68 mil OS e 272 mil transições;
  - **medição:** cada consulta roda dentro de transação sob `aurora_app`, com o contexto de tenant (RLS ativa, como a API);
  - **amostragem:** 3 execuções de aquecimento são descartadas e 15 são medidas; o relatório usa a mediana (p50) e o p95 do `EXPLAIN ANALYZE`;
  - **comparação:** antes e depois, no mesmo banco e com o mesmo método;
  - **números absolutos:** são do PGlite, que roda numa thread só. O que vale é a razão entre antes e depois e o plano (índice usado, buffers lidos).

---

## 1. Vulnerabilidades identificadas e corrigidas

| ID | Sev. | Achado | Correção | Estado |
|---|---|---|---|---|
| SEG-01 | **P1** | Qualquer pessoa, **sem login**, mandava um corpo `gzip` que o body-parser descompactava; o teto de 12 MB valia para a API inteira e era contado depois de descompactar. Poucos KB enviados viravam centenas de MB no contêiner de 1 GB, uma negação de serviço (detalhe técnico omitido de propósito) | `inflate: false` em todos os interpretadores de corpo; 12 MB só nas rotas que recebem base64 (`/assets`, `/organizations`, `/imports`, `/field`) e 2 MB no resto; 413/415/400 do Express viram problem+json (antes saíam como 500); body-parser 2.4.0 | CORRIGIDO |
| SEG-02 | P2 | Qualidade: o gestor restrito a um cliente **excluía** certificados de outro cliente e **criava** certificado "vigente" para equipamento alheio | Criar e excluir passam a conferir o escopo de cliente; fora dele, 404 | CORRIGIDO |
| SEG-03 | P3 | Qualidade: a leitura, o download e o upload ignoravam o **setor** do equipamento | Regra de escopo única (cliente + setor), igual à da lista de OS | PARCIAL (SEG-17) |
| SEG-04 | P3 | O certificado e a NF da Store aceitavam qualquer conteúdo declarado como PDF | Os bytes iniciais são conferidos contra o tipo declarado; se divergem, 422 | CORRIGIDO |
| SEG-05 | P3 | O `x-request-id` enviado pelo cliente chegava cru ao outbox: um membro conseguia **calar automações** e forjar a correlação da auditoria | Só `[A-Za-z0-9._-]{1,64}` é aceito; a marca de automação, que exige `:`, nunca passa | CORRIGIDO |
| SEG-06 | P3 | Os erros 4xx devolviam SQLSTATE, tabela e a mensagem crua do PostgreSQL | Esses campos saem da resposta e ficam no log | CORRIGIDO |
| SEG-07 | P3 | O login recusado gravava no log o e-mail digitado, que às vezes era a senha digitada no campo errado | O log grava só o resumo SHA-256 (16 hex) e o domínio | CORRIGIDO |
| SEG-08 | P3 | O log de erro gravava a consulta da URL (termos de busca) e o token do QR | O log grava só o caminho; o token aparece como `/q/:token` | CORRIGIDO |
| SEG-09 | P3 | A API não mandava cabeçalhos de segurança, anunciava `X-Powered-By: Express` e o CORS tinha `credentials: true` sem uso | `nosniff`, `DENY`, CSP mínima, `no-referrer` e `no-store`; sem `x-powered-by`; CORS sem credenciais (a sessão é por `Authorization`) | CORRIGIDO |
| SEG-10 | P2 | Nenhum limite nas rotas caras; com pool de 10 conexões, uma pessoa repetindo relatórios derrubava o login de todos | Teto de concorrência (2 por vínculo, 4 no processo) em relatórios, patrimonial, conformidade de planos e importação; acima dele, 429 com `retry_after_seconds` | CORRIGIDO |
| SEG-11 | P3 | Automação: quem tinha `automation.create` sem `work_order.assign` montava uma regra que agia em seu nome (escada de privilégio) | Criar e ativar exigem a permissão de cada ação **no próprio autor** | PARCIAL (escopo do autor) |
| SEG-12 | P3 | O `.dockerignore` só excluía `.env` da raiz | Exclui `**/.env*`, `.claude`, `capturas` e `graphify-out` | PARCIAL (digest da imagem) |
| SEG-13 | P2 | `npm audit`: 21 alertas, sendo 6 de produção (4 altos) e 15 de desenvolvimento | `npm audit fix` só com patch e minor, **21 → 1**; o lock foi regenerado com o npm 10, que é o do CI | PARCIAL (zod 4) |
| SEG-14 | P2 | A CSP dos três apps ainda está em modo Report-Only | `media-src blob:` (leitor de QR do campo); os bundles foram varridos e não têm `eval`, `new Function`, WASM, iframe nem origem externa | PARCIAL (ativar após deploy) |

**Verificado e correto, sem mudança:**
- **Migrations 0074–0090:** tabelas novas com RLS `ENABLE`+`FORCE`, `WITH CHECK`, FK composta e `GRANT` mínimo; funções com `search_path` fixo; nenhum `BYPASSRLS`.
- **Foto do ativo, laudo, ANVISA, ficha de vida e SLA efetivo:** com escopo.
- **Store:** público por cliente conferido no servidor.
- **Logomarcas:** bytes conferidos.
- **Relatórios:** nível contratado é teto também em xlsx; valores financeiros só com permissão.
- **PF-84** (fatias de upload): continua corrigido; nenhuma rota serve bytes de anexo de OS.
- **Infraestrutura:** `trust proxy` só para a rede privada; CORS com lista fechada; contexto de tenant por job nos workers; sem saída HTTP (sem SSRF).
- **Sessões:** o banco guarda só o resumo; o logout revoga no servidor; suspensão e troca de papel valem na requisição seguinte.
- **`check-secrets`:** 989 arquivos, nenhum segredo.
- **Docker:** a imagem roda como `USER node`.

---

## 2. Melhorias de performance, com medição

Base: org grande, PGlite 16.4, p50/p95 de 15 execuções, com RLS ativa.

| ID | Consulta | Antes (p50 / p95) | Depois (p50 / p95) | Buffers | Mudança |
|---|---|---|---|---|---|
| PERF-01 | Lista de OS sem filtro (tela padrão, `LIMIT 100`) | 131,0 / 169,4 ms | **0,48 / 0,50 ms** | 8.387 → 113 | índice `wo_org_created_idx` (0091) |
| PERF-10 | SLA cumprido no mês (Painel e relatórios, 12× na série) | 13,5 / 14,8 ms | **1,8 / 3,4 ms** | 3.230 → 800 | índice parcial `sla_clocks_stopped_idx` (0091) |
| PERF-11 | Tempo por situação no mês (relatórios) | 93,8 / 165,0 ms | **55,4 / 63,8 ms** | 29.512 → 28.345 | índice `wosh_org_changed_idx` (0091) |
| PERF-02 | Painel: ativos por setor | 247,5 / 329,6 ms | **31,6 / 41,4 ms** | — | ancestrais do próprio caminho por `unnest` e junção por chave |
| PERF-02 | Setor por item (planos, "hoje/espera"; 2.000 itens) | 156,8 / 252,5 ms | **53,6 / 68,7 ms** | 33.430 → 27.846 | `s.id = ANY(ancestrais)` na subconsulta `LIMIT 1` |
| PERF-05 | Varredura de SLA (a cada 5 min, por organização) | 17.638 linhas, 15,6 ms | **5.364 linhas, 9,5 ms** | — | não recarrega relógio já estourado: **12.274 UPDATEs sem efeito a menos** por varredura nessa org |
| PERF-08 | Workers: `concurrency` ignorado pelo pg-boss 12 | — | — | — | opção correta (`localConcurrency`), padrão 1 (o comportamento real até aqui) |

**Medido e rejeitado:**
- **`= ANY(...)` no agregado do Painel:** ficou **pior** que o `LIKE` (1.155 ms contra 247 ms), porque o planejador avalia a expressão por par. Foi usado `unnest` ali.
- **"Ativos sem setor":** o `LIKE` atual foi medido mais rápido (117 ms contra 130 ms com `unnest`) e ficou como estava.

As trocas de SQL têm **teste de equivalência** (`auditoria-performance-2026-11-23.test.ts`). O teste compara o conjunto de setores por ativo e a contagem agregada, cobrindo ativo sem local, ativo direto na unidade e setor apagado.

**Frontend** (`vite build`, JS gzip): o web já divide por rota (inicial cerca de 235 kB); o portal tem 175 kB num arquivo; o campo tem 180 kB mais 108 kB do leitor de QR. Não houve mudança (PERF-16): a refatoração do cliente tipado e o precache do PWA offline têm risco maior que o ganho. LCP, INP e CLS não foram medidos em navegador contra produção (sem acesso autenticado autorizado).

---

## 3. Gargalos de escalabilidade encontrados

O cenário estimado é de 10/50/100 organizações, milhares de equipamentos e dezenas de técnicos. A massa medida foi de 10 organizações; 50 e 100 são extrapolação, porque o custo dominante é **por organização**: a RLS filtra por `organization_id` e todos os índices novos começam por ela.

| ID | Gargalo | Medida / evidência | Estado |
|---|---|---|---|
| PERF-13 | Série do Painel e da TV: o backlog relê o histórico inteiro por intervalo | **626 ms** (31 dias, por dia) e 228 ms (12 meses) na org de 50 mil OS; a TV recarrega a cada 60 s | ABERTO: mexe no cálculo de indicador. Saída segura: cache de 30–60 s na API |
| PERF-03 | Sincronização do campo baixa o parque inteiro a cada 60 s; **acima de 2.000 ativos o aparelho perde equipamentos sem aviso** | leitura de código | ABERTO: muda o contrato offline |
| PERF-04 | O plano preventivo grande gera as OS numa transação só, segurando a numeração de OS da organização | leitura de código | ABERTO: muda a garantia "tudo ou nada" |
| PERF-06 | Relatório com série de 12 meses faz centenas de consultas e gera o PDF no request | leitura de código | MITIGADO por SEG-10 |
| PERF-09 | Outbox: vazão de cerca de 2 mil eventos por minuto, em série | leitura de código | ABERTO |
| PERF-07 | `current_organization_id()` não é inlinável e é PARALLEL UNSAFE | leitura de código | ABERTO: medir em PG16 real |
| PERF-12, PERF-14 | Itens de ciclo por `due_at`; busca com `normalize_label` por linha; lista de ativos por nome | não medido | ABERTO |
| PERF-15 | Sem retenção para `domain_events`, `rule_runs`, `audit_logs` e `notifications` | — | DECISÃO |
| — | Pool de 10 conexões (API e worker): com SEG-10, as rotas caras ocupam no máximo 4 | — | dimensionar `AURORA_DB_POOL_MAX` com o banco definitivo |

**Técnicos simultâneos.** A execução de OS é por OS, com `FOR UPDATE` na transição (pente-fino), e a lista de OS ficou constante (0,5 ms). O gargalo real de vários técnicos é o PERF-03 (o pacote de sincronização), não a execução.

---

## 4. Resultado dos testes e do CI

| Verificação | Onde | Resultado |
|---|---|---|
| Regressão de segurança nova (`api-auditoria-seguranca-2026-11-23.test.ts`) | local (PGlite) | **14/14** |
| Regressão de performance nova (`auditoria-performance-2026-11-23.test.ts`) | local | **5/5** (com migrations e upgrade: 14/14) |
| Automações (inclui o caso novo SEG-11) | local | **40/40** |
| Auth, Qualidade, Store, logomarcas, importação, relatórios, patrimonial, isolamento, insights, workers, SLA | local | **267/267** (17 arquivos) |
| Painel, planos, hoje/espera, indicadores, métricas, relatórios, SLA, OS | local | **410/410** (22 arquivos) |
| CSP do Pages | local | 4/4 |
| `typecheck` (tsc -b), `eslint` nos arquivos tocados, `spec:audit`, `openapi:check`, `check-secrets` | local | verdes |
| `marca:check`, `format:check` | local | só os falsos positivos de CRLF do checkout Windows (PF-85); verdes no CI |
| `npm audit` | local | 21 → **1** (zod, só resolvido com versão principal nova) |
| CI: Estático + PostgreSQL 16 (suíte inteira) + Playwright E2E + Gate | GitHub Actions, PR #48 | ver §4.1 |

A suíte completa local (cerca de 2.900 testes) não foi rodada de uma vez nesta máquina, porque os PGlite estouram a memória (§24 do handoff). A prova completa é o job "Testes contra PostgreSQL 16" do CI, mais o E2E.

### 4.1 CI

| Execução | Commit | Estático | PostgreSQL 16 | E2E | Gate |
|---|---|---|---|---|---|
| 1 | `0e3e130` | ✗ `npm ci` (lock gerado no npm 11/Windows sem opcionais WASM) | — | — | — |
| 2 | `a32b561` | ✗ formatação de um teste | — | — | — |
| 3 | `5f9b28f` | ✓ | pulado (PR em rascunho) | pulado | pulado |
| 4 | HEAD após "ready for review" | em execução no momento deste registro | — | — | — |

O workflow só roda PG16 e E2E com a PR **fora de rascunho**; ela foi marcada "pronta para revisão" (não é merge) para
disparar a prova completa. O resultado final fica nos checks da PR #48 — **não publicar antes de Gate verde**.

---

## 5. Riscos remanescentes

1. **PERF-03.** Organização com mais de 2.000 ativos: o app de campo não recebe todos os equipamentos. É defeito funcional latente, corrigido só com a mudança do contrato de sincronização.
2. **SEG-14.** A CSP ainda não bloqueia: um XSS futuro leria o token, que fica 30 dias no `localStorage` (SEG-15).
3. **SEG-13.** O zod 3 tem alerta alto de consumo de memória. A validação roda depois do login e os contratos limitam os arrays, então o risco é baixo, mas existe.
4. **SEG-17.** Certificados de treinamento (sem cliente) são visíveis no portal de todos os clientes.
5. **SEG-11.** A automação não herda o escopo de cliente de quem a criou.
6. **PERF-13, PERF-04, PERF-09.** Painel, varredura de planos e outbox crescem com o volume da organização.
7. **SEG-16.** A rotina de backup e retenção não está versionada (o restore drill é feito a cada deploy, segundo os relatórios).
8. **Ambiente.** A medição foi em PGlite, numa thread só. O comportamento com concorrência real e paralelismo do PG16 não foi medido localmente.

---

## 6. Correções que dependem da sua autorização

| Item | O que fazer | Por que precisa de autorização |
|---|---|---|
| Publicar esta PR | merge na `main` e deploy da API (HostPanel) | proibido sem ordem expressa |
| **Migration 0091** (3 índices, só aditiva) | aplicada pelo deploy da API (manifesto) | migration remota |
| Ativar a CSP bloqueante (SEG-14) | depois do deploy do front, abrir os três domínios logado e conferir o console sem "Content-Security-Policy-Report-Only"; então `REPORT_ONLY = false` em `tools/lib/cabecalhos-pages.mjs` e publicar o front | exige navegação autenticada em produção e novo deploy |
| Tirar índices redundantes (PERF-17) | ler `pg_stat_user_indexes.idx_scan` em produção (só leitura) e, se for zero, `DROP INDEX` numa migration | leitura em produção e migration remota |
| zod 4 (SEG-13) | migração de versão principal em PR própria | mudança ampla de dependência |
| Decisões de negócio | SEG-15 (prazo da sessão), SEG-17 (treinamento visível no portal), SEG-11 (escopo da automação), PERF-15 (retenção), PERF-03/04/13 (contrato offline, transação do plano, cálculo da série) | regra de produto ou indicador do Anderson |

---

## 7. Impacto esperado na produção

- **API:**
  - nenhuma rota nova nem removida e nenhum contrato Zod alterado (`openapi:check` em dia);
  - corpo `gzip` passa a ser recusado com 415. Nenhum dos três apps envia corpo compactado;
  - JSON acima de 2 MB fora de `/assets`, `/organizations`, `/imports` e `/field` passa a receber 413. Nenhuma tela manda corpo assim;
  - relatórios e exportações simultâneos acima do teto recebem 429 com espera de 5 s;
  - erros não trazem mais `sqlstate`, `table` e `pg_message` (nenhuma tela os lê);
  - todas as respostas saem com `Cache-Control: no-store`, exceto os arquivos, que mantêm o próprio cabeçalho.
- **Qualidade:** gestor ou solicitante restrito deixa de ver ou mexer em registros fora do cliente e do setor dele. Isso é a correção, não regressão.
- **Automações:** regra criada por quem não tem a permissão da ação passa a ser recusada com 403. As regras existentes continuam ativas e funcionando.
- **Banco:** a `0091` cria três índices. As tabelas de produção são pequenas, então a construção leva segundos, mas um `CREATE INDEX` comum bloqueia a escrita nessas três tabelas enquanto roda. Por isso, publicar em horário de pouco uso.
- **Workers:** sem mudança de comportamento (concorrência 1, como já era de fato). A varredura de SLA fica mais leve.
- **Front:** só o `_headers` muda, com `media-src`; a CSP continua Report-Only.

---

## 8. Plano seguro de publicação e rollback

1. **CI verde** no HEAD da PR #48: Estático, PG16, E2E e Gate.
2. **Backup novo e `restore_drill` verificado** no HostPanel, como nos deploys de 09/11 e 13/11.
3. **Merge** da PR na `main`, só com a sua autorização.
4. **Deploy da API.** HostPanel → "Téchne Care — produção" (`pgv-pe0b9asx`) → deploy com o SHA completo do merge. O manifesto roda a `0091`.
5. **Smoke test, só leitura:**
   - `/v1/health/ready` ok;
   - `/v1/health/version`: a `impressao` precisa ser igual a `npm run versao` no commit;
   - login normal e a lista de OS abrindo;
   - Painel abrindo;
   - um relatório Basic em PDF;
   - Qualidade listando.
6. **Front.** Só se for publicar a mudança de `_headers`. É opcional: o front atual funciona com a API nova.
7. **Rollback da API:** reimplantar `186c748221384bd1387f313acd73932318d697fb` (impressão `e7e464ca30f8`). A `0091` é só de índices, então a API anterior funciona com ela e não é preciso desfazê-la.
8. **Rollback dos índices, se quiser:**
   ```sql
   DROP INDEX aurora.wo_org_created_idx, aurora.sla_clocks_stopped_idx, aurora.wosh_org_changed_idx;
   ```
   Isso não é necessário para voltar a API.
9. **Rollback do front:** promover o deploy `22adacf6` no Pages.

---

## 9. Link da PR

https://github.com/voceconectadigital/technecaremeds/pull/48

---

## 10. Classificação

**APROVADA COM RESSALVAS.**

- **Aprovada porque:**
  - o único P1 de segurança (SEG-01) e todos os P2/P3 corrigíveis sem mudar regra de negócio foram corrigidos, com teste de regressão;
  - os dois P1 de performance medidos (PERF-01 e PERF-02) caíram uma ou mais ordens de grandeza;
  - nenhuma mudança altera contrato de API, cálculo financeiro, indicador pendente nem funcionalidade da V2.
- **Ressalvas:**
  - a publicação depende de CI verde no HEAD final, de backup verificado e da sua autorização (merge, deploy e `0091`);
  - ficam abertos, com motivo, o PERF-03 (sincronização com mais de 2.000 ativos), a CSP bloqueante (SEG-14), o zod 4 e as decisões listadas no §6.

Não se afirma que o sistema esteja "100% seguro" ou "otimizado": este relatório cobre o que foi verificado e medido acima.
