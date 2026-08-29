# AURORA — RELATÓRIO DA SESSÃO DE 29/08/2026 (parte B)

**Branch:** `main` · **HEAD inicial:** `6a07108` · **HEAD atual:** `b781269` · **Árvore:** limpa

Continuação da sessão anterior. Esta parte cobre a fundação de segurança e dependências, a
subida do Playwright, e o fechamento de três módulos de `apps/web`.

**Os números abaixo foram medidos, não estimados.** Onde eu errei, está escrito o que eu errei —
inclusive um defeito que eu mesmo introduzi e que passou por trinta minutos sem ninguém ver.

---

## 1. Estado do Git

| | |
| --- | --- |
| HEAD inicial desta parte | `6a07108` |
| HEAD atual | `b781269` |
| Commits nesta parte | 11 |
| Commits no total | 53 |
| Branch | `main` |
| Árvore de trabalho | limpa |
| Push para remoto | **não feito** — não há autorização inequívoca no ambiente |

```
d939eb5  fix(deps): fecha as 4 vulnerabilidades ALTAS sem arrastar dois majors
22d49ba  fix(deps): Vitest 4 e Vite 8 — fecha a CRITICAL e a última ALTA
1d764e6  fix(deps)!: NestJS 11 — zero vulnerabilidades, e a garantia que a rota perdeu
0acbcf1  feat(attachments): o servidor passa a decidir onde o arquivo mora
ef85270  test(e2e): Playwright de pé, e três defeitos que só o navegador mostrou
4f4d9ff  fix(web,api): quatro defeitos que o contrato frouxo escondia
8cd53f6  docs: corrige os números contra o Git, que é quem sabe
eecd23d  feat(work-orders): a ficha ganha o que ler, e o contrato para de mentir
32e7a4e  feat(web): ficha da OS em três camadas, e a conversa que faltava
1cd11ba  feat(web): parque de ativos, e o filtro que eu quebrei sem ninguém ver
b781269  feat(rbac): "por que essa pessoa não consegue?" passa a ter resposta
```

### Fase 0 — a divergência reconciliada

O relatório anterior dizia HEAD `839ae75` e 40 commits. Medido no Git: os dois números estavam
**um a menos**. A causa é banal — o relatório foi escrito antes do commit que o contém e depois
refeito; o commit final é `6a07108`, o décimo daquela sessão e o **42º** do repositório.

`839ae75` não estava errado, estava velho: existe, é o penúltimo. **Não escolhi entre os dois** —
medi com `git rev-list --count` e corrigi os documentos, com errata explicando a causa em vez de
trocar o número em silêncio.

---

## 2. Segurança e dependências (Fase A)

### `npm audit`: 13 vulnerabilidades → **0**

| | |
| --- | --- |
| Críticas | 0 |
| Altas | 0 |
| Moderadas | 0 |
| Baixas | 0 |

**`npm audit fix --force` teria saltado NestJS 10 → 12** — dois majors — para resolver advisories
que, lidos um a um, tinham correção dentro do mesmo major. O que foi feito:

- **`multer`, `qs`, `file-type`**: correção em `overrides`, sem tocar em quem os puxa.
- **`@nestjs/core`**: a leitura do GHSA-36xv-jgw5-4q75 mostrou que o `fixAvailable` do npm era
  enganoso — a correção real é `11.1.18`, **um** major, não dois. E o advisory exige uso de SSE com
  dado do usuário em `type`/`id`: `grep` confirmou que **não há `@Sse` no código**.
- **Vitest 4 / Vite 8**: fecharam a CRITICAL e a última ALTA.

### O que a subida do NestJS 11 quebrou, e o que isso revelou

Express 5 traz `path-to-regexp` 8, que **rejeita regex inline em rota**. Foram removidas 52 regex
de 11 controllers. Duas consequências:

1. **`/quotes/price` e `/documents/by-asset` ficaram inalcançáveis** — declaradas depois de `/:id`.
   A resolução de rota passou a depender da ordem de declaração, e a garantia saiu do roteador
   para uma **checagem de máquina** no `npm run openapi`. Provei que ela dispara reordenando
   `/quotes/price` de propósito.
2. **Quatro rotas ficaram sem validação de identificador**, porque a validação delas morava na
   FORMA da rota. `PATCH /members/:id/scope` passou a devolver 500 com id malformado. As onze
   cópias duplicadas de `uuidParam`/`text`/`oneOf` foram consolidadas em `apps/api/src/common/params.ts`.

### Endurecimento de upload

