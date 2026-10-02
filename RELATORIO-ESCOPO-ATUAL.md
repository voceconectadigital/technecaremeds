# Relatório — conclusão do escopo atual contratado

**Projeto:** technecaremeds / Téchne Care · **Rodada:** escopo atual (anterior às novas
solicitações do Anderson) · **Data:** 01–02/10/2026 · **Branch:** `main`

Fontes do escopo, nesta ordem: `docs/AI-HANDOFF.md` → `docs/AUDITORIA-GAP-BECARE-TECHNECARE-V2-2026-09.md`
(itens P0, P1, P2 e apêndice A) → PDFs do cliente (via a auditoria) → SPEC/ADRs → código.
`docs/NOVAS-SOLICITACOES.md` foi lido **só** para saber o que não implementar.

---

## 1 · HEAD inicial

`45476ba` — _docs: consolidate AI handoff and client change requests_. Árvore limpa,
`origin/main` em dia, 47 migrations (0000–0046), 1723 testes passando / 32 pulados.

## 2 · HEAD final

O commit que acrescenta este relatório e a atualização do AI-HANDOFF, imediatamente
depois de `fb996bc` (confira com `git log -1`).

## 3 · Commits desta rodada (14 + o de documentação)

| Commit    | O quê                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `a7545ca` | Fundações V2: medição imutável (0047), identificador externo (0048), modo/recursos da organização (0049)                                   |
| `d2bf24d` | Metrologia N0: vocabulário (0050), instrumento e certificado externo (0051), protocolo (0052), sessão e dado bruto (0053), envelope neutro |
| `d7322bf` | Documento técnico a partir da sessão (0054), tipo aceite, PDF                                                                              |
| `b345d29` | Preventiva por modelo/fabricante/criticidade (0055); checklist do plano anexado à OS; alvo recortado pelo cliente                          |
| `0306df3` | Linha do tempo unificada do ativo; substituição de ativo (0056)                                                                            |
| `5d4ed7c` | Portal: decisão de orçamento, avaliação do atendimento, PDF do documento liberado                                                          |
| `85b7455` | Teste adversarial do portal (outro cliente)                                                                                                |
| `f6d8a9b` | Oportunidade — núcleo (0057)                                                                                                               |
| `aff08c4` | Importação rastreável (0058)                                                                                                               |
| `f9f94d3` | Contratos alinhados à API — os 4 desvios registrados                                                                                       |
| `7dcec6c` | Busca global: todo resultado leva a uma tela que existe                                                                                    |
| `2684e38` | Field: ponto de medição identificado, sem campo que geraria conflito                                                                       |
| `fb996bc` | `capturas.json` (gerado) fora do Prettier                                                                                                  |
| _(este)_  | AI-HANDOFF, NOVAS-SOLICITACOES (revisão sem mudança de status) e este relatório                                                            |

## 4 · Migrations novas (12) — 0047 a 0058

