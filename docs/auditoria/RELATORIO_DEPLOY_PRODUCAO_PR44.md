# Relatório de deploy em produção — PR #44 (ajustes de Anderson, 06/11/2026)

**Data:** 09/11/2026, madrugada (horário de Brasília) · **Autorização:** expressa do responsável pelo projeto,
nesta conversa ("Autorizo o merge e o deploy da PR #44 para o piloto do Téchne Care").

**Classificação: PUBLICAÇÃO CONCLUÍDA E HOMOLOGADA, COM RESSALVAS.**

- **No ar:** API (com workers) e front web da PR #44. Sem migration. Portal e app de campo não foram tocados.
- **Homologado com login de administrador:**
  - impressão das 25 OS de produção, incluindo calibração e TSE;
  - espelho na aba "Serviços concluídos";
  - configuração de uma e de duas logomarcas, desfeita no fim.
- **Ressalvas:** §7.

## 1. Pré-verificação

| Item | Resultado |
|---|---|
| Head da PR | `eac9902d126fbf9707f3e406d7cffcc6f8056a2d` |
| CI do head | Estático, Testes contra PostgreSQL 16, Ponta a ponta e Gate verdes; antes, no código das logomarcas (`41f5984`), PG16 2.878/2.878 e E2E 238 + 1 pulado |
| Conflitos | nenhum (`mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`) |
| `main` antes | `2541c65`, a mesma versão de produção (impressão `f07e34c33070`) |
| Migrations na PR | **nenhuma** (a última segue `0089`, já aplicada em 30/10) |
| Portal, campo e workers | nenhum arquivo alterado em `apps/portal`, `apps/field` e `apps/workers` |

## 2. Backup e teste de restauração (antes de qualquer mudança)

| Item | Valor |
|---|---|
| Backup | `f609a095-b8d2-4a43-ac7b-8a811f65a293` (job `84ee5bbf-dad0-4846-a248-172808f666dc`) |
| restore_drill | job `e22eda1d-d74c-4786-9ec6-6da01a9dfe65`, sobre **este** backup; o painel passou a mostrar "Backup verificado: 08/11/2026, 23:56:24" |
| Produção depois do teste | intacta: `/v1/health/ready` ok, mesma versão |

Antes de rodar o teste, conferi no código do HostPanel (`components/pgvps/ApplicationsConsole.tsx`, linhas
145–151) que `restore_drill` só pede o id do backup. A confirmação por digitação do slug é exclusiva de
`restore` e `destroy`, e a automação foi configurada para recusá-la.

**Pontos de volta:**

| Componente | Como voltar |
|---|---|
| API e workers | novo deploy do ref `2541c6546d93a457a32075c9a2decfbbfba2851a` (impressão `f07e34c33070`) |
| Front web | deploy Cloudflare `f607839c-f69c-4931-a451-da55a2f8506a`, ou rebuild de `2541c65` + `wrangler pages deploy` |
| Banco | restaurar o backup `f609a095` pelo HostPanel. Apaga o que foi gravado depois do deploy: **só com decisão explícita** |

## 3. Merge

- PR #44 mergeada com merge commit, travada no head verificado (`--match-head-commit eac9902`).
- **Commit publicado:** `2b5af48c9c956ed1a171549e21014c8ec12826cb`. A árvore é idêntica à de `eac9902`: `git diff` vazio.

## 4. API

- **Deploy:** HostPanel, runtime "Téchne Care — produção" (`pgv-pe0b9asx`, node `apps-us-east-01`), ação `deploy`,
  ref `2b5af48…`, job `d3593dda-546e-4d95-afd7-afec3a0e1a34`.
- **Build:** o runtime ficou em "provisioning" por cerca de 6 minutos. A versão anterior continuou no ar o tempo todo.
- **`GET /v1/health/version`:** `impressao b99006b8db42`, construída em 09/11/2026 03:01:34 UTC. É igual a `npm run versao` no commit do merge.
- **`GET /v1/health/ready`:** `{"status":"ok","checks":{"database":"ok"}}`.
- **Migrations:** nenhuma nova. O manifesto é o mesmo de 30/10 (até `0089`).
- **Rotas novas:** sem sessão, `/v1/organizations/current/logos` e `/v1/quality-records/services` respondem 401. Com sessão, 200 (§6).

