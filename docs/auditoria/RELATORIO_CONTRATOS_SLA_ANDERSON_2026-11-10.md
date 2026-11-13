# Contratos, SLA e cobrança — áudios do Anderson (10/11/2026)

**Branch:** `feat/contratos-sla-anderson-2026-11-10`, sobre `main` `3d92cdc`.
**Sem merge e sem deploy.** A migration `0090` **não foi aplicada em banco remoto**.

**Fontes:**
- `TRANSCRICAO_E_REQUISITOS_CONTRATOS_ANDERSON_2026-11-10.md`;
- `REQUISITOS_ANDERSON_CONTRATOS_2026-11-10.json`. Status por item: `REQUISITOS_ANDERSON_CONTRATOS_2026-11-10.json`, nesta pasta.

**Regra seguida:**
- reaproveitar o módulo de contratos que já existia;
- separar os três conceitos de cobrança;
- não criar efeito financeiro.

## 1. Diagnóstico — o que já existia

| Peça | Estado antes desta rodada | Evidência |
|---|---|---|
| Contrato vinculado ao cliente | **existia na API e no banco**; o web só **consultava** (sem criar nem editar) | `aurora.contracts.customer_id` (0031), `POST /contracts`, `comercial/contratos.tsx` |
| Vigência no cadastro do cliente | existia como dado simples, sem ligação com o módulo | `customers.contract_starts_on/ends_on` (0085, CLI-06), `clientes/contrato.tsx` |
| SLA geral do contrato | **existia**: degrau da cascata, abaixo do equipamento e acima do cliente | `contracts.sla_policy_id`, `resolve_sla_policy` (0031 → 0085) |
| SLA por equipamento (exceção) | **existia**, opcional, com opção de desligar | `assets.sla_policy_id`, `assets.sla_enabled` (0085, ATV-15) |
| Origem do SLA na tela | **faltava**: a ficha do equipamento dizia só "Habilitado · herdado" | `ativos/ficha.tsx` |
| Modalidade de atendimento / equipe fixa | **faltava** | — |
| Base de precificação | parcial: `billing_model` (`fixed_monthly`, `per_asset`, `per_call`, `hybrid`), sem hora técnica | 0031 |
| Condição de pagamento | **faltava** | — |
| Edição de contrato | **faltava** (só ativar e encerrar) | `contracts.controller.ts` |
| Contrato vencido ou encerrado | já saía da cascata (`status = 'active'` e datas em `contract_for_asset`) | 0031 |

## 2. Matriz pedido → resultado