| Migration                          | Conteúdo                                                                                                                                | Segurança                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `0047_medicao_imutavel`            | `checklist_answer_revisions` + `revision`/`correction_reason`; gatilho BEFORE UPDATE arquiva a versão anterior; `fn_audit` em respostas | histórico só pelo gatilho (SECURITY DEFINER, dono `aurora_owner`); `aurora_app` sem DELETE em respostas e só SELECT no histórico; FORCE RLS |
| `0048_identificador_externo`       | `external_source/external_id` em clientes, locais, ativos, OS, itens de estoque, vínculos                                               | único por (organização, origem, id) — nunca global; CHECK de par completo                                                                   |
| `0049_modo_da_organizacao`         | `usage_mode` (5 modos) + `enabled_features` (nulo = tudo)                                                                               | organização do contexto apenas                                                                                                              |
| `0050_metrologia_vocabulario`      | valores de enum (`measurement`, `raw_data`, `certificate`, `import_source`) e tipos novos                                               | arquivo próprio (valor de enum não pode ser usado na mesma transação)                                                                       |
| `0051_instrumentos_e_certificados` | `instruments` (1:1 `assets`), `instrument_certificates` (externo)                                                                       | FK compostas, FORCE RLS, auditoria, certificado imutável (revoga-se), sem DELETE                                                            |
| `0052_protocolo_metrologico`       | `procedure_kind`, RT, `checklist_template_instruments`, colunas do ponto `measurement`                                                  | estrutura do protocolo publicado imutável                                                                                                   |
| `0053_sessao_de_medicao`           | `measurement_sessions`, proveniência por resposta, dono sessão/certificado em anexos, identidade do anexo imutável, auditoria de anexos | sessão sem DELETE, proveniência imutável, FK compostas                                                                                      |
| `0054_documento_da_sessao`         | `documents.measurement_session_id`                                                                                                      | vínculo imutável                                                                                                                            |
| `0055_alvo_de_preventiva`          | filtros de modelo/fabricante/criticidade; função de alvo reescrita                                                                      | **corrige** alvo que ignorava o cliente do plano                                                                                            |
| `0056_substituicao_de_ativo`       | `assets.replaced_by_asset_id`                                                                                                           | FK composta, forma conferida, um antecessor                                                                                                 |
| `0057_oportunidades`               | `opportunities`, `opportunity_status_history`                                                                                           | grafo no banco; trilha só por gatilho SECURITY DEFINER; sem DELETE                                                                          |
| `0058_importacao_rastreavel`       | `import_batches`, `import_rows`, dono "lote" em anexos                                                                                  | linha crua e lote concluído imutáveis; sem DELETE                                                                                           |

Todas: aditivas, numeração contínua, `organization_id` + FK compostas, `ENABLE`+`FORCE` RLS,
política com `USING` e `WITH CHECK`, índices, dono `aurora_owner`, auditoria onde é dado de
negócio. Aplicadas do zero em toda execução da suíte (PGlite) e cobertas pelo teste de schema.
**Nenhuma migration foi aplicada em banco remoto.**

## 5 · Matriz do escopo (fontes anteriores às novas solicitações)

| Item (fonte)                                                 | Antes                    | Agora                                                                                                   |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| P0.1 Medição imutável e auditada                             | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P0.2 Dado bruto (finalidade, dono, tipos, SHA-256)           | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P0.3 `external_id`/`external_source`                         | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P0.4 Modo de uso e recursos por organização                  | A IMPLEMENTAR            | **IMPLEMENTADO** (API); quais recursos por modo: BLOQUEADO — CLIENTE                                    |
| P1.1 Aprovação de orçamento pelo portal                      | A IMPLEMENTAR            | **IMPLEMENTADO** (API + tela)                                                                           |
| P1.2 Avaliação (NPS) no portal                               | A IMPLEMENTAR            | **IMPLEMENTADO** (nota 1–5); fórmula de NPS: BLOQUEADO — CLIENTE                                        |
| P1.3 Linha do tempo unificada do ativo                       | A IMPLEMENTAR            | **IMPLEMENTADO** (API); tela na ficha: pendente                                                         |
| P1.4 Preventivas por modelo/fabricante/criticidade           | A IMPLEMENTAR            | **IMPLEMENTADO** (dados + leitura); rota de criar plano: não existia e não foi criada (sobrepõe NS-004) |
| P1.5 Substituição de ativo                                   | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P1.6 MFA / provedor                                          | PARCIAL                  | **BLOQUEADO — CLIENTE/INFRA** (provedor não escolhido)                                                  |
| P1.7 Oportunidade (núcleo)                                   | A IMPLEMENTAR            | **IMPLEMENTADO** (API); tela: pendente                                                                  |
| P1.8 Importação rastreável                                   | A IMPLEMENTAR            | **IMPLEMENTADO** (genérico); parser Arkmeds: **BLOQUEADO — CLIENTE**                                    |
| P2.1 Instrumento                                             | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P2.2 Certificado externo                                     | A IMPLEMENTAR            | **IMPLEMENTADO**; campos estruturados de escopo/incerteza: BLOQUEADO — ESPECIALISTA                     |
| P2.3 Protocolo com ponto de medição                          | A IMPLEMENTAR            | **IMPLEMENTADO** (dado); veredito: BLOQUEADO — ESPECIALISTA                                             |
| P2.4 Sessão de medição                                       | A IMPLEMENTAR            | **IMPLEMENTADO**                                                                                        |
| P2.5 Envelope neutro + porta de fonte                        | A IMPLEMENTAR            | **IMPLEMENTADO** (só fonte manual; N1–N4: FUTURO)                                                       |
| P2.6 Documento a partir da sessão                            | A IMPLEMENTAR            | **IMPLEMENTADO** (cópia); campos técnicos por tipo: BLOQUEADO — ESPECIALISTA                            |
| P2.7 Aceite de equipamento                                   | A IMPLEMENTAR            | **IMPLEMENTADO** (tipo + protocolo `acceptance`); exigências do termo: A VALIDAR                        |
| P2.8 PDF                                                     | A IMPLEMENTAR            | **IMPLEMENTADO** (interno + portal)                                                                     |
| Desvios API × contrato (AI-HANDOFF §19)                      | defeito aberto           | **CORRIGIDO**                                                                                           |
| Busca global para rota inexistente (§32)                     | defeito aberto           | **CORRIGIDO**                                                                                           |
| Checklist do plano não anexado (§32)                         | defeito aberto           | **CORRIGIDO**                                                                                           |
| Fechamento automático de ciclo preventivo                    | BLOQUEADO — CLIENTE      | **BLOQUEADO — CLIENTE** (inalterado)                                                                    |
| P3 (webhooks, API key, N1, transporte de e-mail, exportação) | FUTURO                   | FUTURO — não implementado                                                                               |
| P4 (Omie, WhatsApp, catálogo/mercado, IA, N2–N4, NFC, SSO)   | FUTURO — NÃO IMPLEMENTAR | não implementado                                                                                        |
| NS-001 a NS-017                                              | NOVO NS                  | **não implementados**                                                                                   |

