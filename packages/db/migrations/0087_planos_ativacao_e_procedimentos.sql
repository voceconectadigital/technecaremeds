-- =============================================================================
-- Aurora — 0087 planos: ativar/inativar com motivo e mais de um procedimento por tarefa
--
--   PLN-01 "ativar/inativar plano preservando histórico"
--   OS-15  "suportar mais de um procedimento no mesmo plano/OS"
--
-- ATIVAR / INATIVAR. `is_active` existe desde a 0029 e a varredura já o respeita (plano inativo
-- não abre ciclo nem gera OS). Faltava QUEM mudou, QUANDO e POR QUÊ. As três colunas guardam a
-- ÚLTIMA mudança, para a tela; o histórico inteiro continua na trilha de auditoria (o gatilho
-- `plans_audit` da 0029 grava o diff de cada UPDATE, motivo incluído). Nada é apagado: ciclos,
-- itens e OS já gerados ficam como estão.
--
-- PROCEDIMENTOS ADICIONAIS. A tarefa guardava UM checklist (`checklist_template_key`). Quando o
-- serviço combina procedimentos (preventiva + TSE no mesmo atendimento), os demais vão em
-- `extra_checklist_template_keys`. A OS gerada recebe UMA resposta por modelo — o banco já exige
-- resposta única por OS+modelo e item da resposta do próprio modelo (0024) —, então as respostas
-- de um procedimento nunca se misturam com as de outro. Vazio por padrão: nada muda para as
-- tarefas já cadastradas.
-- =============================================================================

ALTER TABLE aurora.maintenance_plans
  ADD COLUMN IF NOT EXISTS active_changed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS active_changed_by    uuid,
  ADD COLUMN IF NOT EXISTS active_change_reason text;

ALTER TABLE aurora.maintenance_plans
  ADD CONSTRAINT plans_active_reason_size CHECK (
    active_change_reason IS NULL OR length(active_change_reason) <= 500
  );

COMMENT ON COLUMN aurora.maintenance_plans.active_change_reason IS
  'Motivo (opcional) da última ativação/inativação. O histórico completo está em audit_logs.';

ALTER TABLE aurora.plan_tasks
  ADD COLUMN IF NOT EXISTS extra_checklist_template_keys text[] NOT NULL DEFAULT '{}';

ALTER TABLE aurora.plan_tasks
  ADD CONSTRAINT plan_tasks_extra_checklists_size CHECK (
    coalesce(array_length(extra_checklist_template_keys, 1), 0) <= 10
  );

COMMENT ON COLUMN aurora.plan_tasks.extra_checklist_template_keys IS
  'Procedimentos adicionais da tarefa: a OS gerada recebe um checklist por chave, cada um com as próprias respostas.';
