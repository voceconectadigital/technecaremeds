-- =============================================================================
-- Aurora — 0043 operações de cliente: a espinha da sincronização offline
--                                     (SPEC v0.2 §20 · EPIC-014)
--
-- O REQUISITO É UMA FRASE: "reenviar a mesma operação nunca duplica registro".
-- Tudo aqui existe para cumpri-la, e para cumprir a que vem logo depois, que é
-- mais difícil: "nunca descartar trabalho em silêncio".
--
-- QUATRO DECISÕES
--
-- 1. UM `client_operation_id` TEM UM DESFECHO, PARA SEMPRE
--    O dispositivo gera o identificador antes de tentar; o servidor grava o
--    desfecho junto com ele. Reenviar devolve o MESMO desfecho, sem reexecutar
--    coisa alguma. É o que torna a retentativa segura numa rede que cai no meio
--    do envio — e a rede de um hospital cai no meio do envio.
--
--    A consequência é que resolver um conflito NÃO reusa o identificador: a
--    decisão nova é uma operação nova, com identificador novo. Reusar faria o
--    mesmo identificador ter dois desfechos, e aí a idempotência deixa de ser
--    uma promessa que dá para verificar.
--
-- 2. O CONFLITO É GRAVADO COM O CORPO DA REQUISIÇÃO
--    Quando o servidor recusa por estado incompatível — a OS foi cancelada
--    enquanto o técnico a executava —, a transação da operação some inteira. O
--    que o técnico digitou nas duas horas anteriores estaria só no aparelho
--    dele. A SPEC exige que esse trabalho fique "preservado e recuperável", e
--    é por isso que a linha de conflito guarda `request_body`: a recuperação
--    passa a existir também do lado do servidor, e não só na memória de um
--    telefone que pode cair no chão do centro cirúrgico.
--
-- 3. SUCESSO GUARDA A RESPOSTA; CONFLITO GUARDA A PERGUNTA
--    São as duas metades da mesma necessidade e nenhuma linha precisa das
--    duas. Guardar tudo em toda operação encheria a tabela de cópias do que já
--    está nas tabelas de negócio.
--
-- 4. A CHAVE É (organização, operação), E NÃO INCLUI O VÍNCULO
--    O identificador é UUID gerado no aparelho: já é único. Pôr o vínculo na
--    chave permitiria que o MESMO identificador, vindo de outra pessoa,
--    criasse um segundo registro — que é exatamente a duplicata que esta
--    tabela existe para impedir. O vínculo é guardado à parte, e um reenvio
--    vindo de outra pessoa é recusado em vez de receber a resposta alheia.
-- =============================================================================

-- 'in_progress' SÓ EXISTE DENTRO DE UMA TRANSAÇÃO ABERTA.
--
-- A linha é inserida ANTES de o trabalho começar, e é isso que faz a
-- retentativa simultânea esperar em vez de executar de novo: a segunda tentativa
-- esbarra no índice único e fica bloqueada até a primeira decidir. Quando a
-- primeira dá certo, a mesma transação troca o estado; quando ela falha, a
-- transação inteira desaparece e a linha com ela.
--
-- Logo, uma linha 'in_progress' VISÍVEL a outra sessão é impossível — e uma
-- linha 'in_progress' persistida seria evidência de defeito, não estado normal.
CREATE TYPE aurora.client_operation_state AS ENUM ('in_progress', 'succeeded', 'conflicted');

CREATE TABLE aurora.client_operations (
  organization_id     uuid NOT NULL REFERENCES aurora.organizations(id) ON DELETE CASCADE,
  /** Gerado NO APARELHO, antes da primeira tentativa. */
  client_operation_id uuid NOT NULL,
  /** Quem enviou. Fora da chave — ver decisão 4. */
  membership_id       uuid NOT NULL,
  /** 'POST /work-orders/:id/start' — para diagnóstico e para a tela de atenção. */
  route               text NOT NULL,
  /**
   * SHA-256 do corpo canonizado.
   *
   * Existe para separar "a mesma operação de novo" de "outra operação com o
   * identificador repetido". A primeira é retentativa e recebe o desfecho
   * guardado; a segunda é defeito do cliente, e recebe recusa em vez de a
   * resposta de uma operação que não é a dela.
   */
  request_digest      text NOT NULL,
  state               aurora.client_operation_state NOT NULL,
  /** O código HTTP devolvido da primeira vez, devolvido igual nas seguintes. */
  response_status     integer,
  /** Preenchido quando deu certo. */
  response_body       jsonb,
  /** Preenchido quando conflitou: é o trabalho do técnico — ver decisão 2. */
  request_body        jsonb,
  /** O que o servidor disse ao recusar, na linguagem do domínio. */
  conflict_code       text,
  conflict_message    text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  /** Quando alguém tratou o conflito na tela "Precisa da sua atenção". */
  resolved_at         timestamptz,
  resolved_by         uuid,
  /** A operação nova que substituiu esta, quando o técnico refez a decisão. */
  superseded_by       uuid,

  PRIMARY KEY (organization_id, client_operation_id),

  CONSTRAINT client_operations_membership_org_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES aurora.memberships (id, organization_id) ON DELETE CASCADE,

  -- Sucesso sem código HTTP de sucesso, ou conflito sem motivo, seriam linhas
  -- que não sabem dizer o que aconteceram. A restrição impede que existam.
  CONSTRAINT client_operations_desfecho_coerente CHECK (
    (state = 'in_progress' AND response_status IS NULL AND conflict_code IS NULL)
    OR
    (state = 'succeeded'   AND response_status BETWEEN 200 AND 299 AND conflict_code IS NULL)
    OR
    (state = 'conflicted'  AND response_status >= 400 AND conflict_code IS NOT NULL)
  ),

  -- Conflito sem o corpo da requisição seria conflito com o trabalho do técnico
  -- jogado fora — exatamente o que a decisão 2 existe para impedir. A restrição
  -- torna essa linha impossível de gravar.
  CONSTRAINT client_operations_conflito_preserva_trabalho CHECK (
    state <> 'conflicted' OR request_body IS NOT NULL
  )
);

-- A tela "Precisa da sua atenção" é UMA consulta: os conflitos ainda não
-- tratados desta pessoa, do mais recente para o mais antigo.
CREATE INDEX client_operations_atencao_idx
  ON aurora.client_operations (organization_id, membership_id, received_at DESC)
  WHERE state = 'conflicted' AND resolved_at IS NULL;

DO $do$
BEGIN
  ALTER TABLE aurora.client_operations OWNER TO aurora_owner;
  ALTER TABLE aurora.client_operations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE aurora.client_operations FORCE  ROW LEVEL SECURITY;

  CREATE POLICY client_operations_tenant_isolation ON aurora.client_operations FOR ALL
    USING (organization_id = aurora.current_organization_id())
    WITH CHECK (organization_id = aurora.current_organization_id());

  -- Sem DELETE, e é de propósito.
  --
  -- Apagar uma operação de cliente é reabrir a porta para a duplicata que ela
  -- existe para fechar: o aparelho que reenviar depois do apagamento passa a
  -- criar um segundo registro. A retenção é decisão de operação, não da
  -- aplicação, e sai por rotina de plataforma quando existir.
  GRANT SELECT, INSERT, UPDATE ON aurora.client_operations TO aurora_app;
  GRANT SELECT ON aurora.client_operations TO aurora_readonly;
END
$do$;
