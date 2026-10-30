# Relatório de deploy em produção — PR #42 (rodada Anderson)

**Data:** 30/10/2026 · **Autorização:** expressa do responsável pelo projeto, nesta conversa.

**Classificação: PUBLICAÇÃO CONCLUÍDA COM RESSALVAS.**
- **Publicado e validado:**
  - tecnicamente: API, workers, migrations e os três frontends;
  - com login no web, como administrador da organização: OS, planos, orçamentos, Store, relatórios PDF/Excel, cadastros e Ferramentas (§6).
- **Ressalvas** (§6-B):
  - portal e app de campo sem sessão, logo sem teste de sincronização;
  - só o perfil administrador exercitado em produção;
  - conclusão real de OS com parecer não feita, de propósito, para não gravar dado fictício.

## 1. Commit publicado e merge
- **PR #42:** mergeada na `main` com merge commit, travada no head verificado `a26c0b6`.
- **Commit publicado:** `2541c6546d93a457a32075c9a2decfbbfba2851a`. Árvore idêntica à de `a26c0b6`: `git diff` vazio.
- **CI do head `a26c0b6`** (run 41055556092): Estático, PostgreSQL 16, Ponta a ponta e Gate verdes.
- **CI da `main` em `2541c65`** (run 41056949179): verde.

## 2. Backup e restore_drill (antes de qualquer mudança)
| Item | Valor |
|---|---|
| Backup | `825569fa-0971-45be-972b-733ee39e93a0` (job `1711b228-3e72-472e-a6fe-3839afdbf513`) |
| Horário | 30/10/2026 09:36:29 (Brasília) = 13:36:29 CET no node |
| Arquivo | `/opt/hostpanel/apps/pgv-pe0b9asx/backups/825569fa-….tar.enc`, 3,06 MB, cifrado |
| restore_drill | job `8304de93-9d90-43ad-a91f-2c9adc6d56c5`, sobre **este** backup; o painel passou a mostrar "Backup verificado: 30/10/2026 09:36:31" |
| Produção depois do drill | intacta (`/v1/health/ready` ok; contêineres inalterados) |

**Pontos de volta registrados:**
- API e workers: `a852e7c`, impressão `5a807018a66a`.
- Frontends: deploys Cloudflare `c83abf7d` (web), `a9c8c62b` (portal) e `b33cfdf0` (campo), do commit `02ee9e9`.

**Recuperação:**
- Banco: restaurar o backup `825569fa` pelo HostPanel.
- API: redeploy do ref `a852e7c…`.
- Fronts: rebuild de `02ee9e9` + `wrangler pages deploy`.

Restaurar o banco apagaria o que foi gravado depois do deploy, por isso só se faz com decisão explícita.

## 3. API, workers e migrations
- **Deploy:** HostPanel, runtime "Téchne Care — produção" (`pgv-pe0b9asx`, node `apps-us-east-01`), ação `deploy`, ref `2541c65…`, job `86addd28-314e-479d-bf3c-d11627755320`. A versão nova apareceu em cerca de 150 s.
- **`GET /v1/health/version`:** `impressao f07e34c33070`, construída em 30/10/2026 13:02:13 UTC. É igual à impressão calculada no commit do merge.
- **`GET /v1/health/ready`:** `{"status":"ok","checks":{"database":"ok"}}`.
- **Contêineres:** `api` e `workers` na imagem `hostpanel/pgv-pe0b9asx:2541c6546d93`, estáveis; `db` em postgres 16.10, healthy, não recriado.
- **Migrations** (conferidas no banco, em transação somente leitura):

| Migration | Aplicada em (UTC) |
|---|---|
| 0084_store_publico_e_separacao | 2026-10-30 13:02:50.436 |
| 0085_cadastro_cliente_e_ativo | 2026-10-30 13:02:50.528 |
| 0087_planos_ativacao_e_procedimentos | 2026-10-30 13:02:50.586 |
| 0088_automacao_por_evento_uma_vez | 2026-10-30 13:02:50.604 |
| 0089_identificacao_ativo_pessoa_e_qualidade | 2026-10-30 13:02:50.623 |

O banco tem 89 migrations ao todo. Os índices novos `runs_rule_event_uq` e `assets_org_tag_uq` existem, assim como as colunas novas conferidas (`store_audience`, `report_tier`, `sla_enabled`, `tag_legacy_duplicate`, `extra_checklist_template_keys`).

**Dados preservados** (antes = depois):

