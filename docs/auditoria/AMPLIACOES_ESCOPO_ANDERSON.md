# Ampliações de escopo — uso interno

**Reservado.** Documento interno da Conecta Digital sobre pedidos do cliente (Anderson) que pedem decisão comercial, dado do cliente ou infraestrutura antes de virar código. **Não contém valores** e não deve ser enviado ao cliente como está.

**Base:** reunião de 16/10/2026, WhatsApp de 16 a 29/10/2026 e a auditoria de 29/10/2026 (`docs/auditoria/technecare-status-requisitos.json`).

## Como ler

- **Exige aprovação comercial:** é trabalho novo, além do que a fase atual descreve. Antes de fazer, combinar escopo e prazo por escrito.
- **Depende do cliente:** o código está pronto para receber, mas falta um dado ou uma decisão que só o cliente tem.
- **Depende de infraestrutura:** falta contratar ou configurar um serviço externo.

## 1. Exigem aprovação comercial

| ID | Pedido | Por que é ampliação | Esforço estimado |
|---|---|---|---|
| ATF-01 | Monitorar a ANVISA sozinho, com IA e internet | Integração com fonte oficial, rotina agendada e regra de alerta. Hoje a verificação é feita por uma pessoa e o sistema avisa os gestores. | médio (fonte oficial + agendamento + testes) |
| ATF-02 / FER (IA) | Criar plano de manutenção com IA | Provedor de IA, custo por uso, regras de revisão técnica e responsabilidade. A tela já mostra "Com ajuda de IA — em breve". | médio a grande |
| ATF-03, FUT-01…05 | Leitura real de chips, sensores, gases, CME, analisadores e energia | Hardware, gateway, protocolo de cada fabricante e calibração. A vitrine em Ferramentas está pronta e não mostra dado. | grande, por ferramenta |
| V2Q-01…13 | Gestão da qualidade completa (matrizes, ONA operacional, tarefas com cronômetro, checklists ONA) | Encaminhado para a V2 em 20/10 (resposta das 9h03). Nesta fase ficou o tópico Qualidade com certificados e a ONA como vitrine. | grande |
| TEN-02 / TEN-04 | Domínio próprio por cliente e ciclo de vida do negócio (suspender, limitar, revogar) | O negócio novo é criado com marca e isolamento; o domínio fica "aguardando DNS" e não há suspensão. Domínio por cliente exige DNS e certificado. | médio |
| COM-01 | Cobrança por usuário e hospedagem centralizada | Modelo comercial registrado; não há especificação de cobrança. Não implementar sem contrato. | — (decisão) |
| REL-06 | Expert com 17+ indicadores em tempo real | O catálogo tem 17 indicadores previstos, mas só 2 têm fórmula no sistema. Os outros 15 dependem das fórmulas do cliente (P-01…P-16). Escrever "17+ em tempo real" hoje seria propaganda falsa. | médio, depois das fórmulas |

## 2. Dependem do cliente

| ID | O que falta | Situação no sistema |
|---|---|---|
| OPS-10, REL-04, REL-05, REL-06, REL-17 | As fórmulas prometidas em 22/10 ("Já te mando as fórmulas") não chegaram até 29/10 | Indicadores sem fórmula aparecem como "pendente de definição"; nada é inventado |
| USR-11 | Quais campos exigem aprovação de engenheiro ou gestor | O controle por perfil já vale na API; falta a lista de campos |
| OS-23 | Se a assinatura por sessão (clique do próprio solicitante, com resumo, e-mail, IP e hora) basta, ou se precisa de certificado ICP-Brasil | A assinatura por sessão está pronta; ICP-Brasil seria ampliação |
| SIGQUALI | Nome do fabricante para o estudo | Qualiex estudado em fonte aberta (`docs/ESTUDO-QUALIEX-SIGQUALI.md`) |
| OS-03 | Confirmar o padrão "hospital próprio = sem orçamento" | Implementado assim (dá para ligar por organização) |
| OPS-07 | Prazo de retenção da geolocalização do check-in (o cliente é o controlador) | Sem prazo definido, não há expurgo automático |
| ATV-04 | Corrigir tags repetidas antigas, se houver | Ficam marcadas e fora do índice único, sem perda de dado |
| AUT-05 | Quais indicadores vão ao "financeiro" | O recorte por contrato já vale nos agendados |
| Quadro de OS | O que a seta verde da foto de 29/10 aponta na coluna "Agendada" | A coluna rola por dentro, de propósito; mudar sem saber o pedido seria chute |

## 3. Dependem de infraestrutura

| ID | O que falta |
|---|---|
| ORC-03, AUT-02, AUT-03, AUT-05 | Provedor de e-mail. Hoje os avisos entregam na caixa de entrada do sistema e o e-mail fica na fila, sem simular envio |
| USR-02 | Primeiro acesso do usuário adicionado: depende do e-mail (convite com link) ou de liberar a definição de senha pela API, que hoje é negada de propósito |
| OPS-05 | Domínio "htec.b" não existe; VPS definitiva não escolhida |
| Publicação | Esta rodada (migrations 0084–0089 e o front) só vai para produção com ordem expressa e o backup antes |
