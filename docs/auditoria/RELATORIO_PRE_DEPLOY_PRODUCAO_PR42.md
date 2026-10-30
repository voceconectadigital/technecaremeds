# Relatório pré-deploy — banco de produção (PR #42)

**Data:** 30/10/2026 · **PR #42** em `e93d8d3` e seguintes, com os cinco checks do CI verdes.
**Autorização recebida:** só consultas de leitura do `CHECKLIST_PRE_PUBLICACAO_PR42.md`, §1.

## Classificação final

**APTO PARA DEPLOY.**

As cinco verificações rodaram no banco de produção, só em leitura, e **não apontaram nenhum bloqueio**. Continua valendo o que é procedimento do deploy, e não bloqueio de verificação: um **backup novo com `restore_drill`** imediatamente antes de publicar (o último verificado é de 22/10) e a ordem do checklist (§4).

## Como as consultas foram executadas

- **Acesso:** alias SSH `apps-us-east-01`, já configurado nesta máquina e presente em `known_hosts`, que leva ao node onde roda o runtime "Téchne Care — produção" (`pgv-pe0b9asx`).
- **Contêineres no node:**
  - `hp-pgv-pe0b9asx-db-1` (postgres:16.10, healthy);
  - `-api-1` e `-workers-1`, na imagem `a852e7caccda`.
- **Conexão:** `docker exec -i … psql -U postgres -d aurora` pelo **socket local do contêiner**. Nenhuma porta foi aberta, nenhum usuário ou credencial foi criado, nenhuma variável de ambiente foi lida e nenhuma senha foi usada.
- **Só leitura, em duas camadas:**
  - `PGOPTIONS='-c default_transaction_read_only=on'` na sessão;
  - `BEGIN TRANSACTION READ ONLY … ROLLBACK` no script.
  - A saída confirmou `transaction_read_only = on`.
- **Por que não o `aurora_readonly`:** o papel é `NOLOGIN NOBYPASSRLS` (`0000_bootstrap.sql:32`). Ele não abre sessão e, sob a RLS, só enxergaria uma organização por vez. A sessão usada enxerga tudo (`ve_tudo = t`), então os zeros abaixo são reais, e não efeito de filtro.
- **Script versionado:** `docs/auditoria/consultas-pre-deploy-pr42.sql`. O comando exato está no cabeçalho dele.
- **Fora desta etapa:** nenhuma migration, merge, backup, restore, deploy, restart ou mudança de configuração.

**Panorama do banco (mesma sessão, só leitura):**

| Organizações | Regras de automação | Regras por evento | Regras ativas | Execuções (`rule_runs`) | Equipamentos | Equipamentos com tag | Última migration |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 | 15 | 0 | `0083_pedidos_da_store.sql` (84 registros) |

## Resultado das cinco verificações

| # | Verificação | Registros | Resultado |
|---|---|---|---|
| 1 | Automações por evento ativas | **0** | Nenhuma regra vai começar a disparar com o deploy |
| 2 | Duplicidades em `rule_runs` (0088) | **0** (e 0 execuções com evento) | A migration 0088 não tem como falhar. Bate com a análise do código: a função que grava `event_id` nunca foi chamada em produção |
| 3 | Tags repetidas (0089) | **0** (nenhum dos 15 equipamentos tem tag) | Nenhum equipamento vai ser marcado como duplicado. A regra nova vale para os cadastros futuros |
| 4 | Organizações em modo hospital | **0**: a única, "TéchneCare Demo", é `service_provider` sem recursos customizados, com 3 orçamentos | O orçamento **continua** disponível; nada muda para ela |
| 5 | Regras que mudam a situação da OS | **0** | Nenhuma automação vai falhar pela falta do parecer |

## Impactos da publicação

- **Parecer LIBERADO/PARADO obrigatório** para concluir OS de equipamento, na web e no app de campo:
  - é mudança de uso, então avise os técnicos;
  - o app de campo troca de versão sozinho na próxima abertura com rede;
  - uma conclusão que estava na fila offline da versão antiga volta com 422 e cai em "Atenção" para reenviar com o parecer.
- **Foto obrigatória ao criar equipamento novo e tag única.** Os 15 equipamentos atuais não são afetados: a foto vale só para criação, e nenhum deles tem tag.
- **Automações por evento** passam a ser entregues pelo worker. Hoje não há nenhuma regra, então não há disparo inesperado.
- **Migrations 0084, 0085, 0087, 0088 e 0089** sem volta automática: voltar o banco é restaurar o backup.

## Bloqueios reais identificados

**Nenhum.**

## Correções necessárias antes do deploy

Nenhuma correção de dado ou de configuração. Ficam só os passos do procedimento, todos dependentes da sua autorização:
1. Backup novo do PostgreSQL de produção + `restore_drill` verificado, imediatamente antes.
2. Merge da PR #42.
3. Deploy da API + workers no HostPanel (as migrations rodam no deploy).
4. Conferir `/v1/health/version` e `/v1/health/ready`.
5. Web, portal e campo pelo wrangler.
6. Teste rápido em produção (checklist §4, passo 7).

## Riscos considerados aceitáveis

| Risco | Justificativa |
|---|---|
| Conclusão na fila offline do app de campo sem parecer | O servidor recusa com mensagem clara e o técnico reenvia; não há perda de dado. O app atualiza sozinho com rede |
| Migrations sem volta automática | É o padrão do projeto; o backup verificado imediatamente antes é a volta |
| Pendências de Anderson (fórmulas P-01…P-16, campos com aprovação, indicadores do financeiro, retenção da geolocalização, confirmação "hospital sem orçamento") e provedor de e-mail | Não impedem operar: o sistema mostra "pendente" ou "provisório" e entrega na caixa de entrada. A organização de produção é prestadora, então a regra "hospital sem orçamento" não a afeta |

Nada foi publicado. A etapa de produção aguarda a sua autorização expressa.
