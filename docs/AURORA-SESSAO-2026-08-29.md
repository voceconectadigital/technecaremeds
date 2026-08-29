# AURORA — RELATÓRIO DA SESSÃO DE 29/08/2026

**Branch:** `main` · **HEAD inicial:** `7b88baa` · **HEAD final:** `dbffb1c`

Esta sessão levou o Aurora do backend pronto até a **primeira interface que funciona
ponta a ponta**, passando por PostgreSQL real, contratos compartilhados, fila durável e
medição de desempenho com cem mil ordens de serviço.

Os números abaixo foram **medidos**, não estimados. Onde a medição contradisse o que eu
esperava, está escrito o que a medição disse.

---

## 1. Estado do Git

| | |
| --- | --- |
| HEAD inicial | `7b88baa` |
| HEAD final | `dbffb1c` |
| Commits nesta sessão | 8 |
| Commits no total | 40 |
| Branch | `main` |
| Árvore de trabalho | limpa (0 arquivos modificados) |
| Push para remoto | **não feito** — não há autorização inequívoca no ambiente |

**Commits da sessão, do mais antigo ao mais novo:**

```
c2d6c33  docs: reconcile epic numbering against the SPEC
a8e17f7  feat(db): real PostgreSQL — validation, concurrency and a tenant FK fix
19f5bc9  feat(members): convite atômico com escopo, e o defeito que o impedia
7491c3a  feat(contracts): fonte única de contratos, OpenAPI gerado dos controllers
fd4f76a  feat(workers): pg-boss no lugar do agendador temporário
b4d6a18  feat(ui): design system próprio da Aurora
cb42ae8  feat(web): esqueleto da aplicação e o primeiro fluxo vertical
dbffb1c  perf(work-orders): mede com 100 mil OS, e corrige o que a medição mostrou
```

---

## 2. Migrations

**42** arquivos (`0000` a `0041`), idempotentes e reprodutíveis do zero. Quatro nasceram
nesta sessão:

| | |
| --- | --- |
| `0038_notification_event_fk_fix.sql` | A FK de notificação para evento não incluía `organization_id` |
| `0039_membership_scope_required.sql` | Gatilho diferido: vínculo sem escopo não sobrevive ao COMMIT |
| `0040_invite_flow.sql` | Chave estrangeira diferida + resolução de e-mail: o convite passa a funcionar sob o papel de produção |
| `0041_scheduler_role.sql` | `aurora_scheduler`, papel próprio para a dispersão dos trabalhos periódicos |

Todas aplicadas com sucesso num PostgreSQL 16.14 real, e validadas por
`tools/db/validate.mjs`: **92 tabelas**, todas com `ENABLE` + `FORCE ROW LEVEL SECURITY`,
todas pertencentes a `aurora_owner`, **160 chaves estrangeiras compostas** entre tabelas
tenant-scoped, **50 gatilhos de auditoria**, `aurora_app` sem `BYPASSRLS`, sem
`SUPERUSER`, sem `CREATEROLE`, e sem `UPDATE`/`DELETE` em `audit_logs`.

---

## 3. Testes

| | |
| --- | --- |
| Suítes | 70 arquivos |
| Testes que rodam sempre | **1.364**, todos verdes |
| Testes que exigem PostgreSQL real | **29**, todos verdes |
| Testes de interface (jsdom) | 45 dos 1.364 |
| Testes de ponta a ponta com navegador | **0** — não implementados |

O portão de qualidade (`npm run verify`) é: auditoria da SPEC → typecheck → lint →
**conferência de contratos** → testes.

---

## 4. Supabase — BLOQUEADO, e o bloqueio é o mesmo de antes

O protocolo pedido foi seguido à risca, e parou no passo 2.

