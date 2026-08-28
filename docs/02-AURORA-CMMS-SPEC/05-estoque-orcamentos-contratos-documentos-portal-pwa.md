<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 6 de 13 — seções 15 a 20
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 15. Estoque

Falta de peça é a maior causa de OS travada — 789 registros na referência. O estoque não é módulo acessório: é o desbloqueador do fluxo principal.

### Modelo

```

inventory_item   sku · nome · categoria · unidade · fabricante · código do fabricante
                   modelo · imagem · tracking ∈ none | lot | serial
                   is_stockable · min_qty (por almoxarifado) · lead_time_days
   │
   ├── customer_item_alias   nomenclatura e preço de venda por cliente  (herdado da referência)
   │
   ├── stock_lot       almoxarifado · lote · NF · fornecedor · validade · custo unitário · qty_on_hand
   │
   ├── stock_balance   projeção materializada: item × almoxarifado → on_hand · reserved · available
   │
   └── stock_movement  livro-razão imutável
             kind ∈ receipt | issue | adjustment | transfer_out | transfer_in
                    | consumption | return | scrap
             qty (com sinal) · lot_id · unit_cost
             ref_type/ref_id (work_order · quote · transfer · count)
             actor · reason · created_at

```

### Almoxarifados

Novo em relação à referência, que segrega estoque apenas por "Quadro de trabalho". `warehouse.kind` ∈ `central` · `satellite` (posto avançado no hospital) · `van` (carro do técnico) · `consignment` (consignado do fornecedor). O carro do técnico como almoxarifado é o que permite apontar consumo em campo com saldo correto.

### Regras

| Regra | Comportamento |
| --- | --- |
| **Saldo negativo** | Proibido por padrão. `warehouse.allow_negative` pode liberar, e cada movimento que gere negativo exige justificativa e emite `stock.negative_balance` |
| **Reserva** | Reservar em uma OS reduz `available` e não `on_hand`. Cancelar a OS libera a reserva automaticamente |
| **Consumo** | Ocorre na conclusão da OS ou no apontamento do técnico, gerando movimento com `ref = work_order` |
| **Custo** | Média móvel ponderada por almoxarifado. FIFO por lote quando `tracking = lot`. O custo do movimento é congelado no momento da saída |
| **Devolução** | Peça não usada volta ao lote de origem quando rastreado; senão, entra como ajuste positivo com referência à OS |
| **Estoque mínimo** | Por item × almoxarifado. Cruzar o mínimo emite `stock.below_minimum` — evento consumido por automação, não uma "automação" fixa como na referência |
| **Inventário cíclico** | `stock_counts` com contagem às cegas, divergência calculada e ajuste em lote com aprovação. **Fase 3** |
| **Nunca excluir movimento** | Correção é sempre um movimento inverso com referência ao original |

---

## 16. Orçamentos

### Máquina de estados

```

 draft ──→ sent ──→ viewed ──┬──→ approved ──→ in_execution ──→ invoiced ──→ closed
   │           │           │      │
   │           │           │      ├──→ rejected   (motivo obrigatório · terminal)
   │           │           │      └──→ expired    (automático em valid_until · terminal)
   │           │           │
   │           └───────────┴──→ revised ──→ nova versão em draft
   │                             (a versão anterior fica superseded)
   └──→ cancelled

```

| Transição | Guarda | Permissão | Efeitos |
| --- | --- | --- | --- |
| draft → sent | ≥ 1 item, `valid_until` preenchido, total > 0 | `quote.send` | Gera PDF versionado; notifica contato do cliente; OS → `waiting` / `quote_approval`; evento `quote.sent` |
| sent → viewed | — | automático | Registra quem abriu e quando; evento `quote.viewed` |
| viewed → approved | Aprovador com permissão no portal; aceite registrado com IP e carimbo | `quote.approve` | Reserva peças; OS volta a `in_progress`; evento `quote.approved` |
| viewed → rejected | `rejection_reason_id` obrigatório | `quote.approve` | OS → decisão do coordenador; evento `quote.rejected` (alimenta análise de perda) |
| * → revised | — | `quote.update` | Cria versão N+1 em `draft`; a anterior vira `superseded`; **exige nova aprovação** |
| approved → invoiced | Itens de peça conferidos | `quote.invoice` | Debita estoque dos lotes selecionados; grava `invoiced_at`; evento `quote.invoiced` |

