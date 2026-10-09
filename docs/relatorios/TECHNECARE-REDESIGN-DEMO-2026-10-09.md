# Téchne Care — Redesign futurístico, temas, logo iTech, Clientes e massa demo (2026-10-09)

Relatório técnico da rodada de evolução de experiência e demonstração comercial. Serve de histórico e de ponto de
continuidade para a próxima sessão/engenheiro. Não contém senhas, tokens ou segredos.

---

## 1. Resumo executivo

**Objetivo da rodada.** Transformar a Téchne Care — já em produção desde a madrugada de 2026-10-09 — numa demo
comercial forte: visual premium e "do futuro", UX autoexplicativa para quem nunca viu o produto, identidade visual
nova e dados de demonstração coerentes.

**Pedido do Anderson.** Que o sistema "bata o olho e sinta que é do futuro", com inspiração em BYD/Tesla, painéis,
HMIs (interfaces homem-máquina), infográficos e dashboards; tema futurístico como principal, com previsão de temas
**Mindfulness** e **Wellness** escolhíveis pelo usuário; e troca da logo pelo arquivo
`iTech_logo_principal_unificada.webp`.

**Resultado.** Entregue e publicado:

- três temas reais (Futurístico padrão, Mindfulness, Wellness) com seletor na barra superior;
- logo iTech aplicada em web, portal, campo, favicon e ícones do PWA, com variante para fundo escuro;
- menu reorganizado por fluxo, tela **Clientes** com cadastro, CTA "Novo cliente" na nova solicitação;
- tela **Hoje** com indicadores em estilo HMI e a faixa **Fluxo da operação**;
- estados vazios que explicam "de onde vem" o dado e qual a próxima ação;
- organização **TéchneCare Demo** populada com uma massa coerente (hospital → setor → equipamento → solicitação →
  OS → agenda → estoque → indicadores).

**Status da produção.** No ar, com a API no commit `99b42f2` (runtime PostgreSQL VPS `pgv-pe0b9asx` no node
`apps-us-east-01`) e os três frontends republicados no Cloudflare Pages. Smoke pós-deploy aprovado.

---

## 2. Estado anterior

- **UX confusa para demonstração.** O menu era uma lista plana de 8 itens, sem indicar a ordem natural do trabalho.
  Nada dizia, na interface, que uma OS nasce de uma solicitação aceita na triagem.
- **Telas vazias.** A organização de demonstração em produção tinha apenas a conta titular: todas as telas abriam
  vazias, e os vazios genéricos não explicavam de onde viriam os dados.
- **Sem fluxo de clientes.** A tabela `aurora.customers` existia e havia `GET /customers`, mas não havia endpoint de
  criação nem tela. Também não havia tela de criação de local, ativo, contrato ou item de estoque — só a importação de
  ativos por planilha.
- **Identidade anterior.** Logo "Téchne Care" (`technecare-horizontal.png` / `technecare-simbolo.png`, 272 px), que
  no tema escuro precisava de uma "placa branca" atrás para ter contraste.
- **Temas.** Apenas claro/escuro/sistema (`aurora:tema`), sem personalidade visual própria.
- **Limitações encontradas.** O produto usa fontes do sistema de propósito (o app de campo funciona offline);
  não há componente de tabela compartilhado; os gráficos são SVG próprios (`packages/ui/src/components/charts.tsx`).

---

## 3. Nova identidade visual

**Direção Futurística.** Painel premium de veículo elétrico: fundo preto-azulado profundo, superfícies em degraus
sutis, azul elétrico preciso como cor de interação, o verde-lima da marca como acento, títulos e números em face de
painel (Bahnschrift/DIN, com *fallback* para a fonte do sistema), cartões com faixa luminosa no tom do indicador e
brilho de canto discreto, barra superior e menu em vidro (`backdrop-blur`). Sem neon caótico: a luz ambiente fica em
gradientes radiais de baixíssima opacidade, fixos no fundo, nunca atrás do texto.

**Referências.** BYD/Tesla (painéis de bordo limpos, números grandes, poucos elementos), HMIs industriais
(indicadores por estado, cápsulas de ícone no tom, leitura em um golpe de vista) e dashboards contemporâneos.

