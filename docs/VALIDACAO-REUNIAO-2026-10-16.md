# Validação da reunião de 16/10/2026 (Anderson × Douglas) contra o código

**Fonte:** `Reunião iniciada às 2026_10_16 10_25 … Anotações do Gemini (1).docx` (a mais completa; a outra tem o mesmo conteúdo). O terceiro arquivo da pasta Downloads (reunião de 19/10, tráfego pago) é outro assunto e não foi usado.
**Código conferido:** `main` em `0ce29f8` (21/10/2026).
**Método:** cada pedido da seção "Próximas etapas" e dos "Detalhes" foi procurado no código (telas, rotas, domínio, migrations 0060–0077). Marquei **Feito** só quando achei o arquivo ou símbolo que implementa o pedido. Não abri cada tela no navegador. A suíte local passou com 2.460 testes de banco e 209 de ponta a ponta, mas 6 testes de automações agendadas falham (ver fim do documento).

Legenda: **Feito** · **Parcial** · **Não confirmado** (não achei evidência, mas também não provei que falta) · **Não feito** (bloqueado por algo externo).

| # | Pedido da reunião | Situação | Evidência / observação |
|---|---|---|---|
| 1 | Menu Usuários; "Convidar" vira "Adicionar usuário" | Feito | `shell/navigation.ts` (Usuários), `configuracoes/membros.tsx` |
| 2 | Três perfis: Operador, Solicitante, Gestor | Feito | `domain/profiles.ts`, migration 0061 |
| 3 | Cadastro com nome, CPF, registros (CRM, CFT, CREA, Corem, Crefito, OAB), e-mail, telefone, hospital, setor | Feito | `contracts/operations/members.ts`, migration 0061 |
| 4 | Bloquear, suspender e desbloquear usuário | Feito | migrations 0060/0061, rota `POST /members/:id/status` |
| 5 | Ícone de perfil com a profissão (enfermeira, médico, engenheiro…) | Feito (21/10) | selo da profissão sobre o avatar em Usuários: `configuracoes/profissao.ts`, `membros.tsx`; teste `profissao.test.ts` |
| 6 | Usuário adicionado consegue entrar | Não feito | o roadmap interno (U-09) diz que o convite não cria senha nem manda e-mail; a senha inicial sai por `admin:criar` |
| 7 | Modelos de relatório Básico, Completo/Advanced e Expert | Parcial | níveis, filtros e métricas reais existem (`report-tiers.ts`); layout final de PDF e o Expert esperam os modelos e fórmulas do cliente |
| 8 | Ícone "Gerar relatório" no painel de controle com escolha de métricas | Feito | `painel/relatorio.tsx` |
| 9 | Aba de relatórios com filtros múltiplos (setor, preventiva, tipo, categoria) | Feito | `painel/relatorio.tsx`, `db/relatorios.ts` |
| 10 | Nova automação: relatório, lembrete, tarefa, 5W2H, PDCA | Feito | `domain/automation-schedule.ts`, migration 0067 |
| 11 | Envio real de relatórios por e-mail | Não feito | nenhum provedor SMTP no código; só fila de saída |
| 12 | Aviso imediato ao setor de compras quando a OS aguarda peça | Feito (21/10) | modelo "Aviso: OS aguardando peça" em Nova automação; evento `work_order.blocked` agora carrega `wait_reason_key`; lembrete aceita gatilho por evento e `{{number}}`; testes em `db/automations.test.ts` e `api-automacoes-agendadas.test.ts`. O e-mail segue na fila (item 11) |
| 13 | Integrar automações com colunas do Kanban | Parcial | a tarefa vira ação "criar OS" no quadro de OS existente; 5W2H/PDCA ficam em `/tarefas`, em lista |
| 14 | Store separada + estoque interno (entrada/saída por OS, curva ABC, mínimo/máximo, valor) | Feito | menu Store, `db/estoque-gestao.ts`, migration 0066 (`max_qty`), `abcCurve` |
| 15 | Equipamentos filtrados pelo cliente na solicitação | Feito | `solicitacoes/nova.tsx`, `api/common/alvo-da-solicitacao.ts` |
| 16 | Remover o campo Sintoma | Feito | saiu da tela nova; o dado antigo ainda aparece nas fichas como "Sintoma relatado" |
| 17 | Sete tipos de manutenção | Feito | `domain/request-types.ts` |
| 18 | Check-in com localização e hora no lugar de "horas" | Feito | `db/execucao-guiada.ts` (`work_order_visits`), migration 0065. Mapa do Google fica de fora: sem chave de API |
| 19 | Seção "Preencher ordem de serviço" (descrição, peças, origem) | Feito | `ordens/executar.tsx` |
| 20 | "Rascunho" vira "Negados"; sem salvar rascunho | Feito | status `denied` em `domain/work-orders.ts`, migration 0065 |
| 21 | Etapas da OS e orçamento (hora técnica, peças, aprovação) | Feito | `ordens/orcamento-da-os.tsx`, `quotes.controller.ts` |
| 22 | Painéis para o solicitante: orçamentos aguardando aprovação e equipamentos aguardando peças | Feito (21/10) | dois cartões na tela Hoje (`PendenciasDeEspera` em `routes/hoje.tsx`) |
| 23 | Wizard passo a passo / botão play na execução | Feito | `ordens/executar.tsx`, `POST /maintenance-plans/cycle-items/:itemId/execute` |
| 24 | Fotos de antes e depois | Feito | anexos antes/depois em `executar.tsx` |
| 25 | Filtros de planos por tipo, cliente e setor, combináveis | Feito | `planos/modulo.tsx` (um valor por filtro; combinam entre si) |
| 26 | Gráficos de conformidade por plano e cliente | Feito | `db/plan-board.ts` |
| 27 | Tipos de campo do checklist (texto, sim/não, conformidade, numérico, nominal, múltipla escolha, foto, data) | Feito | `domain/checklists.ts`, `planos/procedimentos.tsx` |
| 28 | Procedimento de teste de segurança elétrica | Feito | tipo `electrical_safety` em procedimentos |
| 29 | Remover "Salvar rascunho" dos procedimentos | Feito | virou "Salvar sem publicar" |
| 30 | Remover o "campo de aceite" | Feito (21/10) | pela transcrição (00:59), era a opção "Aceite" nos filtros e no tipo de procedimento; saiu das duas telas em `planos/procedimentos.tsx`, e procedimento antigo desse tipo ainda abre |
| 31 | Clientes: EAS × empresa corporativa | Feito | `clientes/classificacao.tsx`, migration 0062 |
| 32 | Setores pré-configurados por cliente | Feito | `COMMON_SECTORS`, provisionamento da organização |
| 33 | Cinco categorias e nomes de equipamento pré-configurados | Feito | `asset-catalog.controller.ts`, migration 0063 |
| 34 | QR code e chip geolocalizador no cadastro | Feito | `assets.tracker_kind/tracker_tag`; só cadastro e vínculo, sem hardware |
| 35 | Criar novos negócios (clones isolados) | Feito | `platform/tenants.controller.ts`, `configuracoes/negocios.tsx`, migration 0068 |
| 36 | Seção Ferramentas (temperatura, geolocalização, CME, gases, analisadores) | Feito | `ferramentas/ferramentas.tsx`, em modo apresentação |
| 37 | Telas de apresentação para investidores | Feito | `features/apresentacao`, página `/apresentacao` |
| 38 | Filtro de cliente na tela "Hoje" para o gestor da plataforma | Feito (21/10) | seletor na tela Hoje (aparece com mais de um cliente); `?customer=` agora vale também para fila de triagem e baldes da agenda |
| 39 | Domínio HTEC.B, VPS nos EUA e versão comercial no ar | Não feito | o domínio `htec.b` não existe nem foi comprado; sem deploy de backend desde 15/10; migrations 0060–0077 não aplicadas no banco remoto (segundo `docs/ROADMAP-ANDERSON-2026-10-16.md`; não verifiquei a produção hoje) |