### Estrutura

- **Cabeçalho:** número (série própria), versão, cliente, contato aprovador, OS de origem, natureza (`parts` · `services` · `parts_and_services`), validade, moeda, condição de pagamento, observações ao cliente, observações internas.
- **Itens:** tipo (`part` | `service`), referência, descrição, quantidade, unidade, preço unitário, desconto de linha, total, garantia em dias, prazo de entrega. Peça pode indicar lote e fornecedor.
- **Totais:** subtotal, desconto geral (valor ou %), acréscimos, impostos, total. **Ausente na referência**
- **Preço:** resolvido pela cascata `customer_item_alias` → `price_list` do contrato → catálogo padrão.
- **Versionamento real** em vez do "Modificar" destrutivo da referência: o histórico de propostas é argumento comercial.

---

## 17. Contratos

Na referência, contrato é cadastro documental (nome, apelido, contratante, datas). Aqui é o instrumento que governa SLA, escopo, preço e medição — e é o que sustenta a renovação.

| Bloco | Conteúdo |
| --- | --- |
| **Identificação** | número, cliente, tipo (`full_service` · `preventive_only` · `on_demand` · `rental` · `loan` · `warranty`), vigência, renovação automática, aviso prévio, índice de reajuste, documento anexo |
| **Escopo** | `contract_coverage`: expressão de ativos cobertos (por cliente, subárvore de local, categoria ou lista). Um ativo pode estar em um contrato por vez em uma dada data — regra validada na criação |
| **Serviços incluídos** | Naturezas de OS cobertas; o que é faturado à parte |
| **SLA** | `sla_policy_id`; opcionalmente política diferente por criticidade de ativo |
| **Comercial** | Modelo (`fixed_monthly` · `per_asset` · `per_call` · `hybrid`), valor, tabela de preço, franquias (N chamados/mês, N horas/mês incluídas), excedente |
| **Medição** | `billing_period` mensal: OS executadas, horas, peças, conformidade de plano, SLA cumprido, franquia consumida, excedente a faturar |
| **Penalidade** | Regra de glosa por SLA violado (registrada, calculada, nunca aplicada automaticamente) |

**Alertas:** vencimento em 90/60/30 dias, franquia consumida acima de 80 %, SLA do mês abaixo da meta, conformidade de plano abaixo do contratado.

---

## 18. Documentos — motor único

A referência tem seis módulos documentais separados (calibração, rascunho de calibração, certificado de padrão, TSE, laudo de obsolescência, qualificação térmica) com estrutura 90 % comum. Um motor único com tipos elimina cinco implementações e torna trivial adicionar o sétimo tipo.

### Núcleo comum

```

document_type   chave · rótulo · série de numeração · template · validade padrão
                  campos obrigatórios · exige responsável técnico · exige assinatura
                  módulo de dados especializado (opcional)
   │
   └── document   number · version · status · asset_id · work_order_id · customer_id
             issued_at · valid_until · issued_by · technical_manager_id
             verdict ∈ conforme | não conforme | conforme com restrição | n/a
             released_to_customer_at · pdf_key · content_hash
             └── document_signature  signatário · papel · método · carimbo · hash
             └── document_payload    dados específicos do tipo (jsonb validado por schema)

```

### Ciclo de vida

```

draft ──→ under_review ──→ issued ──→ released ──→ expired
   │                            │           │
   │                            └──→ cancelled  (com motivo, mantém o número queimado)
   └──→ superseded  (substituído por versão nova; o antigo permanece acessível)

```

### Tipos previstos