`packages/domain/src/attachments.ts` (novo): lista de permissão por finalidade (nenhum HTML, SVG ou
executável em nenhuma), limite por finalidade (assinatura 2 MB, documento 40 MB, resto 15 MB), teto
de 50 anexos por entidade conferido **dentro da transação**, e — o que fecha a classe inteira —
**a chave de armazenamento é gerada pelo servidor**. Travessia de caminho não tem por onde entrar:
o cliente nunca escolhe onde o arquivo mora.

**Não implementei antivírus fictício.** A verificação de conteúdo é a que o `file-type` faz sobre a
assinatura do arquivo, e está escrito no código que é isso que ela é.

---

## 3. Playwright (Fase B)

**43 testes de ponta a ponta**, 1 pulado, em 6 arquivos. Servidor de API e de interface subidos pelo
próprio Playwright, com semente determinística re-executada antes de cada execução.

### O papel de banco do E2E

A API **recusou subir** com o papel `postgres`:

> Recusando subir: o papel de banco 'postgres' tem SUPERUSER e BYPASSRLS.

A guarda funcionando. Criei `aurora_e2e_api` (LOGIN, herda `aurora_app`, NOBYPASSRLS, NOSUPERUSER)
— medir com superusuário mediria um sistema sem RLS, que não é o nosso.

### Três defeitos que 1.392 testes de unidade e HTTP não podiam ver

1. **A API não tinha CORS.** Toda a suíte de HTTP roda em processo, com supertest; nenhuma delas
   passa por um navegador que aplica origem. A tela mostrava "Failed to fetch".
2. **`GET /me/session` devolvia 500.** O middleware de contexto excluía por PREFIXO — `/(^|\/)(health|me|q)(\/|$)/` — e o prefixo isentava todo `/me/*`. Corrigido para caminhos exatos, com três testes de regressão.
3. **A validação de e-mail no login nunca aparecia.** O `type="email"` nativo preemptava o React: o
   navegador mostrava a própria bolha, no idioma do sistema, sem relação com o campo e invisível
   para leitor de tela. `noValidate` no formulário.

### O teste que eu escrevi errado

Meu primeiro E2E de troca de organização era **falso**: o `addInitScript` re-executa a cada
recarregamento e sobrescrevia a organização que o teste acabara de escolher. Reescrito com a
persona da consultora — uma pessoa, dois vínculos —, que é o caso que a §05 existe para proteger.

### A vigilância de console

Criei uma spec que percorria sete telas conferindo o console. Ela deu **sete telas limpas no mesmo
dia** em que a agenda emitia "chave duplicada" a cada renderização — porque a spec visitava telas
**vazias**, e o defeito precisa de uma lista para aparecer.

A vigilância saiu da spec e virou **condição de todo teste de ponta a ponta**, onde quem monta o
cenário mais rico é quem melhor observa. Sem isenção por padrão: quem provoca ruído de propósito
declara qual, com `tolera()`. A versão preguiçosa — um filtro global ignorando toda resposta 4xx —
teria engolido calada as duas falhas que a vigilância achou no primeiro dia.

---

## 4. As mentiras do contrato

Fechar a ficha da OS exigiu ler o que a API devolvia. Apareceram cinco divergências entre o
contrato e a realidade. **Nenhuma delas o compilador podia ver**, e todas sobreviveram porque a
massa de teste nunca chegou aos valores que as revelariam.

| # | O que o contrato dizia | O que era | O sintoma real |
| --- | --- | --- | --- |
| 1 | `catalog: z.string()` | seis chaves fixas | a tela pedia `failure_code`, que nunca existiu; 422 e seletor vazio |
| 2 | motivo de espera era catálogo | não é — carrega `pauses_sla` | não havia rota nenhuma para lê-los |
| 3 | `items: z.array(z.record(z.unknown()))` | `work_order_id`, não `id` | chave do React `undefined`; **programar pela agenda gravava `workOrderId: undefined`** |
| 4 | `day` opcional | controller chamava `instant(undefined)` | 422 na exata chamada que o diálogo faz ao abrir |
| 5 | `WorkOrderDetail` era `.loose()`, rota fazia `w.*` | vinte campos a mais que o contrato | resolução, causa, responsável e solicitante trafegavam, invisíveis, ausentes da tela |

E duas listas de vocabulário **inteiramente erradas**:

- **`STATUS_CATEGORIES` no contrato tinha CINCO das nove do domínio** — faltavam `draft`,
  `scheduled`, `review` e `closed`. Como o cliente confere a resposta contra o contrato em
  desenvolvimento, **a primeira OS agendada derrubaria a tela**. Era uma bomba com pino.
- **`WORK_ORDER_PRIORITIES` e `REQUEST_PRIORITIES` diziam `normal`, `high`, `critical`** — três
  valores que o PostgreSQL não sabe gravar. O tipo é `request_priority`: `none, low, urgent,
  very_urgent, emergency`. E o mapa de cores da interface usava a lista inventada, então **toda OS
  urgente renderizava um chip vazio**, sem tom e sem rótulo.

