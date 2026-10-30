# Auditoria total e rodada de 29/10/2026 — Téchne Care

**Fontes:** reunião de 16/10/2026 (anotações do Gemini), WhatsApp de 16 a 29/10/2026 (sem áudios e imagens, que o export omite), as 7 fotos de tela enviadas em 29/10 e o inventário de 177 itens.
**Código:** `main` em `a852e7c` (PR #41) → branch `feat/rodada-2026-10-29`, **PR #42**.
**Status por item:** `docs/auditoria/technecare-status-requisitos.json`. **Ampliações (uso interno):** `docs/auditoria/AMPLIACOES_ESCOPO_ANDERSON.md`.

## Resposta curta

- **O que mudou:** os pedidos do WhatsApp que ainda faltavam estão feitos e testados na PR #42. São os de 23/10 (Store do dono, passo "Separado" e barra "onsite") e os de 19/10 que tinham ficado para trás: o layout do Basic, o Excel, o relatório patrimonial, o Expert sem FHEMIG, o nível e a vigência do contrato no cliente, a foto e o SLA do ativo, o "Tipo" fora da tela, Ferramentas e a marca.
- **O que não está no ar:** **nada foi publicado.** As migrations 0084 e 0085 só rodaram no banco local e no do CI. A produção continua na versão de 22/10.
- **O sistema não está 100%:** sobram 40 itens parciais, 8 sem teste automatizado e 9 que dependem do cliente ou de serviço externo. Quase todos esses 9 se resolvem com as fórmulas dos relatórios e com o provedor de e-mail.

## Números (177 itens)

| Situação | Itens |
|---|---|
| Implementado com teste automatizado | 95 |
| Implementado sem teste | 8 |
| Parcial | 40 |
| Pendente de definição do cliente | 3 |
| Bloqueado por dependência externa | 6 |
| Exige aprovação comercial | 2 |
| Decisão comercial registrada | 2 |
| Evolução futura (hardware, IA, integrações) | 8 |
| V2 — não implementar agora | 13 |

Por fase:

| Fase | Com teste | Sem teste | Parcial | Pendente | Bloqueado | Outros |
|---|---|---|---|---|---|---|
| ATUAL (128) | 76 | 8 | 37 | 3 | 4 | — |
| ATUAL_VITRINE (11) | 11 | — | — | — | — | — |
| OPERACIONAL_VALIDAR (11) | 6 | — | 3 | — | 2 | — |
| AVALIAR_ESCOPO (4) | 2 | — | — | — | — | 2 aprovação comercial |
| DECISAO_COMERCIAL (2) | — | — | — | — | — | 2 registradas |
| EVOLUCAO_FUTURA (8) | — | — | — | — | — | 8 futuras |
| V2 (13) | — | — | — | — | — | 13 fora desta fase |

"Implementado com teste" quer dizer que existe código e um teste automatizado que cobre o critério de aceite. Não quer dizer que o cliente já usou e aprovou.

## O que esta rodada entregou (PR #42)

| Pedido | Itens | O que mudou |
|---|---|---|
| 23/10 — "não tem o local de cadastrar produtos e preços e disponibilizar para qual cliente" | STO-03, STO-04, STO-12 | Store → aba **Gerenciar catálogo**: produto, preço, descrição e publicação, e **para quem aparece** (toda a rede ou clientes escolhidos). O filtro vale no servidor: o cliente fora da seleção não vê o item, não faz pedido dele nem pede proposta. Só quem edita o catálogo vê a aba. Migration 0084 |
| 23/10 — "aprovado, sendo separado, em trânsito, entregue, para o usuário e para nós" | STO-06 | Pedido feito → Aprovado → **Separado** → Em trânsito → Entregue, com faixa de andamento na lista e no pedido. O cliente não move o pedido (403) |
| 23/10 — "acha realmente necessário este lance de onsite?" | OS-19 | As barras vermelhas viraram etiquetas: "Chegada ao local: vencido há 2 dias", "Solução: vence 15/10 16:00". Mesma regra de SLA, sem o vermelho gritando |
| Foto de 29/10 — campo "Local" com IDs | OS-07 | O "Local" mostra o setor ("Leito 09"), e não a cadeia interna de IDs |
| 19/10 — "AGUARDANDO MODELO PDF OFICIAL… aguardo layout sugestivo" | REL-08 | PDF Basic no mesmo padrão do Advanced: cartões coloridos pela meta, gráfico de 12 meses e assinaturas. Indicador sem fórmula aparece como pendente, sem número |
| 19/10 — "exportação em Excel" | REL-10 | Botão **Baixar Excel** (.xlsx) com as mesmas permissões do PDF e as abas Indicadores, Série mensal e Filtros |
| 19/10 — "relatório patrimonial: ativos, em manutenção e obsoletos" | REL-11 | Aba **Patrimonial** no diálogo de relatórios, em tela, PDF e Excel. Valor e nota fiscal só para quem tem permissão financeira |
| 19/10 — Expert sem FHEMIG, com "17+ indicadores em tempo real" | REL-16 | FHEMIG saiu. **Não** escrevemos "17+ em tempo real": dos 17 indicadores previstos, só 2 têm fórmula hoje. O cartão diz isso |
| 19/10 — nível de relatório no cadastro do cliente | CLI-05, REL-13 | Campo Basic/Advanced/Expert no cliente. **O servidor não gera relatório acima do nível contratado**: devolve 403, com a explicação |
| 19/10 — duração do contrato | CLI-06 | Início e fim da vigência no cliente, com a situação: a iniciar, vigente, vence em 30 dias ou vencido |
| 19/10 — foto obrigatória do ativo | ATV-07 | Não se cria equipamento novo sem foto. A foto aparece na ficha e na impressão; os equipamentos antigos continuam válidos |
| 19/10 — remover "tipo do equipamento" | ATV-08, ATV-01 | O campo saiu da tela. O **nome** do equipamento vem do catálogo da família, o que preserva os nomes padronizados pedidos na reunião |
| 19/10 — SLA de cada equipamento, com habilitar/desabilitar | ATV-15 | Chave no cadastro. Com a chave desligada, as OS desse equipamento não abrem relógio de SLA |
| 19/10 — Ferramentas | FER-07, FER-08, FER-09 | Subtítulo "Soluções novas de mercado, consulte disponibilidade.", textos comerciais com benefícios e **Eficiência Energética**. Nenhuma ferramenta mostra dado ou leitura |
| 19/10 — "ao clicar em itech tem que atualizar e voltar para página inicial" | OPS-01 | A marca virou link para o início, com recarga. Conferido no navegador |

## Testes desta rodada

| O quê | Resultado |
|---|---|
| Typecheck (Node 22) | sem erros |
| Lint dos arquivos versionados | sem erros (os erros locais são de pastas ignoradas: `.claude/worktrees`, `capturas/`) |
| Prettier e marca (worktree LF, como no CI) | em dia |
| OpenAPI, auditoria da spec, varredura de segredos | em dia |
| Suíte completa local (PGlite) | **2.619 passaram, 0 falharam** (32 pulados: precisam de PostgreSQL real e rodam no CI); 165 arquivos |
| CI da PR #42 — Estático | verde |
| CI da PR #42 — Testes contra PostgreSQL 16 | em andamento quando este relatório foi gravado — ver a PR |
| CI da PR #42 — Ponta a ponta (Playwright) | em andamento quando este relatório foi gravado — ver a PR |
| Navegador (modo demonstração) | Ferramentas, marca → início, OS com "Local" pelo nome |

**O que não foi verificado:**
- O Excel gerado não foi aberto no Microsoft Excel; foi validado lendo o arquivo por teste.
- O PDF Basic não foi conferido visualmente.
- A tela da Store com a API real não foi aberta, porque o Docker local não sobe; ela fica coberta pelo E2E do CI.

## Pendências e por quê

**Dependem do cliente:**
- As **fórmulas** prometidas em 22/10 não chegaram. Sem elas, MTTR, MTBF, conformidade, disponibilidade e 15 dos 17 indicadores do Expert seguem como provisórios ou pendentes (REL-04, REL-05, REL-06, OPS-10).
- Falta definir quais campos exigem aprovação do engenheiro ou do gestor (USR-11).
- Falta dizer se a assinatura por sessão basta ou se precisa de ICP-Brasil (OS-23).
- Falta o nome do fabricante do SIGQUALI.
- Falta explicar a seta verde na foto do quadro de OS: a coluna rola por dentro, de propósito, e não mexi sem saber o pedido.

**Dependem de infraestrutura:**
- **E-mail:** sem provedor, as propostas, os relatórios agendados e o convite de usuário entregam só na caixa de entrada do sistema (ORC-03, AUT-02, AUT-03, USR-02).
- **Domínio e VPS:** "htec.b" não existe (OPS-05).

**Parciais de maior peso:**
- O parecer LIBERADO/PARADO só é obrigatório se a organização ligar a regra, e "PARADO" não muda o estado do ativo (OS-16).
- A impressão da OS sai só com a aba aberta (OS-20).
- Não há botão para ativar ou inativar plano (PLN-01).
- As abas de orçamento aparecem em toda OS (OS-03).
- O relatório agendado ainda não passa pela trava do nível contratado (REL-13).

**V2, sem implementar:** V2Q-01 a V2Q-13 (gestão da qualidade completa, ONA operacional, tarefas com cronômetro).

## Commits, PR e publicação

- Branch `feat/rodada-2026-10-29`, **PR #42**: https://github.com/voceconectadigital/technecaremeds/pull/42
- Migrations novas: `0084_store_publico_e_separacao.sql` e `0085_cadastro_cliente_e_ativo.sql`, **não aplicadas no banco remoto**.
- **Deploy:** não feito. Publicar exige ordem expressa e segue a ordem de sempre: backup → API (as migrations rodam no deploy) → conferir a versão → front.