| Tipo | Payload especializado | Regras próprias | Fase |
| --- | --- | --- | --- |
| `work_order_report` | — | Relatório da OS; o único do MVP | MVP |
| `calibration_certificate` | condições ambientais, pontos de medição, padrões, incertezas, fator k, critério de aceitação, correção de erro sistemático | **Bloqueia emissão se algum padrão estiver com certificado vencido na data da medição.** Liberação ao cliente manual ou automática | Fase 2 |
| `electrical_safety_test` | correntes de fuga, resistência de aterramento, classe do equipamento, limites da norma | Veredito automático contra limites; aceita importação de analisador | Fase 2 |
| `standard_certificate` | laboratório externo, incerteza, faixa, rastreabilidade | Fecha a cadeia metrológica; alimenta o bloqueio acima | Fase 2 |
| `obsolescence_report` | motivo, parecer técnico, valor de reparo × valor do bem, fundamentação legal | Exige responsável técnico com registro profissional; muda situação do ativo | Fase 3 |
| `thermal_qualification` | sensores, curvas, distribuição térmica | Geração assíncrona do PDF (a referência leva até 1 h) | Fase 3 |

### Numeração

`number_series`: escopo (organização ou cliente), tipo de documento, prefixo, sufixo, padrão (`{prefix}{YYYY}{seq:6}`), próximo valor, reinício anual, ativo. Alocação transacional com *advisory lock*. Números emitidos **nunca** são reaproveitados; documento cancelado mantém o número queimado com o motivo — requisito de auditoria.

### Assinatura

| Método | Como funciona | Prova |
| --- | --- | --- |
| `drawn` | Assinatura no dedo, coletada no PWA | Imagem + nome + documento + carimbo + hash do conteúdo |
| `email_code` | Código de 6 dígitos enviado por e-mail e validado | Código, e-mail, IP, carimbo, hash |
| `portal` | Aceite explícito por usuário autenticado do portal | Usuário, sessão, IP, carimbo, hash |
| `icp_brasil` | Certificado digital | **Futuro** — modelar campos desde já |

O `content_hash` é calculado sobre o payload canônico antes da assinatura. Qualquer alteração posterior invalida a assinatura e exige nova versão do documento — não há edição silenciosa de documento assinado.

---

## 19. Portal do cliente

Na referência o portal é um conjunto de 21 permissões sobre as mesmas telas internas. Aqui é uma aplicação própria, com navegação, vocabulário e densidade próprios — e uma superfície de escrita mínima.

### Princípios

1. **O portal só escreve em três lugares:** `service_requests`, `quote_approvals` e `signatures`. Todo o resto é leitura.
2. **Nada interno vaza.** `internal_notes`, custos internos, margem, nome de fornecedor, outros clientes e comentários com `visibility = internal` são filtrados na camada de consulta, não escondidos na interface.
3. **Escopo por local.** A enfermeira da UTI II vê a UTI II. A gerência vê o hospital inteiro. Mesmo produto, escopos diferentes.
4. **Mobile primeiro.** A abertura de chamado precisa funcionar em 30 segundos, em pé, no corredor.

### Telas

| Tela | Conteúdo | Permissão |
| --- | --- | --- |
| **Início** | Minhas solicitações abertas, ações pendentes (assinar, aprovar orçamento, avaliar), próximas visitas programadas, alertas de vencimento | base |
| **Abrir solicitação** | Fluxo de 3 passos: equipamento (busca, QR ou lista do meu setor) → o que houve (sintomas contextuais + texto + foto) → confirmar. Detecção de duplicidade no envio | `request.create` |
| **Minhas solicitações** | Lista com situação em linguagem do cliente ("Recebido", "Técnico a caminho", "Aguardando sua aprovação"), não com o vocabulário interno | `request.read` |
| **Detalhe da solicitação** | Linha do tempo, OS vinculadas, comentários com `visibility = customer`, anexos públicos, ação de assinar | `request.read` |
| **Meus equipamentos** | Inventário do escopo, com situação, próxima manutenção, certificados válidos e histórico resumido | `asset.read` |
| **Documentos** | Certificados e laudos liberados, filtráveis por ativo e por validade; download em lote | `document.read` |
| **Orçamentos** | Pendentes de decisão em destaque; aprovar ou reprovar com motivo | `quote.approve` |
| **Agenda** | Visitas programadas no meu escopo, com janela e natureza | `schedule.read` |
| **Indicadores** | Disponibilidade do parque, conformidade do plano, SLA cumprido, chamados por setor, satisfação — apenas do escopo | `insight.read` |

