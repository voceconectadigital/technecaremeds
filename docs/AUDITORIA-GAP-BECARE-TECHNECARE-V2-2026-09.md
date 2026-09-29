# Auditoria de gap — Plataforma Be Care | Téchne Care V2 × sistema atual

**Data:** 17/09/2026 · **Repositório:** `voceconectadigital/technecaremeds` (nome preservado) ·
**Codinome interno:** Aurora (não consolidado como marca pública) · **Natureza:** somente leitura —
nenhuma migration, código, banco, deploy ou integração foi criado ou alterado nesta sessão.

**Fontes desta auditoria, e nada além delas:**

| Sigla | Fonte |
| --- | --- |
| **PLAT** | `Plataforma_BeCare_TechneCare_V2_FINAL_Para_Desenvolvedor.pdf` (8 páginas, 15 seções) |
| **CART** | `Cartilha_Parceria_Tecnologica_BeCare_TechneCare_FINAL.pdf` (5 páginas, 9 seções) |
| **SPEC** | `docs/AURORA-CMMS-SPEC-v0.2.md` (49 seções, 30 ADRs) |
| **PROG** | `docs/PROGRESS.md`, relatórios de sessão de 29 e 30/08/2026, `AURORA-METROLOGIA-FRONTEIRA.md`, `ADR-029` |
| **CÓD** | `packages/db/migrations/0000–0044`, `packages/domain`, `packages/contracts`, `packages/events`, `apps/api`, `apps/web`, `apps/portal`, `apps/field`, `apps/workers` |

Arkmeds, Fluke Biomedical, Fluke OneQA e BC Biomedical aparecem nos PDFs como **benchmarks**. Esta
auditoria não acessou nenhum deles, não presume UX não documentada e não reproduz funcionalidade
proprietária. Onde faltar referência visual, está marcado **REFERÊNCIA VISUAL A VALIDAR** — e isso não
travou a análise funcional.

---

## 1. Resumo executivo

**O sistema construído é compatível com a nova visão. Não há mudança de fundação; há ampliação de
domínio.** As dez perguntas do objetivo, respondidas em uma linha cada:

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | O que já existe completamente? | O núcleo operacional inteiro (PLAT §4 "escopo mínimo" de Identidade, Ativos, Chamados/OS, Preventivas, Estoque, Portal, Indicadores, Documentos-motor, Contratos), o app offline com idempotência provada, RLS forçada em todas as tabelas, auditoria append-only, outbox de eventos. |
| 2 | O que existe parcialmente? | Metrologia (apenas a "fronteira": validade de padrão na data da medição e cadeia de rastreabilidade — em memória, sem tabela); medição estruturada (checklist `number` com faixa e veredito, mas sem instrumento, certificado, origem e sem histórico imutável); documentos de calibração/TSE/qualificação (tipos provisionados, payload vazio, sem PDF); importação (só ativos, sem pipeline rastreável). |
| 3 | O que precisa ser adaptado agora? | Medição deixar de ser sobrescrita (`ON CONFLICT DO UPDATE` sem auditoria) e ganhar proveniência; `attachments` aceitar dono "sessão de medição"/dado bruto; `organizations` ganhar modo de uso e recursos habilitados; `external_id`/origem nas entidades migráveis. Todos aditivos. |
| 4 | O que é realmente novo? | Instrumento (catálogo + exemplar), Certificado de instrumento/padrão, Procedimento/protocolo metrológico versionado, Sessão de medição, Dado bruto, Modelo de relatório com motor de preenchimento, Oportunidade, Pipeline de migração Arkmeds, MFA. |
| 5 | O que deve ser apenas preparado arquiteturalmente? | Porta de fonte de medição (N1–N4), Be Care Link (identificação por QR/NFC de instrumento e certificado; confirmação de sincronização já existe), conectores externos (Omie, WhatsApp, calendário, BI), provenance para IA. |
| 6 | O que permanece fora do escopo inicial? | Hardware, drivers, SDKs, BLE/USB/serial, instrumentos próprios, IA, marketplace/catálogo/cotações de equipamentos, integração Omie, microserviços. |
| 7 | O que depende de decisão do cliente? | Nome comercial; norma e tolerâncias por família; quais famílias de teste entram primeiro (calibração, TSE, qualificação térmica); política de fechamento de ciclo preventivo; formato/escopo da exportação Arkmeds; modo de autenticação (Supabase Auth + MFA); hospedagem. |
| 8 | Há contradição entre os PDFs e decisões já implementadas? | **Nenhuma contradição estrutural.** Há três reversões de *defaults* da SPEC: OQ-01 (migração Arkmeds passa a ser **sim**), OQ-04 (metrologia N0 passa a ser **núcleo inicial**, não F10), OQ-14 (integração com analisadores passa a ser **reserva obrigatória**). E uma nuance de nome: PLAT chama de "Procedimento" o que a SPEC chama de `procedures` + `checklist_templates`. |
| 9 | Alguma estrutura atual impediria a evolução? | **Não.** Dois pontos exigem atenção para não impedir: (a) `checklist_answers` sobrescreve o valor anterior e não tem gatilho de auditoria — uma medição "corrigida" apaga a anterior; (b) `attachments.att_has_owner` só admite OS ou resposta de item como dono. Ambos são migrations aditivas, não reestruturação. |
| 10 | Mudar fundação ou ampliar domínio? | **Ampliar o domínio.** Multitenancy, RLS, outbox, `client_operation_id`, motor de documentos, checklists versionados, porta de armazenamento e porta de autenticação já são os pontos de extensão que os PDFs pedem. |