**Logo usada.** `iTech_logo_principal_unificada.webp` da pasta Downloads (o arquivo mais recente, de
2026-10-09 01:47; 385×148, sem perdas, com transparência). As cores da marca foram medidas por histograma dos pixels:
verde-lima `#78C018`, azul `#4A7FC4`, marinho `#30304A`.

**Variantes geradas** (com `sharp`, sem redesenhar a marca):

| Arquivo | Uso |
|---|---|
| `itech-logo.webp` | logo original, temas claros |
| `itech-logo-escuro.webp` | só o marinho trocado por um tom claro (`#E6EDF7`), para o tema escuro |
| `itech-simbolo.png` / `itech-simbolo-escuro.png` | símbolo (molécula), sem o texto "BeCare", 150×150 |
| `itech-icone-180.png` | apple-touch-icon |
| `itech-icone-192.png` / `itech-icone-512.png` | ícones do PWA do campo |

**Favicon.** `<link rel="icon">` aponta para `itech-simbolo.png` nos três `index.html` (gerado por `npm run marca`),
com `apple-touch-icon` adicional.

**Onde foi aplicada.** Menu lateral e login do web; logins do Portal e do Campo (antes sem logo); favicons dos três
apps; manifesto do PWA do campo (ícones e `theme_color` `#070a10`). Os arquivos antigos `technecare-*.png` foram
removidos de `apps/*/public/marca`.

**Como a troca claro/escuro da logo funciona.** O componente `Logo` (`packages/ui/src/components/logo.tsx`) recebe
`src` e `srcEscuro`; renderiza as duas imagens e o CSS mostra a correta conforme `data-theme`, antes de o React montar.
As duas têm `alt` com o nome do produto (a oculta, `display:none`, sai da árvore de acessibilidade).
A configuração vive em `marca.config.json` (`logoHorizontal`, `logoHorizontalEscuro`, `logoSimbolo`,
`logoSimboloEscuro`, cores e `theme-color`); `tools/marca/aplicar.mjs` passou a gerar também as duas variantes escuras
na constante `MARCA`.

---

## 4. Sistema de temas

**Arquitetura.** Dois atributos no `<html>`:

- `data-estilo` = `futuristico` | `mindfulness` | `wellness` → personalidade (paleta, superfícies, bordas, sombras,
  face de destaque, atmosfera do fundo, cores de dados);
- `data-theme` = `dark` | `light` → luminosidade, **derivada do estilo**. Mantido para que todo o CSS que já sabia
  escurecer continue valendo; cada estilo declara só a diferença.

| Estilo | Modo | Sensação | Base | Interação | Acento da marca | Face de destaque |
|---|---|---|---|---|---|---|
| Futurístico (padrão) | escuro | premium, high-tech, preciso | `#070a10` / superfície `#0d121b` | `#6cb8ff` | `#8ed13a` | Bahnschrift, DIN |
| Mindfulness | claro | calmo, equilibrado, contemplativo | `#f3f1ec` / `#fbfaf7` | `#4e5c96` (índigo) | `#6e8f72` (sálvia) | serifa (Iowan, Palatino, Georgia) |
| Wellness | claro | limpo, acolhedor, humano | `#f2f7f5` / `#ffffff` | `#0b7a70` (verde-água) | `#3e9b4f` | Segoe UI Variable Display, Avenir |

**Tokens.** Tudo em `packages/ui/src/styles/tokens.css`, em blocos `:root[data-estilo='…']` dentro de
`@layer theme`, sobrescrevendo os tokens semânticos existentes (`--aurora-bg`, `--aurora-surface*`, `--aurora-border*`,
`--aurora-text*`, `--aurora-accent*`, `--aurora-brand-accent*`, `--aurora-good/warn/bad/info*`, `--aurora-data-1…6`,
`--aurora-shadow-*`, `--aurora-focus-ring`). Novos tokens: `--aurora-glow` e `--aurora-font-display`, mapeados no
Tailwind como `shadow-glow` e `font-display`. `h1`, `h2` e `[data-display]` usam a face de destaque do estilo.

**Persistência.** `localStorage['aurora:estilo']`; ausente ou inválido → Futurístico. A chave antiga `aurora:tema`
deixou de ser lida (todos começam no tema principal pedido).

**Pré-pintura.** Script inline nos três `index.html` aplica `data-estilo`, `data-theme` e `color-scheme` antes do
React — sem "piscar" no carregamento.