## 6 · Itens que estavam pendentes

P0.1–P0.4, P1.1–P1.5, P1.7, P1.8, P2.1–P2.8 da auditoria de gap V2, e três defeitos registrados no
AI-HANDOFF (desvios de contrato, busca global, checklist do plano).

## 7 · Itens implementados

- **Medição imutável:** corrigir uma resposta arquiva a anterior inteira (valor, veredito, quem,
  quando), com revisão contada pelo banco, motivo opcional, auditoria e isolamento. Rota
  `GET /checklist-responses/:id/revisions`.
- **Dado bruto, certificado e arquivo de importação** como anexos com dono certo, tipos próprios,
  SHA-256 obrigatório e identidade imutável — pelo mesmo envio retomável de sempre.
- **Identificador externo** em 6 entidades, único por organização e origem.
- **Modo de uso e recursos habilitados** (`PATCH /organizations/current/configuration`).
- **Instrumento** (extensão de ativo) e **certificado externo** (registro, arquivo, revogação,
  cadeia `traceable_to`). Rotas `/instruments*`, `/instrument-certificates/*`.
- **Protocolo metrológico** no checklist versionado: tipo de procedimento, RT, instrumentos
  exigidos por categoria, ponto `measurement` com unidade, nominal, tolerâncias e leituras
  exigidas **como dado**.
- **Sessão de medição** com instrumento, certificado que precisa cobrir o dia da medição,
  técnico, origem, ambiente declarado; leituras pela **fonte manual → envelope neutro →
  núcleo**; unidade diferente recusada (sem conversão); sessão encerrada não aceita leitura.
- **Documento a partir da sessão** (cópia), emissão que confere a fronteira de calendário,
  tipo **aceite**, **PDF** determinístico (interno e portal).
- **Preventiva** por modelo/fabricante/criticidade; checklist do plano anexado à OS;
  geração automática e manual unificadas.
- **Vida do equipamento:** linha do tempo unificada (com recorte por permissão) e substituição.
- **Portal:** aprovar/recusar orçamento com evidência de aceite, motivos de recusa, avaliar
  atendimento, baixar PDF — com telas.
- **Oportunidade (núcleo):** grafo com autorização comercial por permissão própria, trilha
  inviolável, recortes de cliente.
