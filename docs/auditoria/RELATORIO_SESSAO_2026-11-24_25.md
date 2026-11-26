# Téchne Care — relatório da demanda de 24 e 25/11/2026

Respostas do contratante (D-1 a D-7) e correção do assistente de planos. Detalhe técnico e matriz por resposta:
`RELATORIO_CONCLUSAO_ANDERSON_2026-11-24.md`.

## 1. Onde estamos

| Item | Situação em 25/11 |
|---|---|
| Código | PR #57 **mesclada** em `main` (`cb71295`), 88 arquivos |
| CI do commit mesclado (`751038d`) | verde: 3.006 de 3.006 testes; 240 de ponta a ponta (1 pulado) |
| App de campo | **publicado** em produção |
| API | **publicada** em 25/11, impressão `374412eb7b9d` (§14) |
| Sistema e portal | **não publicados** |
| Migration `0091` | aplicada em 23/11, conferida no banco |
| Migration `0092` | **aplicada** em 25/11, 19:22:36 UTC (§14) |
| Backup e `restore_drill` | **feitos e aprovados em 25/11** (§12) |
| Dados de produção | nenhum alterado; só leituras autorizadas e um backup |

O app de campo e a API já mudaram. As telas novas entram quando o sistema e o portal forem publicados.

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
| 1. Backup e `restore_drill` | **feito** (§12) |
| 2. Rodar de novo as consultas de impacto | **feito** (§13) |
| 3. Deploy da API (aplica a `0092`) | **feito** (§14) |
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
2. Consultas de impacto: repetidas em 25/11 (§13).
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
- A chave usada no teste foi a guardada no próprio servidor. Sobre a cópia fora dele, ver §13.
- O teste cobre o banco. A restauração do volume de arquivos (10 KB) não aparece no resultado.
- A `0092` não foi aplicada na cópia restaurada. O ensaio equivalente está na §13.
- O que for gravado depois de 18:10 UTC não está neste backup.

## 13. Consultas repetidas, chave do backup e ensaio da 0092 (25/11/2026, 18:21 UTC)

### Impacto em produção (só leitura, transação READ ONLY)

Dados idênticos aos da auditoria de 25/11, linha a linha.

| O que muda ao publicar a API | Auditoria | Agora |
|---|---|---|
| Contratos que param | 1 (Cliente A, vencido em 23/11, sem renovação automática, sem outro válido) | 1, o mesmo |
| Equipamentos só para consulta | 7 | 7 |
| OS só para consulta | 12 (2 em execução, nenhum cronômetro aberto) | 12 |
| Solicitações só para consulta | 6 | 6 |
| Planos ativos que não geram OS até regularizar | 4 (2 automáticos: P1 e P7) | 4 |
| Renovações na primeira varredura | 0 | 0 |
| Contratos que vencem em 60 dias | 0 | 0 |
| OS que passam a pedir as horas | 25 | 25 |
| Operações do app de campo em 30 dias | 0 | 0 |
| Contratos com Equipe Fixa 3 a 10 | 0 | 0 |

Migrations: 91, última `0091`, índices válidos; `0092` ausente.

### Chave do backup

- O job do backup registrou a chave como guardada também fora do servidor (`keyEscrowed: true`), e o servidor tem o comprovante do
  depósito dessa mesma chave. Nenhum conteúdo de chave foi lido ou copiado.
- **Não provado:** decifrar este backup usando só essa cópia. O `restore_drill` deste tipo de aplicação usa a chave local quando
  ela existe, e não tem a opção de exigir a cópia.
- A documentação do HostPanel registra que a cadeia de recuperação externa já foi testada, mas não com esta chave.
- **Solução:** acrescentar no HostPanel a opção de exigir a cópia no drill e rodá-lo uma vez. Não impede publicar: se o deploy der
  errado, o servidor e a chave local continuam lá.

### Ensaio da 0092

A cópia restaurada é apagada pelo HostPanel ao fim do drill, e não há ambiente isolado autorizado a receber dados de produção.
Ensaiei num PostgreSQL **16.10** local e descartável, já removido, só com a massa fictícia do repositório e um contrato vencido como
o de produção. O banco partiu da `0091`, com os **91 checksums iguais aos de produção**.

| Conferência | Resultado |
|---|---|
| Aplicação com o código de `cb71295` | 1 aplicada, 91 já presentes |
| Dados existentes (116 tabelas, 2.316 linhas) | impressão idêntica antes e depois |
| Segunda execução | nada a aplicar |
| As 3 restrições novas, RLS do histórico de renovações | validadas; isolamento ativo; a aplicação não altera o histórico |
| Equipamentos bloqueados: regra nova e consulta de impacto | 7 e 7 |
| Contratos retidos ou renovados pela migration | nenhum |
| Tempo do SQL da `0092` | 41 ms |
| `migrate` da versão antiga no banco já migrado (volta) | aceito, nada a fazer |

Não é a cópia real: produção tem mais linhas (73 mil), mas as tabelas alteradas são pequenas (32 OS, 3 contratos, 9 tarefas).

### Riscos novos

