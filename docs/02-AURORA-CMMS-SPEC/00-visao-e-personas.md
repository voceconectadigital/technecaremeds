<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 1 de 13 — seções 01 a 02
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

Especificação funcional e arquitetural · não implementar

# Aurora — plataforma de gestão de ativos e manutenção

Especificação completa de um SaaS multitenant para engenharia clínica e manutenção de ativos, derivada da auditoria funcional do Arkmeds/TechneCare e reprojetada para eliminar suas dívidas estruturais. Este documento é a fonte de verdade para implementação.

**Status** rascunho para aprovação · **Base** auditoria TechneCare v2.69.0 · **Vertical inicial** engenharia clínica · **Horizonte** multi-vertical · **Código produzido** nenhum

> **COMO LER ESTE DOCUMENTO**
>
> **DECISÃO** marca escolhas já tomadas e justificadas — implemente conforme escrito. **HIPÓTESE** marca suposições que precisam de validação com o cliente antes da implementação do épico correspondente. **A VALIDAR** marca fórmulas ou regras que a auditoria não conseguiu confirmar no sistema de referência e que não devem ser inventadas. Toda entidade, evento, permissão e estado citado tem nome técnico estável em `snake_case`; o rótulo pt-BR da interface está sempre ao lado e pode mudar sem impacto no modelo.

## 01. Visão do produto

### O problema

Departamentos de engenharia clínica e empresas prestadoras de manutenção hospitalar administram parques de dezenas de milhares de ativos críticos sob pressão regulatória permanente (ANVISA, RDC 509, NBR 15943, ISO/IEC 17025, ONA). O trabalho real acontece em corredores sem sinal de celular, com o técnico segurando um analisador em uma mão e o celular na outra. O registro desse trabalho é o que sustenta o contrato, a acreditação e a segurança do paciente.

Os sistemas disponíveis hoje no Brasil resolvem o domínio — e a auditoria do Arkmeds mostra que resolvem com profundidade real, especialmente em metrologia. Mas carregam três décadas de dívida: modelos de dados que confundem cliente, unidade, setor e fornecedor na mesma tabela; "estados" que são texto livre e viram 42 rótulos incoerentes; automação que só sabe mandar e-mail; BI terceirizado para fora do produto; e uma interface em que três gerações visuais convivem na mesma sessão.

### A visão

Aurora é a plataforma onde uma equipe de manutenção registra, comprova e melhora o cuidado com ativos críticos — com um modelo de domínio correto, uma experiência que o técnico usa de pé e sem internet, e analytics nativo que transforma o registro em argumento contratual.

### Proposta de valor por público

| Para | Que sofre com | Aurora entrega | Diferente de |
| --- | --- | --- | --- |
| **Prestadora de engenharia clínica** | Provar contratualmente o que executou em 30 hospitais | Conformidade de planos por contrato, SLA medido, portal por cliente, relatórios agendados | Planilhas + PDF montado à mão |
| **Departamento interno de hospital** | Auditoria ONA/JCI e fila de corretivas sem controle | Prontuário completo do ativo, checklists versionados, trilha de auditoria com diff | Sistemas onde o histórico depende de campo de texto livre |
| **Gestor de manutenção** | Não saber onde o backlog trava | Estados com categoria e motivo de espera separados; "tempo por estado" nativo | 42 estados soltos sem semântica |
| **Técnico de campo** | Sem sinal, com as mãos ocupadas, digitando duas vezes | PWA offline-first, QR Code, checklist com foto, assinatura no dedo, sincronização com resolução de conflito visível | App que exige conexão para abrir a OS |
| **Cliente (hospital atendido)** | Não enxergar o que foi feito nos seus equipamentos | Portal com seus ativos, chamados, certificados e indicadores — desenhado, não improvisado por permissões | Portal que é um subconjunto de checkboxes |

### Escopo inicial (vertical de entrada)

Engenharia clínica e manutenção hospitalar, no modo **prestadora multicliente** e no modo **departamento interno**, usando o mesmo produto e o mesmo modelo de dados. Essa é a decisão de escopo mais importante: a auditoria mostrou que os dois modos exercitam quase os mesmos fluxos, e tratá-los como produtos diferentes duplicaria o domínio.

