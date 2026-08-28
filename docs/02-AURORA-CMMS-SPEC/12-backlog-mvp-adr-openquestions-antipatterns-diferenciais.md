<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 13 de 13 — seções 43 a 48
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 43. Backlog funcional

Complexidade: **S** ≤ 2 dias · **M** ≤ 1 semana · **L** ≤ 3 semanas · **XL** > 3 semanas (candidato a quebrar).

| ID | Épico | Feature | US | Prio | Fase | Depende | Compl. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BL-001 | 001 | Esquema base, convenções e migrações | PLT-002 | **P0** | F0 | — | L |
| BL-002 | 001 | Contexto de requisição e injeção automática de tenant | PLT-003 | **P0** | F0 | BL-001 | M |
| BL-003 | 001 | RLS em todas as tabelas + suíte de isolamento no CI | PLT-003 | **P0** | F0 | BL-002 | L |
| BL-004 | 022 | Trigger de auditoria com diff, IP e agente | PLT-005 | **P0** | F0 | BL-001 | M |
| BL-005 | 022 | Outbox de eventos de domínio e publicador | PLT-005 | **P0** | F0 | BL-001 | M |
| BL-006 | 001 | Fila de jobs transacional e agendador | PLT-006 | **P0** | F0 | BL-001 | M |
| BL-007 | 002 | Autenticação, sessão, MFA opcional, recuperação | PLT-001 | **P0** | F0 | BL-002 | M |
| BL-008 | 002 | Convite, aceite e gestão de assentos | PLT-001 | **P0** | F1 | BL-007 | M |
| BL-009 | 002 | Papéis de fábrica + catálogo de permissões | PLT-004 | **P0** | F1 | BL-008 | L |
| BL-010 | 002 | Escopo em três eixos + materialização | PLT-004 | **P0** | F1 | BL-009 | L |
| BL-011 | 002 | Editor granular de papel customizado | PLT-004 | **P1** | F1 | BL-009 | M |
| BL-012 | 002 | Acesso de suporte com prazo e banner | PLT-006 | **P1** | F1 | BL-009 | S |
| BL-013 | 003 | Clientes, contatos e modo single-customer | DIR-001 | **P0** | F1 | BL-010 | M |
| BL-014 | 003 | Tipos de local e árvore com ltree | DIR-002 | **P0** | F1 | BL-013 | L |
| BL-015 | 003 | Mover subárvore com recálculo de escopo | DIR-003 | **P0** | F1 | BL-014 | M |
| BL-016 | 003 | Fornecedores | DIR-004 | **P2** | F1 | BL-013 | S |
| BL-017 | 003 | Equipes, membros e cobertura | DIR-005 | **P0** | F1 | BL-010 | M |
| BL-018 | 003 | Calendários, janelas, feriados e ausências | DIR-006 | **P1** | F1 | BL-017 | M |
| BL-019 | 004 | Catálogos com arquivamento e mesclagem assistida | DIR-007 | **P0** | F1 | BL-013 | M |
| BL-020 | 004 | Campos personalizados tipados + validação no servidor | DIR-008 | **P1** | F1 | BL-019 | L |
| BL-021 | 005 | Categorias, fabricantes, modelos e criticidade | AST-002 | **P0** | F2 | BL-019 | M |
| BL-022 | 005 | Cadastro de ativo com unicidade configurável | AST-001 | **P0** | F2 | BL-021 | L |
| BL-023 | 005 | Ficha 360° com linha do tempo unificada | AST-003 | **P0** | F2 | BL-022 | L |
| BL-024 | 026 | Importação de ativos com curadoria de fabricantes | AST-004 | **P0** | F2 | BL-022 | L |
| BL-025 | 006 | QR token, rota pública e folha de etiquetas | AST-005 | **P0** | F2 | BL-022 | M |
| BL-026 | 005 | Hierarquia pai/filho de ativos | AST-006 | **P2** | F2 | BL-022 | S |
| BL-027 | 005 | Transferência e empréstimo de ativos | AST-007 | **P1** | F2 | BL-022 | M |
| BL-028 | 005 | Descomissionamento com efeitos em planos | AST-008 | **P1** | F2 | BL-022 | S |
| BL-029 | 007 | Abertura de solicitação em 3 passos (web e mobile) | REQ-001 | **P0** | F3 | BL-025 | L |
| BL-030 | 007 | Detecção de duplicidade | REQ-002 | **P1** | F3 | BL-029 | M |
| BL-031 | 007 | Fila de triagem e máquina de estados da solicitação | REQ-003 | **P0** | F3 | BL-029 | L |
| BL-032 | 007 | Conversão 1→N e conversão automática opcional | REQ-003 | **P0** | F3 | BL-031 | M |
| BL-033 | 007 | Avaliação 1–5 com comentário | REQ-005 | **P1** | F3 | BL-031 | S |
| BL-034 | 009 | Catálogos: naturezas, situações, motivos, códigos de falha | WO-001 | **P0** | F3 | BL-019 | M |
| BL-035 | 009 | Motor de transições com guardas e efeitos | WO-002 | **P0** | F3 | BL-034 | XL |
| BL-036 | 008 | CRUD de OS com snapshots | WO-003 | **P0** | F3 | BL-035 | L |
| BL-037 | 008 | Lista virtualizada com chips de filtro e visões salvas | WO-004 | **P0** | F3 | BL-036 | L |
| BL-038 | 008 | Kanban com validação de transição no drop | WO-006 | **P1** | F3 | BL-036 | M |
| BL-039 | 008 | Requisitos de conclusão por natureza | WO-005 | **P0** | F3 | BL-035 | M |
| BL-040 | 008 | Comentários com visibilidade e menções | WO-007 | **P0** | F3 | BL-036 | M |
| BL-041 | 008 | Histórico de situação com duração | WO-008 | **P0** | F3 | BL-035 | S |
| BL-042 | 008 | Reabertura com nova revisão | WO-009 | **P1** | F3 | BL-035 | S |
| BL-043 | 008 | PDF da OS com template versionado | WO-010 | **P1** | F3 | BL-036 | L |
| BL-044 | 011 | Construtor de checklist versionado | EXE-001 | **P0** | F4 | BL-036 | L |
| BL-045 | 011 | Procedimentos e resolução automática por contexto | EXE-002 | **P0** | F4 | BL-044 | M |
| BL-046 | 011 | Execução com veredito automático e fail_action | EXE-002 | **P0** | F4 | BL-045 | L |
| BL-047 | 011 | Horas: cronômetro, manual, custo congelado | EXE-003 | **P0** | F4 | BL-036 | M |
| BL-048 | 011 | Fotos com finalidade e compressão | EXE-004 | **P0** | F4 | BL-036 | M |
| BL-049 | 011 | Assinatura desenhada e por código de e-mail | EXE-005 | **P0** | F4 | BL-036 | M |
| BL-050 | 014 | Shell do PWA, instalação e sincronização inicial | FLD-001 | **P0** | F4 | BL-046 | L |
| BL-051 | 014 | Base local e fila de saída idempotente | FLD-001 | **P0** | F4 | BL-050 | XL |
| BL-052 | 014 | Tela de conflitos "Precisa da sua atenção" | FLD-002 | **P0** | F4 | BL-051 | M |
| BL-053 | 014 | Leitura de QR e criação de ativo em campo | FLD-003 | **P1** | F4 | BL-050 | M |
| BL-054 | 010 | Políticas, alvos e cascata de resolução | SLA-001 | **P0** | F5 | BL-036 | L |
| BL-055 | 010 | Relógio com calendário, feriado, fuso e pausa | SLA-002 | **P0** | F5 | BL-054 | XL |
| BL-056 | 010 | Alertas de 80 % e violação | SLA-003 | **P0** | F5 | BL-055 | M |
| BL-057 | 012 | Agenda: calendário, recursos, baldes, drag-and-drop | SCH-001 | **P0** | F5 | BL-036 | XL |
| BL-058 | 012 | Capacidade, conflitos e bloqueios de ausência | SCH-002 | **P1** | F5 | BL-057 | M |
| BL-059 | 013 | Plano com tarefas e alvos declarativos | PLN-001 | **P0** | F6 | BL-045 | L |
| BL-060 | 013 | Ciclos, tolerância e antecedência | PLN-002 | **P0** | F6 | BL-059 | L |
| BL-061 | 013 | Geração automática idempotente de OS | PLN-003 | **P0** | F6 | BL-060 | L |
| BL-062 | 013 | Painel de conformidade e ciclos anteriores | PLN-004 | **P0** | F6 | BL-061 | M |
| BL-063 | 013 | Cronograma anual exportável | PLN-005 | **P1** | F6 | BL-062 | M |
| BL-064 | 021 | Pipeline de fatos a partir de eventos | ANL-001 | **P0** | F7 | BL-005 | XL |
| BL-065 | 021 | Catálogo de métricas com definição visível | ANL-002 | **P0** | F7 | BL-064 | L |
| BL-066 | 021 | Painéis por papel com filtros globais e drill-down | ANL-003 | **P0** | F7 | BL-065 | L |
| BL-067 | 025 | Índice de busca e paleta de comandos | ANL-005 | **P0** | F7 | BL-036 | L |
| BL-068 | 020 | Portal: início, solicitações, equipamentos | POR-001 | **P0** | F8 | BL-031 | L |
| BL-069 | 020 | Portal: tradução de vocabulário por dado | POR-002 | **P0** | F8 | BL-068 | S |
| BL-070 | 020 | Portal: documentos, agenda e indicadores do escopo | POR-003 | **P1** | F8 | BL-068 | M |
| BL-071 | 023 | Roteador de notificações, preferências e digest | NOT-001 | **P0** | F8 | BL-005 | L |
| BL-072 | 023 | Verificação de e-mail e lista de bloqueio | NOT-002 | **P1** | F8 | BL-071 | M |
| BL-073 | 015 | Itens, almoxarifados, lotes e saldos | INV-001 | **P1** | F9 | BL-036 | L |
| BL-074 | 015 | Movimentos como razão imutável | INV-002 | **P1** | F9 | BL-073 | M |
| BL-075 | 015 | Reserva e consumo vinculados à OS | INV-003 | **P1** | F9 | BL-074 | M |
| BL-076 | 015 | Alerta de mínimo e inventário cíclico | INV-004 | **P2** | F9 | BL-074 | M |
| BL-077 | 016 | Orçamento versionado com itens e totais | QUO-001 | **P1** | F9 | BL-073 | L |
| BL-078 | 016 | Aprovação no portal com registro de aceite | QUO-002 | **P1** | F9 | BL-077 | M |
| BL-079 | 016 | Faturamento com baixa de estoque por lote | QUO-003 | **P2** | F9 | BL-078 | M |
| BL-080 | 017 | Contratos, cobertura e SLA contratual | CTR-001 | **P1** | F9 | BL-054 | L |
| BL-081 | 017 | Medição mensal e franquias | CTR-002 | **P2** | F9 | BL-080 | L |
| BL-082 | 018 | Motor de documentos, tipos, numeração e templates | DOC-001 | **P1** | F10 | BL-043 | XL |
| BL-083 | 018 | Assinatura com hash e versionamento | DOC-003 | **P1** | F10 | BL-082 | M |
| BL-084 | 019 | Padrões, perfis de incerteza e certificados de padrão | DOC-002 | **P1** | F10 | BL-082 | L |
| BL-085 | 019 | Certificado de calibração com pontos e fator k | DOC-002 | **P1** | F10 | BL-084 | XL |
| BL-086 | 019 | Teste de segurança elétrica com veredito | DOC-004 | **P2** | F10 | BL-082 | L |
| BL-087 | 024 | Motor de regras com simulação e log | AUT-001 | **P2** | F11 | BL-071 | XL |
| BL-088 | 027 | API pública com OpenAPI, chaves e idempotência | API-001 | **P2** | F11 | BL-036 | L |
| BL-089 | 027 | Webhooks assinados com retentativa e dead letter | API-002 | **P2** | F11 | BL-088 | M |
| BL-090 | 021 | Dashboards personalizáveis e relatórios agendados | ANL-004 | **P2** | F11 | BL-066 | L |
| BL-091 | 026 | Assistente de migração de estados legados | MIG-001 | **P1** | F9 | BL-035 | M |
| BL-092 | 005 | Medidores e leituras | AST-009 | **P3** | F11+ | BL-022 | M |
| BL-093 | 013 | Gatilho de plano por medidor | PLN-006 | **P3** | F11+ | BL-092 | L |
| BL-094 | 021 | Plano de substituição do parque | ANL-006 | **P3** | F11+ | BL-065 | L |
| BL-095 | — | IA: resumo de OS, sugestão de diagnóstico, higiene de taxonomia | IA-001..003 | **P3** | F11+ | BL-064 | XL |