| ID | Pedido | Classificação | O que foi feito / por quê |
|---|---|---|---|
| CTR-01 | Contrato no cadastro do cliente, editável | **lacuna corrigida** | Cartão "Contratos" na ficha do cliente: lista os contratos do módulo; criar (já cobrindo todos os equipamentos e, se marcado, vigente) e editar. É o mesmo `aurora.contracts`, sem cadastro paralelo. A vigência do cadastro (CLI-06) vem preenchida no contrato novo. |
| CTR-02 | Anual, semestral, trimestral, mensal, quinzenal e semanal | **lacuna corrigida** | `contracts.service_frequency`, nulo = não informada. **Uma por contrato** (ver D-2). |
| CTR-03 | Equipe Fixa 1…10, combinável | **corrigido como identificador; composição depende de definição** | `contracts.fixed_team_packages` (ex.: `{1,10}`). Nenhuma quantidade de profissionais é inferida do número. |
| CTR-04 | SLA geral no contrato | **já existia; faltava a tela** | Campo "SLA geral do contrato" no formulário; nome e alcance ("todos os equipamentos") na lista e na ficha do contrato. |
| CTR-05 | SLA por equipamento opcional, substitui o geral | **já existia; faltava a origem** | `resolve_sla_policy_source` (0090) e `GET /v1/assets/:id/effective-sla`. A ficha do equipamento diz "SLA geral do contrato CT-…" ou "exceção deste equipamento". Na ficha do contrato, os equipamentos com exceção aparecem marcados. |
| CTR-06 | Não criar obrigação não contratada | **validado** | Nada exige SLA individual. A OS abre **um** relógio por tipo (atendimento e resolução), com a política efetiva. SLA desligado não abre relógio. Contrato sem SLA, vencido ou encerrado devolve a regra antiga. Coberto por testes (§4). |
| CTR-07 | Modalidade ≠ cobrança | **corrigido** | São campos distintos e aparecem em linhas distintas. |
| CTR-08 | Cobrança ≠ pagamento | **corrigido** | `contracts.payment_terms`: mensal ou à vista; nulo = não informada. |
| CTR-09 | Hora técnica por natureza (preventiva, corretiva, calibração, treinamento) | **dependência / ampliação** | O contrato já tem `overage_hour_rate` (uma tarifa) e `contract_services` (natureza incluída ou faturada à parte). Tarifa por natureza **não foi criada**: faltam as categorias, os valores, a vigência da tabela e os eventos de início e fim das horas faturáveis. |
| CTR-10 | Tarifas alimentando o orçamento | **ampliação** | Depende do CTR-09. O orçamento não foi alterado. |
| CTR-11 | Horas por tipo no relatório mensal | **dependência** | A medição do período já existe (`measurePeriod`: OS, horas, franquia). Apuração com valor por natureza depende das regras do CTR-09 e de decidir se o relatório é consultivo ou faturável. |
| CTR-12 | Cobrança por demanda e fixa mensal | **cadastro feito; efeito é ampliação** | `billing_model` com `per_call`, `fixed_monthly` e o novo `per_hour`. Nada é cobrado automaticamente. |
| CTR-13 | Não implementar faturamento agora | **respeitado** | Sem fatura, boleto, nota, conciliação ou glosa nova. |

## 3. O que mudou

**Banco — migration `0090`, só aditiva:**
- `billing_model` ganhou `per_hour`;
- colunas novas e nulas em `contracts`: `service_frequency`, `fixed_team_packages`, `payment_terms`, com `CHECK`;
- função de leitura `resolve_sla_policy_source`. A cascata dos relógios (`resolve_sla_policy`) **não mudou**.

**Dados:** `createContract` grava os campos novos; `updateContract` é novo; `effectiveSlaForAsset` é novo.

**Regras de edição:**
- contrato encerrado ou expirado não se edita (409);
- o início da vigência só muda em rascunho;
- mudar a vigência refaz a verificação de "um equipamento em um contrato por vez".

**API:**
- `PATCH /v1/contracts/:id`;
- `GET /v1/contracts/options`;
- `GET /v1/assets/:id/effective-sla`;
- `POST /v1/contracts` aceita `serviceFrequency`, `fixedTeamPackages`, `paymentTerms`, `coverAllAssets` e `activate`;
- a lista e a ficha do contrato trazem o SLA geral e os campos novos;
- `contracts/:id/assets` marca exceção e SLA desligado;
- a política de SLA de outra organização é recusada (422).

**Contratos zod:** `contracts.create`, `contracts.update`, `contracts.options` e `assets.effectiveSla`. O `openapi.json` foi regenerado.

**Web:**
- `clientes/contratos-do-cliente.tsx` (cartão e diálogo de criar e editar);
- `comercial/rotulos-contrato.ts`;
- ficha do contrato: campos novos, botão Editar e marcação de exceção;
- ficha do equipamento: origem do SLA.

**Permissões:** são as que já existiam. Ler exige `contract.read`; criar exige `contract.create`; editar exige `contract.update`. Valores financeiros continuam atrás de `contract.read_financials`.

## 4. Testes executados nesta máquina

