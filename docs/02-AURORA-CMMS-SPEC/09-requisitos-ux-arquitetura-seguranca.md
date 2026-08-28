<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 10 de 13 — seções 34 a 37
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 34. Requisitos não funcionais

| Área | Requisito | Meta | Como verificar |
| --- | --- | --- | --- |
| **Segurança** | Isolamento entre organizações | Zero vazamento | Suíte automatizada que tenta acessar dados de outro tenant em cada endpoint; falha do teste bloqueia o deploy |
| **Segurança** | Criptografia | TLS 1.3 em trânsito; AES-256 em repouso | Configuração auditada |
| **Segurança** | Senhas e segredos | Argon2id; segredos em cofre; nada em variável de ambiente de build | Revisão + varredura de segredo no CI |
| **Segurança** | Dependências | Sem vulnerabilidade crítica conhecida em produção | SCA no CI, correção em 7 dias para crítico |
| **Segurança** | Sessão | Expiração por inatividade (staff 12 h, portal 30 dias); revogação imediata ao remover vínculo | Teste de integração |
| **Performance** | Listas com filtro | p95 < 400 ms com 100 mil OS por organização | Teste de carga com base semeada em volume realista |
| **Performance** | Ficha de ativo / OS | p95 < 600 ms | idem |
| **Performance** | Painel | p95 < 1,5 s para 12 meses | Sobre tabelas de fato |
| **Performance** | PWA — abrir OS offline | < 300 ms | Medição no dispositivo |
| **Escalabilidade** | Volume por organização | 500 mil ativos, 5 milhões de OS, 50 mil documentos | Particionamento e índices projetados para isso |
| **Escalabilidade** | Organizações por instância | ≥ 500 sem degradação | Teste de multiempresa |
| **Escalabilidade** | Jobs | Geração de 5 mil OS de ciclo em < 5 min, sem impacto na latência transacional | Fila separada, prioridade baixa |
| **Disponibilidade** | Uptime | 99,9 % mensal para a aplicação | Monitoramento sintético externo |
| **Disponibilidade** | Degradação graciosa | Indisponibilidade de analytics, PDF ou notificação não impede operar OS | Filas desacopladas |
| **Disponibilidade** | Manutenção | Migrações sem downtime (expandir → migrar → contrair) | Política de migração |
| **Backup** | RPO | ≤ 5 min (PITR) | Teste trimestral de restauração |
| **Backup** | RTO | ≤ 4 h | Ensaio documentado |
| **Backup** | Retenção | Diário 30 dias, mensal 12 meses; arquivos com versionamento | Política de bucket |
| **Privacidade e LGPD** | Base legal e finalidade | Registro de tratamento por categoria de dado | Documento de *data mapping* |
| **Privacidade e LGPD** | Direitos do titular | Exportar e anonimizar dados de um usuário sem quebrar o histórico operacional | Anonimização substitui nome e contato, preserva o vínculo por id |
| **Privacidade e LGPD** | Minimização | Não coletar CPF de solicitante; geolocalização só com consentimento explícito e revogável | Revisão de formulário |
| **Observabilidade** | Rastreamento | `request_id` propagado da interface ao banco e ao log de auditoria | Traço distribuído |
| **Observabilidade** | Erros | Captura em servidor e cliente, com organização e usuário anonimizados | Painel de erros |
| **Observabilidade** | Negócio | Métricas de fila, taxa de sincronização do PWA, entregas de webhook, disparo de automações | Painel operacional interno |
| **Acessibilidade** | Conformidade | WCAG 2.2 AA | Auditoria automatizada no CI + revisão manual das telas críticas |
| **Acessibilidade** | Teclado | Toda ação alcançável sem mouse; foco sempre visível | Teste manual por tela |
| **Acessibilidade** | Contraste e alvo de toque | 4.5:1 em texto; alvo ≥ 44 px no PWA (técnico de luva) | Design tokens |
| **Responsividade** | Web | Funcional de 1280 px a 1920 px; utilizável em tablet | Testes de viewport |
| **Responsividade** | PWA | Projetado para 360–430 px; uma mão; alto contraste em ambiente claro | Teste em campo |
| **Offline** | Autonomia | 8 h de trabalho sem rede, incluindo fotos | Teste de campo simulado |
| **Offline** | Integridade | Zero perda silenciosa de trabalho; conflito sempre visível ao usuário | Teste de conflito determinístico |
| **Internacionalização** | Estrutura | Todo texto em catálogo desde o MVP, mesmo com um idioma só | Sem literal em componente |
| **Internacionalização** | Formato | Data, número, moeda e fuso por organização e por usuário | Biblioteca de formatação centralizada |