- **Importação rastreável:** lote, linha crua, arquivo original, amostra sem gravar, oficial com
  identificador externo, relatório persistido.
- **Correções:** contratos ↔ API (4 desvios, mais dois 500 latentes: convite com `customer` e
  origens `qr`/`system`); busca global; Field não oferece campo que geraria conflito para o
  ponto de medição; `format:check` do CI (arquivo gerado da demo).

Defeitos encontrados **nesta** rodada e corrigidos antes do commit: CHECK do identificador
externo que aceitava par incompleto (`NULL ~ padrão` passa); gatilho de histórico da
oportunidade gravando antes da linha existir; consulta da linha do tempo usando coluna
inexistente; datas `date` lidas como `Date` deslocando um dia no fuso do Brasil; alvo de
preventiva ignorando o cliente do plano (defeito antigo da 0029).

## 8 · Itens já existentes confirmados (não reimplementados)

Autenticação por senha e `local`, RBAC, RLS FORCE, `withTenant`, outbox, idempotência de campo,
envio retomável, motor de documentos, checklists versionados, SLA, agenda, estoque com imagem e
categoria, QR (token, resolução, leitura, rotação — sem etiqueta), demo pública, automações
(motor existente, não ligado — inalterado), indicadores (definições inalteradas).

## 9 · Bloqueios — cliente

- Parser da exportação do **Arkmeds** (formato real não fornecido).
- **MFA/SSO**: escolha do provedor de identidade (e hospedagem).
- **Fechamento do ciclo preventivo**: regra (fim da janela, 1º item, abertura do seguinte).
- **Recursos padrão por modo de uso** (hoje: tudo habilitado em todo modo).
- **NPS**: como a nota 1–5 vira indicador.
- **Aceite**: exigências do termo (RT e assinatura estão como padrão conservador A VALIDAR).
- **Oportunidade**: se o portal exibe e quem autoriza em cada cliente.

## 10 · Bloqueios — especialista

As cinco decisões da fronteira metrológica continuam bloqueadas e **nenhuma foi tocada**:
incerteza expandida, correção de erro sistemático, critério de aceitação/veredito por ponto,
limites de TSE, arredondamento. Também: campos técnicos de CAL/TSE/QT/aceite por norma, escopo
estruturado do certificado (faixas, incerteza declarada), fórmula de risco. O ponto de medição
tem veredito **sempre `na`** (há teste que prova dentro, no limite e fora da tolerância), e
`medicao.ts` tem o mesmo freio de teste que `metrologia.ts`.

## 11 · Itens futuros (não implementados)

N1 (arquivo), N2 gateway Be Care Link, N3 SDK, N4 instrumento próprio, BLE/USB/serial, NFC,
webhooks, API key, transportes (e-mail/WhatsApp), exportação CSV/XLSX, Omie, sistemas
hospitalares, IA, catálogo/cotação/mercado, co-branding, SSO. Telas web das capacidades novas
(instrumento, sessão, oportunidade, importação, modo da organização, linha do tempo na ficha).

## 12 · Nenhuma nova solicitação (NS) foi implementada

**Confirmado: zero.** Nada de etiqueta/impressão/download de QR, check-in/GPS/geofence, mobile
novo, depreciação, indicadores FHEMIG/Básico/Completo/Expert, robô ou app externo, IA, novas
automações, e-commerce, marketplace, comprador hospitalar, cotação ou estoque comercial.
`docs/NOVAS-SOLICITACOES.md` recebeu só uma **revisão sem mudança de status**: onde o escopo atual
mudou a base de uma NS (NS-001, 002, 003, 004, 005), a linha "Revisão 02/10/2026" diz o que mudou
e o que continua faltando. Nenhuma foi marcada como implementada ou "já existe".

## 13 · Testes