---

## 44. Matriz MVP

Critério agressivo: **CORE MVP** é o mínimo para operar um contrato real e cobrar por ele. Tudo que não passa nesse teste sai.

| Classe | Features |
| --- | --- |
| ****CORE MVP****<br>F0–F6 | Multitenancy com isolamento testado · papéis de fábrica e escopo · clientes e árvore de locais · ativos com categoria, fabricante e modelo · importação · QR Code · solicitações com triagem · OS com máquina de estados e motivos de espera · atribuição e agenda simples · checklists versionados · horas · fotos · assinatura · PWA offline · planos com ciclos e conformidade · SLA com calendário · auditoria com diff · eventos de domínio |
| ****MVP+****<br>F7–F8 | Painéis por papel com definição de métrica e drill-down · busca global · portal do cliente completo · notificações multicanal com preferências · disponibilidade e tempo de parada · CSAT · custo de manutenção · Kanban · PDF da OS |
| ****FASE 2****<br>F9–F10 | Estoque com lotes e reservas · orçamentos versionados com aprovação no portal · contratos com SLA e medição · motor de documentos · certificados de calibração e padrões · teste de segurança elétrica · reincidência · taxa de utilização · CMMS ratio |
| ****FASE 3****<br>F11 | Automações sem código · API pública e webhooks · dashboards personalizáveis · relatórios agendados · inventário cíclico · laudo de obsolescência · qualificação térmica · agenda com rota · SSO |
| ****FUTURO**** | Medidores e manutenção por condição · IA (resumo, diagnóstico, higiene de taxonomia, busca em linguagem natural) · plano de substituição do parque · integração com analisadores · conectores de ERP · marketplace de procedimentos · multi-idioma · verticais adjacentes |