## Resumo (atualizado em 21/10, depois da rodada de pendências)
- **Feito:** 34 de 39 (os 29 do primeiro levantamento + itens 5, 12, 22, 30, 38).
- **Parcial:** 2 (item 7: layout final de PDF e Expert esperam o cliente; item 13: Kanban, decisão de manter o quadro de OS existente).
- **Não feito, por dependência externa:** 3.
  - Item 6: a função de senha do banco (`aurora.definir_senha`) é deliberadamente negada à API. Dar senha inicial no "Adicionar usuário" exige mudar essa regra de segurança, e isso é decisão sua.
  - Item 11: falta escolher o provedor de e-mail.
  - Item 39: domínio `htec.b` inexistente e sem deploy autorizado.

## O que falta de concreto (após a rodada de 21/10)
1. **Produção:** nada do trabalho de 16/10 em diante foi publicado no backend. É a maior lacuna frente à reunião, que previa o primeiro cliente na terça-feira.
2. **E-mail:** sem provedor escolhido, as automações só entregam na caixa de entrada do sistema.
3. **Relatórios Expert e PDF final:** dependem dos modelos e fórmulas do cliente.
4. **Senha inicial do usuário adicionado:** decisão de segurança (ver item 6).

## Qualidade do que foi feito
- Primeira passada local em 21/10: estático 7 de 7, banco 2.460 testes OK e 6 falhos, ponta a ponta 209 OK.
- Os 6 falhos estavam em `api-automacoes-agendadas.test.ts` e dependiam do dia da semana (a simulação olha 31 dias à frente; só cabem 5 passadas semanais em alguns dias). O teste foi corrigido na rodada de pendências.
- Como o repositório agora é público, vale rodar uma varredura de segredos no histórico do Git, além do `check-secrets` que já roda na árvore atual.