### Tradução de vocabulário

| Interno | No portal |
| --- | --- |
| `submitted` / `triage` | Recebido |
| `accepted` + OS `scheduled` | Agendado para {data} |
| OS `in_progress` | Em atendimento |
| OS `waiting` / `parts` | Aguardando peça |
| OS `waiting` / `quote_approval` | **Aguardando sua aprovação** — com botão |
| OS `waiting` / `customer_response` | **Aguardando você** — com o que falta |
| `completed` / `validated` | Concluído |
| `rejected` | Não procede — com a justificativa |

O mapeamento é **dado** (`work_order_status.customer_label`), não código. Uma organização pode ajustar a linguagem que seus clientes veem sem tocar na máquina de estados.

---

## 20. PWA do técnico

O técnico é o usuário mais frequente e o menos servido. Aqui ele tem um aplicativo desenhado para uma mão, luvas, pressa e ausência de rede.

### Escopo funcional

| Tela | Função | Offline |
| --- | --- | --- |
| **Hoje** | Agenda do dia em cartões ordenados por horário e proximidade; contador de pendências de sincronização | total |
| **Minhas OS** | Atribuídas a mim ou à minha equipe, agrupadas por situação | total |
| **Ler QR** | Câmera → ativo → abrir OS existente ou criar nova | total (resolve no cache local) |
| **Execução da OS** | Iniciar · checklist · fotos antes/depois · peças · horas · diagnóstico · resolução · concluir | total |
| **Assinatura** | Coleta no dedo, com nome e documento do signatário | total |
| **Ficha do ativo** | Dados, histórico recente, documentos, manual do modelo | parcial (últimas 10 OS + documentos marcados) |
| **Novo ativo** | Cadastro em campo com foto e QR; entra como `unverified` | total |
| **Nova solicitação/OS** | Registro de demanda encontrada em campo | total |

### O que precisa estar no dispositivo

| Dado | Volume estimado | Política de sincronização |
| --- | --- | --- |
| OS atribuídas (próximos 7 dias + abertas) | dezenas | Completa, com todas as coleções filhas |
| Ativos referenciados por essas OS + ativos dos locais do dia | centenas | Campos de identificação e ficha resumida |
| Templates de checklist dos procedimentos aplicáveis | dezenas | Versão publicada, íntegra |
| Catálogos (naturezas, situações, motivos, códigos de falha, unidades) | pequeno | Completo, com *ETag* |
| Itens de estoque do almoxarifado do técnico | centenas | Saldo indicativo — a confirmação é no servidor |
| Locais do escopo | centenas | Árvore podada ao escopo |
| Fotos capturadas | grande | Fila de saída, com compressão e upload retomável |

### Sincronização e conflito

- **Outbox transacional.** Cada ação offline vira um comando com `client_operation_id` (UUID). O servidor é idempotente por esse id — reenviar nunca duplica.
- **Ordem garantida por OS.** Comandos da mesma OS são aplicados em sequência; comandos de OS diferentes podem ir em paralelo.
- **Resolução de conflito explícita e visível.** Se o estado mudou no servidor de forma incompatível (a OS foi cancelada enquanto o técnico executava), o comando falha, o registro entra em "Precisa da sua atenção" e o técnico vê o que aconteceu e o que fazer. **Nunca descartar trabalho em silêncio** — o pior defeito possível neste produto.
- **Campos de texto** usam última escrita vence, com o valor descartado preservado no histórico.
- **Numeração** nunca é gerada no cliente. OS criada offline recebe um identificador temporário e o número definitivo na sincronização.
- **Consumo de estoque** é sempre confirmado no servidor; o saldo local é indicativo e o técnico é avisado se a peça acabou.