> **DÍVIDAS QUE O MVP NÃO PODE CONTRAIR**
>
> Estas decisões precisam estar corretas no primeiro *commit*, porque corrigi-las depois exige migração de dados com risco: **(1)** `organization_id` em toda tabela; **(2)** separação cliente / local / fornecedor; **(3)** categoria de situação e motivo de espera como dimensões distintas; **(4)** `service_request` separado de `work_order`; **(5)** `system_key` nas naturezas de OS; **(6)** snapshots de ativo e local na OS; **(7)** eventos de domínio persistidos desde o dia 1 — sem eles, o analytics histórico não existe; **(8)** `plan_task` com frequência própria; **(9)** documento genérico com tipo; **(10)** `custom` jsonb com definições tipadas.

---

## 45. Decision log (ADR)

| ADR | Decisão | Alternativas consideradas | Escolha | Justificativa |
| --- | --- | --- | --- | --- |
| ADR-001 | Modelo de tenancy | (a) instância por cliente; (b) schema por tenant; (c) linha por tenant com RLS | **(c)** + isolamento físico como plano futuro | Centenas de organizações com migração única, suporte viável e custo previsível. Isolamento reforçado por 10 camadas (§37) |
| ADR-002 | Chamado × OS | (a) mesma entidade com visão; (b) `service_request` separado | **(b)** | Recusa, duplicidade, 1→N, SLA de resposta separado, superfície de escrita mínima no portal e denominadores limpos. O custo (dupla escrituração) é anulado pela conversão de um clique e pela conversão automática opcional |
| ADR-003 | Situação × motivo de espera | (a) estados livres como na referência; (b) estados fixos; (c) categoria fixa + situação configurável + motivo separado | **(c)** | Colapsa 42 rótulos em 9 situações e 14 motivos; habilita pausa de SLA por motivo e a métrica "tempo por motivo"; mantém flexibilidade sem perder analytics |
| ADR-004 | Cliente sempre presente | (a) local direto na organização no modo interno; (b) sempre um `customer`, com `is_internal` | **(b)** | Um único caminho de código em escopo, consulta, RLS e relatório. O custo é um registro no onboarding e uma interface que esconde a camada |
| ADR-005 | Hierarquia de locais | (a) níveis fixos; (b) árvore livre; (c) árvore com tipos configuráveis e regras de aninhamento | **(c)** com `ltree` | Serve saúde hoje e outros mercados depois, sem árvore anárquica |
| ADR-006 | Asset × Equipment | (a) duas entidades; (b) `asset` universal com rótulo configurável | **(b)** | "Equipamento" é vocabulário de vertical, não conceito de domínio |
| ADR-007 | RBAC | (a) papéis fixos; (b) só granular; (c) papéis de fábrica + granular + escopo separado | **(c)** | A referência prova que só granular leva a "Técnico com 101 permissões". Papéis prontos definem o caminho feliz; granular resolve a exceção |
| ADR-008 | Analytics | (a) BI externo; (b) consulta direta no transacional; (c) tabelas de fato nativas | **(c)** | BI externo sai do RBAC e da identidade do produto; consulta direta produz as telas de 30 s observadas na referência |
| ADR-009 | Campos personalizados | (a) EAV; (b) jsonb livre; (c) jsonb + definições tipadas; (d) colunas por tenant | **(c)** | Validação, busca, relatório e indexação sem explosão de junções nem de esquema |
| ADR-010 | Arquitetura de aplicação | (a) BaaS com lógica em RLS e funções de borda; (b) microsserviços; (c) monólito modular com BaaS para identidade e arquivos | **(c)** | As regras deste domínio não cabem em políticas de banco; microsserviços são prematuros. Fronteiras modulares preservam a opção de extrair |
| ADR-011 | Agendamento | (a) entidade de evento própria; (b) campos na OS com a agenda como projeção | **(b)** | Evita duas fontes de verdade. Ausências continuam sendo entidade própria |
| ADR-012 | Checklist | (a) JSON como na referência; (b) tabelas relacionais versionadas | **(b)** | Resposta de checklist é evidência regulatória; precisa de versão congelada, consulta e agregação |
| ADR-013 | Documentos | (a) um módulo por tipo; (b) motor único com tipos e payload validado | **(b)** | Seis módulos com 90 % de estrutura comum na referência; o motor único elimina cinco implementações |
| ADR-014 | Eventos | (a) só auditoria CRUD; (b) só eventos; (c) ambos | **(c)** | Diff não sabe o que é um fato de negócio; evento não captura toda edição. Auditoria, automação e analytics precisam de coisas diferentes |
| ADR-015 | Identidade do portal | (a) tabela `solicitantes` separada como na referência; (b) usuário + *membership* `portal` | **(b)** | Um modelo de identidade, um fluxo de autenticação, uma trilha de auditoria. Assento pago continua diferenciado por `seat_type` |
| ADR-016 | Estilo de API | (a) REST; (b) GraphQL; (c) RPC tipado | **(a)** com OpenAPI gerado | O consumo previsto é integração de sistema, previsível e cacheável, não montagem dinâmica de tela |
| ADR-017 | Fila de jobs | (a) Redis/SQS; (b) fila no Postgres | **(b)** no início | Enfileiramento na mesma transação do dado elimina toda uma classe de inconsistência; sem infra adicional |
| ADR-018 | Mobile | (a) app nativo; (b) PWA | **(b)** | Uma base de código, distribuição sem loja, atualização imediata. Reavaliar se push confiável ou NFC virarem requisito |
| ADR-019 | Exclusão | (a) exclusão física; (b) soft delete + arquivamento | **(b)** | Histórico regulado de 10 anos; a referência já usa "ocultar" e acerta |
| ADR-020 | Taxonomia de falha | (a) tipo de serviço acumulando tudo; (b) natureza × sintoma × causa × ação | **(b)** | A referência acabou com "Rodas travadas" como tipo de serviço. Separar habilita análise de causa raiz |

