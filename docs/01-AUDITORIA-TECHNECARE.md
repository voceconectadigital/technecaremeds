Engenharia reversa funcional · somente leitura

# Auditoria do TechneCare sobre a plataforma Arkmeds

Levantamento funcional completo de um CMMS de engenharia clínica em produção — 87 rotas de menu, 42 estados de OS, 138 permissões, 13 métricas nativas — e a especificação de base para construir um produto superior.

**Alvo** technecare.arkmeds.com · **Versão** 2.69.0 (27/08/2026) · **Data** 28/08/2026 · **Perfil usado** Eng. Clínico / Administrador · **Escrita no sistema** nenhuma

## 01. Resumo executivo

O Arkmeds é um **CMMS/EAM vertical de engenharia clínica** entregue como SaaS multiempresa. O TechneCare é uma instância (tenant) operada por uma prestadora de serviços de engenharia clínica que atende dezenas de hospitais — o que faz desta instância um caso de uso especialmente rico: ela exercita simultaneamente o modo "departamento interno de hospital" e o modo "prestador multicliente".

- **27.223** — Equipamentos
- **73.826** — Ordens de serviço
- **1.050** — Empresas / setores
- **826** — Planos preventivos
- **7.650** — Certificados de calibração
- **1.971** — Solicitantes (portal)
- **36/38** — Usuários internos (licenças)
- **2.265** — Chamados
- **4,4** — Nota média de atendimento

### Que problemas a plataforma resolve

1. **Inventário e rastreabilidade do parque tecnológico** — cada equipamento tem prontuário completo: dados técnicos, patrimônio, ANVISA, criticidade, contrato, depreciação, QR Code, e todo o histórico de OS, calibrações, testes elétricos e laudos.
2. **Execução da manutenção** — corretiva (via chamado do setor assistencial) e preventiva (via planos com geração automática de OS), com checklist, registro de horas, peças, protocolos de recolhimento/entrega e assinatura digital.
3. **Conformidade regulatória e metrológica** — emissão de certificados de calibração com incerteza expandida e fator de abrangência (padrão ISO/IEC 17025), testes de segurança elétrica, qualificação térmica e laudos de obsolescência com ART/CREA.
4. **Gestão comercial do serviço** — contratos, orçamentos com aprovação do cliente, faturamento com débito de estoque, receita recorrente vs. avulsa.
5. **Prestação de contas ao cliente** — portal do solicitante, avaliação de chamados (CSAT 1–5), relatórios periódicos por e-mail e indicadores MTTR/MTBF/disponibilidade.

### Leitura arquitetural em cinco frases

- O sistema é um **Django monolítico** (CSRF token, rotas `/model/verbo/id/`, Bootstrap + jQuery + DataTables + select2), com algumas telas novas em SPA (Chamados, Agenda, Kanban) e arquivos em **AWS S3**.
- A entidade central não é "cliente" nem "unidade": é **Empresa**, uma tabela auto-relacionada e polimórfica (`tipo` ∈ Principal, Cliente Externo, Cliente Interno, Fornecedor, Local, Setor) com FK `superior`. Toda a hierarquia hospital → unidade → setor é feita nessa única tabela.
- **Chamado e Ordem de Serviço são o mesmo registro** — a tela de Chamados é uma fila de triagem sobre OS abertas por solicitantes. Não há entidade separada.
- O motor de conhecimento técnico é a tripla **Checklist → Procedimento → OS**: o procedimento amarra checklists a tipo de equipamento + tipo de serviço + frequência, e a OS "puxa" os checklists aplicáveis.
- O **Plano** é o coração da preventiva: define ciclo (data inicial + frequência + prazo), lista equipamentos com três flags de serviço (P = preventiva, C = calibração, E = teste elétrico) e, com `abertura_automatica`, materializa as OS do ciclo.

### Onde a plataforma é forte

- Profundidade metrológica real (incerteza, padrões rastreados, VVC, critério de aceitação, correção de erro sistemático) — raro em CMMS genéricos.
- Modelo de plano com ciclos e "ciclos anteriores", com conformidade medida.
- RBAC granular de verdade: 138 permissões atômicas, incluindo permissões de *ocultar campos* na OS.
- Auditoria com diff campo a campo em 34 modelos.
- Aplicativo móvel (MARK II) com operação offline e integração com analisadores proprietários (Tesla, Otto, Waller) que preenchem checklists automaticamente.

### Onde há oportunidade clara

- **Estados de OS sem máquina de estados**: o cadastro de estado tem exatamente um campo (Descrição). Sem categoria, cor, SLA, transições permitidas nem flag terminal. Resultado observado: 42 estados criados pelo tenant, muitos redundantes ou grafados em caixa alta aleatória, e a semântica "ativa/inativa" fica hardcoded no código.
- **Motor de automação anêmico**: apenas 2 modelos (OS, Estoque) e 2 gatilhos (mudança de estado, estoque mínimo), com ação única de e-mail (webhook existe mas é marginal). Nada de SLA, escalonamento, WhatsApp ou regras compostas.
- **Taxonomias sem governança**: 651 tipos de equipamento, 360 problemas relatados, 344 origens de problema e 37 tipos de serviço em uso livre — com duplicatas evidentes ("Reposição de Oxigênio na unidade" cadastrado duas vezes; "Rodas travadas" como *tipo de serviço*).
- **BI terceirizado**: o menu "BI" é um link externo para um relatório do Google Looker Studio — fora do produto, fora do RBAC, fora do tema.
- **UI datada**: Bootstrap 3/4, densidade irregular, filtros em painéis modais, três gerações visuais convivendo na mesma sessão.

> **MÉTODO E INTEGRIDADE DA AUDITORIA**
>
> Toda a coleta foi feita por navegação autenticada e leitura de DOM (`GET` + inspeção). **Nenhum registro foi criado, alterado, excluído, assinado, aprovado, movimentado ou exportado.** Nenhum botão de escrita foi acionado; formulários de edição foram abertos apenas para leitura da estrutura de campos e nunca submetidos. Filtros persistentes não foram salvos. Não houve teste de segurança, fuzzing ou tentativa de acesso fora do escopo do usuário autenticado.

#### Legenda de confiança usada no documento

**Alta** · observado diretamente na plataforma · **Média** · evidência forte (documentação pública, rótulo de campo, comportamento correlato) · **Baixa** · hipótese de arquiteto, não comprovada

## 02. Mapa completo do sistema

Árvore extraída do menu lateral renderizado (87 itens). O painel de controle não aparece no menu: é a rota raiz com três abas. "BI" é o único item que aponta para fora do domínio.

```

PAINEL DE CONTROLE  /
 ├── Geral            /?tab=geral
 ├── Planos           /?tab=planos
 └── Agendamentos     /?tab=agendamentos&ag-tab=hoje|semana

CADASTRO E CONSULTA
 ├── Empresas e clientes            /cadastros/empresa/
 ├── Equipamentos                   /cadastros/equipamento/
 ├── Contratos                      /contrato/
 ├── Procedimentos
 │    ├── Gerenciar procedimentos   /cadastros/procedimento/
 │    └── Checklists                /cadastros/checklist_novo/
 └── Campos gerenciais
      ├── Estados de OS             /cadastros/estado_ordem_servico/
      ├── Tipos de OS               /cadastros/tipo_ordem_servico/
      ├── Tipos de origem de problema   /cadastros/tipo_origem_problema/
      ├── Tipos de problemas relatados  /cadastros/tipo_problema_relatado/
      ├── Tipos de equipamento      /cadastros/tipo_equipamento/
      ├── Tipos de criticidades     /cadastros/criticidade/
      ├── Quadro de trabalho        /cadastros/oficina/
      └── Numeração de Documentos   /cadastros/numeracao_documentos/

SERVIÇOS
 ├── Chamados                       /chamado/
 ├── Ordens de serviço              /ordem_servico/  + /kanban/  + /agenda/
 ├── Rascunho de ordens de serviço  /ordem_servico/rascunho/
 ├── Planos e serviços recorrentes  /?tab=planos  →  /plano/visual/{id}/
 ├── Transferências                 /cadastros/transferencias/
 └── Protocolos
      ├── Entrega                    /protocolo/entrega/
      ├── Recolhimento               /protocolo/recolhimento/
      └── Serviço                    /protocolo/servico/

CERTIFICADOS E LAUDOS
 ├── Certificado de calibração      /calibracao/balanca/
 ├── Rascunho de calibração         /calibracao/rascunho/
 ├── Certificados de padrões        /calibracao/padrao/
 ├── Testes de segurança elétrica   /tse/equipamento/
 ├── Laudos de obsolescência        /servicos/baixa_patrimonial/
 └── Qualificações térmicas         /validacao_termica/

ORÇAMENTOS
 ├── Gerenciar orçamentos           /orcamento/
 └── Configurações
      ├── Cadastro de serviços       /orcamento/servico/
      └── Motivos de reprovação      /orcamento/motivo_reprovacao/

ESTOQUE
 ├── Gerenciar estoque              /estoque/peca/
 └── Configurações
      ├── Tipos de peças             /estoque/tipo_peca/
      ├── Categoria de peças         /estoque/categoria_peca/
      └── Unidade de peças           /estoque/unidade_peca/

RELATÓRIOS
 ├── Análise de dados  (exportação assíncrona: Gerar + Listar)
 │    ├── Equipamento    /export/csv/equipamento/ · /cadastros/analise/list/
 │    ├── Calibrações    /export/csv/calibracao/ · /calibracao/analise/list/
 │    ├── Orçamentos     /export/csv/orcamento/ · /orcamento/analise/list/
 │    └── Ordem de Serviço /export/csv/ordem_servico/ · /ordem_servico/analise/list/
 ├── Conclusão de OS                /relatorio/ordem_servico_concluidas/
 ├── Controle patrimonial           /relatorio/controle_patrimonial/ · /relatorio/patrimonial/list/
 ├── Estado de OS                   /relatorio/ordem_servico_estado/
 ├── Registros de horas             /relatorio/registro_horas/
 ├── Serviços terceirizados por empresa /relatorio/servicos_prestados/
 ├── Vencimento de calibrações      /relatorio/vencimento/
 ├── Produtividade da equipe        /relatorio/produtividade_equipe/
 ├── Inclusão de peças              /relatorio/inclusao_pecas/
 ├── Utilização de peças            /relatorio/utilizacao_pecas/ (+ /list/)
 ├── Conformidade de planos         /relatorio/planos/
 └── Cronograma de planos           /relatorio/cronograma_planos/

INDICADORES DE DESEMPENHO
 ├── Indicadores gerais             /kpi/geral/
 └── Avaliações dos chamados        /chamado/avaliacao/

ROBÔS
 ├── Integração e notificação       /automacao/  (e-mail | webhook)
 └── Relatório automático           /kpi/relatorio/listar

USUÁRIOS
 ├── Meus usuários                  /usuarios/
 ├── Grupos de permissões           /usuarios/grupos/
 └── Solicitantes                   /usuarios/solicitante/

FERRAMENTAS DE SISTEMA
 ├── Histórico                      /model_history/
 └── Preferências                   /preferences/

BI  →  datastudio.google.com/reporting/711da4db-… (externo)

FORA DO MENU
 ├── Perfil do usuário              /usuarios/perfil/{id}  (Geral · Segurança · Assinatura)
 ├── Versões do software            /versions/  (release notes em PDF no S3)
 ├── Central de ajuda (FAQ)         arkmeds.crisp.help/pt-br/
 └── Chat de suporte (Crisp)        widget global

```

### Convenções de rota observadas

| Padrão | Significado | Exemplo |
| --- | --- | --- |
| `/modulo/` | Listagem com filtros + DataTables | `/cadastros/equipamento/` |
| `/modulo/visual/{id}/` | Ficha 360° (somente leitura + ações) | `/ordem_servico/visual/152369/` |
| `/modulo/{id}` | Formulário de edição | `/cadastros/equipamento/6637` |
| `/modulo/novo/` | Formulário de criação | `/cadastros/estado_ordem_servico/novo` |
| `/modulo/delete/{id}` | Exclusão | `/ordem_servico/delete/152369` |
| `/modulo/ocultar/{id}/` | Soft-hide (usado em campos gerenciais) | `/cadastros/estado_ordem_servico/ocultar/112/` |
| `/pdf/{modulo}/{id}/` | Geração de PDF | `/pdf/ordem_servico/152369/` |
| `/export/csv/{modulo}/` | Job assíncrono de exportação | `/export/csv/equipamento/` |
| `/model_history/{modulo}/{id}` | Trilha de auditoria do registro | `/model_history/equipamento/6637` |

## 03. Inventário de telas

Todas as telas visitadas ou identificadas, com objetivo e recursos. Rotas relativas a `https://technecare.arkmeds.com`.