| Organizações | Equipamentos | Orçamentos | OS | Regras de automação | Execuções | Tags marcadas como duplicadas |
|---|---|---|---|---|---|---|
| 1 | 15 | 3 | 25 | 0 | 0 | 0 |

## 4. Frontends
Build feito com `VITE_API_URL=https://api-technecaremeds.voceconecta.com.br/v1`. Nenhum bundle contém `localhost`, o preview ou outro endereço de API.

| Projeto | Deploy | Domínio de produção | Bundle servido = build | Conectado à API certa |
|---|---|---|---|---|
| technecare-web | `f607839c` | technecaremeds.voceconecta.com.br | sim (`index-j50AjnfU.js`) | sim; CORS web → API 204 |
| technecare-portal | `31d73400` | portal-technecaremeds.voceconecta.com.br | sim (`index-sQVP5I63.js`) | sim |
| technecare-field | `cbf76844` | campo-technecaremeds.voceconecta.com.br | sim (`index-D8gSPyf9.js`) | sim |

A demonstração `technecaremeds.pages.dev`, publicada automaticamente da `main`, responde 200.

## 5. Monitoramento e segurança (resultado real)
- **Automações:** nenhuma pôde disparar. Há 0 regras e 0 execuções no banco depois do deploy, e o worker não registrou execução.
- **Migrations:** nenhuma falhou. As cinco estão aplicadas e os logs não têm erro.
- **Logs da API e dos workers** (30 min depois do deploy): 0 erros e 0 ocorrências de CPF formatado ou campo `password` em claro.
- **Sem sessão, nada abre:** chamadas a rotas autenticadas sem login devolvem 401. Isso não prova sozinho que as rotas novas existem, porque a API responde 401 antes do roteamento; a prova delas fica para a homologação com login.
- **Páginas públicas e telas de login:** `/apresentacao`, `/ferramentas`, portal e campo respondem 200, sem erro no console do navegador.
- **Credenciais:** nenhuma foi lida, digitada ou exposta. A leitura do banco foi pelo socket local do contêiner, em transação somente leitura.

## 6. Homologação em produção (com login, 30/10/2026)

**Sessão:** web em technecaremeds.voceconecta.com.br, usuário "Demo Anderson", administrador da organização "TéchneCare Demo", logado pelo responsável.

**Método:**
- Tudo pela tela, sem ler nem usar o token da sessão.
- Status de cada chamada à API lido pelo registro de recursos da própria página.
- Nenhum registro foi gravado (ver "Dados preservados").

### 6-A. O que foi verificado

