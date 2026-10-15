-- =============================================================================
-- Aurora — 0059 situação "Em análise", entre "Agendada" e "Em execução"
--
-- Pedido do cliente: o quadro de OS precisa de uma coluna para a OS que já
-- saiu da agenda mas ainda não está em execução — está sendo avaliada.
--
-- É uma SITUAÇÃO (ADR-003), não um texto na tela: categoria `open` (ativa,
-- relógio correndo, ativo não dado como parado), com transições no grafo da
-- organização. As organizações novas a recebem por `provisionWorkOrderStates`
-- (FACTORY_STATUSES); esta migration a entrega às que já existem.
--
-- Idempotente: só toca organizações que ainda não têm `in_analysis`, e só
-- empurra uma posição as situações que vinham depois de "Agendada".
-- =============================================================================

WITH alvo AS (
  SELECT s.organization_id, s.position AS pos_agendada
    FROM aurora.work_order_statuses s
   WHERE s.key = 'scheduled'
     AND NOT EXISTS (
       SELECT 1 FROM aurora.work_order_statuses x
        WHERE x.organization_id = s.organization_id AND x.key = 'in_analysis'
     )
)
UPDATE aurora.work_order_statuses w
   SET position = w.position + 1
  FROM alvo
 WHERE w.organization_id = alvo.organization_id
   AND w.position > alvo.pos_agendada;

INSERT INTO aurora.work_order_statuses
  (id, organization_id, key, label, customer_label, category, color, position, is_system)
SELECT gen_random_uuid(), s.organization_id, 'in_analysis', 'Em análise', 'Em análise',
       'open'::aurora.status_category, '#b06000', s.position + 1, true
  FROM aurora.work_order_statuses s
 WHERE s.key = 'scheduled'
   AND NOT EXISTS (
     SELECT 1 FROM aurora.work_order_statuses x
      WHERE x.organization_id = s.organization_id AND x.key = 'in_analysis'
   );

-- As mesmas transições de FACTORY_TRANSITIONS, por organização.
INSERT INTO aurora.work_order_status_transitions
  (organization_id, from_status_id, to_status_id, permission_key, required_fields, note)
SELECT f.organization_id, f.id, t.id, g.permissao, g.requisitos, g.nota
  FROM (VALUES
    ('open',        'in_analysis', 'work_order.execute',  '{}'::text[],                     'início da análise'),
    ('scheduled',   'in_analysis', 'work_order.execute',  '{}'::text[],                     'início da análise'),
    ('in_analysis', 'in_progress', 'work_order.execute',  '{}'::text[],                     'análise concluída'),
    ('in_analysis', 'scheduled',   'work_order.schedule', '{}'::text[],                     'volta para a agenda'),
    ('in_analysis', 'cancelled',   'work_order.cancel',   '{cancellation_reason}'::text[],  'cancelamento com motivo obrigatório')
  ) AS g(de, para, permissao, requisitos, nota)
  JOIN aurora.work_order_statuses f ON f.key = g.de
  JOIN aurora.work_order_statuses t ON t.key = g.para AND t.organization_id = f.organization_id
ON CONFLICT (from_status_id, to_status_id) DO NOTHING;