| Módulo | Tela | URL | Objetivo | Principais funcionalidades |
| --- | --- | --- | --- | --- |
| Painel | **Geral** | `/?tab=geral` | Visão executiva da operação | Cards de topo (Equipamentos, Empresas, Usuários, TMAC); KPIs Fluxo de Caixa / OS criadas / OS finalizadas com variação vs. mês anterior; atalhos configuráveis; pizza de OS por estado (clicável); Receita recorrente e avulsa (6 meses); Produtividade da equipe (30 dias, OS × Calibrações); Histórico de Atividades; "Editar Dashboard" com arrastar-e-soltar |
| Painel | **Planos** | `/?tab=planos` | Saúde da manutenção preventiva | Pizza "Ciclos Anteriores / Em dia não iniciadas / Atrasadas"; mini-calendário; tabela de 826 planos com barra de progresso, situação e frequência; filtro Todos/Ativos/Finalizados; botão Cronograma |
| Painel | **Agendamentos** | `/?tab=agendamentos` | Serviços do dia/semana | Tabela Plano · Equipamento · Serviço · Solicitante · Técnicos · Horário; filtros Hoje/Semana; ações em lote Abrir/Fechar/Cancelar |
| Cadastro | **Empresas e clientes** | `/cadastros/empresa/` | Árvore organizacional e parceiros | Lista com Tipo (Cliente Externo/Interno, Fornecedor, Local, Setor); filtros nome, fantasia, tipo, CNPJ, e-mail, contato, cidade, UF, id, busca global; reenvio de e-mail de validação; Análise de Dados |
| Cadastro | **Ficha da empresa** | `/cadastros/empresa/visual/{id}/` | Painel do cliente | Disponibilidade do mês, MTTR, MTBF (meses); Estado das OS (ativas/inativas); OS por setor ao longo do tempo; Estado dos equipamentos; ação "Criar chamado" |
| Cadastro | **Equipamentos** | `/cadastros/equipamento/` | Inventário do parque | 19 filtros, incluindo "Serviços a vencer" (Calibração / TSE / Preventiva) e "Possui QR Code"; Adicionar Múltiplos; Análise de Dados |
| Cadastro | **Ficha do equipamento** | `/cadastros/equipamento/visual/{id}/` | Prontuário do ativo | Disponibilidade %, MTTR, MTBF; dados básicos; Visitas programadas (plano × tipo de serviço); risco de operação e criticidade; histórico de OS; Calibrações; TSE; Laudos de obsolescência; Qualificações térmicas; tabela de depreciação; menu Ações (criar calibração, TSE, chamado, OS, laudo); Imprimir; Histórico; Documentos |
| Cadastro | **Contratos** | `/contrato/` | Contratos comerciais | Nome, apelido, contratante, data de início e final; vinculável ao equipamento |
| Cadastro | **Procedimentos** | `/cadastros/procedimento/` | Biblioteca técnica (801 itens) | Escopo (Equipamento / Tipo de Equipamento / Setor), tipo de serviço, frequência, checklists vinculados, tabelas de calibração, resumo/escopo/conteúdo, anexo PDF ou DOC (10 MB), templates de impressão, padrões associados |
| Cadastro | **Checklists** | `/cadastros/checklist_novo/` | Formulários de inspeção (212) | Construtor linha a linha: Tipo (Texto · Número · Opções · Teste Automático) + Descrição; persistido como JSON |
| Cadastro | **Campos gerenciais** | `/cadastros/…` | Taxonomias do tenant | CRUD simples; "Combinar tipos" (merge) em estados e tipos de OS; ocultar em vez de excluir; numeração com prefixo, sufixo e número inicial por tipo de documento |
| Serviços | **Chamados** | `/chamado/` | Fila de triagem do cliente | Cards Total / A atender (sem responsável) / Vencidas / Em andamento / A avaliar; badge de prioridade colorido; colunas Atendimento e Fechamento (SLA); telefone do solicitante; alerta sonoro; "Campos visíveis"; filtro por usuário conectado |
| Serviços | **OS — lista** | `/ordem_servico/` | Base operacional (73.826) | 25 filtros; seleção múltipla; edição e impressão por linha; Adicionar lote (múltiplas OS); Análise de dados; compartilhar URL do filtro |
| Serviços | **OS — Kanban** | `/ordem_servico/kanban/` | Fluxo visual por estado | Colunas por estado com contadores; cartão com equipamento, número, tipo de serviço, solicitante, agendamento, responsável e cor de prioridade; adicionar OS direto na coluna |
| Serviços | **OS — Agenda** | `/agenda/` | Programação de campo | Buckets "Serviços atrasados / não agendados (2.950) / dentro do prazo"; calendário semanal com arrastar-e-soltar; visão por Quadro de trabalho (recursos); imprimir; filtros |
| Serviços | **OS — ficha** | `/ordem_servico/visual/{id}/` | Documento da ordem | Seções Dados Gerais · Observações de Usuário · Dados do Serviço · Dados do Solicitante · Instrumento/Equipamento · Horas Trabalhadas · Protocolos. Ações: Imprimir PDF, Fechar, Assinar e Fechar, Assinar como 2º solicitante, Executar Checklist, Criar orçamento, Criar laudo de obsolescência, Criar protocolos, Deletar |
| Serviços | **Rascunhos de OS** | `/ordem_servico/rascunho/` | OS pendentes de sincronização | ID, Solicitante, Equipamento, ID da OS original |
| Serviços | **Plano** | `/plano/visual/{id}/` | Programa de manutenção | Abas Dados Gerais · Equipamentos · Setores · Execução · Histórico; alternador Ciclo Atual / Ciclos Anteriores; progresso "X de Y OS completadas"; ação Finalizar |
| Serviços | **Transferências** | `/cadastros/transferencias/` | Movimentação e empréstimo de ativos | Tipo (Transferência / Empréstimo), origem, destino, lista de equipamentos, data de retorno, status, ação "Retornar" |
| Serviços | **Protocolos** | `/protocolo/…` | Custódia física do equipamento | Data, quem recolheu ou entregou, quem assinou, OS vinculada, protocolo de recolhimento correlato |
| Certificados | **Calibrações** | `/calibracao/balanca/` | Metrologia (≈7.650 registros) | Editar, excluir, PDF, gerar novo a partir do anterior, histórico, liberar/ocultar ao solicitante; validade destacada |
| Certificados | **Editor de calibração** | `/calibracao/equipamento/editar/{id}` | Emissão do certificado | Condições ambientais (T, UR, pressão + incertezas + padrões); tabelas de medição por ponto; resolução do padrão e do equipamento; faixa de uso; unidade; fator k (95 %); critério de aceitação; correção de erro sistemático; técnico executor, responsável técnico e responsável solicitante; Salvar rascunho / Analisar |
| Certificados | **Certificados de padrões** | `/calibracao/padrao/` | Rastreabilidade metrológica | Número, padrão, data da calibração, órgão externo (ex.: ENGECAL, SURGICAL), validade |
| Certificados | **Testes de segurança elétrica** | `/tse/equipamento/` | Ensaio elétrico | Número, equipamento, solicitante, técnico executor, data, validade; linhas vencidas destacadas |
| Certificados | **Laudos de obsolescência** | `/servicos/baixa_patrimonial/` | Baixa patrimonial | Numeração própria; motivo; responsável técnico; parecer técnico-legal; assinatura; PDF; vínculo com OS e equipamento |
| Certificados | **Qualificações térmicas** | `/validacao_termica/` | Validação de autoclaves e câmaras | Numeração, equipamento, geração assíncrona do laudo |
| Orçamentos | **Gerenciar orçamentos** | `/orcamento/` | Ciclo comercial do reparo | Abas Pendentes · Aprovados em curso · Reprovados em curso · Faturados · Recusado · Cancelados; totalizador em R$; ações Aprovar, Reprovar (com motivo), Recusar, Cancelar, Faturar (com débito de estoque), Modificar (volta a Pendentes e exige nova assinatura), Histórico |
| Orçamentos | **Cadastro de serviços** | `/orcamento/servico/` | Catálogo de serviços | Tipo de serviço, descrição, garantia (dias), valor (R$) |
| Orçamentos | **Motivos de reprovação** | `/orcamento/motivo_reprovacao/` | Taxonomia de perda | 4 motivos cadastrados |
| Estoque | **Gerenciar estoque** | `/estoque/peca/` | Peças e insumos | Tipo, fornecedor, fabricante, código do fabricante, modelo, quantidade, estoque mínimo, unidade; entrada com NF, lote, valor de aquisição e de venda; nomenclatura da peça por empresa; imagem; importação de peças |
| Estoque | **Configurações** | `/estoque/…` | Taxonomias de estoque | Tipos, categorias e unidades de peça |
| Relatórios | **12 relatórios + 4 exportações** | `/relatorio/… · /export/csv/…` | Prestação de contas | Formulário de filtros → "Gerar Relatório" (PDF) ou job assíncrono com fila de downloads |
| Indicadores | **Indicadores gerais** | `/kpi/geral/` | Painel analítico | Fluxo de caixa (fechamento de OS, 1 ano); Estado de equipamentos (Ativo 84,27 % · Manutenção 5,45 % · Desativado 10,27 %); Estado das OS (Ativas 2.950 · Inativas 70.876); Qualidade de chamado |
| Indicadores | **Avaliações dos chamados** | `/chamado/avaliacao/` | Satisfação do cliente | Média 4,4; distribuição 1–5; filtros por empresa, técnico e nota; histórico da média e da quantidade; comentário por OS com responsável técnico |
| Robôs | **Integração e notificação** | `/automacao/` | Automação | Automação = Modelo (OS · Estoque) + Tópico (Mudança de Estados · Estoque de Peças) + Ação (E-mail para destinatários verificados · Webhook) |
| Robôs | **Relatório automático** | `/kpi/relatorio/listar` | Relatórios periódicos (máx. 5) | Título, descrição, destinatários, periodicidade (a cada N dias/semanas/meses/anos), data de início, ativo; seções com Módulo + Visualização + Agrupamento + Limites + filtros; preview; histórico de gerados |
| Usuários | **Meus usuários** | `/usuarios/` | Equipe interna | Contador de licenças "36 de 38"; cargo; status de confirmação de e-mail |
| Usuários | **Grupos de permissões** | `/usuarios/grupos/` | RBAC | 9 grupos; tipo de usuário (Usuário · Solicitante); seleção múltipla sobre 138 permissões atômicas |
| Usuários | **Solicitantes** | `/usuarios/solicitante/` | Portal do cliente (1.971) | Vínculo a N empresas e setores; status ativo/inativo; gerar senha; bloqueio |
| Sistema | **Histórico** | `/model_history/` | Trilha de auditoria | Data, módulo (34 modelos), registro, número, usuário, ação (Criação · Edição · Exclusão), modificação campo a campo (valor anterior → novo) |
| Sistema | **Preferências** | `/preferences/` | Configuração do tenant | 6 abas: Geral · Formulários · Documentos · Notificações · Aplicativo · Calibração (≈40 chaves) |
| BI | **BI** | `datastudio.google.com/…` | Análise externa | Relatório Looker Studio fora da aplicação |

## 04. Entidades do sistema

Lista consolidada a partir de três fontes convergentes: rotas do menu, formulários de cadastro e — a mais confiável — o filtro *Módulo* da tela de Histórico, que expõe os 34 modelos auditados pelo próprio sistema.

### Modelos confirmados pela trilha de auditoria **Alta**

Empresas · Equipamentos · Tipo Equipamento · Procedimento · Novo Checklist · Plano · Contrato · Ordem de Serviço · Tipo Ordem Serviço · Estado Ordem Serviço · Tipo Origem Problema · Tipo Problema Relatado · Horas Trabalhadas · Chamado · Calibração · Certificado Padrão · Teste de Segurança Elétrica · Laudo de Obsolescência · Orçamento · Peça · Tipo Peça · Categoria de Peça · Itens Peça · Utilização de Peças · Nota Fiscal · Protocolo de Recolhimento · Protocolo de Entrega · Protocolo de Serviço · Oficina · Numeração · Automação · Usuário · Preferência

### Entidades observadas na interface mas ausentes do filtro de histórico

Solicitante · Grupo de permissões · Criticidade · Transferência · Qualificação térmica · Incerteza / Padrão de medição · Serviço (catálogo de orçamento) · Motivo de reprovação · Motivo de baixa patrimonial · Unidade de medida · Relatório periódico · Avaliação de chamado · Agendamento · Anexo · Rascunho de OS · Rascunho de calibração · Job de exportação · Selo RBC · Atividade

### Papel de cada entidade nuclear

| Entidade | Papel | Observação de projeto |
| --- | --- | --- |
| **Empresa** | Nó único da hierarquia organizacional e também cadastro de fornecedores | Auto-relacionada por `superior`; `tipo` distingue Principal, Cliente Externo, Cliente Interno, Fornecedor, Local e Setor. É o eixo de toda a segregação de dados. |
| **Equipamento** | Ativo gerenciado; também representa *padrões* de calibração (`modo_uso` = Padrão) | Pertence a uma Empresa (normalmente do tipo Setor). Carrega SLA próprio, criticidade, contrato e dados de depreciação. |
| **Ordem de Serviço** | Registro de trabalho — corretiva, preventiva, calibração, TSE, instalação, treinamento e mais 30 tipos | Também é o Chamado. Pode nascer de um Plano, de um Chamado ou manualmente. |
| **Plano** | Programa recorrente que materializa OS por ciclo | Liga-se a equipamentos (com flags P/C/E) e a setores (flag P). |
| **Procedimento** | Instrução técnica reutilizável | Amarra Checklists a tipo de serviço, tipo de equipamento e frequência; guarda templates de impressão e padrões exigidos. |
| **Checklist** | Formulário de inspeção | Armazenado como JSON (`[{tipo, desc, appr[]}]`) — sem tabela de itens. |
| **Calibração** | Certificado metrológico | Consome Padrões (equipamentos) e Incertezas; gera PDF; tem validade e liberação ao cliente. |
| **Orçamento** | Proposta comercial derivada de uma OS | Contém itens de Peça e de Serviço; ao faturar, debita estoque. |
| **Peça** | Item de estoque | Entradas com NF e lote; nomenclatura e preço por empresa. |
| **Usuário × Solicitante** | Duas classes de conta distintas | Usuário = equipe interna (licenciado, com custo/hora e assinatura). Solicitante = contato do cliente, ilimitado, com acesso restrito às suas empresas. |

## 05. Campos identificados por entidade

Campos lidos diretamente dos formulários (nome técnico do input + rótulo). Onde há enumeração, os valores reais do tenant estão listados.

### Empresa **Alta**

| Campo | Rótulo | Tipo / valores |
| --- | --- | --- |
| `nome` | Nome * | texto |
| `apelido` | Nome fantasia | texto |
| `tipo` | Tipo * | Cliente Externo · Cliente Interno · Fornecedor · Local · Setor *(+ Principal, visível no filtro)* |
| `superior` | Superior | FK para Empresa — define a árvore |
| `cnpj` | CPF/CNPJ | texto |
| `cep, rua, numero, complemento, bairro, cidade, estado` | aba ENDEREÇO | UF em lista fechada de 27 |
| `contato, email, telefone1, telefone2, fax` | aba CONTATO | `fax` aparece com rótulo "Outros" |
| `observacoes, anexos` | aba OBSERVAÇÕES | texto longo + upload múltiplo |
| — | Status de e-mail | coluna de lista; ação "Reenviar" validação |
| — | Campos PMOC | surgem no cadastro quando a preferência *Habilitar PMOC* está ligada |

### Equipamento **Alta**

Cada campo abaixo marcado com ◐ possui um checkbox *"Mostrar na OS"* — o tenant escolhe quais atributos do ativo são impressos no cabeçalho da ordem de serviço. É um detalhe de produto muito bem resolvido.

| Grupo | Campos |
| --- | --- |
| **Identificação** | ◐ `tipo` (651 opções) · ◐ `fabricante` · ◐ `modelo` · ◐ `identificacao` (TAG) · ◐ `numero_serie` · ◐ `patrimonio` · ◐ `numero_inmetro` (Portaria INMETRO) · `registro_anvisa` · `descricao` |
| **Situação e uso** | ◐ `estado` (Ativo · Desativado · Em Manutenção) · ◐ `modo_uso` (Equipamento · Padrão) · `has_qr_code` (derivado) |
| **Organização** | ◐ `proprietario` (FK Empresa) · `oficina` (Quadro de Trabalho) |
| **Risco e SLA** | ◐ `prioridade` (Não urgente · Pouco urgente · Urgente · Muito urgente · Emergente) · `tipo_criticidade` (6 níveis) · `criticidade` (descrição) · `risco_operacao` · `tempo_atendimento` (min) · `tempo_fechamento` (min) |
| **Ciclo de vida e finanças** | ◐ `data_fabricacao` · ◐ `data_aquisicao` · ◐ `valor_compra` · ◐ `valor_residual` · ◐ `vida_util` (anos) · `garantia` |
| **Contrato** | `tipo_contrato` (Sem Contrato — Equipamento Próprio · Comodato · Empréstimo · Aluguel · Manutenção) · `contratante` · `contrato` (FK) |
| **Manutenção** | `procedimento` (M2M, 241 opções) · `plano` (M2M, 827 opções) |
| **Outros** | `observacoes` · `anexos` |

### Ordem de Serviço **Alta**

| Campo | Rótulo | Notas |
| --- | --- | --- |
| `numero` | Número * | Gerado pela regra de Numeração de Documentos (prefixo + sequência) |
| `data_criacao` | Data de Criação * | Editável mediante permissão específica |
| `tipo_ordem_servico` | Tipo de OS | `1 = Equipamento` · `2 = Serviço` |
| `estado` | Estado * | 42 opções no tenant |
| `origem` | Atendimento * | Interno · Externo |
| `responsavel` | Responsável Técnico | FK Usuário (37) |
| `tecnicos_executores` | Técnicos Executores | M2M Usuário (36) |
| `solicitante` | Solicitante * | FK Empresa (setor que pediu) |
| `localizacao` | Localização | FK Empresa tipo Local (filtrável por preferência) |
| `equipamento` | Equipamento * | FK Equipamento |
| `padroes` | Padrões | M2M Equipamento com `modo_uso = Padrão` (38) |
| `tipo_servico` | Tipo de Serviço * | 37 tipos cadastrados |
| `problema` | Problema Relatado | 360 opções |
| `origem_problema` | Origem do Problema | 344 opções |
| `oficina` | Quadro de Trabalho | ENG CLÍNICA · ENG CLÍNICA ROTA |
| `setor_executante` | Setor Executante | Empresa que executa (BE CARE, TÉCHNE CARE, TÉCHNE CARE AT) |
| `terceiros` | Serviços Terceirizados Por | FK Empresa (fornecedor) |
| `data_hora_inicio` / `data_hora_fim` | Agendamento | Alimenta a Agenda e o Kanban |
| `prioridade` | Prioridade * | 5 níveis, herdada do equipamento |
| `descricao_servico` | Descrição do Serviço | Laudo do técnico |
| `observacoes` / `observacoes_adm` | Observações · Observações de Usuário | Dois campos distintos (técnico × solicitante) |
| `campo_extra` | Campo Extra | Rótulo definido em Preferências — único campo personalizado do sistema |
| `imprimir_utilizacao_pecas` | Imprimir utilização de peças | Sim/Não |
| — | Abas **Serviços** e **Peças** | Itens com peça, quantidade, unidade de medida e observações; serviços do catálogo com observações |
| — | Anexos | Upload na OS; permissão específica para excluir |

### Plano **Alta**

| Campo | Rótulo | Valores |
| --- | --- | --- |
| `nome` | Título * | texto |
| `setor_responsavel` | Setor Responsável | FK Empresa (469 opções) |
| `responsavel` | Responsável | FK Usuário |
| `tecnicos_executores` | Técnicos Executores | M2M Usuário |
| `data_inicial` | Data Inicial * | início do 1º ciclo |
| `frequencia_execucao` | Frequência * | Diário · 2 em 2 dias · Semanal · Quinzenal · Mensal · Bimestral · Trimestral · Quadrimestral · Semestral · Anual · Bianual · Trienal · Quadrienal |
| `prazo_execucao` | Prazo para Execução (dias) | define a janela do ciclo |
| `abertura_automatica` | Abertura automática | Sim/Não — gera as OS do ciclo |
| `contagem_dias` | Contagem de dias | Arredondar / Não arredondar |
| `descricao`, `observacao` | Descrição · Observações | texto |
| — | Equipamentos | M2M com flags **P** (Preventiva), **C** (Calibração), **E** (Teste de Segurança Elétrica) |
| — | Setores | M2M com flag **P** |

### Certificado de calibração **Alta**

| Bloco | Campos |
| --- | --- |
| **Identificação** | Número * · Solicitante * · Equipamento * · Ordem de Serviço · Imprimir informações na OS |
| **Procedimento** | Procedimento * · Observações · Tabelas * |
| **Condições ambientais** | Local · Temperatura ambiente * · Incerteza (Temperatura) * · Padrão de Temperatura · Umidade relativa * · Incerteza (Umidade) * · Padrão de Umidade · Pressão atmosférica · Incerteza (Pressão) · Padrão de Pressão |
| **Tabela de medição** (por ponto) | Padrão utilizado · Incerteza (sensor + faixa + vencimento do padrão) · Tipo de medida · Resolução do padrão * · Resolução do equipamento * · Faixa de uso (de–até) · Capacidade (de–até) · Unidade * · Fator de Confiabilidade * (k para 95 %) · Incluir critério de aceitação · Valor máximo do critério · Corrigir erro sistemático · leituras repetidas por ponto |
| **Finalização** | Data de Criação * · Data de Emissão * · Validade · Técnico Executor * · Responsável Técnico * · Responsável Solicitante · Análise de resultados |
| **Ações** | Salvar · Salvar rascunho · Analisar · Liberar ao solicitante |

### Usuário interno **Alta**

`nome`, `email`, `empresas` (M2M), `oficinas` (quadros de trabalho), `password`, `data_nascimento`, `cargo`, **`custo_hora`**, `is_ferias` (Férias Sim/Não), **`jornada_diaria`** (h), `conselho_profissional`, `crea` (nº de registro), `portaria`, `telefone`, `groups` (grupos de permissão), **`assinatura`** (imagem), `avatar`, `workperiod`.

*Solicitante:* nome, cargo, empresas (N setores), e-mail, status ativo/inativo, senha gerada pelo sistema, flag bloqueado.

### Peça e movimentação **Alta**

**Peça:** `tipo`, `categoria`, `quadros_de_trabalho`, `unidade`, `fabricante`, `codigo_fabricante`, `modelo`, `estoque_minimo`, `observacoes`, `imagem`, `codigo_interno`, e uma tabela filha **Nomenclatura por Empresa** (nomenclatura, empresa, valor de venda). **Entrada de estoque:** quantidade, fornecedor, número da nota fiscal, lote da peça, valor de aquisição, valor de venda.

### Chamado (formulário do solicitante) **Alta**

Tipo de Chamado (Equipamento · Serviço) → Empresa/Setor → Localização → Equipamento * → Problema Relatado * → Observações → Anexo. Sete campos: deliberadamente enxuto. Criticidade e Prioridade só aparecem se a preferência correspondente estiver ativa.

## 06. Relacionamentos

