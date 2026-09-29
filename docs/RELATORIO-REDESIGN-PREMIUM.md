# Relatório — redesenho premium da experiência

**Data:** 29 de setembro de 2026 · **Repositório:** `voceconectadigital/technecaremeds`
**Frente:** transformação da experiência do painel administrativo (`apps/web`)

---

## 1 · Diagnóstico inicial

O sistema funcionava e parecia um MVP administrativo. O diagnóstico do cliente
listou dezessete pontos; agrupados, eles são três problemas — e nenhum era
"faltou capricho".

### Problema 1 — a escala tipográfica estava achatada

A escala era 1.2 uniforme. Isso mantém a densidade da tabela, que é correta
para uma lista de duzentas ordens, e **achata o topo**: título de cartão em
16px, de página em 22px, corpo em 14px. Nada na tela dizia "isto é importante".

Hierarquia não é o tamanho do corpo; é a **distância** entre o corpo e o
título. Com todos os tamanhos vizinhos, a página vira um muro uniforme e a
pessoa lê tudo ou nada.

### Problema 2 — nenhuma profundidade

A regra original — "a separação é a borda, não a sombra" — está certa para
lista e tabela, e tinha virado "nada tem sombra". Uma tela inteira de
retângulos de 1px sobre um fundo quase igual não tem planos, e é metade da
razão de o produto parecer plano.

### Problema 3 — havia componentes de controle, quase nenhum de dados

O design system tinha botão, campo, diálogo, aba, chip. Não tinha **nada** para
apresentar informação: nenhum cartão de indicador, nenhum gráfico, nenhuma
miniatura, nenhuma barra de ferramentas. O resultado é o que se via:

- números soltos sem referência ("5" — muito ou pouco?);
- listas de texto concatenado com pontos, ilegíveis em volume;
- cada tela inventando o próprio espaçamento e a própria barra de filtros;
- estoque como planilha, sem imagem;
- indicadores anunciando "formato ainda não apresentado nesta tela".

### O que NÃO era problema

A fundação. Tokens semânticos, contraste conferido degrau a degrau, foco
visível, estado nunca comunicado só por cor, alvo de toque de 44px, `<h1>`
único por tela, marcos de página. Isso tudo foi **preservado** — e foi ele que
permitiu que a suíte de acessibilidade encontrasse os três defeitos que o
redesenho introduziu.

---

## 2 · Estratégia

**Evoluir, não substituir.** Recalibrar os tokens que existiam, acrescentar os
componentes que faltavam, e reescrever as telas sobre essa base — em vez de
começar um design system do zero, que jogaria fora acessibilidade conquistada
com trabalho medido.

Em quatro ondas, cada uma validada no navegador antes da seguinte:

1. tokens e componentes novos;
2. shell (barra lateral, cabeçalho de página) e a tela inicial;
3. estoque, incluindo modelo, API, imagens e seed;
4. as demais telas, e a massa de demonstração.

---

## 3 · Telas atacadas

| Tela | Antes | Depois |
| --- | --- | --- |
| **Hoje** | 2 cartões, muito espaço branco | 5 indicadores com tom e atalho, rosca de distribuição, o que precisa de data, paradas em barras, estoque crítico |
| **Solicitações** | linhas de texto com 2 chips | faixa de 4 números, barra de urgência na borda, alerta de pedido envelhecido |
| **Ordens de serviço** | cartão com título, número e prioridade | + local, data com destaque de atraso, "sem responsável", ponto de categoria na coluna, contagem em pastilha |
| **Agenda** | "três caixas" | faixa com tom por urgência, baldes com explicação, cartões com responsável, horário, duração e remarcações |
| **Ativos** | frase concatenada com pontos | colunas alinhadas: nome, fabricante/modelo, local, identificadores monoespaçados, garantia quando é notícia |
| **Estoque** | lista de texto | **grade de cartões com imagem**, categoria, situação em 4 níveis, barra de cobertura do mínimo |
| **Contratos** | lista simples | barra de vigência, aviso de vencimento, renovação automática visível |
| **Indicadores** | 5 métricas dizendo "formato ainda não apresentado" | todas apresentam, com nulo distinto de zero e cobertura à vista |

---

## 4 · Componentes novos