**Contraste/acessibilidade.** Antes de aplicar, cada par texto/fundo foi conferido em WCAG AA (≥ 4,5:1) sobre `bg`,
`surface`, `raised` e `subtle`. Menores razões encontradas: Futurístico 5,93 (texto sutil), Mindfulness 5,60,
Wellness 5,21; texto sobre a cor de interação: 8,94 / 6,37 / 5,21. Nenhum par abaixo de 4,5. A suíte E2E de
acessibilidade (axe, inclui contraste) passou na CI com o tema novo como padrão.

**Theme switcher.** Botão de paleta na barra superior (rótulo visível a partir de `xl`), com os três estilos, nome e
descrição, marca do atual; troca imediata e lembrada. API em `packages/app-kit/src/theme.tsx`: `useTheme()` →
`{ tema, estilo, definir(estilo), alternar() }`; exportados `ESTILOS`, `ESTILO_PADRAO`, `modoDoEstilo`.

---

## 5. UX e navegação

**Menu reorganizado** (`apps/web/src/shell/navigation.ts`, campo `grupo`) em três seções que contam a história:

| Operação | Cadastros | Inteligência |
|---|---|---|
| Hoje · Solicitações · Ordens de serviço · Agenda | Clientes · Ativos · Estoque · Contratos | Indicadores |

Configurações segue no rodapé. Item ativo com faixa e ícone no tom da interação; bloco da organização com indicador
pulsante "Operação ao vivo".

**Clientes.** Novo item no menu e tela `/clientes`: resumo (clientes atendidos, locais mapeados, equipamentos sob
gestão), busca, lista com segmento, CNPJ, código, nº de locais e de ativos.

**Novo cliente.** Diálogo compartilhado (`features/clientes/novo-cliente.tsx`): Nome, Nome fantasia, CNPJ, Código,
Segmento. Após salvar, oferece criar a primeira **Unidade** (para quem tem `location.create`).

**Nova solicitação.** Botão "Novo cliente" ao lado do seletor (para quem tem `customer.create`); o cliente criado já
fica selecionado. Não aparece em organização que atende só a si mesma (o seletor é escondido nesse caso).

**Fluxo real de OS** (agora explícito nos subtítulos, vazios e na tela Hoje):
Solicitação (portal, campo ou web) → **Triagem** (aceitar = vira OS; recusar; devolver pedindo informação) →
OS aberta → **Agenda** (técnico + horário) → Em execução / aguardando → Concluída → **Indicadores**.
Planos preventivos também abrem OS. `POST /work-orders` (criação manual) existe na API, mas não é o caminho principal e
não tem tela.

**Estados vazios.** `EmptyState` ganhou a prop `origem` ("De onde vem") e ícone com halo. Reescritos em Ordens
(com atalho "Ver solicitações para triar"), Solicitações (atalho "Abrir solicitação"), Ativos, Estoque e Contratos.

**Tela Hoje.** Cinco indicadores HMI (Em aberto, Atrasadas, Paradas, Sem data, Peças abaixo do mínimo) numa grade
equilibrada de 5 colunas (antes o 5º card ficava sozinho), e a faixa **Fluxo da operação** logo abaixo.

**Login.** Layout dividido: vitrine à esquerda (proposta de valor, quatro capacidades — sem números inventados — e uma
constelação animada que ecoa os nós da logo, desligável por "menos movimento") e formulário em vidro à direita. Campos
e rótulos inalterados.

---

## 6. Clientes e API

**Endpoints adicionados/alterados** (`apps/api/src/directory/*`, contratos em
`packages/contracts/src/operations/directory.ts`, `docs/openapi.json` regenerado):

| Endpoint | Permissão | Comportamento |
|---|---|---|
| `POST /v1/customers` | `customer.create` | valida pelo contrato; campos vazios → `null`; CNPJ (14) ou CPF (11) com ou sem pontuação; `is_internal` recusado (422); nome repetido (sem diferenciar caixa) ou código repetido → 409 com o campo |
| `GET /v1/customers/:id` | `customer.read` | cliente + locais, recortados pelo escopo da pessoa; fora do escopo → 404 |
| `GET /v1/customers` | `customer.read` | passou a trazer `tax_id` e `asset_count` |
| `POST /v1/locations`, `GET /v1/location-types` | já existiam | ganharam contrato; `parent_id: ""` agora é recusado (422) |

