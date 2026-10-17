# Relatório — rodada de pendências do pente-fino (17/10/2026)

> **Pedido:** resolver de forma autônoma todas as pendências dos 85 achados do pente-fino
> (`docs/AUDITORIA-PENTE-FINO-2026-10-17.md`), validando, auditando e corrigindo.
> **Branch:** `fix/pendencias-pente-fino-2026-10-17`, saindo da `main` `6b7e391` (merge da PR #27).
> **Remoto:** nenhuma migration aplicada, nenhum deploy de backend.
> **Histórico:** a rodada foi interrompida uma vez por limite de uso e retomada. Na retomada, as edições
> parciais foram revisadas e concluídas; nada ficou pela metade.

---

## 1 · Ponto de partida

A PR [#27](https://github.com/voceconectadigital/technecaremeds/pull/27) fechou o pente-fino técnico: 3/3 P0,
20/20 P1, 28/42 P2 e 12/17 P3 corrigidos, com o CI da `main` verde. Ficaram **24 itens** abertos, entre
BLOQUEADO — CLIENTE, BLOQUEADO — INFRA e ABERTO, além das perguntas P-01…P-16 do Anderson e dos critérios do
especialista.

## 2 · O que eu NÃO resolvi de propósito

| Item | Motivo |
| --- | --- |
| **P-01…P-16** (fórmulas e definições do Anderson) | São definições de negócio. Se eu as "resolvesse", o sistema imprimiria números como oficiais sem respaldo. Continuam como pendentes, provisórias ou sem definição. |
| **Critérios metrológicos** (incerteza, TSE, tolerância, aceitação automática) | Definição científica do especialista. |
| **Migration remota (0060–0077) e deploy do backend** | "Resolver tudo" não equivale a autorização explícita com destino comprovado. O código está pronto; a publicação aguarda a sua autorização. |

---

## 3 · Itens resolvidos — os 24 pendentes

### Execução de campo

| ID | Antes | Decisão e correção | Testes |
| --- | --- | --- | --- |
| PF-14 | BLOQUEADO — CLIENTE | **A própria descrição da permissão já definia a regra** ("executar só OS atribuída a mim"); o código é que divergia. Novo `assertCanExecuteWorkOrder`: quem tem `work_order.execute` sem `execute_any` só age em OS de que é responsável ou da equipe atribuída. Vale para check-in, cronômetro, apontamento, checklist, anexos, assinatura, relatório de serviço, peça do cliente, transições e envio de fotos. A recusa é 403 com o motivo, que é o que a tela "Atenção" do campo mostra. Parar o próprio cronômetro e fazer check-out continuam permitidos, para que uma reatribuição no meio da visita não deixe cronômetro preso. O efeito comercial do orçamento sobre a OS recebe `execute_any`. | `pente-fino-campo` (api 17, domain 8); suítes que executavam OS não atribuída passaram a atribuí-la |
| PF-65 | ABERTO | Iniciar o cronômetro aceita id gerado no aparelho e `started_at`; parar aceita `ended_at`; check-in/out aceitam `occurred_at`. Hora do aparelho limitada a 48 h no passado e 5 min no futuro, senão 422. O app de campo mostra "rodando desde HH:MM", enfileira "Parar cronômetro" e impede um segundo início. `/field/sync` devolve os cronômetros abertos. | `pente-fino-campo` (api, field 12) |
| PF-66 | ABERTO | Fotos na fila são carimbadas com organização e pessoa. As de outra sessão ficam na fila, nunca são apagadas, e aparecem como "N fotos de outra sessão". | `pente-fino-campo` (field) |
| PF-84 | ABERTO | Enviar bytes exige poder executar a OS do anexo, dentro do escopo (fora dele, 404). Anexo sem OS só aceita bytes de quem o registrou. Ao concluir, os bytes de imagem e PDF são conferidos contra o tipo declarado; se divergirem, 422 e o anexo não é marcado como concluído. | `pente-fino-campo` (api), `api-attachment-upload` |
| PF-41 | BLOQUEADO — CLIENTE | Configuração por organização `require_operational_result`, **desligada por padrão** (o comportamento atual não muda). Com ela ligada, concluir a OS sem LIBERADO/PARADO dá 422. É alterada por `PATCH /organizations/current/configuration`. | `pente-fino-campo` (api), `api-fundacoes` |

### Estoque e orçamento

| ID | Antes | Decisão e correção | Testes |
| --- | --- | --- | --- |
| PF-34 | BLOQUEADO — CLIENTE | **Decisão: integridade primeiro.** Na aprovação, cada linha de peça reserva só o que ainda não foi consumido em campo na mesma OS, fora de qualquer orçamento. O abatimento fica em `quote_items.field_consumed_qty` (0074), para que um mesmo consumo nunca abata dois orçamentos. O valor cobrado não muda: a peça foi usada e é paga. Só o movimento de estoque deixa de duplicar. | `pente-fino-estoque2` (15) |
| PF-71 | ABERTO | `POST /v1/work-orders/:id/quotes` cria o orçamento e todas as linhas numa transação, idempotente por `clientRequestId`, com o escopo da OS. A tela faz uma chamada só e atualiza as listas. | `pente-fino-orcamento2` (6) |
| (revisão) | — | Reservas anteriores à 0071 numa OS com 2+ orçamentos aprovados ficavam abertas para sempre. A 0074 as liga ao orçamento certo quando a ligação é inequívoca (mesmo instante de aprovação, mesma OS e item), libera as de orçamento substituído e emite um WARNING com a contagem do que precisa de ajuste manual. | `pente-fino-estoque2` |

### Indicadores e fuso

| ID | Antes | Decisão e correção | Testes |
| --- | --- | --- | --- |
| PF-50 | BLOQUEADO — CLIENTE | **Decisão:** quem só enxerga um cliente já tem os números recortados para esse cliente, então é medido pela meta dele; sem meta do cliente, vale a da organização. Isso vale para o relatório sob demanda e para o agendado. O teste anterior foi atualizado. | `api-metas-indicadores`, `pente-fino-indicadores` |
| PF-51 / PF-72 | ABERTO | O dia da meta, as datas de aviso e as do PDF seguem o fuso da organização (`organizations.timezone`, padrão `America/Sao_Paulo`). As telas calculam "hoje" com data local (`packages/app-kit/src/data-local.ts`). | `pente-fino-indicadores` (domain 9, db 12, web 10) |
| PF-52 | BLOQUEADO — CLIENTE | Nova opção `periodo: 'mes_anterior'` (mês civil anterior no fuso da organização; o dia da meta é o último dia do mês). Regras antigas não mudam. | `pente-fino-indicadores` (api 4) |
| PF-53 | ABERTO | O filtro de categoria passou a valer nas quatro consultas. Além delas, a conformidade de SLA e a de planos ignoravam setor e categoria e foram corrigidas. | `pente-fino-indicadores` (db) |
| PF-54 | ABERTO | A tela de relatório agendado mostra PROVISÓRIO e a meta, ou "SEM META CONFIGURADA". | `pente-fino-indicadores` (web) |
| PF-55 | ABERTO | O Painel recebe as metas resolvidas; SLA e disponibilidade ganham cor conforme a meta e o sentido, ou ficam neutros com "sem meta". No módulo de Planos, o anel de conformidade ficou neutro: ele soma todos os tipos de plano, e não existe uma meta para essa soma (90/70 era meta inventada). | web |
| PF-56 | BLOQUEADO — INFRA | O e-mail de automação passa pelas preferências de notificação. O suprimido fica registrado com o motivo (0075). Os três tipos de aviso de automação entraram no catálogo, então já dá para desligar esse e-mail. | `pente-fino-indicadores`, `notifications` |
| — | P3 | A lista de indicadores da regra agendada passa a ser validada ao salvar (422). | `pente-fino-indicadores` |

### Plataforma, banco e infraestrutura

| ID | Antes | Decisão e correção | Testes |
| --- | --- | --- | --- |
| PF-15 | BLOQUEADO — CLIENTE | `audit.read` saiu de "toda leitura". Coordenador, Gestor e Financeiro deixam de ler a trilha global; quem deve lê-la a recebe explicitamente. A 0076 ajusta as organizações existentes. | `permissions.test` |
| PF-16 | ABERTO | **ACEITO / BY DESIGN.** Qualquer identidade passada ao banco é forjável pelo mesmo papel que hoje forja o parâmetro, e a premissa do ataque exige injeção de SQL, que não existe. Mudar o mecanismo seria cerimônia, não proteção. | — |
| PF-20 | ABERTO | O defeito existia **também em runtime**. O provisionamento usa a chave livre seguinte (`preventiva_2`) e o nome qualificado ("Terapia (família)"); a 0076 repara as organizações existentes. | `migrations-upgrade` (+2) |
| PF-75 | BLOQUEADO — INFRA | Tempo-limite de consulta e de transação ociosa aplicado com `set_config(..., true)`, local à transação, o que funciona com o pooler do Supabase. `AURORA_DB_TIMEOUT_MS` (60 s; o worker usa 5×). | `pool-resiliente` |
| PF-80 | BLOQUEADO — INFRA | A CSP é gerada no build: usa a origem real da API e o hash do script de tema, sem `unsafe-inline` em script, e sai como **Report-Only**. Para passar a bloquear, basta trocar a flag depois de uma navegação limpa no ambiente publicado. | `cabecalhos-pages` |
| PF-74 / PF-79 | parciais | Completos com PF-75 e PF-80. | — |

---

## 4 · Revisão adversarial da PR #27 — regressões encontradas e corrigidas

Revisão independente, somente leitura, do diff `511ec1f..6b7e391`. Cada achado foi confirmado no código antes
de ser corrigido.

| Sev. | Regressão | Correção |
| --- | --- | --- |
| **P2** | A 0073 recomeçava a contagem depois de **qualquer** bloqueio vencido, e a tentativa feita durante o bloqueio não é registrada. Resultado: o degrau de 15 min era inalcançável pelo login real, e um atacante tinha cerca de 5 tentativas por minuto, sem fim. | A **0077** recomeça a contagem só depois do bloqueio de teto. Teste percorre os vencimentos pelo login real. |
| P3 | Login que falha com exceção (banco fora) não devolvia a cota de tentativas por IP; um hospital atrás de um NAT podia sair da queda com 429. | A cota é devolvida quando a chamada lança exceção. |
| P3 | A linha do tempo do contrato ainda mostrava excedente e multa no payload do evento. | Chaves financeiras do payload filtradas sem `contract.read_financials`. Teste com a persona Coordenador. |
| P3 | O seed de benchmark criava OS com ativo de outro cliente e era recusado pela 0072. | A OS herda o cliente do próprio ativo. |
| P3 | Reservas anteriores à 0071 ficavam órfãs. | Ver PF-34 (0074). |
| suspeito → corrigido | O Gestor podia alterar os próprios papéis. | Ninguém altera os próprios papéis (mesma regra do escopo). |
| suspeito → corrigido | Documento criado sem cliente ficava invisível a todo vínculo restrito, inclusive a quem o criou. | Passa a herdar o cliente da OS ou do equipamento; cliente divergente é recusado. |
| suspeito → corrigido | Um equipamento transferido de cliente fazia a materialização do ciclo inteiro falhar. | O item fica pendente e os demais viram OS; dispensar continua sendo decisão de quem coordena. |

---

## 5 · Migrations desta rodada (locais, NÃO aplicadas remotamente)

| Migration | O quê |
| --- | --- |
| `0074_orcamento_e_peca_lancada.sql` | `quote_items.field_consumed_qty`; trava de linhas congeladas aceitando só o abatimento; ligação das reservas antigas |
| `0075_indicadores_e_fuso.sql` | estado `suppressed` no e-mail de relatório agendado |
| `0076_trilha_e_catalogos_de_sistema.sql` | `audit.read` fora dos papéis que o recebiam por "toda leitura"; reparo dos tipos de OS e das famílias |
| `0077_bloqueio_progressivo_de_senha.sql` | bloqueio por conta com teto alcançável |

Os números são contíguos: a 0074 reservada para o campo não foi usada, e as quatro foram renumeradas antes do
PR. Nenhuma tinha sido aplicada fora de bancos de teste.

---

## 6 · Lacunas conhecidas (documentadas, não escondidas)

- **PF-14:** o consumo de peça na OS (`POST /inventory/work-orders/:id/parts`, guardado por `inventory.move`) e
  as rotas de sessão de medição não conferem a atribuição. Não existe API para definir a equipe da OS.
- **PF-41:** a web não tem tela de configurações da organização, e o app de campo não tem campo para o parecer.
  Com a exigência ligada, a conclusão feita pelo campo cai em "Atenção". Por isso o padrão é desligado.
- **PF-56:** nenhum código de produção marca `email_verified_at`, então todo e-mail, de automação ou não, fica
  `suppressed: unverified_email`. É coerente com o que já acontecia, e não há transporte de e-mail.
- **PF-80:** a CSP só passa a bloquear depois da conferência no ambiente publicado.
- **Demonstração:** as capturas gravadas (`capturas.json`) têm fatias à meia-noite UTC; os rótulos do gráfico da
  demo aparecem um dia antes até as capturas serem refeitas.

---

## 7 · Validação

Testes locais (PGlite, em shards — a suíte inteira de uma vez estoura a memória desta máquina):

| Shard | Arquivos | Testes | Pulados | Falhas |
| --- | --- | --- | --- | --- |
| domain + contracts + config + events + tools | 34 | 640 | 0 | 0 |
| db | 37 | 729 | 27 (só com PostgreSQL real) | 0 |
| api (8 lotes) | 57 | 845 | 0 | 0 |
| workers | 3 | 30 | 5 (só com PostgreSQL real) | 0 |
| interface (ui, app-kit, web, portal, field) | 17 | 176 | 0 | 0 |
| **Total** | **148** | **2 420** | **32** | **0** |

Gates locais: typecheck, OpenAPI (`openapi:check` em dia), segredos (865 arquivos), SPEC, ESLint e Prettier nos
arquivos alterados — todos verdes.

**CI do PR [#28](https://github.com/voceconectadigital/technecaremeds/pull/28)** (run `39068863290`, commit `e973469`):

| Check | Resultado |
| --- | --- |
| Estático | ✅ |
| Testes contra PostgreSQL 16 | ✅ **78 migrations do zero** · 149 arquivos · **2 463 testes, 0 falhas** (RLS sob papel sem BYPASSRLS) |
| Ponta a ponta (Playwright) | ✅ **209 aprovados**, 1 pulo condicional que já existia (`fluxo.spec.ts`), 0 falhas |
| Cloudflare Pages | ✅ |

A primeira execução do PR falhou e foi corrigida no commit `e973469`:
- **Campo (bug real, pego pelo E2E):** a coleção `cronometros` do PF-65 nunca foi registrada em `COLECOES`, e o
  IndexedDB real recusava a transação. A coleção foi registrada, a versão subiu para 3, o adaptador em memória dos
  testes passou a recusar coleção desconhecida e um teste liga a versão à lista de coleções.
- **PostgreSQL 16 (instabilidade do teste):** oito requisições paralelas no teste de recusa do PF-14 davam
  `ECONNRESET`; passaram a ser sequenciais.

---

## 8 · Fora do alcance da engenharia (continua)

- **Anderson:** P-01 · P-02 · P-03 · P-04 · P-05 · P-06 · P-07 · P-08 · P-09 · P-10 · P-11 · P-12 · P-13 · P-14 ·
  P-15 · P-16.
- **Especialista:** incerteza, TSE, tolerância, aceitação automática.
- **Infraestrutura / autorização:**
  - transporte de e-mail;
  - destino definitivo de banco e API;
  - **migrations 0060–0077 no banco remoto e deploy do backend**, que exigem autorização explícita com destino
    comprovado;
  - troca da CSP para modo de bloqueio.