Em `packages/ui`, todos documentados em `docs/AI-HANDOFF.md` §20-A.

| Componente | A decisão que ele carrega |
| --- | --- |
| `Metric` / `MetricGrid` | `value={null}` desenha traço, **nunca zero** — um mês sem amostra não teve excelência. `coverage` fica visível, não atrás de um ícone de ajuda |
| `BarChart` | barras **horizontais**: os rótulos deste domínio são frases, e em barra vertical viram texto de 45° que ninguém lê |
| `DonutChart` | só para composição de um todo; o olho compara comprimento bem e ângulo mal |
| `Sparkline` | sem eixo e sem grade: responde "para onde", não "quanto" |
| `Thumb` | o vazio é **desenhado** — iniciais sobre cor estável derivada do nome. Ninguém fotografa 3 mil itens num sábado, e um ícone cinza em 90% das linhas faz a lista parecer quebrada |
| `Section` `Toolbar` `FilterChip` `StatStrip` `FieldPair` | a gramática que arruma os blocos. Sem ela, cada tela inventa a própria — e o produto parece montado por pessoas diferentes |

**Gráficos em SVG à mão, sem biblioteca.** São três formas simples; uma
biblioteca custaria 40–150 kB comprimidos e traria o próprio sistema de temas,
que discordaria do nosso na primeira cor. O aplicativo de campo funciona
offline: cada kilobyte precisa ter descido antes de a pessoa entrar no
elevador. Todos têm alternativa textual.

---

## 5 · Mudanças estruturais

### Tokens

- **Escala dupla**: base operacional preservada (11–16px), aberta a partir de
  19px até 49px. `tracking-display` (entreletra negativa) acima de 24px.
- **`shadow-card`**: elevação de dois estágios, piso de todo `Card`.
- **`surface-subtle`**: o degrau que faltava entre janela e cartão.
- **`--color-data-1..6`**: paleta de dados **separada** das semânticas.

### Nenhuma regra de segurança ou domínio foi tocada

Auth, RBAC, RLS, multitenancy, contratos de API, máquina de estados, motor de
documentos, fila offline: intactos. As duas alterações de contrato foram
**correções de mentira**, descritas em §6.

---

## 6 · Estoque: modelo, API, imagens e seed

**Migration `0046`** — `image_key` e `category` em `inventory_items`.

`image_key` é **onde** a imagem está, não os bytes: foto em coluna de banco é
backup que ninguém restaura, e é a decisão já tomada para anexos (§28). Uma
restrição de tabela **recusa URL absoluta**, e isso não é preciosismo: o erro
provável é alguém colar `https://fornecedor.com/foto.jpg`, que parece
funcionar, some quando o fornecedor muda o site, e entrega o endereço IP de
quem abre a tela a um terceiro a cada carregamento.

`category` é texto livre de propósito. Categoria de peça é vocabulário de
almoxarifado, muda por cliente, e exigir cadastro prévio faria toda importação
de planilha parar na primeira linha com categoria nova. Quando alguém pedir
curadoria, vira FK.

**API**: `StockBalance` ganhou `unit`, `category` e `image_url`. A chave vira
endereço numa função só, na borda HTTP — a tela não sabe onde os bytes moram.

**Imagens**: 13 ilustrações SVG **próprias** em `apps/web/public/catalogo`,
somando 13 kB — menos que uma única fotografia de produto. Usam os tokens do
tema, então acompanham claro e escuro. **Elas não substituem a foto real**: são
o catálogo de partida, e o que continua aparecendo para o item que ninguém
fotografou. O `LEIA-ME.md` da pasta explica.

**Tela**: grade de cartões com imagem, nome em duas linhas (o fim do nome de
uma peça costuma ser o que identifica: a bitola, a via, a tensão), código,
almoxarifado, categoria, disponível em número grande, barra de cobertura e
situação em **quatro níveis** — zerado, crítico, baixo, normal. "Abaixo do
mínimo" sozinho juntava dois casos que pedem ações opostas: 4 de 10 é comprar
esta semana; zerado é a próxima OS travando.

---

## 7 · Massa de demonstração