### A árvore organizacional é uma tabela só

```

Empresa (tipo=Principal)      → TÉCHNE CARE
   │
   ├── Empresa (tipo=Cliente Externo/Interno)   → FHEMIG · HOSPITAL JOÃO XXIII · SCMG …
   │      │
   │      ├── Empresa (tipo=Setor)   → HJXXIII - AMBULATÓRIO - SALA 05 - PEDIATRIA
   │      │        └── Equipamento (proprietario = Setor)
   │      └── Empresa (tipo=Local)    → usada como "Localização" na OS
   │
   └── Empresa (tipo=Fornecedor)      → MHEDICA SERVICE · JVD …
                                          usada em: peça.fornecedor, OS.terceiros,
                                          equipamento.contratante

```

**Alta** — confirmado pelo campo `superior` no cadastro e pela ficha do laudo, que exibe *"Superior: FHEMIG - HOSPITAL JOÃO XXIII"* para um setor.

### Grafo funcional principal

```

                      ┌─────────────── CONTRATO ───────────────┐
                      │                                          │
   EMPRESA (cliente) ─┴─→ EMPRESA (setor) ──→ EQUIPAMENTO ←──┘
        │                       │                    │
        │                       │                    ├──→ PLANO (M2M, flags P/C/E)
        │                       │                    │        │
        │                       │                    │        └──→ ciclo → AGENDAMENTO
        │                       │                    │                        │
        ├──→ SOLICITANTE ──→ CHAMADO ═══════════════════════════════════╪══╗
        │         │                                  │                        ▼  ║
        │         │                                  └──→ ORDEM DE SERVIÇO ◄──╝
        │         │                                             │
        │         │  avaliação (1–5) ◄──────────────────────────┤
        │         │  assinatura      ◄──────────────────────────┤
        │                                                       │
        │                    ┌──────────────────────────────────┼───────────────────┐
        │                    │            │           │         │         │         │
        │                CHECKLIST   HORAS      PEÇAS   SERVIÇOS  PROTOCOLOS  ANEXOS
        │                 executado   trabalhadas   (estoque)  (catálogo)  R/E/S
        │                    ▲            │           │         │
        │             PROCEDIMENTO      │           │         │
        │                    ▲            │           └────┬────┘
        │              TIPO EQUIP.       │                ▼
        │                                 │           ORÇAMENTO ──→ faturar ──→ debita estoque
        │                                 ▼                │
        │                          PRODUTIVIDADE          └──→ aprovação do SOLICITANTE
        │                          custo_hora × horas
        │
        └──→ CERTIFICADOS: Calibração · TSE · Qualificação Térmica · Laudo de Obsolescência
                    ▲
                PADRÃO (equipamento modo_uso=Padrão) ──→ CERTIFICADO DE PADRÃO (órgão externo)

```

### Relações confirmadas, uma a uma

| Relação | Cardinalidade | Evidência | Confiança |
| --- | --- | --- | --- |
| Empresa → Empresa (superior) | 1:N recursivo | Campo `superior` no cadastro; ficha de laudo exibindo o superior | **Alta** |
| Equipamento → Empresa (proprietário) | N:1 | Campo obrigatório `proprietario`; ficha exibe "Proprietário: … - UTI II" | **Alta** |
| Equipamento ↔ Plano | N:N com atributos P/C/E | Aba Equipamentos do plano com três checkboxes por linha | **Alta** |
| Setor ↔ Plano | N:N com atributo P | Aba Setores do plano | **Alta** |
| Plano → OS | 1:N por ciclo | Aba Execução lista OS pré-criadas sem número; ficha da OS mostra "Plano: …" | **Alta** |
| Equipamento → OS | 1:N | Ficha do equipamento lista 14 OS | **Alta** |
| Chamado ≡ OS | 1:1 (mesma linha) | Link do chamado aponta para `/ordem_servico/visual/152234/` | **Alta** |
| OS → Orçamento | 1:N | Ação "Criar orçamento" na OS; coluna "Ordem Serviço" no orçamento | **Alta** |
| Orçamento → Peça / Serviço | 1:N cada | Abas Peças e Serviços; modal "Peças a Faturar" | **Alta** |
| Orçamento faturado → baixa de estoque | evento | Modal: "Somente serão debitadas do estoque caso selecione alguma peça" | **Alta** |
| OS → Calibração / TSE / Laudo / Qualificação | 1:N | Campo "Ordem de Serviço" no editor de calibração; coluna OS no laudo | **Alta** |
| Calibração → Padrões | N:N | Selects "Padrão de Temperatura/Umidade/Pressão" e padrão por tabela de medição | **Alta** |
| Padrão → Certificado de Padrão | 1:N | Tela de certificados de padrões com órgão externo e validade | **Alta** |
| Procedimento → Checklist | N:N | Multiselect "Checklists" no procedimento | **Alta** |
| Procedimento → Tipo de Equipamento / Equipamento / Setor | N:N (escopo) | Campo "Tipo Procedimento" com três escopos | **Alta** |
| OS → Checklist executado | 1:N | Ação "Executar Checklist"; modal com "Aprovar Tudo" | **Alta** |
| OS → Horas trabalhadas | 1:N | Seção na ficha; relatório de registro de horas; permissão "deletar Horas Trabalhadas" | **Alta** |
| OS → Protocolo (R/E/S) | 1:N | Três seções na ficha; protocolo de entrega referencia o de recolhimento | **Alta** |
| OS → Avaliação | 1:0..1 | Tela de avaliações mostra nota + comentário por número de OS | **Alta** |
| Equipamento → Contrato | N:1 | Campos `tipo_contrato`, `contratante`, `contrato` | **Alta** |
| Transferência → Equipamentos | 1:N | Coluna "Equipamentos" com vários ativos por transferência | **Alta** |
| Usuário → Empresas / Oficinas | N:N | Campos `empresas` e `oficinas` no cadastro de usuário | **Alta** |
| Peça → Nomenclatura por Empresa | 1:N | Tabela filha no cadastro da peça, com valor de venda por cliente | **Alta** |
| Agendamento como entidade própria | — | Provável projeção de `data_hora_inicio/fim` + técnicos da OS, não tabela separada | **Média** |
| Multitenancy por schema/DB separado | — | Subdomínio por cliente (`technecare.`, `ebserh.`, `cieng.`, `x.`) e prefixo de storage `technecare1/` sugerem isolamento por tenant | **Média** |

## 07. Ordens de serviço

73.826 registros. É o módulo com mais superfície: três visualizações, 25 filtros, 42 estados, 37 tipos de serviço, 10 ações de documento e integração com praticamente todos os outros módulos.

### Os 42 estados cadastrados **Alta**

Apenas os IDs 1, 2 e 3 são de sistema (**Aberta**, **Fechada**, **Cancelada**). Todos os demais foram criados pelo tenant. A distribuição real, lida no gráfico do painel:

| Estado | Qtd. | Estado | Qtd. | Estado | Qtd. |
| --- | --- | --- | --- | --- | --- |
| Aguardando peças | 789 | Aguardando envio do orçamento | 106 | Aguardando liberação da unidade | 11 |
| Análise concluída — Gerar orçamento | 328 | MANUTENÇÃO EXTERNA | 45 | Aguardando Liberação do setor | 8 |
| fechada | 312 | Aguardando chegada das peças | 44 | Aguardando empresa externa | 8 |
| Aberta | 306 | Em execução | 42 | Encaminhado para Orç. Externo | 7 |
| Equipamento Sem Reparo | 232 | Empréstimo | 37 | Em espera | 7 |
| Reparo externo | 182 | EM DESLOCAMENTO | 15 | Atendimento programado | 6 |
| Aguardando aprovação do orçamento | 175 | Equipamento parado p/ manutenção | 12 | Aguardando orç. pelo fornecedor | 5 |
| Orçamento Reprovado | 128 | Aguardando Calibração | 4 | Em Análise Assistência NL | 5 |
| Em análise | 111 | NECESSIDADE DE PREVENTIVA | 4 | Demais estados (≤ 3 cada) | — |

> **ACHADO CENTRAL**
>
> O cadastro de estado tem **um único campo: Descrição**. Não há categoria, cor, ordem, flag terminal, SLA nem transições permitidas. A separação "Ativas × Inativas" que o painel exibe é hardcoded: Ativas = Aberta + Em execução + Aguardando Peças + Aguardando aprovação do orçamento + *Outros*; Inativas = Fechada + Cancelada. Consequências observadas: o tenant criou "fechada" (minúscula) além da "Fechada" de sistema, com 312 OS presas fora da contagem correta; estados de negócio ("Empréstimo", "Equipamento Vendido") convivem com estados de fila ("Aguardando peças"); e não há como impedir uma transição inválida.

### Ciclo de vida reconstruído a partir dos dados existentes

```

          [origem]
   Chamado do solicitante ──┐
   Plano (ciclo)  ──────────┼──→ ABERTA
   Criação manual ──────────┘        │
                                     ├──→ Atendimento programado ──→ EM DESLOCAMENTO
                                     ▼
                                EM ANÁLISE
                                     │
              ┌──────────────────────┼──────────────────────────┐
              ▼                      ▼                          ▼
      EM EXECUÇÃO         Análise concluída —        Equipamento Sem Reparo
              │              Gerar orçamento                    │
              │                      │                          ▼
              │                      ▼                  Laudo de Obsolescência
              │        Aguardando envio do orçamento            │
              │                      │                          ▼
              │                      ▼                     FECHADA
              │        Aguardando aprovação do orçamento
              │              │                │
              │      Orçamento aprovado   Orçamento Reprovado
              │              │                │
              ▼              ▼                ▼
      Aguardando peças / chegada das peças / Reparo externo /
      MANUTENÇÃO EXTERNA / CALIBRAÇÃO EXTERNA / Aguardando empresa externa
                             │
                             ▼
                   Em manutenção / aguardando conclusão
                             │
                             ▼
                     Serviço finalizado
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              Assinar e Fechar   Aguardando NF para envio
                    │                 │
                    ▼                 ▼
                FECHADA  ──→ avaliação (1–5) ──→ faturamento

   Em qualquer ponto: CANCELADA

```

**Média** — o encadeamento é inferido pela semântica dos nomes, pelos volumes e pelas ações disponíveis. O sistema *não* declara transições; qualquer estado pode ir a qualquer outro.

### Tipos de serviço (37) e o que revelam

**Manutenção:** preventiva · corretiva · preditiva. **Metrologia e conformidade:** Calibração · Teste de segurança elétrica · Teste Funcional · Teste inicial · Qualificação · Certificação · Análise Técnica. **Ciclo de vida do ativo:** Instalação · Desinstalação · Atualização · Atualização de Software · Baixa Patrimonial · Devolução · Entrega de acessórios · Demonstração. **Comercial e contratual:** Locação · Empréstimo (grafado de duas formas) · Venda de produto/serviço · Garantia Magnamed · Garantia Magnamed/MS · MC Em Processo de Compra · Acompanhamento de Serviço Terceirizado. **Rotina de campo:** Visita técnica · Ronda · Treinamento · Coleta de Água Hemodiálise · Reposição de Oxigênio na unidade (duplicado). **Projetos:** Mamute — Instalação · Projeto CEMIG — Instalação. **Ruído:** "Rodas travadas", "Teclado com defeito" — sintomas cadastrados como tipo de serviço.

> **LIÇÃO DE MODELAGEM**
>
> "Tipo de serviço" está sobrecarregado: é ao mesmo tempo *natureza do trabalho* (preventiva/corretiva), *disciplina técnica* (calibração/TSE), *evento comercial* (locação/venda) e, por erro de uso, *sintoma*. No nosso produto isso deve ser decomposto em **work_order_type** (natureza, fechado e de sistema) × **service_catalog** (o que foi feito, aberto) × **failure_code** (o que houve, taxonomia própria).

### Elementos anexos à OS

| Elemento | Existe? | Como funciona |
| --- | --- | --- |
| Checklist | Sim | Puxado do Procedimento aplicável ao tipo de equipamento + tipo de serviço; execução com "Aprovar Tudo"; impressão configurável (vazio, template secundário, sem coluna de avaliação) |
| Registro de horas | Sim | Entidade "Horas Trabalhadas"; automático ou manual; permite lançamento futuro se a preferência estiver ativa; registro simultâneo opcional; base do custo (custo_hora × horas) e da produtividade |
| Peças | Sim | Aba na OS com peça, quantidade, unidade e observação; reserva e utilização; impressão opcional |
| Serviços | Sim | Itens do catálogo de serviços com valor e garantia |
| Custos e valores | Parcial | Não há campo de custo na OS; o valor vem do orçamento e das peças. Permissão dedicada "Pode visualizar valores nas ordens de serviço" |
| Deslocamento | Não | Só existe como *estado* ("EM DESLOCAMENTO"). Sem quilometragem, sem geolocalização, sem custo de viagem |
| Anexos e fotos | Sim | Upload na OS; impressão opcional dos anexos no PDF; permissão separada para excluir anexos |
| Assinatura | Sim | Duas assinaturas (solicitante e "segundo solicitante"); validação por código enviado por e-mail; estados em que o solicitante pode assinar são configuráveis; coleta pelo app móvel |
| Aprovações | Via orçamento | Não há workflow de aprovação da OS em si; o único gate formal é o orçamento |
| SLA | Parcial | Tempo de atendimento e de fechamento vivem no *equipamento*, não na OS; a tela de Chamados mostra "Vencidas"; existe a métrica "% de chamados cumpridos dentro do prazo" |
| Comentários / thread | Não | Apenas dois campos de texto livre (Observações e Observações de Usuário). Não há histórico conversacional |
| Histórico | Sim | Via trilha de auditoria global, com diff campo a campo |
| Faturamento | Sim | Pelo orçamento (aba Faturados) e pelo relatório de serviços terceirizados por empresa |

### Operações em lote

"Adicionar lote" abre o modal *Múltiplas ordens de serviço*, que gera várias OS de uma vez. A aba Execução do plano permite **Abrir**, **Finalizar** e **Cancelar** várias OS selecionadas. A Agenda permite arrastar serviços não agendados para o calendário.

## 08. Equipamentos

27.223 ativos, 84,27 % ativos, 5,45 % em manutenção, 10,27 % desativados. A ficha do equipamento é a melhor tela do produto: reúne indicadores, programação futura e todo o histórico documental em uma página.

### Ciclo de vida observado

```

Cadastro (manual · em lote · pelo app · importação)
   │  identificação, TAG, série, patrimônio, ANVISA, INMETRO, QR Code
   ▼
Alocação → proprietário = Empresa (setor) · quadro de trabalho · contrato (comodato/aluguel/…)
   │
   ▼
Classificação de risco → criticidade (6 níveis) · risco de operação · prioridade (5 níveis)
   │                          · tempo de atendimento (min) · tempo de fechamento (min)   ← SLA do ativo
   ▼
Programação → vinculação a Planos (P/C/E) e Procedimentos
   │
   ▼
Operação ─┬─→ Chamado → OS corretiva
             ├─→ OS preventiva (plano)
             ├─→ Calibração → Certificado (validade)
             ├─→ Teste de Segurança Elétrica → Certificado (validade)
             ├─→ Qualificação Térmica → Laudo
             └─→ Transferência / Empréstimo entre setores
   │
   ▼
Fim de vida → Laudo de Obsolescência → estado Desativado → baixa patrimonial
   │
   ▼
Financeiro → Tabela de Depreciação (vida útil, valor de compra, valor residual, data de aquisição)

```

### Checklist de capacidades

| Capacidade | Status | Detalhe |
| --- | --- | --- |
| QR Code | **Sim** | Filtro "Possui QR Code"; artigo de ajuda "Como gerar e vincular QR Codes"; leitura pelo app abre a ficha ou o chamado |
| Código de barras | **Não observado** | Nenhum campo ou ação dedicada |
| Patrimônio · nº de série · TAG | **Sim** | Três identificadores independentes; bloqueio de duplicidade configurável por campo |
| Fabricante e modelo | **Texto livre** | São campos `text`, não FKs — não há catálogo de fabricantes nem de modelos |
| Documentos e fotos | **Sim** | Menu "Documentos" na ficha; campo `anexos` múltiplo |
| Histórico | **Sim** | OS, calibrações, TSE, laudos, qualificações + trilha de auditoria |
| Garantia | **Sim** | Campo `garantia`; estado "VERIFICANDO ACIONAMENTO DE GARANTIA" |
| Calibração / preventiva programada | **Sim** | Via Planos, com "Visitas Programadas" na ficha |
| Criticidade | **Sim** | 6 tipos + descrição textual + risco de operação numérico |
| Disponibilidade / tempo de parada | **Sim** | Ficha mostra "Disponibilidade 50", MTTR 122 dias, MTBF 121 dias — calculados sobre o período de OS abertas |
| Depreciação | **Sim** | Tabela calculada; alerta explícito quando faltam os 4 campos necessários |
| Árvore de ativos / componentes | **Não** | Equipamento não tem pai/filho. Um ventilador e seu circuito são registros irmãos |
| Medidores / horímetro | **Não** | Sem leitura de contadores; manutenção só por calendário, nunca por uso |
| Geolocalização | **Não** | Localização é uma FK para Empresa tipo Local, não coordenada |

## 09. Planos e manutenção preventiva

"Plano" no Arkmeds significa **programa recorrente de manutenção** — não é contrato nem pacote comercial (contrato é entidade separada). É o mecanismo que transforma política de manutenção em ordens de serviço.

### Anatomia de um plano

#### Definição

Título · setor responsável · responsável · técnicos executores · descrição · observações.

#### Ritmo

Data inicial + frequência (13 opções, de diário a quadrienal) + prazo de execução em dias + regra de arredondamento de contagem.

#### Escopo

Aba **Equipamentos** com três flags por linha — P (preventiva), C (calibração), E (teste elétrico) — e aba **Setores** com a flag P.

#### Materialização

`abertura_automatica` = Sim gera as OS do ciclo. A aba **Execução** lista as OS previstas, separadas em M. Preventivas / Calibrações / T. Segurança Elétrica, com ações em lote Abrir · Finalizar · Cancelar.