| Passo | Resultado |
| --- | --- |
| 1. Consultar o projeto | Feito. O CLI está autenticado e lista **28 projetos**. |
| 2. Confirmar que o ref é EXATAMENTE `egoajboqzhnvkpenrszw` | **Impossível.** Esse ref **não aparece** na listagem. |
| 3. Confirmar nome, organização e região | Impossível — não há projeto a confirmar. |
| 4. Registrar no relatório | Feito: é esta seção. |
| 5. Só então vincular | **Não feito.** |

Consulta direta ao ref informado devolve **403**:

> `Your account does not have the necessary privileges to access this endpoint.`

O mesmo comando, contra um projeto que está na listagem, funciona. Isso separa as duas
hipóteses: **não é escopo de token — é acesso.** A conta autenticada não enxerga o
projeto `egoajboqzhnvkpenrszw`.

**Nenhuma operação foi executada em nenhum outro projeto.** Vincular sem conseguir
confirmar o ref seria exatamente a operação às cegas que a instrução proíbe.

**Para desbloquear:** dar a esta conta (`voceconectadigital@gmail.com`) acesso ao projeto,
ou informar em qual conta ele vive.

**Nada no código depende disso.** As migrations rodam em qualquer PostgreSQL 16+, e as
decisões ADR-026/027 removeram até a dependência de extensão.

---

## 5. PostgreSQL real, no lugar do bloqueio

Um contêiner PostgreSQL **16.14** local (porta 15432) destravou tudo o que dependia de
"banco de verdade" — sem nenhuma operação remota.

O que ele provou, e que o PGlite não consegue provar por ter uma conexão só:

- **reuso de pool:** o contexto do tenant A não sobrevive na conexão física quando ela
  volta para o tenant B;
- **concorrência real:** duas reservas simultâneas da última peça → exatamente 1 atendida
  e 1 recusada, com `reserved = 1` e `on_hand = 1`; 12 gerações concorrentes de número de
  documento → 12 números distintos, de 1 a 12; 8 recebimentos concorrentes de 5 unidades
  → `on_hand = 40`;
- **`SKIP LOCKED`:** dois publicadores do outbox pegam conjuntos com interseção vazia;
- **RLS sob o papel de aplicação real**, e não simulado;
- **dois workers em conexões físicas distintas** disputando a mesma fila: nenhum job é
  entregue duas vezes;
- **o papel do agendador recebe `permission denied`** ao tentar ler ordem de serviço.

---

## 6. Defeitos encontrados e corrigidos

Nove nesta sessão. Os cinco que mais importam:

**A numeração dos épicos estava errada.** Quatro épicos com número trocado em relação à
SPEC e — o que importa — o **EPIC-019 (Metrologia) constava como entregue e nunca foi
implementado**: o número tinha sido tomado por notificações. Encontrado por medição, não
por leitura.

**O convite não podia funcionar sob o papel de produção.** A política de `users` exige um
vínculo prévio para a linha existir; o vínculo exige o usuário pela chave estrangeira. Ovo
e galinha: `aurora_app` tinha `GRANT INSERT` em `users` desde a migration 0003 e nunca
conseguiu usá-lo uma vez. Ninguém notou porque todo teste e todo seed criava usuário pelo
caminho administrativo.

**A notificação podia apontar para o evento de outra organização.** A verificação de chave
estrangeira roda como dona da tabela e IGNORA a RLS. Nenhuma suíte pegou porque todo teste
de isolamento verifica LEITURA.

**Escrita de notificação guardada por permissão de LEITURA.** `audit.read` autorizava
marcar uma entrega como enviada — e o papel Auditor tem essa chave, sobre quem a SPEC diz
"somente leitura em tudo. Nenhuma escrita". Um auditor podia fazer um alerta sumir da
fila. Encontrado por uma conferência automática que agora roda no `npm run verify`.

**Os dois vínculos da consultora, no seed, nasciam cegos.** A persona que existe
justamente para exercitar o seletor de organização entrava nas duas sem enxergar nada.
Quem apontou foi o gatilho novo; até então, ninguém — porque vínculo cego não dá erro, dá
tela vazia.

