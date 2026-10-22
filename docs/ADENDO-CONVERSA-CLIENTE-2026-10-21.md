# Adendo: conversa com o cliente (WhatsApp, 21/10/2026) × o que existe no código

**Fontes:** o texto colado da conversa (duas vezes: a segunda traz a mensagem completa) e os dois prints (a tela Store em produção e as mensagens das 12:27 às 12:37).
**Código conferido:** `main` em `96b5c03`.

São pedidos **novos, que não estavam na transcrição da reunião de 16/10**. Nenhum foi implementado ainda.

| # | Pedido do cliente | Situação | O que existe hoje |
|---|---|---|---|
| N1 | Cadastro de ativo com **tag obrigatória** | Não feito | a tag é opcional na tela (`ativos/formulario.tsx`) e no contrato (`tag` nullable em `assets.ts`) |
| N2 | **QR code em cada ativo** | Não feito | só o código da etiqueta aparece como texto e dá para vincular um QR existente; não há imagem de QR, e o código de `ativos/ficha.tsx` diz que o produto não tem engine de QR. O item 34 do levantamento anterior cobria só o vínculo |
| N3 | Ativos: filtrar **ativo × cliente** e abrir a **ficha de vida** de cada ativo, com indicadores pontuais do equipamento | Parcial | a lista filtra por situação, família, tipo, criticidade e chip, mas não por cliente (existe a árvore de locais). A ficha mostra o histórico de atendimentos, não achei indicadores por equipamento (MTTR, MTBF, disponibilidade) |
| N4 | **Imprimir** a OS, a ficha de vida e "em todos os lugares necessários" | Não feito | não há ação de imprimir na interface. A API só gera PDF de documentos (`documents/documento-pdf.ts`) |
| N5 | **Avaliação obrigatória e assinatura automática** da OS pelo solicitante, "sempre avaliar antes e depois assinar", e isso gera **indicador de avaliação das OS** | Parcial | existe nota de 1 a 5 do solicitante, mas por **solicitação** (`/portal/requests/:id/rating`), e o indicador de avaliação (média e distribuição) já sai dessa nota. Existe assinatura de OS (`POST /work-orders/:id/signatures`). Falta: avaliar por **OS**, tornar obrigatório, assinar automático depois da avaliação |
| N6 | **Pendências ao entrar**: um campo específico com todas as OS de qualquer tipo para avaliar e assinar | Não feito | não há lista de pendências do solicitante. A tela Hoje tem os painéis de espera que fizemos, mas não este |
| N7 | **Laudo de obsolescência** como uma OS separada, com numeração própria (ex.: `OBCxyz`), que desativa o equipamento com justificativa técnica e fotos | Parcial | existe o tipo de documento `obsolescence_report` e a migration 0056 (substituição de ativo, com o laudo explicando o porquê). Não é uma OS com numeração própria nem faz a baixa do equipamento direto da OS |
| N8 | Cadastro de ativo com **valor do bem, nº da nota fiscal de aquisição, data de aquisição e durabilidade**; **depreciação automática** com barra gráfica na ficha de vida | Parcial | o banco e a API têm valor de compra, valor residual (só para quem tem permissão de ver finanças), data de aquisição e vida útil em anos. Faltam: o **número da NF** (não existe o campo), o formulário de cadastro não oferece esses campos, e não há cálculo de depreciação nem barra |
| N9 | **Registro ANVISA** no cadastro e **monitoramento** de notificações e proibições de uso, com aviso por notificação | Parcial | o campo `anvisa_registration` existe no banco e na API, mas o formulário não o oferece. O monitoramento não existe e depende de uma fonte externa (consulta oficial à ANVISA, frequência, limites de uso). "Tempo real" não é uma promessa que eu possa assumir sem ver essa fonte |
| N10 | **Store com compra**: comprar, acompanhar data de entrega e anexar nota fiscal | Não feito | a Store atual é vitrine com **pedido de proposta, sem checkout** (decisão da rodada de 16/10). Não há pedido de compra, entrega nem anexo de NF. No print de produção a Store está vazia porque ninguém publicou itens |
| N11 | Tópico **Qualidade** com lugar para certificados de calibração, teste de segurança elétrica, qualificação e treinamento | Não feito | não há menu Qualidade. Existem tipos de documento de metrologia e a tela de documentos, mas não um espaço organizado por esses quatro tipos |
| N12 | **ONA** só como ferramenta de propaganda | Não feito | a palavra não aparece no produto. Cabe como mais um cartão "em breve" em Ferramentas |
| N13 | **Plano de manutenção com ajuda de IA** (ou manual) | Não feito | existe a criação manual. A IA em Ferramentas é só vitrine, sem funcionalidade |
| N14 | Estudar **Qualiex** e **SIGQUALI** para a V2 | Não estudado | não pesquisei nada deles |

## Sobre o que o cliente disse na conversa
- A ONA e a Qualidade ficam para a **V2**; para agora ele quer só o tópico Qualidade (N11) e a ONA como vitrine (N12).
- O cliente perguntou se as "adequações que os engenheiros pediram" terminaram. O que fechamos está em `docs/VALIDACAO-REUNIAO-2026-10-16.md`, mas a produção ainda não recebeu o backend novo.

## Ordem que eu sugiro
1. **Pequenos e sem decisão:** N1 (tag obrigatória), N12 (cartão ONA), filtro de cliente em Ativos (parte de N3) e os campos de valor, aquisição, vida útil e ANVISA no formulário (parte de N8 e N9).
2. **Médios:** N8 (NF, depreciação e barra), N4 (imprimir), indicadores por ativo (resto de N3), N2 (imagem de QR, que pede uma biblioteca de QR).
3. **Pedem decisão sua ou do cliente:**
   - N5 e N6: avaliação e assinatura obrigatórias mudam o fluxo da OS. É preciso decidir quando a OS "fecha" (o solicitante que não avalia trava o fechamento?).
   - N7: OS de obsolescência com numeração própria.
   - N9: a fonte do monitoramento da ANVISA.
   - N10: Store com compra e entrega.
   - N11 e N13.