| | Antes | Depois |
| --- | --- | --- |
| Itens de estoque | 5, sem categoria nem imagem | **12**, com categoria e imagem |
| Mínimos definidos | 2 | **12** |
| Movimentos de consumo | 0 | 4 — sem eles o extrato tem uma linha e a gaveta não mostra nada |
| Ordens agendadas | 0 | **3**, em janelas relativas a agora |
| Contratos | 2 em rascunho | 2 **vigentes** |

**As janelas são relativas a `agora`, não datas fixas.** Uma massa com
"14/09" envelhece: em duas semanas a demonstração mostraria tudo atrasado.

**O agendamento passa por `scheduleWorkOrder`**, que confere ausência e
jornada. Semear por fora produziria uma agenda que a própria aplicação
recusaria criar. A recusa é tolerada de propósito — a ordem fica sem data, que
é estado legítimo — em vez de a massa morrer por causa de um feriado.

**Os contratos são ativados por `activateContract`**, que recusa contrato sem
cobertura. Um contrato em rascunho não cobre nada: a cascata de SLA não o
encontra e a medição não tem o que medir. A massa vivia num estado que nenhuma
operação real tem.

**Um item fica deliberadamente sem imagem** — é ele que prova, na
demonstração, que o item sem foto continua legível.

Tudo continua marcado como homologação: organizações com `[HOMOLOGAÇÃO]` no
nome, e-mails em `@homologacao.aurora.test`, pessoas com nome de função.
**Nenhum dado real.**

---

## 8 · Cinco defeitos reais encontrados

Nenhum foi introduzido por esta frente — três já existiam e dois eram do
próprio redesenho.

1. **Os indicadores não estavam incompletos: a tela não sabia lê-los.** Cinco
   mostravam "formato ainda não apresentado nesta tela", o que soava como
   pendência de produto. Era um `if` que nunca casava: a API devolve
   `{value, samples}`, `{met, breached, rate}`, `{expected, done, skipped}` e
   `{preventiveShare}`, e o apresentador só conhecia `{count}` e `{average}`.
   Os números chegavam ao navegador; a tela anunciava a própria limitação.

2. **O contrato da agenda mentia.** `AgendaBucketItem.bucket` declarava
   `unscheduled | overdue | today`; o servidor devolve `late | unscheduled |
   to_reschedule`, que é o que `SCHEDULE_BUCKETS` define. Nenhum dos dois
   inventados existe. Sobreviveu porque nenhuma tela lia o campo — a primeira a
   ler encontrou três baldes vazios com os dados todos presentes na resposta.

3. **Contraste na miniatura** (encontrado pela suíte de acessibilidade). As
   iniciais usavam `--color-data-N` puro; o âmbar dá ~3,5:1 sobre fundo claro,
   abaixo dos 4,5:1 da WCAG AA. **Cinco das seis cores passavam** — é esse tipo
   de falha parcial que atravessa uma revisão visual.

4. **Alvo de toque** abaixo de 24×24 nos atalhos dos cartões de indicador.

5. **Um teste amarrado à decoração.** `acesso.spec` exigia `/Bom dia|Hoje/` no
   `<h1>`, e a saudação passou a seguir o relógio. A asserção virou o **nome**,
   que é o que ela existe para provar. Uma prova que só passa de manhã falha
   sozinha na CI e ninguém sabe se o produto quebrou.

---

## 9 · Testes e portões

```
npm run verify
  spec:audit ✓ · typecheck ✓ · lint ✓ · marca ✓ · openapi ✓
  1707 testes passando | 32 pulados | 88 arquivos

npx playwright test
  147 passando | 1 pulado | 3 perfis (desktop, portal, campo)
  inclui a suíte de acessibilidade (axe) e a de larguras (1440/1024/768/390)

node tools/ci/check-secrets.mjs
  ✓ nenhum segredo detectado
```

A suíte de acessibilidade e a de larguras **encontraram** dois dos cinco
defeitos acima. Elas não são formalidade.

---

## 10 · Validação visual

Percorrida no navegador, com a massa de demonstração, após a implementação:

| Tela | Resultado |
| --- | --- |
| Entrar | pede e-mail e senha, sem aviso de desenvolvimento |
| Hoje | 5 indicadores (1 atrasada em vermelho), rosca, triagem, agenda, paradas, estoque crítico |
| Solicitações | faixa de 4 números, 3 pedidos com barra de urgência e chips |
| Ordens de serviço | Kanban com ponto de categoria, cartões com local, data e "Atrasada" |
| Agenda | 4 números, 3 baldes com explicação, cartão com horário/duração/responsável |
| Ativos | 6 equipamentos em colunas alinhadas, patrimônio monoespaçado |
| Estoque | 12 itens com imagem, 5 abaixo do mínimo com gradação crítico/baixo |
| Contratos | 2 vigentes com barra de vigência |
| Orçamentos | 1 orçamento |
| Indicadores | 9 métricas, **nenhuma** com "formato ainda não apresentado" |
| Configurações | 9 pessoas com papel |

**Nenhuma tela quebrou.**

---

## 10-A · ⚠️ A senha de demonstração entrou no histórico do Git

**Isto precisa de uma ação sua, e é o item mais importante deste relatório.**

Ao varrer o repositório procurando a senha da conta de demonstração, ela
apareceu num lugar que ninguém procuraria: um **exemplo de caso de teste**.

`packages/domain/src/__tests__/senha.test.ts` usava a senha real como exemplo
de "senha que contém o nome do produto" — exatamente a regra que ela viola. Foi
escrito na frente anterior, no commit `9398762`, **que já está no remoto**.

**O que foi feito:** o exemplo foi trocado por uma cadeia que exercita a mesma
regra sem ser a senha real. O estado atual do repositório está limpo, e a
varredura de segredos confirma.

**O que NÃO foi feito, e por quê:** o commit `9398762` continua no histórico.
Tirá-lo de lá exige reescrever o histórico e forçar o envio — operação
destrutiva sobre um remoto compartilhado, que não faço sem pedido explícito.

**O remédio certo é outro, e é barato:** a conta é temporária e a senha é fraca
por decisão declarada. **Troque-a**, e o que está no histórico deixa de valer:

```bash
npm run admin:criar
```

Enquanto a senha atual estiver em uso, considere-a conhecida por qualquer
pessoa com acesso de leitura ao repositório.

---

## 11 · Pendências

| Pendência | Situação |
| --- | --- |
| **Portal e Field** | Não foram redesenhados. O escopo desta frente era o painel administrativo; eles usam o mesmo design system e herdaram tokens e elevação, mas as telas não foram retrabalhadas |
| **Ficha da OS** (`ordens/ficha.tsx`, 967 linhas) | A maior tela do sistema. Recebeu a calibração global, não uma revisão própria |
| **Gráfico de série temporal** | A API entrega números de período, não séries. Interpolar pontos desenharia uma tendência que o dado não sustenta — o `Sparkline` existe e espera a rota |
| **Tendência nos indicadores** | `MetricTrend` existe e **não é usado**: exigiria comparar com o período anterior, e a rota não devolve isso. Desenhar uma seta sem dado seria decoração |
| **Foto real de peça** | O caminho está pronto (`image_key` + `image_url`). Falta a tela de upload — hoje a imagem entra pelo seed ou por escrita no banco |
| **Colunas vazias no Kanban** | Ocupam a mesma largura das cheias. É legível e não ideal em organizações com muitas situações |

---

## 12 · Como subir e demonstrar

```bash
# 1. banco
docker start aurora-postgres

# 2. massa + conta (só na primeira vez, ou para recriar)
npm run homolog:semear -- --reset
npm run admin:criar

# 3. API
node tools/e2e/api.mjs

# 4. interface
VITE_API_URL=http://localhost:3011/v1 \
  npx vite --config apps/web/vite.config.ts --port 5411
```

**Sistema:** `http://localhost:5411` · **Login:** `/login` ·
**Usuário:** `admin.demo@becare.local`

As variáveis ficam em `.env.local`, que o Git ignora. A senha da conta de
demonstração foi combinada por escrito e **não está neste documento nem no
repositório**.

### Roteiro sugerido de demonstração

1. **Hoje** — o estado do turno num relance; clique em "Ver agenda" a partir de
   "Atrasadas".
2. **Estoque** — abra na aba "Abaixo do mínimo": é a tela que mais mudou.
   Repare na gradação crítico/baixo e no item sem foto.
3. **Ordens de serviço** — o quadro; arraste um cartão entre colunas.
4. **Agenda** — os três baldes e o que cada um significa.
5. **Indicadores** — todo número traz a definição no ícone de ajuda.
