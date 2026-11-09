# Relatório: ajustes de Anderson (áudio de 06/11/2026)

**Data:** 08/11/2026 (complemento no mesmo dia: logomarcas e validação final) · **Branch:** `feat/ajustes-anderson-2026-11-06` (base `2541c65`, a PR #42 publicada em 30/10)
**PR:** [voceconectadigital/technecaremeds#44](https://github.com/voceconectadigital/technecaremeds/pull/44) · **Merge e deploy:** não feitos; aguardam sua autorização expressa.
**Migrations:** nenhuma. A mais recente continua sendo a `0089`, já aplicada em produção.

## 1. Prontidão para o piloto de 09/11/2026

**A versão é segura para o piloto; o piloto ainda depende do deploy.** Os pedidos do áudio e as
logomarcas estão implementados e testados na branch. O CI do GitHub rodou a PR inteira em ambiente
temporário e isolado: testes em PostgreSQL 16 real, ponta a ponta no navegador e verificações
estáticas, todos verdes (§4.1). Em produção continua a versão da PR #42, que já imprime a OS pela
ficha, mas não tem o botão na lista, a folha nova, as logomarcas nem o espelhamento em Qualidade.

Para o piloto falta:

1. sua autorização para merge e deploy da API e do front web (não há migration nem mudança no app de campo);
2. checar se as naturezas de OS usadas no piloto são as de sistema: Preventiva, Calibração, Teste de
   Segurança Elétrica e Qualificação. Um tipo criado à mão com outro nome não espelha (ver §6).

Pelo checklist da rodada anterior, o deploy é: backup → API → `/v1/health/version` → front web.

## 2. Classificação dos três eixos

| Eixo | Classificação | Evidência |
|---|---|---|
| Imprimir OS de qualquer natureza | **CORRIGIR_AGORA** (feito) | A ficha já imprimia qualquer tipo, mas a lista não tinha ponto de acesso e a folha imprimia "—" onde houve medição de calibração ou TSE |
| Impressão em lote | **AVALIAR_ESCOPO** | O áudio pede "lugar para imprimir… as de calibração", o que aponta para cobertura de todos os tipos. Lote não foi pedido de forma comprovável |
| Espelhamento em Qualidade | **CORRIGIR_AGORA** (feito) | A Qualidade só tinha certificados manuais (QUA-01…05), sem ligação com as OS |
| Criação manual de certificado | **JA_ATENDE** | Mantida sem mudança |
| Certificado emitido automaticamente | **AVALIAR_ESCOPO** | Relatório de serviço não é certificado; nada é emitido nem assinado sozinho |
| Até 2 logomarcas por organização | **CORRIGIR_AGORA** (feito) | Já estava no roteiro aprovado (T-03, 16/10: branding por organização com logo seguro); faltava a logo |
| Logomarca por cliente/hospital da OS | **AVALIAR_ESCOPO** | Não pedido de forma comprovável; ver §3.3 |
| Fórmulas do Anexo F | **DEPENDENCIA_CLIENTE** / **V2_FUTURO** | `MATRIZ_FORMULAS_ANEXO_F.md`: nenhuma das 16 é inequívoca com os dados do sistema |

Status por item: `docs/auditoria/REQUISITOS_ANDERSON_2026-11-06.json`, com IDs `AND-1106-01…13`, separados dos 177.

## 3. O que mudou

### 3.1 Impressão de OS (commit `80b9e28`)

- **Lista de OS:** cada linha ganhou um botão "Imprimir", que abre a folha completa e o diálogo de
  impressão. Antes era preciso abrir a OS. Na demonstração local apareceram 29 botões, um por OS.
- **Folha** (`apps/web/src/features/ordens/folha-de-impressao.tsx`), com a diagramação das duas referências:
  - cabeçalho com o nome da organização logada e a marca autorizada do sistema;
  - número da OS e faixa com situação, tipo de atendimento e prioridade;
  - seções numeradas: cliente e local; equipamento; registro técnico (problema, diagnóstico,
    serviço, ação, observações); procedimentos, testes e medições; datas e tempo decorrido;
    check-in; condição final; peças; anexos; avaliação; responsáveis e aceite; assinaturas;
  - rodapé com aviso de LGPD.
- **O que não foi copiado das referências:** nomes, CNPJ, endereços, contatos, hospitais, logos da
  Be Care, datas e assinaturas. Tudo vem da OS e da organização logada.
- **"Não informado" e "Não se aplica":** "Não informado" é campo que a OS poderia ter e não tem.
  "Não se aplica" é campo que não cabe, como equipamento e parecer numa OS de local, ou solicitação
  de origem numa OS que não veio de solicitação.
- **Aceite:** só aparece como registrado quando existe assinatura real com o papel "cliente".
- **Calibração e TSE:** cada ponto de medição imprime as leituras registradas, com o nominal e a
  tolerância declarados no procedimento, e o resultado "registrado (sem veredito automático)". A
  rota `GET /work-orders/:id/checklists` passou a devolver `value_readings`, `unit` e
  `template_title`. São campos novos e opcionais no contrato; nada do que já existia mudou.
- **A4:** `@page folha-os` com margens de 12 mm. Na página da folha, só a folha vai ao papel (sem a
  moldura da aplicação, sem fundos). As tabelas quebram entre páginas e repetem o cabeçalho.
- **Validação visual:** PDFs gerados com o Chromium do Playwright em mídia de impressão, na
  demonstração local, para corretiva, calibração, TSE e preventiva. Todos saíram em 1 página A4,
  sem menu nem moldura. A captura e os PDFs estão fora do repositório, na pasta temporária da sessão.

### 3.2 Espelhamento em Qualidade (commit `a2013d8`)

- **Rota:** `GET /v1/quality-records/services` (`listServiceRecords`, em `packages/db/src/qualidade.ts`).
  - Entram as OS de natureza **preventiva, calibração, TSE e qualificação** nas situações
    **Concluída, Validada ou Fechada**.
  - Ficam de fora: corretiva, rascunho, aberta, agendada, em execução, em espera, cancelada e negada.
- **Por que uma consulta derivada, e não uma cópia:**
  - nenhuma linha é gravada, então reprocessar não duplica nada;
  - as OS concluídas antes desta versão aparecem sem backfill;
  - a OS reaberta sai da lista sozinha e volta, uma única vez, ao ser concluída de novo;
  - não precisou de tabela nova nem de migration.
- **Acesso:**
  - exige `document.read` **e** `work_order.read`; quem só lê certificados recebe 403;
  - o escopo de cliente e setor é o da OS, o mesmo filtro da lista de OS;
  - RLS por organização.
- **Tela:** aba "Serviços concluídos" na página Qualidade.
  - Filtros: tipo, busca (OS, título, equipamento, patrimônio, plano) e período de conclusão.
  - Cada cartão mostra: tipo; situação; cliente, setor e equipamento; plano e tarefa de origem;
    os procedimentos, um por resposta e com a versão (preserva a correspondência quando a OS tem
    vários); as sessões de medição; as assinaturas; o parecer; o executor.
  - Links "Abrir OS" e "Relatório", este para a folha de impressão.
  - O texto da tela diz que aquilo não é certificado.
- **Demonstração:** a captura passou a incluir as rotas de Qualidade. Antes a página dava erro na
  demonstração; agora mostra o estado vazio, porque as OS da semeadura ficam "em execução" no banco
  da captura.

### 3.3 Logomarcas da organização (complemento de 08/11)

Pedido: "um campo em config que permita anexar até 2 logos por empresa" (hospital e mantenedora,
prestadora e hospital, empresa e grupo).

- **Escopo:** estava no roteiro aprovado em 16/10 (T-03, branding por organização com "logo
  seguro"), com a logo pendente. Por isso foi feito agora, na forma mínima.
- **Configurações → Logomarcas:** duas vagas, na ordem em que saem no papel. Para cada uma:
  enviar, substituir, remover, prévia e o nome da marca (vira o texto alternativo).
  - Quem tem `organization.update` (administrador) altera; os demais só veem.
  - PNG, JPEG ou WebP, até 512 kB. O tipo é conferido pelos primeiros bytes do arquivo; SVG é
    recusado (é documento ativo, não imagem).
  - O nome da marca é gravado junto com o envio da imagem.
- **Onde fica:** os metadados em `organizations.settings.logos`, mesclados ao que já existe ali
  (marca, domínio, configuração); os bytes no mesmo armazenamento de objetos dos certificados, numa
  chave com o id da organização. **Sem migration.** Trocar uma logomarca apaga o arquivo antigo.
- **Isolamento:** a rota é sempre a da organização logada (`/v1/organizations/current/logos`),
  sem id por parâmetro; a RLS da organização vale. Testado com duas organizações.
- **Folha da OS:** 0, 1 ou 2 logomarcas lado a lado, separadas por um fio, em caixas de altura fixa
  (15 mm no papel) e largura máxima: a proporção é a do arquivo, sem distorcer. Com logomarca da
  organização, só ela assina o cabeçalho; a marca do produto (de `marca.config.json`) aparece
  apenas para quem não configurou nenhuma. O texto "Emitido pelo sistema Téchne Care" continua.
  Nenhuma logomarca de cliente (Be Care, iTech ou outra) foi posta no código.
- **Conferência visual:** PDFs A4 na demonstração local com duas marcas fictícias geradas no teste
  (uma larga, uma redonda): 1 página, proporções preservadas. A demonstração publicada segue sem
  logomarca.
- **Decisão comercial pendente:** a logomarca é da **organização** (a empresa logada), não do
  cliente da OS. Uma prestadora que atende vários hospitais imprime as mesmas marcas em todas as
  OS. Logomarca **por cliente/hospital**, escolhida pela OS, é ampliação: a coluna
  `customers.logo_key` existe desde a migration 0008, mas não há tela nem regra de precedência.
  Não foi implementada.

## 4. Testes

| Suíte | Resultado |
|---|---|
| `apps/api/src/__tests__/api-qualidade-servicos.test.ts` (novo, PGlite) | **13/13**. Cobre: as 4 naturezas; o que fica de fora; plano e 2 procedimentos com a resposta de cada um; OS avulsa; filtros; 422; idempotência; nada gravado em certificados; reabrir e concluir de novo dá 1 linha; validada; escopo restrito; 403 sem `work_order.read`; outra organização; título do procedimento; 404 fora do escopo |
| `apps/web/src/__tests__/qualidade-servicos.test.tsx` (novo) | **2/2** |
| `apps/web/src/__tests__/ordens-auditoria-29-10.test.tsx` (atualizado: seções novas, calibração com leituras, OS de local) | **16/16** |
| Suíte completa (`vitest run`, PGlite), antes do complemento | **2.831 passaram, 32 pulados** (os que exigem PostgreSQL real), 179 arquivos; antes desta rodada eram 2.813 |
| Suíte completa (`vitest run`, PGlite), com as logomarcas | **2.846 passaram, 32 pulados**, 181 arquivos (+15 testes novos). Estáticos refeitos numa worktree LF (format:check, marca:check, openapi:check, spec:audit, lint, typecheck): verdes |
| `apps/api/src/__tests__/api-logomarcas.test.ts` (novo) | **8/8**. Cobre: começa vazia; duas vagas em ordem, com rótulo e imagem; trocar apaga o arquivo antigo; recusa SVG, conteúdo falso, arquivo grande e vaga 3; assinatura PNG/JPEG/WebP; técnico lê mas não altera (403); outra organização não vê nem apaga; tirar uma deixa a outra, 404 na segunda vez, e a configuração da organização fica intacta |
| `apps/web/src/__tests__/logomarcas.test.tsx` (novo) | **4/4**: vagas vazias; sem permissão, só a prévia; remover; enviar (vaga, tipo, rótulo e base64; GIF nem sai) |
| `ordens-auditoria-29-10.test.tsx` (+3) | **19/19**: folha sem, com uma e com duas logomarcas |
| `e2e/specs/logomarcas.spec.ts` (novo) | Envio pela tela, logomarca na folha da OS, isolamento da outra organização. Roda no CI (§4.1) |
| Estáticos do CI numa worktree LF: spec:audit, typecheck, lint, format:check, openapi:check, marca:check, segredos | **todos verdes** |
| Testes em PostgreSQL 16 real e E2E (Playwright) | **executados no CI do GitHub** (§4.1). Correção: a versão anterior deste relatório dizia que não tinham rodado e que o Actions estava bloqueado por cobrança. Estava errado: o repositório é público desde 22/10 e o CI rodou na PR #44 |

### 4.1 CI do GitHub (ambiente temporário e isolado)

Nenhum banco de produção foi usado e nada foi baixado ou contratado: o GitHub Actions do
repositório público sobe um PostgreSQL 16 descartável a cada execução. Na máquina local não há
PostgreSQL nem Docker em funcionamento, por isso esses dois níveis só rodam lá.

| Execução | Commit | PostgreSQL 16 real | Ponta a ponta (Playwright) | Estático | Gate |
|---|---|---|---|---|---|
| [42540910801](https://github.com/voceconectadigital/technecaremeds/actions/runs/42540910801) | `bf5b34c` (impressão + Qualidade + Anexo F) | **2.863 passaram** (181 arquivos) | **237 passaram, 1 pulado** | verde | verde |
| [42551161787](https://github.com/voceconectadigital/technecaremeds/actions/runs/42551161787) | `41f5984` (+ logomarcas) | **2.878 passaram** (183 arquivos, com `api-logomarcas` e `logomarcas`) | **238 passaram, 1 pulado** (com `logomarcas.spec.ts`) | verde | verde |

O commit seguinte só muda documentação.

## 5. Anexo F: resumo

A matriz completa está em `docs/auditoria/MATRIZ_FORMULAS_ANEXO_F.md`: 16 indicadores, com fórmula
literal, unidade, meta, periodicidade, variáveis, fonte, página, chave no sistema, ambiguidades
A-1…A-12 e 8 perguntas.

- **Nenhum cálculo novo.** Faltam os Anexos A–D (interno × externo), a tabela 04 do TR (AQS), o
  marco do primeiro atendimento, a competência e o sentido das glosas de tempo, que no documento
  parece invertido.
- **Glosa e desconto não foram implementados.** São financeiros e contratuais.
- **Duas divergências para você decidir:**
  - **D-1:** a linha 15 do IMR atual usa a média 1–5 das avaliações de OS, mas o Anexo F define o
    AQS como pontuação de formulário, com meta 0.
  - **D-2:** a linha 13 (ACM) conta só preventiva e aceita o atraso; o Anexo F agrega MP+CAL+TSE e
    conta só o feito no prazo.
- **P-16 (obsolescência)** não está no Anexo F. Nenhum P-xx foi dado como resolvido.

## 5.1 Validação final da PR #44

- **Qualidade não produz certificado fictício.** A aba "Serviços concluídos" é uma consulta: não
  grava, não numera, não assina. O teste confere que `quality_records` continua vazio depois das
  consultas. A tela diz que o relatório de serviço não é certificado.
- **Só as naturezas autorizadas espelham.** O filtro é a chave de sistema do catálogo
  (`preventive`, `calibration`, `electrical_safety`, `qualification`), provisionada pelas
  migrations 0064/0076 em toda organização. Corretiva e as demais naturezas não entram (testado).
- **Impressão:** todas as naturezas imprimem pela lista e pela ficha; as medições de calibração e
  TSE saem com as leituras.
- **Lacunas críticas:** nenhuma encontrada. Ficam os limites de §7 e as decisões de §6.

## 6. O que depende de Anderson

1. **Autorização de merge e deploy** desta rodada, para o piloto.
2. **Naturezas de OS do piloto:** o espelhamento reconhece a natureza pela chave de sistema do
   catálogo. Um tipo criado à mão com outro nome (ex.: "Calibração 2") não aparece.
3. **Impressão em lote:** quer imprimir várias OS de uma vez? Com qual filtro?
4. **Portal do cliente:** o cliente final precisa baixar o relatório da OS pelo portal? Hoje o portal não abre a OS.
5. **Certificado emitido pelo sistema** (numeração, responsável técnico, rastreabilidade): seria escopo novo.
6. **Anexo F:** perguntas 1–8 da matriz, os Anexos A–D e a tabela 04 do item 9.3.5 do TR.
7. **Logomarca por cliente/hospital** (§3.3): hoje as duas logomarcas são da organização e saem em
   todas as OS dela. Se cada hospital precisar da própria marca na OS dele, é ampliação a contratar.
8. **Enviar as logomarcas** em Configurações → Logomarcas depois do deploy (é configuração, feita
   pelo administrador da organização).

## 7. Limites conhecidos

- A folha usa a impressão do navegador ("Salvar como PDF"), como antes. Não há PDF gerado no servidor.
- O cabeçalho da folha não traz CNPJ, endereço nem telefone da organização, porque esses dados não
  estão no contrato da sessão. Incluí-los exige definir de onde vêm, de forma autorizada.
- A paginação de folhas longas (muitos itens de checklist) foi coberta por regras de quebra, mas só
  foi conferida em PDFs de 1 página, porque a demonstração não tem OS com checklist longo.