---

## 7. Contratos e OpenAPI

`packages/contracts` é a fonte compartilhada: um campo é decidido **uma vez**, em Zod, e a
validação do controller, o documento OpenAPI e o cliente tipado do frontend passam a
concordar por construção.

`npm run openapi` lê os **controllers de verdade** — os metadados que o NestJS grava nos
decoradores, os mesmos que o roteador usa. Não há segunda lista de rotas escrita à mão.

**Cobertura: 27 de 136 rotas (20%)**, medida e impressa a cada execução. O número é baixo
de propósito: contrato nasce quando a tela que o usa nasce.

A conferência acusa quatro coisas, e entra no `npm run verify`: rota sem contrato,
contrato sem rota, permissão divergente entre contrato e guard, e **escrita guardada por
permissão de leitura** — que encontrou dois defeitos reais.

---

## 8. Trabalhos periódicos (pg-boss)

Cinco varreduras por organização (SLA a cada 5 min; planos de hora em hora; orçamentos,
contratos e documentos de madrugada) e uma de plataforma (o publicador do outbox).

**A garantia central: nunca duas execuções concorrentes do mesmo trabalho lógico.** Toda
fila usa política `exclusive` com `singletonKey` igual à organização. Importa porque as
varreduras abrem ciclo e **geram ordem de serviço**: duas execuções concorrentes
produziriam a mesma OS preventiva duas vezes.

O `IntervalScheduler` temporário foi **removido**, não deixado ao lado.

**Sem trabalho agendado, e dito no próprio catálogo:** o *digest* de notificações (§26) e a
automação com gatilho de agenda (§29). Nos dois casos falta a **função de domínio**, não o
agendamento — a §26 diz "resumo diário ou semanal" e não diz a que hora, e escolher a hora
seria inventar requisito.

---

## 9. Interface

**`packages/ui`** — design system próprio, tirado do assunto: um instrumento de trabalho
para quem mantém equipamento crítico funcionando. Neutros com viés frio esverdeado (vidro
de instrumento), destaque em teal profundo em vez do índigo de todo SaaS, semânticas
separadas do destaque. Claro e escuro, em três estados.

**`apps/web`** — esqueleto completo (entrada, escolha de organização, barra lateral ciente
de permissão, busca global com Ctrl+K, trilha, avisos, conta, gaveta no celular, tela de
erro que distingue "sem permissão" de "não existe" de "quebrou") e o **primeiro fluxo
vertical**:

> SOLICITAÇÃO → TRIAGEM → CRIAÇÃO DE OS → QUADRO → TRANSIÇÃO → AGENDA

Ponta a ponta, contra a API de verdade. As quatro decisões que mais importam:

1. **arrastar no Kanban nunca muda o estado só na tela.** Arrasta → pede → espera → move.
   Recusado, o cartão volta com a explicação; faltando campo, o aviso diz qual.
2. **a agenda confere antes de salvar.** Ausência **bloqueia**; sobrecarga **avisa**, com
   a carga do responsável à vista.
3. **as ações possíveis vêm do servidor**, com os campos que exigem.
4. **filtro mora na URL** — removível, compartilhável, sobrevive ao recarregamento.

A build de produção passa: 606 kB de JS (187 kB comprimido) e 32 kB de CSS.

---

## 10. Desempenho, com 100 mil ordens de serviço

100 mil OS em duas organizações, 4 mil ativos, 768 locais em árvore de três níveis,
distribuição torta. Medido sob `aurora_app`, com contexto de tenant, 30 repetições, 5 de
aquecimento descartadas.