**Aderência aproximada:** ~65 % ao conjunto dos dois PDFs (contando os itens FUTURO como "preparação
exigida", não como feature). Por eixo: operação ~85 %; engenharia clínica/N0 ~35 %; núcleo de
instrumentação (entidades reservadas) ~15 %; segurança/governança ~75 %; integrações ~40 %
(pontos de extensão existem, conectores não).

---

## 2. O que mudou na visão do cliente

| Mudança | Onde | O que altera na prática |
| --- | --- | --- |
| **O produto é engenharia clínica, não CMMS.** "A plataforma não deve ser apenas um sistema de manutenção" | PLAT §1 | Metrologia sai de F10 (SPEC §38) e entra no núcleo como **N0 manual estruturado** (PLAT §6.1). |
| **Instrumento, procedimento, sessão de medição, certificado, relatório e oportunidade** são entidades que devem **nascer agora** | PLAT §5, §15 "Encaminhamento"; CART §8 | Cinco entidades novas + uma (relatório) que amplia o motor de documentos. Nenhuma existe como tabela hoje. |
| **Medição manual e integrada usam o mesmo modelo** | PLAT §14; CART §7 item 3 | A medição não pode viver só em `checklist_answers.value_number`; precisa de envelope neutro com origem. |
| **Dado bruto preservado** | PLAT §6.2 passo 5; CART §5 passo 7 | `attachments` precisa aceitar dono "sessão de medição" e finalidade "dado bruto". |
| **Migração do Arkmeds passa a ser processo formal** com arquivo histórico, amostra, lote, relatório de inconsistências e operação paralela | PLAT §12 | Reverte o *default* de OQ-01 ("começar do zero"). Importação vira pipeline rastreável, não comando. |
| **Cinco modos de uso** (prestadora, hospital, fabricante, consultoria, instrumentação/laboratório) | PLAT §2 | Confirma ADR-004 (cliente sempre presente) e exige "recursos habilitados" por organização (PLAT §4 Identidade → evolução). |
| **Oportunidade** como objeto de negócio | PLAT §4, §5 | Entidade nova; evolução para catálogo/cotações/mercado é futura. |
| **Integrações nomeadas**: Omie, WhatsApp, calendário, BI, instrumentos, sistemas hospitalares | PLAT §10 | Confirma a SPEC §30 (webhooks, ERP hospitalar) e acrescenta Omie. Nada disso existe como conector. |
| **Segurança nomeia MFA, SSO futuro, criptografia, backups testados, auditoria imutável de medições** | PLAT §11 | MFA não existe; auditoria não cobre `checklist_answers` nem `attachments`. |
| **Be Care Link** como primeiro produto próprio | PLAT §7; CART §4 | Só reserva: o servidor já tem idempotência, confirmação e conflito visível; falta identificar instrumento/certificado. |
| **IA em cinco modos, sempre com aprovação humana e dados isolados por cliente** | PLAT §9 | Provenance (fonte, versão, aprovação) precisa existir no modelo de dados das entidades novas. |
| **Nome comercial "Be Care Clinical Platform"** é de trabalho | PLAT §2 | `marca.config.json` já concentra a marca; nenhuma refatoração de nome nesta fase. |

## 3. O que NÃO mudou

- **Arquitetura**: "aplicação modular com API centralizada, banco transacional, armazenamento de
  evidências, fila de tarefas e app offline; não é necessário iniciar com microserviços" (PLAT §3) é
  literalmente o ADR-010 + ADR-017 + ADR-018/029 implementados: NestJS modular, PostgreSQL com RLS,
  porta `ArmazenamentoDeObjetos`, pg-boss, `apps/field`.
- **Segregação por organização** (PLAT §2) = ADR-001/023, 10 camadas do §37, `withTenant` único
  caminho, `FORCE ROW LEVEL SECURITY` em toda tabela tenant-scoped.
- **Chamado separado de OS** = ADR-002; **estados × motivos** = ADR-003; **checklist relacional
  versionado** = ADR-012; **motor único de documentos** = ADR-013.
- **App offline sem perda nem duplicidade** (PLAT §14 critério 1) = EPIC-014, provado com o teste de
  vinte passos (sessão 30/08).
- **API como única porta** (PLAT §14 critério 9) = ADR-016 + ADR-010; nenhum frontend fala com o banco
  ou com o Supabase diretamente (verificado por `grep` em `apps/*`: zero ocorrências de cliente
  Supabase).
- **Não inventar regra metrológica** = `AURORA-METROLOGIA-FRONTEIRA.md` e
  `DECISOES_METROLOGICAS_BLOQUEADAS` com teste que falha se aparecer cálculo. PLAT §11 reforça:
  "instrumentos próprios tratados como projetos separados de hardware, firmware, calibração,
  qualidade e conformidade".
- **Fluke/BC/Arkmeds são benchmark, não dependência** — o repositório já obedece à mesma regra desde
  a auditoria de 28/08.

## 4. Escopo atual × evolução futura

Os dois PDFs abrem com a mesma "Regra de escopo": integração física, fabricação e captura automática
**não fazem parte da contratação atual**, mas a arquitetura deve reservar os pontos. A tabela abaixo é
a leitura operacional dessa regra, e governa toda classificação de FASE nesta auditoria.

| Nível (PLAT §6.1) | O que é | Classificação nesta auditoria |
| --- | --- | --- |
| **N0 — manual estruturado** | Técnico registra valores; sistema associa unidade, faixa e resultado | **AGORA — necessário para o núcleo** |
| **N1 — arquivo** | CSV, XML, PDF estruturado, export do instrumento | **FUTURO — reservar adaptador** (porta de fonte de medição) |
| **N2 — gateway Be Care Link** | USB/serial/Ethernet/BLE → OS | **FUTURO — não implementar**; só reservar contrato de entrada |
| **N3 — protocolo autorizado** | SDK/API/protocolo | **FUTURO — não implementar** |
| **N4 — instrumento próprio** | Protocolo aberto nativo | **FUTURO — não implementar** |

Roadmap do cliente (PLAT §13) × estado do repositório:

| Fase PLAT | Entrega prevista | Estado |
| --- | --- | --- |
| 0 — fundação | Domínio, dados, segurança, APIs, telas, importação, protótipo de sincronização | **Feita**, exceto importação como pipeline (§28) |
| 1 — operação | Ativos, chamados, OS, preventivas, app offline, portal, documentos, indicadores | **Feita** (interface fechada em 29/08; portal e field entregues) |
| 2 — engenharia clínica | Criticidade, metrologia, calibração, TSE, qualificação, aceitação, ciclo de vida | **Parcial** — criticidade e ciclo de vida de ativo existem; metrologia só a fronteira; aceitação/qualificação ausentes |
| 3 — integração | Omie, arquivos de instrumentos, protocolo neutro, conectores, Be Care Link | **Não iniciada**; pontos de extensão existem (outbox, portas) |
| 4 — automação | Relatório automático, IA | **Não iniciada** |
| 5 — linha própria | Be Care Link, sensores, instrumentos | **Fora de escopo** |

## 5. Compatibilidade da arquitetura atual

| Camada PLAT §3 | Decisão do cliente | O que existe | Compatível? |
| --- | --- | --- | --- |
| Experiência | Web, portal, app offline | `apps/web` (16 rotas protegidas), `apps/portal` (5 telas), `apps/field` (8 telas, PWA + Capacitor, ADR-029) | **Sim** |
| Plataforma | API, identidade, permissões, multiempresa, auditoria, configuração por módulo | NestJS 11, `AuthProvider` (porta), 107 permissões/11 papéis, RLS, `audit_logs` append-only, `organizations.settings jsonb` | **Sim**; "configuração por módulo" ainda não tem forma (só `settings` livre) |
| Domínios | Ativos, chamados, OS, preventivas, metrologia, contratos, estoque, documentos | 92 tabelas em 45 migrations; metrologia só em `packages/domain/src/metrologia.ts` (sem tabela) | **Sim** para 7 de 8; **metrologia é o gap** |
| Integração | Importadores, conectores, drivers, SDK, gateway, protocolo neutro | Outbox + `EventSink` (interface), `ArmazenamentoDeObjetos` (porta), `importAssets` (só ativos), fila offline genérica (`agregado/metodo/caminho/corpo`) | **Parcial**: há portas, não há protocolo neutro de medição nem conector algum |
| Expansão | Instrumentos, IA, Omie, BI, mercado | Nada; `insights` já devolve numerador/denominador (base de BI) | **Reserva possível** sem mudar núcleo |

**Veredito:** a fundação sustenta a nova visão. As entidades pedidas no "Encaminhamento ao
desenvolvedor" (PLAT p. 8) — Instrumento, protocolo de medição, sessão de medição, dado bruto, motor de
modelos de relatório — entram como **módulo novo** (`metrology`/`measurements`) com as mesmas
convenções (UUID v7, FK composta com `organization_id`, RLS forçada, auditoria por gatilho, evento no
outbox, contrato Zod). Nenhuma delas exige tocar em OS, RLS, outbox ou fila offline.

---

## 6. Matriz funcional (PLAT §4 — módulo a módulo)

Legenda de estado: **IMPL** implementado · **PARC** parcial · **AUS** ausente · **FUT-RA** futuro,
reservar arquitetura · **FUT-NI** futuro, não implementar · **VAL-C** a validar com cliente ·
**VAL-E** a validar com especialista técnico/metrológico.

| Módulo | Escopo mínimo (PLAT §4) | Estado | Evidência | Evolução (PLAT §4) | Estado |
| --- | --- | --- | --- | --- | --- |
| Identidade | Organizações, unidades, setores, locais, usuários, perfis | **IMPL** | `0001`, `0006`, `0008`, `FACTORY_ROLES` (11), `membership_scopes` por cliente/local/almoxarifado | Planos, recursos habilitados, co-branding | **PARC**: `organizations.plan`, `seat_limit`, `logo_key`, `settings` existem; sem feature flags por módulo, sem co-branding no portal |
| Ativos | Patrimônio, série, fabricante, modelo, localização, garantia, criticidade | **IMPL** | `0013`, `0014`: `assets` (tag/serial/asset_number, `asset_model_id`→`manufacturers`, `criticality_id`, `warranty_until`, `risk_class`, `requires_calibration`, `requires_electrical_test`) | Ciclo de vida, obsolescência, substituição | **PARC**: `manufactured_at/acquired_at/installed_at/useful_life_years/decommissioned_at` + `asset_status` (6 estados) + `obsolescence_report` (tipo provisionado, payload vazio); sem "substituição" como relação ativo→sucessor |
| Chamados e OS | Triagem, prioridade, SLA, execução, peças, evidências, assinatura | **IMPL** | `0018–0028`, `0030`; `service_requests`→`work_orders`; `sla_clocks`; `checklist_*`; `stock_reservations`; `attachments`; `signatures` | Workflows por contrato e automações | **IMPL**: `contract_sla_overrides` (0031), máquina de estados configurável (ADR-003), `automation_rules` (0037) |
| Preventivas | Planos, periodicidade, checklists, vencimentos, pendências | **IMPL** | `0029`: `plan_tasks.frequency_*`, `checklist_template_key`, `plan_cycle_items` com `tolerance_days` | Planos por família, risco e fabricante | **PARC**: alvo por categoria/local/ativo (`plan_target_kind`); não por **modelo/fabricante** nem por criticidade |
| Metrologia | Instrumentos, certificados, medições, tolerâncias, resultados | **PARC (baixo)** | Só `packages/domain/src/metrologia.ts` (validade na data da medição, cadeia); nenhuma tabela `instruments`/`standards`/`certificates`/`measurement_*` | Captura automática e rastreabilidade | **FUT-RA** |
| Relatórios | Laudos, certificados, documentos versionados | **PARC** | `0034`: motor único, 6 tipos provisionados (`DOCUMENT_TYPES`), versão/supersede/assinatura/hash; `payloadFields: []` em todos; `pdf_key` sem renderizador | Geração automática a partir de medições | **FUT-RA** (depende da sessão de medição) |
| Estoque | Itens, almoxarifados, viaturas, consumo, reserva | **IMPL** | `0030`: `warehouses.kind='van'` com dono, razão imutável, `stock_balances` por gatilho | Lote, série, validade, reposição | **PARC**: `stock_lots` escrita, `item_tracking` existe, rastreio não exigido na baixa; `checkMinimum` sinaliza, não repõe |
| Portal | Chamados, status, agenda, documentos, aprovações | **IMPL** | `portal.controller.ts` (10 rotas), PORTAL-011 (varredura de vazamento com controle positivo), `customer_label` (0042) | NPS, notificações, relatórios por unidade | **PARC**: `service_requests.rating` existe sem fluxo; notificações internas existem sem transporte; relatório por unidade ausente |
| Indicadores | Backlog, SLA, preventivas, produtividade, ativos | **IMPL** | `insights.controller.ts` (14 rotas), `fact_work_order` por gatilho, toda métrica viaja com definição | MTTR, MTBF, disponibilidade, risco, IA | **PARC**: MTTR e MTBF existem com fórmula declarada; disponibilidade e risco **VAL-C** (o que caracteriza parada) |
| Oportunidades | Demandas autorizadas, necessidades, equipamentos | **AUS** | nenhuma tabela, permissão ou rota | Catálogo, cotações, mercado | **FUT-NI** |

---

## 7. Ativos

| Requisito PLAT §5 "Ativo" | Estado | Evidência |
| --- | --- | --- |
| Tag, patrimônio, série | IMPL | `assets.tag/asset_number/serial_number` + unicidade configurável por índice (`asset_identifiers`) |
| Fabricante, modelo, família | IMPL | `manufacturers` → `asset_models` → `assets`; `asset_categories` cumpre "família" |
| Local | IMPL | `location_id` + `location_path` materializado; transferência só por operação (`asset_transfers`) |
| Criticidade | IMPL | `criticality_levels.score/sla_multiplier` entra na cascata de SLA |
| Garantia | IMPL | `warranty_until` + `under_warranty` na ficha |
| Status e ciclo de vida | IMPL | `asset_status` (active/under_maintenance/standby/loaned/decommissioned/disposed); `assets_lifecycle_order` CHECK; descomissionar exige motivo |
| Obsolescência | PARC | tipo `obsolescence_report` provisionado com payload vazio; sem indicador |
| Substituição | AUS | sem `replaced_by_asset_id`/relação sucessor; **VAL-C** se é relação ou só documento |
| Histórico completo (critério 3 do §14) | PARC | Ficha devolve transferências (limite 20); OS por ativo via `/work-orders?assetId`; documentos via `/documents/by-asset`; trilha via `/audit/timeline/asset/:id`. **Não há uma "linha do tempo do ativo" unificada** (serviços + documentos + medições + ciclo de vida) numa rota; e medições não têm entidade própria para constar |
| Identificação por QR | IMPL | `qr_token` 130 bits, `/q/:token` sem sessão, `rotate-qr`, tela QR no field resolve offline |
| NFC | AUS | **FUT-RA** (o token já é opaco e independente do meio) |
| `external_id`/origem para migração | AUS | OQ-09 previa `external_id` desde F2; não há a coluna em ativo, cliente, OS nem item |

## 8. Chamados / OS

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Chamado separado de OS, triagem, duplicidade, relato imutável | IMPL | ADR-002; `0018/0019`; `POST /service-requests/:id/transitions` |
| Prioridade, criticidade | IMPL | `work_orders.priority/criticality_id` |
| SLA por contrato, calendário, fuso, pausa por motivo | IMPL | `0027/0028/0031`; 33 testes de tempo útil |
| Atribuição, agenda com conferência prévia | IMPL | `POST /schedule/check`, ausência bloqueia, sobreposição avisa |
| Execução: checklist, horas, peças, evidências, assinatura, diagnóstico | IMPL | `execution.controller.ts`; `signatures` com hash do conteúdo |
| Bloco de conclusão (412 com lista) | IMPL | `checkCompletion` + `completion_requirements` |
| Finalização/fechamento/reabertura | IMPL | `work_order_status_transitions` como dado; gatilho recusa transição não declarada |
| OS de calibração/TSE como natureza | IMPL | `catalogs.ts`: `systemKeys` inclui `calibration`, `inspection` |
| Vínculo OS ↔ sessão de medição | AUS | não há entidade de sessão; a OS só se liga a `checklist_responses` |
| Kanban/lista/ficha na web e no field | IMPL | `features/ordens`, `telas/ordem.tsx` |

## 9. Preventivas

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Planos, periodicidade por tarefa, alvo como expressão | IMPL | `0029`; teste de ativo novo entrando sozinho |
| Checklist por tarefa | IMPL | `plan_tasks.checklist_template_key` |
| Vencimentos, tolerância, pendências, dispensa com justificativa | IMPL | `plan_cycle_items`, `skip_reason` ≥ 10 chars |
| Planos por família | PARC | alvo por categoria sim; por **modelo/fabricante** não (`plan_target_kind` = asset/category/location) |
| Planos por risco | AUS | sem filtro por `criticality_id` no alvo |
| Planos por fabricante | AUS | idem |
| Fechamento de ciclo | LACUNA CONHECIDA | `plan_cycles.status='closed'` nunca é escrito (PROG "Lacuna conhecida") — **VAL-C** |
| Gatilho por uso/condição | FUT | colunas existem (`trigger = meter/condition`), sem uso |

## 10. Estoque

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Itens, almoxarifados, viatura | IMPL | `warehouses.kind` ∈ {…,'van'} exige `owner_membership_id` |
| Consumo, reserva, saldo, negativo por CHECK | IMPL | `stock_movements` imutável, `stock_balances`, `stock_reservations` |
| Lote, série, validade | PARC | `stock_lots.expires_at` e `inventory_items.tracking` existem; baixa não exige lote/série |
| Reposição | PARC | `stock.below_minimum` (evento) e `checkMinimum`; sem requisição de compra |
| Estoque no field (saldo do carro) | IMPL | `GET /field/sync` desce o saldo; consumo entra na fila offline |

## 11. Portal

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Chamados (abrir, acompanhar), status traduzido | IMPL | `portal.controller.ts`; `customer_label` (0042) |
| Agenda | IMPL | `GET /portal/schedule` |
| Documentos liberados | IMPL | `GET /portal/documents` só `released` |
| Aprovações (orçamento) | PARC | rota lê orçamentos; aprovação pelo portal ainda entra pela API interna (PROG EPIC-016 "adiado") |
| Relatórios | AUS | sem rota de indicadores no portal |
| NPS | PARC | `rating/rating_comment` existem, sem fluxo |
| Notificações ao cliente | PARC | fila de saída existe; transporte (e-mail/WhatsApp) ausente por decisão |
| Hospital vê só o autorizado (critério 2) | IMPL | PORTAL-011 varre toda resposta contra chaves internas, com controle positivo |
| Co-branding | AUS | `organizations.logo_key` existe; portal não o usa |

## 12. Documentos

| Requisito (PLAT §4/§5 "Relatório", CART §8) | Estado | Evidência |
| --- | --- | --- |
| Laudos, certificados, documentos versionados | IMPL (motor) | `documents.version/supersedes_id`, número queimado, série por tipo |
| Aprovação/revisão | IMPL | `draft → under_review → issued → released`; permissão sai da aresta |
| Assinatura com hash | IMPL | `document_signatures`; conteúdo congelado; `icp_brasil` modelado e **recusado** até validar cadeia |
| Trilha de auditoria | IMPL | `documents_audit`, `document_status_history` |
| Responsável técnico | IMPL | `technical_manager_id` + `requires_technical_manager` |
| **Modelo versionado com campos** | PARC | `document_types.payload_fields` (gramática de campos do EPIC-004) existe; **os seis tipos têm `payloadFields: []`**; `template_key` sem motor de modelo |
| **Preenchimento automático a partir de medições** | AUS | não há sessão de medição para preencher |
| **PDF** | AUS | `pdf_key` sem serviço de renderização (PROG EPIC-018 "adiado") |
| Vínculo permanente ao ativo | IMPL | `documents.asset_id` (FK composta), `/documents/by-asset` |

## 13. Indicadores

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Backlog, SLA, preventivas, produtividade, ativos | IMPL | 14 rotas em `insights`, `fact_work_order` por gatilho com `rebuild` |
| MTTR, MTBF | IMPL com aviso | fórmula própria declarada; comparação com o antigo exige fórmula do fornecedor (PROG EPIC-021) |
| Disponibilidade | VAL-C | depende de definir o que é parada |
| Risco | AUS | sem indicador de risco (criticidade × falhas) — **VAL-E** para a fórmula |
| Painéis por unidade / BI / exportação CSV-XLSX | PARC | rotas devolvem JSON com definição; sem exportação nem painéis salvos (`dashboards` da SPEC não existe) |

## 14. Engenharia clínica

| Item (PLAT §1 pilar; §13 fase 2) | Estado | Evidência |
| --- | --- | --- |
| Criticidade | IMPL | `criticality_levels` |
| Ciclo de vida | IMPL (ativo) | datas, status, descomissionamento |
| Risco | PARC | `risk_class`, `operational_risk` (texto livre em `assets`); sem regra |
| **Aceite / aceitação de equipamento novo** | AUS | nenhum fluxo/tipo de documento "aceite de instalação"; natureza `installation` existe em OS |
| **Qualificação** | PARC | `thermal_qualification` provisionado (payload vazio); sem QI/QO/QP |
| Calibração | PARC | tipo `calibration_certificate` provisionado; fronteira de validade em domínio |
| TSE | PARC | tipo `electrical_safety_test` provisionado; limites normativos **BLOQUEADOS** (fronteira #4) |
| Rastreabilidade | PARC | `cadeiaDeRastreabilidadeCompleta()` em memória; sem tabela de padrões/certificados |
| Padrões, instrumentos, protocolos, medições | AUS (tabelas) | ver §16–§19 |

Nada aqui pode receber regra científica sem o metrologista (fronteira §3 do
`AURORA-METROLOGIA-FRONTEIRA.md`). O que **pode** ser feito agora é **cadastro** e **estrutura**.

## 15. Metrologia

O que existe em código, com prova:

| Função (`packages/domain/src/metrologia.ts`) | O que faz | Teste |
| --- | --- | --- |
| `padraoValidoEm(padrao, dataDaMedicao)` | validade avaliada na data civil da medição, comparação textual `YYYY-MM-DD`, dia do vencimento vale | `metrologia.test.ts` |
| `padroesQueImpedemEmissao(...)` | lista **todos** os padrões vencidos, nomeando certificado e laboratório | idem |
| `cadeiaDeRastreabilidadeCompleta(...)` | confere preenchimento (número + laboratório) | idem |
| `DECISOES_METROLOGICAS_BLOQUEADAS` | lista em código; teste falha se surgir função de cálculo | idem |

O que **não** existe: nenhuma tabela. `PadraoDeMedicao` é uma interface, não um registro. O
critério de aceite "Bloqueio de emissão por padrão vencido" do EPIC-019 não está ligado ao motor de
documentos porque não há de onde ler os padrões usados numa emissão.

**Cinco decisões continuam BLOQUEADAS (VAL-E):** incerteza expandida, correção de erro sistemático,
critério de aceitação/veredito por ponto, limites normativos de TSE, arredondamento. PLAT §6.2 passo 4
("critério de aceitação") e passo 5 ("destaca resultados fora do limite") dependem de #3 e #5 — a
arquitetura pode receber o critério como **dado do protocolo** (nominal ± tolerância) e o sistema só
compara; a **regra de comparação** (arredondar antes? incluir incerteza?) segue sendo do metrologista.

## 16. Instrumentos

Requisito (PLAT §5 "Instrumento", §8 "catálogo de instrumentos", CART §8): fabricante, modelo, número
de série, firmware/versão, interface, protocolo, certificado, validade, adaptador, última validação,
limitações conhecidas, status do modelo.

**Estado: AUSENTE.** Verificado por `grep -ri instrument` em `packages/*/src` e `apps/*/src`: as
únicas ocorrências são o `metrologia.ts` (interface em memória), `contracts.ts` (palavra "instrumento
comercial") e um rótulo de UI. Não há tabela, permissão (`instrument.*`), rota, contrato ou evento.

**O que já existe e NÃO deve ser duplicado:**

- `assets` já modela fabricante → modelo → exemplar com série, firmware possível em `specs jsonb`,
  status e ciclo de vida. A SPEC EPIC-019 previa "padrões = ativos com `modo = padrão`". Um
  instrumento de medição **é** um ativo da própria organização (prestadora/laboratório), com
  certificado próprio.
- `manufacturers`/`asset_models` já têm curadoria (`verified`, `merged_into_id`), o que serve ao
  "status do modelo" e à padronização de fabricantes (PLAT §12 passo 3).

**Recomendação (não implementar agora):** modelar Instrumento como **papel de ativo**
(`assets.role`/`is_measuring_instrument` ou tabela `instruments` 1:1 com `assets`) e não como segunda
hierarquia fabricante/modelo. Os campos específicos (interface, protocolo, adaptador, última
validação, limitações, firmware) ficam na extensão 1:1 — mesma forma da regra ADR-028: "forma
diferente, tabela diferente". **VAL-C:** se o cliente quer instrumento com identidade separada do
patrimônio (ex.: instrumento de terceiro usado numa OS), a extensão 1:1 continua servindo com
`ownership='service_only'`.

## 17. Certificados

Requisito (PLAT §5 "Certificado"): número, laboratório, data, validade, escopo, arquivo, padrão,
rastreabilidade.

| Elemento | Existe? | Onde |
| --- | --- | --- |
| Certificado que **o sistema emite** (para o cliente) | IMPL | `documents` com tipo `calibration_certificate` (série CAL, validade 365 d, exige RT e assinatura) |
| Certificado que **o instrumento/padrão recebe** de laboratório externo | AUS como registro; PARC como conceito | `standard_certificate` (série PAD) é um `document_type` provisionado — mas é o documento **emitido por nós**; o certificado do laboratório externo (número, laboratório, validade, arquivo PDF) não tem tabela. `PadraoDeMedicao` em memória tem exatamente esses campos |
| Arquivo do certificado | PARC | `attachments` só admite dono OS ou resposta de item (`att_has_owner`) |
| Rastreabilidade (padrão → padrão → laboratório acreditado) | AUS | sem tabela de cadeia |

**Não duplicar:** o certificado externo de um instrumento pode ser um `document` de tipo próprio
(`instrument_certificate`, externo, sem numeração nossa) **ou** uma tabela leve `instrument_certificates`
(número externo, laboratório, emissão, validade, escopo jsonb, `attachment_id`, `traceable_to_id`).
A segunda opção é mais honesta: um documento emitido por terceiro não passa pelo grafo
`draft→issued` nem queima número da nossa série. **VAL-E:** escopo mínimo (faixas, incerteza
declarada) que o laboratório informa e que precisa ser guardado para a fronteira #1.

## 18. Procedimentos / protocolos

Requisito (PLAT §5 "Procedimento", CART §8): tipo de teste, versão, sequência, unidade, limites,
tolerâncias, padrão, responsável técnico, regras.

| Elemento | Existe? | Evidência |
| --- | --- | --- |
| Estrutura **versionada e imutável** | IMPL | `checklist_templates` (`key`+`version`, publicada = imutável por gatilho, um rascunho por chave) |
| Sequência de itens com unidade e limites | IMPL | `checklist_items.kind='number'`, `min_value/max_value/unit`, `fail_action` |
| Veredito automático fora da faixa, do servidor | IMPL | `computeVerdict` + teste que recusa `verdict` do cliente |
| Tipo de teste (calibração/TSE/qualificação) | PARC | não há campo; hoje o vínculo é pela natureza da OS |
| **Valor nominal / ponto de medição / tolerância relativa (±%)** | AUS | só `[min, max]` absolutos — para calibração por pontos falta `nominal`, `tolerance_abs/rel`, `readings_required` (edge case "ponto com leituras insuficientes" do EPIC-019) |
| Padrão/instrumento exigido pelo protocolo | AUS | SPEC previa `procedures.required_standards[]`; `procedures` não existe como tabela |
| Responsável técnico do protocolo | AUS | sem `technical_manager_id` no template |
| Permissões | IMPL | `procedure.read/create/update/publish` já existem em `permissions.ts` e no papel `metrologist` |
| Evento | IMPL | `procedure.published` no catálogo de eventos |
| Resolução automática de procedimento por natureza × categoria × ativo | AUS | SPEC §14 "resolução automática"; `plan_tasks.checklist_template_key` cobre só preventivas |
| Desce ao field | IMPL | `GET /field/sync` traz templates publicados com faixas e unidades |

**Não duplicar:** o protocolo metrológico deve ser **uma extensão do checklist versionado**, não um
segundo motor. Caminho: novo `checklist_item_kind = 'measurement'` (a SPEC §14 já o previa, Fase 2)
com campos de ponto (nominal, tolerância, unidade, leituras, padrão exigido) e um cabeçalho de
"tipo de teste" e "responsável técnico" no template. Isso mantém imutabilidade, versionamento,
condicionais, fotos e o pacote offline sem reescrever nada.

## 19. Sessões de medição

Requisito (PLAT §5 "Sessão de medição", CART §8 "Medição"): OS, ativo, instrumento, técnico, data,
horário, arquivo bruto, valores, unidades, resultado, certificado, protocolo usado.

| Campo | Existe hoje? | Onde |
| --- | --- | --- |
| OS | IMPL | `checklist_responses.work_order_id` |
| Ativo | indireto | via `work_orders.asset_id` (+ snapshot) |
| Protocolo usado (versão congelada) | IMPL | `checklist_responses.template_id/template_key/template_version` |
| Técnico, data, hora | IMPL | `checklist_answers.measured_by/measured_at` |
| Valores e unidades | PARC | `value_number` + `unit` do **item** (não da resposta); sem unidade convertida/registrada na resposta |
| Resultado | IMPL | `verdict` por item; `evaluateChecklist` agrega |
| **Instrumento usado** | AUS | — |
| **Certificado do instrumento na data** | AUS | — |
| **Arquivo bruto** | AUS | `attachments.purpose` não tem `raw_data`; dono não pode ser sessão |
| **Origem** (manual/arquivo/gateway/instrumento/API/SDK) | AUS | `meter_readings.source` tem a ideia, para medidores apenas |
| Início/fim da sessão | IMPL | `started_at/finished_at` |
| Condições ambientais | AUS | EPIC-019 previa |

**Conclusão:** `checklist_responses` **é** uma sessão de medição em 60 % dos campos. O que falta é
proveniência (instrumento, certificado, origem, dado bruto) e ambiente. **Não criar
`measurement_sessions` do zero**: estender `checklist_responses` (ou tabela 1:1 `measurement_sessions`
apontando para a resposta) preserva o pacote offline, a idempotência já provada em
`POST /work-orders/:id/checklists` e as telas do field.

## 20. Dados brutos

Requisito (PLAT §6.2 passo 5, CART §5 passo 7): preservar o dado original de qualquer origem.

| Capacidade | Estado | Evidência |
| --- | --- | --- |
| Bytes fora do banco, por porta | IMPL | `ArmazenamentoDeObjetos` (disco/memória), chave por organização |
| Envio retomável, posicional, com SHA-256 conferido no fim | IMPL | `PUT /field/attachments/:id/bytes`, 0044, 8 provas HTTP + 10 do adaptador |
| Integridade | IMPL | `attachments.sha256` |
| Tipos aceitos | **restrição** | `ALLOWED_CONTENT_TYPES`: imagens e PDF apenas — CSV/XML/JSON/binário de instrumento seriam **recusados** hoje |
| Dono | **restrição** | `att_has_owner CHECK (work_order_id OR checklist_answer_id)` — um dado bruto de sessão inteira só caberia pendurado na OS |
| Finalidade | **restrição** | `attachment_purpose` sem `raw_data`/`instrument_export` |
| Imutabilidade do anexo | PARC | sem gatilho de auditoria nem guarda de `UPDATE` em `attachments` |

**Adaptação AGORA (aditiva):** novo `purpose='raw_data'`, lista de content-types própria dessa
finalidade (`text/csv`, `application/xml`, `application/json`, `application/octet-stream` com teto),
e dono adicional (`measurement_session_id`) no CHECK. Nenhuma dessas altera o envio retomável.

## 21. Relatórios

Fluxo alvo (PLAT §6.2): ativo → OS → instrumento → certificado → protocolo → medição → valores →
critérios → relatório → revisão → aprovação → assinatura.

| Elo | Estado |
| --- | --- |
| ativo → OS | IMPL |
| OS → instrumento/certificado | AUS |
| OS → protocolo → medição → valores | PARC (checklist) |
| valores → critérios | PARC (faixa absoluta) · **VAL-E** para critério metrológico |
| → relatório (preencher modelo) | AUS — `payload_fields` vazio; sem motor de modelo; sem PDF |
| revisão → aprovação → assinatura → histórico | IMPL (motor de documentos) |
| vínculo permanente ao ativo | IMPL |

**Fundações que precisam existir AGORA** para o critério 6 ("o sistema conseguirá gerar relatório a
partir de sessão de medição futura"): (1) sessão com proveniência; (2) protocolo com pontos e
tolerâncias como dado; (3) `document_types.payload_fields` preenchido para CAL/TSE/QT **a partir do
protocolo**, não inventado; (4) função pura `preencherModeloAPartirDaSessao()` que só copia — sem
cálculo — e marca "fora do limite" conforme a comparação já definida no item; (5) `documents.
measurement_session_id`. A geração automática em si e o PDF ficam para DEPOIS.

## 22. Offline

Requisito (PLAT §14 critério 1; CART §3 "Offline"): captura local, fila, confirmação, recuperação de
falhas, sem perda nem duplicidade.

| Item auditado | Estado | Evidência |
| --- | --- | --- |
| Fechamento/reabertura do app sem perder | IMPL | teste dos vinte passos com `page.close()` (sessão 30/08) |
| Persistência por porta com suíte de conformidade (8 regras, memória/SQLite/IndexedDB) | IMPL | ADR-030, `armazenamento/conformidade.ts` |
| Fotos: metadado + estado + bytes em três lugares, envio por fatia de 256 kB | IMPL | `arquivos/envio.ts`, 0044 |
| Assinatura offline com resolução tardia de id | IMPL | `resolverReferencias` na fila |
| Retry sem descarte silencioso; descarte só explícito | IMPL | `fila.ts` |
| Idempotência (`x-aurora-client-operation`, digest, membership) | IMPL | `client_operations` (0043), 20 tentativas simultâneas → 1 execução (PostgreSQL real) |
| Conflito preservado com o corpo original | IMPL | `GET /field/attention`, `superseded_by` |
| Rotas sob garantia | IMPL | 9: criar OS, transicionar, abrir chamado, anexar checklist, **responder item**, apontar hora, anexar arquivo, assinar, consumir peça |
| **Medição futura** | preparado | a fila é genérica (`agregado/metodo/caminho/corpo`); uma rota nova entra por `runFieldOperation` sem mudar protocolo |
| Sincronização incremental com relógio do servidor | IMPL | `synced_at` → `since` |
| Retenção de `client_operations` | VAL-C | tabela sem `DELETE` por decisão |

**Adicionar medições estruturadas exige mudança no protocolo offline?** **Não.** Exige: (a) o pacote
do dia descer também instrumentos e certificados vigentes da pessoa (uma coleção a mais em
`GET /field/sync`, com `strict()` e teste de não-vazio como as demais); (b) a resposta de item
carregar `instrument_id`/`source` no corpo; (c) o dado bruto usar o mesmo envio retomável com
`purpose='raw_data'`. A regra "o veredito é do servidor" permanece.

## 23. Adaptadores / integrações

| Ponto de extensão (PLAT §3 "Integração", §10) | Existe? | Evidência |
| --- | --- | --- |
| Outbox transacional + publicador com `EventSink` | IMPL | `domain_events`, `apps/workers/src/outbox-publisher.ts` (at-least-once, SKIP LOCKED) |
| Catálogo de eventos (117 tipos) | IMPL | `packages/events/src/catalog.ts` |
| Fila durável | IMPL | pg-boss (6 jobs) |
| Porta de armazenamento | IMPL | `ArmazenamentoDeObjetos` |
| Porta de autenticação | IMPL | `AuthProvider` (só `LocalAuthProvider` implementado) |
| Porta de notificação (transporte) | PARC | fila de saída `notification_deliveries` + `outbox/:id/sent|failed`; nenhum adaptador SMTP/WhatsApp |
| Webhooks por organização com HMAC | AUS | SPEC §30 prevê `webhook_endpoints`; não há tabela |
| API key / membership de máquina | AUS | SPEC §30 MVP; não há tabela nem evento emitido (o catálogo declara `api_key.created`) |
| `external_id` por sistema de origem | AUS | OQ-09 |
| **Porta de fonte de medição** (arquivo/gateway/SDK) | AUS | é a peça que falta para "adicionar N1–N4 por adaptador" |
| Exportação CSV/XLSX | AUS | `export_jobs` da SPEC não existe |
| Omie, WhatsApp, calendário, BI, sistemas hospitalares | AUS | **FUT** |

**Veredito do critério 7 ("integração por adaptador sem alterar o núcleo"):** a arquitetura já
pratica portas (auth, arquivos, eventos, persistência offline, dispositivo). Falta **uma** porta:
`FonteDeMedicao` (ou nome equivalente) cujo contrato é o envelope neutro do §31 desta auditoria.
Com ela, N1 é um adaptador que lê arquivo; N2/N3 são adaptadores que recebem do gateway/SDK; N0 é o
adaptador "manual" — os quatro escrevem na mesma tabela.

## 24. Be Care Link

Não desenvolver. Avaliar apenas se o software está pronto para receber (CART §4):

| O gateway precisa entregar | O servidor já sabe receber? |
| --- | --- |
| Identificação do ativo e da OS por QR | **Sim** — `qr_token`, `/q/:token`, ativo/OS no pacote local |
| Identificação do instrumento e do certificado vigente | **Não** — entidades ausentes (§16–§17) |
| Medição com valor/unidade/hora | **Parcial** — só via item de checklist |
| Dado bruto | **Parcial** — envio retomável existe; finalidade/dono/tipo não |
| Operação offline com armazenamento local | **Sim** (no app); um gateway usaria o mesmo contrato |
| Idempotência e confirmação de sincronização | **Sim** — `client_operation_id`, digest, desfecho persistido, 409 para desencontro |
| Evitar duplicidade | **Sim** — provado sob concorrência |

**Conclusão:** `client_operation_id` + fila + idempotência + envio retomável **já são** a metade
"transporte" do Be Care Link. A metade "semântica" (instrumento, certificado, envelope de medição)
é a mesma que o N0 precisa — construí-la para o manual entrega a preparação para o gateway de graça.

## 25. IA

Não implementar. Cinco modos (PLAT §9) × cinco condições:

| Condição | Estado | Observação |
| --- | --- | --- |
| Modelo de dados permite | PARC | histórico de OS, falhas (natureza × sintoma × causa × ação, ADR-020), indicadores com definição — bom insumo; medições ainda não são consultáveis como série |
| Provenance (fonte, versão) | PARC | documentos e checklists têm versão; falta `source`/`generated_by` genérico para conteúdo sugerido |
| Aprovação humana | IMPL | grafos de OS, orçamento e documento exigem ato humano com permissão; IA não teria como "assinar" |
| Dados isolados por cliente | IMPL | RLS + `withTenant`; qualquer consumo de IA precisa passar pela mesma sessão de tenant |
| Auditabilidade | IMPL | `audit_logs` + `domain_events` com `actor_kind` (já distingue `system`) |

**Reserva sugerida (DEPOIS):** `actor_kind='assistant'` e um campo `provenance jsonb` (fonte, modelo,
versão, aprovado_por) nas entidades que aceitem rascunho assistido. Marcar **FUTURO**.

## 26. Omie

Não implementar. O que a integração precisará e o que existe:

| Necessidade (PLAT §10) | Existe |
| --- | --- |
| Clientes, contratos, propostas, itens com identidade externa | entidades sim; `external_id` **não** |
| Eventos para sincronizar (quote.approved, contract.activated, quote.invoiced) | **sim**, no outbox |
| Conector com credencial por organização | **não** (nenhuma tabela de conectores/segredos por org) |
| Reconciliação e log de tentativas | **não** (`webhook_deliveries` da SPEC não existe) |

**FUTURO — reservar:** `external_id` + `external_source` nas quatro entidades (OQ-09), e uma tabela
genérica de conectores por organização quando o primeiro conector real for contratado.

## 27. Oportunidades

Requisito (PLAT §4/§5): necessidade, ativo, prazo, origem, fornecedor, prioridade, autorização
comercial → evolução: catálogo, cotações, mercado.

**Estado: AUSENTE.** Não há entidade, permissão, rota ou evento. O mais próximo:

- `service_requests` (necessidade relatada, com triagem) — mas o ciclo é de atendimento, não comercial;
- `quotes` (proposta com versões e aprovação) — é o **desfecho** de uma oportunidade, não a
  oportunidade;
- `obsolescence_report` — a **origem** técnica de muitas oportunidades;
- `suppliers` — o fornecedor.

**Classificação:** o **núcleo** (registro da oportunidade com origem, ativo, prazo, prioridade,
fornecedor e autorização comercial — que é um ato com permissão própria e trilha) é **DEPOIS —
segunda fase funcional**: não bloqueia N0 nem a homologação, e é pequeno (uma tabela, um grafo curto,
uma permissão `opportunity.authorize`). Catálogo, cotações e mercado: **FUTURO — não implementar**.
Segregação (PLAT §2: "oportunidades comerciais não podem vazar entre organizações") já é dada pela
RLS; o portal precisará de varredura PORTAL-011 estendida a essas chaves.

## 28. Migração Arkmeds

Processo do cliente (PLAT §12) × o que existe:

| Passo | Existe? | Evidência |
| --- | --- | --- |
| 1. Preservar exportação original / arquivo histórico | **Não** | `importAssets` recebe linhas já convertidas; não guarda o arquivo nem o lote |
| 2. Mapear ativos, locais, fabricantes, preventivas, OS, documentos, contratos, usuários | **Só ativos** | `importAssets` (categoria, fabricante, modelo, local por código); `asset.import` como permissão separada; sem importador de locais/OS/planos/documentos/contratos/usuários |
| 3. Deduplicar e padronizar famílias/fabricantes/modelos | **Parcial, bom** | `manufacturers`/`asset_models` com `normalized_name`, `verified`, `merge`, fila de curadoria (`/assets/curation/queue`); unicidade por `asset_identifiers` bloqueia duplicata na importação |
| 4. Importar amostra, validar, corrigir por lote | **Parcial** | relatório de erro por linha via `SAVEPOINT`; sem noção de "lote" persistida |
| 5. Base oficial com relatório de inconsistências | **Não persistido** | `ImportResult` volta na resposta HTTP e desaparece |
| 6. Operar em paralelo; sistema antigo como consulta | **Sim, por ausência** | nada impede; mas sem `external_id` não há como cruzar um registro com o de origem |
| Assistente de estados legados (42 → 9 situações + 14 motivos) | **Mapeamento existe** na auditoria de 28/08; sem ferramenta | `docs/01-AUDITORIA-TECHNECARE.md` §07 |

**Decisão recomendada: transformar em IMPORT PIPELINE RASTREÁVEL** — `import_batches` (arquivo
original como anexo com SHA-256, origem, quem, quando, status amostra/oficial), `import_rows` (linha
crua, entidade destino, id criado, `external_id`, erro) e `external_id/external_source` nas entidades
de destino. É **DEPOIS** (não bloqueia N0) mas **antes** de qualquer migração real. O que falta
para o critério 8 ("validação, rastreabilidade e arquivo histórico") é exatamente isso.
**VAL-C:** formato real da exportação do Arkmeds (CSV? XLSX? API?) — sem ele não se escreve o parser.

## 29. Segurança / LGPD / governança

| Requisito (PLAT §11; CART §8) | Estado | Evidência |
| --- | --- | --- |
| Autenticação individual | IMPL (porta) | `AuthProvider`; `aurora.users` global por e-mail; modo local recusado fora de dev |
| MFA | **AUS** | nenhuma implementação; depende do provedor escolhido (Supabase Auth suporta TOTP) — **VAL-C** |
| SSO futuro | reservado | trocar provedor = implementar a interface |
| Permissões por organização, unidade (local), contrato, ativo, tipo de dado | PARC | organização (RLS), local e cliente (`membership_scopes`), tipo de dado (`*.read_financials`, `*.read_internal_notes`); **por contrato e por ativo: não** |
| Isolamento + testes contra vazamento | IMPL | 24 arquivos de teste com caso adversarial; PORTAL-011 com controle positivo; RLS sob papel real no CI |
| Criptografia | VAL-C / infra | TLS e criptografia em repouso são do provedor; nada no código depende disso; sem criptografia de campo |
| Gestão de dispositivos | AUS | sem registro de dispositivos do field |
| Backups e restauração testada | VAL-C / infra | não há rotina nem doc de restauração (AURORA-AMBIENTES trata de segredos e hospedagem) |
| Auditoria imutável para OS, documentos, aprovações, permissões | IMPL | `audit_logs` append-only (só o gatilho insere; `aurora_app` só lê); triggers em `work_orders`, `documents`, `signatures`, `membership_scopes`, `quotes`… |
| **Auditoria imutável para medições** | **AUS** | `checklist_answers` não tem `_audit`; `answerChecklistItem` faz `ON CONFLICT DO UPDATE` — a medição anterior é **sobrescrita sem rastro** |
| Dados de paciente fora do MVP | IMPL por ausência | nenhum campo de paciente no modelo |
| Segredos | IMPL | `check-secrets.mjs` no CI; `.env.example` sem valores |
| Guard de destino de banco | IMPL | `aurora.destinos.json` + `packages/config/src/destino.ts` (30/08) |

## 30. Critérios de aceite (PLAT §14)

| # | Critério | Veredito | Evidência |
| --- | --- | --- | --- |
| 1 | OS funciona offline e sincroniza sem perda ou duplicidade | **PASSA** | `client_operations` (0043), 20 tentativas concorrentes → 1 execução em PostgreSQL real; teste dos vinte passos com fechamento real do app; fila sem descarte silencioso |
| 2 | Hospital enxerga somente dados autorizados | **PASSA** | RLS `FORCE` em todas as tabelas de negócio; `membership_scopes`; PORTAL-011 varre toda resposta do portal contra chaves internas, com controle positivo que exige acusar na rota interna |
| 3 | Ativo mantém histórico completo de serviços, documentos, medições e ciclo de vida | **PASSA PARCIALMENTE** | serviços (`/work-orders?assetId`), documentos (`/documents/by-asset`), transferências e datas de ciclo de vida existem; **medições** não são entidade consultável por ativo; não há linha do tempo unificada |
| 4 | Medição manual e integrada usam o mesmo modelo | **NÃO PASSA** | só existe a medição manual (`checklist_answers`), sem `source`, sem instrumento, sem dado bruto; a integrada não tem por onde entrar |
| 5 | Instrumento, certificado, protocolo e operador vinculados ao resultado | **PASSA PARCIALMENTE** | protocolo (versão congelada) e operador (`measured_by`) sim; instrumento e certificado **não** |
| 6 | Sistema poderá gerar relatório a partir de sessão de medição | **AINDA NÃO APLICÁVEL** (fundação parcial) | motor de documentos com revisão/assinatura/versão pronto; `payload_fields` vazio; sem sessão com proveniência; sem PDF |
| 7 | Integração com instrumento por adaptador sem alterar o núcleo | **PASSA PARCIALMENTE** | padrão de portas já praticado (5 portas); falta a porta de fonte de medição e o envelope neutro |
| 8 | Migração Arkmeds com validação, rastreabilidade e arquivo histórico | **NÃO PASSA** | só `importAssets` com relatório efêmero; sem lote, sem arquivo original, sem `external_id` |
| 9 | APIs externas não acessam diretamente o banco | **PASSA** | única porta é a API NestJS; `aurora_app` NOBYPASSRLS, não-dono; frontends sem cliente de banco; lint barra `db.query` fora da infra de dados |

## 31. Gaps reais

Ordenados por impacto na visão do cliente:

1. **Núcleo de instrumentação inexistente como dado** — Instrumento, certificado de instrumento,
   padrão e cadeia de rastreabilidade só existem em memória (`metrologia.ts`).
2. **Medição sem proveniência e sem histórico** — `checklist_answers` guarda valor + veredito, mas não
   origem, instrumento, certificado, unidade da resposta, nem preserva o valor anterior (upsert sem
   auditoria).
3. **Protocolo metrológico** — o checklist versionado é o esqueleto certo, mas não tem ponto de
   medição (nominal, tolerância, leituras), tipo de teste, padrão exigido nem responsável técnico.
4. **Relatório a partir de medição** — tipos CAL/TSE/QT com `payload_fields: []`, sem motor de
   modelo, sem PDF.
5. **Migração Arkmeds** como pipeline rastreável, e `external_id` nas entidades.
6. **Oportunidade** — entidade ausente.
7. **MFA** e permissões por contrato/ativo — ausentes.
8. **Dado bruto** — `attachments` recusa tipos não-imagem/PDF e só aceita dono OS/resposta.
9. **Recursos habilitados por organização (modos de uso)** — só `plan`/`settings` livres.
10. **Webhooks/API key** — previstos na SPEC §30, ausentes; pré-requisito de qualquer conector.

## 32. Itens já implementados

Identidade e RBAC (11 papéis, 107 permissões, `deny` individual, escopo por cliente/local/almoxarifado)
· Diretório (árvore de locais por gatilho, tipos, equipes, calendários, ausências) · Catálogos governados
e campos personalizados tipados · Ativos (unicidade configurável, transferência como operação,
importação por linha, QR público, curadoria de fabricante/modelo, medidores) · Solicitações (ADR-002)
· OS (estados × motivos, snapshot, grafo em tabela, 1→N a partir de chamado) · SLA (tempo útil por fuso
e feriado, pausa por motivo, cascata contrato→ativo→cliente→org) · Execução (checklists versionados,
veredito do servidor, cronômetro, assinatura com hash, bloco de conclusão 412) · Agenda (conferência
prévia, ausência arrasta OS) · Preventivas (frequência por tarefa, alvo como expressão, tolerância,
dispensa justificada) · Estoque (razão imutável, saldo por gatilho, reserva, viatura) · Orçamentos
(versões, centavos, cascata de preço, aprovação com evidência) · Contratos (cobertura por expressão,
medição congelada, glosa nula sem fórmula) · Documentos (motor único, número queimado, hash canônico,
assinatura, revisão, versão, vencimento) · Indicadores (14 métricas com definição, `fact_work_order`)
· Notificações (dedupe, silêncio no fuso, fila de saída) · Automações (regras com salvaguardas) ·
Busca global · Auditoria (append-only, timeline de duas camadas) · Portal (10 rotas, tradução de
situação, varredura de vazamento) · Field (PWA + Capacitor, fila offline, idempotência, fotos
retomáveis, assinatura, QR local, diagnóstico do aparelho) · Workers (pg-boss, outbox) · Contratos
Zod → OpenAPI → cliente tipado · CI em três tarefas com PostgreSQL real · Guard de destino de banco ·
Fronteira metrológica (validade na data da medição, cadeia, lista de bloqueios com teste).

## 33. Itens parcialmente implementados

| Item | O que existe | O que falta |
| --- | --- | --- |
| Medição estruturada (N0) | valor numérico, faixa, unidade do item, veredito do servidor, técnico, data, versão do protocolo | instrumento, certificado, origem, dado bruto, unidade da resposta, histórico imutável, condições ambientais |
| Documentos de engenharia clínica | 6 tipos provisionados; ciclo completo | payload por tipo, modelo, PDF, vínculo com sessão |
| Metrologia | fronteira de calendário e cadeia, em domínio | tabelas; ligação com a emissão |
| Ciclo de vida do ativo | datas, status, descomissionamento, obsolescência (tipo) | substituição, indicador de obsolescência |
| Preventivas por família | categoria/local/ativo | modelo, fabricante, criticidade |
| Portal | chamados, agenda, documentos, orçamentos (leitura) | aprovação no portal, NPS, relatórios, co-branding, notificações entregues |
| Estoque | lote/série modelados | exigência na baixa, reposição |
| Integrações | outbox, portas, jobs | webhooks, API key, `external_id`, conectores, exportação |
| Segurança | auth por porta, RLS, auditoria, segredos, guard de destino | MFA, permissões por contrato/ativo, auditoria de medições e anexos, backup documentado |
| Importação | ativos, com curadoria | pipeline com lote, arquivo original, demais entidades |
| Configuração por módulo | `plan`, `settings jsonb` | recursos habilitados, modo de uso |

## 34. Itens novos

Instrumento (extensão de ativo) · Certificado de instrumento/padrão (externo) · Cadeia de
rastreabilidade · Ponto de medição no protocolo (`measurement` kind) · Sessão de medição com
proveniência · Envelope neutro de medição + porta de fonte · Dado bruto (finalidade e tipos) ·
Modelo de relatório com campos por tipo e preenchimento por cópia · Oportunidade · Pipeline de
importação rastreável · `external_id`/`external_source` · Modo de uso e recursos habilitados por
organização · MFA (via provedor) · Auditoria em `checklist_answers` e `attachments`.

## 35. Itens futuros

N1 (importação de arquivos de instrumento) · N2 Be Care Link · N3 SDK/API/protocolo · N4 instrumentos
próprios · BLE/USB/serial/Wi-Fi · NFC · IoT/Be Care Sense · Omie · WhatsApp/e-mail/calendário
(transportes) · BI/exportações · Sistemas hospitalares · IA (5 modos) · Geração automática de relatório
· Catálogo/cotações/mercado · Co-branding · SSO · Microserviços (o cliente não pede).

## 36. Decisões a validar

**Com o cliente (VAL-C):**

1. Nome comercial e domínio (mantém `marca.config.json`; sem refatoração agora).
2. Quais famílias de teste entram primeiro no N0: calibração, TSE, qualificação térmica, aceite?
3. Instrumento como papel de ativo (recomendado) ou entidade independente do patrimônio?
4. Certificado externo como tabela leve (recomendado) ou como `document_type` externo?
5. Formato e escopo da exportação do Arkmeds; se OS históricas migram com estados mapeados.
6. Provedor de autenticação e MFA (Supabase Auth TOTP?); hospedagem (bloqueio conhecido desde 30/08).
7. Política de fechamento do ciclo preventivo (lacuna conhecida).
8. O que caracteriza "parada" para disponibilidade.
9. Oportunidade: quem autoriza comercialmente e se o portal a exibe.
10. Retenção de `client_operations` e de dados brutos.

**Com especialista técnico/metrológico (VAL-E):**

1. Os cinco bloqueios da fronteira (incerteza, correção, critério/veredito, limites TSE,
   arredondamento) — com procedimento escrito e casos de referência no limite.
2. Campos mínimos do certificado externo (faixas, incerteza declarada, resolução) que precisam ser
   guardados para a cadeia.
3. Estrutura de "ponto de medição" (nominal, tolerância absoluta/relativa, leituras exigidas, unidade,
   condições ambientais) por tipo de teste.
4. Se a comparação "fora da faixa" do checklist atual pode ser usada como pré-veredito no N0, ou se
   qualquer veredito metrológico deve ficar suspenso até a regra validada.
5. Indicador de risco (criticidade × histórico) — fórmula.

## 37. Riscos de regressão

| Área | Adaptação que a toca | Risco | Mitigação já existente |
| --- | --- | --- | --- |
| Offline / fila | nova coleção no `GET /field/sync`; novo corpo na resposta de item | **BAIXO** | contrato `strict()` + teste de não-vazio por coleção; fila genérica; `runFieldOperation` por adesão |
| RLS / isolamento | tabelas novas | **BAIXO** se seguirem o padrão (`FORCE`, FK composta, teste adversarial) | 24 suítes com caso de outra organização; lint contra `db.query` direto |
| OS | `measurement_session_id` opcional; bloco de conclusão podendo exigir sessão fechada | **BAIXO-MÉDIO** | `completion_requirements` já é configurável por natureza |
| Portal | novas chaves internas (custo do instrumento, oportunidade) | **MÉDIO** | PORTAL-011 precisa ganhar as chaves novas — senão passa em silêncio |
| Documentos | `payload_fields` deixa de ser vazio; `measurement_session_id` | **BAIXO** | hash canônico e imutabilidade após assinatura independem do conteúdo |
| Upload / attachments | alterar `att_has_owner` e `attachment_purpose` (enum) | **MÉDIO** | 18 provas do envio retomável; enum novo é `ADD VALUE`; CHECK é `DROP`+`ADD` na mesma migration |
| Assinaturas | nenhuma | — | — |
| Migrations | ~6 novas (0045+) | **BAIXO** | migrator com checksum e trava; suíte aplica do zero |
| OpenAPI / contracts | rotas novas sem contrato caem na porcentagem | **BAIXO** | `openapi:check` acusa rota sem contrato e permissão divergente |
| Performance | tabelas de medição crescem por ponto × leitura | **MÉDIO a longo prazo** | índices por (asset, measured_at); `bench` existe para OS, não para medições |
| CI | tempo da suíte | **BAIXO** | três tarefas separadas |

Nenhuma adaptação proposta exige refatoração grande; a única mudança "em lugar existente" que
merece cuidado é a de `attachments` (CHECK + enum), e ela é local a uma migration.

## 38. Plano recomendado

### P0 — fundações que precisam mudar antes de continuar

| Item | Motivo | Impacto | Arquivos | Migrations | API | UI | Testes | Regressão | Decisão externa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P0.1 Medição imutável e auditada** — `checklist_answers` deixa de sobrescrever (nova linha por leitura, `superseded_by`) ou ganha histórico + gatilho `_audit` | PLAT §11 "auditoria imutável para medições"; hoje corrigir um valor apaga o anterior | ALTO (evidência regulatória) | `0024`, `packages/db/src/execution.ts`, `answerChecklistItem` | 1 | sem rota nova; resposta passa a devolver `answer_id` | field/web mostram "corrigido em" | novo caso: reenviar valor preserva o anterior; teste adversarial | BAIXO (upsert vira insert; `ca_response_item_uq` vira parcial) | nenhuma |
| **P0.2 Dado bruto** — `purpose='raw_data'`, tipos permitidos, dono `measurement_session_id` | PLAT §6.2 passo 5 | MÉDIO | `attachments.ts` (domínio), `0025` | 1 | `POST /work-orders/:id/attachments` aceita a finalidade | — | provas de tipo/limite | MÉDIO (CHECK/enum) | nenhuma |
| **P0.3 `external_id` + `external_source`** em customers, assets, work_orders, inventory_items, locations, users/memberships | OQ-09 e PLAT §12; barato agora, caro depois | MÉDIO | migrations, `importAssets` | 1 | campos opcionais nos contratos | — | unicidade (org, source, external_id) | BAIXO | nenhuma |
| **P0.4 Modo de uso e recursos habilitados** — `organizations.mode` (provider/hospital/manufacturer/consultancy/lab) + `enabled_features` | PLAT §2/§4; evita cinco sistemas | MÉDIO | `0001`, `organizations.controller`, menus | 1 | `GET /organizations/current` | menu por recurso | RBAC não muda; teste de menu | BAIXO | VAL-C (quais recursos por modo) |

### P1 — gaps necessários para o produto atual

| Item | Motivo | Impacto | Arquivos | Migrations | API | UI | Testes | Regressão | Decisão externa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1.1 Aprovação de orçamento pelo portal | PLAT §4 Portal "aprovações" | MÉDIO | `portal.controller`, `quotes` | 0 | `POST /portal/quotes/:id/approve` | portal | evidência de aceite; PORTAL-011 | BAIXO | nenhuma |
| P1.2 NPS/avaliação no portal | PLAT §4 evolução | BAIXO | `service_requests.rating` | 0 | `POST /portal/requests/:id/rating` | portal | — | BAIXO | nenhuma |
| P1.3 Linha do tempo unificada do ativo | critério 3 | MÉDIO | `assets.controller` | 0 | `GET /assets/:id/timeline` | ficha | — | BAIXO | nenhuma |
| P1.4 Preventivas por modelo/fabricante/criticidade | PLAT §4 "planos por família, risco e fabricante" | MÉDIO | `0029`, `maintenance-plans.ts` | 1 (`plan_target_kind` + colunas) | idem | tela de plano | alvo resolve ativo novo | BAIXO | nenhuma |
| P1.5 Substituição de ativo | PLAT §4 "substituição" | BAIXO | `assets` | 1 (`replaced_by_asset_id`) | decommission aceita sucessor | ficha | — | BAIXO | VAL-C |
| P1.6 MFA via provedor + `SupabaseAuthProvider` | PLAT §11 | ALTO (homologação) | `auth-provider.port.ts` | 0 | — | telas de entrar | verify com JWKS | BAIXO | VAL-C (provedor) |
| P1.7 Oportunidade (núcleo) | PLAT §4/§5 | MÉDIO | novo módulo | 1 | `POST/GET /opportunities`, `/:id/transitions` | web | grafo + permissão `opportunity.authorize` + isolamento | BAIXO | VAL-C |
| P1.8 Pipeline de importação rastreável | PLAT §12; critério 8 | ALTO (migração) | `assets.ts` → `imports/` | 2 (`import_batches`, `import_rows`) | `POST /imports`, `/:id/rows`, `/:id/commit` | web | lote amostra × oficial; relatório persistido | BAIXO | VAL-C (formato Arkmeds) |

### P2 — engenharia clínica / metrologia (N0)

| Item | Motivo | Impacto | Arquivos | Migrations | API | UI | Testes | Regressão | Decisão externa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P2.1 Instrumento como extensão de ativo (`instruments` 1:1) com interface, protocolo, firmware, adaptador, última validação, limitações | PLAT §5, §8; CART §8 | ALTO | novo módulo `metrology` | 1 | `/instruments` CRUD | web (cadastro) | isolamento; instrumento fora da org não vincula | BAIXO | VAL-C (§36.3) |
| P2.2 Certificado de instrumento/padrão (externo) com arquivo, laboratório, validade, escopo, `traceable_to` | PLAT §5 | ALTO | idem | 1 | `/instruments/:id/certificates` | web | `padraoValidoEm` passa a ler do banco | BAIXO | VAL-E (§36.2) |
| P2.3 Protocolo: `checklist_item_kind='measurement'` + cabeçalho (tipo de teste, RT, padrões exigidos) + ponto (nominal, tolerância, leituras, unidade) | PLAT §5 "Procedimento"; SPEC §14 previa | ALTO | `0024`, `checklists.ts` (domínio), field-sync | 1 | mesmas rotas de template | web (editor), field | `computeVerdict` para `measurement` só compara com tolerância declarada — **sem cálculo** | BAIXO | VAL-E (§36.3–4) |
| P2.4 Sessão de medição: `checklist_responses` ganha `instrument_id`, `instrument_certificate_id`, `source`, `ambient jsonb`, `raw_attachment_id`; resposta ganha `instrument_id`, `unit`, `source`, `measured_at` do aparelho | PLAT §5 "Sessão"; critérios 4 e 5 | ALTO | `0024`, `execution.ts`, field | 1 | corpo de `POST .../answers` e `/checklists` | field (selecionar instrumento) | vínculo obrigatório quando o item é `measurement`; certificado válido na data (fronteira) | BAIXO (campos opcionais fora de `measurement`) | VAL-E |
| P2.5 Envelope neutro + porta `FonteDeMedicao` com o adaptador `manual` | PLAT §14 critério 4 e 7; CART §3 | ALTO | `packages/domain/src/medicao.ts` | 0 | — | — | o adaptador manual produz o mesmo envelope que a rota já grava | BAIXO | nenhuma |
| P2.6 `payload_fields` de CAL/TSE/QT derivados do protocolo + `documents.measurement_session_id` + `preencherModeloAPartirDaSessao()` (cópia, sem cálculo) | PLAT §6.2; critério 6 | ALTO | `documents.ts`, `0034` | 1 | `POST /documents/from-session/:id` (rascunho) | web | emissão recusa padrão vencido (liga a fronteira ao motor) | BAIXO | VAL-E |
| P2.7 Aceite de equipamento (tipo de documento + natureza `installation`) | PLAT §13 fase 2 "aceitação" | MÉDIO | `DOCUMENT_TYPES` | 0–1 | — | web | — | BAIXO | VAL-C |
| P2.8 PDF dos documentos | PLAT §6.2 passo 7 | MÉDIO | serviço de renderização | 0 | `GET /documents/:id/pdf` | — | hash do PDF ≠ hash do conteúdo, e isso é dito | BAIXO | nenhuma |

### P3 — preparação para integrações futuras

| Item | Motivo | Impacto | Migrations | Decisão externa |
| --- | --- | --- | --- | --- |
| P3.1 `webhook_endpoints` + `webhook_deliveries` + `EventSink` de webhook com HMAC | SPEC §30; PLAT §10 | MÉDIO | 1 | nenhuma |
| P3.2 API key como membership de máquina | SPEC §30; critério 9 continua valendo | MÉDIO | 1 | VAL-C |
| P3.3 Adaptador N1 (arquivo) da porta `FonteDeMedicao`, começando por CSV genérico | PLAT §6.1 N1 "primeira integração de baixo risco" | MÉDIO | 0 | VAL-C (qual export primeiro) |
| P3.4 Contrato de entrada do Be Care Link (mesma rota de sessão + `client_operation_id` + identificação de instrumento/certificado por token) | CART §4 | BAIXO agora | 0 | FUT |
| P3.5 Transporte de e-mail (adaptador da fila de saída) | PLAT §10 | MÉDIO | 0 | VAL-C (remetente) |
| P3.6 Exportação CSV/XLSX de indicadores | PLAT §10 "BI e exportação" | BAIXO | 1 (`export_jobs`) | nenhuma |

### P4 — evolução comercial / IA / instrumentação

Omie · WhatsApp · calendário · catálogo/cotações/mercado · co-branding · IA (com `provenance` e
`actor_kind='assistant'`) · N2/N3/N4 · NFC · IoT · SSO. **Nada disto entra sem decisão nova.**

## 39. Ordem de execução

1. **Aprovar este plano** e as respostas de §36 que ele exige (pelo menos §36.2, §36.3, §36.6).
2. **P0.1 → P0.2 → P0.3 → P0.4** (quatro migrations pequenas; cada uma com prova adversarial).
3. **P2.5 (envelope + porta, só domínio)** — sem banco, define o vocabulário antes das tabelas.
4. **P2.1 → P2.2** (instrumento, certificado) — ligam a fronteira metrológica ao banco.
5. **P2.3 → P2.4** (protocolo com ponto, sessão com proveniência) — fecha o N0 manual.
6. **P2.6** (relatório a partir da sessão, por cópia) → critério 6 passa a "PASSA PARCIALMENTE";
   **P2.8** PDF.
7. **P1.8** pipeline de importação → antes de qualquer migração real do Arkmeds.
8. **P1.6** MFA/Supabase Auth — junto com a decisão de hospedagem da homologação.
9. **P1.1–P1.5, P1.7** conforme prioridade do cliente.
10. **P3** quando o primeiro conector for contratado; **P4** nunca sem decisão.

## 40. Conclusão

O repositório já é a "plataforma modular com API centralizada, banco transacional, armazenamento de
evidências, fila de tarefas e aplicativo móvel offline" que o PLAT §3 descreve — e a prova não é o
texto, são os 1 632 testes de unidade/integração e 147 de navegador que rodam no CI com PostgreSQL
real e papel sem privilégio. Os critérios 1, 2 e 9 do §14 **passam hoje**.

O que os PDFs acrescentam é um **segundo núcleo** — instrumentação e medição — que o "Encaminhamento
ao desenvolvedor" pede explicitamente desde já, e que hoje existe apenas como fronteira em domínio e
como checklist numérico. Esse núcleo **cabe** na arquitetura sem tocar em fundação: é um módulo com
seis tabelas, uma porta, um tipo de item e campos aditivos em três tabelas existentes. A única
correção de fundação é pequena e obrigatória: **medição não pode ser sobrescrita sem rastro**.

Nada aqui foi implementado. A próxima ação é sua: aprovar, cortar ou reordenar o plano de §38.

---

### Apêndice A — Matriz final (REQUISITO · PDF/PÁGINA · DOMÍNIO · ESTADO · EVIDÊNCIA · GAP · AÇÃO · FASE · RISCO)

| # | Requisito | PDF/pág. | Domínio | Estado | Evidência | Gap | Ação | Fase | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Organizações, unidades, setores, locais, usuários, perfis | PLAT §4 p.4 | Identidade | IMPL | `0001/0006/0008`, `FACTORY_ROLES` | — | — | — | — |
| 2 | Planos, recursos habilitados, co-branding | PLAT §4 p.4 | Identidade | PARC | `organizations.plan/settings/logo_key` | sem feature flags nem co-branding | P0.4; co-branding P4 | AGORA / FUTURO | BAIXO |
| 3 | Cinco modos de uso na mesma plataforma | PLAT §2 p.2–3 | Identidade | PARC | ADR-004 `is_internal`; papéis | sem `mode` | P0.4 | AGORA | BAIXO |
| 4 | Segregação: custos, margens, documentos restritos, oportunidades não vazam | PLAT §2 p.3 | Segurança | IMPL | RLS FORCE; `*.read_financials`; PORTAL-011 | oportunidade ainda não existe | estender PORTAL-011 em P1.7 | AGORA | MÉDIO |
| 5 | Ativo: tag, patrimônio, série, fabricante, modelo, família, local, criticidade, garantia, status, ciclo de vida | PLAT §5 p.4 | Ativos | IMPL | `0013/0014` | substituição | P1.5 | DEPOIS | BAIXO |
| 6 | Obsolescência e substituição | PLAT §4 p.4 | Ativos | PARC | `obsolescence_report` provisionado | payload; relação sucessor | P1.5; P2.6 | DEPOIS | BAIXO |
| 7 | Histórico completo do ativo | PLAT §14 p.8 | Ativos | PARC | rotas separadas | sem timeline; sem medições | P1.3 + P2.4 | DEPOIS | BAIXO |
| 8 | Triagem, prioridade, SLA, execução, peças, evidências, assinatura | PLAT §4 p.4 | OS | IMPL | `0018–0028/0030` | — | — | — | — |
| 9 | Workflows por contrato e automações | PLAT §4 p.4 | OS | IMPL | `0031`, `0037` | — | — | — | — |
| 10 | Preventivas: planos, periodicidade, checklists, vencimentos, pendências | PLAT §4 p.4 | Preventivas | IMPL | `0029` | ciclo nunca fecha | VAL-C | A VALIDAR — cliente | BAIXO |
| 11 | Planos por família, risco e fabricante | PLAT §4 p.4 | Preventivas | PARC | alvo por categoria | modelo/fabricante/criticidade | P1.4 | DEPOIS | BAIXO |
| 12 | Instrumentos, certificados, medições, tolerâncias, resultados | PLAT §4 p.4 | Metrologia | PARC (baixo) | `metrologia.ts`; checklist `number` | tabelas | P2.1–P2.4 | AGORA | MÉDIO |
| 13 | Captura automática e rastreabilidade | PLAT §4 p.4 | Metrologia | FUT-RA | — | porta | P2.5, P3.3 | FUTURO | — |
| 14 | Laudos, certificados e documentos versionados | PLAT §4 p.4 | Documentos | IMPL (motor) | `0034` | payloads vazios, PDF | P2.6, P2.8 | AGORA / DEPOIS | BAIXO |
| 15 | Geração automática a partir de medições | PLAT §4, §6.2 | Documentos | AUS | — | sessão + modelo | P2.6 (cópia) | AGORA (fundação) / FUTURO (automático) | BAIXO |
| 16 | Estoque: itens, almoxarifados, viaturas, consumo, reserva | PLAT §4 p.4 | Estoque | IMPL | `0030` | — | — | — | — |
| 17 | Lote, série, validade, reposição | PLAT §4 p.4 | Estoque | PARC | `stock_lots`, `tracking` | exigência na baixa; reposição | DEPOIS | DEPOIS | BAIXO |
| 18 | Portal: chamados, status, agenda, documentos, aprovações | PLAT §4 p.4 | Portal | IMPL/PARC | 10 rotas | aprovação de orçamento | P1.1 | DEPOIS | BAIXO |
| 19 | NPS, notificações, relatórios por unidade | PLAT §4 p.4 | Portal | PARC | `rating`; fila de saída | fluxo NPS; transporte; relatórios | P1.2, P3.5 | DEPOIS | BAIXO |
| 20 | Backlog, SLA, preventivas, produtividade, ativos | PLAT §4 p.4 | Indicadores | IMPL | `insights` | — | — | — | — |
| 21 | MTTR, MTBF, disponibilidade, risco, IA | PLAT §4 p.4 | Indicadores | PARC | MTTR/MTBF definidos | disponibilidade (VAL-C), risco (VAL-E), IA (FUT) | — | A VALIDAR / FUTURO | — |
| 22 | Oportunidade: necessidade, ativo, prazo, origem, fornecedor, prioridade, autorização | PLAT §4/§5 p.4 | Comercial | AUS | — | entidade | P1.7 | DEPOIS | BAIXO |
| 23 | Catálogo, cotações, mercado | PLAT §4 p.4 | Comercial | FUT-NI | — | — | — | FUTURO | — |
| 24 | Instrumento: fabricante, modelo, série, versão/firmware, interface, protocolo, certificado, validade | PLAT §5 p.4; CART §8 p.4 | Instrumentos | AUS | grep sem ocorrência | tabela | P2.1 | AGORA | MÉDIO |
| 25 | Catálogo de instrumentos: status do modelo, adaptador, última validação, limitações | PLAT §8 p.6 | Instrumentos | AUS | — | campos | P2.1 | AGORA | BAIXO |
| 26 | Procedimento: tipo de teste, versão, sequência, unidade, limites, tolerâncias, padrão, responsável | PLAT §5 p.4; CART §8 | Protocolos | PARC | `checklist_templates/items` | ponto, tipo, RT, padrão | P2.3 | AGORA | BAIXO |
| 27 | Sessão de medição: OS, ativo, instrumento, técnico, data, horário, arquivo bruto, valores, unidades, resultado | PLAT §5 p.4; CART §8 | Sessões | PARC | `checklist_responses/answers` | instrumento, certificado, origem, bruto | P2.4 | AGORA | BAIXO |
| 28 | Certificado: número, laboratório, data, validade, escopo, arquivo, padrão, rastreabilidade | PLAT §5 p.4 | Certificados | AUS (externo) | `PadraoDeMedicao` em memória | tabela | P2.2 | AGORA | BAIXO |
| 29 | Relatório: modelo, versão, dados preenchidos, evidências, assinaturas, revisão, aprovação | PLAT §5 p.4 | Relatórios | PARC | motor de documentos | modelo/campos, vínculo com sessão | P2.6 | AGORA | BAIXO |
| 30 | N0 manual estruturado: valida unidade, faixa, resultado | PLAT §6.1 p.5 | Medição | PARC | `computeVerdict` para `number` | proveniência; ponto | P2.3–P2.5 | AGORA | BAIXO |
| 31 | N1 arquivo (CSV/XML/PDF/export) | PLAT §6.1 p.5 | Integração | FUT-RA | porta de arquivos existe | porta de fonte | P2.5 agora, P3.3 depois | FUTURO | — |
| 32 | N2 gateway Be Care Link | PLAT §6.1 p.5; §7; CART §4 | Integração | FUT-NI | idempotência pronta | identificação de instrumento | P3.4 | FUTURO | — |
| 33 | N3 protocolo autorizado | PLAT §6.1 p.5 | Integração | FUT-NI | — | — | — | FUTURO | — |
| 34 | N4 instrumento próprio | PLAT §6.1 p.5; CART §6 | Integração | FUT-NI | — | — | — | FUTURO | — |
| 35 | Preenchimento automático (7 passos) | PLAT §6.2 p.5; CART §5 | Relatórios | AUS | passos 1, 6, 7 têm base | passos 2–5 | P2.x | AGORA (fundação) / FUTURO (automação) | BAIXO |
| 36 | Preservar dados brutos | PLAT §6.2 passo 5 | Dados brutos | PARC | envio retomável, SHA-256 | tipo/dono/finalidade | P0.2 | AGORA | MÉDIO |
| 37 | QR/NFC obrigatório para ativo, OS, instrumento, padrão, certificado, local | PLAT §7 p.6; CART §3 | Identificação | PARC | QR de ativo | QR de instrumento/certificado/local; NFC | P2.1 (token); NFC FUT | AGORA / FUTURO | BAIXO |
| 38 | USB/serial/Ethernet/BLE/Wi-Fi/IoT/montagem própria | PLAT §7 p.6 | Hardware | FUT-NI | — | — | — | FUTURO | — |
| 39 | IA: copiloto, relatório, gerencial, ciclo de vida, comercial — com fonte, versão, aprovação humana, dados isolados | PLAT §9 p.7 | IA | FUT-RA | aprovação humana e RLS existem | `provenance`, `actor_kind` | P4 | FUTURO | — |
| 40 | Omie | PLAT §10 p.7 | Integrações | FUT-NI | eventos no outbox | `external_id`, conector | P0.3 agora; P4 | FUTURO | — |
| 41 | E-mail, WhatsApp, calendário (OS permanece histórico oficial) | PLAT §10 p.7 | Integrações | PARC | fila de saída; OS é o registro | transportes | P3.5; WhatsApp P4 | DEPOIS / FUTURO | BAIXO |
| 42 | BI e exportação (CSV, XLSX, painéis) | PLAT §10 p.7 | Integrações | PARC | indicadores com definição | export, painéis | P3.6 | DEPOIS | BAIXO |
| 43 | Sistemas hospitalares (APIs/arquivos/conectores) | PLAT §10 p.7 | Integrações | FUT-RA | outbox | webhooks, API key | P3.1, P3.2 | FUTURO | — |
| 44 | Autenticação individual, MFA, SSO futuro | PLAT §11 p.7 | Segurança | PARC | `AuthProvider` | MFA; provedor real | P1.6 | DEPOIS (antes da homologação) | BAIXO |
| 45 | Permissões por organização, unidade, contrato, ativo, tipo de dado | PLAT §11 p.7 | Segurança | PARC | org, local, cliente, tipo de dado | contrato, ativo | VAL-C | A VALIDAR — cliente | MÉDIO |
| 46 | Isolamento e testes contra vazamento | PLAT §11 p.7 | Segurança | IMPL | 24 suítes; PORTAL-011 | — | manter ao criar tabelas | — | — |
| 47 | Criptografia, dispositivos, backups e restauração testada | PLAT §11 p.7 | Segurança | VAL-C / infra | — | rotina e doc | — | A VALIDAR — cliente | MÉDIO |
| 48 | Auditoria imutável: OS, medições, documentos, aprovações, permissões | PLAT §11 p.7 | Segurança | PARC | `audit_logs` append-only; triggers | **medições e anexos sem auditoria; upsert** | P0.1 | AGORA | BAIXO |
| 49 | Dados de pacientes fora do MVP | PLAT §11 p.7 | Segurança | IMPL | sem campos de paciente | — | — | — | — |
| 50 | Instrumentos próprios como projetos separados | PLAT §11 p.7 | Governança | IMPL (por escopo) | — | — | — | FUTURO | — |
| 51 | Migração Arkmeds em 6 passos com arquivo histórico e relatório | PLAT §12 p.7 | Migração | PARC (só ativos) | `importAssets`, curadoria | pipeline | P1.8 + P0.3 | DEPOIS (antes da migração real) | BAIXO |
| 52 | Roadmap 0–5 | PLAT §13 p.8 | Produto | fases 0–1 feitas; 2 parcial | — | — | — | — | — |
| 53–61 | Critérios de aceite 1–9 | PLAT §14 p.8 | — | ver §30 | — | — | — | — | — |
| 62 | Plataforma aberta por modelo de dados + camada de adaptadores, não por marca | CART §3 p.3 | Arquitetura | PARC | 5 portas existentes | porta de fonte de medição | P2.5 | AGORA | BAIXO |
| 63 | Dados: valor, unidade, horário, instrumento, certificado, protocolo, técnico, evidência, resultado | CART §3 p.3 | Medição | PARC | 5 de 9 | instrumento, certificado, evidência bruta, unidade da resposta | P2.4 | AGORA | BAIXO |
| 64 | Offline: captura local, fila, confirmação, recuperação | CART §3 p.3 | Offline | IMPL | EPIC-014 | — | — | — | — |
| 65 | Caminho de implantação (7 passos) | CART §7 p.4 | Produto | passos 1–2 feitos; 3 parcial | — | — | — | — | — |
| 66 | Requisitos ao desenvolvedor (6 linhas) | CART §8 p.4 | — | Instrumento AUS · Medição PARC · Procedimento PARC · Relatório PARC · Integração PARC · Segurança PARC | — | — | P0–P3 | — | — |
| 67 | Nome comercial provisório; propriedade Grupo Be Care | PLAT §2 p.2 | Marca | IMPL (preparado) | `marca.config.json` + `npm run marca` | — | nenhuma agora | A VALIDAR — cliente | BAIXO |
| 68 | Referências como benchmark, sem dependência | PLAT §1, §8, §15; CART §2 | Governança | IMPL | nenhum acesso; nenhuma dependência | — | — | — | — |