### Ciclos

Cada plano roda em ciclos fechados. Exemplo real lido: *CEPAI — PLANO DE PREV/CAL — BALANÇA*, primeira execução em 20/07/2023, frequência Anual, ciclo atual 20/07/2026 → 19/07/2027, prazo 364 dias (325 restantes), progresso "0 de 8 OS completadas", situação Em andamento. A ficha alterna entre **Ciclo Atual** e **Ciclos Anteriores**, e o plano pode ser **Finalizado** (encerrado, sai da conformidade ativa).

### Fluxo funcional

```

definir Plano (título, frequência, prazo, responsáveis)
      │
      ├─→ adicionar Equipamentos  ──→ marcar P / C / E por equipamento
      ├─→ adicionar Setores       ──→ marcar P
      │
      ▼
início do ciclo (data_inicial, depois +frequência)
      │
      ├─ abertura_automatica = Sim ──→ gera as OS do ciclo (uma por equipamento × flag)
      └─ abertura_automatica = Não ──→ OS ficam "previstas" e são abertas manualmente
      │
      ▼
OS entram na Agenda como "Serviços não agendados" (2.950 hoje)
      │
      ├─→ técnico agenda (arrastar no calendário) ──→ Agendamento
      ├─→ executa (app, offline) ──→ Checklist do Procedimento
      └─→ fecha ──→ progresso do ciclo avança
      │
      ▼
Conformidade: Relatório de Conformidade de Planos + pizza do painel
      (Ciclos Anteriores · Em dia não iniciadas · Atrasadas · Em dia iniciadas)
      │
      ▼
fim do ciclo → novo ciclo automático  ·  ou  Finalizar plano

```

### Regras e alertas ligados a planos

- Preferência: *"Desabilitar a geração de OS's para equipamentos incluídos em planos após o início do ciclo atual"* — equipamento adicionado no meio do ciclo só entra no próximo.
- Preferência: *"Liberar acompanhamento de planos para solicitante"* — expõe ao cliente se as OS estão em dia/atrasadas e iniciadas/não iniciadas, além dos ciclos anteriores.
- Notificação: *"Habilitar o envio de e-mail para início de ciclo dos planos"*.
- Relatórios dedicados: **Conformidade de planos** (filtros por tipo de serviço, empresa, quadro, tipo de equipamento, estado, planos) e **Cronograma de planos** (com período amostral e dados dos equipamentos).

> **LIMITAÇÕES DO MODELO DE PLANO**
>
> Não há **rota** (o quadro de trabalho é um agrupamento estático, não um roteiro otimizado); não há **janela de manutenção** por setor; não há gatilho por **uso** (horas de operação, ciclos de esterilização); a frequência é fixa por plano — não é possível ter preventiva semestral e calibração anual no mesmo plano para o mesmo equipamento sem criar dois planos; e o progresso é contagem simples de OS fechadas, sem ponderação por criticidade.

## 10. Agendamentos

Existem **duas superfícies** de agendamento, com propósitos diferentes — e essa duplicidade é em si um achado de UX.

#### Aba "Agendamentos" do painel

Lista tabular dos serviços de hoje ou da semana: Plano · Equipamento · Serviço · Solicitante · Técnicos · Horário. Ações em lote Abrir / Fechar / Cancelar. É a visão do coordenador ao abrir o sistema.

#### Agenda de OS (`/agenda/`)

Ferramenta de programação: painel lateral com três baldes (Atrasados · Não agendados · Dentro do prazo) e calendário semanal com arrastar-e-soltar. Alterna entre visão de lista, visão de recursos (por Quadro de trabalho, expansível) e calendário.

| Aspecto | Situação |
| --- | --- |
| Fonte do evento | Campos `data_hora_inicio` / `data_hora_fim` da própria OS **Média** |
| Recursos | Agrupamento por **Quadro de trabalho** (ENG CLÍNICA, ENG CLÍNICA ROTA), com linhas expansíveis — provavelmente técnicos |
| Arrastar e soltar | Sim, do balde de não agendados para o calendário |
| Cores e estados | Baldes semaforizados (vermelho/azul/verde); cartões do Kanban usam ponto colorido de prioridade |
| Recorrência | Não no agendamento — a recorrência vive no Plano |
| Conflitos / capacidade | Não observado. Sem checagem de sobreposição, sem carga por técnico, sem jornada aplicada ao calendário (apesar de `jornada_diaria` existir no usuário) |
| Vínculo com cliente e equipamento | Herdado da OS |
| Impressão | Botão de impressão da agenda |
| Volume atual | **2.950 serviços não agendados** — exatamente o total de OS ativas. Na prática, a equipe não usa o agendamento |

## 11. Certificados e laudos

É aqui que o Arkmeds se diferencia de um CMMS genérico. São seis famílias documentais, cada uma com numeração, validade, responsável técnico e PDF próprios.

| Documento | Numeração | Validade | Assinatura | Particularidades |
| --- | --- | --- | --- | --- |
| **Certificado de calibração** | Série própria (ex.: 5301021), configurável | Sim (1 ano típico) | Técnico executor + Responsável técnico + Responsável solicitante | Condições ambientais com incerteza; tabelas de medição por ponto; fator k para 95 %; critério de aceitação; correção de erro sistemático; VVC opcional no PDF; liberação ao cliente manual ou automática |
| **Rascunho de calibração** | — | — | — | Fila de certificados em elaboração ("Salvar rascunho") |
| **Certificado de padrão** | Série própria (ex.: 2024007661) | Sim | Órgão externo (ENGECAL, SURGICAL…) | Fecha a cadeia de rastreabilidade: um padrão vencido invalida as calibrações que dependem dele. O sistema mostra o vencimento do padrão dentro do editor de calibração |
| **Teste de segurança elétrica** | Série própria | Sim | Técnico executor | Alimentado automaticamente pelo analisador Arkmeds Tesla via checklist do tipo "Teste Automático" |
| **Laudo de obsolescência** | Formato ano+sequência (2026011000180) | — | Ação "Assinar" | Motivo, parecer técnico com fundamentação legal (ex.: Resolução SEPLAG 37/2010), declaração de ausência de conflito de interesses, referência a ART/CREA. Gerável a partir da OS ou do equipamento |
| **Qualificação térmica** | Sequencial simples | — | — | Compilação assíncrona do PDF (autoclaves, câmaras de conservação, freezers) |

### Rastreabilidade metrológica

```

Órgão acreditado (RBC / laboratório externo)
        │  emite
        ▼
Certificado de Padrão  (nº, data, validade)
        │  qualifica
        ▼
Padrão = Equipamento com modo_uso = "Padrão"   (38 no tenant: Tesla, Otto, Fluke, Contec…)
        │  é usado em
        ▼
Certificado de Calibração do equipamento do cliente
        │  referencia
        ▼
Procedimento (tabelas de calibração, escopo, conteúdo) + Incerteza por sensor/faixa

```

### Preferências que governam os documentos

- Imprimir todos os valores verdadeiros convencionais (VVC) no PDF · imprimir valor nominal · imprimir validade do padrão.
- Liberação automática do certificado ao solicitante · esconder assinatura do contratante.
- Imprimir rodapé da empresa no laudo de qualificação térmica.
- E-mail mensal com vencimento de calibrações · e-mail de vencimento de certificados de padrões · e-mail na liberação de certificado.

## 12. Orçamentos

Módulo comercial completo, com estados próprios, aprovação pelo cliente e integração com estoque no faturamento. Pouco usado neste tenant (1 registro), mas totalmente instrumentado.

### Processo

```

OS em "Análise concluída — Gerar orçamento"
   │
   ▼ Ação "Criar orçamento" — quatro modalidades:
   │   · Ordem de serviço específica   · Peças
   │   · Peças e Serviços              · Serviços
   ▼
PENDENTE  (nº · OS · tipo · solicitante · data · validade · valor)
   │   itens: peças (com NF/lote) + serviços (com garantia e valor)
   │
   ├──→ estado da OS: "Aguardando envio do orçamento" → "Aguardando aprovação do orçamento"
   │
   ├─ solicitante APROVA  ──→ APROVADO EM CURSO ──→ execução ──→ FATURADO
   │                                                              │
   │                                                              └→ modal "Peças a Faturar"
   │                                                                 debita o estoque
   ├─ solicitante REPROVA ──→ motivo obrigatório  ──→ REPROVADO EM CURSO
   │        (Valor muito alto · Tempo de entrega muito longo ·
   │         Serviço não autorizado · Falta de recursos financeiros)
   │
   ├─ RECUSADO   (não editável)
   ├─ CANCELADO  (não editável)
   └─ MODIFICAR  ──→ volta para Pendentes e exige nova assinatura

```

### Campos e recursos

- **Cabeçalho:** Número · Ordem de Serviço · Tipo · Solicitante · Data de Criação · Validade · Valor. Totalizador em R$ por aba.
- **Itens de peça:** peça · quantidade · nota fiscal/lote. **Itens de serviço:** serviço do catálogo (tipo, descrição, garantia em dias, valor) · observações.
- **Governança:** histórico do orçamento; permissão dedicada "Pode movimentar Orçamento" (é justamente a permissão que o grupo Solicitante possui); tour guiado na tela.
- **Ausências:** não há desconto, imposto, condição de pagamento, markup, margem, nem versionamento explícito de proposta (a "Modificação" sobrescreve).

## 13. Estoque

Estoque de peças orientado a manutenção: simples no cadastro, mas com dois recursos incomuns — nomenclatura e preço por cliente, e rastreio por nota fiscal e lote.

| Aspecto | Situação | Detalhe |
| --- | --- | --- |
| Produtos / peças | **Sim** | Tipo (FK), categoria (FK), unidade (FK), fabricante, código do fabricante, modelo, código interno, imagem, observações |
| Categorias e tipos | **Sim** | Telas próprias em Estoque › Configurações |
| Unidades de medida | **Sim** | Entidade separada, com permissões próprias de criar/editar/excluir |
| Fornecedores | **Sim** | Reaproveita Empresa tipo Fornecedor |
| Saldo e estoque mínimo | **Sim** | Colunas Quantidade e Estoque Mínimo; robô de alerta por peça (17 alertas cadastrados neste tenant) |
| Entradas | **Sim** | Quantidade, fornecedor, nº da nota fiscal, lote, valor de aquisição, valor de venda |
| Saídas | **Sim** | Por utilização em OS e por faturamento de orçamento (modal de débito) |
| Reservas | **Sim** | Preferência "Imprimir peças reservadas e serviços em OS" indica o conceito de reserva |
| Locais de estoque | **Parcial** | Não há almoxarifado como entidade; a segregação é por **Quadro de Trabalho** na peça |
| Inventário / contagem | **Não observado** | Sem tela de inventário cíclico ou ajuste com justificativa |
| Custo médio / curva ABC | **Não** | Só valor de aquisição e de venda por entrada |
| Preço por cliente | **Sim** | Tabela "Nomenclatura Peça por Empresa": nomenclatura + empresa + valor de venda — permite o mesmo item ter nome e preço diferentes por hospital |
| Importação | **Sim** | Botão "Importar peças" |
| Relatórios | **Sim** | Inclusão de peças (por tipo, categoria, lote, quadro, data) e Utilização de peças |

## 14. Relatórios

Doze relatórios em PDF com formulário de filtros, mais quatro exportações assíncronas em planilha. Nenhum foi executado nesta auditoria — os filtros foram lidos, mas o botão "Gerar" nunca foi acionado.

| Relatório | Rota | Filtros observados | Finalidade |
| --- | --- | --- | --- |
| **Conclusão de OS** | `/relatorio/ordem_servico_concluidas/` | Tipo de relatório · Gráficos · Empresa * · Quadro de trabalho · Tipo de serviço · Período | Prestação de contas do que foi entregue no período |
| **Estado de OS** | `/relatorio/ordem_servico_estado/` | Empresa * · Quadro de trabalho · Período * | Fotografia do backlog por estado |
| **Controle patrimonial** | `/relatorio/controle_patrimonial/` + `/patrimonial/list/` | — | Inventário patrimonial; geração assíncrona com fila (ID, número, usuário, data, disponibilidade) |
| **Registros de horas** | `/relatorio/registro_horas/` | Tipo de relatório · Empresas · Técnicos · Período | Apuração de horas por técnico e por cliente |
| **Serviços terceirizados por empresa** | `/relatorio/servicos_prestados/` | Empresa · Quadro · Serviço terceirizado por · Período * · Imprimir valor * · Imprimir campo extra * | Fechamento de terceiros; base de faturamento |
| **Vencimento de calibrações** | `/relatorio/vencimento/` | Período * · Quadro de trabalho | Antecipação de vencimentos metrológicos |
| **Produtividade da equipe** | `/relatorio/produtividade_equipe/` | Técnico * · Quadro · Data * | Volume de OS e calibrações por técnico |
| **Inclusão de peças** | `/relatorio/inclusao_pecas/` | Tipo de peça · Categoria · Lote · Quadros · Data * | Entradas de estoque no período |
| **Utilização de peças** | `/relatorio/utilizacao_pecas/` + `/list/` | — | Consumo por OS; geração assíncrona |
| **Conformidade de planos** | `/relatorio/planos/` | Tipo de serviço · Empresa · Quadro · Tipo de equipamento · Estado · Planos | Aderência ao programa preventivo — o relatório mais importante para contrato |
| **Cronograma de planos** | `/relatorio/cronograma_planos/` | Tipo de equipamento * · Setor · Tipo de serviço · Empresa · Quadro · Setores · Estado · Planos · Dados dos equipamentos * · Período amostral | Cronograma anual entregue ao cliente |
| **Análise de dados** (4 domínios) | `/export/csv/{equipamento, calibracao, orcamento, ordem_servico}/` | — | Exportação para planilha; cada geração vira um job com fila e link de download |

> **PADRÃO ARQUITETURAL RELEVANTE**
>
> Relatórios e exportações pesados rodam como **jobs assíncronos com fila e histórico** (`/cadastros/analise/list/`, `/relatorio/patrimonial/list/`, compilação de laudos térmicos). É a decisão certa para volumes desta ordem e deve ser replicada no nosso produto desde o MVP.

## 15. Indicadores de desempenho

Os indicadores estão em três lugares: cards do painel, tela *Indicadores gerais*, e — o mais rico — o construtor de *Relatório automático*, que expõe o catálogo completo de métricas do produto.

### Catálogo de métricas nativas **Alta**

Lidas do seletor "Módulo" do construtor de relatórios periódicos. Estas são *todas* as métricas que o motor sabe calcular:

| Métrica | Leitura de negócio | Equivale a |
| --- | --- | --- |
| Ordens de Serviço | Contagem de OS | Volume / demanda |
| Tempo médio de serviços (dias) | Da abertura ao fechamento | **MTTR** |
| Tempo médio entre serviços (dias) | Intervalo entre OS do mesmo ativo | **MTBF** |
| Tempo por estado da ordem de serviço (horas) | Quanto tempo a OS ficou em cada estado | Análise de gargalo / lead time por etapa |
| Média de minutos gastos por ordem de serviço | Horas apontadas ÷ nº de OS | Esforço médio |
| Horas gastas | Soma de horas trabalhadas | Capacidade consumida |
| Serviços iniciados por concluídos (%) | Taxa de conclusão | Backlog / throughput |
| Porcentagem de chamados cumpridos dentro do prazo | Aderência ao tempo de atendimento/fechamento | **SLA** |
| Número de equipamentos por número de OSs | Densidade do parque | Carga por ativo |
| Porcentagem de OS por número de equipamentos | Idem, normalizado | Taxa de falha do parque |
| Gastos com manutenções (R$) | Custo total do período | Custo de manutenção |
| Custo de substituição do parque tecnológico (R$) | Valor de reposição do inventário | Base do indicador seguinte |
| Gastos com manutenções ÷ custo de substituição | Razão custo-manutenção / valor do parque | **CMMS ratio** — benchmark clássico de engenharia clínica (referência de mercado ≈ 5 %) |

Cada métrica pode ser cruzada por **Agrupamento** (Equipamento · Tipo de equipamento · Empresa · Mês · Semana · Dia · Dia da semana · Problema relatado · Origem de problema · Tipos de serviço · Colaboradores), renderizada como **Barra · Linha · Tabela · Pizza**, limitada aos **5/10/50/100 maiores ou menores**, ancorada em **Data de abertura** ou **Data de fechamento**, e filtrada por empresa, tipo de equipamento, tipo de OS, responsável técnico, problema relatado, origem de problema, estados, oficinas e estado do equipamento.

### Indicadores exibidos nas telas

| Onde | Indicador | Definição observada |
| --- | --- | --- |
| Painel — topo | Equipamentos · Empresas · Usuários | Contagens do tenant |
| Painel — topo | **TMAC** | Exibido como duração ("1 dia(s), 0:51:31"). Pela sigla e pelo formato: *Tempo Médio de Atendimento de Chamado*. **Média** — a plataforma não exibe a fórmula em nenhum tooltip |
| Painel | Fluxo de caixa | "Baseado no fechamento das ordens de serviço do último ano", com variação vs. mês anterior |
| Painel | OS criadas / OS finalizadas | Mês corrente com variação percentual vs. mês anterior |
| Painel | Receita: recorrente e avulsa | Últimos 6 meses — separa contrato de serviço eventual |
| Painel | Produtividade da equipe | Pessoas mais ativas nos últimos 30 dias, com OS e Calibrações em séries distintas |
| Indicadores gerais | Estado de equipamentos | Ativo 84,27 % (22.942) · Manutenção 5,45 % (1.484) · Desativado 10,27 % (2.797) |
| Indicadores gerais | Estado das OS | Ativas 2.950 (Aberta 306 · Em execução 42 · Aguardando Peças 789 · Outros 1.501) · Inativas 70.876 (Cancelada 497 · Fechada 70.379) |
| Indicadores gerais | Qualidade de chamado | Excelente · Bom · Neutro · Ruim · Péssimo, sobre todos os chamados fechados |
| Ficha da empresa | Disponibilidade do mês · MTTR · MTBF (meses) | Por cliente |
| Ficha do equipamento | Disponibilidade · MTTR · MTBF | Por ativo |
| Avaliações | Nota média 4,4 e distribuição | 7.527 · 3.817 · 1.363 · 172 · 148 (de 5 a 1) |