---

## 35. Princípios de UX / UI

### Os sete princípios

01

#### Densidade com hierarquia

Tabelas profissionais mostram muito, mas com um único ponto de entrada visual por linha. Truncamento com *tooltip* é derrota — a coluna importante recebe espaço, as demais são configuráveis.

02

#### Estado é cor e forma

Cada categoria de situação tem cor e forma consistentes em toda a aplicação — lista, Kanban, agenda, portal e PDF. O usuário aprende uma vez.

03

#### Filtro é visível e reversível

Filtros ativos aparecem como chips removíveis acima da tabela e no endereço. Nunca escondidos em painel modal, como na referência.

04

#### Gaveta em vez de página

Ver um detalhe a partir de uma lista abre uma gaveta lateral, preservando o contexto. Página inteira só quando o registro é o assunto.

05

#### Formulário em etapas

Nada de 39 campos numa tela. Progressão por seções, com rascunho salvo automaticamente e validação no momento certo.

06

#### Erro que ensina

Toda mensagem diz o que aconteceu, por que e qual é o próximo passo, apontando o campo. "Erro!" é defeito, não mensagem.

07

#### Teclado é cidadão de primeira classe

`⌘K` para tudo. Atalhos para as cinco ações mais frequentes de cada tela, descobríveis por `?`.

### Padrões definidos

| Padrão | Regra |
| --- | --- |
| **Navegação** | Barra lateral com no máximo 8 itens de primeiro nível, sem submenu de terceiro nível. O que não couber vai para "Configurações" ou para a busca. |
| **Ações** | Uma ação primária por tela. Secundárias em menu *overflow*. Ações destrutivas exigem confirmação com o nome do registro digitado apenas quando irreversíveis. |
| **Modais** | Nunca modal dentro de modal. Fluxo que precisa de dois passos vira gaveta com etapas. |
| **Tabelas** | Colunas configuráveis e persistidas por usuário; ordenação no servidor; seleção múltipla com barra de ações contextual; virtualização acima de 100 linhas; densidade confortável e compacta. |
| **Vazio** | Estado vazio explica o que aquilo é e oferece a ação de criar ou de importar. Nunca uma tabela em branco. |
| **Carregamento** | *Skeleton* com a forma do conteúdo; nunca *spinner* de página inteira em navegação interna. |
| **Números** | Sempre tabulares e alinhados à direita; unidade explícita; duração em formato humano ("2 d 4 h", não "0.093 anos"). |
| **Cor** | Um acento de marca; semântica (sucesso, atenção, crítico) separada do acento; nunca cor como única portadora de informação. |
| **Tema** | Claro e escuro desde o início, por tokens. O técnico trabalha em UTI com luz baixa. |
| **Idioma** | Um vocabulário só (§03). O rótulo da tela é o rótulo do PDF é o rótulo do e-mail. |

### Antipadrões proibidos

Modal dentro de modal · Combo com 651 opções sem busca · Filtro que some ao aplicar · Paginação por *offset* com 2.954 páginas · Ícone de ação sem rótulo acessível · Formulário de 39 campos em tela única · Mensagem "Erro!" · Placeholder *lorem ipsum* em produção · Dois nomes para o mesmo conceito · Limite comunicado sem caminho de solução · Widget que abre outro domínio

---

## 36. Arquitetura técnica

### Avaliação das necessidades reais