Testes: `apps/api/src/__tests__/api-clientes.test.ts` (9 casos). As respostas gravadas do modo demo
(`apps/web/src/demo/capturas.json`, `customers.list`) foram completadas com os dois campos novos.

**Limitações que ainda existem.** Não há ficha do cliente (o `GET /customers/:id` existe, mas a linha da lista não abre
nada), nem edição ou arquivamento. Quem tem acesso restrito a alguns clientes consegue cadastrar um novo, mas não o vê
na lista (o escopo não é ampliado automaticamente — decisão deliberada). Locais e ativos continuam sem tela de
criação (ativos entram por importação de planilha).

---

## 7. Dashboards / HMI / visualização

- **Cartões de indicador (`Metric`, usado em todo o sistema).** Faixa superior no tom, brilho radial de canto no tom
  (`*-soft`), ícone em cápsula colorida, número grande na face de destaque com `tabular-nums`, elevação sutil no hover
  (desligada com "menos movimento"). `MetricGrid` ganhou 5 colunas.
- **Indicadores.** A tela herdou a nova tipografia e as cores de dados de cada estilo (donut preventiva × corretiva,
  séries). Com a massa demo, backlog, MTTR, SLA, primeira resposta e tempos por situação deixam de ser zero.
- **Fluxo da operação** (`apps/web/src/routes/hoje-fluxo.tsx`). Cinco etapas numeradas com número ao vivo, ícone por
  estado e atalho para a tela onde cada etapa é tratada (Solicitações → OS abertas → Agendadas → Em execução →
  Concluídas), sobre uma trama de painel sutil. Reaproveita as consultas que a tela já fazia (quadro de OS e fila de
  triagem com o mesmo recorte de 6 → mostra "6+"), sem ida extra ao servidor.
- **Clientes.** Faixa-resumo com três indicadores.
- **Superfícies.** Atmosfera de fundo por estilo, barra superior e menu em vidro, sombras com anel interno no
  Futurístico.

---

## 8. Seed DEMO

**Ferramenta.** `tools/demo/semear-org.mjs` — semeia **uma organização existente**:
`node tools/demo/semear-org.mjs --org=<slug>`. Usa `tools/lib/fonte.mjs` (funciona com tsx em desenvolvimento e com
`dist/` na imagem) e confere o destino com `tools/db/destino.mjs`.

**Execução em produção (2026-10-09).** Rodada uma vez no runtime `pgv-pe0b9asx`, dentro do container `migrate`
(superusuário do banco dedicado, `AURORA_AMBIENTE=producao`), com o script montado em
`/app/tools/demo/semear-org.mjs`, para `--org=technecare-demo`, **depois de um backup verificado**. O script montado
foi removido do node em seguida.

**Totais da organização TéchneCare Demo após a execução:**

| Entidade | Quantidade |
|---|---|
| Clientes | 4 — Hospital Santa Clara, Hospital São Lucas, Clínica Vida Plena, Instituto do Coração |
| Locais (unidade → prédio/andar → setor → sala) | 27 |
| Equipamentos médicos | 15 |
| Solicitações | 10 (5 na fila de triagem) |
| Ordens de serviço | 17 (4 de solicitações aceitas, 11 criadas direto, 2 de plano preventivo) |
| Compromissos na agenda | 8 (horários relativos à data da execução) |
| Contratos vigentes | 3 (um vence em ~45 dias) |
| Itens de estoque | 14 |
| Abaixo do mínimo | 4 |
| Ciclos de plano | 2 |
| Apontamentos de horas | 8 |
| Pessoas ativas | 6 |

**Pessoas demo** (fictícias, e-mail no domínio reservado `@demo.technecare.invalid`, **sem senha/credencial** — exceto Rafael Souza, que ganhou senha depois, ver §17):
Fernanda Alves (coordenação), Rafael Souza, Juliana Prado e Marcos Lima (técnicos), Beatriz Costa (solicitante do
portal), além da conta titular de demonstração criada no cutover.

**Detalhes de implementação relevantes.**

- Uma política de SLA 24×7 é criada valendo **só para os 4 clientes semeados** (sem ela nenhum relógio de SLA nasce).
- Para haver histórico, datas são recuadas dentro de uma única transação filtrada pelo id da organização, usando
  `session_replication_role = replica`, e a tabela de indicadores é reconstruída em seguida — por isso exige
  `DATABASE_URL` de superusuário (como o migrador).