> **NÃO INVENTAMOS FÓRMULAS**
>
> A plataforma **não documenta na interface** como calcula Disponibilidade, MTTR, MTBF ou TMAC — não há tooltip, ajuda contextual nem legenda. Os botões de ajuda existem no DOM (`#fluxo-admin-help`, `#oscriada-admin-help` etc.) mas não exibem conteúdo. As equivalências acima são leituras dos rótulos e das unidades, não fórmulas confirmadas. Métricas de **backlog**, **reincidência** e **taxa preventiva × corretiva** não existem como indicador nativo — só podem ser obtidas indiretamente por agrupamento em "Tipos de serviço".

## 16. Robôs e automações

"Robôs" é o nome comercial de um motor de regras muito simples. A promessa do menu é maior que a capacidade real.

### Anatomia de uma automação

```

Automação = Descrição + Model + Tópico + Ação

  Model   ∈ { Ordem de Serviço , Estoque }          ← apenas 2
  Tópico  ∈ { Mudança de Estados , Estoque de Peças } ← apenas 2
  Ação    ∈ { E-mail (lista de destinatários verificados) , Webhook }

  Parâmetros do tópico "Mudança de Estados":
      estado inicial  →  estado final     (ambos sobre os 42 estados)
  Parâmetros do tópico "Estoque de Peças":
      peça(s) monitorada(s) → dispara ao atingir o estoque mínimo

```

**No tenant há 20 automações:** 3 do tipo "OS das preventivas executadas" (mudança de estado → e-mail) e 17 alertas de estoque mínimo por família de peça (filtros de osmose, cabos ECG, sensores de SpO2, mangueiras, baterias…). Todas com ação de e-mail; nenhuma usando webhook.

### O que existe e o que não existe

| Recurso | Status | Nota |
| --- | --- | --- |
| Regra por mudança de estado da OS | **Sim** | Único gatilho de workflow |
| Alerta de estoque mínimo | **Sim** | Por peça |
| Webhook | **Sim** | "Toda vez que ocorrer o evento escolhido, essas informações serão enviadas para o endereço selecionado"; assistente "Crie seu Trigger" com filtro por empresa |
| Geração automática de OS | **Sim, mas fora dos Robôs** | Vive no Plano (`abertura_automatica`), não no motor de automação |
| Notificações por e-mail programadas | **Sim, mas em Preferências** | 7 gatilhos fixos: vencimento de calibrações (mensal), vencimento de contratos (mensal), chamado fechado, liberação de certificado, chamado aberto, vencimento de certificados de padrões, início de ciclo de planos |
| Relatório periódico por e-mail | **Sim** | Módulo separado, limite de 5 relatórios |
| Regras por data / vencimento | **Não** | Não é possível criar "se calibração vence em 30 dias, então X" |
| Escalonamento por SLA | **Não** | Sem regra de tempo em estado |
| WhatsApp / SMS / push | **Não** | Somente e-mail e webhook |
| Condições compostas | **Não** | Um gatilho, um filtro, uma ação |
| Ações internas (atribuir, mudar estado, criar OS) | **Não** | A automação só notifica; não altera dados |

**Governança de e-mail:** destinatários precisam ter e-mail verificado; endereços não validados entram em lista de bloqueio, com fluxo de reenvio da validação. Detalhe maduro, raramente visto em CMMS.

## 17. Usuários e permissões

Duas classes de conta, nove grupos e **138 permissões atômicas** — o RBAC mais granular que se encontra em um CMMS desta faixa. E também um dos pontos mais frágeis na configuração real deste tenant.

### Classes de conta

#### Usuário **36 de 38 licenças**

Equipe interna. Tem custo/hora, jornada diária, conselho profissional e nº de registro (CREA), portaria, assinatura digital, foto, vínculo a empresas e a quadros de trabalho, flag de férias. Consome licença.

#### Solicitante **1.971 · praticamente ilimitado**

Contato do cliente. Vinculado a N empresas/setores, com status ativo/inativo, geração de senha pelo sistema e flag de bloqueio. Não consome licença — é o modelo de portal do cliente.

### Grupos cadastrados

| ID | Grupo | Classe | Nº de permissões |
| --- | --- | --- | --- |
| 1 | Manutenção | Usuário | — |
| 2 | Calibração | Usuário | — |
| 3 | Administração | Usuário | — |
| 5 | Administrador Médio | Usuário | — |
| 6 | Cadastro Equipamentos / Clientes | Usuário | — |
| 7 | Preferências do Solicitante | **Solicitante** | **21** |
| 8 | Técnico | Usuário | **101** |
| 9 | Supervisor | Usuário | — |
| 10 | "." *(grupo sem nome)* | Usuário | — |

### Famílias de permissão

| Família | Padrão | Exemplos |
| --- | --- | --- |
| **CRUD por entidade** | `Pode {adicionar|editar|deletar|listar} X` | ordem de serviço, equipamento, empresa, peça, plano, procedimento, checklist, contrato, calibração, TSE, certificado padrão, qualificação térmica, baixa patrimonial, orçamento, transferência, solicitante, usuário, grupo, integração, incerteza, unidade de medida, registro de horas, rascunho, relatório periódico, selo RBC, serviço, motivo de reprovação, quadro de trabalho, tipos gerenciais… |
| **Ocultar UI** | `Esconder …` | botão Diagnóstico de Orçamento na OS; campos Atendimento, Campo Extra, Imprimir Utilização de Peças, Tipo de OS; tópicos Detalhamento do Serviço, Gerenciais, Padrões Utilizados, Registro de Horas |
| **Relatórios** | `Gerar relatório de …` | 10 permissões, uma por relatório |
| **Ações sensíveis da OS** | — | editar data de criação · editar data de conclusão · editar OS fechada · editar OS cancelada · editar responsável técnico · editar campos gerenciais · editar observação · fechar OS · deletar anexos · deletar horas trabalhadas |
| **Visibilidade financeira e analítica** | — | visualizar valores nas OS · visualizar KPI financeiros · visualizar KPI geral · visualizar BI · visualizar histórico · visualizar localização · visualizar como administrador |
| **Metrologia** | — | liberar calibração · adicionar incerteza · adicionar selo RBC · atribuir responsável técnico a colaboradores |

### O conjunto do Solicitante — o portal do cliente, na prática

As 21 permissões do grupo 7 definem exatamente o que um cliente vê: *listar* chamados, OS, orçamentos, planos, contratos, empresa, equipamento, calibrações, certificados de padrão, TSE e laudos de obsolescência; *visualizar* equipamento, anexo na OS, BI e relatório periódico; *gerar* os relatórios de conclusão de OS, controle patrimonial, ordem de serviço e planos; *adicionar chamado*; e *movimentar orçamento* (aprovar/reprovar). É um portal de leitura + duas ações.

> **ACHADO DE GOVERNANÇA**
>
> O grupo **Técnico** acumula **101 das 138 permissões**, incluindo *adicionar empresa*, *adicionar grupo*, *adicionar plano*, *adicionar solicitante* e criação de tipos gerenciais. Isso é sintoma de um problema de produto, não só de configuração: como não existem *papéis pré-definidos* (o sistema entrega grupos vazios para o cliente montar), o caminho de menor esforço é marcar quase tudo. Um produto novo deve entregar **papéis padrão prontos e testados** (Admin, Gestor, Supervisor, Técnico, Metrologista, Financeiro, Cliente) e tratar a permissão granular como exceção, não como ponto de partida.

## 18. BI

O item "BI" do menu principal é um link externo para um relatório do **Google Looker Studio** (`datastudio.google.com/reporting/711da4db-8138-4998-b4b7-2f784e58e5e8`). Não é uma tela do produto.

| Pergunta | Resposta | Confiança |
| --- | --- | --- |
| É funcionalidade nativa? | Não. É um relatório hospedado no Looker Studio, aberto em nova aba | **Alta** |
| Está sob o RBAC do produto? | Existe a permissão "Pode visualizar BI", que apenas controla a exibição do item de menu. O acesso ao relatório em si é governado pelo Google | **Média** |
| Como os dados chegam lá? | Não observável de dentro do produto. Provável conector sobre uma cópia/extração da base do tenant | **Baixa** |
| É por tenant? | O ID do relatório está fixo no HTML deste tenant, sugerindo um relatório por cliente | **Média** |
| Substitui os indicadores nativos? | Não. Convive com Indicadores gerais e com o construtor de relatórios periódicos | **Alta** |

> **IMPLICAÇÃO PARA O NOSSO PRODUTO**
>
> Terceirizar o BI resolve o "temos BI" no material comercial, mas cria três dívidas: o dado sai do perímetro de permissões do produto, o cliente vê uma interface completamente diferente, e qualquer mudança de indicador vira trabalho manual de consultoria. Como a plataforma já possui um *motor de métricas com 13 indicadores, agrupamentos e visualizações* (seção 15), a decisão certa é investir nele e entregar **dashboards nativos configuráveis**, deixando a exportação/conector como recurso avançado.

## 19. Auditoria e histórico

O sistema registra alterações com **diff campo a campo** em 34 modelos. É um dos pontos mais fortes da plataforma e um requisito não negociável em ambiente hospitalar regulado.

### O que é registrado

| Dimensão | Registrado? | Como aparece |
| --- | --- | --- |
| Data e hora | **Sim** | 28/08/2026 17:24:22 |
| Usuário | **Sim** | Nome completo |
| Módulo (entidade) | **Sim** | 34 opções no filtro |
| Registro afetado | **Sim** | Descrição legível + número/ID |
| Ação | **Sim** | Criação · Edição · Exclusão |
| Campo alterado | **Sim** | "numero editado", "Certificado Padrão", "Registro de Anexo - Criação" |
| Valor anterior → novo | **Sim** | `(Em branco) → 54296784578` · `2024007596 → 2023004867` |
| Endereço IP | **Não** | Nenhuma coluna ou filtro de IP/sessão |
| Trilha por registro | **Sim** | `/model_history/{modelo}/{id}` — acessível pela ficha do equipamento e da calibração |
| Feed em tempo real | **Sim** | Widget "Histórico de Atividades" no painel, com ícone por tipo de ação e link para o registro |
| Retenção / imutabilidade | **Não observável** | Não há indicação de política de retenção nem de proteção contra edição do log |

**Modelos auditados:** Empresas · Equipamentos · Tipo Equipamento · Procedimento · Novo Checklist · Plano · Contrato · Ordem de Serviço · Tipo OS · Estado OS · Tipo Origem Problema · Tipo Problema Relatado · Horas Trabalhadas · Chamado · Calibração · Certificado Padrão · Teste de Segurança Elétrica · Laudo de Obsolescência · Orçamento · Peça · Tipo Peça · Categoria de Peça · Itens Peça · Utilização de Peças · Nota Fiscal · Protocolo de Recolhimento · Protocolo de Serviço · Protocolo de Entrega · Oficina · Numeração · Automação · Usuário · Preferência.

## 20. Auditoria de UX / UI

A plataforma tem **três gerações visuais convivendo**: telas Django clássicas (Bootstrap + DataTables + select2), telas intermediárias com cards temáticos, e telas SPA modernas (Chamados, Agenda, Kanban). A costura entre elas é visível a cada clique.

### Pontos fortes

#### Fichas 360° realmente úteis

Equipamento, empresa e plano concentram indicadores, programação futura e histórico documental em uma página. O usuário raramente precisa de uma segunda aba.

#### Três visualizações da mesma base de OS

Lista densa, Kanban por estado e Agenda com arrastar-e-soltar — cada uma para um papel diferente (analista, coordenador, programador).

#### Filtros profundos e compartilháveis

25 filtros na OS, 19 no equipamento, com "Copiar URL" e "Compartilhar". Filtro por "Serviços a vencer" é especialmente inteligente.

#### "Mostrar na OS" por campo do equipamento

Deixar o cliente escolher quais atributos do ativo aparecem no cabeçalho da OS é uma solução elegante para um problema real de documentação.

#### Contexto financeiro no lugar certo

Tabela de depreciação na ficha do equipamento, com mensagem explícita dizendo *quais* quatro campos faltam para o cálculo. Erro que ensina.

#### Feed de atividades no painel

Cada linha é clicável e leva ao registro. Transforma auditoria em navegação.

#### Ocultar em vez de excluir

Taxonomias usam `ocultar/{id}`, preservando integridade referencial do histórico. Decisão correta.

#### Ajuda embarcada

FAQ fixo na barra lateral, chat de suporte em todas as telas, tours guiados ("Iniciar Tour" em Orçamentos), link de versão para as release notes.

### Pontos fracos e problemas de UX

| Problema | Onde | Impacto |
| --- | --- | --- |
| **Três linguagens visuais na mesma sessão** | Chamados (SPA) → Ordens de serviço (Django) → Painel (híbrido) | Quebra o modelo mental; padrões de filtro, paginação e botões mudam de tela para tela |
| **Densidade descontrolada** | Lista de OS com 13 colunas em 25 linhas; truncamento agressivo ("HOSPITAL NOSSA SENHORA…", "ELETROCARDIÓGRAFO FK0…") | O usuário não consegue ler o dado sem hover ou clique |
| **Filtros escondidos em painéis modais** | Empresas, Equipamentos, TSE, Laudos | Não há indicação persistente de *quais* filtros estão ativos |
| **Selects gigantes sem hierarquia** | Tipo de equipamento (651 opções), Problema relatado (360), Origem do problema (344), Destinatários (milhares em lista plana) | Combos com milhares de itens; o navegador chega a travar (a renderização de algumas telas excedeu 30 s durante a auditoria) |
| **Formulários muito longos sem salvamento parcial** | Equipamento (39 campos + 4 abas), Calibração (rolagem de várias telas) | Risco de perda de trabalho; só a calibração tem "Salvar rascunho" |
| **Estados sem cor nem categoria** | Lista e Kanban de OS | 42 estados em texto puro; impossível ler a fila de relance |
| **Feedback de erro genérico** | Modal de checklist exibindo apenas "Erro!" | Não diz o que houve nem o que fazer |
| **Placeholder em produção** | Modal de checklist com "Lorem ipsum dolor sit amet" e "Descrição N/A" | Erosão de confiança |
| **Nomenclatura interna vazando** | Rota de calibração é `/calibracao/balanca/`; "Oficina" no código × "Quadro de trabalho" na tela; "Baixa patrimonial" × "Laudo de obsolescência"; "Model" e "Tópico" no cadastro de automação | O usuário aprende dois vocabulários |
| **Duplicatas e ruído nas taxonomias** | "Reposição de Oxigênio na unidade" duas vezes; "fechada" além de "Fechada"; "Emprestimo" e "Empréstimo de equipamento"; tipos de serviço que são sintomas | Relatórios e indicadores ficam fragmentados |
| **Grupo de permissões chamado "."** | Usuários › Grupos | Nada impede nome vazio ou sem sentido; sem descrição de grupo |
| **Limites arbitrários expostos** | "Número máximo de relatórios (5) atingido"; "36 de 38" usuários | Limite comunicado como bloqueio, sem caminho de resolução |
| **BI fora do produto** | Menu BI | Muda de domínio, de identidade visual e de modelo de permissão |
| **Sem tema escuro, sem responsividade real** | Toda a aplicação | Uso em campo depende inteiramente do app MARK II |
| **Acessibilidade** | Toda a aplicação | Ações de linha são ícones sem rótulo textual nem `title`; contraste do texto secundário sobre o teal do cabeçalho é baixo; ordem de foco não evidente |
| **Ausência de busca global** | Cabeçalho | Existe "Buscar cadastros" apenas dentro de listas específicas; não há um campo único para achar "patrimônio 7737" |

### Elementos que parecem datados

- Paginação numerada com "…2954" (2.954 páginas) em vez de rolagem virtual ou busca.
- Cabeçalho de página com ilustração de circuito e tipografia display de 2018.
- Botões "Aplicar Filtros / Limpar / Cancelar" repetidos em modais Bootstrap.
- Ícones FontAwesome 4 e cores de badge não semânticas.
- Erro de digitação persistente no botão "Pŕoximo" (presente em várias telas).
- Rodapé "© 2020 Arkmeds" na página pública de versões.

### O que devemos manter no nosso produto

Ficha 360° do ativo · Três visões da OS (lista/kanban/agenda) · Flags P/C/E por equipamento no plano · Ciclos de plano com conformidade · "Mostrar na OS" por campo · Ocultar em vez de excluir · Combinar/mesclar taxonomias · Numeração de documentos configurável · Auditoria com diff campo a campo · Verificação de e-mail antes de notificar · Jobs assíncronos com fila para exportações · Avaliação de chamado 1–5 com comentário · Preço e nomenclatura de peça por cliente · Rastreabilidade padrão → certificado

### O que deve ser melhorado

Estados com categoria, cor e transições · Taxonomias com governança e merge assistido · Busca global · Selects com busca assíncrona e agrupamento · Filtros persistentes e visíveis (chips) · Formulários em etapas com autosave · Mensagens de erro acionáveis · Uma única linguagem visual · Tema claro/escuro · Web responsiva de verdade · BI nativo · Papéis padrão prontos

## 21. Pesquisa externa

Funcionalidades documentadas publicamente que **não são evidentes** na navegação da instância TechneCare — em geral porque vivem no app móvel, no hardware ou em módulos não contratados por este tenant.