---

## 46. Open questions

| # | Pergunta | Impacto | Quem responde | Bloqueia MVP? |
| --- | --- | --- | --- | --- |
| OQ-01 | Vamos migrar dados do TechneCare/Arkmeds ou começar do zero? | Define se precisamos do assistente de migração de estados, do mapeamento de 651 tipos e da conciliação de indicadores históricos. Muda o escopo de F2 e F9 | Você / diretoria | **Sim** — decide o escopo de importação |
| OQ-02 | Se houver migração, os números precisam bater com os do sistema antigo? | Se sim, precisamos das fórmulas exatas de Disponibilidade, MTTR, MTBF e TMAC — que a auditoria não conseguiu obter | Fornecedor Arkmeds | Não, mas bloqueia F7 |
| OQ-03 | O primeiro cliente é prestadora multicliente ou departamento interno? | Define qual dos dois modos é polido primeiro e se o portal entra antes ou depois | Você | **Sim** |
| OQ-04 | Metrologia é obrigatória para o primeiro contrato? | Certificados de calibração são o item mais caro da especificação (XL). Se o piloto não calibra, F10 pode esperar | Cliente piloto | Não |
| OQ-05 | Qual o volume real do piloto (ativos, OS/mês, técnicos, clientes)? | Define metas de desempenho, particionamento e se réplica de leitura entra no MVP | Cliente piloto | Não |
| OQ-06 | Quais estados o cliente piloto realmente usa hoje? | Valida o mapeamento 42 → 9+14. Se aparecer um caso que não cabe, a categoria precisa ser revista **antes** de F3 | Coordenador do piloto | **Sim** |
| OQ-07 | Falta de peça deve pausar o SLA? | Nossa decisão padrão é **não** (é responsabilidade nossa). Contratos podem exigir o contrário | Comercial / jurídico | Não — é configurável |
| OQ-08 | Assinatura eletrônica simples é suficiente ou precisamos de ICP-Brasil? | Muda o custo e o fluxo de assinatura de laudos com valor legal (ART/CREA) | Responsável técnico / jurídico | Não, mas modelar já |
| OQ-09 | Haverá integração com ERP hospitalar no primeiro ano? | Se sim, a API pública sobe de P2 para P1 e o modelo precisa de `external_id` em ativos, clientes e OS desde F2 | Você / cliente | Não, mas afeta o modelo |
| OQ-10 | Modelo de cobrança: por assento, por ativo ou por contrato? | Define o que instrumentar em telemetria e se `seat_limit` é a métrica certa | Você | Não |
| OQ-11 | WhatsApp é requisito comercial ou conveniência? | É o canal real de comunicação nesses hospitais. Se for requisito, sobe para F8 | Você / cliente piloto | Não |
| OQ-12 | Precisamos de PMOC (manutenção predial de climatização)? | A referência tem a preferência "Habilitar PMOC". É um módulo regulado próprio | Cliente piloto | Não |
| OQ-13 | Qual o nome definitivo do produto e o domínio? | Afeta identidade visual, e-mails transacionais, PWA e URLs | Você | Não |
| OQ-14 | Haverá integração com analisadores (nossos ou de terceiros)? | É o fosso competitivo da Arkmeds. Se quisermos competir nisso, o tipo de item `auto_test` e o protocolo de importação precisam de espaço no roadmap | Você | Não |
| OQ-15 | Onde hospedar (região, provedor) e há exigência de dado em território nacional? | Afeta latência, custo e conformidade contratual com hospitais públicos | Você / jurídico | **Sim** — decide F0 |