- Os eventos gerados vão para o outbox; viram notificações dentro do app (as pessoas fictícias não têm e-mail
  verificado).

**Idempotência.** Marcador: cliente com código `DEMO-HSC`. Se existir, o script imprime "já semeado", mostra as
contagens e sai com 0 sem alterar nada. Se a organização já tiver cliente com um dos quatro nomes sem o marcador, ele
recusa sem escrever. Toda a massa de negócio entra numa transação, com *savepoint* por item (uma recusa vira aviso).

**Restrição ao tenant demo.** `--org` obrigatório; organização inexistente ou sem titular/admin → recusa. Com
`AURORA_AMBIENTE=producao`, só aceita slugs da lista fixa `['technecare-demo']`. Nenhuma outra organização é tocada.

**Validação.** Testado antes num PostgreSQL 16 descartável no node com a imagem de produção: 1ª execução com as
contagens acima e nenhum passo recusado; 2ª execução "já semeado"; produção + slug fora da lista → recusa (código 1);
sem `--org`, slug inexistente e organização sem titular → recusa. Nesse teste, os indicadores calculados pelas
funções da API deram backlog 12, MTTR 1000 min (3 amostras), SLA 81% e primeira resposta média de 57 min. Ambiente
descartável removido depois.

---

## 9. Arquitetura preservada

Nenhuma migration foi criada ou alterada nesta rodada.

| Área | Situação |
|---|---|
| PostgreSQL | mesmo runtime dedicado (`pgv-pe0b9asx`), mesmas 59 migrations |
| RLS / FORCE RLS | inalterados; os endpoints novos usam as sessões de tenant existentes |
| RBAC | `POST /customers` exige `customer.create`; CTAs da UI escondidos sem permissão; smoke de produção: admin 200 em membros, sem token 401 |
| Isolamento de tenant | `GET /customers/:id` respeita o escopo (fora → 404); smoke: organização alheia → 403; o seed só escreve na organização informada |
| Sessões (`user_sessions`) | login, sessão persistida e logout/revogação aprovados no smoke |
| pg-boss / workers | login próprio dos workers mantido; sem jobs falhos após a mudança |
| HostPanel | API publicada pela ação `deploy` do runtime (fluxo oficial), saúde 100% |
| Backup | backup VERIFIED com cópia offsite antes do seed |
| Pages / API | três projetos Pages republicados; CORS restrito às três origens de produção mantido |

---

## 10. Testes e validações

- **Typecheck.** `tsc -b` da raiz limpo (atenção: `tsc -p apps/web` sozinho lê tipos antigos em `dist` — usar `-b`).
- **Lint / formatação / gates do repo.** eslint sem erros nos arquivos alterados; prettier conferido nos arquivos
  alterados; `npm run marca:check`, `npm run openapi:check` e `tools/ci/check-secrets.mjs` aprovados.
- **Testes focados.** `packages/ui`, `packages/app-kit`, `apps/web`, `packages/contracts`, `packages/config`,
  `api-clientes` e `proxy-confiavel`: 127 testes aprovados localmente. O teste do menu (`shell.test.tsx`) foi
  atualizado para 9 itens.
- **CI completa (PR #6).** A primeira rodada reprovou 7 testes E2E: a logo não era encontrada como imagem (variante
  escura com `alt` vazio) e a 390 px a barra superior estourava 11 px no Linux (busca sem `min-w-0` ao lado do
  seletor de tema). Ambos foram corrigidos no commit `c74fd2f`; a rodada final passou em **Estático**,
  **Testes contra PostgreSQL 16** e **Ponta a ponta**.
- **Acessibilidade e contraste.** Specs de acessibilidade (axe, com contraste) aprovadas na CI; conferência WCAG AA
  dos três estilos feita antes da aplicação (seção 4).
- **Responsividade.** `viewports.spec.ts` (1440, 1280, 1024, 768 e 390 px) aprovado na CI; verificação manual a 375 e
  390 px no navegador.
- **Smoke visual.** Hoje, Ordens, Agenda, Ativos, Estoque, Indicadores, Clientes, login do web e do portal, nos três
  estilos (Futurístico, Mindfulness, Wellness), em modo demonstração local.
