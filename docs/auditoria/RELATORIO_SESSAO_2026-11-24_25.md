# Téchne Care — relatório da demanda de 24 e 25/11/2026

Respostas do contratante (D-1 a D-7) e correção do assistente de planos. Detalhe técnico e matriz por resposta:
`RELATORIO_CONCLUSAO_ANDERSON_2026-11-24.md`.

## 1. Onde estamos

| Item | Situação em 25/11 |
|---|---|
| Código | PR #57 **mesclada** em `main` (`cb71295`), 88 arquivos |
| CI do commit mesclado (`751038d`) | verde: 3.006 de 3.006 testes; 240 de ponta a ponta (1 pulado) |
| App de campo | **publicado** em produção |
| API, sistema e portal | **não publicados** (API na impressão `7fea2ba90690`) |
| Migration `0091` | aplicada em 23/11, conferida no banco |
| Migration `0092` | **não aplicada** |
| Backup e `restore_drill` | **feitos e aprovados em 25/11** (§12) |
| Dados de produção | nenhum alterado; só leituras autorizadas e um backup |

Para o cliente, só o app de campo mudou. O resto entra quando a API e o sistema forem publicados.

## 2. Linha do tempo

**24/11**
- Conferido o estado do projeto: a PR #48 já estava mesclada.
- Localizado o vídeo do contratante de 13/11 e transcrito nesta máquina. A transcrição é automática e pode ter erro de palavra.
- Implementados bloqueio de contrato, renovação, horas da OS e o novo assistente de planos. PR #57 aberta.
- CI: 4 e depois 1 teste de ponta a ponta falharam por erro dos próprios testes; corrigidos.
- Na revisão, encontradas e fechadas lacunas do bloqueio (agenda, peças, automação, Executar do plano).

**25/11**
- Segunda revisão do bloqueio: todas as rotas de escrita. Descrições das Equipes Fixas 1 e 2.
- Novos testes: botão "Gerar OS deste ciclo", automação com contrato parado e 5 no PostgreSQL 16 real.
- Consultas de impacto executadas em produção, só leitura. `0091` confirmada.
- Preparação do deploy: regularização do contrato, análise dos planos, ordem e checklist.
- Corrigida a OS duplicada em plano antigo. PR mesclada e app de campo publicado, com sua autorização.

## 3. O que foi entregue

**Contratos**
- Vencido, suspenso ou bloqueado fica só para consulta, com o motivo na tela e na API. Vale para chamado, OS, execução, agenda,
  peças, comentário, avaliação, metrologia, laudo, registro de qualidade, orçamento de OS, planos e automações.
- Continuam livres o encerramento do que já tinha começado e a regularização (contrato, cadastros, orçamento avulso).
- Botões Suspender, Bloquear e Reativar, com motivo e auditoria.
- Renovação automática no último dia, pelo prazo contratado, se não estiver suspenso nem bloqueado. Renovação manual para o
  vencido. Histórico sem duplicidade. Contrato sem término não renova.
- Equipe Fixa 1 e 2 descritas; 3 a 10 como "segue a mesma regra; composição detalhada a definir".

**Horas técnicas**
- Hora de início e de término obrigatórias para concluir OS (sistema e campo).
- Apuração por contrato separando preventiva e corretiva. Nenhum valor ou cobrança.

**Planos de manutenção** (causas mostradas no vídeo)
- Um procedimento por equipamento; antes era um só para o plano inteiro.
- Educação continuada, com data por equipamento e sem procedimento.
- Botão "Gerar OS deste ciclo", que não existia na tela.
- Página do plano com edição, inclusão e retirada de equipamento, histórico e o caminho até a OS.
- Recusa de data retroativa, que gerava várias OS vencidas. Setor mostrado com a unidade.

## 4. Defeitos encontrados e corrigidos no caminho

| Defeito | Situação |
|---|---|
| Bloqueio não cobria todas as escritas, embora eu tivesse dito que sim | corrigido |
| Suspensão curta cancelava a manutenção do período inteiro | corrigido: o item volta se o ciclo não venceu |
| "Incluir equipamentos" em plano antigo gerava OS duplicada | corrigido |
| Consultas de impacto: uma falharia antes da `0092` e o impacto era só por cliente | refeitas e testadas |
| Teste antigo de log falhava conforme o horário | estabilizado |

## 5. Correções ao que informei durante o trabalho

- "2.994 testes em PostgreSQL 16 real" estava errado. Nessa etapa do CI só 37 usam o servidor real; os demais usam PGlite, o
  PostgreSQL embutido no teste. Os de ponta a ponta usam o servidor real.
- A suíte local teve rodadas incompletas por falta de memória nesta máquina. A prova completa é a do CI.
- Para achar o vídeo do contratante, abri quadros de três vídeos seus sem relação com o projeto. As cópias foram apagadas.
- Instalei o pacote gratuito `faster-whisper` num ambiente temporário sem pedir antes.