---

## 47. Anti-patterns do sistema de referência

O que observamos na auditoria, por que é problema, e o que faremos em lugar disso.

| Anti-pattern | Evidência | Consequência | Nossa solução |
| --- | --- | --- | --- |
| **Empresa polimórfica** | `empresa.tipo` ∈ Principal, Cliente Externo, Cliente Interno, Fornecedor, Local, Setor, com FK `superior` | Impossível dar campos próprios a cada conceito; consulta recursiva em toda parte; fornecedor e setor na mesma tabela | Separar `customers`, `locations` (árvore com tipos) e `suppliers` — ADR-005 |
| **Estados livres** | 42 estados; cadastro com um único campo (Descrição) | Sem categoria, cor, terminalidade nem transição; semântica "ativa/inativa" hardcoded; Kanban ilegível | Categoria fixa + situação configurável + grafo de transições — ADR-003 |
| **Motivo codificado no estado** | "Aguardando peças", "Aguardando aprovação do orçamento", "Aguardando liberação da unidade"… | Explosão combinatória; impossível pausar SLA por motivo; nenhuma métrica de causa de bloqueio | `wait_reason` como dimensão separada, com `pauses_sla` e responsável |
| **Inconsistência de capitalização** | "fechada" (312 OS) convivendo com "Fechada"; "Emprestimo" e "Empréstimo de equipamento"; "Reposição de Oxigênio" duplicado | Indicadores fragmentados; contagem errada de OS encerradas | Chave técnica estável separada do rótulo; unicidade normalizada (sem acento, case-insensitive); mesclagem assistida de duplicatas |
| **BI externo** | Menu "BI" apontando para o Looker Studio | Dado fora do RBAC, interface estranha, mudança de indicador vira consultoria | Analytics nativo com tabelas de fato e catálogo de métricas — ADR-008 |
| **RBAC sem papéis prontos** | 138 permissões, grupos vazios, "Técnico" com 101 delas, grupo chamado "." | Configuração impossível de auditar; privilégio excessivo por padrão | Dez papéis de fábrica testados; granular como exceção; alerta de papel excessivamente permissivo — ADR-007 |
| **Taxonomia sem governança** | 651 tipos de equipamento, 360 problemas, 344 origens, 37 tipos de serviço com sintomas dentro | Combos inoperáveis, relatórios fragmentados, dado não comparável | Catálogos normalizados (categoria/fabricante/modelo), taxonomia de falha em três eixos, listas contextuais e curadoria — ADR-020 |
| **Checklist como JSON solto** | `[{tipo, desc, appr[]}]` em uma coluna | Sem versão, sem consulta, sem agregação, sem faixa numérica com veredito | Tabelas relacionais versionadas com resposta congelada — ADR-012 |
| **Seis módulos documentais paralelos** | Calibração, rascunho, padrão, TSE, obsolescência, térmica | Cinco implementações da mesma numeração, validade, assinatura e PDF | Motor único com `document_type` e payload validado — ADR-013 |
| **Duas classes de identidade** | `usuarios` e `solicitantes` em tabelas distintas | Dois fluxos de autenticação, duas trilhas, duas telas de gestão | Um `user`, *membership* com `seat_type` — ADR-015 |
| **Automação anêmica** | 2 modelos, 2 gatilhos, ação de e-mail | Nada de SLA, escalonamento, data, ação interna ou condição composta | Motor gatilho → condição → ação sobre o barramento de eventos, com simulação e log |
| **Consulta transacional em painel** | Telas que excederam 30 s de renderização durante a auditoria; paginação de 2.954 páginas por *offset* | Produto inutilizável no volume real do próprio cliente | Tabelas de fato, cursor, virtualização e metas de p95 no CI |
| **Limite comunicado sem saída** | "Número máximo de relatórios (5) atingido"; "36 de 38" | Bloqueio sem caminho de resolução | Limite sempre acompanhado da ação ("gerenciar assentos", "arquivar relatório") |
| **Vazamento de vocabulário interno** | Rota de calibração `/calibracao/balanca/`; "Oficina" × "Quadro de trabalho"; "Model" e "Tópico" na tela de automação | O usuário aprende dois idiomas | Glossário único e obrigatório (§03), aplicado a tela, PDF e e-mail |
| **Erro que não ensina** | Modal de checklist exibindo apenas "Erro!"; *lorem ipsum* em produção | Erosão de confiança; chamado de suporte evitável | Mensagem com causa, campo e próximo passo; proibição de placeholder em produção no checklist de release |
| **Ausência de busca global** | Só busca dentro de cada lista | O usuário precisa saber onde procurar antes de procurar | Paleta ⌘K sobre todos os domínios, respeitando escopo |
| **Mudança de dono corrompendo histórico** | Aviso: "as OS não poderão ser editadas caso altere o proprietário do equipamento" | O histórico depende do estado atual do cadastro | Snapshots de ativo e local congelados na OS + transferência como operação registrada |

