# Relatório de publicação — Contratos e SLA (áudios do Anderson, 10/11/2026)

**Data:** 13/11/2026 (homologação concluída às 00:34 UTC de 14/11)
**Autorização:** publicação controlada pedida pelo responsável do projeto, incluindo merge, deploy e migration `0090`, condicionados às verificações de segurança.
**Classificação final:** **PUBLICAÇÃO CONCLUÍDA COM RESSALVAS** (ver §9 e §11)

---

## 1. Commit publicado

| Item | Valor |
|---|---|
| PR | voceconectadigital/technecaremeds#46 (`feat/contratos-sla-anderson-2026-11-10`) |
| Commit testado (HEAD da branch) | `6ed8ff2` |
| Merge publicado em `main` | `186c748221384bd1387f313acd73932318d697fb` (árvore idêntica a `6ed8ff2`) |
| Versão anterior em produção | `2b5af48` (PR #44), API impressão `b99006b8db42` |

## 2. CI

| Execução | Commit | Estático | PostgreSQL 16 | E2E | Gate |
|---|---|---|---|---|---|
| Referência do pedido | `d19dc2d` | ✓ | 2.919 / 2.919 | 238 ✓ | ✓ |
| Run `43496551208` (final) | `6ed8ff2` | ✓ | **2.920 / 2.920** | **238 ✓** | ✓ |

- PR em estado `CLEAN`, sem conflitos.
- O teste a mais (2.920) é o da correção `6ed8ff2`, descrita no §4.

## 3. Backup e teste de restauração

| Item | Valor |
|---|---|
| Backup novo (pré-deploy) | `700860a1-46be-42b2-911e-ca7c3d827eab` (job `b1d0de3c…`) |
| `restore_drill` | job `2309bc95…` → **verificado em 13/11/2026 16:56:39** (banco descartável, sem tocar produção) |
| Produção durante o teste | `/v1/health/ready` ok o tempo todo |
| Primeira tentativa | recusada porque o backup ainda não estava "verificado"; repetida após a verificação, OK |

**Pontos de volta registrados:**

- **API:** reimplantar `2b5af48c9c956ed1a171549e21014c8ec12826cb`, impressão `b99006b8db42`. A `0090` é aditiva e a API antiga ignora as colunas novas.
- **Web:** promover o deploy `a399b7b7` no Cloudflare Pages, ou reconstruir a partir de `2b5af48`.
- **Banco:** backup `700860a1`. Restaurar é **destrutivo** e exige nova autorização. O valor de enum `per_hour` (`ALTER TYPE … ADD VALUE`) não se remove de forma trivial; isso não é necessário para voltar a API.

## 4. Leitura de produção antes do deploy (somente leitura)

Consultas em `docs/auditoria/consultas-pre-deploy-contratos-sla.sql`: `READ ONLY` + `default_transaction_read_only=on` + `ROLLBACK`.

**Estado encontrado:**

- 89 migrations; nenhum objeto da `0090` existia.
- 1 organização; 3 contratos vigentes:
  - `fixed_monthly`, `per_call`, `per_asset`;
  - nenhum com SLA geral;
  - cobertura por local (`location_subtree`).
- 1 política de SLA; 4 clientes com política padrão; 15 ativos; **46 relógios de SLA abertos**.

**Risco encontrado e corrigido antes do merge:**

- Com o marcador novo `billing_model_informed` falso, os contratos antigos `per_call` e `per_asset` iriam aparecer como precificação "Não informada".
- Correção no código, sem alterar nenhuma linha do banco (`6ed8ff2`): a API passa a ler "informada" = marcador **OU** `billing_model <> 'fixed_monthly'`.
- Resultado: só o `fixed_monthly` antigo, que nunca foi escolhido por ninguém, sai como "não informada".
- O CI rodou de novo antes do merge.

## 5. Migration aplicada

| Item | Valor |
|---|---|
| Migration | `0090_contrato_modalidade_pagamento_sla_efetivo.sql` |
| Aplicada em | **2026-11-13 20:11:49.288924+00** (pelo `migrate` do próprio deploy) |
| Total | 90 migrations |

**Conteúdo (somente aditivo):**

- enum `billing_model` + `per_hour`;
- 4 colunas novas em `contracts`, todas nulas ou falsas por padrão;
- 3 CHECKs;
- função `smallint_array_has_no_duplicates`;
- função `resolve_sla_policy_source`.

A cascata `resolve_sla_policy`, usada pelos relógios, **não foi alterada**.

## 6. Versões publicadas

| Componente | Versão | Evidência |
|---|---|---|
| API + workers (HostPanel runtime `pgv-pe0b9asx`) | impressão **`e7e464ca30f8`**, construída em `2026-11-13T20:10:41.556Z` (job `0f5e6f31-85bc-45c5-9f15-c24632399393`) | `/v1/health/version`; `/v1/health/ready` = `{"status":"ok","checks":{"database":"ok"}}`, conferido de novo às 00:34 UTC de 14/11. Durante a troca, 20 de 20 checagens deram 200. |
| Web (`technecaremeds.voceconecta.com.br`) | deploy Cloudflare Pages **`22adacf6`**, bundle `index-Cc3bJg3w.js` | domínio servindo o bundle novo; CORS da API 204 |
| Portal | **não republicado** (sem mudança desde `2b5af48`); bundle `index-sQVP5I63.js` | 200; aponta para a API de produção |
| Campo | **não republicado** (sem mudança desde `2b5af48`); bundle `index-D8gSPyf9.js` | 200; aponta para a API de produção |

Rotas novas sem sessão respondem **401**: `contracts/options`, `PATCH contracts/:id`, `assets/:id/effective-sla`.

## 7. Dados preservados (leitura pós-deploy)

- Os 3 contratos estão iguais ao estado anterior em status, natureza, base de precificação, vigência e cobertura.
- Os campos novos estão nulos e o marcador está falso.
- Relógios de SLA abertos: **46**, o mesmo número de antes.
- `resolve_sla_policy` × `resolve_sla_policy_source` em **todos os 15 ativos**: **0 divergências** de política.
- Nenhum registro foi criado, alterado ou apagado nesta publicação, nem pela homologação.

## 8. Homologação em produção (navegador, sessão do responsável, sem gravar)

Proteção ativa na página: `window.prompt`, `window.confirm` e `window.print` neutralizados. Nenhum botão "Salvar", "Cobrir todos" ou "Ativar" foi clicado.

| Funcionalidade | Resultado | Evidência |
|---|---|---|
| Contratos dentro da ficha do cliente | ✅ | Cartão "Contratos" nos 4 clientes. Os 3 com contrato listam o contrato; o Hospital São Lucas mostra "Nenhum contrato no módulo", com o texto de que o SLA segue o padrão do cliente/organização. |
| Exibição dos contratos antigos | ✅ | Santa Clara (`fixed_monthly`): precificação "Não informada". Vida Plena (`per_asset`): "Por equipamento". Instituto do Coração (`per_call`): "Por demanda (cada acionamento)". Atendimento e Pagamento: "Não informado". SLA geral: "Não definido — vale o padrão do cliente/organização". |
| Criação nasce rascunho, sem ativação automática | ✅ (leitura do formulário) | "Novo contrato" aberto e **cancelado**: "Ativar agora (senão fica em rascunho)" vem **desmarcado**. "Cobre todos os equipamentos do cliente" vem marcado, com o aviso de que sem cobertura o contrato não pode ser ativado. |
| Modalidades de atendimento | ✅ | Não informada / Anual / Semestral / Trimestral / Mensal / Quinzenal / Semanal |
| Equipes fixas combináveis | ✅ (leitura) | 10 caixas independentes, "Equipe Fixa 1" a "Equipe Fixa 10", todas desmarcadas |
| Precificação e pagamento (só cadastro) | ✅ | Precificação: Não informada / Valor fixo mensal / Por equipamento / Por demanda / Hora técnica / Misto. Pagamento: Não informada / Mensal / À vista. Nenhum cálculo usa esses campos. |
| SLA geral no contrato | ✅ (leitura) | Opções: "Sem SLA geral — vale o padrão do cliente ou da organização" / "SLA hospitalar 24×7 — demonstração" (`GET /contracts/options` 200) |
| Edição de contrato | ✅ (leitura) | "Editar CT-2026-00003" aberto e **cancelado**. Valores atuais pré-carregados (Por demanda). Início da vigência **bloqueado** em contrato vigente (só rascunho altera); fim editável. |
| Página do contrato | ✅ | CT-2026-00003: campos novos ("Modalidade de atendimento: Não informada", "Equipe fixa: Nenhuma", "Pagamento: Não informado"); cobertura "O local e tudo que está dentro dele" com 2 ativos cobertos |
| Origem do SLA na ficha do equipamento | ✅ | Desfibrilador DF-360: "SLA hospitalar 24×7 — demonstração — **padrão do cliente**"; `GET /assets/:id/effective-sla` 200 |
| Vigência do contrato × cadastro do cliente | ✅ | Os 4 cadastros mostram "Vigência informada no cadastro: não informada". Sem aviso de divergência, como esperado com a vigência do cadastro vazia. O selo "Vigência não informada" aparece só no cliente sem contrato. |
| Regressões: OS, orçamentos, relatórios | ✅ | Lista e ficha de OS; lista e ficha de orçamento; Painel; Indicadores detalhados; Qualidade › Serviços concluídos. Tudo carrega. |
| Erros de rede e console | ✅ | 60 chamadas à API, nenhuma ≥ 400 depois do login. Os dois 401 registrados foram `/me/session` antes do login e uma consulta minha sem credencial. Nenhum erro de console após o início da captura. |
| Permissões e isolamento entre organizações | ✅ por CI | Produção tem uma só organização. A recusa de política de outra organização, a RLS e as permissões estão cobertas pelos testes de PostgreSQL 16 (16 HTTP + 15 de banco desta rodada). |

### Pendente de homologação operacional (exige gravar dados reais)

Fica para a operação, com um contrato real de rascunho ou de teste decidido pelo responsável:

- salvar um contrato novo e confirmar que fica em **rascunho**;
- ativá-lo pelo botão "Ativar";
- usar "Cobrir todos os equipamentos" e ver o efeito na lista de ativos cobertos;
- gravar modalidade, equipes combinadas (ex.: {1,10}), precificação e pagamento, e reabrir para conferir;
- definir um SLA geral no contrato e ver a origem mudar para "SLA geral do contrato";
- definir uma exceção por equipamento e ver a origem "exceção do equipamento";
- confirmar que a regra de cobertura obrigatória bloqueia ativar contrato sem cobertura.

## 9. Falhas e ressalvas

1. **Gravação não homologada em produção:** os itens do §8 que exigem gravar foram validados só pelo CI (PG16 + E2E).
2. **Botão "Cobrir todos os equipamentos"** aparece nos 3 contratos vigentes, porque a cobertura atual é por local.
   - É ação deliberada; não roda sozinho.
   - Se clicado, **amplia a cobertura** do contrato para o cliente inteiro.
   - Recomendação: avisar o usuário antes de usar nos contratos antigos.
3. **Santa Clara vence em 23/11/2026** (aviso "Vence em 9 d" na lista). Isso não é efeito desta rodada, mas a renovação é decisão comercial pendente.
4. **`/v1/health/version` devolve `commit: null`**, como antes: o HostPanel monta a imagem sem `.git`. A versão é conferida pela `impressao`.
5. **Volta do banco** não é trivial por causa do `ADD VALUE` do enum, mas não é necessária para voltar a API (ver §3).
6. **Auto-fix da PR** não pôde ser ligado: a conta ativa do `gh` é diferente da autora da PR. Sem efeito na publicação.

## 10. Decisões D-1 a D-7 (não presumidas, nada implementado além de cadastro)

Detalhe em `RELATORIO_CONTRATOS_SLA_ANDERSON_2026-11-10.md`. Seguem dependendo do Anderson:

| Decisão | Pergunta pendente |
|---|---|
| D-1 | Composição das Equipes Fixas 1…10: quem, quantos, qual papel. Hoje é só identificador. |
| D-2 | Mais de uma modalidade de atendimento no mesmo contrato? Hoje é uma. |
| D-3 | Regras da hora técnica (`per_hour`): mínimo, fracionamento, deslocamento. |
| D-4 | Vencimento e dia de pagamento. |
| D-5 | Cobrança / faturamento. Fora do escopo; não implementado. |
| D-6 | Fechamento mensal com valores. A medição mostra violações sem valorar. |
| D-7 | Qual vigência prevalece, a do cadastro do cliente ou a do contrato. Hoje as duas são mostradas, com aviso quando divergem. |

Nenhuma tarifa, cálculo financeiro, faturamento ou V2 foi implementado. A cascata de SLA homologada não mudou.

## 11. Estado final de produção

| Componente | Estado |
|---|---|
| API | `e7e464ca30f8` (merge `186c748`), ready ok |
| Banco | 90 migrations, até `0090`; dados contratuais e relógios inalterados |
| Web | Cloudflare `22adacf6` (merge `186c748`) |
| Portal e campo | inalterados, apontando para a API de produção |
| Backup de volta | `700860a1` (restore verificado) |

**Classificação: PUBLICAÇÃO CONCLUÍDA COM RESSALVAS.**

- Concluído: deploy, migration, preservação de dados e homologação por leitura, sem nenhuma falha.
- Ressalva: as funções que gravam (criar, ativar, cobrir, salvar campos novos e SLA geral/exceção) ficam **pendentes de homologação operacional** com dado real escolhido pelo responsável.