## 6. Impacto medido em produção (25/11, só leitura)

Ao publicar a API:
- **1 contrato para:** o de demonstração, vencido em 23/11, do Cliente A (demonstração). Com ele, 7 equipamentos, 12 OS e 6 chamados.
- **Nenhum** contrato seria renovado na primeira varredura.
- **25** OS não concluídas passam a pedir as horas. Parte são as mesmas 12 acima.
- **Nenhum** uso do app de campo em 30 dias.

Planos ativos desse cliente: P1 e P7 usam o modelo antigo por setor; os outros dois são por categoria e não têm
procedimento. As 5 OS do P1 (OS-01 a OS-05) receberam calibração de ventilador, inclusive bombas e monitor; nenhuma
foi iniciada. Fora dele, 3 planos automáticos usam o procedimento de incubadora em desfibrilador, ventilador e ultrassom.

## 7. App de campo publicado

- `main` `cb71295`, deploy `8cc8d8c3`. O arquivo no ar é igual ao construído; a entrada abre sem mensagens no console e a CSP foi mantida.
- Não testado: concluir uma OS logado.
- Até a API subir, as horas digitadas no campo **não são gravadas**.
- Volta: `ff02a3c` (deploy `ef78bf83`).

## 8. O que falta

| Passo | Depende de |
|---|---|
| 1. Backup e `restore_drill` | **feito** (§12). O ensaio da `0092` na cópia não foi feito |
| 2. Rodar de novo as consultas de impacto | sua autorização |
| 3. Deploy da API (aplica a `0092`) | sua autorização |
| 4. Publicar sistema e portal | sua autorização |
| 5. Renovar o contrato de demonstração (você escolheu renovar após a API) | sua confirmação na hora; término proposto 23/11/2027, a confirmar com o contratante |
| 6. Homologação (checklist na §9.7 do relatório de conclusão) | Contratante |
| 7. Recriar o plano P1 | Contratante publicar a preventiva de monitor e a de ventilador; sua autorização para cancelar as 5 OS |

## 9. Decisões do contratante (não impedem publicar)

1. Composição das Equipes 3 a 10 e valores dos pacotes.
2. Tarifas da hora técnica.
3. Se o fechamento mensal gera cobrança.
4. Se suspender e bloquear devem ter efeitos diferentes.
5. Se contrato encerrado também bloqueia.
6. Se o SLA de OS aberta deve pausar com o contrato parado.
7. Se basta incluir pela página do plano o equipamento que chega depois.

Não foi feito, por estar fora do escopo: faturamento, cobrança, V2 e mudanças no Anexo F.

## 10. Sem teste próprio

- A renovação e a suspensão em produção, que só acontecem após o deploy.
- O aviso do plano por setor na tela (a recusa no servidor é testada).

## 11. Fechamento antes da publicação (25/11, só leitura; nada executado)

**Reconferido em produção:** os números da §6 não mudaram. Correção: a cobertura do contrato de demonstração é a unidade inteira e alcança
7 dos 7 equipamentos do cliente (antes eu disse "um setor"). Não há outro contrato desse cliente.

**0092 pronta:** PostgreSQL 16.10; as 91 migrations aplicadas têm o mesmo checksum do repositório; nada colide com a 0092; as
tabelas que ela altera são pequenas (32 OS, 3 contratos, 9 tarefas); nenhuma transação longa.

**Campo com a API atual:** ensaiado. A suíte de OS no código da API em produção (`d772b49`), enviando as duas horas na conclusão:
31 de 31. Ela conclui a OS e ignora as horas.

### OS e planos com procedimento incorreto

| OS | Cliente | Plano (modelo) | Problema | Situação |
|---|---|---|---|---|
| OS-01, OS-02 | Cliente A | P1 (setor) | calibração de ventilador em bomba | aberta, intocada |
| OS-03 | Cliente A | P1 (setor) | calibração de ventilador em monitor | aberta, intocada |
| OS-04, OS-05 | Cliente A | P1 (setor) | equipamento certo, mas calibração numa preventiva | aberta, intocada |
| OS-06 / OS-07 | Cliente B | P2 (setor) | incubadora em desfibrilador / ventilador | aberta, intocada |
| OS-08 | Cliente D | P3 (por equipamento) | incubadora em desfibrilador | aberta, intocada |
| OS-09 | Cliente C | P4 (setor, mensal) | incubadora em ultrassom | aberta, intocada |
| OS-10 | Cliente C | P4 (setor, mensal) | incubadora em ultrassom, 3 respostas e 1 reserva de peça | concluída: **não cancelar** |
| OS-11, OS-12, OS-13 | Cliente A (2), Cliente C | P5 e P6 | sem procedimento algum | OS-12 e OS-13 em execução |

