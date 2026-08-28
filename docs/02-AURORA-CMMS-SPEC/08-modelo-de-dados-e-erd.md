<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1
     Parte 9 de 13 — seções 32 a 33
     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->

## 32. Modelo de dados

Convenções obrigatórias, aplicadas sem exceção: chave primária `uuid v7`; `organization_id` em toda tabela de negócio; `created_at`, `updated_at`, `created_by`, `updated_by` em toda tabela; `deleted_at` onde a coluna "Soft" indicar; *timestamps* em `timestamptz`; dinheiro em `numeric(14,2)` com `currency`; toda enumeração de negócio configurável é tabela, não `enum` de banco; toda enumeração estrutural (categorias de situação, tipos de movimento) é `enum` de banco.

#### Legenda

**T** = tenant-scoped (`organization_id` obrigatório) · **S** = soft delete · **H** = histórico/auditoria com diff · **A** = append-only (sem update nem delete)

### PLATFORM

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `users` | Identidade global | email, name, avatar_key, locale, timezone, phone, status, last_seen_at, mfa_enabled | 1:N memberships | `email` único global (citext) | — S H |
| `organizations` | Tenant | name, slug, tax_id, logo_key, locale, timezone, asset_label, plan, seat_limit, settings jsonb, status | 1:N tudo | `slug` único global | — S H |
| `memberships` | Vínculo usuário × organização | seat_type(staff\|portal), status, job_title, hourly_cost, daily_hours, council, registration_no, signature_key, on_vacation, invited_at, joined_at | N:1 user, N:1 organization, N:N roles | único (organization_id, user_id); `hourly_cost` só para staff | T S H |
| `membership_scopes` | Escopo de dados do vínculo | customer_scope, customer_ids[], location_paths[], assignment_scope, warehouse_ids[] | 1:1 membership | — | T — H |
| `membership_accessible_locations` | Escopo materializado | membership_id, location_id | N:N | Recalculado por trigger | T — — |
| `roles` | Papel | key, name, description, is_system, is_default_for | N:N permissions | `is_system` imutável; nome único por org | T S H |
| `permissions` | Catálogo de permissões | key, resource, action, description, is_field_level | — | Global, seed da plataforma | — — — |
| `role_permissions` | Ligação | role_id, permission_id | N:N | — | T — H |
| `membership_roles` | Papéis do vínculo | membership_id, role_id | N:N | — | T — H |
| `membership_permission_overrides` | Exceção individual | permission_id, effect(grant\|deny), reason, expires_at | N:1 membership | `deny` sempre vence | T — H |
| `support_access_grants` | Acesso temporário do suporte | granted_by, expires_at, reason, revoked_at | N:1 organization | `expires_at` ≤ 7 dias | T — H |
| `api_keys` | Credencial de máquina | name, prefix, hash, scopes[], scope_config, last_used_at, expires_at, revoked_at | N:1 organization | Segredo nunca legível após criação | T — H |
| `audit_logs` | Trilha de mutação | actor_user_id, actor_kind, entity_type, entity_id, entity_label, action, changes jsonb, ip, user_agent, request_id, source | — | Sem UPDATE/DELETE | T — — A |
| `domain_events` | Fatos de negócio | type, aggregate_type, aggregate_id, sequence, payload jsonb, schema_version, actor, caused_by_event_id, caused_by_rule_id, occurred_at, published_at | — | Outbox transacional | T — — A |

### DIRECTORY

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `customers` | Quem é atendido | name, trade_name, code, tax_id, is_internal, status, segment, billing_*, default_sla_policy_id, logo_key, custom | 1:N locations, contracts, service_requests | Máx. 1 `is_internal` por org; nome único por org | T S H |
| `customer_contacts` | Pessoas do cliente | name, role, email, phone, receives_reports, user_id | N:1 customer | — | T S H |
| `location_types` | Níveis da árvore | key, name, icon, allowed_parent_type_ids[], allows_assets, position | 1:N locations | Catálogo por org | T S H |
| `locations` | Árvore física | parent_id, location_type_id, name, code, path ltree, depth, address jsonb, geo, timezone, calendar_id, manager_user_id, is_mobile, status, custom | N:1 customer, self-FK, 1:N assets | Sem ciclo; tipo válido para o pai; `depth` ≤ 8; `code` único por cliente | T S H |
| `suppliers` | Terceiros | name, tax_id, categories[], is_authorized_service, contacts, payment_terms, rating | 1:N stock_lots, work_orders | — | T S H |
| `teams` | Equipes | name, code, calendar_id, default_warehouse_id, coverage jsonb, lead_user_id | N:N users | — | T S H |
| `team_members` | Composição | role_in_team, skills[] | N:N | — | T — H |
| `calendars` / `calendar_windows` / `calendar_exceptions` | Cobertura de horário | name, timezone; weekday, start, end; date, kind, note | usado por SLA e agenda | Janelas não sobrepostas no mesmo dia | T S H |
| `availability_blocks` | Indisponibilidade | user_id ou team_id, kind(absence\|training\|meeting\|other), starts_at, ends_at, note | N:1 user/team | Bloqueia agendamento quando `absence` | T S H |

