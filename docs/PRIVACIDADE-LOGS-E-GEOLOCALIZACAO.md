# Privacidade — logs da API e geolocalização do check-in (OPS-07)

Estado em 30/10/2026. Descreve o que o código faz hoje; não é parecer jurídico.

## 1. Logs da API (`apps/api/src/common/logger.ts`)

O log estruturado (JSON de uma linha, correlacionado por `request_id`) **não leva dado pessoal
que não serve para depurar**:

| O quê | Como sai no log |
| --- | --- |
| Segredos (`authorization`, `password`, `secret`, `token`, `key`, `cookie`) | `[redacted]` |
| CPF, telefone/celular, registro profissional (CRM, CREA, COREN, CREFITO…), latitude/longitude/precisão/coordenadas | `[masked]` (pela chave do campo) |
| CPF escrito em texto livre (mensagem de erro, URL) | `***.***.***-**` |

As regras valem em objetos e listas aninhados. Ficam no log: identificadores opacos (uuid,
`request_id`), método, rota, código e situação HTTP. O corpo da requisição nunca é registrado.
Teste: `apps/api/src/__tests__/logger.test.ts`.

## 2. Geolocalização do check-in/check-out (`work_order_visits`, migration 0065)

**Minimização (o que já existe):**

- A posição é registrada **só em dois instantes** — check-in e check-out da OS. Não há
  rastreamento contínuo.
- Só quando o navegador a fornece com permissão da pessoa; recusada ou indisponível, o registro é
  **manual com justificativa** (sem coordenada).
- Guardam-se latitude/longitude com 6 casas e a precisão informada pelo aparelho; nada além.
- Isolamento por organização (RLS). A tabela é append-only para a aplicação (sem UPDATE/DELETE).
- Quem lê: quem tem `work_order.read` na OS (`GET /work-orders/:id/visits`).
- A trilha de auditoria (`audit_logs`) registra a inserção da visita, com os valores.

**Retenção: NÃO HÁ PRAZO DEFINIDO.** Hoje as coordenadas ficam guardadas enquanto a OS existir;
não há expurgo nem anonimização automáticos. O prazo de retenção (e se a coordenada deve ser
anonimizada depois de um período, mantendo só o "houve check-in") **depende de decisão do
controlador dos dados — o cliente** —, à luz da finalidade (comprovar presença no atendimento) e
de eventuais obrigações contratuais. Nenhum prazo legal foi presumido aqui.

**Pendências que dependem dessa decisão:** rotina de expurgo/anonimização após o prazo (incluindo
os valores copiados na trilha de auditoria) e o texto de transparência/consentimento exibido no
check-in.