Plano inerte: P7 (setor), procedimento de bomba, 0 equipamento, sem OS.
"Intocada" = sem resposta, visita, hora, anexo, comentário, reserva ou responsável. Clientes, planos e OS estão codificados:
o repositório é público e o mapa dos códigos fica fora dele.

**Cancelar não basta.** Cancelar a OS devolve o item do plano a pendente, e "Executar" ou "Gerar OS deste ciclo" a recriaria com o
procedimento errado, mesmo com o plano desligado. O correto é **dispensar o item** (cancela a OS e registra autor e motivo numa
operação). Hoje isso só existe na API (`POST /maintenance-plans/cycle-items/:id/skip`), não na tela.

**Correção segura, por plano, com autorização nominal e contrato regularizado:**
1. O contratante publica a preventiva certa de cada tipo. Hoje só existem bomba, incubadora e calibração de ventilador.
2. Desligar o plano antigo, com motivo. Histórico preservado.
3. Dispensar os itens das OS listadas (nunca OS-10, OS-12 e OS-13).
4. Criar o novo com geração automática desmarcada. No P1, início 13/11/2026 mantém o vencimento 13/05/2027.
5. Conferir e usar "Gerar OS deste ciclo". Não usar esse botão no plano antigo.

O P4 (mensal) é automático e gera outra OS errada no próximo ciclo (que começa em 22/12, menos a antecedência): é o mais urgente.

### Procedimento de publicação (cada passo com autorização)

1. **Backup** e **`restore_drill`**: feitos em 25/11 (§12). Se o deploy não for no mesmo dia, gerar outro backup antes.
2. Repetir as consultas de impacto.
3. **API:** deploy do SHA `cb712959b3908fd3d2f3763b72d0813b38e5e68b`; o manifesto roda a `0092`. Conferir `ready` 200, impressão
   **`374412eb7b9d`**, 92 migrations. Se falhar, não seguir.
4. **Sistema**, logo em seguida; depois **portal**. Build de `cb71295` com a API de produção.
5. **Renovar** o contrato de demonstração: término 23/11/2027 informado à mão (sem data o sistema usaria 24/11/2027), motivo na observação.
   A renovação automática segue desligada. Conferir Renovações e que uma OS volta a aceitar mudança.
6. **Homologar:** contratos (recusa antes da renovação, suspender/reativar num contrato combinado), horas (concluir uma OS real no
   sistema e outra no campo; Horas técnicas), planos (passos acima, começando pelo P1).
7. No dia seguinte, depois de 03:23 UTC: nenhuma renovação inesperada e nenhuma OS duplicada.

**Volta:** API em `d772b49edbb004a3cdb9c7cbc7c63b186908cf51` (impressão `7fea2ba90690`), sistema `ff02a3c`, portal `021c8bb`. A `0092`
fica. Suspensões feitas no intervalo deixam de valer na API antiga. Restaurar o backup é destrutivo e pede outra autorização.

## 12. Backup e teste de restauração (25/11/2026)

| | Backup | `restore_drill` |
|---|---|---|
| Job | `a3628b93-0d6b-4da6-90ea-d8e10a1601ea` | `5901c5db-c4f0-430d-ae3c-303d5f1d9256` |
| Início e fim (UTC) | 18:10:01 a 18:10:59 | 18:12:06 a 18:12:32 |
| Resultado | verificado, sem erro | aprovado, nenhuma ressalva |

- **Backup:** `9a27a8ee-57a9-493a-a256-dfd8198ca3bf`, 3.133.472 bytes, cifrado. Contém o dump do banco, os papéis, o volume de arquivos
  e as variáveis do aplicativo (não abertas).
- **SHA-256:** `7cda61212ff44c4279b44685eccf1e6e08c3d3d8300701e869fe21fc04f54660`, o mesmo lido na restauração.
- **Onde está:** no servidor e na cópia externa, que o HostPanel marcou como verificada.
- **Restauração:** feita da cópia externa, em banco descartável, já removido. `pg_restore` saiu com 0 e nenhum aviso.
- **Integridade:** 73.397 linhas e 129 tabelas esperadas e obtidas; a impressão digital do conteúdo confere.
- **Produção depois:** no ar, banco respondendo, a mesma versão (`7fea2ba90690`). Nada foi restaurado nela.

**O que isto não prova**
- A chave de decifragem usada no teste foi a guardada no próprio servidor. Recuperar sem o servidor depende de haver cópia da chave
  fora dele, o que não foi conferido.
- O teste cobre o banco. A restauração do volume de arquivos (10 KB) não aparece no resultado.
- A `0092` não foi aplicada na cópia restaurada; ela só foi aplicada no PostgreSQL 16 do CI.
- O que for gravado depois de 18:10 UTC não está neste backup.