| Suíte | Resultado |
|---|---|
| `packages/db/.../contrato-cadastro-sla.test.ts` (PGlite, PostgreSQL real em processo) | **13/13** |
| `apps/api/.../api-contratos-cadastro-sla.test.ts` (HTTP + PGlite) | **9/9** |
| `apps/api/.../paridade-contratos.test.ts` (listas do domínio × zod) | **5/5** |
| `apps/web/.../contratos-do-cliente.test.tsx` | **5/5** |
| Contratos, SLA, migrations e upgrade de migrations já existentes (em série) | **67/67** |
| `tsc -b` (monorepo inteiro), `eslint` nos arquivos alterados | sem erro |
| Suíte completa e CI (PG16 + E2E) | ver §7 |

**O que os testes cobrem:**
- contrato antigo continua igual, com campos nulos e `fixed_monthly`;
- SLA geral × exceção × sem exceção;
- contrato sem SLA preenchido;
- SLA desligado, sem relógio;
- um relógio por tipo na OS;
- troca de SLA geral: o relógio aberto mantém a política dele;
- vencimento pela data e volta à vigência;
- encerramento: não edita mais;
- início só em rascunho;
- permissões: técnico 403 para criar e editar;
- isolamento: a outra organização não lista, não lê, não edita e não resolve o SLA;
- política de SLA de outra organização recusada.

**Orçamento e OS:** nenhum arquivo de orçamento ou de OS foi alterado. A regressão depende da suíte completa e do CI.

## 5. Decisões pendentes do Anderson

1. **D-1, Equipe Fixa 1…10:** o que cada número significa (pacote, posto, composição) e como calcular a combinação. Hoje é só identificador.
2. **D-2, modalidades simultâneas:** o contrato pode ter mais de uma periodicidade ao mesmo tempo? Hoje é uma. Também falta confirmar o rótulo ("reincidência" × periodicidade).
3. **D-3, hora técnica:**
   - quais categorias e com que valores;
   - vigência da tabela;
   - o que marca o início e o fim das horas faturáveis.
4. **D-4, contrato vencido ou suspenso:** hoje o SLA geral e a regra por criticidade deixam de valer e volta o padrão do cliente ou da organização. A exceção configurada no equipamento continua valendo, porque pertence ao equipamento. Confirmar se é isso.
5. **D-5, cobrança:** quais modelos de cobrança e pagamento são só cadastro e quais devem produzir efeito.
6. **D-6, fechamento mensal:** é apuração consultiva ou tem consequência de cobrança?
7. **D-7, duas vigências:** a vigência do cadastro do cliente (CLI-06) e a do contrato podem divergir. O formulário reaproveita a primeira, mas não as sincroniza. Decidir se a do cliente passa a vir do contrato vigente.

## 6. Riscos

- **Migration 0090:**
  - não aplicada em produção;
  - `ADD VALUE` em enum não se desfaz com simplicidade (o valor fica);
  - a publicação exige backup, autorização e a ordem API → front.
- **Rótulo dos contratos antigos:** o `billing_model` nunca foi opcional (padrão `fixed_monthly`). Um contrato antigo aparece como "Valor fixo mensal" mesmo que ninguém tenha escolhido.
- **Cobertura pela tela:** é sempre "todos os equipamentos do cliente". Cobertura por setor, categoria ou equipamento continua só pela API. Para excluir um equipamento do SLA, desliga-se o SLA dele.
- **Troca do SLA geral:** vale para OS e solicitações novas; relógios abertos mantêm a política anterior, e isso é intencional.

## 7. Suíte completa, CI e orçamento

- **Suíte completa local e CI:** os números entram na PR depois da execução. Nada aqui é dado como aprovado sem rodar.
- **Orçamento separado:** CTR-03 (composição de equipes), CTR-09 a CTR-11 (tarifas por natureza, orçamento e apuração) e qualquer efeito financeiro são ampliação. Preço e prazo só depois das decisões D-1, D-3, D-5 e D-6. Nenhum valor foi estimado aqui.