### ASSETS

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `asset_categories` | Classe funcional | name, code, parent_id, default_criticality_id, requires_calibration, requires_electrical_test, icon | 1:N models, assets | Profundidade ≤ 2 | T S H |
| `manufacturers` | Marca | name, country, website, support_contact, verified | 1:N models | Nome único por org (normalizado) | T S H |
| `asset_models` | Modelo | manufacturer_id, category_id, name, code, specs jsonb, default_useful_life_years, default_procedures[], docs | 1:N assets | Único (manufacturer, name) | T S H |
| `criticality_levels` | Matriz de risco | name, score, color, sla_multiplier, position | 1:N assets | Catálogo por org | T S H |
| `assets` | Ativo gerenciado | tag, serial_number, asset_number, qr_token, barcode, asset_model_id, asset_category_id, customer_id, location_id, location_path, parent_asset_id, status, criticality_id, default_priority, operational_risk, anvisa_registration, inmetro_ordinance, manufactured_at, acquired_at, installed_at, warranty_until, useful_life_years, purchase_value, residual_value, replacement_value, ownership, contract_id, owner_supplier_id, sla_policy_id, specs, custom, show_on_work_order[], notes, internal_notes, verification_status | N:1 location/customer/model; 1:N work_orders, documents, meters; self-FK | Unicidade configurável em tag/serial/asset_number; `location.customer_id = asset.customer_id`; sem ciclo em `parent_asset_id` | T S H |
| `asset_transfers` | Movimentação de ativo | kind(transfer\|loan\|return), from_location_id, to_location_id, assets[], requested_by, approved_by, status, due_back_at, returned_at, note | N:N assets | Empréstimo exige `due_back_at` | T S H |
| `meters` / `meter_readings` | Contadores | asset_id, kind, unit, cumulative; value, read_at, source, work_order_id | N:1 asset | Leitura acumulada não pode regredir sem justificativa | T — H / A |

### SERVICE

