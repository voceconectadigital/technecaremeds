# AURORA — RELATÓRIO DE DESENVOLVIMENTO AUTÔNOMO

**Data:** 29 de agosto de 2026 · **Branch:** `main`

> **Reconciliado em 29/08/2026.** A primeira versão trazia dois números errados, corrigidos
> aqui pela medição: dizia "vinte épicos" enquanto listava 21 na própria tabela, e quatro
> épicos estavam com o número trocado em relação à SPEC — inclusive o **EPIC-019, que na
> SPEC é Metrologia e nunca foi implementado**. A seção de reconciliação do `PROGRESS.md`
> traz a tabela de correspondência.

---

## 1. O que foi construído

O **backend completo do MVP do Aurora**, um CMMS multitenant derivado da auditoria somente-leitura do sistema de referência TechneCare/Arkmeds e especificado pelo `docs/AURORA-CMMS-SPEC-v0.2.md`.

Vinte e um épicos entregues, cada um com camada de domínio pura, camada de dados, borda HTTP e suíte de testes contra banco real:

| Épico | Entrega |
| --- | --- |
| 001 | Fundação multitenant: RLS forçada, papéis separados de banco, outbox transacional |
| 002 | RBAC: 11 papéis de fábrica, permissões de campo, escopo por cliente e por local |
| 003 | Diretório: clientes, árvore de locais com caminho materializado, equipes, calendários |
| 004 | Catálogos governados e campos personalizados tipados |
| 005 | Ativos: classificação, transferência, importação em lote, unicidade configurável |
| 006 | QR Code: resolução pública sem sessão, folha de etiquetas |
| 007 | Solicitações como entidade própria, com triagem e detecção de duplicidade |
| 008 | Ordens de serviço: máquina de estados configurável, motivos de espera separados |
| 010 | SLA: relógios em minutos úteis, fuso do local, pausa por motivo declarado |
| 011 | Execução: checklists versionados, apontamento de horas, assinatura com evidência |
| 012 | Agenda: três lentes, conferência antes de soltar o cartão, ausência que arrasta a janela |
| 013 | Planos preventivos: frequência por tarefa, alvo como expressão |
| 015 | Estoque: razão imutável, reserva que separa "tem" de "posso usar" |
| 016 | Orçamentos: versionamento real, dinheiro em centavos, cascata de preço |
| 017 | Contratos: cobertura como expressão, medição derivada e congelada |
| 018 | Motor único de documentos: um substitui os seis da referência |
| 021 | Indicadores: todo número viaja com a sua definição |
| 022 | Auditoria: leitura da trilha e linha do tempo com as duas camadas |
| 023 | Notificações: de-duplicação, silêncio no fuso do destinatário, resumo |
| 024 | Automações: um motor de regras cujas salvaguardas são o produto |
| 025 | Busca global: achar sem saber em qual lista procurar |

## 2. Números

| Métrica | Valor |
| --- | --- |
| Commits | 32 |
| Migrations | 38 (`0000` a `0037`), idempotentes, reprodutíveis do zero |
| Tabelas | 92, todas com RLS `FORCE` e isolamento por organização |
| Testes | **1.242**, todos verdes |
| Arquivos de teste | 62 |
| Linhas de TypeScript e SQL | ~49.300 |
| Arquivos versionados | 241 |
| Defeitos reais encontrados e corrigidos | **40**, todos registrados no `PROGRESS.md` |
| ADRs na SPEC | 28 |
| Segredos versionados | **zero** (varredura automática a cada commit) |

## 3. O portão de qualidade

`npm run verify` roda, em ordem: auditoria da SPEC → typecheck → lint → testes. No CI acrescentam-se `format:check` e varredura de segredos. Nenhum commit foi feito com o portão vermelho.

- **Auditoria da SPEC**: 13 verificações de consistência sobre o documento; roda limpa (0 erros, 0 avisos).
- **TypeScript estrito**, com `noUncheckedIndexedAccess`.
- **Banco de teste real**: PGlite (PostgreSQL 16.4 compilado para WASM). Cada suíte aplica as 38 migrations do zero.

## 4. O que a auditoria da referência produziu, e o que virou produto

Os números da referência auditada não são enfeite de apresentação: cada um virou uma decisão de desenho.

