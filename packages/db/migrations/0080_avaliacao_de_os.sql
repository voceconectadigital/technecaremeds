-- =============================================================================
-- Aurora — 0080 avaliação e assinatura da ordem de serviço pelo solicitante
-- Conversa com o cliente, 21/10/2026:
--   "obrigar o usuário a avaliar e assinar", "sempre avaliar antes e depois assinar
--   automático", "isso também deve gerar um indicador de avaliação de OS", e "avisar em
--   um campo específico de pendências todas as OS de qualquer tipo para avaliar/assinar".
--
-- Uma avaliação por OS (`UNIQUE (work_order_id)`): reavaliar até a nota melhorar é o que
-- transforma indicador em negociação. A avaliação aponta para a assinatura que ela gera
-- no mesmo ato — não existe nota sem assinatura, nem assinatura sem nota.
-- =============================================================================

-- A assinatura pela sessão exige o e-mail de quem assinou, como a de código por e-mail.
ALTER TABLE aurora.signatures DROP CONSTRAINT sig_evidence_present;
ALTER TABLE aurora.signatures ADD CONSTRAINT sig_evidence_present CHECK (
  (method = 'drawn' AND attachment_id IS NOT NULL)
  OR (method IN ('email_code', 'session') AND signer_email IS NOT NULL)
);

CREATE TABLE aurora.work_order_evaluations (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  work_order_id            uuid NOT NULL,
  rating                   smallint NOT NULL,
  comment                  text,
  evaluator_membership_id  uuid NOT NULL,
  evaluated_at             timestamptz NOT NULL DEFAULT now(),
  signature_id             uuid NOT NULL,

  CONSTRAINT woe_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT woe_comment_len CHECK (comment IS NULL OR length(comment) <= 2000),
  CONSTRAINT woe_one_per_work_order UNIQUE (work_order_id),
  CONSTRAINT woe_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT woe_wo_org_fk
    FOREIGN KEY (work_order_id, organization_id)
    REFERENCES aurora.work_orders (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT woe_evaluator_org_fk
    FOREIGN KEY (evaluator_membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id),
  CONSTRAINT woe_signature_org_fk
    FOREIGN KEY (signature_id, organization_id)
    REFERENCES aurora.signatures (id, organization_id)
);
CREATE INDEX woe_org_evaluated_idx ON aurora.work_order_evaluations (organization_id, evaluated_at);
CREATE INDEX woe_evaluator_idx     ON aurora.work_order_evaluations (evaluator_membership_id);

CREATE TRIGGER work_order_evaluations_audit AFTER INSERT OR UPDATE OR DELETE ON aurora.work_order_evaluations
  FOR EACH ROW EXECUTE FUNCTION aurora.fn_audit('comment');

ALTER TABLE aurora.work_order_evaluations OWNER TO aurora_owner;
ALTER TABLE aurora.work_order_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aurora.work_order_evaluations FORCE  ROW LEVEL SECURITY;
CREATE POLICY work_order_evaluations_tenant_isolation ON aurora.work_order_evaluations FOR ALL
  USING (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
-- A avaliação não se edita nem se apaga: é registro, e a assinatura dela também não.
GRANT SELECT, INSERT ON aurora.work_order_evaluations TO aurora_app;
GRANT SELECT ON aurora.work_order_evaluations TO aurora_readonly;