| Funcionalidade | O que a fonte diz | Status na instância |
| --- | --- | --- |
| **App MARK II** | App de gestão de ativos (iOS e Android) que combina calibração, inventário e análise, com operação offline e sincronização ao reconectar. Executa OS, executa checklist, cria equipamento e empresa, cria OS, registra horas, coleta assinatura do cliente, navega pela árvore de ativos e lê QR Code | Confirmado indiretamente: aba *Aplicativo* em Preferências ("Troca de estado ao sincronizar", "Estados de OS não selecionáveis pelo aplicativo", "Tipo de registro de hora"), módulo de Rascunhos de OS e link para a Play Store dentro da OS |
| **Analisadores proprietários** | Linha de analisadores e simuladores de alta precisão: **Tesla** (segurança elétrica), **Otto** (qualificação térmica), **Waller** e outros, com "conexão perfeita" e teste automatizado | Confirmado nos dados: padrões cadastrados como "ANALISADOR DE SEGURANÇA ELÉTRICA ARKMEDS TESLA" e "Qualificador térmico ARKMEDS OTTO"; tipo de item de checklist **"Teste Automático"** é o ponto de integração |
| **Integração com ERPs** | API e webhooks para SAP, TOTVS, MV e Tasy, além de plataformas de IoT e CLPs | Só o webhook é visível na interface. Não há tela de API keys, catálogo de endpoints nem log de integração. A categoria "Integração" da central de ajuda está **vazia** |
| **IA e gêmeos digitais** | "Gêmeos digitais identificam padrões de falha e geram ordens de serviço preventivas automaticamente"; artigo de ajuda "Geração de OS corretiva com IA" | Não observado na instância. Nenhum menu, indicador ou registro relacionado |
| **Conformidade normativa** | Aderência a ANVISA, RDC 509, NBR 15943, ABNT NBR ISO/IEC 17025, ONA e Joint Commission | Coerente com o que se vê: campo Registro ANVISA, incerteza expandida e fator de abrangência na calibração, laudos com ART/CREA |
| **LGPD** | Categoria dedicada na central de ajuda | Não há tela de LGPD no produto (consentimento, anonimização, exportação de dados do titular) |
| **Multi-instância** | Subdomínios por cliente: `technecare.`, `ebserh.`, `cieng.`, `x.`, `usa.`, `lr.`, `tesla.` | Reforça a hipótese de isolamento por tenant |
| **Ritmo de produto** | Release notes públicas desde 01/04/2019; da 1.32.0 à 2.69.0 — releases praticamente semanais em 2026 | Confirmado em `/versions/`, com PDF por versão hospedado em S3 |
| **Ecossistema de conteúdo** | Blog "Arkmeds Academy", "Escola de Engenharia Clínica", canal no YouTube, presença em feiras (Hospitalar) | Estratégia de marketing educacional — relevante para o nosso posicionamento |

#### Fontes consultadas