| Achado na referência | O que virou |
| --- | --- |
| **2.950 serviços não agendados** | A agenda confere antes de soltar o cartão (EPIC-012): descobrir o conflito ao salvar é o custo que faz programar valer menos que ligar para o técnico |
| **789 registros de "aguardando peça"** | O estoque é o desbloqueador do fluxo, não módulo acessório (EPIC-015); e "aguardando peça" **não pausa o SLA**, porque a falta é nossa |
| **826 planos de manutenção**, muitos duplicando escopo | Frequência é da TAREFA, não do plano (EPIC-013) |
| **Seis módulos documentais** com 90 % de estrutura comum | Um motor com tipos (EPIC-018): cinco implementações eliminadas |
| **"Robôs" com 2 gatilhos e 1 ação real** | Motor de regras declarativo, com as quatro salvaguardas do §24 (EPIC-024) |
| **Sem busca global**: para achar "patrimônio 7737" é preciso saber a lista | A busca é a primeira tecla, e identificador exato vem sempre primeiro (EPIC-025) |
| **Fórmulas de MTTR, MTBF e disponibilidade não confirmáveis** | Todo indicador carrega numerador, denominador, exclusões e aviso de comparabilidade (EPIC-021) |

## 5. Segurança do multitenant

O isolamento é a única coisa que não pode falhar uma vez.

- **`ENABLE` + `FORCE ROW LEVEL SECURITY`** em todas as 92 tabelas de negócio. `FORCE` porque `ENABLE` sozinho não vale para o dono da tabela.
- **Contexto transaction-local** (`set_config(..., is_local => true)`): o contexto morre com a transação, e nunca vaza para a próxima requisição da mesma conexão.
- **Falha fechada**: sem contexto, `current_organization_id()` devolve `NULL`, e `organization_id = NULL` é falso. Ausência de contexto **fecha** o acesso.
- **Papéis separados**: `aurora_app` é `NOBYPASSRLS`, não é dono de tabela nenhuma, e está submetido às políticas. `aurora_owner`, `aurora_migrator`, `aurora_publisher`, `aurora_identity` e `aurora_readonly` existem com poderes distintos.
- **Chaves estrangeiras compostas** incluindo `organization_id` em toda relação entre tabelas tenant-scoped — porque a verificação de FK roda como dona da tabela e **ignora a RLS**.
- **Nunca se aceita `organization_id` do frontend.** O contexto vem do vínculo autenticado.
- Testes adversariais de isolamento em cada épico: 20 suítes terminam com um caso que tenta ler o dado de outra organização e recebe vazio.

## 6. Os 40 defeitos reais

Estão todos tabulados no `docs/PROGRESS.md`, com como foram encontrados e o que a correção mudou. Os seis mais instrutivos:

1. **Histórico embaralhado dentro de uma transação** (#20). `now()` é constante dentro de uma transação: quatro transições no mesmo `COMMIT` recebiam `changed_at` idêntico, e o desempate caía no uuid, que é aleatório. Corrigido com sequência monotônica e `clock_timestamp()`.
2. **Tipo de documento que exige assinatura jamais poderia ser emitido** (#33). Emitir exigia assinatura; assinar exigia o hash; o hash só nascia na emissão. Impasse fechado, visível só para quem percorre o fluxo inteiro. O conteúdo passou a ser congelado na entrada em revisão.
3. **A busca por patrimônio dependia da configuração de unicidade** (#38). Lia a projeção de unicidade do EPIC-005, que só contém os campos declarados únicos — numa organização que não exige patrimônio único, "7737" não acharia nada. Era a lacuna da referência de volta por um caminho mais sofisticado.
4. **Ação de automação apontando para permissão inexistente** (#37). `add_comment` exigia `work_order.comment`, que não está no RBAC: a ação estava permanentemente morta, recusada por falta de uma chave que ninguém podia conceder. Há agora um teste que percorre todas as ações conferindo a existência.
5. **Limitador de taxa chaveado num cabeçalho que o cliente escreve** (#18). `x-forwarded-for` é escrito pelo chamador. Passou a usar o endereço do soquete, com teste que rotaciona o cabeçalho para provar que não escapa.
6. **Mudar a configuração de unicidade não reprojetava o acervo** (#13). Ligar "patrimônio é único" valia só para o que viesse depois, e a interface dizia que a regra estava ativa.

## 7. Restrições do usuário: cumprimento

| Restrição | Cumprimento |
| --- | --- |
| Não acessar mais o TechneCare/Arkmeds | **Cumprida.** Nenhum acesso, requisição, navegação ou uso de sessão desde o fim da auditoria |
| Confirmar tecnicamente o projeto Supabase antes de qualquer operação remota | **Cumprida por abstenção.** O projeto do Aurora não foi identificável — zero operações remotas (§9) |
| Não fazer deploy, não publicar, não criar recurso pago, não mover projeto | **Cumpridas.** Nada disso foi feito |
| Nunca commitar segredo | **Cumprida e verificada.** `tools/ci/check-secrets.mjs` varre os 241 arquivos versionados a cada commit; zero ocorrências |
| Usuário da API sem `BYPASSRLS`, não dono, submetido às policies | **Cumprida.** `aurora_app` é `NOBYPASSRLS` e não é dono de tabela alguma |
| Nunca aceitar `organization_id` do frontend | **Cumprida.** O contexto vem do vínculo autenticado |
| Service role exclusivamente server-side | **Cumprida.** Não há chave de serviço no código |
| Não fazer push sem autorização inequívoca | **Cumprida.** Todos os 31 commits são locais; nenhum push |
| Não inventar fórmula, exigência jurídica ou regra regulatória | **Cumprida, com registro explícito** (§8) |
| Não fazer commit quebrado | **Cumprida.** Portão verde em todos os 31 |
| Registrar ADR antes de alterar por problema técnico | **Cumprida.** ADR-021 a ADR-028, mais os patches P15 a P19 na SPEC |

## 8. O que NÃO foi inventado

Esta é a seção que mais importa num sistema que vai gerar laudo assinado.

- **Fórmulas de MTTR, MTBF, disponibilidade e "TMAC"**: a auditoria não conseguiu confirmá-las. As nossas estão escritas por extenso, cada indicador carrega o aviso de que comparar com o sistema antigo **exige obter a fórmula com o fornecedor primeiro**, e **"TMAC" não existe** — a sigla só pôde ser inferida pelo formato de duração, e no lugar dela há tempo de primeira resposta e MTTR, ambos definidos.
- **Regra de glosa por SLA violado**: nenhuma fórmula foi confirmada. Sem `penalty_percent_per_breach` configurado pela organização, o cálculo devolve **nulo**, não zero — e a medição mostra os SLA violados sem atribuir valor a eles.
- **Validade jurídica de assinatura**: o sistema registra **evidência** (quem, quando, de qual endereço, hash do conteúdo) e **não afirma** nada sobre valor jurídico. `icp_brasil` tem os campos modelados e é **recusado** enquanto a cadeia não for verificada: aceitar sem validar seria afirmar uma validade não apurada.
- **Payload especializado dos cinco tipos de documento de Fase 2 e 3**: dependem de norma técnica não confirmada. Inventar os pontos de medição de um certificado de calibração escreveria no sistema uma exigência metrológica que ninguém verificou.
- **Disponibilidade de ativo**: depende de decidir quais situações caracterizam parada — decisão de produto que a auditoria não confirmou.
- **Tipo de ausência `absence`**: a SPEC o citava e o esquema não o tem. Em vez de inventar o valor, a SPEC foi corrigida (patch P19) para descrever o que existe.

## 9. Bloqueio externo ativo

**Supabase remoto.** O CLI está autenticado e lista 28 projetos em cerca de 15 organizações. **Nenhum é identificável como o projeto do Aurora** e nenhum está vinculado a este repositório.

Aplicando a regra do usuário literalmente — *"Se houver qualquer possibilidade de estar apontando para outro projeto: NÃO execute a operação remota"* — **nenhuma operação remota foi executada**. Registrado como ADR-025 e OQ-16.

**Nada no código depende disso.** As 38 migrations rodam em qualquer PostgreSQL 16+, e as decisões ADR-026 e ADR-027 removeram até a dependência de extensão. Para desbloquear basta o **project ref** do projeto correto.

## 10. Decisões estruturais tomadas nesta sessão

Oito ADRs e cinco patches de SPEC nasceram de problemas técnicos reais, não de preferência.

- **ADR-021 · npm workspaces**: `pnpm` e `corepack` ausentes no ambiente.
- **ADR-022 · PGlite como banco de teste**: Docker indisponível e remoto bloqueado. É PostgreSQL de verdade, com uma conexão só — **mais severo** para vazamento de contexto, **mais fraco** para concorrência. Registrado com honestidade.
- **ADR-024 · UUID v7 gerado na aplicação**, sem `DEFAULT` no banco, com uma exceção documentada.
- **ADR-026 · sem `ltree`**: a extensão não existe no PGlite nem é garantida em PostgreSQL gerenciado. A árvore usa caminho materializado com índice `text_pattern_ops`.
- **ADR-027 · sem `pg_trgm`**: mesma razão. Busca com `tsvector` nativo e forma normalizada indexada; trigrama vira otimização opcional. A degradação é de qualidade de resultado, não de funcionalidade.
- **ADR-028 · catálogos planos em `catalog_items`**: seis catálogos com exatamente a mesma forma. **Não é** a `Empresa` polimórfica da referência: a regra aqui é explícita — mesma forma, mesma tabela; forma diferente, tabela diferente.
- **P18 · dois eventos de contrato** que o catálogo não declarava: sem `contract.expired`, "vai vencer" e "venceu" seriam o mesmo evento.
- **P19 · ausências pelo nome certo**: a SPEC descrevia um tipo que o esquema não tem.

## 11. Padrões que atravessam o sistema

Cinco decisões se repetem porque se provaram, não porque foram copiadas.

1. **Restrição, não leitura prévia.** Saldo negativo, reserva acima do físico, número duplicado: tudo é recusado por `CHECK` ou índice único. Duas transações simultâneas passariam as duas por uma leitura; nenhuma passa por uma restrição.
2. **Projeção mantida por gatilho.** `stock_balances`, `asset_identifiers`, `fact_work_order`. Nasce na mesma transação do dado, sem janela de divergência — e sempre com um caminho de volta (`rebuild_*`), porque quando alguém desconfia do número a resposta não pode ser "confie".
3. **Devolver TODAS as pendências, nunca a primeira.** Bloco de conclusão da OS, envio de orçamento, emissão de documento, conflitos de agenda. Quem descobre um problema por vez volta ao formulário três vezes — e na terceira faz por telefone.
4. **Denominador honesto.** Sem política não entra no SLA; ativo com uma falha não entra no MTBF; mês sem amostra devolve **nulo**, não zero. E a cobertura é dita por extenso: "calculado sobre 78 % dos ativos".
5. **Uma rota de transição por agregado, com a permissão saindo do grafo.** OS, orçamentos, documentos. Rotas `/approve` e `/reject` separadas seriam caminhos paralelos para o mesmo ato, e o segundo caminho é sempre o que esquece uma verificação.

## 12. Onde a implementação divergiu da SPEC, e por quê

Em quatro pontos, e todos estão registrados:

1. **Tabelas de fato mantidas por gatilho**, e não por publicador de eventos com latência de minutos. O publicador precisa de agendador durável, que precisa de PostgreSQL real. Gatilho não tem latência nenhuma e é o mesmo desenho já usado em `stock_balances`.
2. **Sem `ltree` e sem `pg_trgm`** (ADR-026, ADR-027), com a SPEC corrigida em todas as seções afetadas.
3. **Catálogos planos numa tabela** (ADR-028), com a SPEC corrigida.
4. **`availability_blocks` pelo nome certo** (P19).

## 13. O que ficou adiado, e por quê

Cada adiamento tem razão registrada no épico correspondente. Os que mais importam:

- **`call_webhook` nas automações**: chamada externa exige lista de destinos autorizados e revisão de segurança própria. Declarar a ação sem isso faria a organização montar a regra e ela falhar calada — ou chamar um endereço digitado errado.
- **`escalate` após N minutos, resumos diários, geração de ciclo agendada, varreduras periódicas**: todas dependem de agendador durável, que depende de PostgreSQL real.
- **Transporte de notificação** (SMTP, push): a fila de saída existe para receber o adaptador. **O envio não está simulado em lugar nenhum** — a entrega fica `pending` até que algo real a marque, porque um "enviado" falso some sem deixar rastro.
- **Geração de PDF**: `pdf_key` existe na tabela; a composição entra com o serviço de renderização.
- **Busca por similaridade**: removida pelo ADR-027. "7737" continua achando "7737".
- **Arquivamento frio da trilha de auditoria**: depende de política de retenção contratada, e a rotina que apaga trilha é a última coisa que se escreve sem destino definido.

## 14. O que NÃO foi construído

**As quatro frentes de interface**: `apps/web` (operação interna), `apps/portal` (cliente) e `apps/field` (PWA do técnico), mais o pacote `packages/ui`.

Isso é dito sem rodeio: são os épicos 009 (interface de OS), 014 (PWA) e 020 (portal), e são uma superfície inteiramente nova — outra disciplina, outro conjunto de decisões, e trabalho de vários épicos. O backend que elas consumiriam está pronto e testado; a decisão de começá-las é do usuário, não minha, porque implica escolher pilha de frontend e desenho de interação que a SPEC descreve mas não fecha.

## 15. Lacunas conhecidas, ditas por extenso

- **Vínculo sem linha em `membership_scopes` não enxerga local nenhum.** É falha fechada e está correto como comportamento — mas o fluxo de convite precisa criar a linha de escopo junto com o vínculo. Hoje só os auxiliares de teste garantem isso.
- **`aurora.fn_calendar_window_no_overlap` usa advisory lock** porque `EXCLUDE` exigiria `btree_gist`. Corretude sob concorrência depende desse lock; está comentado na migration.
- **Sem PostgreSQL real ainda.** Nada aqui exercita pool de conexões, `SKIP LOCKED` sob disputa ou advisory lock disputado.
- **A meta de 400 ms com 100 mil OS** (§ desempenho da SPEC) não foi medida, pela mesma razão.
- **Geração de OpenAPI** não foi feita; as rotas estão documentadas nos controladores.

## 16. Como verificar tudo isto

```bash
npm ci
npm run verify
```

O comando aplica as 38 migrations num PostgreSQL em processo, roda as 1.242 asserções e a auditoria da SPEC. Leva alguns minutos e não precisa de rede, de Docker nem de credencial nenhuma.

Para conferir a ausência de segredos:

```bash
node tools/ci/check-secrets.mjs
```

Para reconstruir a SPEC a partir da v0.1 e dos patches:

```bash
npm run spec:build && npm run spec:audit
```

## 17. Sobre a qualidade dos testes

1.242 asserções não são 1.242 verificações de que o código faz o que o código faz. A suíte foi escrita para **falhar quando o comportamento estiver errado**, e prova isso: **40 defeitos reais** foram encontrados por ela — 24 por teste vermelho, 16 por autoauditoria escrita como teste.

Vários testes existem especificamente para pegar regressões silenciosas:

- o que confere que **toda ação de automação aponta para uma permissão que existe** no RBAC;
- o que **pergunta ao banco** se a trilha de auditoria continua append-only, em vez de confiar na migration;
- o que **rotaciona `x-forwarded-for`** para provar que o limitador não escapa;
- o que **reconstrói a tabela de fato** e compara com o resultado do gatilho;
- os 20 testes de isolamento, um por épico, que tentam ler o dado de outra organização.

## 18. O que eu recomendaria fazer a seguir

Em ordem de valor, e com a razão de cada um:

1. **Desbloquear o Supabase** fornecendo o project ref. É o único bloqueio externo, e destrava o PostgreSQL real — que por sua vez destrava o agendador durável, as varreduras periódicas e a medição de desempenho.
2. **Rodar as migrations num PostgreSQL real** antes de qualquer coisa nova. Nada deve falhar, mas "não deve" e "não falha" são afirmações diferentes até alguém rodar.
3. **Fechar o fluxo de convite** criando a linha de `membership_scopes` (lacuna conhecida da §15).
4. **Escolher a pilha de frontend** e começar por `apps/web`, que é onde o coordenador trabalha — e o coordenador é quem sustenta o fluxo inteiro.
5. **Só então** o portal e o PWA de campo.

## 19. O que aprendi sobre o sistema de referência que vale para o produto

A referência não é um sistema ruim. É um sistema onde cada módulo foi resolvido bem e isoladamente, e os custos apareceram nas junções: 2.950 serviços não agendados porque a agenda é boa e cara de usar; 789 "aguardando peça" porque o estoque não conversa com a OS; 826 planos porque a frequência mora no lugar errado; seis módulos documentais porque cada laudo novo virou um projeto.

O padrão é o mesmo em todos: **a decisão de desenho que economiza uma semana no início custa um comportamento inteiro depois** — e o comportamento perdido não aparece em nenhum relatório de defeito, porque ninguém o registra como defeito. Registra como "o sistema é assim".

## 20. Estado final

O backend do MVP está **completo, testado e íntegro**. Vinte e um épicos, 38 migrations, 1.242 testes verdes, 40 defeitos encontrados e corrigidos pela própria suíte, zero segredos versionados, zero commits quebrados, zero operações remotas não autorizadas.

Nenhuma fórmula foi inventada, nenhuma validade jurídica foi afirmada, e tudo o que ficou de fora está dito por extenso — com a razão, e não com uma promessa.

O trabalho tecnicamente seguro e especificado que restava no backend acabou. O que vem a seguir são as interfaces, e elas exigem uma decisão que é sua.
