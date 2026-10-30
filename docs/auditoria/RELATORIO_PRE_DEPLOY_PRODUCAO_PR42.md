# Relatório pré-deploy — banco de produção (PR #42)

**Data:** 30/10/2026 · **PR #42** em `e93d8d3`, com os cinco checks do CI verdes.
**Autorização recebida:** só consultas de leitura do `CHECKLIST_PRE_PUBLICACAO_PR42.md`, §1.
**O que foi feito em produção:**
- Leitura de páginas e de rotas GET.
- Nenhum INSERT, UPDATE, DELETE, ALTER, migration, deploy, restart nem ação do painel.
- Nenhuma credencial digitada, lida ou exposta.

## Resumo

**BLOQUEADO PARA DEPLOY — por falta de verificação, não por defeito encontrado.**

Das cinco verificações, **uma foi resolvida** (a 2, pelo código que roda em produção). **As outras quatro não puderam ser executadas** com os acessos já configurados, e duas delas (1 e 4) são exatamente as que o checklist marca como bloqueio real em potencial. Sem os números, o deploy não deve seguir.

## Como se tentou acessar (evidências)

| Caminho | Resultado |
|---|---|
| `aurora_readonly` direto no PostgreSQL | **Indisponível.** Por `aurora.destinos.json`, o banco de produção só existe na rede interna do runtime do HostPanel (serviço `db`, sem porta pública). Nenhuma `DATABASE_URL` de produção está configurada nesta máquina, e criar uma seria abrir acesso novo |
| HostPanel → Sistemas → "Téchne Care — produção" | Sessão ativa. O runtime aparece como **running**, commit **`a852e7c`**, backup verificado em **22/10/2026 12:34**. As ações disponíveis são health, restart, stop, start, deploy, backup, restore_drill, restore e destroy: **não há console SQL** nem rota de leitura do banco. Nenhuma ação foi clicada |
| Leitura adicional no painel | **Recusada pelo classificador de segurança** (risco de expor credenciais ao ler a configuração do runtime). Não insisti nem contornei |
| API da aplicação em produção (GETs com a sua sessão) | A sessão do app **expirou**: a tela pede login, e eu não digito senha |
| Rotas públicas | `GET /v1/health/version`: `impressao 5a807018a66a`, construída em 23/10/2026 01:39 (é a versão publicada em 22/10, PR #41). `GET /v1/health/ready`: `{"status":"ok","checks":{"database":"ok"}}` |

## As cinco verificações

### 1. Automações por evento ativas — NÃO EXECUTADA (sem acesso)
- **Quantidade:** desconhecida.
- **O que o código de produção (`a852e7c`) garante:**
  - nenhuma regra é criada pelo provisionamento; só existe regra que alguém criou pela tela "Nova automação";
  - **nenhuma regra por evento jamais rodou em produção** (ver 2), então qualquer regra ativa hoje está "calada" e começa a agir depois do deploy.
- **Impacto possível:** avisos e ações em massa no primeiro dia. Exemplos: "OS aguardando peça → avisar compras", mudança de situação e criação de OS. Cada regra tem limite de taxa e quarentena automática, e cada evento roda uma única vez (0088), o que limita o estrago, mas não o evita.

### 2. Duplicidades em `rule_runs` (migration 0088) — RESOLVIDA PELO CÓDIGO: 0 possível
- **Quantidade:** **zero**, por construção.
- **Evidência:**
  - Em `a852e7c`, o único `INSERT` que grava `event_id` em `rule_runs` está em `runAutomations` (`packages/db/src/automations.ts:439`), e essa função **não tem chamada fora dos testes**.
  - Conferi também o histórico de `apps/api` e `apps/workers`: nenhuma versão a chamou.
  - Os outros dois `INSERT` (OS criada por automação, linha 548; relatório agendado, linha 709) não preenchem `event_id`.
  - O índice da 0088 vale só para `event_id IS NOT NULL`, portanto **não há linha que possa colidir**.
- **Ressalva:** a prova é pelo código. Dado inserido à mão por fora da aplicação não estaria coberto. Se houver acesso ao banco, a consulta 1.2 confirma em segundos.

### 3. Tags repetidas (migration 0089) — NÃO EXECUTADA (sem acesso)
- **Quantidade:** desconhecida.
- **Não bloqueia:** a 0089 **não falha** com tags repetidas. Ela marca os equipamentos mais novos de cada grupo (`tag_legacy_duplicate`) e os deixa fora do índice único, sem renomear nem apagar nada; a suíte e o CI testam esse caminho.
- **Impacto:** esses equipamentos continuam editáveis; ao trocar a tag, a marcação cai. O número só serve para saber quantos alguém vai corrigir depois.

### 4. Organizações em modo hospital (perda do orçamento) — NÃO EXECUTADA (sem acesso)
- **Quantidade:** desconhecida.
- **O que o código garante:** o modo padrão de toda organização é `service_provider` (`0049_modo_da_organizacao.sql:27`), e prestadora **não muda nada**. Só é afetada a organização que alguém tenha passado para `hospital` (rota `PATCH` de organização) **sem** recursos customizados.
- **Impacto, se existir alguma:** "Gerar orçamento" e as etapas de orçamento somem para ela e a API recusa criar orçamento. **Nenhum orçamento existente é apagado**, mas o fluxo para.

### 5. Automações que concluem OS (parecer obrigatório) — NÃO EXECUTADA (sem acesso)
- **Quantidade:** desconhecida.
- **O que o código garante:** a ação que conclui OS por automação é `change_status`. Como as regras por evento nunca rodaram (ver 2), nenhuma conclusão automática aconteceu até hoje.
- **Impacto, se existir alguma:** depois do deploy, uma regra que conclua OS **de equipamento** recebe 422 (falta o parecer). O erro fica registrado no log da regra. A OS não é concluída, mas também não se corrompe.

## Impactos da publicação (independentes das consultas)
- Parecer LIBERADO/PARADO obrigatório para concluir OS de equipamento, na tela e no app de campo.
- App de campo: troca de versão sozinho na próxima abertura com rede. Uma conclusão que já estava na fila offline da versão antiga volta com 422 e cai em "Atenção".
- Automações por evento passam a rodar (o item 1 diz quantas).
- Migrations 0084, 0085, 0087, 0088 e 0089 sem volta automática: voltar o banco é restaurar o backup.

## Bloqueios reais identificados
1. **As verificações 1 e 4 não foram feitas.** Ambas podem esconder problema de produção no dia do deploy.
2. **O backup verificado é de 22/10, anterior a esta publicação.** O checklist exige um backup novo e o `restore_drill` imediatamente antes do deploy.

Nenhum defeito foi encontrado. A 0088 não tem como falhar, pelo código, e a 0089 é segura com tags repetidas.

## Correções necessárias antes do deploy (nada foi feito)
1. **Destravar a leitura.** Escolha um caminho:
   - **a) Mais simples:** você entra no app de produção (`technecaremeds.voceconecta.com.br`) no Chrome. Com a sua sessão, eu leio só por GET:
     - `GET /v1/automations` (verificações 1 e 5: regras, gatilho, situação e ações);
     - `GET /v1/organizations/current/configuration` (verificação 4: modo e recursos);
     - `GET /v1/assets` (verificação 3: tags, com o agrupamento normalizado feito aqui).
     A limitação é que isso só alcança as organizações em que você tem vínculo. A verificação 2 já está resolvida.
   - **b) Completo:** você roda as consultas do checklist (§1) no console do node do HostPanel, dentro do runtime, como `aurora_readonly` numa transação `READ ONLY`, e me passa a saída.