### Mercados futuros

O modelo é deliberadamente agnóstico de vertical: `asset`, `location`, `work_order`, `maintenance_plan` e `checklist` não contêm nada específico de saúde. O que é específico da vertical vive em **catálogos configuráveis** (tipos de local, categorias de ativo, tipos de serviço, tipos de documento) e em **módulos plugáveis** (metrologia, segurança elétrica, qualificação térmica). Mercados adjacentes viáveis sem reescrita: manutenção predial e facilities, frotas leves, laboratórios, indústria de pequeno e médio porte, assistência técnica autorizada.

### Nossos oito compromissos de produto

1. **O estado é uma máquina, não um texto.** Nenhuma transição acontece fora do grafo declarado.
2. **Espera tem motivo separado do estado.** "Aguardando" é um estado; "peça", "aprovação do cliente" e "liberação da sala" são motivos.
3. **Toda ação relevante emite um evento de domínio.** Auditoria, notificação, automação, integração e analytics consomem o mesmo evento.
4. **O offline é requisito, não recurso.** O técnico executa a OS inteira sem rede.
5. **Analytics é nativo.** Nenhuma métrica do produto depende de ferramenta externa.
6. **Papéis prontos primeiro, granularidade depois.** Ninguém deve precisar marcar 138 caixas para começar.
7. **Nada de exclusão silenciosa.** Arquivamento e *soft delete*; histórico de 10 anos não pode quebrar.
8. **Multitenancy no primeiro commit.** Nenhuma tabela de negócio existe sem `organization_id`.

> **NOME DO PRODUTO**
>
> **HIPÓTESE.** "Aurora" é usado neste documento como nome de trabalho, para dar identidade estável às referências (`aurora.app`, prefixos de evento, títulos de tela). Trocar o nome depois não afeta nenhuma decisão técnica aqui.

---

## 02. Personas

Oito personas, derivadas dos cargos reais observados na auditoria (Engenheiro clínico, Engenheira clínica, Engenheiro eletricista, Técnico em Equipamentos Médicos, Técnico de Eletrônica, Gestor administrativo, Coordenação, Enfermeira) e dos dois tipos de conta do sistema de referência.

#### PER-01 · Owner — Proprietário da conta — Ana, sócia da prestadora

**Contexto.** Responde pelo contrato SaaS, pelo faturamento e pela conformidade da empresa. Entra no sistema poucas vezes por semana.

**Precisa.** Ver saúde comercial da operação (receita recorrente × avulsa, contratos a vencer), controlar assentos e faturamento, e ser a única pessoa capaz de excluir a organização ou transferir a titularidade.

**Métrica de sucesso.** Renovação de contratos e margem por cliente.

**Permissões distintivas**

`organization.manage`, `billing.manage`, `member.invite` sem limite, transferência de *ownership*.

#### PER-02 · Gestor — Gestor de manutenção — Anderson, engenheiro clínico responsável técnico

**Contexto.** Assina laudos e certificados com seu CREA. Responde por conformidade regulatória e pelo indicador entregue ao hospital.

**Precisa.** Conformidade de planos por contrato, vencimentos de calibração, backlog por criticidade, custo por ativo, e evidência auditável de tudo. Precisa saber, em uma tela, o que está fora do prazo e por quê.

**Dor atual.** "Tempo por estado" existe como métrica, mas os estados não têm categoria — então a análise de gargalo não fecha.

**Permissões distintivas**

Assinar documentos técnicos, liberar certificados, editar OS fechada, ver custos e indicadores financeiros.

#### PER-03 · Coordenador — Coordenador de campo — Sérgio, supervisor de equipe

**Contexto.** Faz triagem de chamados e distribui trabalho todos os dias, de manhã. É o usuário mais frequente do sistema.

**Precisa.** Fila de solicitações sem responsável, agenda com carga por técnico, arrastar-e-soltar para programar, e um Kanban que reflita a realidade do dia.