- **Produção.** Após os deploys: saúde, login, sessão, organização, RBAC, isolamento de tenant e logout aprovados;
  conteúdo da demo visto pela API como a conta de demonstração (4 clientes, 15 equipamentos, 17 OS, 5 na fila de
  triagem, 3 contratos, 14 itens, 4 abaixo do mínimo; indicadores respondendo 200); os três domínios servem o build
  novo, com a logo e o script de estilo.

---

## 11. PRs, commits e deploys

**Repositório `voceconectadigital/technecaremeds`:**

| PR | Commit(s) | Objetivo |
|---|---|---|
| #5 (hotfix do cutover) | `2da284c`, merge `9fe8147` | Sessão recusada pelo servidor (401) descarta a sessão guardada e volta para `/entrar` (o demo antigo deixara um token fictício no mesmo domínio). |
| #6 | `18dea44` | Redesign futurístico, temas, logo iTech, Clientes (API + tela + CTA), vazios, fluxo da operação, massa demo. |
| #6 | `d6de8fe` | Logo iTech nas entradas do Portal e do Campo. |
| #6 | `c74fd2f` | Correções dos E2E: `alt` na logo escura; busca da barra encolhe no celular. |
| #6 | merge `99b42f2` | Entrada na `main`. |

Contexto imediatamente anterior (mesmo dia, rodadas de implantação e cutover): PRs #1 a #4. Depois deste relatório:
PRs #8 e #9 (login do Campo, §17).

**Deploys desta rodada:**

- **API:** commit `99b42f230c105bc62be279eeba595ad7a7195bdd`, publicado pela ação `deploy` do HostPanel no runtime
  `pgv-pe0b9asx` (`apps-us-east-01`), saúde 100% e `/v1/health/ready` com `{"status":"ok"}`.
- **Backup antes do seed:** backup VERIFIED com cópia offsite do runtime de produção (id `b0eb97c2-…`), feito logo
  após o deploy da API e antes da massa demo.
- **Frontends (Cloudflare Pages, upload direto do commit `99b42f2`, com `VITE_API_URL` da API de produção):**
  `technecare-web`, `technecare-portal` e `technecare-field`.

---

## 12. Produção

| Aplicação | URL |
|---|---|
| Web (equipe) | https://technecaremeds.voceconecta.com.br |
| Portal do cliente | https://portal-technecaremeds.voceconecta.com.br |
| Campo (técnico, PWA) | https://campo-technecaremeds.voceconecta.com.br |
| API | https://api-technecaremeds.voceconecta.com.br/v1 |

Organização de demonstração: **TéchneCare Demo** (`technecare-demo`). Credenciais não constam deste relatório.

---

## 13. Rollback e segurança

- **Backup.** Backup VERIFIED com cópia offsite tirado antes do seed; restaurável pelo HostPanel
  (restore no próprio runtime ou drill descartável).
- **Rollback do frontend.** Cada projeto Pages mantém o histórico de deploys; voltar = promover o deploy anterior.
  O projeto Pages do demo antigo (`technecaremeds`) segue intacto como rollback do domínio principal.
- **Rollback da API.** Ação `deploy` do HostPanel com o commit anterior (`9fe8147`/`7dbf0f1`); a imagem anterior fica
  guardada no node.
- **Rollback da massa demo.** Restaurar o backup pré-seed (afeta só este runtime). O seed é idempotente e restrito a
  `technecare-demo`.
- **Proteção de tenant.** Seed com lista fixa em produção; endpoints novos dentro das sessões de tenant e do escopo.
- **Segredos.** Nenhum valor no repositório nem neste relatório; `check-secrets` aprovado. O token da Cloudflare usado
  nos deploys foi lido de arquivo local apenas no ambiente do processo.
- **Isolamento.** Banco sem porta pública; API pela borda do HostPanel; workers com login próprio.

---

## 14. Pendências honestas

1. **Clientes sem ficha individual e sem edição/arquivamento.** Cadastro e lista funcionam; o detalhe existe na API,
   não na tela.
2. **Limite da equipe demo.** As 4 pessoas de equipe semeadas + a titular fecham o `seat_limit` padrão de 5 da
   organização; convidar mais alguém para a demo exige aumentar o limite.
3. **Nome comercial.** A interface continua dizendo "Téchne Care" (títulos, manifesto). A logo agora é iTech/BeCare,
   mas o nome está marcado em `marca.config.json` como "A VALIDAR — nome comercial não aprovado pelo cliente";
   renomear é editar a configuração e rodar `npm run marca`.