| Portão                                 | Resultado                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `spec:audit`                           | ✅ 0 erro, 0 aviso                                                                        |
| `typecheck` (`tsc -b`)                 | ✅                                                                                        |
| `lint`                                 | ✅                                                                                        |
| `marca:check`                          | ✅                                                                                        |
| `openapi:check`                        | ✅ — 214 rotas, 141 com contrato (66%; eram 109/60%)                                      |
| Unidade + HTTP (PGlite)                | ✅ **1883 passando, 0 falha, 32 pulados**, 104 arquivos (baseline: 1723, 91)              |
| PostgreSQL real (`AURORA_TEST_PG_URL`) | ⚠️ **não executado** — ver §16                                                            |
| RLS / RBAC / isolamento                | ✅ cada suíte nova tem caso de outra organização, de permissão ausente e de imutabilidade |
| Contratos / paridade                   | ✅ (`paridade-contratos.test.ts`, demo sem lista de exceções)                             |
| Builds                                 | ✅ web conectado, web demo, portal, field                                                 |
| Playwright — demo local                | ✅ 7 passando, 1 pulado por desenho                                                       |
| Playwright — demo publicada            | ✅ 7 passando, 1 pulado                                                                   |
| Playwright — produto conectado (148)   | ⚠️ **não executado** (exige PostgreSQL) — ver §16                                         |
| Field/offline                          | ✅ suítes de fila, sincronização, anexos e conformidade (dentro dos 1883)                 |
| Segredos                               | ✅ nenhum segredo                                                                         |
| Formatação                             | ✅ em checkout LF (condição do CI)                                                        |

Suítes novas: `medicao-imutavel`, `api-fundacoes`, `medicao` (domínio), `api-metrologia`,
`pdf`, `api-documento-sessao`, `documento-da-sessao` (domínio), `preventiva-alvo`,
`api-ativo-vida`, `api-portal-decisoes`, `api-oportunidades`, `api-importacao`,
`paridade-contratos`.

## 14 · Regressões encontradas/corrigidas

- Contagens "seis tipos de documento" em dois testes antigos → sete (aceite), deliberado.
- Nenhuma regressão funcional nas suítes existentes. A demonstração passou local e publicada.
- Ambiente: a suíte com um worker por núcleo estoura a memória (16 GB) — rode com
  `--maxWorkers=3`. Com 4 workers, uma execução teve uma falha intermitente do portal que não se
  reproduz isolada nem com 3 workers.

## 15 · Estado da demo

Funcionando (PASS), local e publicada, antes do push. Nada foi adicionado à demo: nenhuma tela
nova consome operação não capturada; campos novos nos contratos capturados são opcionais; o
download de PDF é recusado na demo com a mensagem de "versão conectada". `capturas.json` não
foi regerado. O push dispara a publicação automática do Pages; a demo foi revalidada depois do
push (resultado na resposta da rodada).

## 16 · Estado local conectado

API, web, portal e field compilam; a API sobe em processo nas suítes HTTP (PGlite, papel sem
privilégio). **PostgreSQL real e o E2E do produto conectado não foram executados**: o Docker
Desktop desta máquina falha ao iniciar (`starting services: initializing Ingest server ...
sailor-ingest.sock: The file cannot be accessed by the system`) — defeito do ambiente local,
não do projeto. O contêiner `aurora-postgres` e as stacks de outros produtos **não foram
tocados**. O CI (tarefas `banco` e `navegador`) roda ambos em PostgreSQL 16 de serviço.
Nada foi publicado: nenhuma API, worker, VPS, HostPanel, Supabase ou migration remota.

## 17 · Próximas etapas

1. Consertar o Docker local (apagar o socket travado em `%LOCALAPPDATA%\Docker\run` e reiniciar)
   e rodar `AURORA_TEST_PG_URL=... npx vitest run` e `npx playwright test` — ou conferir o CI.
2. Telas web das capacidades novas (instrumento/certificado, sessão de medição e documento da
   sessão, linha do tempo na ficha do ativo, oportunidade, importação, modo da organização).
3. Decisões do cliente listadas em §9; com o arquivo real do Arkmeds, o leitor do formato.
4. Com metrologista: procedimento escrito + casos de referência para destravar §10.
5. Orçamento/aprovação das NS antes de qualquer item de `docs/NOVAS-SOLICITACOES.md`.
6. Rodada de deploy conectado (máquina com Node persistente, PostgreSQL, armazenamento).