| Necessidade | Exigência que ela impõe | Implicação |
| --- | --- | --- |
| Multitenancy com escopo hierárquico | Filtro por subárvore em toda consulta, com desempenho | Postgres com `ltree` + escopo materializado; RLS como segunda barreira, não como única |
| Máquina de estados com guardas e efeitos | Transação com validação, emissão de evento e efeitos colaterais | Lógica em serviço próprio, não em política de banco nem em função de borda |
| Numeração transacional | Sequência sem buraco e sem colisão sob concorrência | *Advisory lock* no Postgres dentro da mesma transação |
| Jobs (ciclos, PDF, exportação, webhooks, digest) | Fila durável, com retentativa, agendamento e visibilidade | Fila baseada em Postgres para enfileirar na mesma transação do dado |
| Offline-first | Sincronização idempotente, ordenada por agregado, com resolução de conflito | API de comandos com `client_operation_id`; não é resolvível por CRUD genérico |
| PDF fiel a template versionado | Renderização controlada | Worker com Chromium *headless*, isolado da API |
| Analytics de 12 meses | Leitura pesada sem afetar a operação | Tabelas de fato e réplica de leitura |
| Busca tolerante a erro | Trigrama e ranqueamento | Postgres `pg_trgm` + `tsvector` antes de motor dedicado |
| API pública com webhooks assinados | Contrato estável e entrega confiável | OpenAPI gerado + fila de entrega com *dead letter* |

> **DECISÃO ADR-010 — ARQUITETURA RECOMENDADA**
>
> **Monólito modular em TypeScript sobre PostgreSQL, com BaaS usado apenas para identidade e armazenamento.** Recusamos "aplicação direto no Supabase com RLS como camada de autorização": as regras deste domínio (guardas de transição, requisitos de conclusão por natureza, numeração, cálculo de SLA com calendário, sincronização offline) não cabem em políticas de banco, e tentar espremê-las ali produz um sistema que ninguém consegue testar nem depurar. Usamos o BaaS pelo que ele é bom — autenticação, armazenamento, Postgres gerenciado — e mantemos o domínio no nosso código.

### Stack

| Camada | Escolha | Por quê | Alternativa considerada |
| --- | --- | --- | --- |
| **Frontend** | React + TypeScript + Vite; TanStack Query/Table/Router; Tailwind + design system próprio sobre primitivos acessíveis; Zod compartilhado com o backend | Listas virtualizadas e formulários complexos são o coração do produto | Next.js — recusado: não precisamos de SSR para uma aplicação autenticada, e o custo de complexidade não se paga |
| **Portal do cliente** | Mesma base, rotas e layout próprios, *bundle* separado | Reaproveita componentes sem herdar a densidade interna | Aplicação separada — recusado no MVP |
| **PWA do técnico** | Mesma base; Service Worker; IndexedDB (Dexie); fila de saída própria | Uma base de código; instalável; sem loja de aplicativos | React Native — reconsiderar se push confiável e leitura de NFC virarem requisito |
| **Backend** | NestJS (TypeScript), monólito modular com um módulo por domínio da §04; Drizzle ORM; REST com OpenAPI gerado | Fronteiras explícitas, tipos compartilhados com o front, caminho de extração futura sem reescrita | Microsserviços — prematuro; Python/Django — perde o compartilhamento de tipos |
| **Banco** | PostgreSQL 16+ com `ltree`, `pg_trgm`, `uuid v7`, particionamento em eventos e histórico; réplica de leitura para analytics | Um banco resolve relacional, árvore, JSON, busca e fila | ClickHouse para analytics — só quando o volume exigir |
| **Autenticação** | Provedor gerenciado (Supabase Auth ou equivalente): senha, *magic link* para o portal, MFA; OIDC/SAML na Fase 3 | Identidade é problema resolvido; não construir | Auth próprio — recusado |
| **Armazenamento** | S3-compatível, prefixo por organização, URLs assinadas curtas, versionamento | Isolamento e custo | Blob no banco — recusado |
| **Filas e jobs** | pg-boss (fila no próprio Postgres): enfileiramento transacional, cron, retentativa, prioridade | Zero infra extra e garantia de que o job só existe se a transação existiu | Redis/SQS — quando o volume justificar |
| **PDF** | Worker isolado com Chromium *headless*, templates HTML versionados por organização | Fidelidade tipográfica e reuso do design system | Bibliotecas de PDF — perdem qualidade e reuso |
| **E-mail** | Provedor transacional com *webhooks* de entrega, *bounce* e reclamação alimentando a lista de bloqueio | Entrega e reputação | SMTP próprio — recusado |
| **Tempo real** | SSE a partir da API para o feed e para o Kanban | Simples, atravessa proxies, suficiente | WebSocket — só se houver colaboração simultânea |
| **Infra** | Contêineres gerenciados, IaC, ambientes dev/stg/prod, migrações versionadas e reversíveis | Previsibilidade | — |