2. **Se a verificação 1 listar regras que não devem disparar:** pausá-las antes do deploy.
3. **Se a verificação 4 listar organização hospital que usa orçamento:** ligar o recurso `quotes` nela antes do deploy.
4. **Se a verificação 5 listar regra que conclui OS de equipamento:** ajustar a regra ou desligar `require_operational_result` nessa organização.
5. Backup novo + `restore_drill`, imediatamente antes do deploy.

## Riscos considerados aceitáveis
| Risco | Por que é aceitável |
|---|---|
| Tags repetidas antigas (verificação 3) | A migration não falha nem apaga; a correção é manual e pode vir depois |
| Fila offline do app de campo com conclusão sem parecer | O servidor recusa com mensagem clara e o técnico reenvia; não há perda de dado |
| Regra que conclui OS recebendo 422 (verificação 5) | A falha fica no log da regra e não altera a OS; é corrigível depois, se não for tratada antes |
| Pendências de Anderson (fórmulas, campos com aprovação, financeiro, retenção) e e-mail | O sistema mostra "pendente" ou "provisório" e entrega na caixa de entrada; não impedem operar |

## Classificação final

**BLOQUEADO PARA DEPLOY.**

O motivo é não ter sido possível verificar as automações ativas (1) nem as organizações em modo hospital (4) com o acesso configurado. Não foi encontrado defeito no código, que está verde no CI, nem risco nas migrations 0088 e 0089.

Para virar **APTO**, basta uma das duas opções do passo 1 (sessão no app ou consultas no console do runtime), seguida dos ajustes que os resultados pedirem e do backup novo. Nada foi publicado. Aguardo a sua autorização expressa para a etapa de produção.