| Risco | Solução |
|---|---|
| Numa pasta do Windows, parte das migrations fica com outro fim de linha, e o `migrate` a partir dela é recusado por checksum | Não afeta o deploy, que sai do git. Nunca rodar `migrate` de produção desta máquina; fixar `*.sql eol=lf` no `.gitattributes` |
| Os comandos de massa (homologação e demonstração) estão desatualizados: não preenchem o parecer do equipamento, hoje obrigatório. O de homologação para com erro; o de demonstração deixa OS sem concluir | Não afeta produção. Ajustar antes da próxima homologação com massa |
| Prova da cópia da chave (acima) | Ver acima |

### Conclusão

Apto para a publicação controlada da API (`cb712959b3908fd3d2f3763b72d0813b38e5e68b`), com autorização própria. Se for em outro dia,
gerar backup e repetir as consultas. Ao subir a API, o Cliente A fica só para consulta até a renovação combinada.

## 14. Deploy da API (25/11/2026)

Antes: backup do dia íntegro e com drill aprovado, nenhum registro criado ou alterado desde ele e impacto idêntico.

| Item | Resultado |
|---|---|
| Job | `53b72851-c43a-4849-bfc3-c67a89deccfe`, sucesso, 19:18:57 a 19:23:06 UTC |
| Commit | `cb712959b3908fd3d2f3763b72d0813b38e5e68b` |
| Migration `0092` | aplicada às 19:22:36 UTC, checksum igual ao do repositório; etapa completa de migração em 4,2 s |
| Migrations | 92 |
| Health | `ready` 200, banco ok |
| Impressão | `374412eb7b9d`, a esperada |
| API e workers | em execução, sem reinício e sem erro nos logs; jobs concluindo. Banco sem erro |
| Dados existentes | 116 tabelas com conteúdo idêntico antes e depois |
| Retenções, renovações e horas criadas | nenhuma |
| Bloqueio no banco de produção | 7 equipamentos e 12 OS do Cliente A (vencido); os outros 8 equipamentos livres |
| Sistema, portal e campo | respondem 200; rota protegida sem login responde 401 |

A recusa pela API não foi exercitada com login em produção, porque isso exigiria tentar uma escrita. Ela é coberta pelos testes do
mesmo commit.

**Até publicar o sistema:** a tela atual não tem os campos de hora e a API passou a exigi-los, então **concluir OS pelo sistema é
recusado para todos os clientes**. O app de campo já tem os campos. No Cliente A, as escritas de atendimento ficam recusadas até a renovação.

**Retorno:** imagem anterior `00a01c8cb505` preservada no servidor (impressão `7fea2ba90690`). Voltar é um novo deploy de
`d772b49edbb004a3cdb9c7cbc7c63b186908cf51`; a `0092` fica. Backup `9a27a8ee…` preservado.

## 15. Publicação do sistema e do portal (25/11/2026)

Compilados de `cb712959` com a API de produção; a impressão do commit (`374412eb7b9d`) é a mesma da API no ar.

| | Sistema | Portal |
|---|---|---|
| Deploy (Cloudflare Pages) | `8c46c89e` | `506abd79` |
| Arquivo principal no ar | `index-BSAbADB0.js` | `index-DL1f50Ze.js` |
| Página | 200; tela de entrada carrega | 200; tela de entrada carrega |
| CSP | bloqueante, sem violações no console | bloqueante, sem violações no console |

- O sistema agora envia as horas de início e término: **concluir OS pelo sistema volta a funcionar** (exceto no Cliente A até a renovação).
- API depois: `ready` 200, mesma impressão, rota protegida 401, CORS do sistema 204. Campo segue em `cb71295`.
- Não verificado com login em produção: a tela de conclusão com os campos de hora e o aviso de bloqueio. Ambos estão no build publicado e
  cobertos pelos testes do mesmo commit.
- Observação anterior a esta rodada: a tela de entrada do portal mostra um aviso de "ambiente de desenvolvimento" (já estava em `021c8bb`).
  A API recusa esse modo fora de desenvolvimento, mas o texto não deveria aparecer em produção.

**Retorno:** recompilar e publicar `ff02a3c` no sistema (deploy anterior `813eafb8`, `index-Bf9fp0AT.js`) e `021c8bb` no portal
(`e4564a32`, `index-CBnkkRzW.js`). Voltar o sistema sem voltar a API faz a conclusão de OS ser recusada de novo.

## 16. Renovação do contrato de demonstração (26/11/2026)

Feita pela tela do sistema (ficha do contrato → **Renovar**), com o novo término informado e uma única confirmação. Sessão aberta
pelo contratante; nenhuma senha digitada pelo assistente.

| | Antes | Depois |
|---|---|---|
| Situação | Expirado ("somente consulta") | Vigente |
| Vigência | 23/11/2025 → 23/11/2026 | 23/11/2025 → 23/11/2027 |
| Histórico de renovações | nenhuma | 1: de 23/11/2026 para 23/11/2027, manual, 26/11/2026 |

- O aviso de bloqueio sumiu da ficha do contrato, da ficha do Cliente A e das OS dele; os 7 equipamentos seguem cobertos.
- O término foi informado à mão. Sem ele, o prazo original (23/11/2025 a 23/11/2026, 366 dias) daria 24/11/2027.
- Nenhuma outra alteração: OS, planos, datas e demais contratos intocados. As OS e planos a corrigir (§§ anteriores) continuam pendentes.
- Não verificado: concluir uma OS com as horas, porque exigiria gravar em OS real.