| Entidade | Responsabilidade | Campos principais | Relacionamentos | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- | --- |
| `service_requests` | Demanda do cliente | number, source, status, requester_user_id, requester_name, requester_phone, customer_id, location_id, summary, description, reported_failure_code_id, requested_priority, priority, rejection_reason_id, merged_into_request_id, triaged_by, triaged_at, first_response_at, satisfaction_score, satisfaction_comment, custom | N:N assets; 1:N work_orders | `rejected` exige motivo; `duplicate` exige `merged_into`; sem ciclo em merge | T S H |
| `work_order_types` | Natureza | key, system_key, name, color, icon, requires_asset, completion_requirements jsonb, default_procedure_id, counts_as_failure, causes_downtime, position | 1:N work_orders | `system_key` imutável | T S H |
| `work_order_statuses` | Situação | key, name, customer_label, category (enum), color, position, is_system, requires_wait_reason, is_default_for_category | 1:N work_orders | `category` obrigatória; `is_system` não removível | T S H |
| `work_order_status_transitions` | Grafo permitido | from_status_id, to_status_id, required_permission, guard_expression, side_effects jsonb | N:N statuses | Sem transição para si mesmo | T — H |
| `wait_reasons` | Motivo de espera | key, name, customer_label, pauses_sla, responsible_party(internal\|customer\|supplier), requires_note, position | 1:N work_orders | Catálogo por org com seed | T S H |
| `failure_codes` | Sintoma e causa | kind(symptom\|cause\|action), name, code, asset_category_ids[], parent_id, position | N:1 work_order | Árvore rasa | T S H |
| `work_orders` | Trabalho | ver §09 na íntegra | N:1 asset/location/customer/type/status; 1:N filhas | `status.category = waiting` ⇒ `wait_reason_id NOT NULL`; `number` único por org; `closed` ⇒ imutável sem permissão | T S H |
| `work_order_assignees` | Executores | user_id, role | N:N | — | T — H |
| `work_order_status_history` | Trajetória | from_status_id, to_status_id, wait_reason_id, actor, note, changed_at, duration_in_previous_s | N:1 work_order | Append-only | T — — A |
| `time_entries` | Horas | user_id, kind(labor\|travel\|waiting), started_at, ended_at, minutes, note, cost_snapshot, approved_by, approved_at | N:1 work_order | `ended_at > started_at`; sem sobreposição do mesmo usuário salvo permissão | T S H |
| `work_order_parts` | Peças | inventory_item_id, warehouse_id, lot_id, qty, unit_price, status | N:1 work_order | Consumo gera `stock_movement` | T S H |
| `work_order_services` | Serviços | service_catalog_id, qty, unit_price, warranty_days | N:1 work_order | — | T S H |
| `work_order_comments` | Conversa | author_id, body, visibility, mentions[], edited_at | N:1 work_order | Edição preserva original no histórico | T S H |
| `signatures` | Assinatura | owner_type, owner_id, signer_name, signer_document, role, method, image_key, code_verified_at, ip, content_hash | polimórfico | Hash obrigatório | T — — A |
| `custody_protocols` | Custódia física | kind(collection\|delivery\|service), handled_by, signed_by, signed_at, note, related_protocol_id | N:1 work_order | Entrega referencia recolhimento | T S H |
| `sla_policies` / `sla_targets` | Política de prazo | name, calendar_id; priority, kind(response\|onsite\|resolution), duration_minutes, business_hours_only | 1:N clocks | Único (policy, priority, kind) | T S H |
| `sla_clocks` / `sla_pauses` | Contagem | owner_type, owner_id, target_kind, started_at, due_at, stopped_at, met, elapsed_minutes, elapsed_business_minutes, paused_minutes, breached_at; pause: reason, from, to | N:1 work_order/request | Um clock por alvo por documento | T — — A |

### PLANNING

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `maintenance_plans` | Programa | name, customer_id, contract_id, owner_user_id, team_id, status, auto_generate, include_late_assets, description | — | T S H |
| `plan_tasks` | O que, quando, sobre quem | target_type, target_ref, work_order_type_id, procedure_id, trigger, frequency, interval, lead_time_days, tolerance_days, estimated_duration_min, default_team_id, required_parts[] | Alvo deve resolver ≥ 0 ativos; frequência obrigatória se `trigger = calendar` | T S H |
| `plan_cycles` | Instância temporal | seq, starts_at, ends_at, status, expected_count, done_count, skipped_count | Ciclos não se sobrepõem | T — H |
| `plan_cycle_items` | Trabalho previsto | plan_task_id, asset_id, due_at, status, work_order_id, skip_reason | Único (cycle, task, asset) | T — H |
| `procedures` | Instrução técnica | title, work_order_type_id, scope_type, scope_ref, summary, scope, content, attachments, required_standards[], version, status | Publicação congela versão | T S H |
| `checklist_templates` / `_sections` / `_items` | Formulário | ver §14 | Publicado é imutável | T S H |
| `checklist_responses` / `_answers` | Execução | work_order_id, template_id, template_version, started_at, finished_at; item_id, value, verdict, photo_ids[], measured_by | Resposta referencia versão congelada | T — H |