4. **Sem tela de criação** de locais, ativos, contratos e itens de estoque (ativos por importação de planilha;
   contratos e estoque só via API/seed).
5. **Seed não vem na imagem.** `tools/demo/` não é copiado pelo `Dockerfile`; para rodar de novo é preciso montar o
   arquivo no container `migrate` (como foi feito).
6. **Rota `/clientes` fora das listas dos E2E** de acessibilidade e de console.
7. **Alerta de contrato vencendo** só aparece depois que o worker varre os contratos.
8. **Rótulo "Peças abaixo do mínimo"** quebra em duas linhas no card da tela Hoje em larguras intermediárias
   (cosmético).

---

## 15. Próximos passos recomendados

**P0**

- Ficha do cliente (unidades, ativos, contratos, solicitações) e edição.
- Definir o nome comercial (Téchne Care × iTech/BeCare) e aplicar via `marca.config.json`.

**P1**

- Telas de criação de local/unidade e de ativo (individual), e de contrato.
- Incluir `/clientes` nos E2E de acessibilidade/console e um E2E do seletor de tema.
- Copiar `tools/demo/semear-org.mjs` na imagem (ou documentar o comando oficial de reseed da demo).
- Ajustar o `seat_limit` da organização demo se houver mais pessoas.

**P2**

- Preferência de tema por usuário no servidor (hoje é por navegador).
- Fonte de destaque hospedada (hoje Bahnschrift existe só no Windows; Linux/macOS caem na fonte do sistema).
- Mais visualização em Indicadores (tendências por período, mapa de calor de backlog por setor).

---

## 16. Status final

| Item | Status |
|---|---|
| Visual (redesign) | PASS |
| Temas (Futurístico, Mindfulness, Wellness + seletor) | PASS |
| Logo iTech | PASS |
| Clientes (API + tela + CTA) | PASS |
| Fluxo de OS explícito | PASS |
| Demo populada | PASS |
| Indicadores | PASS |
| Build | PASS |
| Testes (CI completa) | PASS |
| Smoke (produção) | PASS |
| Deploy (API + 3 frontends) | PASS |
| Anderson Demo Ready | YES |

---

## 17. Adendo — login do Campo (mesmo dia, depois do relatório)

**Problema.** O app de campo só tinha o login de desenvolvimento (token `local:e-mail` e o identificador da
organização digitado à mão). A API de produção usa o provedor `password` e recusa esse token, então ninguém entrava
em `campo-technecaremeds`.

| PR | Commit(s) | Objetivo |
|---|---|---|
| #8 | merge `adc5f29` | Campo entra com e-mail e senha (`/auth/login`) e a organização vem das da conta (`/me/organizations`): uma só entra direto, várias viram escolha por nome. Mensagens para 401, 429 e sem rede. "Sair" revoga a sessão no servidor. Modo local mantido para desenvolvimento. 5 testes de componente. |
| #9 | merge `dc4c6c4` | A primeira sincronização disparava na tela de entrar, sem sessão (401), e não se repetia depois do login (dia vazio por até 60 s). Agora só sincroniza com sessão e sincroniza ao entrar e ao trocar de organização. E2E novo entra pelo formulário. |

**Deploy.** `technecare-field` publicado do commit `dc4c6c4` com `VITE_API_URL` de produção; o domínio serve o build
novo, e a tela de entrar só chama `/auth/config` (nenhum `/field/sync` sem sessão).

**Conta de técnico para demonstrar o Campo.** O pacote do Campo é por técnico: a conta titular é administradora, não
tem ordens atribuídas e vê o dia vazio. Por isso o técnico fictício **Rafael Souza** (`@demo.technecare.invalid`)
recebeu senha, com autorização. Só a credencial foi gravada (`aurora.definir_senha`). Papel, vínculo e dados da demo
ficaram como estavam. Não foi usado o `admin:criar`, que garante papel administrativo. Validado pela API: login 200,
organização única "TéchneCare Demo", pacote com 4 OS e 15 equipamentos. A senha fica em arquivo local, fora do
repositório e deste relatório.

| Item | Status |
|---|---|
| Login do Campo em produção | PASS |
| Sincronização após entrar | PASS |
| Técnico demo com dia no Campo | PASS |
