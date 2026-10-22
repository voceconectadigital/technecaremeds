# Adendo: conversa com o cliente (WhatsApp, 21/10/2026) × o que existe no código

**Fontes:** o texto colado da conversa (duas vezes: a segunda traz a mensagem completa) e os dois prints (a tela Store em produção e as mensagens das 12:27 às 12:37).
**Código conferido:** `main` depois dos PRs #36, #37 e #38, mais o PR dos pedidos da Store (fase 7) e do plano com IA em breve (fase 8).

São pedidos **novos, que não estavam na transcrição da reunião de 16/10**. O primeiro levantamento (21/10 à noite) mostrava todos como pendentes; este é o estado depois de implementados.

Legenda: **Feito** · **Parcial** · **Não feito**. "Feito" quer dizer que existe no código, com teste de banco, de API e/ou de navegador. Nenhum destes itens foi publicado em produção: o deploy continua à parte (ver o fim do documento).

| # | Pedido do cliente | Situação | Como ficou |
|---|---|---|---|
| N1 | Cadastro de ativo com **tag obrigatória** | Feito (PR #36) | a API recusa (422) o cadastro sem tag e a tela marca o campo como obrigatório. A edição segue opcional, para o parque já cadastrado |
| N2 | **QR code em cada ativo** | Feito (PR #37) | QR desenhado em SVG no navegador (`qrcode-generator`, MIT, sem dependências), com o endereço `/q/<token>`; ler com a câmera abre o equipamento no sistema (exige login). "Imprimir etiqueta" imprime só o cartão |
| N3 | Filtrar **ativo × cliente**; **ficha de vida** com indicadores pontuais | Feito (PR #36 e #37) | filtro de cliente na lista; a ficha traz OS, MTTR, MTBF e tempo parado do equipamento (as métricas do painel, com filtro de ativo), a barra de depreciação e o histórico |
| N4 | **Imprimir** a OS, a ficha e "em todos os lugares necessários" | Feito (PR #37) | botão **Imprimir** no cabeçalho de todas as telas (menos quadro e agenda), com folha de estilo de impressão: a navegação e os botões somem e o conteúdo flui. A OS imprime com o espaço da assinatura. Quem quer PDF escolhe "Salvar como PDF" no diálogo do sistema |
| N5 | **Avaliar e assinar a OS** (sempre avaliar antes, assinar automático) e **indicador de avaliação** | Feito (PR #37) | avaliar (1 a 5) e assinar acontecem no mesmo ato, por **OS**: só quem pediu o atendimento, só depois de concluída, uma vez. A assinatura é pela sessão autenticada (resumo do que foi assinado, e-mail, IP). Indicador `work_order_rating` no modelo Advanced |
| N6 | **Pendências ao entrar**: campo com todas as OS para avaliar/assinar | Feito (PR #37) | bloco no topo da tela Hoje e do início do portal. **Obrigar:** com pendência, o solicitante não abre chamado novo; a organização pode desligar (`settings.evaluationRequired = false`) e a equipe não é travada |
| N7 | **Laudo de obsolescência** como OS separada (OBC…), que desativa o equipamento com justificativa e fotos | Feito (PR #37) | botão na ficha do ativo gera uma OS `OBC-AAAA-NNNN` com a justificativa técnica (20+ caracteres). **Concluir exige ao menos uma foto**; **validar** descomissiona o equipamento. Gerar o laudo, sozinho, não desativa nada |
| N8 | Ativo com **valor do bem, nº da NF, data de aquisição, durabilidade** e **depreciação** com barra | Feito (PR #36 e #37) | os campos entram no cadastro (valor e NF só para quem tem permissão financeira); depreciação em linha reta calculada no servidor, com barra e valor contábil na ficha |
| N9 | **Registro ANVISA** no cadastro e **monitoramento** de notificações/proibição | **Parcial** (PR #36 e #37) | o campo está no cadastro; o cartão da ficha registra **a verificação feita por uma pessoa** (regular, alerta, uso proibido), com quem/quando e a descrição, e **avisa gestores e coordenadores** em alerta ou proibição. **O sistema ainda não consulta a ANVISA sozinho:** falta escolher a fonte oficial, a frequência e o limite de uso. Quando houver, grava nas mesmas colunas |
| N10 | **Store com compra**: comprar, acompanhar a entrega, anexar nota fiscal | Feito | a Store ganha as abas Catálogo e Pedidos; carrinho; pedido `PED-AAAA-NNNN` com o preço de lista do momento; a prestadora confirma com a previsão de entrega, despacha, entrega e anexa a NF (PDF/imagem); o cliente acompanha a linha do tempo e baixa a nota. **Sem pagamento** |
| N11 | Tópico **Qualidade** com os certificados de calibração, segurança elétrica, qualificação e treinamento | Feito (PR #38) | menu Qualidade com as quatro abas; cada certificado tem emissor, datas, validade **calculada** (vigente, vence em 30 dias, vencido) e o arquivo; os vencidos abrem a lista |
| N12 | **ONA** só como ferramenta de propaganda | Feito (PR #36) | cartão "ONA — Acreditação" em Ferramentas, marcado "em breve" (versão 2) |
| N13 | **Plano de manutenção com ajuda de IA** (ou manual) | **Parcial** | o assistente de novo plano mostra as duas opções: "Manualmente" ativa e "Com ajuda de IA" desabilitada, dita como "em breve". A IA ainda não existe |
| N14 | Estudar **Qualiex** e **SIGQUALI** para a V2 | Não feito | não pesquisei nada deles |

## O que continua dependendo de decisão
- **ANVISA (N9):** fonte oficial, frequência e limite de uso da consulta automática.
- **IA (N13):** casos de uso, provedor e regras de procedência.
- **E-mail:** o aviso de ANVISA, as pendências e o acompanhamento da Store entregam na caixa de entrada do sistema; o e-mail real segue na fila, sem provedor escolhido.
- **Senha inicial do usuário novo** (da reunião de 16/10): continua bloqueada por decisão de segurança.

## Publicação
Nada disto está em produção. A produção segue na versão de 15/10 no backend; as migrations 0060–0083 ainda não foram aplicadas no banco remoto. Publicar continua dependendo da sua ordem.