### COMMERCE

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `contracts` / `contract_coverage` / `contract_slas` | Instrumento comercial | ver §17 | Um ativo em um contrato por data | T S H |
| `billing_periods` | Medição | contract_id, period, status, metrics jsonb, closed_by, closed_at | Fechado é imutável | T — H |
| `service_catalog` | Serviços vendáveis | work_order_type_id, name, description, unit, warranty_days, price | — | T S H |
| `price_lists` / `price_list_items` | Tabela de preço | name, customer_id, contract_id, valid_from, valid_to; ref_type, ref_id, price, discount | Sem sobreposição de vigência | T S H |
| `quotes` / `quote_items` | Proposta | ver §16 | `rejected` exige motivo; versão N+1 supersede N | T S H |
| `warehouses` | Local de estoque | name, kind, location_id, owner_user_id, allow_negative | — | T S H |
| `inventory_items` | Item | sku, name, category_id, unit_id, manufacturer_id, manufacturer_code, model, image_key, tracking, is_stockable, lead_time_days | `sku` único por org | T S H |
| `customer_item_aliases` | Nome e preço por cliente | customer_id, alias, sale_price | Único (item, customer) | T S H |
| `stock_lots` | Lote | warehouse_id, item_id, lot_code, invoice_number, supplier_id, expires_at, unit_cost, qty_on_hand | `qty_on_hand ≥ 0` | T — H |
| `stock_balances` | Projeção | item_id, warehouse_id, on_hand, reserved, available, min_qty | Derivada dos movimentos | T — — |
| `stock_movements` | Razão | kind, qty, item_id, lot_id, warehouse_id, unit_cost, ref_type, ref_id, reason, actor | Sem UPDATE/DELETE; correção por movimento inverso | T — — A |
| `stock_reservations` | Reserva | work_order_id, item_id, warehouse_id, qty, status, expires_at | Liberada ao cancelar OS | T — H |
| `stock_counts` / `_items` | Inventário | warehouse_id, status, counted_by, approved_by; item, expected, counted, variance | Ajuste só após aprovação | T — H |

### DOCUMENTS · AUTOMATION · INSIGHT

| Entidade | Responsabilidade | Campos principais | Constraints | T/S/H/A |
| --- | --- | --- | --- | --- |
| `document_types` | Tipo documental | key, name, number_series_id, template_id, default_validity_months, requires_technical_manager, requires_signature, payload_schema | Seed da plataforma + customizável | T S H |
| `documents` | Documento emitido | ver §18 | Número imutável; assinado ⇒ conteúdo imutável | T S H |
| `document_payloads` | Dados do tipo | jsonb validado por `payload_schema` | — | T — H |
| `number_series` | Numeração | scope, document_type, prefix, suffix, pattern, next_value, reset_yearly, active | Alocação com advisory lock | T — H |
| `standards` / `uncertainty_profiles` | Metrologia | asset_id, ranges, uncertainty, resolution; sensor, range, value, expires_at | Padrão vencido bloqueia emissão | T S H |
| `attachments` | Arquivos | ver §28 | Prefixo de storage por organização | T S H |
| `automation_rules` / `rule_runs` | Regras | ver §24 | Profundidade de cadeia ≤ 3 | T S H / A |
| `notifications` / `notification_preferences` | Entrega | user_id, type, channel, payload, read_at, sent_at, failed_reason; user × type × channel | De-duplicação por janela | T — — |
| `webhook_endpoints` / `webhook_deliveries` | Integração | url, secret, events[], active; event_id, attempt, status, response_code, response_body | Assinatura HMAC obrigatória | T S H / A |
| `saved_views` | Visão salva | owner_id, entity, filters, columns, sort, visibility | — | T S H |
| `dashboards` / `dashboard_widgets` | Painéis | name, owner, visibility, layout; metric_key, viz, group_by, filters, size, position | Widget financeiro exige permissão | T S H |
| `export_jobs` | Processamento assíncrono | kind, params, status, progress, file_key, requested_by, expires_at | Arquivo expira em 7 dias | T — — |
| `custom_field_definitions` | Campos personalizados | ver §29 | `key` imutável; máx. 50 por entidade | T S H |
| `fact_*` | Tabelas analíticas | `fact_work_order`, `fact_status_period`, `fact_time_entry`, `fact_sla`, `fact_plan_item`, `fact_stock_movement` | Somente escrita pelo pipeline | T — — A |

---

## 33. ERD conceitual