### Organização do código

```

apps/
  web/        aplicação interna
  portal/     portal do cliente
  field/      PWA do técnico
  api/        NestJS (módulos por domínio)
  workers/    jobs, PDF, sincronização, pipeline de fatos
packages/
  contracts/  esquemas Zod + tipos + cliente OpenAPI  ← fonte única de verdade dos DTOs
  domain/     máquinas de estado, cálculo de SLA, recorrência, regras puras e testáveis
  ui/         design system
  events/     catálogo de eventos e tipos de payload
  db/         schema, migrações, seeds

```

`packages/domain` não conhece HTTP nem banco. As regras de transição, o cálculo de minutos úteis e a recorrência de planos são funções puras com testes exaustivos — é a parte do sistema que não pode ter defeito.

---

## 37. Segurança multitenant

Regra inegociável: **nenhum dado de uma organização pode alcançar outra**. A garantia é obtida por camadas independentes, de modo que a falha de uma não produza vazamento.

### Defesa em profundidade

| # | Camada | Mecanismo | O que pega |
| --- | --- | --- | --- |
| 1 | **Sessão** | Token carrega `user_id`; a organização ativa é resolvida no servidor a partir do *membership*, nunca aceita do cliente | Troca de tenant por manipulação de cabeçalho ou de URL |
| 2 | **Contexto de requisição** | `organization_id`, `membership_id`, permissões e escopo resolvidos uma vez e propagados imutáveis | Esquecimento de filtro em um serviço |
| 3 | **Camada de dados** | O construtor de consultas **injeta `organization_id` automaticamente**; consultar sem escopo exige uma chamada explicitamente nomeada `unsafeCrossTenant()`, proibida por lint fora de tarefas administrativas | Consulta escrita à mão sem `WHERE` |
| 4 | **RLS no Postgres** | Política em toda tabela de negócio comparando `organization_id` com a variável de sessão definida na abertura da conexão | Bug na aplicação, injeção, acesso direto ao banco |
| 5 | **Escopo de negócio** | Filtro por cliente, subárvore de local e atribuição, aplicado na consulta | Usuário legítimo vendo dado de outro setor |
| 6 | **Serialização** | Campos sob permissão de campo removidos na resposta | Custo vazando para o portal |
| 7 | **Armazenamento** | Prefixo `{organization_id}/…`; URL assinada emitida só após verificação; nenhum bucket público | Enumeração de arquivos |
| 8 | **Jobs e automações** | Todo job carrega `organization_id` e roda sob ator de sistema com escopo declarado; a conexão de serviço abre com a variável de sessão do tenant | Job que processa "todos" e mistura tenants |
| 9 | **API** | Chave é sempre de uma organização; mesmo motor de permissão e escopo | Integração privilegiada |
| 10 | **Testes** | Suíte que, para cada endpoint, cria dois tenants e verifica que A não alcança B — e falha o *build* | Regressão |

### Regras adicionais

- **Chave de serviço nunca sai do servidor.** Nenhum cliente — web, portal ou PWA — recebe credencial que ignore RLS.
- **Identificadores opacos.** UUID v7 em toda parte; nada sequencial exposto, exceto os números de documento (que são de negócio e escopados).
- **Enumeração.** Registro fora do escopo retorna `404`, não `403` — não confirmar existência.
- **Exportação** é ação auditada, com marca d'água de organização e usuário nos PDFs sensíveis.
- **Acesso de suporte** com prazo, motivo, banner visível na interface e marcação `actor_kind = support` em toda ação.
- **Cache** sempre chaveado por organização e por escopo; nunca por id do recurso apenas.