| Cenário | p50 | p95 | meta |
| --- | ---: | ---: | ---: |
| lista de OS, filtrada por situação (filtro montado) | 42,7 ms | **114,5 ms** | 400 ms |
| lista de OS, filtrada por situação (catch-all, forma antiga) | 58,4 ms | 131,9 ms | 400 ms |
| lista de OS, filtrada por cliente e situação | 6,7 ms | 9,0 ms | 400 ms |
| lista de OS, página 50 (OFFSET 5000) | 59,8 ms | 146,5 ms | 400 ms |
| busca por patrimônio exato | 1,2 ms | 1,7 ms | 300 ms |
| busca textual por título | 67,0 ms | 103,9 ms | 400 ms |
| quadro por estado, com quebra de motivo | 41,8 ms | 94,6 ms | 400 ms |
| agenda da semana | 0,6 ms | 0,9 ms | 400 ms |
| ficha de OS com histórico | 1,1 ms | 1,4 ms | 200 ms |
| indicador: OS abertas por mês | 9,5 ms | 10,4 ms | 1000 ms |

**A meta da §41 é cumprida com folga de três vezes no p95.**

### O que eu quase reportei errado

A primeira execução deu p95 de **1.086 ms** na lista filtrada. Corrigi a consulta e o
número caiu para 186 ms. A conclusão fácil era "a correção resolveu, dez vezes melhor".

Não foi. Medindo as **duas formas lado a lado**, na mesma sessão e com o mesmo
aquecimento, a diferença entre elas é de **15% no p95** — real, consistente, e muito menor
que 10×. O que explicava o 1.086 ms era **cache frio logo após a carga em massa**.

A correção continua certa: melhor plano, estimativas que deixam de errar por duas ordens de
grandeza, e o fim de um padrão que já produziu outro defeito. Mas atribuir a ela uma
melhora de dez vezes seria mentira — e é o tipo de mentira que ninguém confere, porque o
número final está bonito. A forma antiga ficou no benchmark de propósito, para que a
comparação continue sendo medida.

### Limites desta medição

Contêiner local, não infraestrutura de produção. Mede o **banco**, não a rota inteira. Um
cliente por vez — não há medição sob concorrência de dezenas de sessões.

---

## 11. O que NÃO foi feito

Dito por extenso, porque o que falta importa tanto quanto o que existe.

**EPIC-019 (Metrologia) não existe.** Constava como entregue por causa da numeração
trocada. Nada dele foi implementado.

**`apps/portal` (EPIC-020) e `apps/field` (EPIC-014) não existem.** Nenhuma linha.

**Telas ainda não construídas:** ativos, estoque, contratos, indicadores, notificações e
perfil. A API atende todas; o que falta é a tela. Cada uma responde com uma página que
**diz** isso, em vez de sumir do menu.

**Teste de ponta a ponta com navegador (Playwright): zero.** O que há é teste de
componente e de esqueleto em jsdom, e teste de HTTP no backend.

**Auditoria de acessibilidade com ferramenta: não rodada.** As regras da WCAG 2.2 estão
implementadas e testadas uma a uma — foco visível, alvo de 44 px, estado nunca só por cor,
erro que não evapora, foco que volta a quem abriu o diálogo —, mas isso não substitui uma
varredura.

**Digest de notificações e automação com gatilho de agenda:** falta a função de domínio.

**Suíte de PostgreSQL real não roda na integração contínua:** depende de um contêiner que
só existe na máquina de desenvolvimento. Enquanto isso, é verificação manual — e
verificação manual é verificação que alguém apressado pula.

**Vulnerabilidades de dependência:** `npm audit` reporta 8, sendo 2 de severidade alta
(`multer`, via `@nestjs/platform-express`). A correção exige atualização com quebra de
compatibilidade do NestJS, que não cabia no meio desta sessão.

---

## 12. Bloqueios ativos

**Um só:** o acesso ao projeto Supabase `egoajboqzhnvkpenrszw`. Detalhado na seção 4.

Ele bloqueia **apenas** a Fase 3 (aplicar migrations no remoto e validar lá). Todo o resto
seguiu — inclusive tudo o que dependia de PostgreSQL real, que passou a rodar localmente.