| Área | Resultado | Evidência |
|---|---|---|
| Login, menu e perfil | ok | "Bom dia, Demo"; menu completo do administrador; console sem erro |
| Painel | ok | regiões nomeadas; cartão novo "Avaliação das OS"; nenhuma chamada com erro |
| Lista de OS | ok | abas Todas/Abertas/Em execução/Paradas/Concluídas/**Negados**; sem erro |
| Ficha da OS (WO-2026-0025) | ok | "Local: Imagem — Ultrassonografia", sem IDs; prazos em etiquetas ("Chegada ao local: vencido há 6 dias"), sem barra vermelha nem "onsite"; "Imprimir OS" presente; orçamento visível (a organização é prestadora) |
| Execução guiada | ok | 8 passos, incluindo "Parecer final"; `GET /work-orders/:id/completion` → **200** (rota nova servindo). "**Concluir ordem de serviço" desabilitado**, com "Para concluir, falta: Descrição do serviço · Parecer do equipamento (LIBERADO ou PARADO)" |
| Folha de impressão da OS | abre e chama a impressão do navegador | o título "Imprimir WO-2026-0025" foi conferido; o diálogo de impressão travou a aba automatizada (comportamento do navegador, não do sistema), então o conteúdo da folha fica coberto pelos testes do CI |
| Planos | ok | botão "Executar plano"; "Ranking de conformidade"; sem erro |
| Orçamentos existentes | ok | os 3 orçamentos listados |
| Store | ok | abas Catálogo / Pedidos / **Gerenciar catálogo**; `GET /store/catalog` → 200; 14 produtos; diálogo "Novo produto" com público "Toda a rede de clientes" e "Só os clientes que eu escolher", **cancelado sem salvar** |
| Relatórios | ok | página `/relatorios`; `GET /reports/options` → 200; abas Indicadores/Patrimonial; "Criar automação com estes filtros". **PDF**: 200, `application/pdf`, 14.478 bytes, assinatura `%PDF-1.4`. **Excel**: 200, `…spreadsheetml.sheet`, 20.801 bytes, assinatura ZIP `PK`. Os dois capturados na memória da página, sem baixar arquivo |
| Patrimonial | ok | aba abre com as situações (ativos, em manutenção, obsoletos) e os botões de PDF/Excel |
| Cadastro de cliente | ok | ficha mostra "Relatório incluso: não informado" e "Vigência: não informada" (campos novos, ainda vazios) |
| Cadastro e ficha do equipamento | ok | "Ficha de vida" presente; `GET /assets/:id/life-record` → 200 (rota nova servindo) |
| Ferramentas | ok | 9 cartões; "Soluções novas de mercado, consulte disponibilidade."; Eficiência Energética; a frase recusada não aparece; marca com link para o início |
| Erros | nenhum | nenhuma chamada à API com status ≥ 400 nas telas visitadas; console sem erro |

**Dados preservados** (banco, em transação somente leitura, depois da homologação):
- **0 registros** de auditoria e **0 eventos** desde o deploy (13:02 UTC).
- **Contagens iguais a antes:** 1 organização, 15 equipamentos, 3 orçamentos, 25 OS, 0 regras, 0 execuções.
- Nenhum check-in criado na OS aberta no assistente.

**Logs (60 min depois do deploy):** API e workers com 0 erros e 0 ocorrências de CPF ou senha. Os contêineres estão estáveis.

### 6-B. O que ficou de fora, e por quê

| Item | Motivo | Como fechar |
|---|---|---|
| Portal do cliente e app de campo com login; sincronização do campo | Cada um tem login próprio, e não havia sessão; eu não digito senha. O service worker novo do campo já está ativo | Entrar em `portal-…` e `campo-…`, ou testar no celular de um técnico |
| Conclusão real de OS com parecer e efeito no estado do equipamento | Exige gravar numa OS de verdade; não gero registro fictício em produção | Na próxima OS real de equipamento: concluir com "Equipamento parado" e conferir o equipamento "em manutenção", depois "Liberado" e conferir "em operação" |
| Permissões de outros perfis (operador, solicitante) e isolamento entre clientes em produção | Só havia a sessão de administrador; produção tem uma única organização | Coberto pelos testes de API e E2E do CI contra PostgreSQL 16 (tenants, escopo e 403/404) |
| Conteúdo da folha de impressão em produção | O diálogo de impressão do navegador trava a aba automatizada | Coberto pelos testes de tela e E2E do CI; conferir com Ctrl+P numa OS |

## 7. Problemas e correções durante a publicação
- **Deploy da API:** a primeira tentativa foi barrada pela checagem de segurança da sessão (deploy de produção). O responsável liberou e a segunda passou. Nada foi alterado entre as duas.
- **Folha de impressão:** abrir a folha da OS dispara a impressão do navegador, e o diálogo travou a aba automatizada; a aba foi fechada. Não é defeito do sistema.
- Nenhuma outra ocorrência.

## 8. Pendências remanescentes (não bloqueiam a produção)
- **Fechar as ressalvas do §6-B:** portal e campo com login; conclusão real de OS com parecer; outros perfis.
- **Depende de Anderson:**
  - fórmulas P-01…P-16 (REL-04, REL-05, REL-06, OPS-10);
  - campos que exigem aprovação (USR-09, USR-11);
  - indicadores do financeiro (AUT-05);
  - prazo de retenção da geolocalização;
  - confirmar o padrão "hospital sem orçamento";
  - o que a seta da foto do quadro de OS aponta.
- **Serviço externo:** provedor de e-mail (USR-02, ORC-03, AUT-02, AUT-03); domínio e VPS (OPS-05).
- **Comunicar a equipe:** concluir OS de equipamento agora exige o parecer "Liberado para uso" ou "Equipamento parado". O app de campo se atualiza sozinho na próxima abertura com rede.

## 9. Estado final da produção
| Componente | Versão | Estado |
|---|---|---|
| API | `2541c65` · impressão `f07e34c33070` | no ar, `ready ok` |
| Workers | `2541c65` | no ar, sem erro |
| PostgreSQL | 16.10, migrations até 0089 | healthy, dados preservados |
| Web, portal, campo | `2541c65` (deploys `f607839c`, `31d73400`, `cbf76844`) | no ar, apontando para a API de produção |