**O que mudou para isso não voltar:** contratos estritos, consultas com colunas nomeadas, testes
que confrontam a resposta real com o contrato em `.strict()`, e testes de divergência entre
contrato e domínio para as três listas — incluindo a **ordem** da escala de urgência, que é a ordem
da fila de triagem.

---

## 5. Módulos fechados em `apps/web`

### EPIC-009 — ficha da ordem de serviço

Três camadas, na ordem em que as perguntas chegam:

1. **Cabeçalho de decisão** — o que dá para fazer agora. As transições vêm do servidor, já
   filtradas pelo que esta pessoa pode fazer a partir deste estado.
2. **Faixa de resumo, SEMPRE visível** — situação, motivo de parada, SLA, responsável, agenda,
   equipamento, local. Fica fora das abas porque é o contexto de tudo o que elas dizem: ler "3h
   apontadas" sem saber que a OS está parada há dois dias leva à conclusão errada, e é na aba de
   execução que a pessoa está quando pensa nisso.
3. **Cinco abas** — resumo, execução, anexos, conversa, histórico —, cada uma buscando o seu
   quando é aberta. Carregar tudo de toda OS aberta pagaria cinco consultas para mostrar uma.

**O que a API não tinha:** `execution.ts` só escrevia. Havia `POST` de anexo e nenhum `GET`, e uma
tabela `work_order_comments` inteira — com a separação entre nota interna e comentário do cliente
feita em **coluna**, desde a migration 0021 — sem nenhuma rota que a lesse. Cinco rotas novas.

**Comentário do cliente e nota interna correm no MESMO fio**, e não em duas abas. Separá-las
produziria exatamente o erro que a separação de coluna existe para evitar: responder na aba errada
porque se estava lendo a outra.

**O filtro do que é restrito acontece na CONSULTA.** Nota interna sai do `SELECT` para quem não tem
`work_order.read_internal_notes`; custo sai para quem não tem `work_order.read_costs`.

**Acessibilidade:** `Tabs` ganhou a ligação aba↔painel (`aria-controls` / `aria-labelledby`). Sem
ela o leitor de tela anuncia "aba 2 de 5" e não sabe dizer o que a aba abriu.

### EPIC-005 — parque de ativos

Árvore de locais à esquerda, lista recortada à direita, ficha do equipamento.

**A ficha existe para responder "vale a pena consertar de novo?"** — por isso o histórico de
atendimentos fica na primeira dobra, e não numa aba.

**O recorte da árvore é do servidor** e vai para a URL. Escolher a UTI traz também o que está nos
leitos dentro dela: é prefixo de caminho, não igualdade de local. Sem isso, uma unidade inteira
parece vazia porque os equipamentos estão nas salas.

**Sobre virtualização de lista:** a rota devolve no máximo 500 itens, então virtualizar responderia
a uma pergunta que ainda não existe. O que a tela faz é **dizer quando bateu no teto** — mostrar
500 em silêncio ensina que o parque tem 500, e é assim que alguém descobre meses depois que metade
dos equipamentos nunca apareceu em relatório nenhum. **A medição de 1k/10k/100k e a decisão sobre
paginação por cursor continuam pendentes** (§10 abaixo).

**Vazamento fechado:** `SELECT a.*` na ficha do ativo devolvia `internal_notes` e três valores
financeiros para qualquer um com `asset.read`. A permissão `asset.read_financials` estava no
catálogo desde o começo **sem nenhum lugar que a aplicasse**.

### EPIC-002 — acesso e permissões

`GET /memberships/:id/permissions` devolve a **procedência** de cada permissão. Quatro
comportamentos, cada um com teste próprio, porque errados eles produzem o mesmo sintoma e não se
distinguem pelo resultado final:

- papéis somam;
- a mesma permissão vinda de dois papéis aparece **duas vezes** — é essa duplicidade que explica
  por que remover um papel não tirou o acesso;
- `deny` vence, e **a linha do papel continua visível**, senão quem remover a exceção depois tem
  uma surpresa;
- exceção vencida não conta e some, senão alguém "corrige" removendo uma linha que já não fazia nada.

A exceção exige motivo e sugere trinta dias de prazo. **Exceção sem prazo é papel que ninguém teve
coragem de criar** — e que, ao contrário do papel, não aparece em nenhuma lista de quem tem o quê.

---

## 6. O defeito que eu introduzi

Ao acrescentar o filtro `?asset=` na lista de ordens, **perdi um `$`** no marcador do parâmetro
vizinho. A condição virou `w.assignee_membership_id = 4` — uuid comparado com inteiro, **500 para
quem filtrasse por responsável**.