- [Arkmeds — Engenharia Clínica](https://arkmeds.com/engenharia-clinica/)
- [Arkmeds — Plataforma de Gestão da Manutenção](https://arkmeds.com/en/maintenance-management-platform/)
- [Central de ajuda Arkmeds](https://arkmeds.crisp.help/pt-br/) — 13 categorias: Cadastro e Consulta, Aplicativo, Serviços, Calibração, Usuários, Planos, Analisadores e simuladores, Relatórios, Orçamentos, Integração, LGPD, Estoque, Robôs
- [Checklist × Procedimento × Ordem de Serviço](https://arkmeds.crisp.help/pt-br/article/checklist-x-procedimento-x-ordem-de-servico-ek5o1j/)
- [Manual para solicitantes](https://arkmeds.crisp.help/pt-br/article/manual-para-solicitantes-bje963/)
- [Central de ajuda — categoria Aplicativo (MARK II)](https://arkmeds.crisp.help/pt-br/category/aplicativo-1xwdonm/)
- [Central de ajuda — categoria Robôs](https://arkmeds.crisp.help/pt-br/category/robos-18fl13l/)
- [Mark II na App Store](https://apps.apple.com/br/app/mark-ii/id6482589834)
- [Arkmeds Academy — Engenharia clínica](https://blog.arkmeds.com/engenharia-clinica/)
- [BHTEC — Arkmeds aposta em tecnologia e capacitação](https://bhtec.org.br/2025/10/16/arkmeds-aposta-em-tecnologia-e-capacitacao-para-transformar-a-engenharia-clinica/)

## 22. Benchmark

Dois eixos de comparação: CMMS verticais de engenharia clínica no Brasil (concorrência direta) e CMMS/FSM globais modernos (referência de experiência).

### Concorrência direta — Brasil

| Player | Posicionamento | O que o diferencia | O que aprender |
| --- | --- | --- | --- |
| **Arkmeds** | CMMS vertical de engenharia clínica desde 2015, cloud, com hardware próprio | Metrologia profunda + analisadores proprietários + app offline + academia de conteúdo | O hardware é o fosso competitivo, não o software |
| **Neovero** | CMMS/EAM para engenharia clínica, eletromedicina e manutenção hospitalar; 18 anos, 600+ unidades | Escala de base instalada e cobertura de infraestrutura predial além do clínico | Cobrir predial + clínico no mesmo produto amplia o ticket |
| **Engeman** | CMMS/EAM horizontal com 25+ anos, vertical hospitalar como oferta | Robustez industrial, planos de manutenção maduros, base multi-setor | Maturidade de EAM (estoque, compras, contratos) supera a de nichos verticais |
| **Philips Tasy** | ERP hospitalar completo (assistencial + financeiro) | Está dentro do hospital; é o "sistema de registro" da instituição | Nosso produto precisa *integrar* com o ERP hospitalar, não competir com ele |
| **GT Effort** | CMMS de engenharia clínica | Player regional | Mercado fragmentado — há espaço para experiência superior |

### Referência global de experiência

| Produto | O que faz melhor que o Arkmeds | Aplicável ao nosso produto? |
| --- | --- | --- |
| **Limble** | Interface moderna e de baixo atrito; anexar checklist, peças, fotos e manuais direto na OS; onboarding sem consultoria | Sim — é o padrão de UX a perseguir |
| **MaintainX** | Colaboração em tempo real na OS (thread com fotos), procedimentos digitais, status de ativo customizáveis para análise de causa raiz | Sim — a thread na OS é a maior lacuna do Arkmeds |
| **UpKeep** | Arquitetura mobile-first de verdade; gestão de peças, itens faturáveis e alertas de estoque baixo | Sim — mobile-first e faturamento por item |
| **Fiix** (Rockwell) | Analítica com IA e manutenção preditiva sobre dados de sensores/CLP | Fase avançada — depende de IoT no parque |
| **eMaint / Brightly / Nuvolo** | EAM hospitalar com integração a ITSM e a ServiceNow; gestão de capital e planejamento de substituição | Parcialmente — planejamento de substituição do parque é subexplorado no Brasil |

### Lacunas de mercado que viram oportunidade

1. **Thread colaborativa na OS.** Nenhum dos verticais brasileiros trata a OS como conversa. Hoje o técnico usa WhatsApp e o registro se perde.
2. **Máquina de estados configurável de verdade.** O mercado inteiro entrega "cadastro de status"; ninguém entrega transições, SLA por estado e ações automáticas.
3. **Portal do cliente como produto.** O portal do Arkmeds é um subconjunto de permissões, não uma experiência desenhada. Um portal bonito é argumento de venda para o hospital.
4. **Planejamento de substituição do parque.** Os dados já existem (vida útil, valor de compra, custo acumulado de manutenção, criticidade) mas ninguém entrega a recomendação "estes 40 ativos devem ser substituídos no próximo orçamento".
5. **IA aplicada ao texto livre.** Há 73 mil descrições de serviço e 360 problemas relatados — matéria-prima ideal para sugestão de diagnóstico, deduplicação de taxonomia e resumo automático de OS.
6. **Gestão de contrato e SLA como módulo.** Contrato existe como cadastro documental, não como instrumento com escopo, indicadores, multa e medição mensal.

## 23. Modelo de dados conceitual

Proposta para o **nosso** produto, informada pelo que o Arkmeds acertou e corrigindo o que ele carrega como dívida — sobretudo a Empresa polimórfica e a ausência de máquina de estados.

### Hierarquia conceitual

```

Organização (tenant)
 ├── Clientes                    (hospital, rede, cliente interno)
 │    └── Unidades               (prédio, campus, base do SAMU)
 │         └── Setores           (UTI II, Centro Cirúrgico, CME)
 │              └── Ativos
 │                   ├── Ordens de serviço
 │                   ├── Planos de manutenção
 │                   ├── Certificados e laudos
 │                   ├── Documentos e mídias
 │                   └── Leituras de medidor
 ├── Fornecedores                (entidade separada de Cliente)
 ├── Contratos                   (escopo, SLA, vigência, medição)
 ├── Equipes e Membros          (custo/hora, jornada, habilidades)
 ├── Solicitantes                (usuários do portal, escopados por setor)
 ├── Almoxarifados → Itens → Movimentos
 └── Catálogos                   (procedimentos, checklists, serviços, taxonomias)

```

> **DECISÃO DE MODELAGEM Nº 1**
>
> **Separar a árvore de localização do cadastro de parceiros.** O Arkmeds usa `empresa.tipo` para representar cliente, unidade, setor *e* fornecedor na mesma tabela. Isso torna impossível dar campos próprios a cada conceito (um setor não tem CNPJ; um fornecedor não tem setor pai) e força consultas recursivas em toda parte. Proposta: `customers` + `locations` (árvore com `parent_id` e `kind` ∈ site/building/floor/department) + `suppliers` separado.

> **DECISÃO DE MODELAGEM Nº 2**
>
> **Estado é uma máquina, não um texto.** `work_order_statuses` ganha `category` (open · in_progress · blocked · waiting_customer · done · cancelled), `color`, `is_terminal`, `counts_as_downtime`, `sla_paused` e `position`; `work_order_status_transitions` declara o que pode ir para onde e sob qual permissão. Isso resolve, de uma vez, o Kanban, os indicadores, o SLA e a governança das 42 descrições soltas.

### Entidades prováveis do banco

| Tabela | Objetivo | Principais campos | Relacionamentos |
| --- | --- | --- | --- |
| `organizations` | Tenant | name, slug, timezone, locale, plan, settings(jsonb) | raiz de tudo |
| `customers` | Cliente atendido | name, trade_name, tax_id, kind(external/internal), contact, address | → locations, contracts, requesters |
| `locations` | Árvore física | parent_id, kind(site/building/floor/department), name, code, geo | self-FK; ← assets |
| `suppliers` | Fornecedor / terceiro | name, tax_id, contact, categories[] | ← parts, work_orders.outsourced_to |
| `assets` | Ativo gerenciado | tag, serial_number, asset_number, model_id, manufacturer_id, category_id, status, criticality_id, priority, anvisa_reg, inmetro_reg, purchase_date, purchase_value, residual_value, useful_life_years, warranty_until, response_sla_min, resolution_sla_min, qr_token, parent_asset_id | → location, customer, contract; ← work_orders, certificates, meters |
| `asset_categories` · `manufacturers` · `asset_models` | Catálogo normalizado *(o Arkmeds usa texto livre)* | name, code, manufacturer_id, spec(jsonb) | ← assets |
| `criticality_levels` | Matriz de risco | name, score, color, sla_multiplier | ← assets |
| `meters` · `meter_readings` | Manutenção por uso *(inexistente no Arkmeds)* | asset_id, unit, value, read_at, source | → maintenance_plans |
| `work_orders` | Ordem de serviço / chamado | number, type, status_id, priority, asset_id, requester_id, assignee_id, team_id, opened_at, scheduled_start, scheduled_end, started_at, closed_at, due_at, reported_problem_id, failure_cause_id, description, resolution, source(portal/plan/manual/app/api), plan_cycle_id, extra(jsonb) | hub central |
| `work_order_statuses` · `_transitions` | Máquina de estados | ver decisão nº 2 | ← work_orders |
| `work_order_assignees` | Técnicos executores | work_order_id, user_id, role | N:N |
| `work_order_comments` | Thread colaborativa *(lacuna do Arkmeds)* | author_id, body, visibility(internal/customer), attachments[] | → work_orders |
| `time_entries` | Horas trabalhadas | work_order_id, user_id, started_at, ended_at, minutes, kind(labor/travel), cost_snapshot | base de custo e produtividade |
| `work_order_parts` · `work_order_services` | Consumo | item_id, qty, unit, unit_price, lot_id | → inventory, quotes |
| `attachments` | Mídia polimórfica | owner_type, owner_id, kind(photo_before/photo_after/doc/signature), storage_key, mime, size | qualquer entidade |
| `signatures` | Assinatura eletrônica | work_order_id, signer_name, signer_doc, role, image_key, code_verified_at, ip, hash | → work_orders |
| `maintenance_plans` | Programa recorrente | name, frequency, interval, lead_days, window_days, auto_open, rounding, owner_id, team_id, first_run_at, active | → plan_targets, plan_cycles |
| `plan_targets` | Escopo do plano | plan_id, target_type(asset/location/category), target_id, services[] *(preventiva, calibração, TSE…)* | substitui as flags P/C/E |
| `plan_cycles` | Ciclo executado | plan_id, seq, starts_at, ends_at, status, expected_count, done_count | ← work_orders |
| `procedures` | Instrução técnica | title, service_type_id, scope_type, frequency, summary, scope, content, template_key | → checklists, required_standards |
| `checklists` · `checklist_items` | Formulário *(tabela, não JSON)* | label, kind(text/number/option/auto_test/photo/signature), options[], min, max, unit, required, position | → procedures |
| `checklist_responses` · `_answers` | Execução | work_order_id, checklist_id, item_id, value, verdict, photo_key, measured_by | → work_orders |
| `calibration_certificates` | Certificado metrológico | number, asset_id, work_order_id, procedure_id, issued_at, valid_until, ambient(jsonb), k_factor, acceptance_criteria, systematic_correction, verdict, released_at | → calibration_points, standards |
| `calibration_points` | Tabela de medição | certificate_id, nominal, readings[], std_resolution, dut_resolution, unit, uncertainty, error, verdict | → certificate |
| `standards` · `standard_certificates` | Rastreabilidade | asset_id, uncertainty_profile, external_lab, issued_at, valid_until | → calibration_certificates |
| `electrical_safety_tests` · `thermal_qualifications` · `obsolescence_reports` | Demais laudos | number, asset_id, work_order_id, technician_id, issued_at, valid_until, verdict, payload(jsonb) | → assets |
| `document_number_series` | Numeração | doc_type, prefix, suffix, next_value, active | usado por todos os documentos |
| `quotes` · `quote_items` | Orçamento | number, work_order_id, customer_id, status, valid_until, subtotal, discount, tax, total, approved_by, rejection_reason_id | → work_orders, inventory |
| `service_catalog` | Serviços vendáveis | service_type_id, description, warranty_days, price | ← quote_items |
| `inventory_items` · `warehouses` · `stock_lots` · `stock_movements` | Estoque | sku, name, category, unit, min_qty, avg_cost; lot(invoice_no, lot_code, qty, unit_cost); movement(kind, qty, ref_type, ref_id) | ← work_order_parts, quotes |
| `customer_item_prices` | Preço e nome por cliente | item_id, customer_id, alias, sale_price | herdado do Arkmeds |
| `contracts` · `contract_slas` | Contrato como instrumento | customer_id, kind, starts_at, ends_at, scope, billing_model; sla(priority, response_min, resolution_min, coverage_hours, penalty) | → assets, work_orders |
| `asset_transfers` | Transferência / empréstimo | kind, from_location, to_location, assets[], status, due_back_at, approved_by | → assets |
| `custody_protocols` | Recolhimento / entrega / serviço | work_order_id, kind, handled_by, signed_by, signed_at | → work_orders |
| `users` · `teams` · `team_members` | Equipe | name, email, hourly_cost, daily_hours, council, registration_no, signature_key, on_vacation | → work_orders |
| `requesters` | Portal do cliente | name, email, role, blocked, customer_id | → requester_scopes (locations[]) |
| `roles` · `permissions` · `role_permissions` · `user_roles` | RBAC | slug, name, is_system, scope | papéis padrão prontos |
| `automation_rules` | Motor de regras | trigger(event/schedule/condition), conditions(jsonb), actions(jsonb), active | muito além dos "Robôs" |
| `notifications` · `notification_channels` | Entrega | channel(email/push/whatsapp/webhook), template, recipients, verified_at | → automation_rules |
| `satisfaction_surveys` | CSAT | work_order_id, score(1–5), comment, answered_at | → work_orders |
| `saved_views` · `dashboards` · `dashboard_widgets` | BI nativo | owner, filters(jsonb), metric, group_by, viz, limit | substitui o Looker Studio |
| `export_jobs` · `report_schedules` | Processamento assíncrono | kind, params, status, file_key, requested_by | padrão herdado do Arkmeds |
| `audit_logs` | Trilha | actor_id, entity_type, entity_id, action, changes(jsonb), ip, user_agent, at | global; acrescenta IP, que o Arkmeds não tem |

## 24. Jornadas principais

### Jornada 1 — Onboarding de um novo cliente e seu parque

```

Cliente (hospital) → Unidades → Setores
      ↓
Importação do inventário (planilha) → Ativos com TAG, série, patrimônio
      ↓
Classificação: categoria, criticidade, prioridade, SLA (atendimento / fechamento)
      ↓
Geração e impressão de QR Codes → colagem nos ativos
      ↓
Criação dos Planos (preventiva · calibração · TSE) com frequência por categoria
      ↓
Vinculação de Procedimentos e Checklists por tipo de equipamento
      ↓
Cadastro dos Solicitantes do cliente e envio de acesso ao portal
      ↓
Primeiro ciclo abre → OS previstas entram na Agenda

```

### Jornada 2 — Manutenção corretiva (o fluxo mais frequente)

```

Enfermeiro no setor lê o QR Code (ou entra no portal)
      ↓
Abre Chamado: equipamento + problema relatado + observação + foto
      ↓
Fila "A atender" (sem responsável) — prioridade herdada do ativo · SLA inicia
      ↓
Coordenador triaga → atribui responsável técnico e quadro de trabalho → agenda
      ↓
Técnico recebe no app (offline) → executa → checklist → fotos antes/depois → horas
      ↓
      ├─ resolveu ────────────────→ Serviço finalizado
      ├─ falta peça ──────────────→ Aguardando peças → reserva/compra → retoma
      ├─ precisa orçamento ───────→ Análise concluída → Orçamento → cliente aprova
      └─ sem reparo viável ───────→ Laudo de obsolescência → baixa patrimonial
      ↓
Assinatura do solicitante (app ou portal, com código por e-mail) → Fechada
      ↓
Avaliação 1–5 + comentário → alimenta CSAT e produtividade
      ↓
Indicadores: MTTR, disponibilidade, SLA cumprido, custo (horas × custo/hora + peças)

```

### Jornada 3 — Manutenção preventiva do ciclo

```

Plano ativo → início do ciclo (data + frequência)
      ↓
abertura automática gera N OS (uma por ativo × serviço marcado)
      ↓
Agenda: baldes "não agendados" → coordenador distribui por técnico e semana
      ↓
Técnico executa em rota (vários ativos do mesmo setor no mesmo dia)
      ↓
Checklist do Procedimento aplicável → aprovações item a item
      ↓
Se serviço = Calibração → certificado com padrões, incertezas e validade
Se serviço = TSE       → teste automático pelo analisador → certificado
      ↓
Fechamento → progresso do ciclo avança ("12 de 40 OS completadas")
      ↓
Relatório de Conformidade de Planos → entregue ao cliente / usado em auditoria ONA

```

### Jornada 4 — Orçamento e faturamento

```

OS em análise → técnico conclui diagnóstico
      ↓
Cria orçamento (peças e/ou serviços) → valor, validade
      ↓
Estado da OS: Aguardando envio → Aguardando aprovação do orçamento
      ↓
Solicitante recebe, abre no portal e aprova ou reprova com motivo
      ↓
Aprovado → execução → faturamento → débito das peças no estoque
Reprovado → registro do motivo → alimenta análise de perda

```

### Jornada 5 — Ciclo metrológico

```

Padrão calibrado por laboratório acreditado → Certificado de Padrão (validade)
      ↓
Padrão é usado em calibrações do parque do cliente
      ↓
Calibração: condições ambientais → pontos de medição → incerteza expandida (k 95 %)
      ↓
Critério de aceitação → veredito → certificado com validade
      ↓
Liberação ao solicitante (manual ou automática) → e-mail de liberação
      ↓
30 dias antes do vencimento → e-mail mensal de vencimentos + relatório
      ↓
Plano gera nova OS de calibração no próximo ciclo

```

### Jornada 6 — Prestação de contas mensal

```

Fim do mês
      ↓
Relatório periódico automático (seções configuradas) → e-mail aos destinatários
      ↓
Gestor abre Indicadores: OS criadas/finalizadas, MTTR, MTBF, disponibilidade,
      conformidade de planos, CSAT, custo × custo de substituição do parque
      ↓
Reunião com o cliente → contrato, medição, plano de substituição de ativos

```

## 25. Matriz de permissões provável

Papéis derivados dos grupos existentes, dos cargos reais dos usuários e do conjunto de permissões observado. Marcado o que é **confirmado** pelos grupos lidos e o que é **proposta** nossa.

### Papéis observados no tenant **Alta**

Grupos: Administração · Administrador Médio · Supervisor · Técnico · Calibração · Manutenção · Cadastro Equipamentos / Clientes · Preferências do Solicitante · "." Cargos livres nos usuários: Engenheira clínica · Engenheiro eletricista · Técnico em Equipamentos Médicos · Técnico de Eletrônica · Técnico · Gestor administrativo.

### Matriz recomendada para o nosso produto

| Capacidade | Admin | Gestor | Supervisor | Técnico | Metrologista | Financeiro | Cliente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Configurar organização e preferências | ✔ | — | — | — | — | — | — |
| Gerenciar usuários, papéis e licenças | ✔ | parcial | — | — | — | — | — |
| Cadastrar clientes, unidades e setores | ✔ | ✔ | — | — | — | — | — |
| Cadastrar e editar ativos | ✔ | ✔ | ✔ | criar no app | — | — | — |
| Criar e editar planos | ✔ | ✔ | ✔ | — | — | — | — |
| Abrir chamado | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ |
| Triar e atribuir OS | ✔ | ✔ | ✔ | — | — | — | — |
| Executar OS (checklist, horas, peças, fotos) | ✔ | — | ✔ | ✔ | ✔ | — | — |
| Fechar OS | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Editar OS fechada ou cancelada | ✔ | ✔ | — | — | — | — | — |
| Emitir certificado de calibração | ✔ | — | — | — | ✔ | — | — |
| Liberar certificado ao cliente | ✔ | ✔ | — | — | ✔ | — | — |
| Emitir laudo de obsolescência | ✔ | ✔ | ✔ | — | — | — | — |
| Criar orçamento | ✔ | ✔ | ✔ | ✔ | — | ✔ | — |
| Aprovar / reprovar orçamento | ✔ | ✔ | — | — | — | ✔ | ✔ |
| Faturar | ✔ | ✔ | — | — | — | ✔ | — |
| Movimentar estoque | ✔ | ✔ | ✔ | consumir | — | ✔ | — |
| Ver valores e custos | ✔ | ✔ | parcial | — | — | ✔ | só orçamento |
| Ver indicadores operacionais | ✔ | ✔ | ✔ | próprios | próprios | — | do seu escopo |
| Ver indicadores financeiros | ✔ | ✔ | — | — | — | ✔ | — |
| Ver trilha de auditoria | ✔ | ✔ | — | — | — | — | — |
| Assinar OS como cliente | — | — | — | — | — | — | ✔ |
| Avaliar atendimento | — | — | — | — | — | — | ✔ |
| Escopo de dados | tudo | tudo | suas equipes | suas OS | suas OS | tudo | **seus setores** |

> **PRINCÍPIO**
>
> Herdar do Arkmeds o *vocabulário* de permissões (verbos por entidade + ações sensíveis nomeadas) e a ideia de *permissão que esconde campo*. Não herdar a entrega de grupos vazios: papéis padrão prontos, com um editor granular reservado a quem realmente precisa. Escopo de dados deve ser dimensão de primeira classe (organização → cliente → unidade → setor → equipe), não um multiselect de empresas.

## 26. MVP recomendado

Critério de corte: *é possível operar um contrato real de engenharia clínica com isto?* Tudo que não passa nesse teste sai do MVP, por mais atraente que pareça.

### Dentro do MVP

| Bloco | Escopo mínimo | Por quê |
| --- | --- | --- |
| **Organização e acesso** | Multiempresa; árvore cliente → unidade → setor; papéis padrão (Admin, Gestor, Supervisor, Técnico, Cliente); convite por e-mail; escopo de dados por setor | Sem isso não há operação multicliente nem portal |
| **Ativos** | Cadastro com TAG/série/patrimônio, categoria, fabricante e modelo normalizados, criticidade, prioridade, SLA, garantia, anexos, QR Code; importação por planilha; ficha 360° | É o cadastro-base de todo o resto |
| **Ordens de serviço** | Tipos de sistema (corretiva, preventiva, calibração, TSE, instalação, inspeção); **máquina de estados com categorias e transições**; prioridade; responsável e executores; agendamento; descrição e resolução; anexos e fotos; thread de comentários; horas trabalhadas; peças consumidas; PDF | Núcleo operacional |
| **Chamados / portal do cliente** | Abertura por QR Code ou portal; acompanhamento; assinatura; avaliação 1–5 com comentário | É o que o hospital enxerga — e o que se vende |
| **Planos preventivos** | Frequência, prazo, ciclos, escopo por ativo/categoria/setor com lista de serviços; geração automática de OS; painel de conformidade do ciclo | Sem preventiva não há contrato de engenharia clínica |
| **Procedimentos e checklists** | Construtor com tipos texto/número/opções/foto; vínculo a categoria + tipo de serviço; execução na OS com resultado por item | É o conteúdo técnico que sustenta a auditoria |
| **Mobile PWA offline** | Minhas OS, execução com checklist, fotos, horas, peças, assinatura no dedo, leitura de QR; fila de sincronização | O trabalho acontece no corredor do hospital, sem sinal |
| **Estoque básico** | Itens, unidade, saldo, estoque mínimo, entrada com NF e lote, saída por OS, alerta de mínimo | Peça parada é a principal causa de OS travada (789 OS "Aguardando peças" hoje) |
| **Indicadores** | OS abertas/fechadas, backlog, MTTR, MTBF, disponibilidade, cumprimento de SLA, conformidade de planos, preventiva × corretiva, CSAT | É a razão de o gestor abrir o sistema |
| **Auditoria** | Trilha com diff campo a campo, ator, IP e data; feed de atividades | Requisito regulatório, não opcional |
| **Documentos** | Numeração configurável por tipo; PDF de OS com logo do cliente | O papel ainda é o entregável |

### Fora do MVP (deliberadamente)

Certificados de calibração com incerteza · qualificação térmica · orçamento e faturamento · contratos com SLA contratual · transferências e protocolos de custódia · automações configuráveis · relatórios periódicos por e-mail · dashboards personalizáveis · integrações com ERP · IA.

## 27. Roadmap

#### MVP — "Operar" **meses 1–5**

Tudo da seção 26. Meta: substituir planilha + WhatsApp em **um** contrato piloto, com preventiva rodando e portal do cliente no ar.

#### Fase 2 — "Comprovar" **meses 6–9**

**Metrologia:** certificados de calibração com padrões, incertezas, pontos de medição, fator k, critério de aceitação, validade e liberação ao cliente; certificados de padrão com laboratório externo; TSE. **Comercial:** orçamentos com aprovação no portal, catálogo de serviços, faturamento com baixa de estoque. **Contratos:** escopo, vigência, SLA por prioridade, medição mensal. **Relatórios:** conformidade de planos, conclusão de OS, vencimentos, produtividade, com agendamento por e-mail.

#### Fase 3 — "Escalar" **meses 10–15**

**Automação:** motor de regras com gatilhos por evento, data e condição; ações de notificar, atribuir, mudar estado e criar OS; canais e-mail, push e WhatsApp. **Planejamento:** agenda com capacidade, jornada e rota; carga por técnico. **BI nativo:** dashboards configuráveis com as métricas do catálogo, drill-down e visões salvas compartilháveis. **Laudos:** obsolescência e qualificação térmica. **Governança:** transferências, protocolos de custódia, inventário cíclico. **API pública** + webhooks + conectores para TOTVS/SAP/MV/Tasy.

#### Fase 4 — "Antecipar" **meses 16+**

**IA assistiva:** resumo automático de OS, sugestão de diagnóstico a partir do histórico, deduplicação de taxonomias, busca em linguagem natural sobre o histórico. **Preditivo:** ingestão de medidores e sensores IoT; manutenção baseada em condição; alerta de reincidência. **Capital:** planejamento de substituição do parque (vida útil × custo acumulado × criticidade). **Marketplace** de procedimentos e checklists por categoria de equipamento. **Multi-idioma** e expansão além do clínico (predial, industrial).

## 28. Arquitetura técnica recomendada

Recomendação, não implementação. As escolhas abaixo priorizam velocidade de entrega do MVP sem hipotecar a Fase 3.

| Camada | Recomendação | Racional |
| --- | --- | --- |
| **Frontend web** | React + TypeScript + Vite; TanStack Query e Table; Zod; um design system próprio sobre primitivos acessíveis (Radix); virtualização de listas | Listas de 70 mil linhas e formulários de 40 campos exigem tabela virtualizada e validação declarativa desde o dia 1 |
| **Mobile** | PWA instalável com IndexedDB e fila de sincronização; câmera e leitor de QR nativos do navegador; app nativo só se push confiável e leitura de NFC virarem requisito | Uma base de código; o Arkmeds precisou de app nativo em 2019, hoje o PWA cobre 90 % do caso |
| **Backend** | PostgreSQL como núcleo. Duas opções defensáveis: **(a)** Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) para chegar rápido ao piloto; **(b)** API própria (NestJS ou FastAPI) sobre Postgres gerenciado quando as regras de estado, numeração e cálculo metrológico ficarem densas | Recomendação: começar em (a) e manter toda a lógica de domínio em funções e migrations versionadas, de modo que migrar para (b) seja troca de camada de transporte, não reescrita |
| **Multitenancy** | `organization_id` em todas as tabelas + Row Level Security no Postgres; escopo adicional por cliente/unidade/setor aplicado na policy | Isolamento por linha com RLS é mais simples de operar que schema por tenant e suporta relatórios cruzados |
| **Autenticação** | E-mail + senha, magic link para solicitantes, SSO (SAML/OIDC) para hospitais na Fase 3; MFA opcional; sessão curta para perfis administrativos | O portal precisa de atrito zero; o backoffice precisa de rigor |
| **Storage** | Object storage com URLs assinadas de curta duração; buckets separados para mídia de OS, documentos de ativo, certificados e assinaturas; miniaturas geradas no upload | Fotos de OS dominam o volume; certificados exigem retenção longa |
| **Assíncrono** | Fila durável (pg-boss, Redis ou SQS) para PDF, exportação, relatórios periódicos, geração de ciclos de plano e envio de notificações; tabela `jobs` visível ao usuário | Copiar o acerto do Arkmeds: o usuário vê a fila e baixa quando ficar pronto |
| **PDF** | Renderização server-side a partir de HTML com templates versionados por organização | Certificado e OS impressa são o entregável contratual |
| **Domínio** | Máquina de estados declarativa; motor de numeração transacional; motor de recorrência de planos; calculadora metrológica isolada e com testes de regressão | São as quatro peças que não podem ter bug |
| **Auditoria** | Trigger de banco escrevendo `audit_logs` com diff em JSONB + contexto de ator e IP propagado pela aplicação | Auditoria na aplicação sempre tem furos; no banco, não |
| **Soft delete** | `deleted_at` em entidades de negócio; *arquivar* em vez de excluir nas taxonomias (o "ocultar" do Arkmeds); exclusão física só por rotina administrativa | Histórico de 8 anos não pode quebrar por um `DELETE` |
| **Observabilidade** | Logs estruturados, tracing, monitor de erros de front, métricas de fila e de tempo de resposta das listas | Telas que travam por 30 s foram observadas no alvo — é um problema de produto |
| **Qualidade** | Testes de domínio (estados, recorrência, metrologia, permissões) e E2E dos 6 fluxos da seção 24; seeds realistas com dezenas de milhares de registros | Performance só aparece com volume real |
| **Segurança e LGPD** | Criptografia em repouso e em trânsito; política de retenção; exportação e anonimização do titular; registro de consentimento; papéis de suporte com acesso temporário e auditado | O Arkmeds tem "Permitir login do usuário suporte" — bom conceito, precisa de expiração e log |

## 29. Diferenciais do nosso produto

| Diferencial | Descrição | Classificação |
| --- | --- | --- |
| Interface moderna e consistente | Uma única linguagem visual, tema claro e escuro, densidade calibrada por papel | **Essencial** |
| PWA mobile-first para técnico | Instalável, rápido, desenhado para uma mão e para corredor de hospital | **Essencial** |
| Funcionamento offline | Fila de sincronização com resolução de conflito explícita e visível | **Essencial** |
| QR Code em ativos + leitura pelo celular | Do QR ao chamado em dois toques, sem login para o solicitante já autenticado | **Essencial** |
| Máquina de estados configurável | Categoria, cor, transições permitidas, SLA que pausa, ações automáticas por estado | **Essencial** |
| Gestão de SLA nativa | SLA por contrato × prioridade × cobertura horária, com relógio visível e escalonamento | **Essencial** |
| Busca global | Um campo que encontra patrimônio, série, OS, cliente, peça e documento | **Essencial** |
| Checklist inteligente | Itens condicionais, faixas numéricas com veredito automático, foto obrigatória em item reprovado | **Importante** |
| Fotos antes/depois | Par obrigatório configurável por tipo de serviço, com marca d'água de data e ativo | **Importante** |
| Assinatura digital no dedo | Coleta no app com validação por código e hash do documento assinado | **Importante** |
| Thread na OS | Comentários com menção, anexos e visibilidade interna × cliente — substitui o WhatsApp | **Importante** |
| Portal do cliente desenhado | Não um subconjunto de permissões: painel próprio, meus equipamentos, meus chamados, meus certificados, meus indicadores | **Importante** |
| Dashboards em tempo real | Widgets configuráveis sobre o catálogo de métricas, com drill-down até a OS | **Importante** |
| Notificações multicanal | E-mail, push e WhatsApp, com preferência por usuário e por evento | **Importante** |
| Automações sem código | "Quando X e Y, então Z" com gatilhos de evento, data e condição | **Importante** |
| Relatórios personalizados | Construtor com visões salvas, compartilháveis e agendáveis | **Importante** |
| Agenda com capacidade e rota | Jornada do técnico, conflito, carga da semana e agrupamento por setor | **Diferencial** |
| Geolocalização opcional | Check-in no ativo, com consentimento e sem rastreamento contínuo | **Diferencial** |
| IA — resumo automático de OS | Resumo do atendimento a partir de checklist, comentários e horas | **Diferencial** |
| IA — sugestão de diagnóstico | "Ativos deste modelo com este sintoma foram resolvidos assim em 82 % dos casos" | **Diferencial** |
| IA — higiene de taxonomia | Detecta e propõe fusão de duplicatas (o problema real do tenant auditado) | **Diferencial** |
| Busca em linguagem natural no histórico | "Quais ventiladores da UTI 2 falharam por bateria nos últimos 6 meses?" | **Diferencial** |
| Gestão de contratos | Escopo, indicadores contratados, medição mensal, glosa e reajuste | **Diferencial** |
| Planejamento de substituição do parque | Ranking de ativos candidatos a troca por vida útil, custo acumulado e criticidade | **Diferencial** |
| Alertas preditivos | Reincidência, desvio de MTBF, tendência de custo por ativo | **Futuro** |
| Manutenção por condição (IoT) | Medidores, sensores e CLP alimentando gatilhos de plano | **Futuro** |
| Marketplace de procedimentos | Biblioteca compartilhada por categoria de equipamento | **Futuro** |
| Integração com analisadores | Leitura direta de instrumentos de calibração e segurança elétrica | **Futuro** |

## 30. Backlog funcional

Prioridade: **P0** MVP · **P1** Fase 2 · **P2** Fase 3 · **P3** Fase 4. Complexidade em escala relativa (B/M/A/MA). Origem: **ARKMEDS** (observado), **BENCHMARK** (concorrência), **MELHORIA** (proposta nossa).

| ID | Módulo | Funcionalidade | Prio | Compl. | Origem |
| --- | --- | --- | --- | --- | --- |
| ORG-01 | Organização | Multiempresa com `organization_id` e RLS | **P0** | M | ARKMEDS |
| ORG-02 | Organização | Árvore cliente → unidade → setor (tabela própria, não polimórfica) | **P0** | M | MELHORIA |
| ORG-03 | Organização | Cadastro de fornecedores separado de clientes | **P0** | B | MELHORIA |
| ORG-04 | Organização | Preferências por organização (chaves tipadas, com busca) | **P1** | M | ARKMEDS |
| ORG-05 | Organização | Branding por cliente no PDF e no portal | **P1** | B | MELHORIA |
| USR-01 | Usuários | Papéis padrão prontos (7 papéis) + editor granular | **P0** | M | MELHORIA |
| USR-02 | Usuários | Escopo de dados por cliente / unidade / setor / equipe | **P0** | A | ARKMEDS |
| USR-03 | Usuários | Solicitantes (portal) sem consumo de licença | **P0** | M | ARKMEDS |
| USR-04 | Usuários | Custo/hora, jornada diária, conselho e registro profissional, férias | **P0** | B | ARKMEDS |
| USR-05 | Usuários | Assinatura digital armazenada no perfil | **P1** | B | ARKMEDS |
| USR-06 | Usuários | Permissões que ocultam campos e blocos da OS | **P1** | M | ARKMEDS |
| USR-07 | Usuários | SSO SAML/OIDC + MFA | **P2** | A | BENCHMARK |
| USR-08 | Usuários | Acesso de suporte temporário, com prazo e log | **P2** | B | MELHORIA |
| AST-01 | Ativos | Cadastro completo com TAG, série, patrimônio, ANVISA, INMETRO | **P0** | M | ARKMEDS |
| AST-02 | Ativos | Catálogo normalizado de fabricante, modelo e categoria | **P0** | M | MELHORIA |
| AST-03 | Ativos | Criticidade, prioridade e SLA (atendimento/fechamento) por ativo | **P0** | B | ARKMEDS |
| AST-04 | Ativos | QR Code: geração, impressão em etiqueta e resolução por token | **P0** | M | ARKMEDS |
| AST-05 | Ativos | Ficha 360° com indicadores, programação e documentos | **P0** | A | ARKMEDS |
| AST-06 | Ativos | Importação por planilha com validação e pré-visualização | **P0** | M | ARKMEDS |
| AST-07 | Ativos | Bloqueio de duplicidade configurável por campo | **P1** | B | ARKMEDS |
| AST-08 | Ativos | Dados financeiros e tabela de depreciação | **P1** | M | ARKMEDS |
| AST-09 | Ativos | "Mostrar na OS" por campo do ativo | **P1** | B | ARKMEDS |
| AST-10 | Ativos | Hierarquia pai/filho (equipamento → componente/acessório) | **P2** | M | BENCHMARK |
| AST-11 | Ativos | Medidores e leituras (horas, ciclos) | **P3** | M | BENCHMARK |
| OS-01 | Ordens | CRUD de OS com tipos de sistema e catálogo de serviços separados | **P0** | A | MELHORIA |
| OS-02 | Ordens | Máquina de estados: categoria, cor, terminal, pausa de SLA, transições | **P0** | A | MELHORIA |
| OS-03 | Ordens | Lista virtualizada com filtros persistentes em chips e URL compartilhável | **P0** | A | ARKMEDS |
| OS-04 | Ordens | Kanban por estado com arrastar-e-soltar validado pelas transições | **P0** | M | ARKMEDS |
| OS-05 | Ordens | Responsável técnico + múltiplos executores | **P0** | B | ARKMEDS |
| OS-06 | Ordens | Registro de horas com custo (manual e cronômetro) | **P0** | M | ARKMEDS |
| OS-07 | Ordens | Peças consumidas com baixa de estoque | **P0** | M | ARKMEDS |
| OS-08 | Ordens | Anexos e fotos antes/depois | **P0** | M | MELHORIA |
| OS-09 | Ordens | Thread de comentários com visibilidade interna × cliente | **P0** | M | BENCHMARK |
| OS-10 | Ordens | PDF da OS com template por organização | **P0** | M | ARKMEDS |
| OS-11 | Ordens | Numeração configurável (prefixo, sufixo, sequência) por documento | **P0** | M | ARKMEDS |
| OS-12 | Ordens | Criação em lote e edição em massa | **P1** | M | ARKMEDS |
| OS-13 | Ordens | Campos personalizados por organização e por tipo de OS | **P1** | A | MELHORIA |
| OS-14 | Ordens | Terceirização: fornecedor executante e acompanhamento | **P1** | M | ARKMEDS |
| OS-15 | Ordens | Protocolos de recolhimento, entrega e serviço | **P2** | M | ARKMEDS |
| CHM-01 | Chamados | Abertura pelo portal e por QR Code, com formulário mínimo | **P0** | M | ARKMEDS |
| CHM-02 | Chamados | Fila de triagem com "sem responsável", "vencidas" e "em andamento" | **P0** | M | ARKMEDS |
| CHM-03 | Chamados | Avaliação 1–5 com comentário e obrigatoriedade configurável | **P0** | B | ARKMEDS |
| CHM-04 | Chamados | Assinatura do solicitante com validação por código | **P1** | M | ARKMEDS |
| PLN-01 | Planos | Plano com frequência, prazo, ciclos e abertura automática | **P0** | A | ARKMEDS |
| PLN-02 | Planos | Escopo por ativo, categoria ou setor com lista de serviços | **P0** | M | ARKMEDS |
| PLN-03 | Planos | Painel de conformidade do ciclo (em dia / atrasadas / iniciadas) | **P0** | M | ARKMEDS |
| PLN-04 | Planos | Cronograma anual exportável para o cliente | **P1** | M | ARKMEDS |
| PLN-05 | Planos | Frequência por serviço dentro do mesmo plano | **P1** | M | MELHORIA |
| PLN-06 | Planos | Gatilho por medidor/uso além do calendário | **P3** | A | BENCHMARK |
| PRC-01 | Procedimentos | Procedimento vinculando checklist + categoria + tipo de serviço | **P0** | M | ARKMEDS |
| PRC-02 | Procedimentos | Construtor de checklist (texto, número com faixa, opções, foto) | **P0** | M | ARKMEDS |
| PRC-03 | Procedimentos | Itens em tabela relacional (não JSON) com versionamento | **P0** | M | MELHORIA |
| PRC-04 | Procedimentos | Itens condicionais e veredito automático por faixa | **P2** | A | MELHORIA |
| MOB-01 | Mobile | PWA instalável com "Minhas OS" e execução completa | **P0** | A | ARKMEDS |
| MOB-02 | Mobile | Offline com fila de sincronização e resolução de conflito | **P0** | MA | ARKMEDS |
| MOB-03 | Mobile | Leitura de QR Code e câmera integrada | **P0** | M | ARKMEDS |
| MOB-04 | Mobile | Assinatura no dedo com hash do documento | **P1** | M | ARKMEDS |
| MOB-05 | Mobile | Criação de ativo e de OS em campo | **P1** | M | ARKMEDS |
| MOB-06 | Mobile | Check-in por geolocalização (opcional, com consentimento) | **P2** | M | BENCHMARK |
| EST-01 | Estoque | Itens, unidades, saldo, estoque mínimo | **P0** | M | ARKMEDS |
| EST-02 | Estoque | Entrada com nota fiscal, lote e custo | **P0** | M | ARKMEDS |
| EST-03 | Estoque | Alerta de estoque mínimo | **P0** | B | ARKMEDS |
| EST-04 | Estoque | Almoxarifados como entidade e transferência entre eles | **P1** | M | MELHORIA |
| EST-05 | Estoque | Preço e nomenclatura da peça por cliente | **P1** | B | ARKMEDS |
| EST-06 | Estoque | Reserva de peça vinculada à OS | **P1** | M | ARKMEDS |
| EST-07 | Estoque | Inventário cíclico e ajuste com justificativa | **P2** | M | BENCHMARK |
| EST-08 | Estoque | Custo médio e curva ABC | **P2** | M | BENCHMARK |
| CAL-01 | Metrologia | Certificado de calibração com pontos, incerteza e fator k | **P1** | MA | ARKMEDS |
| CAL-02 | Metrologia | Padrões e certificados de padrão com laboratório externo | **P1** | A | ARKMEDS |
| CAL-03 | Metrologia | Critério de aceitação e correção de erro sistemático | **P1** | A | ARKMEDS |
| CAL-04 | Metrologia | Bloqueio de emissão com padrão vencido | **P1** | B | MELHORIA |
| CAL-05 | Metrologia | Liberação do certificado ao cliente (manual/automática) + e-mail | **P1** | M | ARKMEDS |
| CAL-06 | Metrologia | Teste de segurança elétrica com certificado | **P1** | A | ARKMEDS |
| CAL-07 | Metrologia | Laudo de obsolescência com parecer e assinatura | **P2** | M | ARKMEDS |
| CAL-08 | Metrologia | Qualificação térmica | **P2** | A | ARKMEDS |
| CAL-09 | Metrologia | Integração com analisadores (importação de leituras) | **P3** | MA | ARKMEDS |
| ORC-01 | Orçamentos | Orçamento a partir da OS com itens de peça e serviço | **P1** | A | ARKMEDS |
| ORC-02 | Orçamentos | Aprovação/reprovação pelo cliente no portal, com motivo | **P1** | M | ARKMEDS |
| ORC-03 | Orçamentos | Desconto, impostos e condição de pagamento | **P1** | M | MELHORIA |
| ORC-04 | Orçamentos | Versionamento da proposta (v1, v2…) em vez de sobrescrita | **P1** | M | MELHORIA |
| ORC-05 | Orçamentos | Faturamento com baixa de estoque por lote | **P1** | M | ARKMEDS |
| CTR-01 | Contratos | Contrato com vigência, escopo e ativos cobertos | **P1** | M | ARKMEDS |
| CTR-02 | Contratos | SLA contratual por prioridade e cobertura horária | **P1** | A | MELHORIA |
| CTR-03 | Contratos | Medição mensal e relatório de aderência | **P2** | A | MELHORIA |
| CTR-04 | Contratos | Alerta de vencimento de contrato | **P2** | B | ARKMEDS |
| AGD-01 | Agenda | Calendário com arrastar-e-soltar e baldes de pendências | **P1** | A | ARKMEDS |
| AGD-02 | Agenda | Visão por recurso (técnico/equipe) com carga da semana | **P1** | A | ARKMEDS |
| AGD-03 | Agenda | Capacidade, jornada e detecção de conflito | **P2** | A | MELHORIA |
| AGD-04 | Agenda | Agrupamento por setor e sugestão de rota | **P2** | A | BENCHMARK |
| IND-01 | Indicadores | Catálogo de métricas (13 do Arkmeds + backlog e reincidência) | **P0** | A | ARKMEDS |
| IND-02 | Indicadores | Agrupamentos, visualizações e limites | **P1** | A | ARKMEDS |
| IND-03 | Indicadores | Dashboards configuráveis com drill-down até a OS | **P2** | A | MELHORIA |
| IND-04 | Indicadores | Definição visível de cada métrica (tooltip com fórmula) | **P0** | B | MELHORIA |
| IND-05 | Indicadores | Preventiva × corretiva e reincidência como métricas nativas | **P1** | M | MELHORIA |
| REL-01 | Relatórios | Relatórios operacionais em PDF (conclusão, estado, conformidade) | **P1** | A | ARKMEDS |
| REL-02 | Relatórios | Exportação assíncrona com fila visível | **P0** | M | ARKMEDS |
| REL-03 | Relatórios | Construtor de relatório com seções e preview | **P2** | A | ARKMEDS |
| REL-04 | Relatórios | Agendamento por e-mail sem limite artificial | **P2** | M | MELHORIA |
| AUT-01 | Automação | Regras evento → condição → ação (notificar, atribuir, mudar estado, criar OS) | **P2** | MA | MELHORIA |
| AUT-02 | Automação | Gatilhos por data e vencimento (calibração, contrato, garantia) | **P1** | M | MELHORIA |
| AUT-03 | Automação | Escalonamento por SLA estourado | **P2** | A | MELHORIA |
| AUT-04 | Automação | Canais e-mail, push e WhatsApp com verificação de destinatário | **P2** | A | ARKMEDS |
| AUT-05 | Automação | Webhooks assinados com reenvio e log de entrega | **P2** | M | ARKMEDS |
| POR-01 | Portal | Painel do cliente com seus ativos, chamados e indicadores | **P0** | A | ARKMEDS |
| POR-02 | Portal | Acompanhamento de planos (em dia, atrasado, ciclos anteriores) | **P1** | M | ARKMEDS |
| POR-03 | Portal | Biblioteca de certificados e laudos liberados | **P1** | M | ARKMEDS |
| SIS-01 | Sistema | Trilha de auditoria com diff, ator e IP | **P0** | A | ARKMEDS |
| SIS-02 | Sistema | Soft delete e arquivamento de taxonomias | **P0** | B | ARKMEDS |
| SIS-03 | Sistema | Busca global unificada | **P0** | A | MELHORIA |
| SIS-04 | Sistema | Mesclagem assistida de taxonomias duplicadas | **P1** | M | ARKMEDS |
| SIS-05 | Sistema | API pública REST + chaves e escopos | **P2** | A | ARKMEDS |
| SIS-06 | Sistema | Conectores TOTVS / SAP / MV / Tasy | **P3** | MA | ARKMEDS |
| SIS-07 | Sistema | LGPD: exportação e anonimização do titular, consentimento | **P2** | M | MELHORIA |
| IA-01 | IA | Resumo automático da OS | **P3** | M | MELHORIA |
| IA-02 | IA | Sugestão de diagnóstico pelo histórico do modelo | **P3** | A | MELHORIA |
| IA-03 | IA | Higiene de taxonomia (detecção de duplicatas) | **P3** | M | MELHORIA |
| IA-04 | IA | Busca em linguagem natural sobre o histórico | **P3** | A | MELHORIA |
| IA-05 | IA | Planejamento de substituição do parque | **P3** | A | BENCHMARK |

## 31. O que a auditoria não conseguiu responder

Lacunas honestas. Nenhuma delas poderia ser resolvida sem gravar dados no ambiente de produção — o que estava expressamente vedado.

| Pergunta em aberto | Por que ficou aberta | Como responder depois |
| --- | --- | --- |
| **Quais transições de estado o sistema permite?** | Só se descobre mudando o estado de uma OS | Perguntar a um usuário-chave; ou observar em ambiente de demonstração |
| **Fórmulas exatas de Disponibilidade, MTTR, MTBF e TMAC** | A interface não exibe definição; os botões de ajuda não retornam conteúdo | Suporte Arkmeds ou documentação contratual do cliente |
| **O que significa exatamente TMAC** | Sigla sem legenda; formato de duração | Idem acima |
| **Como a abertura automática de OS do plano é disparada** | Job agendado não observável de fora | Documentação ou suporte |
| **Comportamento do plano quando um ativo é transferido no meio do ciclo** | Exigiria executar uma transferência | Entrevista com o coordenador da operação |
| **Como funciona o rascunho de OS e a resolução de conflito na sincronização** | A lista estava carregando e não há registros de exemplo acessíveis | Testar no app MARK II em ambiente de homologação |
| **Payload e eventos disponíveis no webhook** | O assistente "Crie seu Trigger" só foi aberto até a etapa de filtro; concluir criaria uma automação | Solicitar documentação de integração (a categoria de ajuda está vazia) |
| **Se existe API REST pública e qual sua superfície** | Não há tela de credenciais; o material comercial afirma que existe | Solicitar ao fornecedor |
| **Como o BI do Looker Studio é alimentado** | Fora do produto | Perguntar ao cliente/fornecedor |
| **Conteúdo dos demais grupos de permissão** | Foram lidos apenas os grupos 7 (Solicitante) e 8 (Técnico), para limitar a navegação | Leitura direta dos grupos 1, 2, 3, 5, 6, 9 e 10 — é read-only e pode ser feita a qualquer momento |
| **Estrutura do orçamento preenchido** | Existe apenas 1 orçamento no tenant e ele não estava listado nas abas | Filtrar por período amplo, ou pedir um exemplo ao cliente |
| **Layout dos PDFs (OS, certificado, laudo)** | A geração de PDF é processamento e, em alguns casos, registra evento | Pedir exemplos já emitidos ao cliente |
| **Modelo de licenciamento e preço** | Só se observa o limite "36 de 38 usuários" e "máximo de 5 relatórios" | Proposta comercial do fornecedor |
| **Isolamento real entre tenants** | Testar seria acesso indevido — expressamente fora de escopo | Documentação de segurança do fornecedor |
| **Retenção e imutabilidade do log de auditoria** | Não observável pela interface | Documentação do fornecedor |
| **Como o "Teste Automático" do checklist recebe dados do analisador** | Requer o hardware | Documentação da linha Tesla/Otto ou demonstração |
| **Se há campos personalizados além do "Campo Extra"** | Só um campo livre foi encontrado, definido em Preferências | Confirmar com o fornecedor |

> **ENCERRAMENTO**
>
> Esta auditoria foi conduzida integralmente em modo leitura. Nenhum registro do ambiente TechneCare foi criado, alterado, excluído, assinado, aprovado, movimentado, exportado ou notificado. Nenhum projeto, código, banco de dados ou componente foi criado — o único artefato produzido é este documento.

---

Auditoria funcional e visual · technecare.arkmeds.com v2.69.0 · 28 de agosto de 2026 · perfil Eng. Clínico/Administrador · escopo somente leitura.