## 5. Front web

| Projeto | Deploy | Domínio | Bundle servido | API |
|---|---|---|---|---|
| technecare-web | `a399b7b7` (commit `2b5af48`) | technecaremeds.voceconecta.com.br | `index-2QuHmYVA.js` (o build publicado) | `https://api-technecaremeds.voceconecta.com.br/v1`; CORS 204 |

- **Build:** `VITE_API_URL=https://api-technecaremeds.voceconecta.com.br/v1`. Nenhum endereço de preview ou de
  desenvolvimento entrou no bundle. A única ocorrência de "localhost" é o valor de reserva interno do roteador (biblioteca).
- **Portal (`portal-…`) e campo (`campo-…`):** **não foram republicados.** Continuam nos deploys de 30/10 e respondem 200.

## 6. Homologação em produção (com login)

**Sessão:** web, usuário "Demo Anderson", administrador da organização "TéchneCare Demo", logado pelo responsável.

**Método:**
- Tudo pela tela, sem ler nem usar o token da sessão.
- A impressão do navegador (`window.print`) foi neutralizada só na aba automatizada, porque o diálogo a trava. O
  sistema chamou a impressão em todas as folhas abertas.

### 6.1 Impressão de OS

| Verificação | Resultado |
|---|---|
| Botão "Imprimir" na lista | **25 de 25** OS, um por linha |
| Folha aberta e impressão chamada | **25 de 25**, sem falha |
| Naturezas impressas | preventiva (10), corretiva (10), **calibração (4)**, **teste de segurança elétrica (1)** |
| Situações cobertas | Aberta, Agendada, Em execução, Aguardando, Concluída, Fechada |
| TSE `WO-2026-0006` | cabeçalho com a organização, faixa Situação/Tipo/Prioridade, seções numeradas; "Solicitação de origem: Não se aplica" (abertura manual); campos vazios como "Não informado" |
| Calibração `WO-2026-0024` | mesma estrutura, sem erro |
| Seções condicionais | checklist, check-in, parecer, avaliação e assinaturas só saem quando a OS tem o dado (ex.: a corretiva concluída `WO-2026-0021` traz parecer, avaliação e assinaturas) |
| Leituras de medição | **não verificáveis em produção:** nenhuma OS de calibração ou TSE tem medição registrada (todas abertas ou agendadas). Coberto pelos testes de tela e pelo CI. Gerar uma medição seria criar registro fictício |

### 6.2 Qualidade → "Serviços concluídos"

| Verificação | Resultado |
|---|---|
| Aba presente, com o aviso "Não é certificado: nada é emitido nem assinado automaticamente" | sim |
| OS listadas | **`WO-2026-0011`** (preventiva, Concluída) e **`WO-2026-0014`** (preventiva, Fechada). São exatamente as OS concluídas das naturezas autorizadas |
| OS que ficaram de fora, como esperado | 4 corretivas concluídas ou fechadas (`0021`, `0004`, `0012`, `0013`); calibrações e TSE ainda não concluídas |
| Detalhes do cartão | cliente, setor, equipamento e série; "Sem plano de origem (OS avulsa)"; links "Abrir OS" e "Relatório" |
| Gravação | nenhuma; a aba é consulta |

### 6.3 Permissões e isolamento

| Verificação | Resultado |
|---|---|
| Sem sessão | rotas novas respondem 401 |
| Administrador | vê e altera as logomarcas; vê "Serviços concluídos" |
| Outros perfis em produção | **não exercitados:** só havia a sessão do administrador. O técnico lê logomarcas sem alterá-las (403) e quem só lê documentos recebe 403 em "Serviços concluídos": coberto pelos testes de API no PostgreSQL 16 do CI |
| Isolamento entre organizações | **não exercitável em produção:** existe uma única organização, e criar outra seria registro fictício. Coberto pelos testes de API (logomarcas e serviços) e pelo E2E `logomarcas.spec.ts` no CI |

### 6.4 Logomarcas (uma e duas)