```

PLATFORM
  users ─1:N─ memberships ─N:1─ organizations
                  │
                  ├─N:N─ roles ─N:N─ permissions
                  ├─1:1─ membership_scopes
                  └─1:N─ membership_permission_overrides

  organizations ─1:N─ TUDO ABAIXO   (organization_id obrigatório)

DIRECTORY
  customers ─1:N─ locations (self-FK, ltree path)
      │              └─1:N─ assets
      ├─1:N─ customer_contacts
      ├─1:N─ contracts
      └─1:N─ service_requests

  suppliers ─1:N─ stock_lots
            └─1:N─ work_orders (outsourced_to)

  teams ─N:N─ users        calendars ─1:N─ calendar_windows / exceptions
        └─1:N─ availability_blocks

ASSETS
  manufacturers ─1:N─ asset_models ─1:N─ assets
  asset_categories ─1:N─ asset_models
                   └─1:N─ assets
  criticality_levels ─1:N─ assets
  assets ─self-FK─ assets (componente)
         ├─N:N─ asset_transfers
         ├─1:N─ meters ─1:N─ meter_readings
         ├─1:N─ work_orders
         ├─1:N─ documents
         └─N:N─ plan_cycle_items

SERVICE
  service_requests ─1:N─ work_orders          (source = request)
                   └─self-FK─ merged_into

  work_order_types ─1:N─ work_orders
  work_order_statuses ─1:N─ work_orders
                      └─N:N─ work_order_status_transitions
  wait_reasons ─1:N─ work_orders
  failure_codes ─1:N─ work_orders  (symptom · cause · action)

  work_orders
      ├─1:N─ work_order_assignees ─N:1─ users
      ├─1:N─ work_order_status_history
      ├─1:N─ time_entries
      ├─1:N─ work_order_parts ─N:1─ inventory_items / stock_lots
      ├─1:N─ work_order_services ─N:1─ service_catalog
      ├─1:N─ work_order_comments
      ├─1:N─ checklist_responses ─1:N─ checklist_answers
      ├─1:N─ custody_protocols
      ├─1:N─ signatures
      ├─1:N─ attachments
      ├─1:N─ documents
      ├─1:N─ quotes
      ├─1:N─ sla_clocks ─1:N─ sla_pauses
      ├─N:1─ plan_cycle_items
      └─self-FK─ parent_work_order (derivada / reabertura)

  sla_policies ─1:N─ sla_targets
               ─1:N─ contracts / customers / assets  (cascata de resolução)

PLANNING
  maintenance_plans ─1:N─ plan_tasks ─N:1─ procedures ─N:N─ checklist_templates
                    └─1:N─ plan_cycles ─1:N─ plan_cycle_items ─1:1─ work_orders
  checklist_templates ─1:N─ checklist_sections ─1:N─ checklist_items

COMMERCE
  contracts ─1:N─ contract_coverage → assets
            ─1:N─ contract_slas ─N:1─ sla_policies
            ─1:N─ billing_periods
            ─1:N─ price_lists ─1:N─ price_list_items

  quotes ─1:N─ quote_items → inventory_items | service_catalog
         ─N:1─ work_orders
         ─self-FK─ supersedes

  warehouses ─1:N─ stock_lots ─N:1─ inventory_items
             ─1:N─ stock_balances
             ─1:N─ stock_movements  (ref → work_order | quote | count | transfer)
             ─1:N─ stock_counts ─1:N─ stock_count_items
  inventory_items ─1:N─ customer_item_aliases ─N:1─ customers

DOCUMENTS
  document_types ─1:N─ documents ─1:N─ document_signatures
                 └─N:1─ number_series      └─1:1─ document_payloads
  standards ─N:N─ documents (calibração)
  standards ─1:N─ uncertainty_profiles

AUTOMATION & INSIGHT
  domain_events ──→ automation_rules ─1:N─ rule_runs
                ──→ notifications ─N:1─ notification_preferences
                ──→ webhook_endpoints ─1:N─ webhook_deliveries
                ──→ fact_* ──→ dashboards ─1:N─ dashboard_widgets
                          └─→ saved_views
  audit_logs ←── triggers de todas as tabelas de negócio

```

### Índices e desempenho — decisões que precisam existir no dia 1

| Alvo | Índice / estratégia | Motivo |
| --- | --- | --- |
| Lista de OS | Composto `(organization_id, status_category, opened_at DESC)` + parcial `WHERE deleted_at IS NULL` | A consulta mais frequente do produto |
| Escopo por local | GiST em `locations.path` + tabela materializada de locais acessíveis | Evita CTE recursiva por requisição |
| Busca | `tsvector` gerado + GIN; `pg_trgm` em série, TAG e patrimônio | Erro de digitação em número de série é a regra, não a exceção |
| Campos personalizados | GIN em `custom` + índices de expressão sob demanda | Filtro por campo personalizado sem varredura |
| Histórico de situação | `(work_order_id, changed_at)`; particionamento por mês quando passar de ~50 M linhas | Base da métrica de tempo por situação |
| Eventos e auditoria | Particionamento mensal por `occurred_at` | Retenção e purga baratas |
| Contagens de painel | Tabelas de fato, nunca `COUNT(*)` sobre a tabela transacional | Causa raiz das telas lentas na referência |