**Dor atual.** No sistema de referência há **2.950 serviços não agendados** — exatamente o total de OS ativas. A agenda existe e ninguém usa, porque programar custa mais do que ligar para o técnico.

**Permissões distintivas**

Triar solicitação, atribuir e reatribuir OS, reagendar, aprovar horas.

#### PER-04 · Técnico — Técnico de campo — Rafael, técnico em equipamentos médicos

**Contexto.** 6 a 12 atendimentos por dia, em corredores, UTIs e centros cirúrgicos. Celular na mão, sem sinal em subsolo e em salas blindadas de radiologia.

**Precisa.** Ver o dia dele, abrir a OS lendo o QR do equipamento, executar o checklist, fotografar antes e depois, apontar peças e horas, colher assinatura e fechar — tudo offline, sincronizando depois.

**Não precisa.** De 25 filtros, de Kanban, de relatório e de configuração.

**Permissões distintivas**

Executar apenas as OS atribuídas a ele ou à sua equipe; consumir estoque; criar ativo em campo (com aprovação posterior).

#### PER-05 · Metrologista — Especialista em calibração — Natália, engenheira

**Contexto.** Emite certificados que precisam resistir a auditoria de acreditação. Trabalha com padrões que têm validade própria.

**Precisa.** Cadeia de rastreabilidade íntegra, bloqueio de emissão com padrão vencido, cálculo de incerteza expandida, critério de aceitação e veredito por ponto.

**Permissões distintivas**

Emitir e liberar certificados, gerenciar padrões e perfis de incerteza, aprovar procedimentos metrológicos.

#### PER-06 · Estoque — Almoxarife — Wellington

**Contexto.** A maior causa de OS travada é peça. Na auditoria, **789 OS** estavam em "Aguardando peças".

**Precisa.** Entrada com nota fiscal e lote, reserva vinculada à OS, alerta de mínimo, inventário cíclico e rastreabilidade de quem consumiu o quê.

**Permissões distintivas**

Movimentar estoque, ajustar saldo com justificativa, gerenciar fornecedores.

#### PER-07 · Financeiro — Analista financeiro — Roger, gestor administrativo

**Contexto.** Fatura contratos recorrentes e serviços avulsos; controla o que foi aprovado e o que virou nota.

**Precisa.** Orçamentos por status, medição mensal do contrato, custo real (horas × custo/hora + peças) e faturamento com baixa de estoque.

**Permissões distintivas**

Ver e editar valores, faturar, gerenciar contratos e tabelas de preço.

#### PER-08 · Solicitante — Solicitante do cliente — Marília, enfermeira coordenadora de UTI

**Contexto.** Não é usuária de sistema de manutenção. Entra duas vezes por mês, quando um equipamento falha. Já usa o celular na mão.

**Precisa.** Abrir chamado em menos de 30 segundos (idealmente lendo o QR Code do equipamento), acompanhar, assinar e avaliar.

**Não pode ver.** Custos internos, observações internas, outros clientes, outros setores fora do seu escopo.

**Permissões distintivas**

Criar solicitação, assinar OS, aprovar/reprovar orçamento, avaliar atendimento — sempre restrito às localizações do seu escopo.

#### PER-09 · Gestor do cliente — Contato executivo do hospital — Cláudia, gerência de suprimentos

**Contexto.** Recebe o relatório mensal e decide renovação de contrato. Não abre chamados.

**Precisa.** Painel com disponibilidade, conformidade do plano, SLA cumprido e evolução do custo — sem precisar interpretar o sistema.

**Permissões distintivas**

Ver indicadores e documentos de todo o seu *customer*, sem restrição de setor; sem acesso a dados internos da prestadora.

#### PER-10 · Auditor — Auditor / qualidade — perfil eventual

**Contexto.** Acreditação ONA, auditoria interna, fiscalização. Precisa de leitura ampla e rastreabilidade, sem qualquer poder de escrita.

**Permissões distintivas**

Somente leitura em tudo, incluindo trilha de auditoria e documentos; exportação permitida; nenhuma escrita.