Foi usada a própria marca do Téchne Care, versões clara e escura (os mesmos arquivos de `marca.config.json`
servidos pelo site). Nenhuma imagem fictícia foi enviada, e a organização não tinha logomarca real a substituir.

| Passo | Resultado |
|---|---|
| Estado inicial | 0 logomarcas; a tela mostra as duas vagas vazias, com controles para o administrador |
| Uma logomarca (vaga 1, "Téchne Care") | salva (200); prévia 385×148. Folha da calibração `WO-2026-0024`: só a logomarca da organização no cabeçalho, em 145×55 px (proporção preservada); a marca do produto sai; "Emitido pelo sistema Téchne Care" continua |
| Duas logomarcas (vaga 2, "Téchne Care (versão escura)") | salva. Folha do TSE `WO-2026-0006`: as duas na ordem das vagas, 145×55 px cada, separadas por um fio |
| Remoção das duas | feita; as vagas voltaram a "Nenhuma logomarca nesta vaga" |
| Folha depois da remoção | volta a mostrar a marca do produto |
| Erros | nenhuma chamada HTTP ≥ 400 e nenhum erro de console durante toda a homologação |

**Estado final:** a organização está **sem logomarca**, como antes. O cliente envia as marcas reais em
Configurações → Logomarcas.

### 6.5 Dados preservados

- **Gravações:** nenhum registro de negócio foi criado, alterado ou apagado. As únicas gravações foram as do teste
  de logomarcas (enviar e remover), que deixaram `organizations.settings.logos` vazio e apagaram os arquivos no
  armazenamento.
- **Contagens:** a lista continua com 25 OS, e a Qualidade mantém os registros que já tinha.
- **Banco:** não foi lido diretamente nesta publicação (exige autorização a cada uso).

## 7. Ressalvas e pendências

### Ressalvas comerciais (registradas, sem ampliação iniciada)

1. **Logomarca por hospital/cliente:** as duas logomarcas são da organização logada e saem em todas as OS dela.
   - Uma marca escolhida pelo cliente da OS é ampliação a contratar.
   - A coluna `customers.logo_key` existe desde a migration 0008, mas não há tela nem regra de precedência.
2. **Dados empresariais completos na impressão:** o cabeçalho traz o nome da organização e as logomarcas, mas não
   CNPJ, endereço, telefone e responsável técnico.
   - Esses dados não estão no contrato da sessão.
   - Incluí-los exige definir a origem autorizada (cadastro da organização) e é ampliação a decidir.

### Não verificado em produção

| Item | Motivo | Cobertura |
|---|---|---|
| Leituras de calibração e TSE na folha | nenhuma medição registrada em produção | testes de tela e CI |
| Perfis diferentes do administrador | só havia a sessão do administrador | testes de API no PG16 (CI) |
| Isolamento entre organizações | uma única organização em produção | testes de API e E2E (CI) |

### Dependem de Anderson

- impressão em lote;
- relatório no portal do cliente;
- certificado emitido pelo sistema;
- perguntas do Anexo F, incluindo D-1 e D-2.

### Operação

Enviar as logomarcas reais em Configurações → Logomarcas (administrador da organização).

## 8. Estado final da produção

| Componente | Versão | Estado |
|---|---|---|
| API | `2b5af48` · impressão `b99006b8db42` | no ar, `ready ok` |
| Workers | `2b5af48` (mesma imagem) | no ar |
| PostgreSQL | 16, migrations até `0089` | dados preservados; backup verificado `f609a095` |
| Web | `2b5af48` (deploy `a399b7b7`) | no ar, apontando para a API de produção |
| Portal e campo | `2541c65` (deploys de 30/10) | inalterados, no ar |

## 9. Ocorrências

- **Build da API:** demorou cerca de 6 minutos ("provisioning"), contra cerca de 2,5 minutos em 30/10. Não houve queda:
  a versão anterior serviu até a troca.
- **Navegador automatizado:** a captura de tela falhou algumas vezes por tempo esgotado; a leitura foi feita pelo texto da página.
- **Falhas críticas:** nenhuma. Nenhuma recuperação foi necessária.