Passou porque, **dos quatro filtros da rota, só `limit` tinha teste**. Um filtro sem teste é uma
cláusula de SQL montada por concatenação que ninguém executa.

Os quatro passam a ter, incluindo o caso que prova que o filtro FILTRA: o outro equipamento não
pode aparecer. Revertido o `$`, o teste novo acusa 500.

**Toda correção desta parte foi provada assim**: revertida, o teste correspondente falha; aplicada,
passa.

---

## 7. Números medidos

| Métrica | Valor |
| --- | --- |
| Testes unitários e de HTTP | **1.435** verdes (71 arquivos, 2 pulados) |
| Testes de ponta a ponta | **43** verdes (1 pulado, 6 arquivos) |
| Arquivos de teste no repositório | 79 |
| Migrations | 42 (`0000`–`0041`) |
| Rotas nos controllers | 149 |
| Rotas com contrato | 44 (30%) |
| **Rotas USADAS pela web com contrato** | **100%** — nenhuma chamada escapa; não há `fetch` cru |
| Vulnerabilidades (`npm audit`) | **0** |
| `npm run verify` | verde (spec → typecheck → lint → contratos → testes) |

A cobertura global de 30% é deliberada: **não escrevi 105 contratos vazios para chegar a 100%**.
Cada contrato desta parte nasceu porque uma tela real passou a consumir a rota.

---

## 8. Supabase — ainda BLOQUEADO

Diagnóstico preciso, sem tocar em nenhum outro projeto:

- a conta autenticada enxerga 19 organizações e 28 projetos; **nenhuma chamada "Aurora CMMS"**;
- o ref `egoajboqzhnvkpenrszw` **não aparece na listagem**;
- consulta direta ao ref devolve **403**;
- o CLI não consegue reautenticar em ambiente não interativo (`LegacyLoginMissingTokenError`).

**Nenhum outro projeto foi tocado. Nenhuma migration foi aplicada em lugar nenhum.**

Dois caminhos para destravar, ambos do seu lado:

1. criar um **Personal Access Token** na conta dona da organização "Aurora CMMS" e exportá-lo como
   `SUPABASE_ACCESS_TOKEN`; ou
2. aceitar o convite pendente da organização, se houver, na conta que o CLI já usa.

Assim que a sessão provar acesso **a esse exato ref**, aplico as 42 migrations e sigo.

---

## 9. O que NÃO foi feito, e por quê

- **TechneCare/Arkmeds:** nenhum acesso, nenhuma navegação, nenhum request, nenhuma sessão,
  nenhum login, nenhum teste. A auditoria existente foi a única fonte.
- **Nenhum recurso pago, upgrade, add-on, compra ou mudança de organização** no Supabase.
- **Nenhum push.** Não há autorização inequívoca no ambiente.
- **Nenhum e-mail, WhatsApp ou webhook real disparado.**
- **Nenhuma regra regulatória inventada.** Nada de metrologia foi implementado nesta parte.

---

## 10. Pendente

Em ordem de prioridade, seguindo a sequência combinada:

**Fase C — fechar `apps/web`** (3 de 12 módulos prontos)
- estoque, orçamentos, contratos, planos preventivos, documentos, indicadores, notificações,
  automações, configurações gerais
- medição de lista em 1k/10k/100k, e paginação por cursor se o `OFFSET` degradar

**Fase D — visual e acessibilidade**
- auditoria em 1440×900, 1280×800, 1024×768, 768×1024, 390×844
- acessibilidade automatizada dentro do Playwright
- desempenho de frontend e análise de pacote (hoje: 578,93 kB de JS, 179,30 kB comprimido)

**Fase E — Portal do cliente (EPIC-020)** — PORTAL-001..010, com os testes de vazamento de carga
útil: o portal não pode devolver nota interna, custo interno, margem, fornecedor interno,
comentário interno nem dado de outro cliente. **Não basta esconder por CSS.**

**Fase F — PWA de campo (EPIC-014)** — oito horas sem internet sem perda de trabalho, o teste de
19 passos, e o tratamento de conflito. Nunca descartar trabalho local em silêncio.

**Fase G — Metrologia (EPIC-019)** — zero hoje. Tudo que não estiver confirmado (fórmula, limite,
critério de aceitação, incerteza, regra regulamentar) será marcado **BLOQUEADO / A VALIDAR**, não
inventado.

**Transversal**
- CI com container de serviço PostgreSQL 16, para parar de depender desta máquina
- expansão do benchmark: latência HTTP, 10/25/50 clientes simultâneos, saturação de pool,
  p50/p95/p99

---

*Relatório medido em 29/08/2026. Fonte de verdade de implementação: filesystem + Git.*