---

## 48. Diferenciais competitivos

| Capacidade | Classificação | Racional |
| --- | --- | --- |
| Inventário com QR Code e ficha 360° | **Paridade** | A referência já faz bem; não fazer é eliminatório |
| Planos com ciclos e conformidade | **Paridade** | Idem — é o que sustenta o contrato |
| Certificados de calibração com incerteza | **Paridade** | Barreira de entrada na vertical clínica |
| Trilha de auditoria com diff campo a campo | **Paridade** | Requisito regulatório |
| **Máquina de estados com transições e guardas** | **Melhoria** | Ninguém no mercado brasileiro entrega transições declaradas e requisitos de conclusão por natureza |
| **Motivo de espera separado da situação** | **Melhoria** | Colapsa 42 rótulos em 9+14 e cria a métrica "onde o backlog trava" |
| **Solicitação separada da OS** | **Melhoria** | Denominadores limpos, duplicidade tratada, portal com superfície mínima |
| **Analytics nativo com definição visível** | **Melhoria** | Indicador que se explica é indicador que o gestor defende na reunião |
| **Papéis prontos + escopo hierárquico** | **Melhoria** | Configuração em minutos, não em dias de consultoria |
| **Busca global ⌘K** | **Melhoria** | Muda a percepção de velocidade do produto inteiro |
| **Interface moderna, um só idioma visual, tema escuro** | **Melhoria** | É o primeiro argumento de venda em demonstração |
| **PWA offline-first com conflito visível** | **Diferencial** | O concorrente tem app offline; ter *zero perda silenciosa* com resolução explícita é outro patamar |
| **Thread colaborativa na OS** | **Diferencial** | Substitui o WhatsApp e traz de volta para o sistema a conversa que hoje se perde |
| **Portal do cliente desenhado, com vocabulário traduzido** | **Diferencial** | É o que o hospital vê; hoje é o mais negligenciado do mercado |
| **Automação por evento com simulação prévia** | **Diferencial** | "Esta regra teria disparado 412 vezes" evita o abandono do canal |
| **Checklist com veredito automático e OS derivada** | **Diferencial** | Transforma ronda em geradora de demanda qualificada |
| **SLA com calendário, feriado e fuso do local** | **Diferencial** | Torna a meta justa e defensável; hoje ninguém entrega isso no segmento |
| **API-first com webhooks assinados** | **Diferencial** | Integração com ERP hospitalar é decisão de compra em rede grande |
| **IA sobre o histórico do ativo** | **Moat futuro** | 73 mil descrições de serviço e a taxonomia de falha em três eixos são a matéria-prima; quanto mais tempo o cliente usa, melhor fica — e mais caro fica sair |
| **Plano de substituição do parque** | **Moat futuro** | Move a conversa de "manutenção" para "investimento", elevando o interlocutor e o ticket |
| **Marketplace de procedimentos e checklists** | **Moat futuro** | Efeito de rede: cada organização que publica um procedimento torna o produto mais valioso para as demais |
| **Manutenção por condição com IoT** | **Moat futuro** | Depende de sensores no parque; alto valor, horizonte longo |

> **ONDE NÃO VAMOS COMPETIR**
>
> **Hardware.** O fosso competitivo real da Arkmeds não é o software — são os analisadores proprietários (Tesla, Otto, Waller) que preenchem checklists automaticamente. Construir hardware é outro negócio. Nossa resposta é **abertura**: importar resultados de analisadores de qualquer fabricante por arquivo e por API, transformando o fosso deles em uma limitação de portfólio.

---

Especificação funcional e arquitetural · rascunho v0.1 para aprovação · derivada da auditoria TechneCare/Arkmeds v2.69.0 · nenhum código, projeto, banco ou migração foi criado.
